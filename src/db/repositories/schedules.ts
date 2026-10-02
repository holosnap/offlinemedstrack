import { NotFoundError } from '../errors';
import { SCHEDULE_TYPES, type Schedule, type ScheduleType } from '../models';
import { buildSet } from '../sql';
import type { Database } from '../types';
import {
  assertLocalDate,
  assertLocalTime,
  nowUtc,
  type LocalDate,
  type LocalTime,
} from '@/lib/time';

interface ScheduleRow {
  id: number;
  medication_id: number;
  type: ScheduleType;
  times: string;
  days_of_week: string | null;
  interval_days: number | null;
  start_date: string;
  end_date: string | null;
  dose_quantity: number;
  created_at: string;
  updated_at: string;
}

export interface NewSchedule {
  medicationId: number;
  type: ScheduleType;
  /** Required (non-empty) for daily / weekdays / interval; ignored for as_needed. */
  times?: LocalTime[];
  /** Required (non-empty, 0 = Sunday … 6 = Saturday) for weekdays. */
  daysOfWeek?: number[];
  /** Required (>= 1) for interval. */
  intervalDays?: number;
  startDate: LocalDate;
  endDate?: LocalDate | null;
  doseQuantity: number;
}

export type ScheduleUpdate = Partial<Omit<NewSchedule, 'medicationId'>>;

function toSchedule(row: ScheduleRow): Schedule {
  return {
    id: row.id,
    medicationId: row.medication_id,
    type: row.type,
    times: JSON.parse(row.times) as LocalTime[],
    daysOfWeek: row.days_of_week === null ? null : (JSON.parse(row.days_of_week) as number[]),
    intervalDays: row.interval_days,
    startDate: row.start_date,
    endDate: row.end_date,
    doseQuantity: row.dose_quantity,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Checks the whole schedule and returns it in normalized form (sorted, de-duplicated times). */
function normalize(s: Omit<NewSchedule, 'medicationId'>) {
  if (!SCHEDULE_TYPES.includes(s.type)) throw new RangeError(`Invalid schedule type "${s.type}"`);
  assertLocalDate(s.startDate, 'start date');
  if (s.endDate != null) {
    assertLocalDate(s.endDate, 'end date');
    if (s.endDate < s.startDate) throw new RangeError('End date is before start date');
  }
  if (!(s.doseQuantity > 0)) throw new RangeError('Dose quantity must be greater than 0');

  const times =
    s.type === 'as_needed'
      ? []
      : [...new Set((s.times ?? []).map((t) => assertLocalTime(t)))].sort();
  if (s.type !== 'as_needed' && times.length === 0) {
    throw new RangeError(`A ${s.type} schedule needs at least one time of day`);
  }

  let daysOfWeek: number[] | null = null;
  if (s.type === 'weekdays') {
    const days = [...new Set(s.daysOfWeek ?? [])].sort();
    if (days.length === 0 || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
      throw new RangeError('A weekdays schedule needs days of week between 0 and 6');
    }
    daysOfWeek = days;
  }

  let intervalDays: number | null = null;
  if (s.type === 'interval') {
    if (!Number.isInteger(s.intervalDays) || (s.intervalDays ?? 0) < 1) {
      throw new RangeError('An interval schedule needs intervalDays >= 1');
    }
    intervalDays = s.intervalDays ?? null;
  }

  return { ...s, times, daysOfWeek, intervalDays, endDate: s.endDate ?? null };
}

export async function createSchedule(db: Database, input: NewSchedule): Promise<Schedule> {
  const s = normalize(input);
  const now = nowUtc();
  const result = await db.runAsync(
    `INSERT INTO schedules
       (medication_id, type, times, days_of_week, interval_days, start_date, end_date,
        dose_quantity, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.medicationId,
      s.type,
      JSON.stringify(s.times),
      s.daysOfWeek === null ? null : JSON.stringify(s.daysOfWeek),
      s.intervalDays,
      s.startDate,
      s.endDate,
      s.doseQuantity,
      now,
      now,
    ],
  );
  return getScheduleOrThrow(db, result.lastInsertRowId);
}

export async function getSchedule(db: Database, id: number): Promise<Schedule | null> {
  const row = await db.getFirstAsync<ScheduleRow>('SELECT * FROM schedules WHERE id = ?', [id]);
  return row ? toSchedule(row) : null;
}

async function getScheduleOrThrow(db: Database, id: number): Promise<Schedule> {
  const schedule = await getSchedule(db, id);
  if (!schedule) throw new NotFoundError('Schedule', id);
  return schedule;
}

export async function listSchedulesForMedication(
  db: Database,
  medicationId: number,
): Promise<Schedule[]> {
  const rows = await db.getAllAsync<ScheduleRow>(
    'SELECT * FROM schedules WHERE medication_id = ? ORDER BY start_date, id',
    [medicationId],
  );
  return rows.map(toSchedule);
}

/**
 * Schedules of active medications that overlap the local date range `[startDate, endDate]`.
 * This is the input for expanding schedules into concrete doses.
 */
export async function listActiveSchedulesInRange(
  db: Database,
  startDate: LocalDate,
  endDate: LocalDate = startDate,
): Promise<Schedule[]> {
  const rows = await db.getAllAsync<ScheduleRow>(
    `SELECT s.* FROM schedules s
       JOIN medications m ON m.id = s.medication_id
      WHERE m.active = 1
        AND s.start_date <= ?
        AND (s.end_date IS NULL OR s.end_date >= ?)
      ORDER BY s.medication_id, s.id`,
    [endDate, startDate],
  );
  return rows.map(toSchedule);
}

/** Updates a schedule; the merged result is re-validated as a whole (e.g. changing `type`). */
export async function updateSchedule(
  db: Database,
  id: number,
  patch: ScheduleUpdate,
): Promise<Schedule> {
  const existing = await getScheduleOrThrow(db, id);
  const s = normalize({
    type: patch.type ?? existing.type,
    times: patch.times ?? existing.times,
    daysOfWeek: patch.daysOfWeek ?? existing.daysOfWeek ?? undefined,
    intervalDays: patch.intervalDays ?? existing.intervalDays ?? undefined,
    startDate: patch.startDate ?? existing.startDate,
    endDate: patch.endDate === undefined ? existing.endDate : patch.endDate,
    doseQuantity: patch.doseQuantity ?? existing.doseQuantity,
  });
  const timingChanged =
    s.type !== existing.type ||
    JSON.stringify(s.times) !== JSON.stringify(existing.times) ||
    JSON.stringify(s.daysOfWeek) !== JSON.stringify(existing.daysOfWeek) ||
    s.intervalDays !== existing.intervalDays ||
    s.startDate !== existing.startDate;
  const { clause, params } = buildSet({
    type: s.type,
    times: JSON.stringify(s.times),
    days_of_week: s.daysOfWeek === null ? null : JSON.stringify(s.daysOfWeek),
    interval_days: s.intervalDays,
    start_date: s.startDate,
    end_date: s.endDate,
    dose_quantity: s.doseQuantity,
    // `updated_at` marks when the dose times last changed: doses before it are not expected (see
    // `isMissed`). Changing only the quantity or end date must not hide earlier doses today.
    updated_at: timingChanged ? nowUtc() : existing.updatedAt,
  });
  await db.runAsync(`UPDATE schedules SET ${clause} WHERE id = ?`, [...params, id]);
  return getScheduleOrThrow(db, id);
}

export async function deleteSchedule(db: Database, id: number): Promise<void> {
  const result = await db.runAsync('DELETE FROM schedules WHERE id = ?', [id]);
  if (result.changes === 0) throw new NotFoundError('Schedule', id);
}
