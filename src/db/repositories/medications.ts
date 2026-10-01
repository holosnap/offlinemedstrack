import { NotFoundError } from '../errors';
import { MEDICATION_FORMS, type Medication, type MedicationForm } from '../models';
import { buildSet, toBool } from '../sql';
import type { Database } from '../types';
import { nowUtc } from '@/lib/time';

interface MedicationRow {
  id: number;
  name: string;
  dosage_amount: number;
  dosage_unit: string;
  form: MedicationForm;
  instructions: string | null;
  color: string | null;
  icon: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}

export interface NewMedication {
  name: string;
  dosageAmount: number;
  dosageUnit: string;
  form: MedicationForm;
  instructions?: string | null;
  color?: string | null;
  icon?: string | null;
  active?: boolean;
}

export type MedicationUpdate = Partial<NewMedication>;

const toMedication = (row: MedicationRow): Medication => ({
  id: row.id,
  name: row.name,
  dosageAmount: row.dosage_amount,
  dosageUnit: row.dosage_unit,
  form: row.form,
  instructions: row.instructions,
  color: row.color,
  icon: row.icon,
  active: row.active === 1,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

function validate(input: MedicationUpdate): void {
  if (input.name !== undefined && input.name.trim() === '') {
    throw new RangeError('Medication name is required');
  }
  if (input.dosageAmount !== undefined && !(input.dosageAmount > 0)) {
    throw new RangeError('Dosage amount must be greater than 0');
  }
  if (input.dosageUnit !== undefined && input.dosageUnit.trim() === '') {
    throw new RangeError('Dosage unit is required');
  }
  if (input.form !== undefined && !MEDICATION_FORMS.includes(input.form)) {
    throw new RangeError(`Invalid medication form "${input.form}"`);
  }
}

export async function createMedication(db: Database, input: NewMedication): Promise<Medication> {
  validate(input);
  const now = nowUtc();
  const result = await db.runAsync(
    `INSERT INTO medications
       (name, dosage_amount, dosage_unit, form, instructions, color, icon, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.name.trim(),
      input.dosageAmount,
      input.dosageUnit.trim(),
      input.form,
      input.instructions ?? null,
      input.color ?? null,
      input.icon ?? null,
      input.active === false ? 0 : 1,
      now,
      now,
    ],
  );
  return getMedicationOrThrow(db, result.lastInsertRowId);
}

export async function getMedication(db: Database, id: number): Promise<Medication | null> {
  const row = await db.getFirstAsync<MedicationRow>('SELECT * FROM medications WHERE id = ?', [id]);
  return row ? toMedication(row) : null;
}

async function getMedicationOrThrow(db: Database, id: number): Promise<Medication> {
  const medication = await getMedication(db, id);
  if (!medication) throw new NotFoundError('Medication', id);
  return medication;
}

/** Lists medications by name. Pass `{ activeOnly: true }` to hide archived ones. */
export async function listMedications(
  db: Database,
  options: { activeOnly?: boolean } = {},
): Promise<Medication[]> {
  const rows = await db.getAllAsync<MedicationRow>(
    `SELECT * FROM medications ${options.activeOnly ? 'WHERE active = 1' : ''}
     ORDER BY name COLLATE NOCASE, id`,
  );
  return rows.map(toMedication);
}

export async function updateMedication(
  db: Database,
  id: number,
  patch: MedicationUpdate,
): Promise<Medication> {
  validate(patch);
  const { clause, params } = buildSet({
    name: patch.name?.trim(),
    dosage_amount: patch.dosageAmount,
    dosage_unit: patch.dosageUnit?.trim(),
    form: patch.form,
    instructions: patch.instructions,
    color: patch.color,
    icon: patch.icon,
    active: toBool(patch.active),
    updated_at: nowUtc(),
  });
  const result = await db.runAsync(`UPDATE medications SET ${clause} WHERE id = ?`, [
    ...params,
    id,
  ]);
  if (result.changes === 0) throw new NotFoundError('Medication', id);
  return getMedicationOrThrow(db, id);
}

/** Archives (or restores) a medication, keeping its history. */
export function setMedicationActive(db: Database, id: number, active: boolean) {
  return updateMedication(db, id, { active });
}

/** Permanently deletes the medication and, via cascade, its schedules, logs, inventory and refills. */
export async function deleteMedication(db: Database, id: number): Promise<void> {
  const result = await db.runAsync('DELETE FROM medications WHERE id = ?', [id]);
  if (result.changes === 0) throw new NotFoundError('Medication', id);
}
