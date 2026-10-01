import {
  createInventory,
  createMedication,
  createSchedule,
  getInventory,
  listRecentDoseLogs,
  setMedicationActive,
} from '@/db/repositories';
import type { Database } from '@/db/types';
import {
  logAsNeededDose,
  resolveTakenAt,
  skipDose,
  snoozeDose,
  takeDose,
  undoDose,
} from '@/features/doses/doseActions';
import { markMissedDoses } from '@/features/doses/missed';
import { FakePort } from '../helpers/fakePort';
import { createTestDb } from '../helpers/testDb';

const CREATED = new Date(2026, 5, 1, 0, 0);
const NOW = new Date(2026, 5, 10, 8, 30);

let db: Database;
let port: FakePort;
let medId: number;
let nowSpy: jest.SpyInstance;

const deps = (now = NOW) => ({ db, port, now: () => now });
const ref = () => ({
  medicationId: medId,
  scheduledFor: new Date(2026, 5, 10, 8, 0).toISOString(),
  quantity: 2,
});
const supply = async () => (await getInventory(db, medId))?.currentQuantity;
const logs = () => listRecentDoseLogs(db, medId);

async function seed(type: 'daily' | 'as_needed' = 'daily') {
  nowSpy.mockReturnValue(CREATED.getTime()); // schedule/inventory timestamps
  const med = await createMedication(db, {
    name: 'Metformin',
    dosageAmount: 500,
    dosageUnit: 'mg',
    form: 'tablet',
  });
  await createSchedule(db, {
    medicationId: med.id,
    type,
    times: type === 'daily' ? ['08:00'] : [],
    startDate: '2026-06-01',
    doseQuantity: 2,
  });
  await createInventory(db, { medicationId: med.id, currentQuantity: 20, unit: 'tablets' });
  nowSpy.mockReturnValue(NOW.getTime());
  return med.id;
}

beforeEach(async () => {
  nowSpy = jest.spyOn(Date, 'now');
  db = await createTestDb();
  port = new FakePort();
  medId = await seed();
});

afterEach(() => nowSpy.mockRestore());

describe('inventory when logging doses', () => {
  it('Taken decrements by the dose quantity', async () => {
    await takeDose(deps(), ref());
    expect(await supply()).toBe(18);
    expect((await logs())[0]).toMatchObject({ status: 'taken', quantity: 2 });
  });

  it('a different quantity decrements by what was actually taken', async () => {
    await takeDose(deps(), ref(), { quantity: 1 });
    expect(await supply()).toBe(19);
  });

  it('records the time it was actually taken', async () => {
    const takenAt = new Date(2026, 5, 10, 8, 20);
    await takeDose(deps(), ref(), { takenAt });
    expect((await logs())[0].actedAt).toBe(takenAt.toISOString());
  });

  it('logging the same dose again does not decrement twice', async () => {
    await takeDose(deps(), ref());
    await takeDose(deps(), ref());
    expect(await supply()).toBe(18);
  });

  it('changing the quantity of a taken dose adjusts by the difference', async () => {
    await takeDose(deps(), ref());
    await takeDose(deps(), ref(), { quantity: 3 });
    expect(await supply()).toBe(17);
  });

  it('Skip does not decrement', async () => {
    await skipDose(deps(), ref());
    expect(await supply()).toBe(20);
    expect((await logs())[0].status).toBe('skipped');
  });

  it('Snooze does not decrement', async () => {
    await snoozeDose(deps(), ref(), { title: 'Time for Metformin', body: '500 mg' });
    expect(await supply()).toBe(20);
  });

  it('a missed dose does not decrement', async () => {
    const marked = await markMissedDoses(db, new Date(2026, 5, 10, 10, 30), 120);
    expect(marked).toBe(8); // 08:00 on each of the last 7 days plus today
    expect(await supply()).toBe(20);
  });

  it('taking a dose that was missed decrements; skipping it afterwards gives it back', async () => {
    await markMissedDoses(db, new Date(2026, 5, 10, 10, 30), 120);
    await takeDose(deps(), ref());
    expect(await supply()).toBe(18);
    await skipDose(deps(), ref());
    expect(await supply()).toBe(20);
  });

  it('Undo of a taken dose restores inventory and removes the log', async () => {
    await takeDose(deps(), ref());
    await undoDose(deps(), ref());
    expect(await supply()).toBe(20);
    expect(await logs()).toHaveLength(0);
  });

  it('Undo can restore the previous state instead of clearing', async () => {
    const { prior: first } = await skipDose(deps(), ref());
    const { prior } = await takeDose(deps(), ref());
    expect(first).toBeNull();
    expect(prior?.status).toBe('skipped');
    await undoDose(deps(), ref(), prior);
    expect((await logs())[0].status).toBe('skipped');
    expect(await supply()).toBe(20);
  });

  it('Undo of a skip leaves inventory alone', async () => {
    await skipDose(deps(), ref());
    await undoDose(deps(), ref());
    expect(await supply()).toBe(20);
    expect(await logs()).toHaveLength(0);
  });

  it('works for a medication without tracked supply', async () => {
    const other = await createMedication(db, {
      name: 'Aspirin',
      dosageAmount: 81,
      dosageUnit: 'mg',
      form: 'tablet',
    });
    await takeDose(deps(), {
      medicationId: other.id,
      scheduledFor: ref().scheduledFor,
      quantity: 1,
    });
    expect(await getInventory(db, other.id)).toBeNull();
    expect(await listRecentDoseLogs(db, other.id)).toHaveLength(1);
  });

  it('rejects a non-positive quantity without changing anything', async () => {
    await expect(takeDose(deps(), ref(), { quantity: 0 })).rejects.toThrow(RangeError);
    expect(await supply()).toBe(20);
    expect(await logs()).toHaveLength(0);
  });
});

describe('snooze', () => {
  it('schedules a reminder 10 minutes out and keeps the dose unresolved', async () => {
    const { until } = await snoozeDose(deps(), ref(), { title: 'Time', body: 'b' });
    expect(until.getTime() - NOW.getTime()).toBe(600_000);
    expect([...port.pending.values()][0].fireAt).toEqual(until);
    expect((await logs())[0].status).toBe('snoozed');
  });

  it('still logs the snooze when notifications are not allowed', async () => {
    port.permission = 'denied';
    await snoozeDose(deps(), ref(), { title: 'Time', body: 'b' });
    expect(port.pending.size).toBe(0);
    expect((await logs())[0].status).toBe('snoozed');
  });

  it('Taken or Skip cancels the pending snooze reminder', async () => {
    await snoozeDose(deps(), ref(), { title: 'Time', body: 'b' });
    await takeDose(deps(), ref());
    expect(port.pending.size).toBe(0);
  });
});

describe('as-needed doses', () => {
  beforeEach(async () => {
    medId = await seed('as_needed');
  });

  it('logs a PRN dose at the time taken and decrements inventory', async () => {
    const { scheduledFor } = await logAsNeededDose(deps(), { medicationId: medId, quantity: 2 });
    expect(scheduledFor).toBe(NOW.toISOString());
    expect(await supply()).toBe(18);
    expect((await logs())[0]).toMatchObject({ status: 'taken', quantity: 2 });
  });

  it('allows several doses in a day, at any time, with any quantity', async () => {
    await logAsNeededDose(deps(), {
      medicationId: medId,
      quantity: 1,
      takenAt: new Date(2026, 5, 10, 7, 0),
    });
    await logAsNeededDose(deps(), { medicationId: medId, quantity: 1.5 });
    expect(await logs()).toHaveLength(2);
    expect(await supply()).toBe(17.5);
  });

  it('undo removes the dose and gives the supply back', async () => {
    const { scheduledFor } = await logAsNeededDose(deps(), { medicationId: medId, quantity: 2 });
    await undoDose(deps(), { medicationId: medId, scheduledFor });
    expect(await supply()).toBe(20);
    expect(await logs()).toHaveLength(0);
  });

  it('is never marked missed', async () => {
    await markMissedDoses(db, new Date(2026, 5, 12, 0, 0), 120);
    expect(await logs()).toHaveLength(0);
  });
});

describe('resolveTakenAt', () => {
  it('turns a typed time into an instant on that day', () => {
    const r = resolveTakenAt('2026-06-10', '08:15', NOW);
    expect(r).toEqual({ ok: true, value: new Date(2026, 5, 10, 8, 15) });
  });

  it('rejects missing or future times', () => {
    expect(resolveTakenAt('2026-06-10', null, NOW)).toMatchObject({ ok: false });
    expect(resolveTakenAt('2026-06-10', '09:00', NOW)).toMatchObject({ ok: false });
  });
});

describe('paused medications', () => {
  it('are not marked missed', async () => {
    await setMedicationActive(db, medId, false);
    expect(await markMissedDoses(db, new Date(2026, 5, 10, 12, 0), 120)).toBe(0);
  });
});
