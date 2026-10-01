import type { Database } from '@/db/types';
import {
  DEFAULT_SETTINGS,
  describeMinutes,
  getSettings,
  updateSettings,
} from '@/features/settings/settings';
import { createTestDb } from './helpers/testDb';

let db: Database;
beforeEach(async () => {
  db = await createTestDb();
});

describe('settings', () => {
  it('defaults to a two hour missed window, grouped by time of day', async () => {
    expect(await getSettings(db)).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS).toEqual({ missedAfterMinutes: 120, groupBy: 'period' });
  });

  it('persists changes', async () => {
    await updateSettings(db, { missedAfterMinutes: 60, groupBy: 'time' });
    expect(await getSettings(db)).toEqual({ missedAfterMinutes: 60, groupBy: 'time' });
    await updateSettings(db, { missedAfterMinutes: 180 });
    expect(await getSettings(db)).toEqual({ missedAfterMinutes: 180, groupBy: 'time' });
  });

  it('rejects an out-of-range window and ignores corrupt stored values', async () => {
    await expect(updateSettings(db, { missedAfterMinutes: 0 })).rejects.toThrow(RangeError);
    await expect(updateSettings(db, { missedAfterMinutes: 90.5 })).rejects.toThrow(RangeError);
    await db.runAsync("INSERT INTO settings (key, value) VALUES ('missedAfterMinutes', 'abc')");
    await db.runAsync("INSERT INTO settings (key, value) VALUES ('groupBy', 'weird')");
    expect(await getSettings(db)).toEqual(DEFAULT_SETTINGS);
  });

  it('describes durations', () => {
    expect(describeMinutes(30)).toBe('30 min');
    expect(describeMinutes(60)).toBe('1 hour');
    expect(describeMinutes(120)).toBe('2 hours');
  });
});
