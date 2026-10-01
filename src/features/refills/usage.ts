import type { Medication } from '@/db/models';
import { sumTakenByMedication } from '@/db/repositories';
import type { Database } from '@/db/types';
import { asNeededPerDay, AS_NEEDED_WINDOW_DAYS } from '@/lib/supply';
import { addDays, localDateOf, localDayRangeUtc } from '@/lib/time';

/** Average per-day use over the last 30 days for each medication that has taken doses. */
export async function loadAverageUsage(
  db: Database,
  medications: readonly Medication[],
  now: Date,
): Promise<Map<number, number>> {
  const { from } = localDayRangeUtc(addDays(localDateOf(now), -AS_NEEDED_WINDOW_DAYS));
  const taken = await sumTakenByMedication(db, from, now);
  const usage = new Map<number, number>();
  for (const medication of medications) {
    const total = taken.get(medication.id);
    if (total) usage.set(medication.id, asNeededPerDay(total, medication.createdAt, now));
  }
  return usage;
}
