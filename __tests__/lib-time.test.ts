import { averageDailyQuantity, scheduleOccursOn, type ScheduleRule } from '@/lib/schedule';
import {
  addDays,
  dayOfWeek,
  diffDays,
  isLocalDate,
  localDateOf,
  localToUtc,
  toUtcIso,
} from '@/lib/time';

describe('time helpers', () => {
  it('runs tests in a non-UTC zone', () => {
    expect(localToUtc('2026-10-01', '08:00')).toBe('2026-10-01T12:00:00.000Z');
    expect(localToUtc('2026-12-01', '08:00')).toBe('2026-12-01T13:00:00.000Z');
  });

  it('normalizes datetimes to canonical UTC and rejects garbage', () => {
    expect(toUtcIso('2026-10-01T08:00:00-04:00')).toBe('2026-10-01T12:00:00.000Z');
    expect(toUtcIso(new Date('2026-10-01T12:00:00Z'))).toBe('2026-10-01T12:00:00.000Z');
    expect(() => toUtcIso('2026-10-01')).toThrow(RangeError);
    expect(() => toUtcIso('nope')).toThrow(RangeError);
    expect(() => toUtcIso(new Date(NaN))).toThrow(RangeError);
  });

  it('does calendar math without DST drift', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(diffDays('2026-10-31', '2026-11-02')).toBe(2);
    expect(dayOfWeek('2026-10-01')).toBe(4);
  });

  it('validates local dates and formats the device-local date', () => {
    expect(isLocalDate('2026-02-29')).toBe(false);
    expect(isLocalDate('2028-02-29')).toBe(true);
    expect(isLocalDate('2026-1-1')).toBe(false);
    // 02:00Z on Oct 2 is still Oct 1 in New York
    expect(localDateOf(new Date('2026-10-02T02:00:00Z'))).toBe('2026-10-01');
  });
});

describe('schedule rules', () => {
  const rule: ScheduleRule = {
    type: 'daily',
    times: ['08:00', '20:00'],
    daysOfWeek: null,
    intervalDays: null,
    startDate: '2026-10-01',
    endDate: '2026-10-31',
    doseQuantity: 2,
  };

  it('respects start and end dates', () => {
    expect(scheduleOccursOn(rule, '2026-09-30')).toBe(false);
    expect(scheduleOccursOn(rule, '2026-10-01')).toBe(true);
    expect(scheduleOccursOn(rule, '2026-10-31')).toBe(true);
    expect(scheduleOccursOn(rule, '2026-11-01')).toBe(false);
  });

  it('estimates average daily usage', () => {
    expect(averageDailyQuantity(rule)).toBe(4);
    expect(averageDailyQuantity({ ...rule, type: 'weekdays', daysOfWeek: [1, 3] })).toBeCloseTo(
      8 / 7,
    );
    expect(averageDailyQuantity({ ...rule, type: 'interval', intervalDays: 2 })).toBe(2);
    expect(averageDailyQuantity({ ...rule, type: 'as_needed', times: [] })).toBe(0);
  });
});
