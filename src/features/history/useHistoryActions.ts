import { useCallback, useState } from 'react';

import { useDatabase } from '@/db/DatabaseProvider';
import type { DoseLog } from '@/db/models';
import type { Database } from '@/db/types';
import type { DoseRef } from '@/features/doses/state';
import { syncReminders } from '@/features/reminders/sync';
import { shortfallMessage } from '@/features/doses/shortfall';
import type { UndoState } from '@/features/today/useTodayActions';
import {
  addAsNeededDose,
  deleteAsNeededDose,
  editAsNeededDose,
  editScheduledDose,
  type EditResult,
  type PastDoseEdit,
} from './historyActions';

/** History-screen handlers: apply an edit, refresh reminders and the screen, and offer undo. */
export function useHistoryActions(reload: () => void) {
  const getDatabase = useDatabase();
  const [error, setError] = useState<string | null>(null);
  const [undo, setUndo] = useState<UndoState | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const act = useCallback(
    async (
      message: string,
      perform: (db: Database) => Promise<EditResult>,
      name = '',
    ): Promise<boolean> => {
      setError(null);
      setWarning(null);
      try {
        const db = await getDatabase();
        const result = await perform(db);
        setWarning(shortfallMessage(name, result.shortfall));
        // A supply change can start or end a refill reminder episode.
        await syncReminders(db);
        setUndo({
          message,
          run: async () => {
            setUndo(null);
            try {
              await result.undo();
              await syncReminders(db);
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Could not undo.');
            }
            reload();
          },
        });
        reload();
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Something went wrong.');
        return false;
      }
    },
    [getDatabase, reload],
  );

  return {
    error,
    undo,
    warning,
    dismissWarning: () => setWarning(null),
    dismissUndo: () => setUndo(null),
    editDose: (name: string, ref: DoseRef, edit: PastDoseEdit) =>
      act(`${name} updated`, (db) => editScheduledDose(db, ref, edit), name),
    addAsNeeded: (name: string, input: { medicationId: number; quantity: number; takenAt: Date }) =>
      act(`${name} dose added`, (db) => addAsNeededDose(db, input), name),
    editAsNeeded: (name: string, log: DoseLog, input: { quantity: number; takenAt: Date }) =>
      act(`${name} dose updated`, (db) => editAsNeededDose(db, log, input), name),
    removeAsNeeded: (name: string, log: DoseLog) =>
      act(`${name} dose removed`, (db) => deleteAsNeededDose(db, log)),
  };
}

export type HistoryActions = ReturnType<typeof useHistoryActions>;
