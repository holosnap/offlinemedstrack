import type { DoseLog, Medication, Schedule } from '@/db/models';
import { formatQuantity, formatTime } from '@/lib/format';
import { scheduleOccursOn } from '@/lib/schedule';
import {
  addDays,
  localDateOf,
  localToUtc,
  type LocalDate,
  type LocalTime,
  type UtcIso,
} from '@/lib/time';

export type TimelineStatus = 'upcoming' | 'overdue' | 'snoozed' | 'taken' | 'skipped' | 'missed';

export interface TimelineDose {
  key: string;
  medicationId: number;
  name: string;
  /** e.g. "500 mg" */
  strength: string;
  /** e.g. "2 tablets" */
  amount: string;
  scheduledFor: UtcIso;
  time: LocalTime;
  quantity: number;
  status: TimelineStatus;
  /** Past its scheduled time with no action yet (not yet auto-marked missed). */
  overdue: boolean;
  log: DoseLog | null;
}

export interface PlannedSlot {
  schedule: Schedule;
  time: LocalTime;
  scheduledFor: UtcIso;
}

export type DoseGroupMode = 'period' | 'time';

export interface DoseGroup {
  key: string;
  title: string;
  doses: TimelineDose[];
}

export const doseKey = (medicationId: number, scheduledFor: UtcIso) =>
  `${medicationId}@${scheduledFor}`;

/** Every dose the given schedules call for on local days `from`..`to` inclusive. */
export function expandSlots(
  schedules: readonly Schedule[],
  from: LocalDate,
  to: LocalDate,
): PlannedSlot[] {
  const slots: PlannedSlot[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    for (const schedule of schedules) {
      if (!scheduleOccursOn(schedule, date)) continue;
      for (const time of schedule.times) {
        slots.push({ schedule, time, scheduledFor: localToUtc(date, time) });
      }
    }
  }
  return slots;
}

/**
 * Slots that an already-logged dose stands in for. When a schedule's times are edited after a dose
 * was taken or skipped (e.g. 08:00 taken, then the time changed to 09:00), that log no longer
 * matches any slot. Rather than showing the day's dose twice, each such "orphan" log covers the
 * nearest unlogged slot of the same medication on the same day.
 */
export function coveredSlotKeys(
  slots: readonly { medicationId: number; scheduledFor: UtcIso }[],
  logs: readonly DoseLog[],
): Set<string> {
  const slotKeys = new Set(slots.map((s) => doseKey(s.medicationId, s.scheduledFor)));
  const loggedKeys = new Set(logs.map((l) => doseKey(l.medicationId, l.scheduledFor)));
  const free = new Map<string, UtcIso[]>();
  for (const slot of slots) {
    if (loggedKeys.has(doseKey(slot.medicationId, slot.scheduledFor))) continue;
    const group = `${slot.medicationId}|${localDateOf(new Date(slot.scheduledFor))}`;
    free.set(group, [...(free.get(group) ?? []), slot.scheduledFor]);
  }
  const covered = new Set<string>();
  const orphans = logs
    .filter(
      (l) =>
        (l.status === 'taken' || l.status === 'skipped') &&
        !slotKeys.has(doseKey(l.medicationId, l.scheduledFor)),
    )
    .sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor));
  for (const log of orphans) {
    const group = `${log.medicationId}|${localDateOf(new Date(log.scheduledFor))}`;
    const candidates = free.get(group);
    if (!candidates || candidates.length === 0) continue;
    const at = new Date(log.scheduledFor).getTime();
    let best = 0;
    for (let i = 1; i < candidates.length; i++) {
      if (
        Math.abs(new Date(candidates[i]).getTime() - at) <
        Math.abs(new Date(candidates[best]).getTime() - at)
      ) {
        best = i;
      }
    }
    covered.add(doseKey(log.medicationId, candidates[best]));
    candidates.splice(best, 1);
  }
  return covered;
}

/**
 * Whether an unresolved dose (no log, or only snoozed) should count as missed. Doses scheduled
 * before the schedule was last edited are ignored: the person never had that reminder.
 */
export function isMissed(
  slot: PlannedSlot,
  log: DoseLog | null,
  now: Date,
  missedAfterMinutes: number,
): boolean {
  if (log && log.status !== 'snoozed') return false;
  if (slot.scheduledFor < slot.schedule.updatedAt) return false;
  return now.getTime() >= new Date(slot.scheduledFor).getTime() + missedAfterMinutes * 60_000;
}

export function describeAmount(medication: Medication, quantity: number): string {
  const q = formatQuantity(quantity);
  const plural = quantity === 1 ? '' : 's';
  return medication.form === 'tablet' || medication.form === 'capsule'
    ? `${q} ${medication.form}${plural}`
    : `${q} ${quantity === 1 ? 'dose' : 'doses'}`;
}

export interface TimelineInput {
  medications: ReadonlyMap<number, Medication>;
  /** Active schedules that apply on `date`. */
  schedules: readonly Schedule[];
  /** Logs whose scheduled time falls on `date`. */
  logs: readonly DoseLog[];
  date: LocalDate;
  now: Date;
  missedAfterMinutes: number;
}

/** Today's scheduled doses with their effective status, soonest first. */
export function buildTimeline(input: TimelineInput): TimelineDose[] {
  const { medications, logs, now, missedAfterMinutes } = input;
  const logByKey = new Map(logs.map((l) => [doseKey(l.medicationId, l.scheduledFor), l]));
  const doses: TimelineDose[] = [];
  const slots = expandSlots(input.schedules, input.date, input.date).filter((s) =>
    medications.has(s.schedule.medicationId),
  );
  const covered = coveredSlotKeys(
    slots.map((s) => ({ medicationId: s.schedule.medicationId, scheduledFor: s.scheduledFor })),
    logs,
  );
  const asNeededMedications = new Set(
    input.schedules.filter((s) => s.type === 'as_needed').map((s) => s.medicationId),
  );

  for (const slot of slots) {
    const medication = medications.get(slot.schedule.medicationId);
    if (!medication) continue;
    // An edited-away slot whose dose was already logged under its old time: shown as that log.
    if (covered.has(doseKey(medication.id, slot.scheduledFor))) continue;
    const log = logByKey.get(doseKey(medication.id, slot.scheduledFor)) ?? null;
    // A dose from before the schedule's last edit is only shown if the person acted on it.
    if (!log && slot.scheduledFor < slot.schedule.updatedAt) continue;

    let status: TimelineStatus;
    if (log?.status === 'taken' || log?.status === 'skipped' || log?.status === 'missed') {
      status = log.status;
    } else if (isMissed(slot, log, now, missedAfterMinutes)) {
      status = 'missed';
    } else if (log?.status === 'snoozed') {
      status = 'snoozed';
    } else {
      status = now.getTime() > new Date(slot.scheduledFor).getTime() ? 'overdue' : 'upcoming';
    }
    const unresolved = status === 'overdue' || status === 'snoozed';
    doses.push({
      key: doseKey(medication.id, slot.scheduledFor),
      medicationId: medication.id,
      name: medication.name,
      strength: `${formatQuantity(medication.dosageAmount)} ${medication.dosageUnit}`,
      amount: describeAmount(medication, slot.schedule.doseQuantity),
      scheduledFor: slot.scheduledFor,
      time: slot.time,
      quantity: slot.schedule.doseQuantity,
      status,
      overdue: unresolved && now.getTime() > new Date(slot.scheduledFor).getTime(),
      log,
    });
  }

  // Logged doses that no longer match a slot (the schedule's times were edited): keep showing them.
  const slotKeys = new Set(slots.map((s) => doseKey(s.schedule.medicationId, s.scheduledFor)));
  for (const log of logs) {
    const medication = medications.get(log.medicationId);
    if (!medication || asNeededMedications.has(medication.id)) continue;
    if (slotKeys.has(doseKey(log.medicationId, log.scheduledFor))) continue;
    if (log.status !== 'taken' && log.status !== 'skipped') continue;
    const at = new Date(log.scheduledFor);
    const quantity = log.quantity ?? 1;
    doses.push({
      key: doseKey(medication.id, log.scheduledFor),
      medicationId: medication.id,
      name: medication.name,
      strength: `${formatQuantity(medication.dosageAmount)} ${medication.dosageUnit}`,
      amount: describeAmount(medication, quantity),
      scheduledFor: log.scheduledFor,
      time: `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`,
      quantity,
      status: log.status,
      overdue: false,
      log,
    });
  }
  return doses.sort(
    (a, b) => a.scheduledFor.localeCompare(b.scheduledFor) || a.medicationId - b.medicationId,
  );
}

const PERIODS = [
  { key: 'morning', title: 'Morning', before: '12:00' },
  { key: 'afternoon', title: 'Afternoon', before: '17:00' },
  { key: 'evening', title: 'Evening', before: '24:00' },
] as const;

/** Groups by morning (before noon), afternoon (before 5 pm), evening; or by exact time. */
export function groupDoses(doses: readonly TimelineDose[], mode: DoseGroupMode): DoseGroup[] {
  const groups = new Map<string, DoseGroup>();
  for (const dose of doses) {
    const period = PERIODS.find((p) => dose.time < p.before) ?? PERIODS[2];
    const key = mode === 'period' ? period.key : dose.time;
    const title = mode === 'period' ? period.title : formatTime(dose.time);
    const group = groups.get(key) ?? { key, title, doses: [] };
    group.doses.push(dose);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** When a snooze ends, derived from when it was tapped. */
export const snoozeUntil = (log: DoseLog, snoozeMinutes: number): Date | null =>
  log.actedAt ? new Date(new Date(log.actedAt).getTime() + snoozeMinutes * 60_000) : null;

export interface AsNeededEntry {
  medication: Medication;
  /** Usual quantity per dose, used by the one-tap button. */
  quantity: number;
  amount: string;
  /** Today's doses, newest first. */
  today: DoseLog[];
}

/** As-needed medications with the doses already logged on `date` (logs keyed by time taken). */
export function buildAsNeeded(input: {
  medications: ReadonlyMap<number, Medication>;
  schedules: readonly Schedule[];
  logs: readonly DoseLog[];
}): AsNeededEntry[] {
  const entries: AsNeededEntry[] = [];
  for (const schedule of input.schedules) {
    if (schedule.type !== 'as_needed') continue;
    const medication = input.medications.get(schedule.medicationId);
    if (!medication) continue;
    entries.push({
      medication,
      quantity: schedule.doseQuantity,
      amount: describeAmount(medication, schedule.doseQuantity),
      today: input.logs
        .filter((l) => l.medicationId === medication.id && l.status === 'taken')
        .sort((a, b) => b.scheduledFor.localeCompare(a.scheduledFor)),
    });
  }
  return entries.sort((a, b) => a.medication.name.localeCompare(b.medication.name));
}
