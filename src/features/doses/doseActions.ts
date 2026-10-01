import type { DoseLog } from '@/db/models';
import type { Database } from '@/db/types';
import { SNOOZE_MINUTES } from '@/features/reminders/constants';
import { snoozeNotificationId } from '@/features/reminders/planner';
import type { NotificationsPort } from '@/features/reminders/ports';
import { localToUtc, type LocalDate, type LocalTime, type UtcIso } from '@/lib/time';
import { restoreDose, setDoseState, type DoseRef } from './state';

export interface DoseActionDeps {
  db: Database;
  port: NotificationsPort;
  now?: () => Date;
}

export interface DoseAction {
  /** What the dose looked like before, so the action can be undone. */
  prior: DoseLog | null;
}

const nowOf = (deps: DoseActionDeps) => deps.now?.() ?? new Date();

/**
 * Logs a dose as taken. Inventory goes down by `quantity` (default: the scheduled quantity).
 * `takenAt` records when it was actually taken; the dose keeps its scheduled slot.
 */
export async function takeDose(
  deps: DoseActionDeps,
  ref: DoseRef & { quantity: number },
  options: { quantity?: number; takenAt?: Date } = {},
): Promise<DoseAction> {
  const quantity = options.quantity ?? ref.quantity;
  if (!(quantity > 0)) throw new RangeError('Quantity must be greater than 0');
  const prior = await setDoseState(deps.db, ref, {
    status: 'taken',
    quantity,
    actedAt: (options.takenAt ?? nowOf(deps)).toISOString(),
  });
  await deps.port.cancel(snoozeNotificationId(ref.medicationId, ref.scheduledFor));
  return { prior };
}

/** Skipping never touches inventory (and gives back anything an earlier "taken" used). */
export async function skipDose(deps: DoseActionDeps, ref: DoseRef): Promise<DoseAction> {
  const prior = await setDoseState(deps.db, ref, {
    status: 'skipped',
    quantity: null,
    actedAt: nowOf(deps).toISOString(),
  });
  await deps.port.cancel(snoozeNotificationId(ref.medicationId, ref.scheduledFor));
  return { prior };
}

/** Marks the dose snoozed and schedules a reminder `SNOOZE_MINUTES` from now. */
export async function snoozeDose(
  deps: DoseActionDeps,
  ref: DoseRef & { quantity: number },
  content: { title: string; body: string; data?: Record<string, unknown> },
): Promise<DoseAction & { until: Date }> {
  const now = nowOf(deps);
  const prior = await setDoseState(deps.db, ref, {
    status: 'snoozed',
    quantity: null,
    actedAt: now.toISOString(),
  });
  const until = new Date(now.getTime() + SNOOZE_MINUTES * 60_000);
  if ((await deps.port.getPermissionState()) === 'granted') {
    await deps.port.schedule({
      identifier: snoozeNotificationId(ref.medicationId, ref.scheduledFor),
      title: content.title,
      body: content.body,
      fireAt: until,
      data: {
        ...content.data,
        medicationId: ref.medicationId,
        scheduledFor: ref.scheduledFor,
        quantity: ref.quantity,
        kind: 'snooze',
      },
    });
  }
  return { prior, until };
}

/** Logs an as-needed dose. It has no schedule slot, so it is keyed by when it was taken. */
export async function logAsNeededDose(
  deps: DoseActionDeps,
  input: { medicationId: number; quantity: number; takenAt?: Date },
): Promise<DoseAction & { scheduledFor: UtcIso }> {
  if (!(input.quantity > 0)) throw new RangeError('Quantity must be greater than 0');
  const takenAt = input.takenAt ?? nowOf(deps);
  const scheduledFor = takenAt.toISOString();
  const prior = await setDoseState(
    deps.db,
    { medicationId: input.medicationId, scheduledFor },
    { status: 'taken', quantity: input.quantity, actedAt: scheduledFor },
  );
  return { prior, scheduledFor };
}

/** Undo: puts the dose back to `prior` (null = no log), restoring inventory as needed. */
export async function undoDose(
  deps: DoseActionDeps,
  ref: DoseRef,
  prior: DoseLog | null = null,
): Promise<void> {
  await restoreDose(deps.db, ref, prior);
  await deps.port.cancel(snoozeNotificationId(ref.medicationId, ref.scheduledFor));
}

/**
 * Turns "8:15" / "8:15 pm" typed for a given local day into an instant, rejecting bad input and
 * times in the future (a dose can't have been taken later than now).
 */
export function resolveTakenAt(
  date: LocalDate,
  time: LocalTime | null,
  now: Date,
): { ok: true; value: Date } | { ok: false; error: string } {
  if (time === null) return { ok: false, error: 'Enter a time like 8:30 am' };
  const value = new Date(localToUtc(date, time));
  if (value.getTime() > now.getTime()) return { ok: false, error: "That time hasn't happened yet" };
  return { ok: true, value };
}
