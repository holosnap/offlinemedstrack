import { openDatabaseAsync } from 'expo-sqlite';

import { migrate } from './migrate';
import type { Database } from './types';

const DATABASE_NAME = 'offlinemedstrack.db';

let opening: Promise<Database> | null = null;

/** Opens the on-device database once, applies pending migrations, and returns the shared handle. */
export function getDatabase(): Promise<Database> {
  if (opening) return opening;
  const pending = (async () => {
    const db = await openDatabaseAsync(DATABASE_NAME);
    // Per-connection settings; must run outside a transaction.
    await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    await migrate(db);
    return db;
  })();
  opening = pending;
  pending.catch(() => {
    opening = null; // allow a retry after a failed open
  });
  return pending;
}
