import type { Schedule } from '@/db/models';
import {
  addDays,
  isLocalTime,
  localDateOf,
  type LocalDate,
  type LocalTime,
  type UtcIso,
} from './time';

export const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export const DAY_ABBREVIATIONS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** `1`, `0.5`, `2.25` — no trailing zeros. */
export function formatQuantity(value: number): string {
  return String(Number(value.toFixed(2)));
}

export function formatTime(time: LocalTime): string {
  if (!isLocalTime(time)) return time;
  const [hour, minute] = time.split(':').map(Number);
  return new Date(2000, 0, 1, hour, minute).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function localDateToDate(date: LocalDate): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function formatLocalDate(date: LocalDate, options: { weekday?: boolean } = {}): string {
  return localDateToDate(date).toLocaleDateString(undefined, {
    ...(options.weekday ? { weekday: 'short' } : {}),
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** "Today at 8:00 AM", "Tomorrow at 8:00 PM", or "Mon, Oct 5 at 8:00 AM". */
export function formatDateTime(instant: UtcIso, now: Date = new Date()): string {
  const date = new Date(instant);
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const day = localDateOf(date);
  const today = localDateOf(now);
  if (day === today) return `Today at ${time}`;
  if (day === addDays(today, 1)) return `Tomorrow at ${time}`;
  if (day === addDays(today, -1)) return `Yesterday at ${time}`;
  const label = date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  return `${label} at ${time}`;
}

function joinTimes(times: readonly LocalTime[]): string {
  return times.map(formatTime).join(', ');
}

type ScheduleShape = Pick<Schedule, 'type' | 'times' | 'daysOfWeek' | 'intervalDays'>;

/** One-line, screen-reader-friendly description such as "Every day at 8:00 AM, 8:00 PM". */
export function describeSchedule(schedule: ScheduleShape): string {
  const at = schedule.times.length > 0 ? ` at ${joinTimes(schedule.times)}` : '';
  switch (schedule.type) {
    case 'daily':
      return `Every day${at}`;
    case 'weekdays': {
      const days = (schedule.daysOfWeek ?? []).map((d) => DAY_NAMES[d]);
      return `${days.join(', ')}${at}`;
    }
    case 'interval': {
      const n = schedule.intervalDays ?? 1;
      return `${n === 1 ? 'Every day' : `Every ${n} days`}${at}`;
    }
    case 'as_needed':
      return 'Only when needed';
  }
}

/** "8:05 AM" for an instant, in the device's time zone. */
export function formatClock(value: Date | UtcIso): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
