import {
  doseNotificationId,
  medicationIdOfSnooze,
  planDoses,
  snoozeNotificationId,
  type PlannableSchedule,
} from '@/features/reminders/planner';
import { localString, withTimeZone } from '../helpers/fakePort';

// Jest runs in America/New_York (see jest.global-setup.js): EDT = UTC-4, EST = UTC-5.
// 2026 DST: spring forward Sun Mar 8 at 02:00, fall back Sun Nov 1 at 02:00.

let nextId = 1;
const schedule = (over: Partial<PlannableSchedule> = {}): PlannableSchedule => ({
  id: nextId++,
  medicationId: 1,
  type: 'daily',
  times: ['08:00'],
  daysOfWeek: null,
  intervalDays: null,
  startDate: '2026-01-01',
  endDate: null,
  doseQuantity: 1,
  ...over,
});

const local = (doses: { scheduledFor: string }[]) =>
  doses.map((d) => localString(new Date(d.scheduledFor)));

describe('planDoses', () => {
  it('expands daily times into the window, soonest first, excluding the past', () => {
    const doses = planDoses({
      schedules: [schedule({ times: ['20:00', '08:00'] })],
      now: new Date(2026, 5, 10, 12, 0),
      windowDays: 2,
    });
    expect(local(doses)).toEqual([
      '2026-06-10 20:00',
      '2026-06-11 08:00',
      '2026-06-11 20:00',
      '2026-06-12 08:00',
    ]);
  });

  it('does not include a dose scheduled exactly now', () => {
    const doses = planDoses({
      schedules: [schedule()],
      now: new Date(2026, 5, 10, 8, 0),
      windowDays: 1,
    });
    expect(local(doses)).toEqual(['2026-06-11 08:00']);
  });

  it('only plans the selected weekdays', () => {
    const doses = planDoses({
      schedules: [schedule({ type: 'weekdays', daysOfWeek: [1, 3] })], // Mon, Wed
      now: new Date(2026, 5, 7, 0, 30), // Sunday
      windowDays: 7,
    });
    expect(local(doses)).toEqual(['2026-06-08 08:00', '2026-06-10 08:00']);
  });

  it('produces nothing for as-needed schedules', () => {
    const doses = planDoses({
      schedules: [schedule({ type: 'as_needed', times: [] })],
      now: new Date(2026, 5, 10, 0, 0),
    });
    expect(doses).toEqual([]);
  });

  describe('every-N-days schedules', () => {
    it('counts from the start date, not from today', () => {
      const doses = planDoses({
        schedules: [
          schedule({
            type: 'interval',
            intervalDays: 3,
            startDate: '2026-06-01',
            times: ['09:00'],
          }),
        ],
        now: new Date(2026, 5, 10, 8, 0),
        windowDays: 14,
      });
      // Jun 1, 4, 7, 10, 13, 16, 19, 22 ...
      expect(local(doses)).toEqual([
        '2026-06-10 09:00',
        '2026-06-13 09:00',
        '2026-06-16 09:00',
        '2026-06-19 09:00',
        '2026-06-22 09:00',
      ]);
    });

    it('keeps the cadence across a month boundary', () => {
      const doses = planDoses({
        schedules: [
          schedule({
            type: 'interval',
            intervalDays: 2,
            startDate: '2026-06-28',
            times: ['09:00'],
          }),
        ],
        now: new Date(2026, 5, 29, 0, 0),
        windowDays: 6,
      });
      expect(local(doses)).toEqual(['2026-06-30 09:00', '2026-07-02 09:00', '2026-07-04 09:00']);
    });

    it('keeps the cadence and the wall-clock time across the spring DST change', () => {
      const doses = planDoses({
        schedules: [
          schedule({
            type: 'interval',
            intervalDays: 2,
            startDate: '2026-03-06',
            times: ['08:00'],
          }),
        ],
        now: new Date(2026, 2, 5, 12, 0),
        windowDays: 7,
      });
      expect(local(doses)).toEqual([
        '2026-03-06 08:00',
        '2026-03-08 08:00',
        '2026-03-10 08:00',
        '2026-03-12 08:00',
      ]);
      expect(doses.map((d) => d.scheduledFor)).toEqual([
        '2026-03-06T13:00:00.000Z', // EST
        '2026-03-08T12:00:00.000Z', // EDT
        '2026-03-10T12:00:00.000Z',
        '2026-03-12T12:00:00.000Z',
      ]);
    });

    it('is not an off-by-one when the interval is 1', () => {
      const doses = planDoses({
        schedules: [schedule({ type: 'interval', intervalDays: 1 })],
        now: new Date(2026, 5, 10, 12, 0),
        windowDays: 3,
      });
      expect(local(doses)).toEqual(['2026-06-11 08:00', '2026-06-12 08:00', '2026-06-13 08:00']);
    });
  });

  describe('start and end dates', () => {
    it('includes doses on the end date and none after it', () => {
      const doses = planDoses({
        schedules: [schedule({ times: ['08:00', '20:00'], endDate: '2026-06-12' })],
        now: new Date(2026, 5, 10, 12, 0),
        windowDays: 7,
      });
      expect(local(doses)).toEqual([
        '2026-06-10 20:00',
        '2026-06-11 08:00',
        '2026-06-11 20:00',
        '2026-06-12 08:00',
        '2026-06-12 20:00',
      ]);
    });

    it('produces nothing once the end date has passed', () => {
      const doses = planDoses({
        schedules: [schedule({ endDate: '2026-06-09' })],
        now: new Date(2026, 5, 10, 0, 0),
      });
      expect(doses).toEqual([]);
    });

    it('does not start before the start date', () => {
      const doses = planDoses({
        schedules: [schedule({ startDate: '2026-06-12' })],
        now: new Date(2026, 5, 10, 12, 0),
        windowDays: 3,
      });
      expect(local(doses)).toEqual(['2026-06-12 08:00', '2026-06-13 08:00']);
    });

    it('ends an interval schedule on or before the end date', () => {
      const doses = planDoses({
        schedules: [
          schedule({
            type: 'interval',
            intervalDays: 2,
            startDate: '2026-06-10',
            endDate: '2026-06-13',
          }),
        ],
        now: new Date(2026, 5, 9, 0, 0),
        windowDays: 14,
      });
      expect(local(doses)).toEqual(['2026-06-10 08:00', '2026-06-12 08:00']);
    });
  });

  describe('daylight saving time', () => {
    it('fires a time that does not exist (spring forward) once, shortly after the gap', () => {
      const doses = planDoses({
        schedules: [schedule({ times: ['02:30'] })],
        now: new Date(2026, 2, 7, 12, 0),
        windowDays: 3,
      });
      expect(local(doses)).toEqual([
        '2026-03-08 03:30', // 02:30 was skipped
        '2026-03-09 02:30',
        '2026-03-10 02:30',
      ]);
      expect(doses[0].scheduledFor).toBe('2026-03-08T07:30:00.000Z');
    });

    it('fires an ambiguous time (fall back) exactly once, at its first occurrence', () => {
      const doses = planDoses({
        schedules: [schedule({ times: ['01:30'] })],
        now: new Date(2026, 9, 31, 12, 0),
        windowDays: 3,
      });
      expect(local(doses)).toEqual(['2026-11-01 01:30', '2026-11-02 01:30', '2026-11-03 01:30']);
      expect(doses[0].scheduledFor).toBe('2026-11-01T05:30:00.000Z'); // EDT, first 01:30
    });

    it('keeps 08:00 local across fall back, with a one-hour shift in UTC', () => {
      const doses = planDoses({
        schedules: [schedule()],
        now: new Date(2026, 9, 30, 12, 0),
        windowDays: 3,
      });
      expect(local(doses)).toEqual(['2026-10-31 08:00', '2026-11-01 08:00', '2026-11-02 08:00']);
      expect(doses.map((d) => d.scheduledFor)).toEqual([
        '2026-10-31T12:00:00.000Z', // EDT
        '2026-11-01T13:00:00.000Z', // EST
        '2026-11-02T13:00:00.000Z',
      ]);
    });

    it('does not lose or duplicate a dose when two times collapse across the gap', () => {
      const doses = planDoses({
        schedules: [schedule({ times: ['02:30', '03:30'] })],
        now: new Date(2026, 2, 7, 12, 0),
        windowDays: 1,
      });
      expect(local(doses)).toEqual(['2026-03-08 03:30']);
    });
  });

  describe('time zone changes', () => {
    it('re-plans to the same wall-clock times at different instants', async () => {
      const now = new Date('2026-06-10T04:00:00.000Z');
      const input = { schedules: [schedule({ times: ['08:00'] })], now, windowDays: 2 };

      const newYork = await withTimeZone('America/New_York', () => planDoses(input));
      const tokyo = await withTimeZone('Asia/Tokyo', () => planDoses(input));

      expect(await withTimeZone('America/New_York', () => local(newYork))).toEqual([
        '2026-06-10 08:00',
        '2026-06-11 08:00',
      ]);
      expect(await withTimeZone('Asia/Tokyo', () => local(tokyo))).toEqual([
        '2026-06-11 08:00',
        '2026-06-12 08:00',
      ]);
      expect(newYork[0].scheduledFor).toBe('2026-06-10T12:00:00.000Z');
      expect(tokyo[0].scheduledFor).toBe('2026-06-10T23:00:00.000Z');
    });
  });

  describe('selection', () => {
    it('skips doses that are already taken or skipped', () => {
      const [first] = planDoses({ schedules: [schedule()], now: new Date(2026, 5, 10, 0, 0) });
      const doses = planDoses({
        schedules: [schedule()],
        now: new Date(2026, 5, 10, 0, 0),
        windowDays: 2,
        resolved: new Set([`1@${first.scheduledFor}`]),
      });
      expect(local(doses)).toEqual(['2026-06-11 08:00']);
    });

    it('caps the number of doses, keeping the soonest', () => {
      const doses = planDoses({
        schedules: [schedule({ times: ['06:00', '12:00', '18:00', '22:00'] })],
        now: new Date(2026, 5, 10, 0, 0),
        maxDoses: 5,
      });
      expect(local(doses)).toEqual([
        '2026-06-10 06:00',
        '2026-06-10 12:00',
        '2026-06-10 18:00',
        '2026-06-10 22:00',
        '2026-06-11 06:00',
      ]);
    });

    it('keeps the default plan under the iOS limit of 64 even with many medications', () => {
      const schedules = Array.from({ length: 10 }, (_, i) =>
        schedule({ medicationId: i + 1, times: ['07:00', '12:00', '17:00', '22:00'] }),
      );
      const doses = planDoses({ schedules, now: new Date(2026, 5, 10, 0, 0) });
      expect(doses.length).toBeLessThan(64);
    });

    it('plans multiple medications with the same time separately', () => {
      const doses = planDoses({
        schedules: [schedule({ medicationId: 1 }), schedule({ medicationId: 2 })],
        now: new Date(2026, 5, 10, 0, 0),
        windowDays: 1,
      });
      expect(doses.map((d) => d.medicationId)).toEqual([1, 2]);
    });
  });
});

describe('notification identifiers', () => {
  it('encodes and recovers the medication of a snooze', () => {
    const id = snoozeNotificationId(42, '2026-06-10T12:00:00.000Z');
    expect(medicationIdOfSnooze(id)).toBe(42);
    expect(medicationIdOfSnooze(doseNotificationId(42, '2026-06-10T12:00:00.000Z'))).toBeNull();
  });
});
