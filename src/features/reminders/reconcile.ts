import {
  listActiveSchedulesInRange,
  listDoseLogsInRange,
  listMedications,
} from '@/db/repositories';
import type { Medication } from '@/db/models';
import type { Database } from '@/db/types';
import { formatQuantity } from '@/lib/format';
import { addDays, localDateOf } from '@/lib/time';
import { DOSE_ID_PREFIX, MAX_SCHEDULED_DOSES, SNOOZE_ID_PREFIX, WINDOW_DAYS } from './constants';
import { doseKey, medicationIdOfSnooze, planDoses, type PlannedDose } from './planner';
import type { DoseNotificationData, NotificationsPort, PermissionState } from './ports';

export interface ReconcileDeps {
  db: Database;
  port: NotificationsPort;
  now?: () => Date;
  windowDays?: number;
  maxDoses?: number;
}

export interface ReconcileResult {
  permission: PermissionState;
  scheduled: number;
  cancelled: number;
  kept: number;
}

export function notificationContent(medication: Medication): { title: string; body: string } {
  const strength = `${formatQuantity(medication.dosageAmount)} ${medication.dosageUnit}`;
  const extra = medication.instructions ? ` · ${medication.instructions}` : '';
  return { title: `Time for ${medication.name}`, body: `${strength}${extra}` };
}

async function plan(deps: ReconcileDeps, now: Date): Promise<Map<string, PlannedDose>> {
  const { db } = deps;
  const windowDays = deps.windowDays ?? WINDOW_DAYS;
  const today = localDateOf(now);
  const schedules = await listActiveSchedulesInRange(db, today, addDays(today, windowDays));
  const horizon = new Date(now.getTime() + (windowDays + 1) * 86_400_000);
  const logs = await listDoseLogsInRange(db, now, horizon);
  const resolved = new Set(
    logs
      .filter((l) => l.status === 'taken' || l.status === 'skipped')
      .map((l) => doseKey(l.medicationId, l.scheduledFor)),
  );
  const doses = planDoses({
    schedules,
    now,
    resolved,
    windowDays,
    maxDoses: deps.maxDoses ?? MAX_SCHEDULED_DOSES,
  });
  return new Map(doses.map((d) => [d.id, d]));
}

async function doReconcile(deps: ReconcileDeps): Promise<ReconcileResult> {
  const { db, port } = deps;
  const now = deps.now?.() ?? new Date();
  const permission = await port.getPermissionState();
  const pending = await port.listPending();
  const ours = pending.filter(
    (p) => p.identifier.startsWith(DOSE_ID_PREFIX) || p.identifier.startsWith(SNOOZE_ID_PREFIX),
  );

  const desired = permission === 'granted' ? await plan(deps, now) : new Map<string, PlannedDose>();
  const medications = new Map(
    (await listMedications(db, { activeOnly: true })).map((m) => [m.id, m]),
  );

  const content = (dose: PlannedDose) => {
    const medication = medications.get(dose.medicationId);
    return medication ? notificationContent(medication) : null;
  };

  const result: ReconcileResult = { permission, scheduled: 0, cancelled: 0, kept: 0 };
  const stillPending = new Map<string, string | null>();

  for (const p of ours) {
    const dose = desired.get(p.identifier);
    let keep: boolean;
    if (p.identifier.startsWith(SNOOZE_ID_PREFIX)) {
      // A snooze lives until it fires, as long as its medication is still active and reminders on.
      const medicationId = medicationIdOfSnooze(p.identifier);
      keep = permission === 'granted' && medicationId !== null && medications.has(medicationId);
    } else {
      const wanted = dose ? content(dose) : null;
      keep = wanted !== null && p.content === `${wanted.title}\n${wanted.body}`;
    }
    if (keep) {
      result.kept++;
      stillPending.set(p.identifier, p.content);
    } else {
      await port.cancel(p.identifier);
      result.cancelled++;
    }
  }

  for (const dose of desired.values()) {
    if (stillPending.has(dose.id)) continue;
    const text = content(dose);
    if (!text) continue;
    const data: DoseNotificationData = {
      medicationId: dose.medicationId,
      scheduledFor: dose.scheduledFor,
      quantity: dose.quantity,
      content: `${text.title}\n${text.body}`,
    };
    await port.schedule({
      identifier: dose.id,
      title: text.title,
      body: text.body,
      fireAt: new Date(dose.scheduledFor),
      data,
    });
    result.scheduled++;
  }
  return result;
}

let tail: Promise<unknown> = Promise.resolve();

/**
 * The single place that schedules and cancels dose notifications. It derives the desired set from
 * the database (active schedules, a rolling window, minus doses already taken/skipped), diffs it
 * against what the OS has pending, cancels the stale ones and schedules the missing ones.
 * Idempotent, and calls are serialized so overlapping triggers can't double-schedule.
 */
export function reconcile(deps: ReconcileDeps): Promise<ReconcileResult> {
  const run = tail.then(() => doReconcile(deps));
  tail = run.catch(() => undefined);
  return run;
}
