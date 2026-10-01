import {
  createMedication,
  createSchedule,
  listRecentDoseLogs,
  updateSchedule,
} from '@/db/repositories';
import type { Database } from '@/db/types';
import { skipDose, snoozeDose, takeDose } from '@/features/doses/doseActions';
import { markMissedDoses } from '@/features/doses/missed';
import { FakePort } from '../helpers/fakePort';
import { createTestDb } from '../helpers/testDb';

const CREATED = new Date(2026, 5, 1, 0, 0);
let db: Database;
let port: FakePort;
let medId: number;
let nowSpy: jest.SpyInstance;

const statuses = async () =>
  (await listRecentDoseLogs(db, medId))
    .map((l) => `${new Date(l.scheduledFor).getDate()}:${l.status}`)
    .reverse();
const at = (day: number, h: number, m = 0) => new Date(2026, 5, day, h, m);

beforeEach(async () => {
  nowSpy = jest.spyOn(Date, 'now').mockReturnValue(CREATED.getTime());
  db = await createTestDb();
  port = new FakePort();
  medId = (
    await createMedication(db, {
      name: 'Metformin',
      dosageAmount: 500,
      dosageUnit: 'mg',
      form: 'tablet',
    })
  ).id;
  await createSchedule(db, {
    medicationId: medId,
    type: 'daily',
    times: ['08:00'],
    startDate: '2026-06-01',
    doseQuantity: 1,
  });
});

afterEach(() => nowSpy.mockRestore());

describe('markMissedDoses', () => {
  it('marks a dose missed only once the window has elapsed', async () => {
    expect(await markMissedDoses(db, at(10, 9, 59), 120)).toBe(7); // Jun 3..9; today not yet
    expect(await markMissedDoses(db, at(10, 10, 0), 120)).toBe(1);
    expect((await statuses()).at(-1)).toBe('10:missed');
  });

  it('uses the configured window', async () => {
    expect(await markMissedDoses(db, at(10, 8, 40), 30)).toBe(8);
    nowSpy.mockRestore();
  });

  it('is idempotent', async () => {
    await markMissedDoses(db, at(10, 12), 120);
    expect(await markMissedDoses(db, at(10, 12), 120)).toBe(0);
  });

  it('never overwrites a taken or skipped dose', async () => {
    const dep = (d: Date) => ({ db, port, now: () => d });
    const day = (n: number) => ({
      medicationId: medId,
      scheduledFor: at(n, 8).toISOString(),
      quantity: 1,
    });
    await takeDose(dep(at(9, 8, 5)), day(9));
    await skipDose(dep(at(8, 8, 5)), day(8));
    await markMissedDoses(db, at(10, 12), 120);
    const s = await statuses();
    expect(s).toContain('9:taken');
    expect(s).toContain('8:skipped');
    expect(s).toContain('7:missed');
  });

  it('turns an expired snooze into missed', async () => {
    await snoozeDose(
      { db, port, now: () => at(10, 8, 5) },
      { medicationId: medId, scheduledFor: at(10, 8).toISOString(), quantity: 1 },
      { title: 't', body: 'b' },
    );
    await markMissedDoses(db, at(10, 10, 5), 120);
    expect((await statuses()).at(-1)).toBe('10:missed');
  });

  it('looks back only a limited number of days', async () => {
    expect(await markMissedDoses(db, at(10, 12), 120, 2)).toBe(3); // Jun 8, 9, 10
  });

  it('ignores doses from before the schedule was last edited', async () => {
    nowSpy.mockReturnValue(at(10, 9).getTime());
    const [{ id }] = await db.getAllAsync<{ id: number }>('SELECT id FROM schedules');
    await updateSchedule(db, id, { times: ['08:00', '09:30'] });
    await markMissedDoses(db, at(10, 12), 120);
    const s = await statuses();
    expect(s.filter((x) => x.startsWith('10:'))).toEqual(['10:missed']); // 09:30 only; not the 08:00 edit gap
    // Earlier unlogged days are not back-filled after an edit either.
    expect(await listRecentDoseLogs(db, medId, 100)).toHaveLength(1);
  });

  it('does nothing when there are no schedules', async () => {
    const empty = await createTestDb();
    expect(await markMissedDoses(empty, at(10, 12), 120)).toBe(0);
  });
});
