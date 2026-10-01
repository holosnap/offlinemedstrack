import type { MedicationSummary } from '@/features/medications/summary';
import { AS_NEEDED_WINDOW_DAYS } from '@/lib/supply';
import { formatLocalDate, formatQuantity } from '@/lib/format';

export function daysLeftText(days: number): string {
  if (days === 0) return 'less than a day left';
  return `about ${days} ${days === 1 ? 'day' : 'days'} left`;
}

/** What the person has on hand, e.g. "12 tablets". */
export function onHandText(summary: MedicationSummary): string {
  if (!summary.inventory) return 'No supply recorded';
  return `${formatQuantity(summary.inventory.currentQuantity)} ${summary.inventory.unit}`;
}

/** The estimated run-out date with days left, or why there is no estimate. */
export function runOutLabel(summary: MedicationSummary): string {
  const { inventory, projection } = summary;
  if (!inventory) return 'Not available';
  if (inventory.currentQuantity <= 0) return 'Out of supply';
  if (projection.lastsThroughCourse) return 'Enough for the rest of your course';
  if (projection.runOutDate === null || projection.daysRemaining === null) {
    return summary.asNeeded
      ? `Can't estimate yet. Log some doses and it will use your average over the last ${AS_NEEDED_WINDOW_DAYS} days`
      : "Can't estimate. There is no active schedule";
  }
  const date = formatLocalDate(projection.runOutDate, { weekday: true });
  return `${date} (${daysLeftText(projection.daysRemaining)})`;
}

/** Note shown under the run-out date when it comes from average use rather than a schedule. */
export function runOutBasisNote(summary: MedicationSummary): string | null {
  return summary.projection.basis === 'average'
    ? `Based on your average use over the last ${AS_NEEDED_WINDOW_DAYS} days`
    : null;
}

/** One-line supply indicator for lists, e.g. "12 tablets · about 8 days left". */
export function supplyIndicator(summary: MedicationSummary): string {
  if (!summary.inventory) return 'No supply recorded';
  if (summary.inventory.currentQuantity <= 0) return 'Out of supply';
  const onHand = onHandText(summary);
  const days = summary.projection.daysRemaining;
  if (summary.projection.lastsThroughCourse) return `${onHand} · enough for your course`;
  return days === null ? onHand : `${onHand} · ${daysLeftText(days)}`;
}
