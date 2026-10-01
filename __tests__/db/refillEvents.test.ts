import { NotFoundError } from '@/db/errors';
import { createInventory, getInventory } from '@/db/repositories/inventory';
import { createMedication } from '@/db/repositories/medications';
import {
  createRefillEvent,
  deleteRefillEvent,
  getRefillEvent,
  listRefillEventsForMedication,
  listRefillEventsInRange,
  recordRefill,
  updateRefillEvent,
} from '@/db/repositories/refillEvents';
import type { Database } from '@/db/types';

import { createTestDb } from '../helpers/testDb';

describe('refill events repository', () => {
  let db: Database;
  let medId: number;
  beforeEach(async () => {
    db = await createTestDb();
    jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 9, 1, 15, 0, 0));
    medId = (
      await createMedication(db, { name: 'A', dosageAmount: 1, dosageUnit: 'mg', form: 'tablet' })
    ).id;
  });
  afterEach(() => jest.restoreAllMocks());

  it('creates with a default date of now and normalizes explicit dates to UTC', async () => {
    const now = await createRefillEvent(db, { medicationId: medId, quantityAdded: 30 });
    expect(now).toMatchObject({ date: '2026-10-01T15:00:00.000Z', quantityAdded: 30, note: null });
    const dated = await createRefillEvent(db, {
      medicationId: medId,
      quantityAdded: 90,
      date: '2026-09-01T09:00:00-04:00',
      note: 'mail order',
    });
    expect(dated).toMatchObject({ date: '2026-09-01T13:00:00.000Z', note: 'mail order' });
    expect(await getRefillEvent(db, dated.id)).toEqual(dated);
  });

  it('validates quantity', async () => {
    await expect(createRefillEvent(db, { medicationId: medId, quantityAdded: 0 })).rejects.toThrow(
      RangeError,
    );
  });

  it('lists per medication newest first and by half-open date range', async () => {
    const a = await createRefillEvent(db, {
      medicationId: medId,
      quantityAdded: 1,
      date: '2026-08-01T00:00:00Z',
    });
    const b = await createRefillEvent(db, {
      medicationId: medId,
      quantityAdded: 1,
      date: '2026-09-01T00:00:00Z',
    });
    const c = await createRefillEvent(db, {
      medicationId: medId,
      quantityAdded: 1,
      date: '2026-10-01T00:00:00Z',
    });
    expect((await listRefillEventsForMedication(db, medId)).map((e) => e.id)).toEqual([
      c.id,
      b.id,
      a.id,
    ]);
    expect(
      (await listRefillEventsInRange(db, '2026-08-01T00:00:00Z', '2026-10-01T00:00:00Z')).map(
        (e) => e.id,
      ),
    ).toEqual([a.id, b.id]);
  });

  it('updates and deletes', async () => {
    const e = await createRefillEvent(db, { medicationId: medId, quantityAdded: 10 });
    expect(await updateRefillEvent(db, e.id, { quantityAdded: 20, note: 'fixed' })).toMatchObject({
      quantityAdded: 20,
      note: 'fixed',
    });
    expect(await updateRefillEvent(db, e.id, {})).toMatchObject({ quantityAdded: 20 });
    await deleteRefillEvent(db, e.id);
    expect(await getRefillEvent(db, e.id)).toBeNull();
    await expect(deleteRefillEvent(db, e.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateRefillEvent(db, e.id, { note: 'x' })).rejects.toBeInstanceOf(NotFoundError);
  });

  describe('recordRefill', () => {
    it('adds stock and uses up one refill atomically', async () => {
      await createInventory(db, {
        medicationId: medId,
        currentQuantity: 4,
        unit: 'tablets',
        refillsRemaining: 2,
      });
      const event = await recordRefill(db, { medicationId: medId, quantityAdded: 30 });
      expect(event.quantityAdded).toBe(30);
      expect(await getInventory(db, medId)).toMatchObject({
        currentQuantity: 34,
        refillsRemaining: 1,
      });
      await recordRefill(db, { medicationId: medId, quantityAdded: 30 });
      await recordRefill(db, { medicationId: medId, quantityAdded: 30 });
      expect((await getInventory(db, medId))?.refillsRemaining).toBe(0);
    });

    it('leaves refillsRemaining null when it is not tracked', async () => {
      await createInventory(db, { medicationId: medId, currentQuantity: 0, unit: 'tablets' });
      await recordRefill(db, { medicationId: medId, quantityAdded: 10 });
      expect(await getInventory(db, medId)).toMatchObject({
        currentQuantity: 10,
        refillsRemaining: null,
      });
    });

    it('records nothing when the medication has no inventory', async () => {
      await expect(
        recordRefill(db, { medicationId: medId, quantityAdded: 10 }),
      ).rejects.toBeInstanceOf(NotFoundError);
      expect(await listRefillEventsForMedication(db, medId)).toEqual([]);
    });

    it('rolls back the inventory change if the event insert fails', async () => {
      await createInventory(db, { medicationId: medId, currentQuantity: 5, unit: 'tablets' });
      await expect(
        recordRefill(db, { medicationId: medId, quantityAdded: 10, date: 'not a date' }),
      ).rejects.toThrow(RangeError);
      expect((await getInventory(db, medId))?.currentQuantity).toBe(5);
    });
  });
});
