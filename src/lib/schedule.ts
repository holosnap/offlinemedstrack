import type { Schedule } from '@/db/models';
import { dayOfWeek, diffDays, type LocalDate, type LocalTime } from './time';

export type ScheduleRule = Pick<
  Schedule,
  'type' | 'times' | 'daysOfWeek' | 'intervalDays' | 'startDate' | 'endDate' | 'doseQuantity'
>;

/** Whether a (non as-needed) schedule produces doses on the given local calendar date. */
export function scheduleOccursOn(schedule: ScheduleRule, date: LocalDate): boolean {
  if (date < schedule.startDate) return false;
  if (schedule.endDate !== null && date > schedule.endDate) return false;
  switch (schedule.type) {
    case 'daily':
      return true;
    case 'weekdays':
      return (schedule.daysOfWeek ?? []).includes(dayOfWeek(date));
    case 'interval':
      return (
        schedule.intervalDays !== null &&
        diffDays(schedule.startDate, date) % schedule.intervalDays === 0
      );
    case 'as_needed':
      return false;
  }
}

/** Local times of day at which the schedule fires on `date` (empty if it doesn't). */
export function timesOn(schedule: ScheduleRule, date: LocalDate): LocalTime[] {
  return scheduleOccursOn(schedule, date) ? schedule.times : [];
}

/** Average quantity consumed per day, or 0 for as-needed schedules (unknowable). */
export function averageDailyQuantity(schedule: ScheduleRule): number {
  const perDay = schedule.times.length * schedule.doseQuantity;
  switch (schedule.type) {
    case 'daily':
      return perDay;
    case 'weekdays':
      return (perDay * (schedule.daysOfWeek?.length ?? 0)) / 7;
    case 'interval':
      return schedule.intervalDays ? perDay / schedule.intervalDays : 0;
    case 'as_needed':
      return 0;
  }
}
