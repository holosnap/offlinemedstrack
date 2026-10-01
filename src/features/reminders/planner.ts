import type { Schedule } from '@/db/models';
import { timesOn, type ScheduleRule } from '@/lib/schedule';
import { addDays, localDateOf, localToUtc, type UtcIso } from '@/lib/time';
import { DOSE_ID_PREFIX, MAX_SCHEDULED_DOSES, SNOOZE_ID_PREFIX, WINDOW_DAYS } from './constants';

export type PlannableSchedule = Pick<Schedule, 'id' | 'medicationId'> & ScheduleRule;

export interface PlannedDose {
  /** Deterministic notification identifier, so the same dose always maps to the same request. */
  id: string;
  medicationId: number;
  scheduleId: number;
  scheduledFor: UtcIso;
  quantity: number;
}

export const doseKey = (medicationId: number, scheduledFor: UtcIso) =>
  `${medicationId}@${scheduledFor}`;

export const doseNotificationId = (medicationId: number, scheduledFor: UtcIso) =>
  `${DOSE_ID_PREFIX}${medicationId}:${scheduledFor}`;

export const snoozeNotificationId = (medicationId: number, scheduledFor: UtcIso) =>
  `${SNOOZE_ID_PREFIX}${medicationId}:${scheduledFor}`;

/** Medication id encoded in a `snooze:` identifier, or null if it isn't one. */
export function medicationIdOfSnooze(identifier: string): number | null {
  if (!identifier.startsWith(SNOOZE_ID_PREFIX)) return null;
  const id = Number(identifier.slice(SNOOZE_ID_PREFIX.length).split(':', 1)[0]);
  return Number.isInteger(id) ? id : null;
}

export interface PlanOptions {
  schedules: readonly PlannableSchedule[];
  now: Date;
  /** `doseKey`s the person already dealt with (taken or skipped); these are not reminded again. */
  resolved?: ReadonlySet<string>;
  windowDays?: number;
  maxDoses?: number;
}

/**
 * Expands schedules into the doses that should have a pending notification: every dose strictly
 * after `now` within the rolling window, soonest first, truncated to `maxDoses`.
 *
 * Doses are resolved from local wall-clock times in the device's *current* time zone, so after a
 * zone or DST change a fresh plan lands on the same wall-clock times (different instants).
 * Pure: no I/O, no Expo imports.
 */
export function planDoses({
  schedules,
  now,
  resolved = new Set(),
  windowDays = WINDOW_DAYS,
  maxDoses = MAX_SCHEDULED_DOSES,
}: PlanOptions): PlannedDose[] {
  const nowIso = now.toISOString();
  const horizon = new Date(now.getTime() + windowDays * 86_400_000).toISOString();
  const today = localDateOf(now);
  const doses = new Map<string, PlannedDose>();

  for (let offset = 0; offset <= windowDays; offset++) {
    const date = addDays(today, offset);
    for (const schedule of schedules) {
      for (const time of timesOn(schedule, date)) {
        const scheduledFor = localToUtc(date, time);
        if (scheduledFor <= nowIso || scheduledFor > horizon) continue;
        if (resolved.has(doseKey(schedule.medicationId, scheduledFor))) continue;
        const id = doseNotificationId(schedule.medicationId, scheduledFor);
        if (doses.has(id)) continue; // e.g. two times collapsing into one across a DST gap
        doses.set(id, {
          id,
          medicationId: schedule.medicationId,
          scheduleId: schedule.id,
          scheduledFor,
          quantity: schedule.doseQuantity,
        });
      }
    }
  }

  return [...doses.values()]
    .sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor) || a.medicationId - b.medicationId)
    .slice(0, maxDoses);
}
