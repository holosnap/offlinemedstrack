// Regression tests for bugs found in the codebase review. Each states the correct behavior.
import {
  createInventory,
  createMedication,
  createSchedule,
  deleteMedication,
  getInventory,
  listRecentDoseLogs,
  updateSchedule,
} from '@/db/repositories';
import type { Database } from '@/db/types';
import { skipDose, takeDose, undoDose } from '@/features/doses/doseActions';
import { markMissedDoses } from '@/features/doses/missed';
import { handleNotificationResponse } from '@/features/reminders/actions';
import { ACTION_TAKEN } from '@/features/reminders/constants';
import { reconcile } from '@/features/reminders/reconcile';
import { loadToday } from '@/features/today/data';
import { FakePort } from '../helpers/fakePort';
import { createTestDb } from '../helpers/testDb';

const at = (h: number, m = 0, day = 10) => new Date(2026, 5, day, h, m);
let db: Database;
let port: FakePort;
let medId: number;
let nowSpy: jest.SpyInstance;

async function seed(times = ['08:00'], quantity = 20) {
  nowSpy.mockReturnValue(new Date(2026, 5, 1).getTime());
  medId = (
    await createMedication(db, {
      name: 'Metformin',
      dosageAmount: 500,
      dosageUnit: 'mg',
      form: 'tablet',
    })
  ).id;
  const schedule = await createSchedule(db, {
    medicationId: medId,
    type: 'daily',
    times,
    startDate: '2026-01-01',
    doseQuantity: 1,
  });
  await createInventory(db, { medicationId: medId, currentQuantity: quantity, unit: 'tablets' });
  return schedule;
}

beforeEach(async () => {
  nowSpy = jest.spyOn(Date, 'now');
  db = await createTestDb();
  port = new FakePort();
});
afterEach(() => nowSpy.mockRestore());

describe('editing a schedule mid-day', () => {
  it('does not show a second dose when a logged dose is moved to a new time', async () => {
    const schedule = await seed(['08:00']);
    const now = at(8, 30);
    await takeDose(
      { db, port, now: () => at(8, 10) },
      { medicationId: medId, scheduledFor: at(8).toISOString(), quantity: 1 },
    );
    nowSpy.mockReturnValue(now.getTime());
    await updateSchedule(db, schedule.id, { times: ['09:00'] });

    const today = await loadToday(db, now);
    expect(today.doses.map((d) => [d.time, d.status])).toEqual([['08:00', 'taken']]);

    await reconcile({ db, port, now: () => now, windowDays: 0 });
    expect(port.localTimes()).toEqual([]); // no 09:00 reminder for a dose that was already taken

    await markMissedDoses(db, at(12), 120);
    const logs = await listRecentDoseLogs(db, medId, 20);
    expect(
      logs.filter((l) => new Date(l.scheduledFor).getDate() === 10).map((l) => l.status),
    ).toEqual(['taken']);
  });

  it('still shows the other doses of the day when only some were logged', async () => {
    const schedule = await seed(['08:00', '20:00']);
    await takeDose(
      { db, port, now: () => at(8, 10) },
      { medicationId: medId, scheduledFor: at(8).toISOString(), quantity: 1 },
    );
    nowSpy.mockReturnValue(at(8, 30).getTime());
    await updateSchedule(db, schedule.id, { times: ['09:00', '21:00'] });
    const today = await loadToday(db, at(8, 35));
    expect(today.doses.map((d) => [d.time, d.status])).toEqual([
      ['08:00', 'taken'],
      ['21:00', 'upcoming'],
    ]);
  });

  it('keeps earlier unlogged doses when only the dose quantity changes', async () => {
    const schedule = await seed(['08:00', '12:00', '20:00']);
    nowSpy.mockReturnValue(at(15).getTime());
    await updateSchedule(db, schedule.id, { doseQuantity: 2 });
    const today = await loadToday(db, at(15, 5));
    expect(today.doses.map((d) => d.time)).toEqual(['08:00', '12:00', '20:00']);
  });
});

describe('inventory never goes negative', () => {
  it('stops at zero, reports the shortfall, and undo restores exactly what was used', async () => {
    await seed(['08:00'], 1);
    const ref = { medicationId: medId, scheduledFor: at(8).toISOString(), quantity: 2 };
    const result = await takeDose({ db, port, now: () => at(8, 5) }, ref);
    expect((await getInventory(db, medId))?.currentQuantity).toBe(0);
    expect(result.shortfall).toBe(1);
    await undoDose({ db, port }, ref, result.prior);
    expect((await getInventory(db, medId))?.currentQuantity).toBe(1); // not 2
  });

  it('skipping or changing a short dose never adds supply that was not used', async () => {
    await seed(['08:00'], 1);
    const ref = { medicationId: medId, scheduledFor: at(8).toISOString(), quantity: 2 };
    await takeDose({ db, port, now: () => at(8, 5) }, ref);
    await skipDose({ db, port, now: () => at(8, 6) }, ref);
    expect((await getInventory(db, medId))?.currentQuantity).toBe(1);
  });
});

describe('deleting a medication', () => {
  it('leaves no rows or notifications behind', async () => {
    await seed(['08:00'], 100);
    const now = at(7);
    await reconcile({ db, port, now: () => now, windowDays: 2 });
    expect(port.pending.size).toBeGreaterThan(0);
    await deleteMedication(db, medId);
    await reconcile({ db, port, now: () => now, windowDays: 2 });
    expect(port.pending.size).toBe(0);
    for (const table of ['schedules', 'dose_logs', 'inventory', 'refill_events', 'refill_alerts']) {
      expect(await db.getAllAsync(`SELECT * FROM ${table}`)).toEqual([]);
    }
  });

  it('ignores a notification button tapped after the medication was deleted', async () => {
    await seed(['08:00'], 100);
    const request = {
      identifier: `dose:${medId}:${at(8).toISOString()}`,
      content: {
        title: 't',
        body: 'b',
        data: { medicationId: medId, scheduledFor: at(8).toISOString(), quantity: 1 },
      },
    };
    await deleteMedication(db, medId);
    const outcome = await handleNotificationResponse(
      { db, port, now: () => at(8, 5) },
      { actionIdentifier: ACTION_TAKEN, notification: { request } },
    );
    expect(outcome).toEqual({ type: 'ignored' });
    expect(port.dismissed).toEqual([request.identifier]);
  });
});
