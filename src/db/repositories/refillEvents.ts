import { NotFoundError } from '../errors';
import type { RefillEvent } from '../models';
import { buildSet } from '../sql';
import type { Database } from '../types';
import { nowUtc, toUtcIso } from '@/lib/time';

interface RefillEventRow {
  id: number;
  medication_id: number;
  date: string;
  quantity_added: number;
  note: string | null;
  created_at: string;
}

export interface NewRefillEvent {
  medicationId: number;
  /** Defaults to now. */
  date?: Date | string;
  quantityAdded: number;
  note?: string | null;
}

export type RefillEventUpdate = Partial<Omit<NewRefillEvent, 'medicationId'>>;

const toRefillEvent = (row: RefillEventRow): RefillEvent => ({
  id: row.id,
  medicationId: row.medication_id,
  date: row.date,
  quantityAdded: row.quantity_added,
  note: row.note,
  createdAt: row.created_at,
});

function validate(quantityAdded: number | undefined): void {
  if (quantityAdded !== undefined && !(quantityAdded > 0)) {
    throw new RangeError('Quantity added must be greater than 0');
  }
}

/** Inserts the event only; use `recordRefill` to also update inventory. */
export async function createRefillEvent(db: Database, input: NewRefillEvent): Promise<RefillEvent> {
  validate(input.quantityAdded);
  const now = nowUtc();
  const result = await db.runAsync(
    `INSERT INTO refill_events (medication_id, date, quantity_added, note, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [
      input.medicationId,
      input.date === undefined ? now : toUtcIso(input.date),
      input.quantityAdded,
      input.note ?? null,
      now,
    ],
  );
  return getRefillEventOrThrow(db, result.lastInsertRowId);
}

export async function getRefillEvent(db: Database, id: number): Promise<RefillEvent | null> {
  const row = await db.getFirstAsync<RefillEventRow>('SELECT * FROM refill_events WHERE id = ?', [
    id,
  ]);
  return row ? toRefillEvent(row) : null;
}

async function getRefillEventOrThrow(db: Database, id: number): Promise<RefillEvent> {
  const event = await getRefillEvent(db, id);
  if (!event) throw new NotFoundError('RefillEvent', id);
  return event;
}

/** A medication's refills, most recent first. */
export async function listRefillEventsForMedication(
  db: Database,
  medicationId: number,
): Promise<RefillEvent[]> {
  const rows = await db.getAllAsync<RefillEventRow>(
    'SELECT * FROM refill_events WHERE medication_id = ? ORDER BY date DESC, id DESC',
    [medicationId],
  );
  return rows.map(toRefillEvent);
}

/** Refills dated in the half-open UTC range `[from, to)`, oldest first. */
export async function listRefillEventsInRange(
  db: Database,
  from: Date | string,
  to: Date | string,
): Promise<RefillEvent[]> {
  const rows = await db.getAllAsync<RefillEventRow>(
    'SELECT * FROM refill_events WHERE date >= ? AND date < ? ORDER BY date, id',
    [toUtcIso(from), toUtcIso(to)],
  );
  return rows.map(toRefillEvent);
}

export async function updateRefillEvent(
  db: Database,
  id: number,
  patch: RefillEventUpdate,
): Promise<RefillEvent> {
  validate(patch.quantityAdded);
  const { clause, params } = buildSet({
    date: patch.date === undefined ? undefined : toUtcIso(patch.date),
    quantity_added: patch.quantityAdded,
    note: patch.note,
  });
  if (clause === '') return getRefillEventOrThrow(db, id);
  const result = await db.runAsync(`UPDATE refill_events SET ${clause} WHERE id = ?`, [
    ...params,
    id,
  ]);
  if (result.changes === 0) throw new NotFoundError('RefillEvent', id);
  return getRefillEventOrThrow(db, id);
}

export async function deleteRefillEvent(db: Database, id: number): Promise<void> {
  const result = await db.runAsync('DELETE FROM refill_events WHERE id = ?', [id]);
  if (result.changes === 0) throw new NotFoundError('RefillEvent', id);
}

/**
 * Records a pickup atomically: logs the event, adds the quantity to inventory, and uses up one of
 * the prescription's remaining refills (if tracked). Requires an inventory row for the medication.
 */
export async function recordRefill(db: Database, input: NewRefillEvent): Promise<RefillEvent> {
  validate(input.quantityAdded);
  let event: RefillEvent | undefined;
  await db.withTransactionAsync(async () => {
    const now = nowUtc();
    const updated = await db.runAsync(
      `UPDATE inventory
          SET current_quantity = current_quantity + ?,
              refills_remaining = CASE WHEN refills_remaining IS NULL THEN NULL
                                       ELSE max(0, refills_remaining - 1) END,
              updated_at = ?
        WHERE medication_id = ?`,
      [input.quantityAdded, now, input.medicationId],
    );
    if (updated.changes === 0) throw new NotFoundError('Inventory', input.medicationId);
    event = await createRefillEvent(db, input);
  });
  if (!event) throw new Error('Refill was not recorded');
  return event;
}
