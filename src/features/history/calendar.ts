import { addDays, dayOfWeek, type LocalDate } from '@/lib/time';

export interface MonthRef {
  year: number;
  /** 1-12 */
  month: number;
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

export const monthOf = (date: LocalDate): MonthRef => ({
  year: Number(date.slice(0, 4)),
  month: Number(date.slice(5, 7)),
});

export const firstOfMonth = ({ year, month }: MonthRef): LocalDate =>
  `${pad(year, 4)}-${pad(month)}-01`;

export function addMonths({ year, month }: MonthRef, delta: number): MonthRef {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function lastOfMonth(ref: MonthRef): LocalDate {
  return addDays(firstOfMonth(addMonths(ref, 1)), -1);
}

/** Month and year as a heading, e.g. "June 2026". */
export function monthTitle(ref: MonthRef): string {
  return new Date(ref.year, ref.month - 1, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}

/**
 * The weeks to draw for a month, Sunday first. Days outside the month are `null`, so every row has
 * seven cells (rows are only as many as the month needs: 4 to 6).
 */
export function monthGrid(ref: MonthRef): (LocalDate | null)[][] {
  const first = firstOfMonth(ref);
  const last = lastOfMonth(ref);
  const cells: (LocalDate | null)[] = Array.from({ length: dayOfWeek(first) }, () => null);
  for (let date = first; date <= last; date = addDays(date, 1)) cells.push(date);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (LocalDate | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}
