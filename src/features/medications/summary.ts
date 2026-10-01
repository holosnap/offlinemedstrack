import type { Inventory, Medication, Schedule } from '@/db/models';
import { nextDoseAfter } from '@/lib/schedule';
import { dailyUsage, daysOfSupply, estimatedRunOutDate, isLowSupply } from '@/lib/supply';
import { localDateOf, type LocalDate, type UtcIso } from '@/lib/time';

export interface MedicationSummary {
  medication: Medication;
  schedules: Schedule[];
  inventory: Inventory | null;
  /** Null when paused, as-needed, or nothing is coming up. */
  nextDose: UtcIso | null;
  /** Estimated days left at the scheduled rate; null if it can't be estimated. */
  daysOfSupply: number | null;
  /** Estimated date the supply runs out; null if it can't be estimated. */
  runOutDate: LocalDate | null;
  lowSupply: boolean;
  asNeeded: boolean;
}

export function buildSummary(
  medication: Medication,
  schedules: Schedule[],
  inventory: Inventory | null,
  now: Date,
): MedicationSummary {
  const today = localDateOf(now);
  const days = inventory
    ? daysOfSupply(inventory.currentQuantity, dailyUsage(schedules, today))
    : null;
  return {
    medication,
    schedules,
    inventory,
    nextDose: medication.active ? nextDoseAfter(schedules, now) : null,
    daysOfSupply: days,
    runOutDate: estimatedRunOutDate(today, days),
    lowSupply: inventory !== null && isLowSupply(inventory, days),
    asNeeded: schedules.length > 0 && schedules.every((s) => s.type === 'as_needed'),
  };
}
