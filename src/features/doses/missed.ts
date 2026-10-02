import { listActiveSchedulesInRange, listDoseLogsInRange } from '@/db/repositories';
import type { Database } from '@/db/types';
import { addDays, localDateOf, localDayRangeUtc } from '@/lib/time';
import { coveredSlotKeys, doseKey, expandSlots, isMissed } from './timeline';
import { setDoseState } from './state';

export const MISSED_LOOKBACK_DAYS = 7;

/**
 * Marks doses with no action `missedAfterMinutes` after their scheduled time as missed. Looks back
 * a few days so a long gap between app launches is still recorded. Missing never changes
 * inventory. Idempotent. Returns how many doses were newly marked.
 */
export async function markMissedDoses(
  db: Database,
  now: Date,
  missedAfterMinutes: number,
  lookbackDays = MISSED_LOOKBACK_DAYS,
): Promise<number> {
  const today = localDateOf(now);
  const from = addDays(today, -lookbackDays);
  const schedules = await listActiveSchedulesInRange(db, from, today);
  if (schedules.length === 0) return 0;
  const range = localDayRangeUtc(from, today);
  const logs = await listDoseLogsInRange(db, range.from, range.to);
  const logByKey = new Map(logs.map((l) => [doseKey(l.medicationId, l.scheduledFor), l]));

  let marked = 0;
  const slots = expandSlots(schedules, from, today);
  const covered = coveredSlotKeys(
    slots.map((s) => ({ medicationId: s.schedule.medicationId, scheduledFor: s.scheduledFor })),
    logs,
  );
  for (const slot of slots) {
    // A dose already logged under a time that was since edited away is not missing.
    if (covered.has(doseKey(slot.schedule.medicationId, slot.scheduledFor))) continue;
    const log = logByKey.get(doseKey(slot.schedule.medicationId, slot.scheduledFor)) ?? null;
    if (!isMissed(slot, log, now, missedAfterMinutes)) continue;
    await setDoseState(
      db,
      { medicationId: slot.schedule.medicationId, scheduledFor: slot.scheduledFor },
      { status: 'missed', quantity: null, actedAt: null },
    );
    marked++;
  }
  return marked;
}
