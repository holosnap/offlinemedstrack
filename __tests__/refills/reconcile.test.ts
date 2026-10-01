import {
  createInventory,
  createMedication,
  createSchedule,
  getRefillAlert,
  recordRefill,
  setMedicationActive,
  updateInventory,
} from '@/db/repositories';
import type { Database } from '@/db/types';
import { reconcile } from '@/features/reminders/reconcile';
import { createTestDb } from '../helpers/testDb';
import { FakePort } from '../helpers/fakePort';

const NOW = new Date(2026, 5, 10, 14, 0); // Wed Jun 10 2026, 14:00 local

let db: Database;
let port: FakePort;

const run = (now = NOW, over: { maxDoses?: number } = {}) =>
  reconcile({ db, port, now: () => now, windowDays: 2, ...over });
const refillIds = () => [...port.pending.keys()].filter((id) => id.startsWith('refill:')).sort();

async function seed(
  over: {
    name?: string;
    quantity?: number;
    refills?: number | null;
    threshold?: number | null;
    pharmacy?: string;
  } = {},
) {
  const med = await createMedication(db, {
    name: over.name ?? 'Metformin',
    dosageAmount: 500,
    dosageUnit: 'mg',
    form: 'tablet',
  });
  await createSchedule(db, {
    medicationId: med.id,
    type: 'daily',
    times: ['08:00', '20:00'],
    startDate: '2026-01-01',
    doseQuantity: 1,
  });
  await createInventory(db, {
    medicationId: med.id,
    currentQuantity: over.quantity ?? 8,
    unit: 'tablets',
    refillThreshold: over.threshold === undefined ? 7 : over.threshold,
    refillThresholdUnit: over.threshold === null ? null : 'days',
    refillsRemaining: over.refills === undefined ? 3 : over.refills,
    pharmacyName: over.pharmacy ?? null,
  });
  return med.id;
}

beforeEach(async () => {
  db = await createTestDb();
  port = new FakePort();
});

describe('refill reminders in reconcile', () => {
  it('schedules two reminders when supply is at the threshold', async () => {
    const id = await seed(); // 8 tablets at 2/day: 4 days left (<= 7)
    await run();
    expect(refillIds()).toEqual([`refill:${id}:1`, `refill:${id}:2`]);
    const [first, second] = [
      port.pending.get(`refill:${id}:1`),
      port.pending.get(`refill:${id}:2`),
    ];
    expect(first?.fireAt).toEqual(new Date(2026, 5, 11, 9, 0));
    expect(second?.fireAt).toEqual(new Date(2026, 5, 13, 9, 0));
    expect(first?.data).toMatchObject({ kind: 'refill', medicationId: id });
    expect(first?.title).toBe('Time to refill Metformin');
  });

  it('schedules nothing while supply is comfortable', async () => {
    await seed({ quantity: 100 });
    await run();
    expect(refillIds()).toEqual([]);
  });

  it('is idempotent and does not re-send after the first reminder has fired', async () => {
    const id = await seed();
    await run();
    const scheduledBefore = port.scheduleCalls;
    await run(new Date(2026, 5, 10, 18, 0));
    expect(port.scheduleCalls).toBe(scheduledBefore);

    // The first reminder fires on Jun 11 at 09:00 and disappears from the pending list.
    port.pending.delete(`refill:${id}:1`);
    await run(new Date(2026, 5, 11, 12, 0));
    expect(refillIds()).toEqual([`refill:${id}:2`]);

    // Second fires; nothing more is ever scheduled for this episode.
    port.pending.delete(`refill:${id}:2`);
    await run(new Date(2026, 5, 14, 12, 0));
    await run(new Date(2026, 5, 20, 12, 0));
    expect(refillIds()).toEqual([]);
  });

  it('cancels the pending reminders once a refill is recorded, and starts over if low again', async () => {
    const id = await seed();
    await run();
    await recordRefill(db, { medicationId: id, quantityAdded: 60 });
    await run(new Date(2026, 5, 10, 15, 0));
    expect(refillIds()).toEqual([]);
    expect(await getRefillAlert(db, id)).toMatchObject({ lowSince: null, lowQuantity: null });

    await updateInventory(db, id, { currentQuantity: 6 });
    await run(new Date(2026, 6, 20, 10, 0));
    expect(refillIds()).toEqual([`refill:${id}:1`, `refill:${id}:2`]);
  });

  it('remembers the episode even while notifications are not allowed', async () => {
    const id = await seed();
    port.permission = 'denied';
    await run();
    expect(refillIds()).toEqual([]);
    expect((await getRefillAlert(db, id)).lowSince).toBe(NOW.toISOString());
    port.permission = 'granted';
    await run(new Date(2026, 5, 10, 16, 0));
    expect(refillIds()).toEqual([`refill:${id}:1`, `refill:${id}:2`]);
  });

  it('works with a count threshold', async () => {
    const id = await seed({ quantity: 20 });
    await updateInventory(db, id, { refillThreshold: 20, refillThresholdUnit: 'count' });
    await run();
    expect(refillIds()).toHaveLength(2);
  });

  it('does nothing without a threshold, and for paused medications', async () => {
    const none = await seed({ threshold: null });
    await run();
    expect(refillIds()).toEqual([]);

    const paused = await seed({ name: 'Paused' });
    await run();
    expect(refillIds().length).toBeGreaterThan(0);
    await setMedicationActive(db, paused, false);
    await run();
    expect(refillIds().every((r) => !r.startsWith(`refill:${paused}:`))).toBe(true);
    expect(none).toBeGreaterThan(0);
  });

  describe('no refills remaining', () => {
    it('sends one doctor reminder when the last refill is recorded', async () => {
      const id = await seed({ quantity: 10, refills: 1, threshold: 3 });
      await run();
      expect(refillIds()).toEqual([]);

      await recordRefill(db, { medicationId: id, quantityAdded: 60 }); // refills 1 -> 0
      await run(new Date(2026, 5, 10, 15, 0));
      expect(refillIds()).toEqual([`refill:${id}:doctor`]);
      const doctor = port.pending.get(`refill:${id}:doctor`);
      expect(doctor?.fireAt).toEqual(new Date(2026, 5, 11, 9, 0));
      expect(doctor?.body).toBe('Contact your doctor for a new prescription.');

      port.pending.delete(`refill:${id}:doctor`);
      await run(new Date(2026, 5, 12, 12, 0));
      expect(refillIds()).toEqual([]); // sent once
    });

    it('is cancelled if refills become available again', async () => {
      const id = await seed({ quantity: 100, refills: 0, threshold: 3 });
      await run();
      expect(refillIds()).toEqual([`refill:${id}:doctor`]);
      await updateInventory(db, id, { refillsRemaining: 2 });
      await run(new Date(2026, 5, 10, 15, 0));
      expect(refillIds()).toEqual([]);
    });

    it('folds into the low-supply reminders instead of sending extra ones', async () => {
      const id = await seed({ refills: 0 });
      await run();
      expect(refillIds()).toEqual([`refill:${id}:1`, `refill:${id}:2`]);
      expect(port.pending.get(`refill:${id}:1`)?.body).toContain('Contact your doctor');
    });
  });

  it('stays under the pending-notification limit with many low medications', async () => {
    for (let i = 0; i < 20; i++) await seed({ name: `Med ${i}` });
    await run(NOW, { maxDoses: 56 });
    expect(port.pending.size).toBeLessThanOrEqual(62);
    expect(refillIds()).toHaveLength(40); // refill reminders are never crowded out by doses
  });
});
