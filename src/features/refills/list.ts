import type { MedicationSummary } from '@/features/medications/summary';
import type { LocalDate } from '@/lib/time';

/**
 * Active medications ordered by soonest run-out date. Out-of-supply medications come first,
 * then by estimated run-out date; medications with no estimate follow, and those with no supply
 * recorded come last. Ties break on name.
 */
export function buildRefillList(
  summaries: readonly MedicationSummary[],
  today: LocalDate,
): MedicationSummary[] {
  const rank = (s: MedicationSummary): [number, string] => {
    if (!s.inventory) return [3, ''];
    if (s.inventory.currentQuantity <= 0) return [0, today];
    if (s.runOutDate !== null) return [1, s.runOutDate];
    return [2, ''];
  };
  return summaries
    .filter((s) => s.medication.active)
    .sort((a, b) => {
      const [ra, da] = rank(a);
      const [rb, db] = rank(b);
      return (
        ra - rb ||
        da.localeCompare(db) ||
        a.medication.name.localeCompare(b.medication.name, undefined, { sensitivity: 'base' })
      );
    });
}
