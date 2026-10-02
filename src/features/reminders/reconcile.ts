import {
  EMPTY_REFILL_ALERT,
  getInventory,
  listActiveSchedulesInRange,
  listDoseLogsInRange,
  listMedications,
  listRefillAlerts,
  listSchedulesForMedication,
  saveRefillAlert,
} from '@/db/repositories';
import type { Medication } from '@/db/models';
import type { Database } from '@/db/types';
import { getSettings } from '@/features/settings/settings';
import { buildSummary } from '@/features/medications/summary';
import {
  planRefillReminders,
  REFILL_ID_PREFIX,
  type PlannedRefillReminder,
} from '@/features/refills/planner';
import { loadAverageUsage } from '@/features/refills/usage';
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

/** iOS keeps at most 64 pending local notifications; stay under it with room for snoozes. */
const MAX_PENDING_TOTAL = 62;

export function notificationContent(medication: Medication): { title: string; body: string } {
  const strength = `${formatQuantity(medication.dosageAmount)} ${medication.dosageUnit}`;
  const extra = medication.instructions ? ` · ${medication.instructions}` : '';
  return { title: `Time for ${medication.name}`, body: `${strength}${extra}` };
}

/** A notification that should be pending, whatever its kind. */
interface Desired {
  id: string;
  title: string;
  body: string;
  fireAt: Date;
  data: Record<string, unknown>;
  sound: boolean;
}

/** What a pending notification must match to be kept: its text and its sound setting. */
const contentKey = (title: string, body: string, sound: boolean) =>
  `${title}\n${body}\n${sound ? 'sound' : 'silent'}`;

/**
 * Works out each active medication's refill reminders from its supply, and stores the episode
 * state that keeps them from repeating (see `planRefillReminders`).
 */
async function planRefills(db: Database, now: Date): Promise<PlannedRefillReminder[]> {
  const medications = await listMedications(db, { activeOnly: true });
  const usage = await loadAverageUsage(db, medications, now);
  const states = await listRefillAlerts(db);
  const reminders: PlannedRefillReminder[] = [];

  for (const medication of medications) {
    const inventory = await getInventory(db, medication.id);
    const previous = states.get(medication.id) ?? EMPTY_REFILL_ALERT;
    if (!inventory) {
      if (states.has(medication.id)) await saveRefillAlert(db, medication.id, EMPTY_REFILL_ALERT);
      continue;
    }
    const schedules = await listSchedulesForMedication(db, medication.id);
    const summary = buildSummary(medication, schedules, inventory, now, usage.get(medication.id));
    const plan = planRefillReminders(
      {
        medicationId: medication.id,
        name: medication.name,
        quantity: inventory.currentQuantity,
        low: summary.lowSupply || summary.supplyStatus === 'out',
        refillsRemaining: inventory.refillsRemaining,
        pharmacyName: inventory.pharmacyName,
        state: previous,
      },
      now,
    );
    const changed =
      plan.state.lowSince !== previous.lowSince ||
      plan.state.lowQuantity !== previous.lowQuantity ||
      plan.state.doctorSince !== previous.doctorSince;
    if (changed) await saveRefillAlert(db, medication.id, plan.state);
    reminders.push(...plan.reminders);
  }
  return reminders;
}

async function planDoseReminders(
  deps: ReconcileDeps,
  now: Date,
  maxDoses: number,
): Promise<PlannedDose[]> {
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
  return planDoses({ schedules, now, resolved, windowDays, maxDoses });
}

async function doReconcile(deps: ReconcileDeps): Promise<ReconcileResult> {
  const { db, port } = deps;
  const now = deps.now?.() ?? new Date();
  const permission = await port.getPermissionState();
  const pending = await port.listPending();
  const ours = pending.filter(
    (p) =>
      p.identifier.startsWith(DOSE_ID_PREFIX) ||
      p.identifier.startsWith(SNOOZE_ID_PREFIX) ||
      p.identifier.startsWith(REFILL_ID_PREFIX),
  );

  // Refill state is tracked whether or not notifications are allowed.
  const { soundEnabled } = await getSettings(db);
  const refills = await planRefills(db, now);
  const medications = new Map(
    (await listMedications(db, { activeOnly: true })).map((m) => [m.id, m]),
  );

  const desired = new Map<string, Desired>();
  if (permission === 'granted') {
    for (const r of refills) {
      desired.set(r.id, {
        id: r.id,
        title: r.title,
        body: r.body,
        fireAt: r.fireAt,
        sound: soundEnabled,
        data: {
          kind: 'refill',
          medicationId: r.medicationId,
          sound: soundEnabled,
          content: contentKey(r.title, r.body, soundEnabled),
        },
      });
    }
    const maxDoses = Math.max(
      0,
      Math.min(deps.maxDoses ?? MAX_SCHEDULED_DOSES, MAX_PENDING_TOTAL - desired.size),
    );
    for (const dose of await planDoseReminders(deps, now, maxDoses)) {
      const medication = medications.get(dose.medicationId);
      if (!medication) continue;
      const { title, body } = notificationContent(medication);
      const data: DoseNotificationData = {
        medicationId: dose.medicationId,
        scheduledFor: dose.scheduledFor,
        quantity: dose.quantity,
        sound: soundEnabled,
        content: contentKey(title, body, soundEnabled),
      };
      desired.set(dose.id, {
        id: dose.id,
        title,
        body,
        fireAt: new Date(dose.scheduledFor),
        sound: soundEnabled,
        data,
      });
    }
  }

  const result: ReconcileResult = { permission, scheduled: 0, cancelled: 0, kept: 0 };
  const stillPending = new Set<string>();

  for (const p of ours) {
    let keep: boolean;
    if (p.identifier.startsWith(SNOOZE_ID_PREFIX)) {
      // A snooze lives until it fires, as long as its medication is still active and reminders on.
      const medicationId = medicationIdOfSnooze(p.identifier);
      keep = permission === 'granted' && medicationId !== null && medications.has(medicationId);
    } else {
      const wanted = desired.get(p.identifier);
      keep =
        wanted !== undefined && p.content === contentKey(wanted.title, wanted.body, wanted.sound);
    }
    if (keep) {
      result.kept++;
      stillPending.add(p.identifier);
    } else {
      await port.cancel(p.identifier);
      result.cancelled++;
    }
  }

  for (const want of desired.values()) {
    if (stillPending.has(want.id)) continue;
    await port.schedule({
      identifier: want.id,
      title: want.title,
      body: want.body,
      fireAt: want.fireAt,
      data: want.data,
      sound: want.sound,
    });
    result.scheduled++;
  }
  return result;
}

let tail: Promise<unknown> = Promise.resolve();

/**
 * The single place that schedules and cancels notifications (dose and refill reminders). It
 * derives the desired set from the database (active schedules, a rolling window, minus doses
 * already taken/skipped, plus bounded refill reminders), diffs it against what the OS has pending,
 * cancels the stale ones and schedules the missing ones. Idempotent, and calls are serialized so
 * overlapping triggers can't double-schedule.
 */
export function reconcile(deps: ReconcileDeps): Promise<ReconcileResult> {
  const run = tail.then(() => doReconcile(deps));
  tail = run.catch(() => undefined);
  return run;
}
