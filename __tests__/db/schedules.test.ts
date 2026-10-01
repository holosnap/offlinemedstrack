import { NotFoundError } from '@/db/errors';
import { createMedication, deleteMedication } from '@/db/repositories/medications';
import {
  createSchedule,
  deleteSchedule,
  getSchedule,
  listActiveSchedulesInRange,
  listSchedulesForMedication,
  updateSchedule,
} from '@/db/repositories/schedules';
import type { Database } from '@/db/types';

import { createTestDb } from '../helpers/testDb';

describe('schedules repository', () => {
  let db: Database;
  let medId: number;
  beforeEach(async () => {
    db = await createTestDb();
    medId = (
      await createMedication(db, { name: 'A', dosageAmount: 1, dosageUnit: 'mg', form: 'tablet' })
    ).id;
  });

  it('creates a daily schedule with sorted, de-duplicated times', async () => {
    const s = await createSchedule(db, {
      medicationId: medId,
      type: 'daily',
      times: ['20:00', '08:00', '08:00'],
      startDate: '2026-10-01',
      doseQuantity: 2,
    });
    expect(s).toMatchObject({
      medicationId: medId,
      type: 'daily',
      times: ['08:00', '20:00'],
      daysOfWeek: null,
      intervalDays: null,
      startDate: '2026-10-01',
      endDate: null,
      doseQuantity: 2,
    });
    expect(await getSchedule(db, s.id)).toEqual(s);
  });

  it('stores weekday and interval details', async () => {
    const w = await createSchedule(db, {
      medicationId: medId,
      type: 'weekdays',
      times: ['09:00'],
      daysOfWeek: [5, 1, 3],
      startDate: '2026-10-01',
      doseQuantity: 1,
    });
    expect(w.daysOfWeek).toEqual([1, 3, 5]);
    const i = await createSchedule(db, {
      medicationId: medId,
      type: 'interval',
      times: ['09:00'],
      intervalDays: 3,
      startDate: '2026-10-01',
      endDate: '2026-12-31',
      doseQuantity: 1,
    });
    expect(i).toMatchObject({ intervalDays: 3, endDate: '2026-12-31' });
  });

  it('allows as-needed schedules without times', async () => {
    const s = await createSchedule(db, {
      medicationId: medId,
      type: 'as_needed',
      times: ['08:00'],
      startDate: '2026-10-01',
      doseQuantity: 1,
    });
    expect(s.times).toEqual([]);
  });

  it('rejects invalid schedules', async () => {
    const ok = { medicationId: medId, startDate: '2026-10-01', doseQuantity: 1 } as const;
    await expect(createSchedule(db, { ...ok, type: 'daily' })).rejects.toThrow(/at least one time/);
    await expect(createSchedule(db, { ...ok, type: 'daily', times: ['8am'] })).rejects.toThrow(
      /HH:mm/,
    );
    await expect(
      createSchedule(db, { ...ok, type: 'weekdays', times: ['08:00'], daysOfWeek: [7] }),
    ).rejects.toThrow(/days of week/);
    await expect(
      createSchedule(db, { ...ok, type: 'interval', times: ['08:00'], intervalDays: 0 }),
    ).rejects.toThrow(/intervalDays/);
    await expect(
      createSchedule(db, { ...ok, type: 'daily', times: ['08:00'], endDate: '2026-09-01' }),
    ).rejects.toThrow(/before start/);
    await expect(
      createSchedule(db, { ...ok, type: 'daily', times: ['08:00'], startDate: '2026-02-30' }),
    ).rejects.toThrow(/start date/);
    await expect(
      createSchedule(db, { ...ok, type: 'daily', times: ['08:00'], doseQuantity: 0 }),
    ).rejects.toThrow(/Dose quantity/);
  });

  it('rejects a schedule for an unknown medication (foreign key)', async () => {
    await expect(
      createSchedule(db, {
        medicationId: 999,
        type: 'daily',
        times: ['08:00'],
        startDate: '2026-10-01',
        doseQuantity: 1,
      }),
    ).rejects.toThrow();
  });

  it('updates and re-validates the merged schedule', async () => {
    const s = await createSchedule(db, {
      medicationId: medId,
      type: 'daily',
      times: ['08:00'],
      startDate: '2026-10-01',
      doseQuantity: 1,
    });
    const updated = await updateSchedule(db, s.id, {
      times: ['07:30', '19:30'],
      endDate: '2026-11-01',
    });
    expect(updated).toMatchObject({ times: ['07:30', '19:30'], endDate: '2026-11-01' });
    // Clearing the end date
    expect((await updateSchedule(db, s.id, { endDate: null })).endDate).toBeNull();
    // Switching type without supplying its required fields fails and leaves the row unchanged
    await expect(updateSchedule(db, s.id, { type: 'weekdays' })).rejects.toThrow(/days of week/);
    expect((await getSchedule(db, s.id))?.type).toBe('daily');
    const w = await updateSchedule(db, s.id, { type: 'weekdays', daysOfWeek: [0] });
    expect(w).toMatchObject({ type: 'weekdays', daysOfWeek: [0] });
  });

  it('lists per medication and by active date range', async () => {
    const other = await createMedication(db, {
      name: 'B',
      dosageAmount: 1,
      dosageUnit: 'mg',
      form: 'capsule',
    });
    const mk = (medicationId: number, startDate: string, endDate?: string) =>
      createSchedule(db, {
        medicationId,
        type: 'daily',
        times: ['08:00'],
        startDate,
        endDate,
        doseQuantity: 1,
      });
    const current = await mk(medId, '2026-09-01');
    const ended = await mk(medId, '2026-08-01', '2026-09-30');
    const future = await mk(other.id, '2026-10-10');
    expect((await listSchedulesForMedication(db, medId)).map((s) => s.id)).toEqual([
      ended.id,
      current.id,
    ]);
    const ids = async (a: string, b?: string) =>
      (await listActiveSchedulesInRange(db, a, b)).map((s) => s.id);
    expect(await ids('2026-10-01')).toEqual([current.id]);
    expect(await ids('2026-09-30')).toEqual([current.id, ended.id]);
    expect(await ids('2026-10-05', '2026-10-12')).toEqual([current.id, future.id]);
  });

  it('excludes schedules of archived medications from the active listing', async () => {
    await createSchedule(db, {
      medicationId: medId,
      type: 'daily',
      times: ['08:00'],
      startDate: '2026-10-01',
      doseQuantity: 1,
    });
    await db.runAsync('UPDATE medications SET active = 0 WHERE id = ?', [medId]);
    expect(await listActiveSchedulesInRange(db, '2026-10-01')).toEqual([]);
  });

  it('deletes, and cascades when the medication is deleted', async () => {
    const mk = () =>
      createSchedule(db, {
        medicationId: medId,
        type: 'daily',
        times: ['08:00'],
        startDate: '2026-10-01',
        doseQuantity: 1,
      });
    const s = await mk();
    await deleteSchedule(db, s.id);
    expect(await getSchedule(db, s.id)).toBeNull();
    await expect(deleteSchedule(db, s.id)).rejects.toBeInstanceOf(NotFoundError);
    const s2 = await mk();
    await deleteMedication(db, medId);
    expect(await getSchedule(db, s2.id)).toBeNull();
  });
});
