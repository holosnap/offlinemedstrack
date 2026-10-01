import { NotFoundError } from '../errors';
import { DOSE_STATUSES, type DoseLog, type DoseStatus } from '../models';
import { buildSet } from '../sql';
import type { Database, SqlValue } from '../types';
import { scheduleOccursOn } from '@/lib/schedule';
import {
  addDays,
  localDateOf,
  localDayRangeUtc,
  localToUtc,
  nowUtc,
  toUtcIso,
  type LocalDate,
  type UtcIso,
} from '@/lib/time';
import { listActiveSchedulesInRange } from './schedules';

interface DoseLogRow {
  id: number;
  medication_id: number;
  scheduled_for: string;
  status: DoseStatus;
  acted_at: string | null;
  quantity: number | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface NewDoseLog {
  medicationId: number;
  scheduledFor: Date | string;
  status: DoseStatus;
  /** Defaults to now, except for `missed` (nobody acted) where it defaults to null. */
  actedAt?: Date | string | null;
  quantity?: number | null;
  note?: string | null;
}

export type DoseLogUpdate = Partial<Omit<NewDoseLog, 'medicationId' | 'scheduledFor'>>;

/** One planned dose generated from a schedule, with its log if the user has acted on it. */
export interface ScheduledDose {
  medicationId: number;
  scheduleId: number;
  scheduledFor: UtcIso;
  quantity: number;
  log: DoseLog | null;
}

const toDoseLog = (row: DoseLogRow): DoseLog => ({
  id: row.id,
  medicationId: row.medication_id,
  scheduledFor: row.scheduled_for,
  status: row.status,
  actedAt: row.acted_at,
  quantity: row.quantity,
  note: row.note,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const optionalUtc = (value: Date | string | null | undefined): string | null | undefined =>
  value == null ? (value as null | undefined) : toUtcIso(value);

function validate(status: DoseStatus | undefined, quantity: number | null | undefined): void {
  if (status !== undefined && !DOSE_STATUSES.includes(status)) {
    throw new RangeError(`Invalid dose status "${status}"`);
  }
  if (quantity != null && !(quantity >= 0)) throw new RangeError('Quantity cannot be negative');
}

export async function createDoseLog(db: Database, input: NewDoseLog): Promise<DoseLog> {
  validate(input.status, input.quantity);
  const now = nowUtc();
  const actedAt =
    input.actedAt !== undefined
      ? optionalUtc(input.actedAt)
      : input.status === 'missed'
        ? null
        : now;
  const result = await db.runAsync(
    `INSERT INTO dose_logs
       (medication_id, scheduled_for, status, acted_at, quantity, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.medicationId,
      toUtcIso(input.scheduledFor),
      input.status,
      actedAt ?? null,
      input.quantity ?? null,
      input.note ?? null,
      now,
      now,
    ],
  );
  return getDoseLogOrThrow(db, result.lastInsertRowId);
}

/**
 * Records the outcome for a scheduled dose, replacing any earlier log for the same
 * medication + scheduledFor (e.g. snoozed → taken). Safe to call repeatedly.
 */
export async function recordDose(db: Database, input: NewDoseLog): Promise<DoseLog> {
  validate(input.status, input.quantity);
  const now = nowUtc();
  const scheduledFor = toUtcIso(input.scheduledFor);
  const actedAt =
    input.actedAt !== undefined
      ? optionalUtc(input.actedAt)
      : input.status === 'missed'
        ? null
        : now;
  await db.runAsync(
    `INSERT INTO dose_logs
       (medication_id, scheduled_for, status, acted_at, quantity, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (medication_id, scheduled_for) DO UPDATE SET
       status = excluded.status,
       acted_at = excluded.acted_at,
       quantity = excluded.quantity,
       note = excluded.note,
       updated_at = excluded.updated_at`,
    [
      input.medicationId,
      scheduledFor,
      input.status,
      actedAt ?? null,
      input.quantity ?? null,
      input.note ?? null,
      now,
      now,
    ],
  );
  const row = await db.getFirstAsync<DoseLogRow>(
    'SELECT * FROM dose_logs WHERE medication_id = ? AND scheduled_for = ?',
    [input.medicationId, scheduledFor],
  );
  if (!row) throw new NotFoundError('DoseLog', `${input.medicationId}@${scheduledFor}`);
  return toDoseLog(row);
}

export async function getDoseLog(db: Database, id: number): Promise<DoseLog | null> {
  const row = await db.getFirstAsync<DoseLogRow>('SELECT * FROM dose_logs WHERE id = ?', [id]);
  return row ? toDoseLog(row) : null;
}

async function getDoseLogOrThrow(db: Database, id: number): Promise<DoseLog> {
  const log = await getDoseLog(db, id);
  if (!log) throw new NotFoundError('DoseLog', id);
  return log;
}

/**
 * Logs whose `scheduledFor` falls in the half-open UTC range `[from, to)`, oldest first.
 * To query by local days, use `localDayRangeUtc` from `@/lib/time`.
 */
export async function listDoseLogsInRange(
  db: Database,
  from: Date | string,
  to: Date | string,
  options: { medicationId?: number; status?: DoseStatus } = {},
): Promise<DoseLog[]> {
  const where = ['scheduled_for >= ?', 'scheduled_for < ?'];
  const params: SqlValue[] = [toUtcIso(from), toUtcIso(to)];
  if (options.medicationId !== undefined) {
    where.push('medication_id = ?');
    params.push(options.medicationId);
  }
  if (options.status !== undefined) {
    where.push('status = ?');
    params.push(options.status);
  }
  const rows = await db.getAllAsync<DoseLogRow>(
    `SELECT * FROM dose_logs WHERE ${where.join(' AND ')} ORDER BY scheduled_for, id`,
    params,
  );
  return rows.map(toDoseLog);
}

export async function updateDoseLog(
  db: Database,
  id: number,
  patch: DoseLogUpdate,
): Promise<DoseLog> {
  validate(patch.status, patch.quantity);
  const { clause, params } = buildSet({
    status: patch.status,
    acted_at: optionalUtc(patch.actedAt),
    quantity: patch.quantity,
    note: patch.note,
    updated_at: nowUtc(),
  });
  const result = await db.runAsync(`UPDATE dose_logs SET ${clause} WHERE id = ?`, [...params, id]);
  if (result.changes === 0) throw new NotFoundError('DoseLog', id);
  return getDoseLogOrThrow(db, id);
}

export async function deleteDoseLog(db: Database, id: number): Promise<void> {
  const result = await db.runAsync('DELETE FROM dose_logs WHERE id = ?', [id]);
  if (result.changes === 0) throw new NotFoundError('DoseLog', id);
}

/**
 * Expands the schedules of active medications into concrete doses for the local days
 * `startDate`..`endDate` (inclusive), attaching any existing log. As-needed schedules produce no
 * planned doses. Sorted by time, then medication. Times are converted using the device's current
 * time zone.
 */
export async function listScheduledDoses(
  db: Database,
  startDate: LocalDate,
  endDate: LocalDate = startDate,
): Promise<ScheduledDose[]> {
  const schedules = await listActiveSchedulesInRange(db, startDate, endDate);
  const { from, to } = localDayRangeUtc(startDate, endDate);
  const logs = await listDoseLogsInRange(db, from, to);
  const logByKey = new Map(logs.map((l) => [`${l.medicationId}|${l.scheduledFor}`, l]));

  const doses: ScheduledDose[] = [];
  for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
    for (const schedule of schedules) {
      if (!scheduleOccursOn(schedule, date)) continue;
      for (const time of schedule.times) {
        const scheduledFor = localToUtc(date, time);
        doses.push({
          medicationId: schedule.medicationId,
          scheduleId: schedule.id,
          scheduledFor,
          quantity: schedule.doseQuantity,
          log: logByKey.get(`${schedule.medicationId}|${scheduledFor}`) ?? null,
        });
      }
    }
  }
  return doses.sort(
    (a, b) => a.scheduledFor.localeCompare(b.scheduledFor) || a.medicationId - b.medicationId,
  );
}

/** Today's planned doses (local calendar day of `now`). */
export function listTodaysDoses(db: Database, now: Date = new Date()): Promise<ScheduledDose[]> {
  return listScheduledDoses(db, localDateOf(now));
}
