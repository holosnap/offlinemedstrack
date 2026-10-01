import { useCallback, useState } from 'react';

import { useDatabase } from '@/db/DatabaseProvider';
import type { DoseLog } from '@/db/models';
import {
  logAsNeededDose,
  skipDose,
  snoozeDose,
  takeDose,
  undoDose,
  type DoseActionDeps,
} from '@/features/doses/doseActions';
import type { AsNeededEntry, TimelineDose } from '@/features/doses/timeline';
import { expoPort } from '@/features/reminders/expoPort';
import { syncReminders } from '@/features/reminders/sync';
import { formatClock, formatQuantity } from '@/lib/format';

export interface UndoState {
  message: string;
  run: () => Promise<void>;
}

type Perform = (deps: DoseActionDeps) => Promise<(() => Promise<void>) | void>;

/** Today-screen handlers: each logs a dose, refreshes reminders and the list, and offers undo. */
export function useTodayActions(reload: () => void) {
  const getDatabase = useDatabase();
  const [error, setError] = useState<string | null>(null);
  const [undo, setUndo] = useState<UndoState | null>(null);

  const act = useCallback(
    async (message: string, perform: Perform): Promise<boolean> => {
      setError(null);
      try {
        const db = await getDatabase();
        const deps: DoseActionDeps = { db, port: expoPort };
        const revert = await perform(deps);
        await syncReminders(db);
        setUndo(
          revert
            ? {
                message,
                run: async () => {
                  setUndo(null);
                  try {
                    await revert();
                    await syncReminders(db);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Could not undo.');
                  }
                  reload();
                },
              }
            : null,
        );
        reload();
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Something went wrong.');
        return false;
      }
    },
    [getDatabase, reload],
  );

  const refOf = (d: TimelineDose) => ({
    medicationId: d.medicationId,
    scheduledFor: d.scheduledFor,
    quantity: d.quantity,
  });

  /** Undo that restores whatever the dose was before the tap. */
  const revertTo = (d: TimelineDose, prior: DoseLog | null) => (deps: DoseActionDeps) => () =>
    undoDose(deps, refOf(d), prior);

  return {
    error,
    undo,
    dismissUndo: () => setUndo(null),

    taken: (d: TimelineDose, options: { quantity?: number; takenAt?: Date } = {}) =>
      act(`${d.name} marked taken`, async (deps) => {
        const { prior } = await takeDose(deps, refOf(d), options);
        return revertTo(d, prior)(deps);
      }),

    skip: (d: TimelineDose) =>
      act(`${d.name} skipped`, async (deps) => {
        const { prior } = await skipDose(deps, refOf(d));
        return revertTo(d, prior)(deps);
      }),

    snooze: (d: TimelineDose) =>
      act(`${d.name} snoozed`, async (deps) => {
        const { prior } = await snoozeDose(deps, refOf(d), {
          title: `Time for ${d.name}`,
          body: d.strength,
        });
        return revertTo(d, prior)(deps);
      }),

    /** Back to "no action yet" (undoes a Taken, Skip, or Missed). */
    clear: (d: TimelineDose) =>
      act(`${d.name} reset`, (deps) => undoDose(deps, refOf(d), null).then(() => undefined)),

    logAsNeeded: (entry: AsNeededEntry, options: { quantity?: number; takenAt?: Date } = {}) =>
      act(
        `${entry.medication.name} logged at ${formatClock(options.takenAt ?? new Date())}`,
        async (deps) => {
          const quantity = options.quantity ?? entry.quantity;
          const { scheduledFor } = await logAsNeededDose(deps, {
            medicationId: entry.medication.id,
            quantity,
            takenAt: options.takenAt,
          });
          return () => undoDose(deps, { medicationId: entry.medication.id, scheduledFor }, null);
        },
      ),

    removeAsNeeded: (entry: AsNeededEntry, log: DoseLog) =>
      act(`Removed ${formatQuantity(log.quantity ?? 0)} ${entry.medication.name}`, (deps) =>
        undoDose(
          deps,
          { medicationId: log.medicationId, scheduledFor: log.scheduledFor },
          null,
        ).then(() => undefined),
      ),
  };
}

export type TodayActions = ReturnType<typeof useTodayActions>;
