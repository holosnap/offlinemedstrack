import type { Database } from '@/db/types';
import { addDays, localDateOf } from '@/lib/time';
import { buildCsv, historyRows } from './csv';
import { earliestLogDate, loadDayStats } from './data';
import type { FileExporter } from './exporter';
import { renderHistoryHtml } from './pdf';
import { rangeAdherence } from './summary';

export type ExportFormat = 'csv' | 'pdf';
export type ExportRange = 30 | 90 | 'all';

export const EXPORT_RANGES: readonly { value: ExportRange; label: string }[] = [
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
  { value: 'all', label: 'All history' },
];

/**
 * Builds the history for the chosen period as a CSV or PDF file and opens the share sheet so it can
 * be sent to a doctor, saved, or printed. Nothing leaves the device unless the person picks a
 * destination in the share sheet.
 */
export async function exportHistory(
  db: Database,
  exporter: FileExporter,
  options: { format: ExportFormat; range: ExportRange; now?: Date },
): Promise<{ fileName: string; rows: number }> {
  const now = options.now ?? new Date();
  const today = localDateOf(now);
  const earliest = options.range === 'all' ? await earliestLogDate(db) : null;
  const from =
    options.range === 'all'
      ? earliest !== null && earliest < today
        ? earliest
        : today
      : addDays(today, -(options.range - 1));

  if (!(await exporter.canShare())) throw new Error('Sharing is not available on this device.');
  const { days, medications } = await loadDayStats(db, from, today, now);
  const rows = historyRows(days);
  if (rows.length === 0) throw new Error('There are no recorded doses in that period to export.');

  const fileName = `medication-history-${today}.${options.format}`;
  let uri: string;
  if (options.format === 'csv') {
    uri = await exporter.writeText(fileName, buildCsv(rows));
  } else {
    const html = renderHistoryHtml({
      from,
      to: today,
      generatedOn: today,
      summary: rangeAdherence(days, medications),
      days,
    });
    uri = await exporter.htmlToPdf(fileName, html);
  }
  await exporter.share(uri, options.format, 'Share medication history');
  return { fileName, rows: rows.length };
}
