import type { Database } from '@/db/types';
import { expoPort } from './expoPort';
import { reconcile } from './reconcile';

/** Best-effort reconcile for callers that must not fail because of notifications (e.g. saves). */
export async function syncReminders(db: Database): Promise<void> {
  try {
    await reconcile({ db, port: expoPort });
  } catch (error) {
    console.warn('Could not update dose reminders', error);
  }
}
