import { NotFoundError } from '@/db/errors';
import type { DoseLog, DoseStatus } from '@/db/models';
import {
  adjustInventoryQuantity,
  deleteDoseLog,
  listDoseLogsInRange,
  recordDose,
} from '@/db/repositories';
import type { Database } from '@/db/types';
import type { UtcIso } from '@/lib/time';

export interface DoseRef {
  medicationId: number;
  scheduledFor: UtcIso;
}

export interface DoseOutcome {
  status: DoseStatus;
  quantity: number | null;
  actedAt: UtcIso | null;
}

/** Supply used by a log: only a taken dose consumes anything. Skipped, missed, snoozed use none. */
export const consumedQuantity = (log: Pick<DoseLog, 'status' | 'quantity'> | null): number =>
  log?.status === 'taken' ? (log.quantity ?? 0) : 0;

export async function findDoseLog(db: Database, ref: DoseRef): Promise<DoseLog | null> {
  const to = new Date(new Date(ref.scheduledFor).getTime() + 1).toISOString();
  const [log] = await listDoseLogsInRange(db, ref.scheduledFor, to, {
    medicationId: ref.medicationId,
  });
  return log ?? null;
}

/** Runs inside a transaction: sets the log for `ref` to `next` and adjusts inventory to match. */
async function applyDoseState(
  db: Database,
  ref: DoseRef,
  next: DoseOutcome | null,
): Promise<DoseLog | null> {
  const prior = await findDoseLog(db, ref);
  const delta = consumedQuantity(next) - consumedQuantity(prior);
  if (delta !== 0) {
    try {
      await adjustInventoryQuantity(db, ref.medicationId, -delta);
    } catch (error) {
      // Supply isn't tracked for this medication.
      if (!(error instanceof NotFoundError)) throw error;
    }
  }
  if (next) {
    await recordDose(db, {
      medicationId: ref.medicationId,
      scheduledFor: ref.scheduledFor,
      status: next.status,
      quantity: next.quantity,
      actedAt: next.actedAt,
    });
  } else if (prior) {
    await deleteDoseLog(db, prior.id);
  }
  return prior;
}

/**
 * The one place a dose's state changes. Sets the log for `ref` to `next` (or removes it when
 * `next` is null) and keeps inventory in step in the same transaction: inventory goes down by the
 * quantity of a taken dose and comes back if that dose is later changed or undone. Skipping or
 * missing never touches inventory. Returns the previous log so callers can offer undo.
 */
export async function setDoseState(
  db: Database,
  ref: DoseRef,
  next: DoseOutcome | null,
): Promise<DoseLog | null> {
  let prior = null as DoseLog | null;
  await db.withTransactionAsync(async () => {
    prior = await applyDoseState(db, ref, next);
  });
  return prior;
}

/**
 * Moves a dose log to a different slot (e.g. correcting when an as-needed dose was taken, which is
 * its key) atomically: the old log is removed and the new one written, with inventory adjusted by
 * the net difference. If anything fails, nothing changes.
 */
export async function moveDose(
  db: Database,
  from: DoseRef,
  to: DoseRef,
  next: DoseOutcome,
): Promise<DoseLog | null> {
  let prior = null as DoseLog | null;
  await db.withTransactionAsync(async () => {
    prior = await applyDoseState(db, from, null);
    await applyDoseState(db, to, next);
  });
  return prior;
}

/** Puts a dose back the way it was (e.g. from a snapshot returned by `setDoseState`). */
export function restoreDose(db: Database, ref: DoseRef, prior: DoseLog | null) {
  return setDoseState(
    db,
    ref,
    prior ? { status: prior.status, quantity: prior.quantity, actedAt: prior.actedAt } : null,
  );
}
