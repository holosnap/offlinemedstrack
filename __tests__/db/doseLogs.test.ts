import { NotFoundError } from '@/db/errors';
import {
  createDoseLog,
  deleteDoseLog,
  getDoseLog,
  listDoseLogsInRange,
  listScheduledDoses,
  listTodaysDoses,
  recordDose,
  updateDoseLog,
} from '@/db/repositories/doseLogs';
import { createMedication, setMedicationActive } from '@/db/repositories/medications';
import { createSchedule } from '@/db/repositories/schedules';
import type { Database } from '@/db/types';
import { localDayRangeUtc } from '@/lib/time';

import { createTestDb } from '../helpers/testDb';

// Tests run with TZ=America/New_York (see jest.global-setup.js): EDT = UTC-4 until 2026-11-01.
describe('dose logs repository', () => {
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

  describe('CRUD', () => {
    it('creates a log, normalizing datetimes to UTC', async () => {
      const log = await createDoseLog(db, {
        medicationId: medId,
        scheduledFor: '2026-10-01T08:00:00-04:00',
        status: 'taken',
        quantity: 1,
        note: 'ok',
      });
      expect(log).toMatchObject({
        medicationId: medId,
        scheduledFor: '2026-10-01T12:00:00.000Z',
        status: 'taken',
        actedAt: '2026-10-01T15:00:00.000Z',
        quantity: 1,
        note: 'ok',
      });
      expect(await getDoseLog(db, log.id)).toEqual(log);
    });

    it('leaves actedAt empty for missed doses and honors an explicit actedAt', async () => {
      const missed = await createDoseLog(db, {
        medicationId: medId,
        scheduledFor: new Date('2026-10-01T12:00:00Z'),
        status: 'missed',
      });
      expect(missed.actedAt).toBeNull();
      const late = await createDoseLog(db, {
        medicationId: medId,
        scheduledFor: '2026-10-01T16:00:00Z',
        status: 'taken',
        actedAt: new Date('2026-10-01T16:20:00Z'),
      });
      expect(late.actedAt).toBe('2026-10-01T16:20:00.000Z');
    });

    it('rejects bad input and duplicate (medication, scheduledFor)', async () => {
      const input = { medicationId: medId, scheduledFor: '2026-10-01T12:00:00Z' } as const;
      await expect(createDoseLog(db, { ...input, status: 'taken', quantity: -1 })).rejects.toThrow(
        RangeError,
      );
      await expect(
        // @ts-expect-error invalid status on purpose
        createDoseLog(db, { ...input, status: 'late' }),
      ).rejects.toThrow(RangeError);
      await expect(
        createDoseLog(db, { ...input, scheduledFor: 'tomorrow', status: 'taken' }),
      ).rejects.toThrow(RangeError);
      await createDoseLog(db, { ...input, status: 'taken' });
      await expect(createDoseLog(db, { ...input, status: 'skipped' })).rejects.toThrow();
    });

    it('updates and deletes', async () => {
      const log = await createDoseLog(db, {
        medicationId: medId,
        scheduledFor: '2026-10-01T12:00:00Z',
        status: 'snoozed',
      });
      const updated = await updateDoseLog(db, log.id, { status: 'taken', note: 'finally' });
      expect(updated).toMatchObject({ status: 'taken', note: 'finally' });
      await deleteDoseLog(db, log.id);
      expect(await getDoseLog(db, log.id)).toBeNull();
      await expect(updateDoseLog(db, log.id, { note: 'x' })).rejects.toBeInstanceOf(NotFoundError);
      await expect(deleteDoseLog(db, log.id)).rejects.toBeInstanceOf(NotFoundError);
    });

    it('recordDose upserts on (medication, scheduledFor)', async () => {
      const scheduledFor = '2026-10-01T12:00:00.000Z';
      const first = await recordDose(db, { medicationId: medId, scheduledFor, status: 'snoozed' });
      const second = await recordDose(db, {
        medicationId: medId,
        scheduledFor,
        status: 'taken',
        quantity: 1,
      });
      expect(second.id).toBe(first.id);
      expect(second).toMatchObject({ status: 'taken', quantity: 1, createdAt: first.createdAt });
      expect(
        await listDoseLogsInRange(db, '2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z'),
      ).toHaveLength(1);
    });
  });

  describe('listDoseLogsInRange', () => {
    it('is half-open, ordered, and filterable', async () => {
      const other = await createMedication(db, {
        name: 'B',
        dosageAmount: 1,
        dosageUnit: 'mg',
        form: 'tablet',
      });
      const mk = (medicationId: number, scheduledFor: string, status: 'taken' | 'skipped') =>
        createDoseLog(db, { medicationId, scheduledFor, status });
      const b = await mk(medId, '2026-10-02T12:00:00Z', 'taken');
      const a = await mk(medId, '2026-10-01T12:00:00Z', 'skipped');
      const c = await mk(other.id, '2026-10-01T18:00:00Z', 'taken');
      await mk(medId, '2026-10-03T00:00:00Z', 'taken'); // exactly `to`: excluded

      const range = ['2026-10-01T12:00:00Z', '2026-10-03T00:00:00Z'] as const;
      expect((await listDoseLogsInRange(db, ...range)).map((l) => l.id)).toEqual([
        a.id,
        c.id,
        b.id,
      ]);
      expect(
        (await listDoseLogsInRange(db, ...range, { medicationId: medId })).map((l) => l.id),
      ).toEqual([a.id, b.id]);
      expect(
        (await listDoseLogsInRange(db, ...range, { status: 'taken' })).map((l) => l.id),
      ).toEqual([c.id, b.id]);
    });

    it('supports local-day ranges, including a 25-hour DST-end day', async () => {
      const { from, to } = localDayRangeUtc('2026-11-01');
      expect([from, to]).toEqual(['2026-11-01T04:00:00.000Z', '2026-11-02T05:00:00.000Z']);
      await createDoseLog(db, {
        medicationId: medId,
        scheduledFor: '2026-11-02T04:30:00Z',
        status: 'taken',
      });
      expect(await listDoseLogsInRange(db, from, to)).toHaveLength(1);
    });
  });

  describe('scheduled doses', () => {
    const addSchedule = (medicationId: number, extra: Record<string, unknown>) =>
      createSchedule(db, {
        medicationId,
        type: 'daily',
        times: ['08:00'],
        startDate: '2026-10-01',
        doseQuantity: 1,
        ...extra,
      });

    it("expands today's schedules to UTC instants, in time order, with logs attached", async () => {
      const other = await createMedication(db, {
        name: 'B',
        dosageAmount: 1,
        dosageUnit: 'mg',
        form: 'capsule',
      });
      const morning = await addSchedule(medId, { times: ['20:00', '08:00'], doseQuantity: 2 });
      const noon = await addSchedule(other.id, { times: ['12:30'] });
      const log = await recordDose(db, {
        medicationId: medId,
        scheduledFor: '2026-10-01T12:00:00Z',
        status: 'taken',
      });

      const doses = await listTodaysDoses(db, new Date('2026-10-01T15:00:00Z'));
      expect(doses).toEqual([
        {
          medicationId: medId,
          scheduleId: morning.id,
          scheduledFor: '2026-10-01T12:00:00.000Z',
          quantity: 2,
          log,
        },
        {
          medicationId: other.id,
          scheduleId: noon.id,
          scheduledFor: '2026-10-01T16:30:00.000Z',
          quantity: 1,
          log: null,
        },
        {
          medicationId: medId,
          scheduleId: morning.id,
          scheduledFor: '2026-10-02T00:00:00.000Z',
          quantity: 2,
          log: null,
        },
      ]);
    });

    it('uses the local calendar day, not the UTC day', async () => {
      await addSchedule(medId, { times: ['22:00'] });
      // 01:00Z on Oct 2 is still Oct 1 evening in New York.
      const doses = await listTodaysDoses(db, new Date('2026-10-02T01:00:00Z'));
      expect(doses.map((d) => d.scheduledFor)).toEqual(['2026-10-02T02:00:00.000Z']);
    });

    it('honors weekdays, intervals, start/end dates and as-needed', async () => {
      // 2026-10-01 is a Thursday (4).
      await addSchedule(medId, { type: 'weekdays', daysOfWeek: [4, 6] });
      const every3 = await addSchedule(medId, {
        type: 'interval',
        intervalDays: 3,
        times: ['09:00'],
        startDate: '2026-10-02',
        endDate: '2026-10-08',
      });
      await addSchedule(medId, { type: 'as_needed', times: [] });

      const doses = await listScheduledDoses(db, '2026-10-01', '2026-10-10');
      const byDate = (id?: number) =>
        doses
          .filter((d) => (id === undefined ? d.scheduleId !== every3.id : d.scheduleId === id))
          .map((d) => d.scheduledFor.slice(0, 10));
      // Thu 1st, Sat 3rd, Thu 8th, Sat 10th at 08:00 local = 12:00Z
      expect(byDate()).toEqual(['2026-10-01', '2026-10-03', '2026-10-08', '2026-10-10']);
      // Interval anchored at the 2nd: 2nd, 5th, 8th (ends 8th)
      expect(byDate(every3.id)).toEqual(['2026-10-02', '2026-10-05', '2026-10-08']);
    });

    it('skips archived medications', async () => {
      await addSchedule(medId, {});
      await setMedicationActive(db, medId, false);
      expect(await listScheduledDoses(db, '2026-10-01')).toEqual([]);
    });

    it('keeps local wall-clock times across the DST change', async () => {
      await addSchedule(medId, { startDate: '2026-10-30' });
      const doses = await listScheduledDoses(db, '2026-10-31', '2026-11-02');
      expect(doses.map((d) => d.scheduledFor)).toEqual([
        '2026-10-31T12:00:00.000Z', // EDT
        '2026-11-01T13:00:00.000Z', // EST after fall-back
        '2026-11-02T13:00:00.000Z',
      ]);
    });
  });
});
