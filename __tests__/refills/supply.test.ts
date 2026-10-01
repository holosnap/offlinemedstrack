import type { ScheduleRule } from '@/lib/schedule';
import { asNeededPerDay, isLowSupply, projectSupply, supplyStatus } from '@/lib/supply';

const rule = (over: Partial<ScheduleRule> = {}): ScheduleRule => ({
  type: 'daily',
  times: ['08:00'],
  daysOfWeek: null,
  intervalDays: null,
  startDate: '2026-01-01',
  endDate: null,
  doseQuantity: 1,
  ...over,
});

// 2026-06-10 is a Wednesday.
const TODAY = '2026-06-10';
const project = (quantity: number, schedules: ScheduleRule[], perDay?: number) =>
  projectSupply({ quantity, schedules, today: TODAY, asNeededPerDay: perDay });

describe('projectSupply: daily schedules', () => {
  it('runs out on the day the first uncovered dose falls', () => {
    // 30 tablets at 2/day last 15 days (Jun 10..24); the first uncovered dose is Jun 25.
    const p = project(30, [rule({ times: ['08:00', '20:00'] })]);
    expect(p).toMatchObject({ basis: 'schedule', daysRemaining: 15, runOutDate: '2026-06-25' });
    expect(p.usagePerDay).toBe(2);
  });

  it('counts a partly covered last day as running out that day', () => {
    // 3 tablets, 2 doses/day: day 0 uses 2, day 1 covers one dose then the 20:00 dose is short.
    const p = project(3, [rule({ times: ['08:00', '20:00'] })]);
    expect(p).toMatchObject({ daysRemaining: 1, runOutDate: '2026-06-11' });
  });

  it('uses the dose quantity and handles fractions', () => {
    expect(project(10, [rule({ doseQuantity: 2 })])).toMatchObject({ daysRemaining: 5 });
    expect(project(1.5, [rule({ doseQuantity: 0.5 })])).toMatchObject({ daysRemaining: 3 });
    expect(project(0.3, [rule({ doseQuantity: 0.1 })])).toMatchObject({ daysRemaining: 3 });
  });

  it('is out today with nothing left', () => {
    expect(project(0, [rule()])).toMatchObject({ daysRemaining: 0, runOutDate: TODAY });
  });

  it('adds up several schedules', () => {
    const p = project(20, [rule({ doseQuantity: 2 }), rule({ times: ['12:00'], doseQuantity: 3 })]);
    expect(p).toMatchObject({ daysRemaining: 4 }); // 5 per day
  });
});

describe('projectSupply: weekday-only schedules', () => {
  const monWedFri = rule({ type: 'weekdays', daysOfWeek: [1, 3, 5] });

  it('only consumes on the chosen days', () => {
    // Doses: Wed Jun 10, Fri 12, Mon 15, Wed 17, Fri 19. Five tablets cover them; Mon 22 is short.
    const p = project(5, [monWedFri]);
    expect(p).toMatchObject({ runOutDate: '2026-06-22', daysRemaining: 12 });
  });

  it('is exact when today is not a dosing day', () => {
    // Today is Wednesday; a Tuesday/Thursday schedule starts Thursday Jun 11.
    const tueThu = rule({ type: 'weekdays', daysOfWeek: [2, 4] });
    const p = project(2, [tueThu]); // Jun 11, Jun 16 covered; Jun 18 is short
    expect(p).toMatchObject({ runOutDate: '2026-06-18', daysRemaining: 8 });
  });

  it('reports a fractional average usage of quantity x days / 7', () => {
    expect(project(5, [monWedFri]).usagePerDay).toBeCloseTo(3 / 7);
  });
});

describe('projectSupply: every-N-days schedules', () => {
  it('counts from the schedule start date', () => {
    // Every 3 days from Jun 1: Jun 1, 4, 7, 10, 13, 16 ... Today (Jun 10) is a dose day.
    const p = project(2, [rule({ type: 'interval', intervalDays: 3, startDate: '2026-06-01' })]);
    expect(p).toMatchObject({ runOutDate: '2026-06-16', daysRemaining: 6 }); // 10, 13 covered
  });

  it('starts at the next dose day when today is between doses', () => {
    // Every 4 days from Jun 1: Jun 1, 5, 9, 13, 17. First dose from today is Jun 13.
    const p = project(1, [rule({ type: 'interval', intervalDays: 4, startDate: '2026-06-01' })]);
    expect(p).toMatchObject({ runOutDate: '2026-06-17', daysRemaining: 7 });
  });
});

describe('projectSupply: start and end dates', () => {
  it('does not consume before the start date', () => {
    const p = project(2, [rule({ startDate: '2026-06-20' })]);
    expect(p).toMatchObject({ runOutDate: '2026-06-22', daysRemaining: 12 });
  });

  it('reports that supply lasts through a course that ends first', () => {
    const p = project(30, [rule({ endDate: '2026-06-19' })]); // 10 doses needed
    expect(p).toMatchObject({
      basis: 'none',
      runOutDate: null,
      daysRemaining: null,
      lastsThroughCourse: true,
    });
  });

  it('runs out inside the course when supply is short', () => {
    const p = project(5, [rule({ endDate: '2026-06-19' })]);
    expect(p).toMatchObject({ basis: 'schedule', runOutDate: '2026-06-15' });
  });

  it('has no estimate without any schedule', () => {
    expect(project(10, [])).toMatchObject({ basis: 'none', runOutDate: null });
  });
});

describe('projectSupply: as-needed medications', () => {
  const prn = rule({ type: 'as_needed', times: [] });

  it('is excluded from the schedule projection and uses recent average use', () => {
    const p = project(30, [prn], 2);
    expect(p).toMatchObject({ basis: 'average', daysRemaining: 15, runOutDate: '2026-06-25' });
  });

  it('has no estimate when there is no usage history', () => {
    expect(project(30, [prn])).toMatchObject({ basis: 'none', runOutDate: null });
    expect(project(30, [prn], 0)).toMatchObject({ basis: 'none' });
  });

  it('is out today with nothing left', () => {
    expect(project(0, [prn], 1)).toMatchObject({ daysRemaining: 0, runOutDate: TODAY });
  });
});

describe('asNeededPerDay', () => {
  const now = new Date('2026-06-10T12:00:00.000Z');

  it('divides by 30 days for an established medication', () => {
    expect(asNeededPerDay(60, '2026-01-01T00:00:00.000Z', now)).toBe(2);
  });

  it('divides by the days since the medication was added when that is shorter', () => {
    // Added 5 days ago: 10 taken in 5 days is 2/day, not 10/30.
    expect(asNeededPerDay(10, '2026-06-05T12:00:00.000Z', now)).toBe(2);
  });

  it('never divides by less than a day and is 0 without use', () => {
    expect(asNeededPerDay(3, '2026-06-10T11:00:00.000Z', now)).toBe(3);
    expect(asNeededPerDay(0, '2026-01-01T00:00:00.000Z', now)).toBe(0);
  });
});

describe('threshold triggering', () => {
  const days = (n: number) => ({
    currentQuantity: 10,
    refillThreshold: n,
    refillThresholdUnit: 'days' as const,
  });
  const count = (n: number, qty: number) => ({
    currentQuantity: qty,
    refillThreshold: n,
    refillThresholdUnit: 'count' as const,
  });

  it('triggers when days remaining reach the threshold (inclusive)', () => {
    expect(isLowSupply(days(7), 8)).toBe(false);
    expect(isLowSupply(days(7), 7)).toBe(true);
    expect(isLowSupply(days(7), 0)).toBe(true);
  });

  it('triggers when the count reaches the threshold (inclusive)', () => {
    expect(isLowSupply(count(5, 6), 99)).toBe(false);
    expect(isLowSupply(count(5, 5), 99)).toBe(true);
    expect(isLowSupply(count(5, 0), null)).toBe(true);
  });

  it('never triggers by days without an estimate, or without a threshold', () => {
    expect(isLowSupply(days(7), null)).toBe(false);
    expect(
      isLowSupply({ currentQuantity: 1, refillThreshold: null, refillThresholdUnit: null }, 0),
    ).toBe(false);
  });

  it('classifies overall supply status', () => {
    const inv = days(7);
    const lots = project(100, [rule()]);
    const few = project(5, [rule()]);
    expect(supplyStatus(null, lots)).toBe('unknown');
    expect(supplyStatus({ ...inv, currentQuantity: 0 }, few)).toBe('out');
    expect(supplyStatus(inv, few)).toBe('low');
    expect(supplyStatus(inv, lots)).toBe('ok');
    expect(supplyStatus(inv, project(10, []))).toBe('ok');
    expect(
      supplyStatus({ ...inv, refillThreshold: null, refillThresholdUnit: null }, project(10, [])),
    ).toBe('unknown');
  });
});
