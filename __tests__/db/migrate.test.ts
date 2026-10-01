import { getSchemaVersion, migrate, validateMigrations, type Migration } from '@/db/migrate';
import { migrations } from '@/db/migrations';
import { createMedication } from '@/db/repositories/medications';

import { createTestDb } from '../helpers/testDb';

const tableNames = async (db: Awaited<ReturnType<typeof createTestDb>>) =>
  (
    await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
  ).map((r) => r.name);

describe('migrations', () => {
  it('creates the full schema and records the version', async () => {
    const db = await createTestDb({ migrate: false });
    expect(await getSchemaVersion(db)).toBe(0);
    await migrate(db);
    expect(await getSchemaVersion(db)).toBe(migrations.length);
    expect(await tableNames(db)).toEqual([
      'dose_logs',
      'inventory',
      'medications',
      'refill_events',
      'schedules',
      'settings',
    ]);
  });

  it('is idempotent', async () => {
    const db = await createTestDb();
    await createMedication(db, { name: 'A', dosageAmount: 1, dosageUnit: 'mg', form: 'tablet' });
    await migrate(db);
    expect((await db.getAllAsync('SELECT * FROM medications')).length).toBe(1);
  });

  it('applies only new migrations and preserves existing data', async () => {
    const db = await createTestDb();
    await createMedication(db, { name: 'A', dosageAmount: 1, dosageUnit: 'mg', form: 'tablet' });
    const v2: Migration = {
      version: migrations.length + 1,
      name: 'add_medications_prescriber',
      async up(d) {
        await d.execAsync('ALTER TABLE medications ADD COLUMN prescriber TEXT');
      },
    };
    await migrate(db, [...migrations, v2]);
    expect(await getSchemaVersion(db)).toBe(v2.version);
    const rows = await db.getAllAsync<{ name: string; prescriber: string | null }>(
      'SELECT name, prescriber FROM medications',
    );
    expect(rows).toEqual([{ name: 'A', prescriber: null }]);
  });

  it('rolls back a failing migration and keeps the previous version', async () => {
    const db = await createTestDb();
    const bad: Migration = {
      version: migrations.length + 1,
      name: 'bad',
      async up(d) {
        await d.execAsync('CREATE TABLE half_done (id INTEGER)');
        throw new Error('boom');
      },
    };
    await expect(migrate(db, [...migrations, bad])).rejects.toThrow('boom');
    expect(await getSchemaVersion(db)).toBe(migrations.length);
    expect(await tableNames(db)).not.toContain('half_done');
  });

  it('refuses a database from a newer app version', async () => {
    const db = await createTestDb();
    await db.execAsync(`PRAGMA user_version = ${migrations.length + 5}`);
    await expect(migrate(db)).rejects.toThrow(/newer than this app supports/);
  });

  it('rejects non-contiguous version numbers', () => {
    const m = (version: number): Migration => ({
      version,
      name: `m${version}`,
      up: async () => {},
    });
    expect(() => validateMigrations([m(1), m(3)])).toThrow(/expected 2/);
  });
});
