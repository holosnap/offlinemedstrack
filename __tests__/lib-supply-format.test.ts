import { describeSchedule, formatQuantity } from '@/lib/format';
import { nextDoseAfter, type ScheduleRule } from '@/lib/schedule';
import { dailyUsage, daysOfSupply, estimatedRunOutDate, isLowSupply } from '@/lib/supply';
import { localToUtc, parseTimeInput } from '@/lib/time';

const daily = (times: string[], extra: Partial<ScheduleRule> = {}): ScheduleRule => ({
  type: 'daily',
  times,
  daysOfWeek: null,
  intervalDays: null,
  startDate: '2026-01-01',
  endDate: null,
  doseQuantity: 1,
  ...extra,
});

describe('parseTimeInput', () => {
  it.each([
    ['8', '08:00'],
    ['8:30', '08:30'],
    ['8:30 pm', '20:30'],
    ['8PM', '20:00'],
    ['12 am', '00:00'],
    ['12:15 PM', '12:15'],
    ['20:30', '20:30'],
    ['8:30 a.m.', '08:30'],
  ])('parses %s', (input, expected) => expect(parseTimeInput(input)).toBe(expected));

  it.each(['', 'abc', '25:00', '8:60', '13 pm', '0 am', '8:3'])('rejects %p', (input) =>
    expect(parseTimeInput(input)).toBeNull(),
  );
});

describe('nextDoseAfter', () => {
  const now = new Date(2026, 9, 1, 9, 0); // Oct 1, 09:00 local

  it('picks the next time later today', () => {
    expect(nextDoseAfter([daily(['08:00', '20:00'])], now)).toBe(localToUtc('2026-10-01', '20:00'));
  });

  it('rolls to tomorrow after the last dose', () => {
    expect(nextDoseAfter([daily(['08:00'])], now)).toBe(localToUtc('2026-10-02', '08:00'));
  });

  it('looks across several schedules and respects end dates', () => {
    const ended = daily(['10:00'], { endDate: '2026-09-30' });
    expect(nextDoseAfter([ended, daily(['21:00'])], now)).toBe(localToUtc('2026-10-01', '21:00'));
  });

  it('is null for as-needed or empty', () => {
    expect(nextDoseAfter([], now)).toBeNull();
    expect(nextDoseAfter([daily([], { type: 'as_needed' })], now)).toBeNull();
  });
});

describe('supply estimates', () => {
  it('computes usage, days and run-out date', () => {
    const usage = dailyUsage([daily(['08:00', '20:00'])], '2026-10-01');
    expect(usage).toBe(2);
    expect(daysOfSupply(30, usage)).toBe(15);
    expect(estimatedRunOutDate('2026-10-01', 15.9)).toBe('2026-10-16');
  });

  it('ignores schedules that have not started or have ended', () => {
    const later = daily(['08:00'], { startDate: '2026-12-01' });
    const over = daily(['08:00'], { endDate: '2026-09-01' });
    expect(dailyUsage([later, over], '2026-10-01')).toBe(0);
    expect(daysOfSupply(10, 0)).toBeNull();
    expect(estimatedRunOutDate('2026-10-01', null)).toBeNull();
  });

  it('flags low supply by count or days', () => {
    const count = { currentQuantity: 5, refillThreshold: 5, refillThresholdUnit: 'count' } as const;
    expect(isLowSupply(count, null)).toBe(true);
    expect(isLowSupply({ ...count, currentQuantity: 6 }, null)).toBe(false);
    const days = { currentQuantity: 5, refillThreshold: 7, refillThresholdUnit: 'days' } as const;
    expect(isLowSupply(days, 3)).toBe(true);
    expect(isLowSupply(days, 30)).toBe(false);
    expect(isLowSupply(days, null)).toBe(false);
    expect(isLowSupply({ ...days, refillThreshold: null, refillThresholdUnit: null }, 1)).toBe(
      false,
    );
  });
});

describe('formatting', () => {
  it('formats quantities without trailing zeros', () => {
    expect(formatQuantity(1)).toBe('1');
    expect(formatQuantity(0.5)).toBe('0.5');
    expect(formatQuantity(2.254)).toBe('2.25');
  });

  it('describes schedules', () => {
    expect(
      describeSchedule({
        type: 'weekdays',
        times: ['08:00'],
        daysOfWeek: [1, 3],
        intervalDays: null,
      }),
    ).toMatch(/^Monday, Wednesday at /);
    expect(
      describeSchedule({ type: 'interval', times: ['08:00'], daysOfWeek: null, intervalDays: 3 }),
    ).toMatch(/^Every 3 days at /);
    expect(
      describeSchedule({ type: 'as_needed', times: [], daysOfWeek: null, intervalDays: null }),
    ).toBe('Only when needed');
  });
});
