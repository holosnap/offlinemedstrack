import { migrations } from './migrations';
import type { Database } from './types';

export interface Migration {
  /** Strictly increasing from 1, no gaps. Never renumber or edit a shipped migration. */
  version: number;
  name: string;
  up(db: Database): Promise<void>;
}

export function validateMigrations(list: readonly Migration[]): void {
  list.forEach((m, i) => {
    if (m.version !== i + 1) {
      throw new Error(`Migration "${m.name}" has version ${m.version}, expected ${i + 1}`);
    }
  });
}

export async function getSchemaVersion(db: Database): Promise<number> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  return row?.user_version ?? 0;
}

/**
 * Applies pending migrations in order. Each runs in its own transaction together with the bump of
 * `PRAGMA user_version`, so a failure rolls back that migration and leaves earlier ones (and all
 * user data) intact. Refuses to run against a database written by a newer app version.
 */
export async function migrate(
  db: Database,
  list: readonly Migration[] = migrations,
): Promise<number> {
  validateMigrations(list);
  const current = await getSchemaVersion(db);
  const latest = list.length;
  if (current > latest) {
    throw new Error(`Database schema v${current} is newer than this app supports (v${latest})`);
  }
  for (const migration of list.slice(current)) {
    await db.withTransactionAsync(async () => {
      await migration.up(db);
      await db.execAsync(`PRAGMA user_version = ${migration.version}`);
    });
  }
  return latest;
}
