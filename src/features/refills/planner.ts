import type { RefillAlertState } from '@/db/repositories/refillAlerts';
import { addDays, localDateOf, localToUtc, type UtcIso } from '@/lib/time';

/** Local hour at which refill reminders are delivered. */
export const REFILL_REMINDER_TIME = '09:00';
/** The second low-supply reminder comes this many days after the first. */
export const SECOND_REMINDER_AFTER_DAYS = 2;

export const REFILL_ID_PREFIX = 'refill:';

export type RefillReminderKind = '1' | '2' | 'doctor';

export interface PlannedRefillReminder {
  id: string;
  medicationId: number;
  kind: RefillReminderKind;
  fireAt: Date;
  title: string;
  body: string;
}

export interface RefillInput {
  medicationId: number;
  name: string;
  quantity: number;
  /** At or below the refill threshold (see `isLowSupply`). */
  low: boolean;
  refillsRemaining: number | null;
  pharmacyName: string | null;
  state: RefillAlertState;
}

export interface RefillPlan {
  /** The state to store (identical to the input state when nothing changed). */
  state: RefillAlertState;
  reminders: PlannedRefillReminder[];
}

export const refillNotificationId = (medicationId: number, kind: RefillReminderKind) =>
  `${REFILL_ID_PREFIX}${medicationId}:${kind}`;

/** The next 09:00 local strictly after `instant`. */
export function nextReminderTime(instant: UtcIso): Date {
  const date = localDateOf(new Date(instant));
  const today = localToUtc(date, REFILL_REMINDER_TIME);
  return new Date(today > instant ? today : localToUtc(addDays(date, 1), REFILL_REMINDER_TIME));
}

function secondReminderTime(first: Date): Date {
  return new Date(
    localToUtc(addDays(localDateOf(first), SECOND_REMINDER_AFTER_DAYS), REFILL_REMINDER_TIME),
  );
}

/**
 * Decides which refill reminders should be pending for one medication, and the episode state to
 * store. A low-supply "episode" starts when supply is first seen at/below the threshold and ends
 * when the quantity rises above the lowest seen (a refill). Within an episode there are at most
 * two reminders: the next 09:00 after it started, and 09:00 two days later if still unresolved.
 * Reminder times already in the past are never planned again, so nothing is re-sent. Separately,
 * when no refills remain, one "contact your doctor" reminder is planned (skipped while the
 * low-supply reminders, which carry the same message, apply).
 */
export function planRefillReminders(input: RefillInput, now: Date): RefillPlan {
  const { medicationId, name, quantity, low, refillsRemaining } = input;
  const nowIso = now.toISOString();
  let { lowSince, lowQuantity, doctorSince } = input.state;

  const refilled = lowQuantity !== null && quantity > lowQuantity;
  if (low) {
    if (lowSince === null || refilled) {
      lowSince = nowIso; // a new episode
      lowQuantity = quantity;
    } else {
      lowQuantity = Math.min(lowQuantity ?? quantity, quantity);
    }
  } else if (lowSince === null || refilled) {
    lowSince = null;
    lowQuantity = null;
  } // else: dipped above the threshold without a refill; keep the episode so it isn't re-sent

  const noRefillsLeft = refillsRemaining === 0;
  doctorSince = noRefillsLeft ? (doctorSince ?? nowIso) : null;

  const reminders: PlannedRefillReminder[] = [];
  const add = (kind: RefillReminderKind, fireAt: Date, title: string, body: string) => {
    if (fireAt.getTime() > now.getTime()) {
      reminders.push({
        id: refillNotificationId(medicationId, kind),
        medicationId,
        kind,
        fireAt,
        title,
        body,
      });
    }
  };

  if (low && lowSince !== null) {
    const where = input.pharmacyName ? ` at ${input.pharmacyName}` : '';
    const body = noRefillsLeft
      ? 'Supply is running low and no refills are left. Contact your doctor for a new prescription.'
      : `Supply is running low. Refill it soon${where}.`;
    const first = nextReminderTime(lowSince);
    add('1', first, `Time to refill ${name}`, body);
    add('2', secondReminderTime(first), `Reminder: refill ${name}`, body);
  }
  if (noRefillsLeft && !low && doctorSince !== null) {
    add(
      'doctor',
      nextReminderTime(doctorSince),
      `No refills left for ${name}`,
      'Contact your doctor for a new prescription.',
    );
  }

  return { state: { lowSince, lowQuantity, doctorSince }, reminders };
}
