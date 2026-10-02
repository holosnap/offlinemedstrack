import {
  createInventory,
  createMedication,
  createSchedule,
  getInventory,
  listRecentDoseLogs,
} from '@/db/repositories';
import type { Database } from '@/db/types';
import {
  addAsNeededDose,
  deleteAsNeededDose,
  editAsNeededDose,
  editScheduledDose,
  parseEditForm,
} from '@/features/history/historyActions';
import { createTestDb } from '../helpers/testDb';

const NOW = new Date(2026, 5, 10, 14, 0);
const at = (day: number, h: number, m = 0) => new Date(2026, 5, day, h, m);

let db: Database;
let medId: number;
let prnId: number;

const supply = async (id = medId) => (await getInventory(db, id))?.currentQuantity;
const ref = (day = 8) => ({ medicationId: medId, scheduledFor: at(day, 8).toISOString() });
const logs = (id = medId) => listRecentDoseLogs(db, id, 100);

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
  await createSchedule(db, {
    medicationId: medId,
    type: 'daily',
    times: ['08:00'],
    startDate: '2026-01-01',
    doseQuantity: 2,
  });
  await createInventory(db, { medicationId: medId, currentQuantity: 20, unit: 'tablets' });

  prnId = (
    await createMedication(db, {
      name: 'Ibuprofen',
      dosageAmount: 200,
      dosageUnit: 'mg',
      form: 'tablet',
    })
  ).id;
  await createSchedule(db, {
    medicationId: prnId,
    type: 'as_needed',
    startDate: '2026-01-01',
    doseQuantity: 1,
  });
  await createInventory(db, { medicationId: prnId, currentQuantity: 30, unit: 'tablets' });
});

describe('editScheduledDose: inventory follows the edit', () => {
  it('backfilling "I took it but forgot to tap" uses supply', async () => {
    await editScheduledDose(db, ref(), { kind: 'taken', quantity: 2, takenAt: at(8, 8, 10) }, NOW);
    expect(await supply()).toBe(18);
    expect((await logs())[0]).toMatchObject({
      status: 'taken',
      quantity: 2,
      actedAt: at(8, 8, 10).toISOString(),
    });
  });

  it('changing the quantity adjusts by the difference', async () => {
    await editScheduledDose(db, ref(), { kind: 'taken', quantity: 2, takenAt: at(8, 8) }, NOW);
    await editScheduledDose(db, ref(), { kind: 'taken', quantity: 3, takenAt: at(8, 8) }, NOW);
    expect(await supply()).toBe(17);
    await editScheduledDose(db, ref(), { kind: 'taken', quantity: 1, takenAt: at(8, 8) }, NOW);
    expect(await supply()).toBe(19);
    expect(await logs()).toHaveLength(1);
  });

  it('changing taken to skipped or missed gives the supply back', async () => {
    await editScheduledDose(db, ref(), { kind: 'taken', quantity: 2, takenAt: at(8, 8) }, NOW);
    await editScheduledDose(db, ref(), { kind: 'skipped' }, NOW);
    expect(await supply()).toBe(20);
    await editScheduledDose(db, ref(), { kind: 'taken', quantity: 2, takenAt: at(8, 8) }, NOW);
    await editScheduledDose(db, ref(), { kind: 'missed' }, NOW);
    expect(await supply()).toBe(20);
    expect((await logs())[0].status).toBe('missed');
  });

  it('turning a missed or skipped dose into taken uses supply', async () => {
    await editScheduledDose(db, ref(), { kind: 'missed' }, NOW);
    expect(await supply()).toBe(20);
    await editScheduledDose(db, ref(), { kind: 'taken', quantity: 2, takenAt: at(8, 9) }, NOW);
    expect(await supply()).toBe(18);
  });

  it('clearing a taken dose removes the log and gives the supply back', async () => {
    await editScheduledDose(db, ref(), { kind: 'taken', quantity: 2, takenAt: at(8, 8) }, NOW);
    await editScheduledDose(db, ref(), { kind: 'clear' }, NOW);
    expect(await supply()).toBe(20);
    expect(await logs()).toHaveLength(0);
  });

  it('skipping or missing never touches inventory', async () => {
    await editScheduledDose(db, ref(), { kind: 'skipped' }, NOW);
    await editScheduledDose(db, ref(9), { kind: 'missed' }, NOW);
    expect(await supply()).toBe(20);
  });

  it('undo restores the previous log and inventory', async () => {
    await editScheduledDose(db, ref(), { kind: 'taken', quantity: 2, takenAt: at(8, 8) }, NOW);
    const { undo } = await editScheduledDose(db, ref(), { kind: 'skipped' }, NOW);
    expect(await supply()).toBe(20);
    await undo();
    expect(await supply()).toBe(18);
    expect((await logs())[0].status).toBe('taken');

    const second = await editScheduledDose(
      db,
      ref(9),
      { kind: 'taken', quantity: 2, takenAt: at(9, 8) },
      NOW,
    );
    await second.undo();
    expect(await supply()).toBe(18);
    expect((await logs()).filter((l) => new Date(l.scheduledFor).getDate() === 9)).toHaveLength(0);
  });

  it('rejects a future time or a bad quantity without changing anything', async () => {
    await expect(
      editScheduledDose(db, ref(10), { kind: 'taken', quantity: 2, takenAt: at(10, 18) }, NOW),
    ).rejects.toThrow(RangeError);
    await expect(
      editScheduledDose(db, ref(), { kind: 'taken', quantity: 0, takenAt: at(8, 8) }, NOW),
    ).rejects.toThrow(RangeError);
    expect(await supply()).toBe(20);
    expect(await logs()).toHaveLength(0);
  });

  it('works for a medication without tracked supply', async () => {
    const bare = (
      await createMedication(db, {
        name: 'Bare',
        dosageAmount: 1,
        dosageUnit: 'mg',
        form: 'tablet',
      })
    ).id;
    await editScheduledDose(
      db,
      { medicationId: bare, scheduledFor: at(8, 8).toISOString() },
      { kind: 'taken', quantity: 1, takenAt: at(8, 8) },
      NOW,
    );
    expect(await logs(bare)).toHaveLength(1);
  });
});

describe('as-needed doses', () => {
  const input = (h: number, quantity = 1) => ({ medicationId: prnId, quantity, takenAt: at(8, h) });

  it('backfills a dose at any past time and uses supply', async () => {
    await addAsNeededDose(db, input(12, 2), NOW);
    expect(await supply(prnId)).toBe(28);
    expect((await logs(prnId))[0]).toMatchObject({ status: 'taken', quantity: 2 });
  });

  it('rejects the same minute twice and future times', async () => {
    await addAsNeededDose(db, input(12), NOW);
    await expect(addAsNeededDose(db, input(12), NOW)).rejects.toThrow('already logged');
    await expect(
      addAsNeededDose(db, { medicationId: prnId, quantity: 1, takenAt: at(10, 18) }, NOW),
    ).rejects.toThrow(RangeError);
    expect(await supply(prnId)).toBe(29);
  });

  it('edits quantity in place and adjusts supply by the difference', async () => {
    await addAsNeededDose(db, input(12, 2), NOW);
    const [log] = await logs(prnId);
    await editAsNeededDose(db, log, { quantity: 3, takenAt: at(8, 12) }, NOW);
    expect(await supply(prnId)).toBe(27);
    expect(await logs(prnId)).toHaveLength(1);
  });

  it('moves a dose to a different time as one change', async () => {
    await addAsNeededDose(db, input(12, 2), NOW);
    const [log] = await logs(prnId);
    const { undo } = await editAsNeededDose(db, log, { quantity: 1, takenAt: at(8, 15) }, NOW);
    const after = await logs(prnId);
    expect(after).toHaveLength(1);
    expect(after[0].scheduledFor).toBe(at(8, 15).toISOString());
    expect(await supply(prnId)).toBe(29);

    await undo();
    const restored = await logs(prnId);
    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({ scheduledFor: at(8, 12).toISOString(), quantity: 2 });
    expect(await supply(prnId)).toBe(28);
  });

  it('refuses to move onto another dose and changes nothing', async () => {
    await addAsNeededDose(db, input(12), NOW);
    await addAsNeededDose(db, input(15), NOW);
    const log = (await logs(prnId)).find((l) => l.scheduledFor === at(8, 12).toISOString());
    await expect(
      editAsNeededDose(db, log!, { quantity: 1, takenAt: at(8, 15) }, NOW),
    ).rejects.toThrow('already logged');
    expect(await logs(prnId)).toHaveLength(2);
    expect(await supply(prnId)).toBe(28);
  });

  it('deletes a dose, gives the supply back, and can be undone', async () => {
    await addAsNeededDose(db, input(12, 2), NOW);
    const [log] = await logs(prnId);
    const { undo } = await deleteAsNeededDose(db, log);
    expect(await supply(prnId)).toBe(30);
    expect(await logs(prnId)).toHaveLength(0);
    await undo();
    expect(await supply(prnId)).toBe(28);
    expect(await logs(prnId)).toHaveLength(1);
  });
});

describe('parseEditForm', () => {
  it('turns typed text into a quantity and a time on that day', () => {
    expect(parseEditForm({ quantity: '2', time: '8:15 am' }, '2026-06-08', NOW)).toEqual({
      ok: true,
      quantity: 2,
      takenAt: at(8, 8, 15),
    });
    expect(parseEditForm({ quantity: '1,5', time: '20:30' }, '2026-06-08', NOW)).toMatchObject({
      ok: true,
      quantity: 1.5,
    });
  });

  it('reports each bad field', () => {
    const r = parseEditForm({ quantity: '0', time: 'noonish' }, '2026-06-08', NOW);
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && Object.keys(r.errors).sort()).toEqual(['quantity', 'time']);
    const future = parseEditForm({ quantity: '1', time: '18:00' }, '2026-06-10', NOW);
    expect(!future.ok && future.errors.time).toBe("That time hasn't happened yet");
  });
});
