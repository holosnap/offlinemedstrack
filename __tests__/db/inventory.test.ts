import { NotFoundError } from '@/db/errors';
import {
  adjustInventoryQuantity,
  createInventory,
  deleteInventory,
  getInventory,
  listInventory,
  listLowStock,
  updateInventory,
} from '@/db/repositories/inventory';
import { createMedication, setMedicationActive } from '@/db/repositories/medications';
import { createSchedule } from '@/db/repositories/schedules';
import type { Database } from '@/db/types';

import { createTestDb } from '../helpers/testDb';

describe('inventory repository', () => {
  let db: Database;
  const mkMed = async (name = 'A') =>
    (await createMedication(db, { name, dosageAmount: 1, dosageUnit: 'mg', form: 'tablet' })).id;

  beforeEach(async () => {
    db = await createTestDb();
    jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 9, 1, 15, 0, 0));
  });
  afterEach(() => jest.restoreAllMocks());

  it('creates and reads inventory with prescription details', async () => {
    const medicationId = await mkMed();
    const inv = await createInventory(db, {
      medicationId,
      currentQuantity: 30,
      unit: 'tablets',
      refillThreshold: 7,
      refillThresholdUnit: 'days',
      refillsRemaining: 3,
      pharmacyName: 'Corner Pharmacy',
      pharmacyPhone: '555-0100',
      prescriptionNumber: 'RX123',
    });
    expect(inv).toEqual({
      medicationId,
      currentQuantity: 30,
      unit: 'tablets',
      refillThreshold: 7,
      refillThresholdUnit: 'days',
      refillsRemaining: 3,
      pharmacyName: 'Corner Pharmacy',
      pharmacyPhone: '555-0100',
      prescriptionNumber: 'RX123',
      updatedAt: '2026-10-01T15:00:00.000Z',
    });
    expect(await getInventory(db, medicationId)).toEqual(inv);
    expect(await listInventory(db)).toEqual([inv]);
  });

  it('allows only one inventory per medication and validates input', async () => {
    const medicationId = await mkMed();
    const input = { medicationId, currentQuantity: 5, unit: 'tablets' };
    await createInventory(db, input);
    await expect(createInventory(db, input)).rejects.toThrow();
    const other = await mkMed('B');
    await expect(
      createInventory(db, { ...input, medicationId: other, currentQuantity: -1 }),
    ).rejects.toThrow(RangeError);
    await expect(
      createInventory(db, { ...input, medicationId: other, refillThreshold: 5 }),
    ).rejects.toThrow(/together/);
    await expect(
      createInventory(db, { ...input, medicationId: other, refillsRemaining: 1.5 }),
    ).rejects.toThrow(RangeError);
  });

  it('updates fields, including clearing nullable ones', async () => {
    const medicationId = await mkMed();
    await createInventory(db, {
      medicationId,
      currentQuantity: 5,
      unit: 'tablets',
      pharmacyName: 'X',
    });
    const updated = await updateInventory(db, medicationId, {
      currentQuantity: 12,
      pharmacyName: null,
      pharmacyPhone: '555',
    });
    expect(updated).toMatchObject({
      currentQuantity: 12,
      pharmacyName: null,
      pharmacyPhone: '555',
    });
    await expect(updateInventory(db, 999, { currentQuantity: 1 })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('adjusts quantity and never goes below zero', async () => {
    const medicationId = await mkMed();
    await createInventory(db, { medicationId, currentQuantity: 2, unit: 'tablets' });
    expect((await adjustInventoryQuantity(db, medicationId, -1)).currentQuantity).toBe(1);
    expect((await adjustInventoryQuantity(db, medicationId, -5)).currentQuantity).toBe(0);
    expect((await adjustInventoryQuantity(db, medicationId, 10)).currentQuantity).toBe(10);
    await expect(adjustInventoryQuantity(db, 999, 1)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('deletes inventory', async () => {
    const medicationId = await mkMed();
    await createInventory(db, { medicationId, currentQuantity: 2, unit: 'tablets' });
    await deleteInventory(db, medicationId);
    expect(await getInventory(db, medicationId)).toBeNull();
    await expect(deleteInventory(db, medicationId)).rejects.toBeInstanceOf(NotFoundError);
  });

  describe('listLowStock', () => {
    const schedule = (medicationId: number, extra: Record<string, unknown> = {}) =>
      createSchedule(db, {
        medicationId,
        type: 'daily',
        times: ['08:00', '20:00'],
        startDate: '2026-09-01',
        doseQuantity: 1,
        ...extra,
      });
    const now = new Date('2026-10-01T15:00:00Z');

    it('flags day-based thresholds using schedule usage', async () => {
      const low = await mkMed('low');
      const fine = await mkMed('fine');
      await schedule(low); // 2 per day
      await schedule(fine);
      const base = { unit: 'tablets', refillThreshold: 7, refillThresholdUnit: 'days' } as const;
      await createInventory(db, { ...base, medicationId: low, currentQuantity: 14 }); // 7 days
      await createInventory(db, { ...base, medicationId: fine, currentQuantity: 15 }); // 7.5 days
      const result = await listLowStock(db, now);
      expect(result.map((r) => [r.inventory.medicationId, r.daysOfSupply])).toEqual([[low, 7]]);
    });

    it('accounts for weekday and interval frequency', async () => {
      const weekly = await mkMed('weekly');
      await schedule(weekly, { type: 'weekdays', daysOfWeek: [1], times: ['08:00'] }); // 1/7 per day
      await createInventory(db, {
        medicationId: weekly,
        currentQuantity: 2,
        unit: 'tablets',
        refillThreshold: 14,
        refillThresholdUnit: 'days',
      });
      expect((await listLowStock(db, now))[0].daysOfSupply).toBeCloseTo(14);
    });

    it('flags count-based thresholds even without a schedule', async () => {
      const medicationId = await mkMed();
      await createInventory(db, {
        medicationId,
        currentQuantity: 5,
        unit: 'puffs',
        refillThreshold: 5,
        refillThresholdUnit: 'count',
      });
      const result = await listLowStock(db, now);
      expect(result).toHaveLength(1);
      expect(result[0].daysOfSupply).toBeNull();
    });

    it('ignores day thresholds with no usage, no threshold, and archived medications', async () => {
      const asNeeded = await mkMed('prn');
      await schedule(asNeeded, { type: 'as_needed', times: [] });
      await createInventory(db, {
        medicationId: asNeeded,
        currentQuantity: 0,
        unit: 'tablets',
        refillThreshold: 7,
        refillThresholdUnit: 'days',
      });
      const noThreshold = await mkMed('none');
      await createInventory(db, { medicationId: noThreshold, currentQuantity: 0, unit: 'tablets' });
      const archived = await mkMed('archived');
      await createInventory(db, {
        medicationId: archived,
        currentQuantity: 0,
        unit: 'tablets',
        refillThreshold: 3,
        refillThresholdUnit: 'count',
      });
      await setMedicationActive(db, archived, false);
      expect(await listLowStock(db, now)).toEqual([]);
    });
  });
});
