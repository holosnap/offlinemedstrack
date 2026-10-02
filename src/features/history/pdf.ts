import type { DayStats } from './adherence';
import type { RangeAdherence } from './summary';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const pad = (n: number) => String(n).padStart(2, '0');
const clock = (instant: string) => {
  const d = new Date(instant);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const STATUS_LABEL = {
  taken: 'Taken',
  skipped: 'Skipped',
  missed: 'Missed',
  pending: 'Due',
} as const;

export interface HistoryReport {
  from: string;
  to: string;
  generatedOn: string;
  summary: readonly RangeAdherence[];
  days: readonly DayStats[];
}

/** Printable HTML of the history (all user text is escaped). */
export function renderHistoryHtml(report: HistoryReport): string {
  const summaryRows = report.summary
    .map(
      (r) =>
        `<tr><td>${escapeHtml(r.name)}</td><td>${
          r.percent === null ? 'No scheduled doses' : `${r.percent}%`
        }</td><td>${r.taken} of ${r.expected}</td><td>${r.skipped}</td><td>${r.missed}</td><td>${r.asNeededDoses}</td></tr>`,
    )
    .join('');

  const dayBlocks = report.days
    .filter((d) => d.doses.length > 0 || d.asNeeded.length > 0)
    .map((day) => {
      const rows = [
        ...day.doses.map(
          (d) =>
            `<tr><td>${d.time}</td><td>${escapeHtml(d.name)}</td><td>${escapeHtml(d.strength)}</td><td>${
              STATUS_LABEL[d.status]
            }</td><td>${d.status === 'taken' && d.log?.actedAt ? clock(d.log.actedAt) : ''}</td><td>${
              d.status === 'taken' ? String(d.log?.quantity ?? '') : ''
            }</td><td>${escapeHtml(d.log?.note ?? '')}</td></tr>`,
        ),
        ...day.asNeeded.map(
          (a) =>
            `<tr><td>${clock(a.log.scheduledFor)}</td><td>${escapeHtml(a.name)} (as needed)</td><td>${escapeHtml(
              a.strength,
            )}</td><td>Taken</td><td>${clock(a.log.scheduledFor)}</td><td>${String(
              a.log.quantity ?? '',
            )}</td><td>${escapeHtml(a.log.note ?? '')}</td></tr>`,
        ),
      ].join('');
      return `<h3>${escapeHtml(day.date)}</h3><table><thead><tr><th>Time</th><th>Medication</th><th>Strength</th><th>Status</th><th>Taken at</th><th>Qty</th><th>Note</th></tr></thead><tbody>${rows}</tbody></table>`;
    })
    .join('');

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Medication history</title>
<style>
  body { font-family: -apple-system, Roboto, Helvetica, Arial, sans-serif; color: #111; margin: 24px; }
  h1 { font-size: 22px; margin: 0 0 4px; } h2 { font-size: 17px; margin: 24px 0 8px; }
  h3 { font-size: 14px; margin: 16px 0 4px; } p { margin: 2px 0; font-size: 13px; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; }
  th, td { border: 1px solid #999; padding: 4px 6px; text-align: left; } th { background: #eee; }
</style></head><body>
<h1>Medication history</h1>
<p>${escapeHtml(report.from)} to ${escapeHtml(report.to)}</p>
<p>Prepared on ${escapeHtml(report.generatedOn)} from the OfflineMedsTrack app on this device.</p>
<h2>Adherence summary</h2>
<table><thead><tr><th>Medication</th><th>Adherence</th><th>Taken</th><th>Skipped</th><th>Missed</th><th>As-needed doses</th></tr></thead><tbody>${summaryRows}</tbody></table>
<p>Adherence = doses taken divided by doses due. Skipped and missed doses count as not taken.</p>
<h2>Dose log</h2>
${dayBlocks || '<p>No doses recorded in this period.</p>'}
</body></html>`;
}
