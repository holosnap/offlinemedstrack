import { NotFoundError } from '@/db/errors';
import {
  createMedication,
  deleteMedication,
  getMedication,
  listMedications,
  setMedicationActive,
  updateMedication,
} from '@/db/repositories/medications';
import { createInventory, getInventory } from '@/db/repositories/inventory';
import type { Database } from '@/db/types';

import { createTestDb } from '../helpers/testDb';

const base = { name: 'Metformin', dosageAmount: 500, dosageUnit: 'mg', form: 'tablet' } as const;

describe('medications repository', () => {
  let db: Database;
  beforeEach(async () => {
    db = await createTestDb();
    jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 9, 1, 12, 0, 0));
  });
  afterEach(() => jest.restoreAllMocks());

  it('creates with defaults and UTC timestamps', async () => {
    const med = await createMedication(db, { ...base, instructions: 'with food' });
    expect(med).toEqual({
      id: 1,
      ...base,
      instructions: 'with food',
      color: null,
      icon: null,
      active: true,
      createdAt: '2026-10-01T12:00:00.000Z',
      updatedAt: '2026-10-01T12:00:00.000Z',
    });
    expect(await getMedication(db, med.id)).toEqual(med);
  });

  it('returns null for a missing id', async () => {
    expect(await getMedication(db, 99)).toBeNull();
  });

  it('lists by name, optionally only active', async () => {
    await createMedication(db, { ...base, name: 'zinc' });
    const b = await createMedication(db, { ...base, name: 'Atorvastatin' });
    await setMedicationActive(db, b.id, false);
    expect((await listMedications(db)).map((m) => m.name)).toEqual(['Atorvastatin', 'zinc']);
    expect((await listMedications(db, { activeOnly: true })).map((m) => m.name)).toEqual(['zinc']);
  });

  it('updates only the given fields and bumps updatedAt', async () => {
    const med = await createMedication(db, { ...base, color: '#f00' });
    jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 9, 2));
    const updated = await updateMedication(db, med.id, { dosageAmount: 850, instructions: null });
    expect(updated).toMatchObject({ dosageAmount: 850, color: '#f00', name: 'Metformin' });
    expect(updated.createdAt).toBe(med.createdAt);
    expect(updated.updatedAt).toBe('2026-10-02T00:00:00.000Z');
  });

  it('throws NotFoundError when updating or deleting a missing medication', async () => {
    await expect(updateMedication(db, 5, { name: 'x' })).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteMedication(db, 5)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('validates input', async () => {
    await expect(createMedication(db, { ...base, name: '  ' })).rejects.toThrow(RangeError);
    await expect(createMedication(db, { ...base, dosageAmount: 0 })).rejects.toThrow(RangeError);
    await expect(
      // @ts-expect-error invalid form on purpose
      createMedication(db, { ...base, form: 'patch' }),
    ).rejects.toThrow(RangeError);
  });

  it('deleting a medication cascades to its related rows', async () => {
    const med = await createMedication(db, base);
    await createInventory(db, { medicationId: med.id, currentQuantity: 10, unit: 'tablets' });
    await deleteMedication(db, med.id);
    expect(await getMedication(db, med.id)).toBeNull();
    expect(await getInventory(db, med.id)).toBeNull();
  });
});
