import {
  createInventory,
  createMedication,
  createSchedule,
  getSchedule,
  listDoseLogsInRange,
  recordDose,
  updateSchedule,
} from '@/db/repositories';
import { migrate } from '@/db/migrate';
import { migrations } from '@/db/migrations';
import type { DoseLog } from '@/db/models';
import {
  createBackup,
  parseBackup,
  restoreBackup,
  serializeBackup,
} from '@/features/backup/backup';
import { coveredSlotKeys } from '@/features/doses/timeline';
import { consumedQuantity } from '@/features/doses/state';
import { reconcile } from '@/features/reminders/reconcile';
import { formatClock, setTimeFormatPreference } from '@/lib/format';
import { FakePort } from '../helpers/fakePort';
import { createTestDb } from '../helpers/testDb';

const at = (day: number, h: number, m = 0) => new Date(2026, 5, day, h, m);
const iso = (d: Date) => d.toISOString();

describe('coveredSlotKeys', () => {
  const slot = (medicationId: number, d: Date) => ({ medicationId, scheduledFor: iso(d) });
  const log = (medicationId: number, d: Date, status: DoseLog['status'] = 'taken'): DoseLog =>
    ({
      id: Math.random(),
      medicationId,
      scheduledFor: iso(d),
      status,
      actedAt: iso(d),
      quantity: 1,
      supplyUsed: 1,
      note: null,
      createdAt: '',
      updatedAt: '',
    }) as DoseLog;
  const keys = (set: Set<string>) => [...set].sort();

  it('lets a logged dose stand in for the nearest unlogged slot of the same medication and day', () => {
    const covered = coveredSlotKeys(
      [slot(1, at(10, 9)), slot(1, at(10, 21))],
      [log(1, at(10, 8, 10))],
    );
    expect(keys(covered)).toEqual([`1@${iso(at(10, 9))}`]);
  });

  it('does nothing when the log matches a slot exactly', () => {
    expect(coveredSlotKeys([slot(1, at(10, 8))], [log(1, at(10, 8))]).size).toBe(0);
  });

  it('never crosses medications or days, and ignores missed and snoozed logs', () => {
    const slots = [slot(2, at(10, 9)), slot(1, at(11, 9))];
    expect(coveredSlotKeys(slots, [log(1, at(10, 8))]).size).toBe(0);
    expect(
      coveredSlotKeys(
        [slot(1, at(10, 9))],
        [log(1, at(10, 8), 'missed'), log(1, at(10, 7), 'snoozed')],
      ).size,
    ).toBe(0);
  });

  it('pairs several logs with distinct slots', () => {
    const covered = coveredSlotKeys(
      [slot(1, at(10, 9)), slot(1, at(10, 15)), slot(1, at(10, 21))],
      [log(1, at(10, 8)), log(1, at(10, 14, 30), 'skipped')],
    );
    expect(keys(covered)).toEqual([`1@${iso(at(10, 15))}`, `1@${iso(at(10, 9))}`].sort());
  });
});

describe('schedule edits only reset the "expected from" time when the timing changes', () => {
  it('keeps updatedAt for quantity and end-date changes, bumps it for times, days, and start date', async () => {
    const db = await createTestDb();
    const spy = jest.spyOn(Date, 'now').mockReturnValue(at(1, 0).getTime());
    const med = await createMedication(db, {
      name: 'A',
      dosageAmount: 1,
      dosageUnit: 'mg',
      form: 'tablet',
    });
    const s = await createSchedule(db, {
      medicationId: med.id,
      type: 'daily',
      times: ['08:00'],
      startDate: '2026-01-01',
      doseQuantity: 1,
    });
    const created = s.updatedAt;

    spy.mockReturnValue(at(5, 0).getTime());
    await updateSchedule(db, s.id, { doseQuantity: 2 });
    await updateSchedule(db, s.id, { endDate: '2026-12-31' });
    expect((await getSchedule(db, s.id))?.updatedAt).toBe(created);

    await updateSchedule(db, s.id, { times: ['08:00'] }); // same times: no change
    expect((await getSchedule(db, s.id))?.updatedAt).toBe(created);

    await updateSchedule(db, s.id, { times: ['09:00'] });
    expect((await getSchedule(db, s.id))?.updatedAt).toBe(iso(at(5, 0)));
    spy.mockReturnValue(at(6, 0).getTime());
    await updateSchedule(db, s.id, { type: 'weekdays', daysOfWeek: [1] });
    expect((await getSchedule(db, s.id))?.updatedAt).toBe(iso(at(6, 0)));
    spy.mockRestore();
  });
});

describe('dose logs', () => {
  it('keep their note when the dose is edited', async () => {
    const db = await createTestDb();
    const med = await createMedication(db, {
      name: 'A',
      dosageAmount: 1,
      dosageUnit: 'mg',
      form: 'tablet',
    });
    await recordDose(db, {
      medicationId: med.id,
      scheduledFor: at(10, 8),
      status: 'taken',
      quantity: 1,
      note: 'with food',
    });
    await recordDose(db, { medicationId: med.id, scheduledFor: at(10, 8), status: 'skipped' });
    const [log] = await listDoseLogsInRange(db, at(10, 0), at(11, 0));
    expect(log).toMatchObject({ status: 'skipped', note: 'with food' });
  });

  it('older logs without supply_used consume their quantity', () => {
    expect(consumedQuantity({ status: 'taken', quantity: 2, supplyUsed: null })).toBe(2);
    expect(consumedQuantity({ status: 'taken', quantity: 2, supplyUsed: 1 })).toBe(1);
    expect(consumedQuantity({ status: 'skipped', quantity: 2, supplyUsed: 2 })).toBe(0);
  });

  it('migration 4 adds supply_used to an existing database without losing logs', async () => {
    const db = await createTestDb({ migrate: false });
    await migrate(db, migrations.slice(0, 3));
    await db.runAsync(
      "INSERT INTO medications (name, dosage_amount, dosage_unit, form, active, created_at, updated_at) VALUES ('A', 1, 'mg', 'tablet', 1, 'x', 'x')",
    );
    await db.runAsync(
      "INSERT INTO dose_logs (medication_id, scheduled_for, status, quantity, created_at, updated_at) VALUES (1, '2026-06-08T12:00:00.000Z', 'taken', 2, 'x', 'x')",
    );
    await migrate(db);
    const [log] = await listDoseLogsInRange(
      db,
      '2026-06-01T00:00:00.000Z',
      '2026-07-01T00:00:00.000Z',
    );
    expect(log).toMatchObject({ quantity: 2, supplyUsed: null });
  });
});

describe('backups across the supply_used change', () => {
  it('round-trips supply_used, and restores a version 3 backup that predates it', async () => {
    const source = await createTestDb();
    const med = await createMedication(source, {
      name: 'A',
      dosageAmount: 1,
      dosageUnit: 'mg',
      form: 'tablet',
    });
    await createInventory(source, { medicationId: med.id, currentQuantity: 1, unit: 'tablets' });
    await recordDose(source, {
      medicationId: med.id,
      scheduledFor: at(10, 8),
      status: 'taken',
      quantity: 2,
      supplyUsed: 1,
    });
    const backup = await createBackup(source, at(11, 8));
    expect(backup.schemaVersion).toBe(4);
    expect(backup.tables.dose_logs[0].supply_used).toBe(1);

    const v3 = JSON.parse(serializeBackup(backup));
    v3.schemaVersion = 3;
    for (const row of v3.tables.dose_logs) delete row.supply_used;
    const parsed = parseBackup(JSON.stringify(v3));
    expect(parsed.ok).toBe(true);
    const target = await createTestDb();
    if (parsed.ok) await restoreBackup(target, parsed.backup);
    const [log] = await listDoseLogsInRange(target, at(1, 0), at(30, 0));
    expect(log).toMatchObject({ quantity: 2, supplyUsed: null });
  });
});

describe('notifications already in the shade', () => {
  it('are dismissed when their medication is paused or deleted, and left alone otherwise', async () => {
    const db = await createTestDb();
    const port = new FakePort();
    const mk = async (name: string, active: boolean) => {
      const med = await createMedication(db, {
        name,
        dosageAmount: 1,
        dosageUnit: 'mg',
        form: 'tablet',
        active,
      });
      await createSchedule(db, {
        medicationId: med.id,
        type: 'daily',
        times: ['08:00'],
        startDate: '2026-01-01',
        doseQuantity: 1,
      });
      return med.id;
    };
    const active = await mk('Active', true);
    const paused = await mk('Paused', false);
    port.presented = [
      { identifier: `dose:${active}:x`, medicationId: active },
      { identifier: `dose:${paused}:x`, medicationId: paused },
      { identifier: `refill:999:1`, medicationId: 999 },
      { identifier: 'other:1', medicationId: 999 }, // not ours
    ];
    await reconcile({ db, port, now: () => at(10, 7), windowDays: 1, keepAlive: false });
    expect(port.dismissed.sort()).toEqual([`dose:${paused}:x`, 'refill:999:1'].sort());
    expect(port.presented.map((p) => p.identifier).sort()).toEqual(
      [`dose:${active}:x`, 'other:1'].sort(),
    );
  });
});

describe('24-hour time', () => {
  afterEach(() => setTimeFormatPreference('system'));
  it('shows midnight as 00:05, never 24:05', () => {
    setTimeFormatPreference('24h');
    expect(formatClock(new Date(2026, 5, 10, 0, 5))).toBe('00:05');
    expect(formatClock(new Date(2026, 5, 10, 23, 59))).toBe('23:59');
  });
});
