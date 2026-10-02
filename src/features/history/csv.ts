import type { DayStats } from './adherence';

export const CSV_COLUMNS = [
  'Date',
  'Scheduled time',
  'Medication',
  'Strength',
  'Type',
  'Status',
  'Time taken',
  'Quantity taken',
  'Note',
] as const;

export type CsvRow = Record<(typeof CSV_COLUMNS)[number], string>;

const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (instant: string) => {
  const d = new Date(instant);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/**
 * One cell, escaped for CSV (RFC 4180). Cells that start with `=`, `+`, `-` or `@` get a leading
 * apostrophe so a spreadsheet never runs them as formulas (names and notes are user-entered).
 */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** The rows of the export, oldest day first; as-needed doses are marked with their own type. */
export function historyRows(days: readonly DayStats[]): CsvRow[] {
  const rows: CsvRow[] = [];
  for (const day of days) {
    for (const dose of day.doses) {
      rows.push({
        Date: day.date,
        'Scheduled time': dose.time,
        Medication: dose.name,
        Strength: dose.strength,
        Type: 'Scheduled',
        Status: dose.status,
        'Time taken': dose.status === 'taken' && dose.log?.actedAt ? hhmm(dose.log.actedAt) : '',
        'Quantity taken': dose.status === 'taken' ? String(dose.log?.quantity ?? '') : '',
        Note: dose.log?.note ?? '',
      });
    }
    for (const prn of day.asNeeded) {
      rows.push({
        Date: day.date,
        'Scheduled time': '',
        Medication: prn.name,
        Strength: prn.strength,
        Type: 'As needed',
        Status: 'taken',
        'Time taken': hhmm(prn.log.scheduledFor),
        'Quantity taken': String(prn.log.quantity ?? ''),
        Note: prn.log.note ?? '',
      });
    }
  }
  return rows;
}

/** CSV text with a header row and CRLF line endings. */
export function buildCsv(rows: readonly CsvRow[]): string {
  const lines = [CSV_COLUMNS.map(csvCell).join(',')];
  for (const row of rows) lines.push(CSV_COLUMNS.map((c) => csvCell(row[c])).join(','));
  return lines.join('\r\n') + '\r\n';
}
