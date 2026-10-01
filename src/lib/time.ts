/**
 * Time conventions
 *
 * - Instants (createdAt, scheduledFor, actedAt, ...) are stored as canonical UTC ISO-8601 strings
 *   with milliseconds (`2026-10-01T14:30:00.000Z`). Canonical form sorts lexicographically.
 * - Schedules are expressed in the user's wall-clock terms: a `LocalDate` (`YYYY-MM-DD`) and
 *   `LocalTime` (`HH:mm`) with no zone, so "8:00" stays 8:00 when the user travels or DST changes.
 *   They are converted to UTC instants only when a concrete dose is generated.
 */
export type UtcIso = string;
export type LocalDate = string;
export type LocalTime = string;

const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MS_PER_DAY = 86_400_000;

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

export function nowUtc(): UtcIso {
  return new Date(Date.now()).toISOString();
}

/** Parses a Date or an ISO-8601 string (with `Z` or an offset) into canonical UTC form. */
export function toUtcIso(value: Date | string): UtcIso {
  if (typeof value === 'string' && !/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    throw new RangeError(`Expected an ISO-8601 datetime, got "${value}"`);
  }
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`Invalid datetime: "${String(value)}"`);
  }
  return date.toISOString();
}

export function isLocalDate(value: string): boolean {
  const m = LOCAL_DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

export function assertLocalDate(value: string, label = 'date'): LocalDate {
  if (!isLocalDate(value))
    throw new RangeError(`Invalid ${label} "${value}" (expected YYYY-MM-DD)`);
  return value;
}

export function isLocalTime(value: string): boolean {
  return LOCAL_TIME.test(value);
}

export function assertLocalTime(value: string, label = 'time'): LocalTime {
  if (!isLocalTime(value)) throw new RangeError(`Invalid ${label} "${value}" (expected HH:mm)`);
  return value;
}

/**
 * Parses what a person types into a time field: `8`, `8:30`, `8:30 pm`, `8pm`, `20:30`.
 * Without am/pm the hour is read as 24-hour. Returns `null` when it isn't a valid time.
 */
export function parseTimeInput(text: string): LocalTime | null {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m?\.?$|^(\d{1,2})(?::(\d{2}))?$/i.exec(text.trim());
  if (!m) return null;
  const meridiem = m[3]?.toLowerCase();
  let hour = Number(m[1] ?? m[4]);
  const minute = Number(m[2] ?? m[5] ?? 0);
  if (minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (meridiem === 'p' ? 12 : 0);
  } else if (hour > 23) {
    return null;
  }
  return `${pad(hour)}:${pad(minute)}`;
}

/** The calendar date of `date` in the device's local time zone. */
export function localDateOf(date: Date): LocalDate {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function utcMidnight(date: LocalDate): number {
  const [y, m, d] = assertLocalDate(date).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Calendar arithmetic; immune to DST because it never touches local time. */
export function addDays(date: LocalDate, days: number): LocalDate {
  const d = new Date(utcMidnight(date) + days * MS_PER_DAY);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Whole days from `from` to `to` (negative if `to` is earlier). */
export function diffDays(from: LocalDate, to: LocalDate): number {
  return Math.round((utcMidnight(to) - utcMidnight(from)) / MS_PER_DAY);
}

/** 0 = Sunday … 6 = Saturday (same as `Date#getDay`). */
export function dayOfWeek(date: LocalDate): number {
  return new Date(utcMidnight(date)).getUTCDay();
}

/**
 * Converts a local wall-clock date + time to a UTC instant using the device's current time zone.
 * Times that don't exist (DST spring-forward gap) resolve to the following valid instant.
 */
export function localToUtc(date: LocalDate, time: LocalTime): UtcIso {
  const [y, mo, d] = assertLocalDate(date).split('-').map(Number);
  const [h, mi] = assertLocalTime(time).split(':').map(Number);
  return new Date(y, mo - 1, d, h, mi).toISOString();
}

/** Half-open UTC range `[from, to)` covering local days `startDate`..`endDate` inclusive. */
export function localDayRangeUtc(
  startDate: LocalDate,
  endDate: LocalDate = startDate,
): { from: UtcIso; to: UtcIso } {
  return { from: localToUtc(startDate, '00:00'), to: localToUtc(addDays(endDate, 1), '00:00') };
}
