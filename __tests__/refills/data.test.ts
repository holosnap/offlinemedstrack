import {
  createInventory,
  createMedication,
  getInventory,
  listRefillEventsForMedication,
} from '@/db/repositories';
import type { Database } from '@/db/types';
import { buildRefillList } from '@/features/refills/list';
import { saveRefill, validateRefillForm } from '@/features/refills/data';
import { isValidPhone, phoneToTelUrl } from '@/lib/format';
import { createTestDb } from '../helpers/testDb';
import { buildSummary } from '@/features/medications/summary';
import type { Inventory, Medication, Schedule } from '@/db/models';

jest.mock('@/features/reminders/sync');

const NOW = new Date(2026, 5, 10, 14, 30);

describe('validateRefillForm', () => {
  const form = (over: Partial<Parameters<typeof validateRefillForm>[0]> = {}) =>
    validateRefillForm({ quantity: '30', date: '2026-06-10', note: '', ...over }, NOW);

  it('accepts a valid refill; today keeps the current time, earlier days are noon', () => {
    const today = form();
    expect(today).toEqual({
      ok: true,
      value: { quantityAdded: 30, date: NOW.toISOString(), note: null },
    });
    const earlier = form({ date: '2026-06-08', note: '  Picked up late ' });
    expect(earlier).toEqual({
      ok: true,
      value: {
        quantityAdded: 30,
        date: new Date(2026, 5, 8, 12, 0).toISOString(),
        note: 'Picked up late',
      },
    });
  });

  it('rejects missing, non-numeric, and non-positive quantities', () => {
    for (const quantity of ['', 'abc', '0', '-5']) {
      const r = form({ quantity });
      expect(r.ok).toBe(false);
      expect(!r.ok && r.errors.quantity).toBeDefined();
    }
    expect(form({ quantity: '2,5' }).ok).toBe(true);
  });

  it('rejects invalid or future dates', () => {
    for (const date of ['', '2026-13-01', 'yesterday', '2026-06-11']) {
      const r = form({ date });
      expect(!r.ok && r.errors.date).toBeDefined();
    }
  });
});

describe('saveRefill', () => {
  let db: Database;
  let medId: number;

  beforeEach(async () => {
    db = await createTestDb();
    medId = (
      await createMedication(db, {
        name: 'Metformin',
        dosageAmount: 500,
        dosageUnit: 'mg',
        form: 'tablet',
      })
    ).id;
  });

  it('adds to inventory, uses one refill, and records the event', async () => {
    await createInventory(db, {
      medicationId: medId,
      currentQuantity: 4,
      unit: 'tablets',
      refillsRemaining: 2,
    });
    const event = await saveRefill(db, {
      medicationId: medId,
      quantityAdded: 30,
      date: NOW,
      note: 'Corner Pharmacy',
    });
    expect(event).toMatchObject({ quantityAdded: 30, note: 'Corner Pharmacy' });
    expect(await getInventory(db, medId)).toMatchObject({
      currentQuantity: 34,
      refillsRemaining: 1,
    });
    expect(await listRefillEventsForMedication(db, medId)).toHaveLength(1);
  });

  it('leaves untracked refills untracked and never goes below zero refills', async () => {
    await createInventory(db, { medicationId: medId, currentQuantity: 0, unit: 'tablets' });
    await saveRefill(db, { medicationId: medId, quantityAdded: 10 });
    expect((await getInventory(db, medId))?.refillsRemaining).toBeNull();

    await createMedication(db, { name: 'B', dosageAmount: 1, dosageUnit: 'mg', form: 'tablet' });
    const other = (
      await createMedication(db, { name: 'C', dosageAmount: 1, dosageUnit: 'mg', form: 'tablet' })
    ).id;
    await createInventory(db, {
      medicationId: other,
      currentQuantity: 0,
      unit: 'tablets',
      refillsRemaining: 0,
    });
    await saveRefill(db, { medicationId: other, quantityAdded: 10 });
    expect((await getInventory(db, other))?.refillsRemaining).toBe(0);
  });

  it('fails without changing anything when supply is not tracked', async () => {
    await expect(saveRefill(db, { medicationId: medId, quantityAdded: 10 })).rejects.toThrow();
    expect(await listRefillEventsForMedication(db, medId)).toHaveLength(0);
  });
});

describe('phone helpers', () => {
  it('validates and builds tel links', () => {
    expect(isValidPhone('(555) 123-4567')).toBe(true);
    expect(isValidPhone('+1 555.123.4567')).toBe(true);
    expect(isValidPhone('call me')).toBe(false);
    expect(isValidPhone('12')).toBe(false);
    expect(phoneToTelUrl('(555) 123-4567')).toBe('tel:5551234567');
    expect(phoneToTelUrl('+44 20 7946 0958')).toBe('tel:+442079460958');
    expect(phoneToTelUrl('')).toBeNull();
    expect(phoneToTelUrl(null)).toBeNull();
    expect(phoneToTelUrl('abc')).toBeNull();
  });
});

describe('buildRefillList', () => {
  const med = (id: number, name: string, active = true): Medication => ({
    id,
    name,
    dosageAmount: 1,
    dosageUnit: 'mg',
    form: 'tablet',
    instructions: null,
    color: null,
    icon: null,
    active,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
  const sched = (id: number, over: Partial<Schedule> = {}): Schedule => ({
    id,
    medicationId: id,
    type: 'daily',
    times: ['08:00'],
    daysOfWeek: null,
    intervalDays: null,
    startDate: '2026-01-01',
    endDate: null,
    doseQuantity: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  });
  const inv = (id: number, quantity: number): Inventory => ({
    medicationId: id,
    currentQuantity: quantity,
    unit: 'tablets',
    refillThreshold: 7,
    refillThresholdUnit: 'days',
    refillsRemaining: null,
    pharmacyName: null,
    pharmacyPhone: null,
    prescriptionNumber: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
  const summary = (
    id: number,
    name: string,
    quantity: number | null,
    over: Partial<Schedule> = {},
    active = true,
    perDay = 0,
  ) =>
    buildSummary(
      med(id, name, active),
      [sched(id, over)],
      quantity === null ? null : inv(id, quantity),
      NOW,
      perDay,
    );

  it('sorts by soonest run-out: out first, then by date, then no estimate, then no supply', () => {
    const list = buildRefillList(
      [
        summary(1, 'Later', 40),
        summary(2, 'No supply', null),
        summary(3, 'Soon', 5),
        summary(4, 'Out', 0),
        summary(5, 'As needed', 10, { type: 'as_needed', times: [] }),
        summary(6, 'Paused', 1, {}, false),
        summary(7, 'Sooner', 2),
        summary(8, 'Tie B', 5),
        summary(9, 'Tie A', 5),
      ],
      '2026-06-10',
    );
    expect(list.map((s) => s.medication.name)).toEqual([
      'Out',
      'Sooner',
      'Soon',
      'Tie A',
      'Tie B',
      'Later',
      'As needed',
      'No supply',
    ]);
  });

  it('orders as-needed medications by their average usage estimate', () => {
    const list = buildRefillList(
      [
        summary(1, 'Daily', 20),
        summary(2, 'Prn', 6, { type: 'as_needed', times: [] }, true, 2), // 3 days
      ],
      '2026-06-10',
    );
    expect(list.map((s) => s.medication.name)).toEqual(['Prn', 'Daily']);
  });
});
