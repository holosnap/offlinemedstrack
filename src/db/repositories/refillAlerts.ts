import type { Database } from '../types';

/** Where a medication is in its refill-reminder cycle (see `features/refills/planner`). */
export interface RefillAlertState {
  /** When the current low-supply episode was first noticed; null when not low. */
  lowSince: string | null;
  /** The lowest quantity seen in the episode; a higher quantity means a refill happened. */
  lowQuantity: number | null;
  /** When "no refills left" was first noticed; null while refills remain (or aren't tracked). */
  doctorSince: string | null;
}

interface Row {
  medication_id: number;
  low_since: string | null;
  low_quantity: number | null;
  doctor_since: string | null;
}

export const EMPTY_REFILL_ALERT: RefillAlertState = {
  lowSince: null,
  lowQuantity: null,
  doctorSince: null,
};

const toState = (row: Row): RefillAlertState => ({
  lowSince: row.low_since,
  lowQuantity: row.low_quantity,
  doctorSince: row.doctor_since,
});

export async function listRefillAlerts(db: Database): Promise<Map<number, RefillAlertState>> {
  const rows = await db.getAllAsync<Row>('SELECT * FROM refill_alerts');
  return new Map(rows.map((r) => [r.medication_id, toState(r)]));
}

export async function getRefillAlert(
  db: Database,
  medicationId: number,
): Promise<RefillAlertState> {
  const row = await db.getFirstAsync<Row>('SELECT * FROM refill_alerts WHERE medication_id = ?', [
    medicationId,
  ]);
  return row ? toState(row) : EMPTY_REFILL_ALERT;
}

/** Saves the state; an all-empty state removes the row. */
export async function saveRefillAlert(
  db: Database,
  medicationId: number,
  state: RefillAlertState,
): Promise<void> {
  if (state.lowSince === null && state.lowQuantity === null && state.doctorSince === null) {
    await db.runAsync('DELETE FROM refill_alerts WHERE medication_id = ?', [medicationId]);
    return;
  }
  await db.runAsync(
    `INSERT INTO refill_alerts (medication_id, low_since, low_quantity, doctor_since)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (medication_id) DO UPDATE SET
       low_since = excluded.low_since,
       low_quantity = excluded.low_quantity,
       doctor_since = excluded.doctor_since`,
    [medicationId, state.lowSince, state.lowQuantity, state.doctorSince],
  );
}
