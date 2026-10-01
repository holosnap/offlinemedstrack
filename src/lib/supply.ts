import type { Inventory } from '@/db/models';
import { averageDailyQuantity, type ScheduleRule } from './schedule';
import { addDays, type LocalDate } from './time';

/** Average quantity used per day by the schedules that are in effect on `today`. */
export function dailyUsage(schedules: readonly ScheduleRule[], today: LocalDate): number {
  return schedules
    .filter((s) => s.startDate <= today && (s.endDate === null || s.endDate >= today))
    .reduce((total, s) => total + averageDailyQuantity(s), 0);
}

/** Days the current quantity lasts at `usagePerDay`; null when usage is unknown or zero. */
export function daysOfSupply(currentQuantity: number, usagePerDay: number): number | null {
  return usagePerDay > 0 ? currentQuantity / usagePerDay : null;
}

/** The calendar date on which the supply is estimated to run out (whole days from `today`). */
export function estimatedRunOutDate(today: LocalDate, days: number | null): LocalDate | null {
  return days === null ? null : addDays(today, Math.floor(days));
}

/**
 * Whether an inventory has reached its refill threshold. Count thresholds compare against the
 * quantity on hand; day thresholds against `days` (null when it can't be estimated, e.g. as-needed
 * use, which then never triggers).
 */
export function isLowSupply(
  inventory: Pick<Inventory, 'currentQuantity' | 'refillThreshold' | 'refillThresholdUnit'>,
  days: number | null,
): boolean {
  if (inventory.refillThreshold === null) return false;
  return inventory.refillThresholdUnit === 'count'
    ? inventory.currentQuantity <= inventory.refillThreshold
    : days !== null && days <= inventory.refillThreshold;
}
