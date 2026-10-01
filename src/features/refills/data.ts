import { recordRefill, type NewRefillEvent } from '@/db/repositories';
import type { RefillEvent } from '@/db/models';
import type { Database } from '@/db/types';
import { loadMedicationSummaries } from '@/features/medications/data';
import type { MedicationSummary } from '@/features/medications/summary';
import { syncReminders } from '@/features/reminders/sync';
import { isLocalDate, localDateOf, localToUtc, type LocalDate } from '@/lib/time';
import { buildRefillList } from './list';

export interface RefillsData {
  items: MedicationSummary[];
}

export async function loadRefills(db: Database, now: Date = new Date()): Promise<RefillsData> {
  const summaries = await loadMedicationSummaries(db, now);
  return { items: buildRefillList(summaries, localDateOf(now)) };
}

export const loadRefillsNow = (db: Database) => loadRefills(db, new Date());

export interface RefillFormValues {
  quantity: string;
  date: string;
  note: string;
}

export type RefillFormErrors = Partial<Record<'quantity' | 'date', string>>;

export function emptyRefillForm(now: Date = new Date()): RefillFormValues {
  return { quantity: '', date: localDateOf(now), note: '' };
}

/** Validates the Record refill form: quantity > 0, a real date that is not in the future. */
export function validateRefillForm(
  values: RefillFormValues,
  now: Date = new Date(),
):
  | {
      ok: true;
      value: Required<Pick<NewRefillEvent, 'quantityAdded' | 'date'>> & { note: string | null };
    }
  | { ok: false; errors: RefillFormErrors } {
  const errors: RefillFormErrors = {};
  const text = values.quantity.trim().replace(',', '.');
  const quantity = Number(text);
  if (text === '') errors.quantity = 'Enter how much you picked up.';
  else if (!/^(\d+\.?\d*|\.\d+)$/.test(text) || !Number.isFinite(quantity)) {
    errors.quantity = 'Quantity must be a number, like 30.';
  } else if (quantity <= 0) errors.quantity = 'Quantity must be greater than 0.';

  const date: LocalDate = values.date.trim();
  let when: string | null = null;
  if (!isLocalDate(date)) errors.date = 'Enter a date like 2026-10-01.';
  else if (date > localDateOf(now)) errors.date = "That date hasn't happened yet.";
  else {
    // Today keeps the current time of day; earlier days are recorded at noon.
    when = date === localDateOf(now) ? now.toISOString() : localToUtc(date, '12:00');
  }
  if (errors.quantity || errors.date || when === null) return { ok: false, errors };
  return {
    ok: true,
    value: { quantityAdded: quantity, date: when, note: values.note.trim() || null },
  };
}

/**
 * Records a pickup: adds to inventory, uses up one remaining refill (if tracked), and logs a
 * RefillEvent, atomically. Then refreshes reminders (a refill ends a low-supply episode, and the
 * last refill may call for a "contact your doctor" reminder).
 */
export async function saveRefill(db: Database, input: NewRefillEvent): Promise<RefillEvent> {
  const event = await recordRefill(db, input);
  await syncReminders(db);
  return event;
}
