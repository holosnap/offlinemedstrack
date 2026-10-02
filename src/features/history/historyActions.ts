import type { DoseLog } from '@/db/models';
import type { Database } from '@/db/types';
import { resolveTakenAt } from '@/features/doses/doseActions';
import {
  findDoseLog,
  moveDose,
  setDoseState,
  type DoseOutcome,
  type DoseRef,
} from '@/features/doses/state';
import { parseTimeInput, type LocalDate } from '@/lib/time';

/** What a past scheduled dose can be changed to. `clear` removes the log (back to unrecorded). */
export type PastDoseEdit =
  | { kind: 'taken'; quantity: number; takenAt: Date }
  | { kind: 'skipped' }
  | { kind: 'missed' }
  | { kind: 'clear' };

export interface EditResult {
  /** Reverses the change, restoring the previous log and inventory. */
  undo: () => Promise<void>;
}

const outcomeOf = (log: DoseLog | null): DoseOutcome | null =>
  log ? { status: log.status, quantity: log.quantity, actedAt: log.actedAt } : null;

function toOutcome(edit: PastDoseEdit, now: Date): DoseOutcome | null {
  switch (edit.kind) {
    case 'taken':
      if (!(edit.quantity > 0)) throw new RangeError('Quantity must be greater than 0');
      if (edit.takenAt.getTime() > now.getTime())
        throw new RangeError("That time hasn't happened yet");
      return { status: 'taken', quantity: edit.quantity, actedAt: edit.takenAt.toISOString() };
    case 'skipped':
      return { status: 'skipped', quantity: null, actedAt: now.toISOString() };
    case 'missed':
      return { status: 'missed', quantity: null, actedAt: null };
    case 'clear':
      return null;
  }
}

/**
 * Edits or backfills the log of a scheduled dose ("I took it but forgot to tap"). Goes through
 * `setDoseState`, so inventory follows: backfilling a taken dose uses supply, changing it to
 * skipped/missed or clearing it gives the supply back, and a quantity change adjusts by the
 * difference.
 */
export async function editScheduledDose(
  db: Database,
  ref: DoseRef,
  edit: PastDoseEdit,
  now: Date = new Date(),
): Promise<EditResult> {
  const prior = await setDoseState(db, ref, toOutcome(edit, now));
  return { undo: async () => void (await setDoseState(db, ref, outcomeOf(prior))) };
}

function checkAsNeeded(quantity: number, takenAt: Date, now: Date) {
  if (!(quantity > 0)) throw new RangeError('Quantity must be greater than 0');
  if (takenAt.getTime() > now.getTime()) throw new RangeError("That time hasn't happened yet");
}

/** Logs an as-needed dose that was taken at `takenAt` (any past time). */
export async function addAsNeededDose(
  db: Database,
  input: { medicationId: number; quantity: number; takenAt: Date },
  now: Date = new Date(),
): Promise<EditResult> {
  checkAsNeeded(input.quantity, input.takenAt, now);
  const ref = { medicationId: input.medicationId, scheduledFor: input.takenAt.toISOString() };
  if (await findDoseLog(db, ref)) throw new Error('A dose is already logged at that exact time.');
  await setDoseState(db, ref, {
    status: 'taken',
    quantity: input.quantity,
    actedAt: ref.scheduledFor,
  });
  return { undo: async () => void (await setDoseState(db, ref, null)) };
}

/** Changes the quantity and/or time of a logged as-needed dose (the time is the dose's key). */
export async function editAsNeededDose(
  db: Database,
  log: DoseLog,
  input: { quantity: number; takenAt: Date },
  now: Date = new Date(),
): Promise<EditResult> {
  checkAsNeeded(input.quantity, input.takenAt, now);
  const from: DoseRef = { medicationId: log.medicationId, scheduledFor: log.scheduledFor };
  const to: DoseRef = { medicationId: log.medicationId, scheduledFor: input.takenAt.toISOString() };
  const next: DoseOutcome = { status: 'taken', quantity: input.quantity, actedAt: to.scheduledFor };
  if (to.scheduledFor === from.scheduledFor) {
    await setDoseState(db, from, next);
    return { undo: async () => void (await setDoseState(db, from, outcomeOf(log))) };
  }
  if (await findDoseLog(db, to)) throw new Error('A dose is already logged at that exact time.');
  await moveDose(db, from, to, next);
  return { undo: async () => void (await moveDose(db, to, from, outcomeOf(log) as DoseOutcome)) };
}

/** Removes a logged as-needed dose and gives the supply back. */
export async function deleteAsNeededDose(db: Database, log: DoseLog): Promise<EditResult> {
  const ref = { medicationId: log.medicationId, scheduledFor: log.scheduledFor };
  await setDoseState(db, ref, null);
  return { undo: async () => void (await setDoseState(db, ref, outcomeOf(log))) };
}

export type EditFormResult =
  | { ok: true; quantity: number; takenAt: Date }
  | { ok: false; errors: { quantity?: string; time?: string } };

/** Validates the quantity/time fields of the edit form for a given local day. */
export function parseEditForm(
  values: { quantity: string; time: string },
  date: LocalDate,
  now: Date,
): EditFormResult {
  const errors: { quantity?: string; time?: string } = {};
  const quantity = Number(values.quantity.trim().replace(',', '.'));
  if (!values.quantity.trim() || !Number.isFinite(quantity) || quantity <= 0) {
    errors.quantity = 'Enter a quantity greater than 0';
  }
  const taken = resolveTakenAt(date, parseTimeInput(values.time), now);
  if (!taken.ok) errors.time = taken.error;
  if (errors.quantity || errors.time || !taken.ok) return { ok: false, errors };
  return { ok: true, quantity, takenAt: taken.value };
}
