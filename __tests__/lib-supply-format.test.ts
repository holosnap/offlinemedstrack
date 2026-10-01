import { describeSchedule, formatQuantity } from '@/lib/format';
import { nextDoseAfter, type ScheduleRule } from '@/lib/schedule';
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
