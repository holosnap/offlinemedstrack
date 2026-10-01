import type { Inventory } from '@/db/models';
import { averageDailyQuantity, timesOn, type ScheduleRule } from './schedule';
import { addDays, type LocalDate } from './time';

/** How far ahead a projection looks; supply lasting longer is reported as "no run-out date". */
export const PROJECTION_HORIZON_DAYS = 730;
/** Window used to estimate how much an as-needed medication is used per day. */
export const AS_NEEDED_WINDOW_DAYS = 30;

const EPSILON = 1e-9;
const MS_PER_DAY = 86_400_000;

export interface SupplyProjection {
  /**
   * `schedule`: simulated dose by dose from the schedules. `average`: as-needed medication,
   * estimated from recent use. `none`: no estimate possible.
   */
  basis: 'schedule' | 'average' | 'none';
  /** Whole days from today until the run-out date (0 = runs out today). Null without an estimate. */
  daysRemaining: number | null;
  /** The date of the first dose that can't be fully covered. Null without an estimate. */
  runOutDate: LocalDate | null;
  /** Average quantity used per day (informational). */
  usagePerDay: number;
  /** The supply outlasts every schedule's end date, so it never runs out on its own. */
  lastsThroughCourse: boolean;
}

export interface ProjectSupplyInput {
  quantity: number;
  schedules: readonly ScheduleRule[];
  today: LocalDate;
  /** Average quantity used per day, for as-needed medications (see `asNeededPerDay`). */
  asNeededPerDay?: number;
}

const NONE: SupplyProjection = {
  basis: 'none',
  daysRemaining: null,
  runOutDate: null,
  usagePerDay: 0,
  lastsThroughCourse: false,
};

/**
 * Average per-day use of an as-needed medication: quantity taken in the last 30 days divided by
 * 30, or by the days since the medication was added if that is shorter (so a new medication isn't
 * underestimated).
 */
export function asNeededPerDay(totalTaken: number, medicationCreatedAt: string, now: Date): number {
  if (!(totalTaken > 0)) return 0;
  const age = Math.ceil((now.getTime() - new Date(medicationCreatedAt).getTime()) / MS_PER_DAY);
  return totalTaken / Math.min(AS_NEEDED_WINDOW_DAYS, Math.max(1, age));
}

/**
 * Projects when the supply runs out. Scheduled medications are simulated dose by dose from
 * `today`, so weekday-only and every-N-days schedules are exact; start and end dates are honoured.
 * As-needed medications fall back to their recent average use.
 */
export function projectSupply(input: ProjectSupplyInput): SupplyProjection {
  const { quantity, today } = input;
  const scheduled = input.schedules.filter((s) => s.type !== 'as_needed');
  const usagePerDay = scheduled.reduce((total, s) => total + averageDailyQuantity(s), 0);

  if (scheduled.length === 0) {
    const perDay = input.asNeededPerDay ?? 0;
    if (!(perDay > 0)) return NONE;
    const days = quantity > 0 ? Math.floor((quantity + EPSILON) / perDay) : 0;
    return {
      basis: 'average',
      daysRemaining: days,
      runOutDate: addDays(today, days),
      usagePerDay: perDay,
      lastsThroughCourse: false,
    };
  }

  let remaining = quantity;
  let anyDose = false;
  for (let offset = 0; offset <= PROJECTION_HORIZON_DAYS; offset++) {
    const date = addDays(today, offset);
    for (const schedule of scheduled) {
      const doses = timesOn(schedule, date).length;
      for (let i = 0; i < doses; i++) {
        anyDose = true;
        if (remaining + EPSILON >= schedule.doseQuantity) {
          remaining -= schedule.doseQuantity;
        } else {
          return {
            basis: 'schedule',
            daysRemaining: offset,
            runOutDate: date,
            usagePerDay,
            lastsThroughCourse: false,
          };
        }
      }
    }
  }
  const ends = scheduled.every((s) => s.endDate !== null);
  return { ...NONE, usagePerDay, lastsThroughCourse: anyDose && ends };
}

/**
 * Whether an inventory has reached its refill threshold. Count thresholds compare against the
 * quantity on hand; day thresholds against `daysRemaining` (null when it can't be estimated,
 * which then never triggers). Inclusive: exactly at the threshold counts as low.
 */
export function isLowSupply(
  inventory: Pick<Inventory, 'currentQuantity' | 'refillThreshold' | 'refillThresholdUnit'>,
  daysRemaining: number | null,
): boolean {
  if (inventory.refillThreshold === null) return false;
  return inventory.refillThresholdUnit === 'count'
    ? inventory.currentQuantity <= inventory.refillThreshold
    : daysRemaining !== null && daysRemaining <= inventory.refillThreshold;
}

export type SupplyStatus = 'ok' | 'low' | 'out' | 'unknown';

/** Overall state for display: out (nothing left), low (at/below threshold), ok, or unknown. */
export function supplyStatus(
  inventory: Pick<Inventory, 'currentQuantity' | 'refillThreshold' | 'refillThresholdUnit'> | null,
  projection: SupplyProjection,
): SupplyStatus {
  if (!inventory) return 'unknown';
  if (inventory.currentQuantity <= 0) return 'out';
  if (isLowSupply(inventory, projection.daysRemaining)) return 'low';
  return projection.basis === 'none' && inventory.refillThreshold === null ? 'unknown' : 'ok';
}
