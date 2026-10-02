import type { DoseLog, DoseStatus } from '@/db/models';
import {
  adjustInventoryQuantity,
  deleteDoseLog,
  getInventory,
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

/**
 * Supply used by a log: only a taken dose consumes anything (skipped, missed and snoozed use
 * none). It is what was actually deducted, which is less than the dose quantity if the recorded
 * supply ran out first; older logs fall back to the quantity.
 */
export const consumedQuantity = (
  log: Pick<DoseLog, 'status' | 'quantity' | 'supplyUsed'> | null,
): number => (log?.status === 'taken' ? (log.supplyUsed ?? log.quantity ?? 0) : 0);

const EPSILON = 1e-9;

export async function findDoseLog(db: Database, ref: DoseRef): Promise<DoseLog | null> {
  const to = new Date(new Date(ref.scheduledFor).getTime() + 1).toISOString();
  const [log] = await listDoseLogsInRange(db, ref.scheduledFor, to, {
    medicationId: ref.medicationId,
  });
  return log ?? null;
}

export interface DoseStateChange {
  /** The log before the change (null if there was none), for undo. */
  prior: DoseLog | null;
  /**
   * How much of a taken dose could not be taken out of the recorded supply because the supply ran
   * out first (0 when there was enough, or when supply isn't tracked). Supply never goes below
   * zero; callers should warn the person so they can correct the count.
   */
  shortfall: number;
}

/** Runs inside a transaction: sets the log for `ref` to `next` and adjusts inventory to match. */
async function applyDoseState(
  db: Database,
  ref: DoseRef,
  next: DoseOutcome | null,
): Promise<DoseStateChange> {
  const prior = await findDoseLog(db, ref);
  const priorUsed = consumedQuantity(prior);
  const wanted = next?.status === 'taken' ? (next.quantity ?? 0) : 0;

  let used = wanted;
  let tracked = false;
  const inventory = await getInventory(db, ref.medicationId);
  if (inventory) {
    tracked = true;
    // Give back what the previous log used, then take what is available (never below zero).
    const available = inventory.currentQuantity + priorUsed;
    used = Math.min(wanted, available);
    const delta = priorUsed - used;
    if (Math.abs(delta) > EPSILON) await adjustInventoryQuantity(db, ref.medicationId, delta);
  }

  if (next) {
    await recordDose(db, {
      medicationId: ref.medicationId,
      scheduledFor: ref.scheduledFor,
      status: next.status,
      quantity: next.quantity,
      supplyUsed: next.status === 'taken' && tracked ? used : null,
      actedAt: next.actedAt,
    });
  } else if (prior) {
    await deleteDoseLog(db, prior.id);
  }
  const shortfall = tracked && wanted - used > EPSILON ? wanted - used : 0;
  return { prior, shortfall };
}

/**
 * The one place a dose's state changes. Sets the log for `ref` to `next` (or removes it when
 * `next` is null) and keeps inventory in step in the same transaction: inventory goes down by the
 * quantity of a taken dose and comes back if that dose is later changed or undone. Skipping or
 * missing never touches inventory. Supply never goes below zero: if it runs out the shortfall is
 * reported and exactly what was deducted is what is given back later.
 */
export async function setDoseStateDetailed(
  db: Database,
  ref: DoseRef,
  next: DoseOutcome | null,
): Promise<DoseStateChange> {
  let change = { prior: null, shortfall: 0 } as DoseStateChange;
  await db.withTransactionAsync(async () => {
    change = await applyDoseState(db, ref, next);
  });
  return change;
}

/** Like `setDoseStateDetailed`, returning only the previous log. */
export async function setDoseState(
  db: Database,
  ref: DoseRef,
  next: DoseOutcome | null,
): Promise<DoseLog | null> {
  return (await setDoseStateDetailed(db, ref, next)).prior;
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
): Promise<DoseStateChange> {
  let change = { prior: null, shortfall: 0 } as DoseStateChange;
  await db.withTransactionAsync(async () => {
    const removed = await applyDoseState(db, from, null);
    const added = await applyDoseState(db, to, next);
    change = { prior: removed.prior, shortfall: added.shortfall };
  });
  return change;
}

/** Puts a dose back the way it was (e.g. from a snapshot returned by `setDoseState`). */
export function restoreDose(db: Database, ref: DoseRef, prior: DoseLog | null) {
  return setDoseState(
    db,
    ref,
    prior ? { status: prior.status, quantity: prior.quantity, actedAt: prior.actedAt } : null,
  );
}
