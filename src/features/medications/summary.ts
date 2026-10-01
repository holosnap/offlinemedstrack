import type { Inventory, Medication, Schedule } from '@/db/models';
import { nextDoseAfter } from '@/lib/schedule';
import {
  projectSupply,
  supplyStatus,
  type SupplyProjection,
  type SupplyStatus,
} from '@/lib/supply';
import { localDateOf, type LocalDate, type UtcIso } from '@/lib/time';

export interface MedicationSummary {
  medication: Medication;
  schedules: Schedule[];
  inventory: Inventory | null;
  /** Null when paused, as-needed, or nothing is coming up. */
  nextDose: UtcIso | null;
  projection: SupplyProjection;
  /** Whole days until the supply runs out; null if it can't be estimated. */
  daysOfSupply: number | null;
  /** Estimated date the supply runs out; null if it can't be estimated. */
  runOutDate: LocalDate | null;
  supplyStatus: SupplyStatus;
  lowSupply: boolean;
  asNeeded: boolean;
}

export function buildSummary(
  medication: Medication,
  schedules: Schedule[],
  inventory: Inventory | null,
  now: Date,
  /** Recent average use per day; only used for as-needed medications. */
  asNeededPerDay = 0,
): MedicationSummary {
  const today = localDateOf(now);
  const projection = inventory
    ? projectSupply({ quantity: inventory.currentQuantity, schedules, today, asNeededPerDay })
    : projectSupply({ quantity: 0, schedules: [], today });
  const status = supplyStatus(inventory, projection);
  return {
    medication,
    schedules,
    inventory,
    nextDose: medication.active ? nextDoseAfter(schedules, now) : null,
    projection,
    daysOfSupply: projection.daysRemaining,
    runOutDate: projection.runOutDate,
    supplyStatus: status,
    lowSupply: status === 'low',
    asNeeded: schedules.length > 0 && schedules.every((s) => s.type === 'as_needed'),
  };
}
