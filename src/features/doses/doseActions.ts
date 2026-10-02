import type { DoseLog } from '@/db/models';
import type { Database } from '@/db/types';
import { getSettings } from '@/features/settings/settings';
import { doseNotificationId, snoozeNotificationId } from '@/features/reminders/planner';
import type { NotificationsPort } from '@/features/reminders/ports';
import { localToUtc, type LocalDate, type LocalTime, type UtcIso } from '@/lib/time';
import { restoreDose, setDoseStateDetailed, type DoseRef } from './state';

export interface DoseActionDeps {
  db: Database;
  port: NotificationsPort;
  now?: () => Date;
}

export interface DoseAction {
  /** What the dose looked like before, so the action can be undone. */
  prior: DoseLog | null;
  /** Quantity that could not be taken out of the recorded supply because it ran out (usually 0). */
  shortfall: number;
}

const nowOf = (deps: DoseActionDeps) => deps.now?.() ?? new Date();

/**
 * Once a dose has been dealt with in the app, its snooze reminder is no longer wanted and any
 * reminder already in the notification shade should go away (so its buttons can't be tapped later).
 */
async function clearDoseNotifications(port: NotificationsPort, ref: DoseRef): Promise<void> {
  await port.cancel(snoozeNotificationId(ref.medicationId, ref.scheduledFor));
  await port.dismiss(doseNotificationId(ref.medicationId, ref.scheduledFor));
  await port.dismiss(snoozeNotificationId(ref.medicationId, ref.scheduledFor));
}

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
  const change = await setDoseStateDetailed(deps.db, ref, {
    status: 'taken',
    quantity,
    actedAt: (options.takenAt ?? nowOf(deps)).toISOString(),
  });
  await clearDoseNotifications(deps.port, ref);
  return change;
}

/** Skipping never touches inventory (and gives back anything an earlier "taken" used). */
export async function skipDose(deps: DoseActionDeps, ref: DoseRef): Promise<DoseAction> {
  const change = await setDoseStateDetailed(deps.db, ref, {
    status: 'skipped',
    quantity: null,
    actedAt: nowOf(deps).toISOString(),
  });
  await clearDoseNotifications(deps.port, ref);
  return change;
}

/** Marks the dose snoozed and schedules a reminder (snooze length and sound come from Settings). */
export async function snoozeDose(
  deps: DoseActionDeps,
  ref: DoseRef & { quantity: number },
  content: { title: string; body: string; data?: Record<string, unknown> },
): Promise<DoseAction & { until: Date }> {
  const now = nowOf(deps);
  const settings = await getSettings(deps.db);
  const { prior, shortfall } = await setDoseStateDetailed(deps.db, ref, {
    status: 'snoozed',
    quantity: null,
    actedAt: now.toISOString(),
  });
  const until = new Date(now.getTime() + settings.snoozeMinutes * 60_000);
  if ((await deps.port.getPermissionState()) === 'granted') {
    await deps.port.schedule({
      identifier: snoozeNotificationId(ref.medicationId, ref.scheduledFor),
      title: content.title,
      body: content.body,
      fireAt: until,
      sound: settings.soundEnabled,
      data: {
        ...content.data,
        medicationId: ref.medicationId,
        scheduledFor: ref.scheduledFor,
        quantity: ref.quantity,
        kind: 'snooze',
      },
    });
  }
  return { prior, shortfall, until };
}

/** Logs an as-needed dose. It has no schedule slot, so it is keyed by when it was taken. */
export async function logAsNeededDose(
  deps: DoseActionDeps,
  input: { medicationId: number; quantity: number; takenAt?: Date },
): Promise<DoseAction & { scheduledFor: UtcIso }> {
  if (!(input.quantity > 0)) throw new RangeError('Quantity must be greater than 0');
  const takenAt = input.takenAt ?? nowOf(deps);
  const scheduledFor = takenAt.toISOString();
  const change = await setDoseStateDetailed(
    deps.db,
    { medicationId: input.medicationId, scheduledFor },
    { status: 'taken', quantity: input.quantity, actedAt: scheduledFor },
  );
  return { ...change, scheduledFor };
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
