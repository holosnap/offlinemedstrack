import { listSettings, setSetting } from '@/db/repositories';
import type { Database } from '@/db/types';

export const GROUP_BY_VALUES = ['period', 'time'] as const;
export type GroupBy = (typeof GROUP_BY_VALUES)[number];

export interface AppSettings {
  /** A dose with no action this long after its scheduled time is marked missed. */
  missedAfterMinutes: number;
  /** Group today's doses by time of day (morning/afternoon/evening) or by exact time. */
  groupBy: GroupBy;
}

export const MISSED_AFTER_CHOICES = [30, 60, 120, 180, 240] as const;

export const DEFAULT_SETTINGS: AppSettings = { missedAfterMinutes: 120, groupBy: 'period' };

const MIN_MISSED_MINUTES = 5;
const MAX_MISSED_MINUTES = 24 * 60;

/** Reads settings, falling back to defaults for anything missing or invalid. */
export async function getSettings(db: Database): Promise<AppSettings> {
  const raw = await listSettings(db);
  const minutes = Number(raw.missedAfterMinutes);
  const groupBy = GROUP_BY_VALUES.find((v) => v === raw.groupBy);
  return {
    missedAfterMinutes:
      Number.isInteger(minutes) && minutes >= MIN_MISSED_MINUTES && minutes <= MAX_MISSED_MINUTES
        ? minutes
        : DEFAULT_SETTINGS.missedAfterMinutes,
    groupBy: groupBy ?? DEFAULT_SETTINGS.groupBy,
  };
}

export async function updateSettings(db: Database, patch: Partial<AppSettings>): Promise<void> {
  if (patch.missedAfterMinutes !== undefined) {
    const m = patch.missedAfterMinutes;
    if (!Number.isInteger(m) || m < MIN_MISSED_MINUTES || m > MAX_MISSED_MINUTES) {
      throw new RangeError('Missed window must be between 5 minutes and 24 hours');
    }
    await setSetting(db, 'missedAfterMinutes', String(m));
  }
  if (patch.groupBy !== undefined) await setSetting(db, 'groupBy', patch.groupBy);
}

export function describeMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours} ${hours === 1 ? 'hour' : 'hours'}` : `${minutes} min`;
}
