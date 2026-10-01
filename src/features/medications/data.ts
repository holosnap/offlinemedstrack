import {
  createInventory,
  createMedication,
  createSchedule,
  deleteMedication,
  getInventory,
  getMedication,
  listMedications,
  listRecentDoseLogs,
  listSchedulesForMedication,
  setMedicationActive,
  updateInventory,
  updateMedication,
  updateSchedule,
} from '@/db/repositories';
import type { DoseLog, Medication } from '@/db/models';
import { syncReminders } from '@/features/reminders/sync';
import type { Database } from '@/db/types';
import { buildSummary, type MedicationSummary } from './summary';
import type { ValidatedMedication } from './form';

export const HISTORY_LIMIT = 15;

export interface MedicationDetail extends MedicationSummary {
  history: DoseLog[];
}

async function summarize(
  db: Database,
  medication: Medication,
  now: Date,
): Promise<MedicationSummary> {
  const [schedules, inventory] = await Promise.all([
    listSchedulesForMedication(db, medication.id),
    getInventory(db, medication.id),
  ]);
  return buildSummary(medication, schedules, inventory, now);
}

/** Every medication (active first, then paused; each group by name) with its derived status. */
export async function loadMedicationSummaries(
  db: Database,
  now: Date = new Date(),
): Promise<MedicationSummary[]> {
  const medications = await listMedications(db);
  const summaries = await Promise.all(medications.map((m) => summarize(db, m, now)));
  return summaries.sort((a, b) => Number(b.medication.active) - Number(a.medication.active));
}

export async function loadMedicationDetail(
  db: Database,
  id: number,
  now: Date = new Date(),
): Promise<MedicationDetail | null> {
  const medication = await getMedication(db, id);
  if (!medication) return null;
  const [summary, history] = await Promise.all([
    summarize(db, medication, now),
    listRecentDoseLogs(db, id, HISTORY_LIMIT),
  ]);
  return { ...summary, history };
}

/**
 * Creates or updates a medication together with its schedule and inventory, atomically.
 * The form edits one schedule per medication: the first one is updated in place.
 */
export async function saveMedication(
  db: Database,
  id: number | null,
  input: ValidatedMedication,
): Promise<number> {
  let savedId = id ?? 0;
  await db.withTransactionAsync(async () => {
    if (id === null) {
      savedId = (await createMedication(db, input.medication)).id;
      await createSchedule(db, { ...input.schedule, medicationId: savedId });
      await createInventory(db, { ...input.inventory, medicationId: savedId });
      return;
    }
    await updateMedication(db, id, input.medication);
    const [existing] = await listSchedulesForMedication(db, id);
    if (existing) await updateSchedule(db, existing.id, input.schedule);
    else await createSchedule(db, { ...input.schedule, medicationId: id });
    if (await getInventory(db, id)) await updateInventory(db, id, input.inventory);
    else await createInventory(db, { ...input.inventory, medicationId: id });
  });
  await syncReminders(db);
  return savedId;
}

export async function setActive(db: Database, id: number, active: boolean) {
  await setMedicationActive(db, id, active);
  await syncReminders(db);
}

export async function removeMedication(db: Database, id: number) {
  await deleteMedication(db, id);
  await syncReminders(db);
}

/** Pre-fills the form from the stored medication; null if it no longer exists. */
export async function loadMedicationForEdit(db: Database, id: number) {
  const medication = await getMedication(db, id);
  if (!medication) return null;
  const [schedules, inventory] = await Promise.all([
    listSchedulesForMedication(db, id),
    getInventory(db, id),
  ]);
  return { medication, schedule: schedules[0] ?? null, inventory };
}
