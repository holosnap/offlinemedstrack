import { NotFoundError } from '../errors';
import { REFILL_THRESHOLD_UNITS, type Inventory, type RefillThresholdUnit } from '../models';
import { buildSet } from '../sql';
import type { Database } from '../types';
import { asNeededPerDay, AS_NEEDED_WINDOW_DAYS, isLowSupply, projectSupply } from '@/lib/supply';
import { addDays, localDateOf, localDayRangeUtc, nowUtc } from '@/lib/time';
import { sumTakenByMedication } from './doseLogs';
import { getMedication } from './medications';
import { listActiveSchedulesInRange } from './schedules';

interface InventoryRow {
  medication_id: number;
  current_quantity: number;
  unit: string;
  refill_threshold: number | null;
  refill_threshold_unit: RefillThresholdUnit | null;
  refills_remaining: number | null;
  pharmacy_name: string | null;
  pharmacy_phone: string | null;
  prescription_number: string | null;
  updated_at: string;
}

export interface NewInventory {
  medicationId: number;
  currentQuantity: number;
  unit: string;
  refillThreshold?: number | null;
  refillThresholdUnit?: RefillThresholdUnit | null;
  refillsRemaining?: number | null;
  pharmacyName?: string | null;
  pharmacyPhone?: string | null;
  prescriptionNumber?: string | null;
}

export type InventoryUpdate = Partial<Omit<NewInventory, 'medicationId'>>;

/** An inventory that has reached its refill threshold. */
export interface LowStockItem {
  inventory: Inventory;
  /** Estimated days left from the active schedules; null if there is no scheduled usage. */
  daysOfSupply: number | null;
}

const toInventory = (row: InventoryRow): Inventory => ({
  medicationId: row.medication_id,
  currentQuantity: row.current_quantity,
  unit: row.unit,
  refillThreshold: row.refill_threshold,
  refillThresholdUnit: row.refill_threshold_unit,
  refillsRemaining: row.refills_remaining,
  pharmacyName: row.pharmacy_name,
  pharmacyPhone: row.pharmacy_phone,
  prescriptionNumber: row.prescription_number,
  updatedAt: row.updated_at,
});

function validate(input: InventoryUpdate): void {
  if (input.currentQuantity !== undefined && !(input.currentQuantity >= 0)) {
    throw new RangeError('Current quantity cannot be negative');
  }
  if (input.refillThreshold != null && !(input.refillThreshold >= 0)) {
    throw new RangeError('Refill threshold cannot be negative');
  }
  if (
    input.refillThresholdUnit != null &&
    !REFILL_THRESHOLD_UNITS.includes(input.refillThresholdUnit)
  ) {
    throw new RangeError(`Invalid refill threshold unit "${input.refillThresholdUnit}"`);
  }
  if (input.refillsRemaining != null) {
    if (!Number.isInteger(input.refillsRemaining) || input.refillsRemaining < 0) {
      throw new RangeError('Refills remaining must be a non-negative integer');
    }
  }
}

export async function createInventory(db: Database, input: NewInventory): Promise<Inventory> {
  validate(input);
  if ((input.refillThreshold == null) !== (input.refillThresholdUnit == null)) {
    throw new RangeError('refillThreshold and refillThresholdUnit must be set together');
  }
  await db.runAsync(
    `INSERT INTO inventory
       (medication_id, current_quantity, unit, refill_threshold, refill_threshold_unit,
        refills_remaining, pharmacy_name, pharmacy_phone, prescription_number, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.medicationId,
      input.currentQuantity,
      input.unit,
      input.refillThreshold ?? null,
      input.refillThresholdUnit ?? null,
      input.refillsRemaining ?? null,
      input.pharmacyName ?? null,
      input.pharmacyPhone ?? null,
      input.prescriptionNumber ?? null,
      nowUtc(),
    ],
  );
  return getInventoryOrThrow(db, input.medicationId);
}

export async function getInventory(db: Database, medicationId: number): Promise<Inventory | null> {
  const row = await db.getFirstAsync<InventoryRow>(
    'SELECT * FROM inventory WHERE medication_id = ?',
    [medicationId],
  );
  return row ? toInventory(row) : null;
}

async function getInventoryOrThrow(db: Database, medicationId: number): Promise<Inventory> {
  const inventory = await getInventory(db, medicationId);
  if (!inventory) throw new NotFoundError('Inventory', medicationId);
  return inventory;
}

export async function listInventory(db: Database): Promise<Inventory[]> {
  const rows = await db.getAllAsync<InventoryRow>('SELECT * FROM inventory ORDER BY medication_id');
  return rows.map(toInventory);
}

export async function updateInventory(
  db: Database,
  medicationId: number,
  patch: InventoryUpdate,
): Promise<Inventory> {
  validate(patch);
  const { clause, params } = buildSet({
    current_quantity: patch.currentQuantity,
    unit: patch.unit,
    refill_threshold: patch.refillThreshold,
    refill_threshold_unit: patch.refillThresholdUnit,
    refills_remaining: patch.refillsRemaining,
    pharmacy_name: patch.pharmacyName,
    pharmacy_phone: patch.pharmacyPhone,
    prescription_number: patch.prescriptionNumber,
    updated_at: nowUtc(),
  });
  const result = await db.runAsync(`UPDATE inventory SET ${clause} WHERE medication_id = ?`, [
    ...params,
    medicationId,
  ]);
  if (result.changes === 0) throw new NotFoundError('Inventory', medicationId);
  return getInventoryOrThrow(db, medicationId);
}

/** Adds `delta` (negative to consume) to the current quantity, never going below zero. */
export async function adjustInventoryQuantity(
  db: Database,
  medicationId: number,
  delta: number,
): Promise<Inventory> {
  const result = await db.runAsync(
    `UPDATE inventory SET current_quantity = max(0, current_quantity + ?), updated_at = ?
      WHERE medication_id = ?`,
    [delta, nowUtc(), medicationId],
  );
  if (result.changes === 0) throw new NotFoundError('Inventory', medicationId);
  return getInventoryOrThrow(db, medicationId);
}

export async function deleteInventory(db: Database, medicationId: number): Promise<void> {
  const result = await db.runAsync('DELETE FROM inventory WHERE medication_id = ?', [medicationId]);
  if (result.changes === 0) throw new NotFoundError('Inventory', medicationId);
}

/**
 * Inventories of active medications that have hit their refill threshold. Count thresholds compare
 * against the quantity on hand; day thresholds against the supply estimated from the medication's
 * schedules in effect today (as-needed use can't be estimated, so those never trigger by days).
 */
export async function listLowStock(db: Database, now: Date = new Date()): Promise<LowStockItem[]> {
  const rows = await db.getAllAsync<InventoryRow>(
    `SELECT i.* FROM inventory i
       JOIN medications m ON m.id = i.medication_id
      WHERE m.active = 1 AND i.refill_threshold IS NOT NULL
      ORDER BY i.medication_id`,
  );
  const today = localDateOf(now);
  const schedules = await listActiveSchedulesInRange(db, today, today);
  const { from } = localDayRangeUtc(addDays(today, -AS_NEEDED_WINDOW_DAYS));
  const taken = await sumTakenByMedication(db, from, now);
  const low: LowStockItem[] = [];
  for (const row of rows) {
    const inventory = toInventory(row);
    const medication = await getMedication(db, inventory.medicationId);
    const projection = projectSupply({
      quantity: inventory.currentQuantity,
      schedules: schedules.filter((s) => s.medicationId === inventory.medicationId),
      today,
      asNeededPerDay: asNeededPerDay(
        taken.get(inventory.medicationId) ?? 0,
        medication?.createdAt ?? now.toISOString(),
        now,
      ),
    });
    if (isLowSupply(inventory, projection.daysRemaining)) {
      low.push({ inventory, daysOfSupply: projection.daysRemaining });
    }
  }
  return low;
}
