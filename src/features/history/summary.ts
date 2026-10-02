import type { Medication } from '@/db/models';
import type { DayStats } from './adherence';

export interface RangeAdherence {
  medicationId: number;
  name: string;
  taken: number;
  skipped: number;
  missed: number;
  expected: number;
  percent: number | null;
  asNeededDoses: number;
}

/** Adherence per medication over exactly the given days (used for the export summary). */
export function rangeAdherence(
  days: readonly DayStats[],
  medications: readonly Medication[],
): RangeAdherence[] {
  const rows = new Map<number, RangeAdherence>();
  const rowFor = (m: Medication) => {
    const existing = rows.get(m.id);
    if (existing) return existing;
    const created: RangeAdherence = {
      medicationId: m.id,
      name: m.name,
      taken: 0,
      skipped: 0,
      missed: 0,
      expected: 0,
      percent: null,
      asNeededDoses: 0,
    };
    rows.set(m.id, created);
    return created;
  };
  const meds = new Map(medications.map((m) => [m.id, m]));
  for (const day of days) {
    for (const dose of day.doses) {
      const medication = meds.get(dose.medicationId);
      if (!medication || dose.status === 'pending') continue;
      const row = rowFor(medication);
      row.expected++;
      row[dose.status]++;
    }
    for (const prn of day.asNeeded) {
      const medication = meds.get(prn.medicationId);
      if (medication) rowFor(medication).asNeededDoses++;
    }
  }
  for (const row of rows.values()) {
    row.percent = row.expected > 0 ? Math.round((row.taken / row.expected) * 100) : null;
  }
  return [...rows.values()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  );
}
