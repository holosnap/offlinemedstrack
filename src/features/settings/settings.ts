import { listSettings, setSetting } from '@/db/repositories';
import type { Database } from '@/db/types';

export const GROUP_BY_VALUES = ['period', 'time'] as const;
export type GroupBy = (typeof GROUP_BY_VALUES)[number];

export const TIME_FORMATS = ['system', '12h', '24h'] as const;
export type TimeFormat = (typeof TIME_FORMATS)[number];

export const THEMES = ['system', 'light', 'dark'] as const;
export type ThemePreference = (typeof THEMES)[number];

export const REFILL_THRESHOLD_UNITS = ['days', 'count'] as const;
export type ThresholdUnit = (typeof REFILL_THRESHOLD_UNITS)[number];

export interface AppSettings {
  /** A dose with no action this long after its scheduled time is marked missed. */
  missedAfterMinutes: number;
  /** How long "Snooze" delays a reminder. */
  snoozeMinutes: number;
  /** Default "warn me when supply is low" level for new medications. */
  refillThresholdValue: number;
  refillThresholdUnit: ThresholdUnit;
  /** Whether reminder notifications play a sound. */
  soundEnabled: boolean;
  timeFormat: TimeFormat;
  theme: ThemePreference;
  /** Group today's doses by time of day (morning/afternoon/evening) or by exact time. */
  groupBy: GroupBy;
  /** Require Face ID / fingerprint / device passcode to open the app. Device-specific. */
  appLock: boolean;
  /** The first-run introduction has been completed. Device-specific. */
  onboardingComplete: boolean;
}

export const MISSED_AFTER_CHOICES = [30, 60, 120, 180, 240] as const;
export const SNOOZE_CHOICES = [5, 10, 15, 30] as const;
export const THRESHOLD_CHOICES: Record<ThresholdUnit, readonly number[]> = {
  days: [3, 5, 7, 10, 14],
  count: [5, 10, 15, 30],
};

export const DEFAULT_SETTINGS: AppSettings = {
  missedAfterMinutes: 120,
  snoozeMinutes: 10,
  refillThresholdValue: 7,
  refillThresholdUnit: 'days',
  soundEnabled: true,
  timeFormat: 'system',
  theme: 'system',
  groupBy: 'period',
  appLock: false,
  onboardingComplete: false,
};

/** Settings that describe this device rather than the person's data: not backed up or restored. */
export const DEVICE_ONLY_SETTINGS = ['appLock', 'onboardingComplete'] as const;

const MIN_MISSED_MINUTES = 5;
const MAX_MISSED_MINUTES = 24 * 60;
const MAX_SNOOZE_MINUTES = 12 * 60;

const intIn = (raw: string | undefined, min: number, max: number, fallback: number) => {
  const n = Number(raw);
  return raw !== undefined && Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};
const oneOf = <T extends string>(values: readonly T[], raw: string | undefined, fallback: T): T =>
  values.find((v) => v === raw) ?? fallback;
const bool = (raw: string | undefined, fallback: boolean) =>
  raw === 'true' ? true : raw === 'false' ? false : fallback;

/** Parses stored key/value rows, falling back to defaults for anything missing or invalid. */
export function parseSettings(raw: Readonly<Record<string, string>>): AppSettings {
  const d = DEFAULT_SETTINGS;
  const threshold = Number(raw.refillThresholdValue);
  return {
    missedAfterMinutes: intIn(
      raw.missedAfterMinutes,
      MIN_MISSED_MINUTES,
      MAX_MISSED_MINUTES,
      d.missedAfterMinutes,
    ),
    snoozeMinutes: intIn(raw.snoozeMinutes, 1, MAX_SNOOZE_MINUTES, d.snoozeMinutes),
    refillThresholdValue:
      Number.isFinite(threshold) && threshold > 0 && threshold <= 365
        ? threshold
        : d.refillThresholdValue,
    refillThresholdUnit: oneOf(
      REFILL_THRESHOLD_UNITS,
      raw.refillThresholdUnit,
      d.refillThresholdUnit,
    ),
    soundEnabled: bool(raw.soundEnabled, d.soundEnabled),
    timeFormat: oneOf(TIME_FORMATS, raw.timeFormat, d.timeFormat),
    theme: oneOf(THEMES, raw.theme, d.theme),
    groupBy: oneOf(GROUP_BY_VALUES, raw.groupBy, d.groupBy),
    appLock: bool(raw.appLock, d.appLock),
    onboardingComplete: bool(raw.onboardingComplete, d.onboardingComplete),
  };
}

export async function getSettings(db: Database): Promise<AppSettings> {
  return parseSettings(await listSettings(db));
}

/** Validates and saves the given settings. */
export async function updateSettings(db: Database, patch: Partial<AppSettings>): Promise<void> {
  const checked = parseSettings(
    Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, String(v)])),
  );
  const entries = Object.entries(patch) as [keyof AppSettings, AppSettings[keyof AppSettings]][];
  for (const [key, value] of entries) {
    if (value === undefined) continue;
    if (key === 'missedAfterMinutes' && checked.missedAfterMinutes !== value) {
      throw new RangeError('Missed window must be between 5 minutes and 24 hours');
    }
    if (key === 'snoozeMinutes' && checked.snoozeMinutes !== value) {
      throw new RangeError('Snooze length must be between 1 minute and 12 hours');
    }
    if (key === 'refillThresholdValue' && checked.refillThresholdValue !== value) {
      throw new RangeError('Refill threshold must be greater than 0');
    }
    if (checked[key] !== value) throw new RangeError(`Invalid value for ${key}`);
    await setSetting(db, key, String(value));
  }
}

export function describeMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours} ${hours === 1 ? 'hour' : 'hours'}` : `${minutes} min`;
}
