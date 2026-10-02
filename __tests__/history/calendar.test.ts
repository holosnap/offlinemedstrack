import {
  addMonths,
  firstOfMonth,
  lastOfMonth,
  monthGrid,
  monthOf,
  monthTitle,
} from '@/features/history/calendar';
import { dayOfWeek } from '@/lib/time';

describe('monthGrid', () => {
  const flat = (year: number, month: number) => monthGrid({ year, month }).flat();

  it('is Sunday-first with blanks before the 1st and after the last day', () => {
    const grid = monthGrid({ year: 2026, month: 6 }); // June 1 2026 is a Monday
    expect(grid[0].slice(0, 2)).toEqual([null, '2026-06-01']);
    expect(grid.every((week) => week.length === 7)).toBe(true);
    expect(flat(2026, 6).filter(Boolean)).toHaveLength(30);
    expect(grid.at(-1)?.at(-1)).toBeNull();
  });

  it('puts the 1st under the right weekday for every month of a year', () => {
    for (let month = 1; month <= 12; month++) {
      const first = firstOfMonth({ year: 2026, month });
      expect(monthGrid({ year: 2026, month })[0].indexOf(first)).toBe(dayOfWeek(first));
    }
  });

  it('uses four rows when February starts on a Sunday', () => {
    expect(monthGrid({ year: 2026, month: 2 })).toHaveLength(4);
  });

  it('uses six rows for a long month starting late in the week', () => {
    expect(monthGrid({ year: 2026, month: 8 })).toHaveLength(6); // Aug 1 2026 is a Saturday
  });

  it('knows leap years', () => {
    expect(flat(2028, 2).filter(Boolean)).toHaveLength(29);
    expect(lastOfMonth({ year: 2028, month: 2 })).toBe('2028-02-29');
    expect(lastOfMonth({ year: 2026, month: 2 })).toBe('2026-02-28');
    expect(lastOfMonth({ year: 2100, month: 2 })).toBe('2100-02-28');
  });
});

describe('month arithmetic', () => {
  it('rolls over year boundaries in both directions', () => {
    expect(addMonths({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(addMonths({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(addMonths({ year: 2026, month: 6 }, -18)).toEqual({ year: 2024, month: 12 });
    expect(addMonths({ year: 2026, month: 6 }, 0)).toEqual({ year: 2026, month: 6 });
  });

  it('reads a month from a date and titles it', () => {
    expect(monthOf('2026-06-10')).toEqual({ year: 2026, month: 6 });
    expect(monthTitle({ year: 2026, month: 6 })).toContain('2026');
  });
});
