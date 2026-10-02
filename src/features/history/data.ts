import {
  listDoseLogsInRange,
  listInventory,
  listMedications,
  listSchedulesForMedication,
} from '@/db/repositories';
import type { Medication, Schedule } from '@/db/models';
import type { Database } from '@/db/types';
import { getSettings } from '@/features/settings/settings';
import { addDays, localDateOf, localDayRangeUtc, type LocalDate } from '@/lib/time';
import {
  ADHERENCE_WINDOWS,
  adherenceByMedication,
  buildDayStats,
  type DayStats,
  type MedicationAdherence,
} from './adherence';
import { firstOfMonth, lastOfMonth, type MonthRef } from './calendar';

export interface HistoryData {
  month: MonthRef;
  today: LocalDate;
  /** Day records for the visible month and the last 90 days. */
  days: Map<LocalDate, DayStats>;
  adherence: MedicationAdherence[];
  medications: Medication[];
  /** Active as-needed medications, for backfilling doses. */
  asNeededMedications: Medication[];
  /** What each medication's supply is counted in (e.g. "tablets"). */
  units: Map<number, string>;
}

const longestWindow = Math.max(...ADHERENCE_WINDOWS);

async function loadSchedules(
  db: Database,
  medications: readonly Medication[],
): Promise<Schedule[]> {
  const lists = await Promise.all(medications.map((m) => listSchedulesForMedication(db, m.id)));
  return lists.flat();
}

/** Loads what the History tab shows for `month`: day records plus 7/30/90-day adherence. */
export async function loadHistory(
  db: Database,
  month: MonthRef,
  now: Date = new Date(),
): Promise<HistoryData> {
  const today = localDateOf(now);
  const windowStart = addDays(today, -(longestWindow - 1));
  const monthStart = firstOfMonth(month);
  const monthEnd = lastOfMonth(month);
  const from = monthStart < windowStart ? monthStart : windowStart;
  const to = monthEnd > today ? monthEnd : today;

  const [settings, medications] = await Promise.all([getSettings(db), listMedications(db)]);
  const schedules = await loadSchedules(db, medications);
  const inventory = await listInventory(db);
  const range = localDayRangeUtc(from, to);
  const logs = await listDoseLogsInRange(db, range.from, range.to);
  const days = buildDayStats({
    medications,
    schedules,
    logs,
    from,
    to,
    now,
    missedAfterMinutes: settings.missedAfterMinutes,
  });
  return {
    units: new Map(inventory.map((i) => [i.medicationId, i.unit])),
    month,
    today,
    days,
    adherence: adherenceByMedication(days, medications, schedules, today),
    medications,
    asNeededMedications: medications.filter((m) => {
      const own = schedules.filter((s) => s.medicationId === m.id);
      return m.active && own.length > 0 && own.every((s) => s.type === 'as_needed');
    }),
  };
}

/** Day records for an arbitrary range (used by export). */
export async function loadDayStats(
  db: Database,
  from: LocalDate,
  to: LocalDate,
  now: Date = new Date(),
): Promise<{ days: DayStats[]; medications: Medication[] }> {
  const [settings, medications] = await Promise.all([getSettings(db), listMedications(db)]);
  const schedules = await loadSchedules(db, medications);
  const range = localDayRangeUtc(from, to);
  const logs = await listDoseLogsInRange(db, range.from, range.to);
  const days = buildDayStats({
    medications,
    schedules,
    logs,
    from,
    to,
    now,
    missedAfterMinutes: settings.missedAfterMinutes,
  });
  return { days: [...days.values()], medications };
}

/** The local date of the earliest logged dose, or null when nothing is logged. */
export async function earliestLogDate(db: Database): Promise<LocalDate | null> {
  const row = await db.getFirstAsync<{ first: string | null }>(
    'SELECT MIN(scheduled_for) AS first FROM dose_logs',
  );
  return row?.first ? localDateOf(new Date(row.first)) : null;
}

export const loadHistoryFor = (month: MonthRef) => (db: Database) =>
  loadHistory(db, month, new Date());
