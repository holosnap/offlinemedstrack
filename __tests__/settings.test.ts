import type { Database } from '@/db/types';
import {
  DEFAULT_SETTINGS,
  DEVICE_ONLY_SETTINGS,
  describeMinutes,
  getSettings,
  parseSettings,
  updateSettings,
} from '@/features/settings/settings';
import { BACKUP_SETTING_KEYS } from '@/db/backup';
import { createTestDb } from './helpers/testDb';

let db: Database;
beforeEach(async () => {
  db = await createTestDb();
});

describe('settings', () => {
  it('has sensible defaults', async () => {
    expect(await getSettings(db)).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS).toEqual({
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
    });
  });

  it('persists every setting', async () => {
    const changes = {
      missedAfterMinutes: 60,
      snoozeMinutes: 15,
      refillThresholdValue: 14,
      refillThresholdUnit: 'count',
      soundEnabled: false,
      timeFormat: '24h',
      theme: 'dark',
      groupBy: 'time',
      appLock: true,
      onboardingComplete: true,
    } as const;
    await updateSettings(db, changes);
    expect(await getSettings(db)).toEqual(changes);
    await updateSettings(db, { soundEnabled: true });
    expect((await getSettings(db)).soundEnabled).toBe(true);
    expect((await getSettings(db)).snoozeMinutes).toBe(15);
  });

  it('rejects invalid values', async () => {
    await expect(updateSettings(db, { missedAfterMinutes: 0 })).rejects.toThrow(RangeError);
    await expect(updateSettings(db, { missedAfterMinutes: 90.5 })).rejects.toThrow(RangeError);
    await expect(updateSettings(db, { snoozeMinutes: 0 })).rejects.toThrow(RangeError);
    await expect(updateSettings(db, { snoozeMinutes: 100_000 })).rejects.toThrow(RangeError);
    await expect(updateSettings(db, { refillThresholdValue: 0 })).rejects.toThrow(RangeError);
    await expect(updateSettings(db, { theme: 'neon' as unknown as 'dark' })).rejects.toThrow(
      RangeError,
    );
    await expect(updateSettings(db, { timeFormat: '48h' as unknown as '24h' })).rejects.toThrow(
      RangeError,
    );
    expect(await getSettings(db)).toEqual(DEFAULT_SETTINGS);
  });

  it('ignores corrupt stored values', () => {
    expect(
      parseSettings({
        missedAfterMinutes: 'abc',
        snoozeMinutes: '-3',
        refillThresholdValue: 'x',
        refillThresholdUnit: 'weeks',
        soundEnabled: 'maybe',
        timeFormat: '48h',
        theme: 'neon',
        groupBy: 'weird',
        appLock: '1',
        onboardingComplete: 'yes',
      }),
    ).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps device-specific settings out of backups', () => {
    for (const key of DEVICE_ONLY_SETTINGS) {
      expect(BACKUP_SETTING_KEYS as readonly string[]).not.toContain(key);
    }
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      const portable = (BACKUP_SETTING_KEYS as readonly string[]).includes(key);
      expect(portable).toBe(!(DEVICE_ONLY_SETTINGS as readonly string[]).includes(key));
    }
  });

  it('describes durations', () => {
    expect(describeMinutes(30)).toBe('30 min');
    expect(describeMinutes(60)).toBe('1 hour');
    expect(describeMinutes(120)).toBe('2 hours');
  });
});
