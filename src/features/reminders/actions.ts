import type { DoseStatus } from '@/db/models';
import { getMedication } from '@/db/repositories';
import { skipDose, snoozeDose, takeDose } from '@/features/doses/doseActions';
import { findDoseLog } from '@/features/doses/state';
import type { Database } from '@/db/types';
import { toUtcIso, type UtcIso } from '@/lib/time';
import { ACTION_SKIP, ACTION_SNOOZE, ACTION_TAKEN } from './constants';
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

/**
 * Applies a notification tap or action button to the database. Idempotent: replays of the same
 * response (e.g. foreground listener plus background task) don't double-log or double-count supply.
 */
export async function handleNotificationResponse(
  deps: ActionDeps,
  response: ResponseLike,
): Promise<ResponseOutcome> {
  const { port } = deps;
  const request = response.notification.request;
  const data = request.content.data;
  if (data?.kind === 'refill' && typeof data.medicationId === 'number') {
    return { type: 'open', medicationId: data.medicationId };
  }
  const dose = readDoseRef(data);
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

  // The medication may have been deleted since this notification was delivered.
  if (!(await getMedication(deps.db, dose.medicationId))) {
    await port.dismiss(request.identifier);
    return { type: 'ignored' };
  }

  const actionDeps = { db: deps.db, port, now: deps.now };
  if (status === 'snoozed') {
    const prior = await findDoseLog(deps.db, dose);
    // A late snooze tap must not undo a dose that was already taken or skipped.
    if (prior?.status === 'taken' || prior?.status === 'skipped') {
      await port.dismiss(request.identifier);
      return { type: 'ignored' };
    }
    const content = request.content;
    await snoozeDose(actionDeps, dose, {
      title: content.title ?? 'Time for your medication',
      body: content.body ?? '',
      data: content.data,
    });
  } else if (status === 'taken') {
    // Replays keep the quantity already logged (and therefore the supply already used).
    const prior = await findDoseLog(deps.db, dose);
    await takeDose(actionDeps, dose, {
      quantity: prior?.status === 'taken' ? (prior.quantity ?? dose.quantity) : dose.quantity,
    });
  } else {
    await skipDose(actionDeps, dose);
  }
  await port.dismiss(request.identifier);
  return { type: 'logged', status, medicationId: dose.medicationId };
}
