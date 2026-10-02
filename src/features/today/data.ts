import {
  listActiveSchedulesInRange,
  listDoseLogsInRange,
  listMedications,
} from '@/db/repositories';
import type { Database } from '@/db/types';
import { markMissedDoses } from '@/features/doses/missed';
import {
  buildAsNeeded,
  buildTimeline,
  groupDoses,
  type AsNeededEntry,
  type DoseGroup,
  type TimelineDose,
} from '@/features/doses/timeline';
import { getSettings, type AppSettings } from '@/features/settings/settings';
import { localDateOf, localDayRangeUtc, type LocalDate } from '@/lib/time';

export interface TodayData {
  date: LocalDate;
  doses: TimelineDose[];
  groups: DoseGroup[];
  asNeeded: AsNeededEntry[];
  settings: AppSettings;
  /** Doses done (taken or skipped) out of those scheduled today. */
  done: number;
  now: Date;
}

/**
 * Loads today's screen. First records any doses whose missed window has elapsed, so what is shown
 * always matches what is stored.
 */
export async function loadToday(db: Database, now: Date = new Date()): Promise<TodayData> {
  const settings = await getSettings(db);
  await markMissedDoses(db, now, settings.missedAfterMinutes);

  const date = localDateOf(now);
  const { from, to } = localDayRangeUtc(date);
  const [schedules, logs, medications] = await Promise.all([
    listActiveSchedulesInRange(db, date, date),
    listDoseLogsInRange(db, from, to),
    listMedications(db, { activeOnly: true }),
  ]);
  const byId = new Map(medications.map((m) => [m.id, m]));

  const doses = buildTimeline({
    medications: byId,
    schedules,
    logs,
    date,
    now,
    missedAfterMinutes: settings.missedAfterMinutes,
  });
  return {
    date,
    doses,
    groups: groupDoses(doses, settings.groupBy),
    asNeeded: buildAsNeeded({ medications: byId, schedules, logs }),
    settings,
    done: doses.filter((d) => d.status === 'taken' || d.status === 'skipped').length,
    now,
  };
}

export const loadTodayNow = (db: Database) => loadToday(db, new Date());
