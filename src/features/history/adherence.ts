import type { DoseLog, Medication, Schedule } from '@/db/models';
import {
  coveredSlotKeys,
  doseKey,
  describeAmount,
  expandSlots,
  isMissed,
} from '@/features/doses/timeline';
import { formatQuantity } from '@/lib/format';
import { addDays, localDateOf, type LocalDate, type LocalTime, type UtcIso } from '@/lib/time';

/** `pending` = due but not yet acted on and not yet past the missed window. */
export type HistoryDoseStatus = 'taken' | 'skipped' | 'missed' | 'pending';

export interface HistoryDose {
  key: string;
  medicationId: number;
  name: string;
  strength: string;
  /** e.g. "2 tablets" */
  amount: string;
  scheduledFor: UtcIso;
  time: LocalTime;
  /** Scheduled quantity (what was planned). */
  quantity: number;
  status: HistoryDoseStatus;
  log: DoseLog | null;
}

export interface AsNeededDose {
  log: DoseLog;
  medicationId: number;
  name: string;
  strength: string;
}

/**
 * all_taken: every counted dose was taken. partial: some taken, some not. none: doses were due and
 * none was taken. no_doses: nothing was scheduled. pending: only unresolved doses so far (today).
 * future: the day has not happened yet.
 */
export type DayStatus = 'all_taken' | 'partial' | 'none' | 'no_doses' | 'pending' | 'future';

export interface DayStats {
  date: LocalDate;
  doses: HistoryDose[];
  asNeeded: AsNeededDose[];
  status: DayStatus;
  /** Doses counted for adherence (taken, skipped or missed; not pending). */
  expected: number;
  taken: number;
}

export interface DayStatsInput {
  medications: readonly Medication[];
  /** Every schedule of the given medications (paused ones included). */
  schedules: readonly Schedule[];
  /** Logs whose scheduled time falls in the range. */
  logs: readonly DoseLog[];
  from: LocalDate;
  to: LocalDate;
  now: Date;
  missedAfterMinutes: number;
}

const strengthOf = (m: Medication) => `${formatQuantity(m.dosageAmount)} ${m.dosageUnit}`;

/**
 * Builds the per-day record of what was due and what happened.
 *
 * - Expected doses come from the schedules of active medications, only up to now. A dose scheduled
 *   before its schedule was last edited is ignored unless it was logged, so editing a schedule never
 *   invents misses.
 * - Unlogged doses past the missed window count as missed; skipped doses count as not taken.
 * - Logged doses always appear, even if the schedule has since changed. As-needed doses are listed
 *   but never counted toward adherence.
 */
export function buildDayStats(input: DayStatsInput): Map<LocalDate, DayStats> {
  const { from, to, now, missedAfterMinutes } = input;
  const today = localDateOf(now);
  const meds = new Map(input.medications.map((m) => [m.id, m]));
  const schedulesByMed = new Map<number, Schedule[]>();
  for (const s of input.schedules) {
    schedulesByMed.set(s.medicationId, [...(schedulesByMed.get(s.medicationId) ?? []), s]);
  }
  const isAsNeeded = (id: number) => {
    const list = schedulesByMed.get(id) ?? [];
    return list.length > 0 && list.every((s) => s.type === 'as_needed');
  };

  const logByKey = new Map(input.logs.map((l) => [doseKey(l.medicationId, l.scheduledFor), l]));
  const days = new Map<LocalDate, DayStats>();
  for (let date = from; date <= to; date = addDays(date, 1)) {
    days.set(date, { date, doses: [], asNeeded: [], status: 'no_doses', expected: 0, taken: 0 });
  }
  const dayOf = (instant: UtcIso) => days.get(localDateOf(new Date(instant)));

  const used = new Set<string>();
  const activeScheduled = input.schedules.filter(
    (s) => s.type !== 'as_needed' && meds.get(s.medicationId)?.active,
  );
  const slots = expandSlots(activeScheduled, from, to);
  const covered = coveredSlotKeys(
    slots.map((s) => ({ medicationId: s.schedule.medicationId, scheduledFor: s.scheduledFor })),
    input.logs,
  );
  for (const slot of slots) {
    const medication = meds.get(slot.schedule.medicationId);
    const day = dayOf(slot.scheduledFor);
    if (!medication || !day) continue;
    const key = doseKey(medication.id, slot.scheduledFor);
    if (covered.has(key)) continue; // stood in for by a log under an edited-away time
    const log = logByKey.get(key) ?? null;
    if (!log && slot.scheduledFor < slot.schedule.updatedAt) continue;
    if (!log && new Date(slot.scheduledFor) > now) continue; // not due yet: that's Today's job
    used.add(key);
    day.doses.push(
      toDose(
        medication,
        slot.schedule.doseQuantity,
        slot.scheduledFor,
        slot.time,
        log,
        now,
        missedAfterMinutes,
        slot,
      ),
    );
  }

  for (const log of input.logs) {
    const medication = meds.get(log.medicationId);
    const day = dayOf(log.scheduledFor);
    if (!medication || !day) continue;
    if (isAsNeeded(log.medicationId)) {
      if (log.status === 'taken') {
        day.asNeeded.push({
          log,
          medicationId: medication.id,
          name: medication.name,
          strength: strengthOf(medication),
        });
      }
      continue;
    }
    const key = doseKey(log.medicationId, log.scheduledFor);
    if (used.has(key)) continue;
    // A log whose slot no longer exists in the current schedule (e.g. the times were changed).
    const at = new Date(log.scheduledFor);
    const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
    day.doses.push(
      toDose(
        medication,
        log.quantity ?? 1,
        log.scheduledFor,
        time,
        log,
        now,
        missedAfterMinutes,
        null,
      ),
    );
  }

  for (const day of days.values()) {
    day.doses.sort(
      (a, b) => a.scheduledFor.localeCompare(b.scheduledFor) || a.medicationId - b.medicationId,
    );
    day.asNeeded.sort((a, b) => a.log.scheduledFor.localeCompare(b.log.scheduledFor));
    const counted = day.doses.filter((d) => d.status !== 'pending');
    day.expected = counted.length;
    day.taken = counted.filter((d) => d.status === 'taken').length;
    day.status = classifyDay(day, today);
  }
  return days;
}

function classifyDay(day: DayStats, today: LocalDate): DayStatus {
  if (day.date > today) return 'future';
  if (day.expected === 0) return day.doses.length > 0 ? 'pending' : 'no_doses';
  if (day.taken === day.expected) return 'all_taken';
  return day.taken === 0 ? 'none' : 'partial';
}

function toDose(
  medication: Medication,
  quantity: number,
  scheduledFor: UtcIso,
  time: LocalTime,
  log: DoseLog | null,
  now: Date,
  missedAfterMinutes: number,
  slot: Parameters<typeof isMissed>[0] | null,
): HistoryDose {
  let status: HistoryDoseStatus;
  if (log?.status === 'taken' || log?.status === 'skipped' || log?.status === 'missed') {
    status = log.status;
  } else if (slot ? isMissed(slot, log, now, missedAfterMinutes) : false) {
    status = 'missed';
  } else {
    status = 'pending';
  }
  return {
    key: doseKey(medication.id, scheduledFor),
    medicationId: medication.id,
    name: medication.name,
    strength: strengthOf(medication),
    amount: describeAmount(medication, quantity),
    scheduledFor,
    time,
    quantity,
    status,
    log,
  };
}

export const ADHERENCE_WINDOWS = [7, 30, 90] as const;
export type AdherenceWindow = (typeof ADHERENCE_WINDOWS)[number];

export interface WindowAdherence {
  taken: number;
  expected: number;
  /** Whole percent, or null when nothing was due in the window. */
  percent: number | null;
}

export interface MedicationAdherence {
  medicationId: number;
  name: string;
  asNeeded: boolean;
  active: boolean;
  windows: Record<AdherenceWindow, WindowAdherence>;
  /** As-needed doses taken per window (as-needed medications have no percentage). */
  asNeededCounts: Record<AdherenceWindow, number>;
}

/**
 * Adherence per medication over the last 7, 30 and 90 days, ending today. `days` must cover the
 * longest window. Percentage = taken / (taken + skipped + missed); late doses count as taken.
 */
export function adherenceByMedication(
  days: ReadonlyMap<LocalDate, DayStats>,
  medications: readonly Medication[],
  schedules: readonly Schedule[],
  today: LocalDate,
): MedicationAdherence[] {
  const rows = medications.map((m): MedicationAdherence => {
    const list = schedules.filter((s) => s.medicationId === m.id);
    const windows = {} as Record<AdherenceWindow, WindowAdherence>;
    const asNeededCounts = {} as Record<AdherenceWindow, number>;
    for (const size of ADHERENCE_WINDOWS) {
      let taken = 0;
      let expected = 0;
      let prn = 0;
      for (let i = 0; i < size; i++) {
        const day = days.get(addDays(today, -i));
        if (!day) continue;
        for (const dose of day.doses) {
          if (dose.medicationId !== m.id || dose.status === 'pending') continue;
          expected++;
          if (dose.status === 'taken') taken++;
        }
        prn += day.asNeeded.filter((a) => a.medicationId === m.id).length;
      }
      windows[size] = {
        taken,
        expected,
        percent: expected > 0 ? Math.round((taken / expected) * 100) : null,
      };
      asNeededCounts[size] = prn;
    }
    return {
      medicationId: m.id,
      name: m.name,
      asNeeded: list.length > 0 && list.every((s) => s.type === 'as_needed'),
      active: m.active,
      windows,
      asNeededCounts,
    };
  });
  return rows.sort(
    (a, b) =>
      Number(b.active) - Number(a.active) ||
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  );
}
