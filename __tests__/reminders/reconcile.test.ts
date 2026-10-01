import {
  createMedication,
  createSchedule,
  deleteMedication,
  recordDose,
  setMedicationActive,
  updateMedication,
  updateSchedule,
} from '@/db/repositories';
import type { Database } from '@/db/types';
import { reconcile } from '@/features/reminders/reconcile';
import { snoozeNotificationId } from '@/features/reminders/planner';
import { createTestDb } from '../helpers/testDb';
import { FakePort, withTimeZone } from '../helpers/fakePort';

const NOW = new Date(2026, 5, 10, 12, 0); // Wed Jun 10 2026, 12:00 local

let db: Database;
let port: FakePort;

const run = ({ now = NOW, ...over }: { windowDays?: number; maxDoses?: number; now?: Date } = {}) =>
  reconcile({ db, port, now: () => now, windowDays: 2, ...over });

async function seed(
  name = 'Metformin',
  schedule: Partial<Parameters<typeof createSchedule>[1]> = {},
) {
  const med = await createMedication(db, {
    name,
    dosageAmount: 500,
    dosageUnit: 'mg',
    form: 'tablet',
  });
  const sched = await createSchedule(db, {
    medicationId: med.id,
    type: 'daily',
    times: ['08:00', '20:00'],
    startDate: '2026-01-01',
    doseQuantity: 1,
    ...schedule,
  });
  return { med, sched };
}

beforeEach(async () => {
  db = await createTestDb();
  port = new FakePort();
});

describe('reconcile', () => {
  it('schedules the upcoming doses with a readable title and body', async () => {
    await seed();
    const result = await run();
    expect(result).toMatchObject({ permission: 'granted', scheduled: 4, cancelled: 0 });
    expect(port.localTimes()).toEqual([
      '2026-06-10 20:00',
      '2026-06-11 08:00',
      '2026-06-11 20:00',
      '2026-06-12 08:00',
    ]);
    const [first] = [...port.pending.values()];
    expect(first.title).toBe('Time for Metformin');
    expect(first.body).toBe('500 mg');
  });

  it('is idempotent: a second run changes nothing', async () => {
    await seed();
    await run();
    port.scheduleCalls = 0;
    port.cancelCalls = 0;
    const result = await run();
    expect(result).toMatchObject({ scheduled: 0, cancelled: 0, kept: 4 });
    expect(port.scheduleCalls + port.cancelCalls).toBe(0);
  });

  it('serializes overlapping calls so nothing is scheduled twice', async () => {
    await seed();
    await Promise.all([run(), run(), run()]);
    expect(port.scheduleCalls).toBe(4);
    expect(port.pending.size).toBe(4);
  });

  it('replaces notifications when the schedule times are edited', async () => {
    const { sched } = await seed();
    await run();
    await updateSchedule(db, sched.id, { times: ['09:30'] });
    const result = await run();
    expect(result).toMatchObject({ scheduled: 2, cancelled: 4 });
    expect(port.localTimes()).toEqual(['2026-06-11 09:30', '2026-06-12 09:30']);
  });

  it('replaces notifications when the medication is renamed', async () => {
    const { med } = await seed();
    await run();
    await updateMedication(db, med.id, { name: 'Metformin XR' });
    const result = await run();
    expect(result).toMatchObject({ scheduled: 4, cancelled: 4 });
    expect([...port.pending.values()].every((r) => r.title === 'Time for Metformin XR')).toBe(true);
  });

  it('cancels everything for a paused medication and restores it when resumed', async () => {
    const { med } = await seed();
    await run();
    await setMedicationActive(db, med.id, false);
    await run();
    expect(port.pending.size).toBe(0);
    await setMedicationActive(db, med.id, true);
    await run();
    expect(port.pending.size).toBe(4);
  });

  it('cancels everything for a deleted medication', async () => {
    const { med } = await seed();
    await run();
    await deleteMedication(db, med.id);
    await run();
    expect(port.pending.size).toBe(0);
  });

  it('cancels doses past a shortened end date', async () => {
    const { sched } = await seed();
    await run();
    await updateSchedule(db, sched.id, { endDate: '2026-06-11' });
    await run();
    expect(port.localTimes()).toEqual(['2026-06-10 20:00', '2026-06-11 08:00', '2026-06-11 20:00']);
  });

  it('stops reminding once the end date has passed', async () => {
    await seed('Antibiotic', { endDate: '2026-06-10' });
    await run();
    expect(port.localTimes()).toEqual(['2026-06-10 20:00']);
    await run({ now: new Date(2026, 5, 11, 0, 5) });
    expect(port.pending.size).toBe(0);
  });

  it('drops a dose that was already taken', async () => {
    const { med } = await seed();
    await run();
    const [soonest] = [...port.pending.values()].sort(
      (a, b) => a.fireAt.getTime() - b.fireAt.getTime(),
    );
    await recordDose(db, {
      medicationId: med.id,
      scheduledFor: soonest.fireAt,
      status: 'taken',
    });
    await run();
    expect(port.pending.has(soonest.identifier)).toBe(false);
    expect(port.pending.size).toBe(3);
  });

  it('rolls the window forward as time passes', async () => {
    await seed('Metformin', { times: ['08:00'] });
    await run();
    expect(port.localTimes()).toEqual(['2026-06-11 08:00', '2026-06-12 08:00']);
    await run({ now: new Date(2026, 5, 11, 12, 0) });
    expect(port.localTimes()).toEqual(['2026-06-12 08:00', '2026-06-13 08:00']);
  });

  it('respects the maximum number of scheduled doses', async () => {
    await seed();
    await run({ windowDays: 7, maxDoses: 3 });
    expect(port.pending.size).toBe(3);
  });

  it('cancels all reminders and schedules none when permission is not granted', async () => {
    await seed();
    await run();
    port.permission = 'denied';
    const result = await run();
    expect(result).toMatchObject({ permission: 'denied', scheduled: 0, cancelled: 4 });
    expect(port.pending.size).toBe(0);
    port.permission = 'granted';
    await run();
    expect(port.pending.size).toBe(4);
  });

  it('leaves notifications it does not own alone', async () => {
    await seed();
    port.pending.set('other:1', {
      identifier: 'other:1',
      title: 'x',
      body: 'y',
      fireAt: NOW,
      data: {},
    });
    await run();
    expect(port.pending.has('other:1')).toBe(true);
  });

  describe('snoozes', () => {
    const snooze = (medicationId: number) => ({
      identifier: snoozeNotificationId(medicationId, '2026-06-10T12:00:00.000Z'),
      title: 'Time for Metformin',
      body: '500 mg',
      fireAt: new Date(NOW.getTime() + 600_000),
      data: {},
    });

    it('keeps a pending snooze while the medication is active', async () => {
      const { med } = await seed();
      port.pending.set(snooze(med.id).identifier, snooze(med.id));
      await run();
      expect(port.pending.has(snooze(med.id).identifier)).toBe(true);
    });

    it('cancels a pending snooze when the medication is paused or reminders are off', async () => {
      const { med } = await seed();
      port.pending.set(snooze(med.id).identifier, snooze(med.id));
      await setMedicationActive(db, med.id, false);
      await run();
      expect(port.pending.size).toBe(0);

      await setMedicationActive(db, med.id, true);
      port.pending.set(snooze(med.id).identifier, snooze(med.id));
      port.permission = 'denied';
      await run();
      expect(port.pending.size).toBe(0);
    });
  });

  describe('time zone and DST', () => {
    it('re-schedules to the same local wall-clock times after the time zone changes', async () => {
      await seed('Metformin', { times: ['08:00'] });
      const now = new Date('2026-06-10T04:00:00.000Z'); // 00:00 in New York

      await run({ now });
      expect(port.localTimes()).toEqual(['2026-06-10 08:00', '2026-06-11 08:00']);
      const before = [...port.pending.values()].map((r) => r.fireAt.toISOString());

      await withTimeZone('Asia/Tokyo', async () => {
        const result = await run({ now });
        expect(result.cancelled).toBe(2);
        expect(port.localTimes()).toEqual(['2026-06-11 08:00', '2026-06-12 08:00']);
      });
      const after = [...port.pending.values()].map((r) => r.fireAt.toISOString());
      expect(after).not.toEqual(before);
    });

    it('fires at the chosen wall-clock time on both sides of a DST change', async () => {
      await seed('Metformin', { times: ['08:00'] });
      await run({ now: new Date(2026, 2, 7, 12, 0), windowDays: 3 });
      expect([...port.pending.values()].map((r) => r.fireAt.toISOString()).sort()).toEqual([
        '2026-03-08T12:00:00.000Z', // EDT: UTC-4
        '2026-03-09T12:00:00.000Z',
        '2026-03-10T12:00:00.000Z',
      ]);
      expect(port.localTimes().every((t) => t.endsWith('08:00'))).toBe(true);
    });

    it('re-aligns a pending reminder when the clocks change after it was scheduled', async () => {
      await seed('Metformin', { times: ['08:00'] });
      // Scheduled while the device zone was one that observes DST at a different date.
      await withTimeZone('Europe/London', () =>
        run({ now: new Date('2026-03-26T12:00:00.000Z'), windowDays: 5 }),
      );
      const london = [...port.pending.keys()];
      await run({ now: new Date('2026-03-26T12:00:00.000Z'), windowDays: 5 });
      // Nothing from London's wall-clock plan survives: New York's 08:00 is a different instant.
      expect([...port.pending.keys()].some((id) => london.includes(id))).toBe(false);
      expect(port.localTimes().every((t) => t.endsWith('08:00'))).toBe(true);
    });
  });
});
