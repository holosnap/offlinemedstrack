import type { DoseLog } from '@/db/models';
import { consumedQuantity } from '@/features/doses/state';
import { formatClock, formatQuantity } from '@/lib/format';
import type { DayStatus, HistoryDose } from './adherence';

export const DAY_SYMBOLS: Record<DayStatus, string> = {
  all_taken: '✓',
  partial: '◐',
  none: '✗',
  no_doses: '–',
  pending: '…',
  future: '',
};

export const DAY_LABELS: Record<DayStatus, string> = {
  all_taken: 'all doses taken',
  partial: 'some doses missed',
  none: 'no doses taken',
  no_doses: 'no doses scheduled',
  pending: 'doses due, not yet recorded',
  future: 'upcoming',
};

/** One line for a scheduled dose's outcome, e.g. "Taken at 8:20 AM" or "Missed". */
export function doseStatusText(dose: HistoryDose): string {
  switch (dose.status) {
    case 'taken': {
      const at = dose.log?.actedAt ? ` at ${formatClock(dose.log.actedAt)}` : '';
      const qty = dose.log?.quantity;
      const different =
        qty != null && qty !== dose.quantity ? `, ${formatQuantity(qty)} taken` : '';
      return `Taken${at}${different}`;
    }
    case 'skipped':
      return 'Skipped';
    case 'missed':
      return 'Missed';
    case 'pending':
      return 'Due, not yet recorded';
  }
}

/**
 * What saving an edit does to the supply, in words ("This will use 2 tablets of your supply"), or
 * null when nothing changes. `next` is the quantity the dose will count as taken (0 if not taken).
 */
export function supplyEffectText(
  prior: Pick<DoseLog, 'status' | 'quantity' | 'supplyUsed'> | null,
  nextTaken: number,
  unit: string,
): string | null {
  const delta = nextTaken - consumedQuantity(prior);
  if (delta === 0) return null;
  const amount = `${formatQuantity(Math.abs(delta))} ${unit}`;
  return delta > 0
    ? `This will use ${amount} of your supply.`
    : `This will add ${amount} back to your supply.`;
}
