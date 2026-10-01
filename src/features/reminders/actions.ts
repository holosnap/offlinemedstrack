import { adjustInventoryQuantity, listDoseLogsInRange, recordDose } from '@/db/repositories';
import type { DoseStatus } from '@/db/models';
import type { Database } from '@/db/types';
import { toUtcIso, type UtcIso } from '@/lib/time';
import { ACTION_SKIP, ACTION_SNOOZE, ACTION_TAKEN, SNOOZE_MINUTES } from './constants';
import { snoozeNotificationId } from './planner';
import type { NotificationsPort } from './ports';

/** The part of a notification response we use (structurally matches expo-notifications'). */
export interface ResponseLike {
  actionIdentifier: string;
  notification: {
    request: {
      identifier: string;
      content: { title?: string | null; body?: string | null; data?: Record<string, unknown> };
    };
  };
}

export type ResponseOutcome =
  | { type: 'logged'; status: DoseStatus; medicationId: number }
  | { type: 'open'; medicationId: number }
  | { type: 'ignored' };

export interface ActionDeps {
  db: Database;
  port: NotificationsPort;
  now?: () => Date;
}

interface DoseRef {
  medicationId: number;
  scheduledFor: UtcIso;
  quantity: number;
}

function readDoseRef(data: Record<string, unknown> | undefined): DoseRef | null {
  if (!data) return null;
  const { medicationId, scheduledFor, quantity } = data;
  if (typeof medicationId !== 'number' || typeof scheduledFor !== 'string') return null;
  try {
    return {
      medicationId,
      scheduledFor: toUtcIso(scheduledFor),
      quantity: typeof quantity === 'number' ? quantity : 1,
    };
  } catch {
    return null;
  }
}

const consumed = (status: DoseStatus | undefined, quantity: number) =>
  status === 'taken' ? quantity : 0;

/**
 * Applies a notification tap or action button to the database. Idempotent: replays of the same
 * response (e.g. foreground listener plus background task) don't double-log or double-count supply.
 */
export async function handleNotificationResponse(
  deps: ActionDeps,
  response: ResponseLike,
): Promise<ResponseOutcome> {
  const { db, port } = deps;
  const request = response.notification.request;
  const dose = readDoseRef(request.content.data);
  if (!dose) return { type: 'ignored' };

  const status: DoseStatus | null =
    response.actionIdentifier === ACTION_TAKEN
      ? 'taken'
      : response.actionIdentifier === ACTION_SKIP
        ? 'skipped'
        : response.actionIdentifier === ACTION_SNOOZE
          ? 'snoozed'
          : null;
  if (!status) return { type: 'open', medicationId: dose.medicationId };

  const to = new Date(new Date(dose.scheduledFor).getTime() + 1).toISOString();
  const [prior] = await listDoseLogsInRange(db, dose.scheduledFor, to, {
    medicationId: dose.medicationId,
  });
  // A late snooze tap must not undo a dose that was already taken or skipped.
  if (status === 'snoozed' && (prior?.status === 'taken' || prior?.status === 'skipped')) {
    await port.dismiss(request.identifier);
    return { type: 'ignored' };
  }

  await recordDose(db, {
    medicationId: dose.medicationId,
    scheduledFor: dose.scheduledFor,
    status,
    quantity: status === 'taken' ? dose.quantity : null,
  });

  const delta = consumed(status, dose.quantity) - consumed(prior?.status, dose.quantity);
  if (delta !== 0) {
    try {
      await adjustInventoryQuantity(db, dose.medicationId, -delta);
    } catch {
      // No inventory tracked for this medication; nothing to adjust.
    }
  }

  const snoozeId = snoozeNotificationId(dose.medicationId, dose.scheduledFor);
  await port.dismiss(request.identifier);
  if (status === 'snoozed') {
    const now = deps.now?.() ?? new Date();
    const content = request.content;
    await port.schedule({
      identifier: snoozeId,
      title: content.title ?? 'Time for your medication',
      body: content.body ?? '',
      fireAt: new Date(now.getTime() + SNOOZE_MINUTES * 60_000),
      data: { ...content.data, kind: 'snooze' },
    });
  } else {
    await port.cancel(snoozeId);
  }
  return { type: 'logged', status, medicationId: dose.medicationId };
}
