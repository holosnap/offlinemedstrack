import {
  createInventory,
  createMedication,
  createSchedule,
  getInventory,
  getSetting,
  listDoseLogsInRange,
  listMedications,
  listRefillEventsForMedication,
  recordDose,
  recordRefill,
  setSetting,
} from '@/db/repositories';
import { BACKUP_SCHEMA_VERSION } from '@/db/backup';
import type { Database } from '@/db/types';
import {
  BACKUP_FORMAT,
  backupFileName,
  createBackup,
  parseBackup,
  restoreBackup,
  serializeBackup,
  type BackupFile,
} from '@/features/backup/backup';
import { exportBackup, restoreFromPicker, type BackupPicker } from '@/features/backup/flow';
import type { FileExporter } from '@/features/history/exporter';
import { syncReminders } from '@/features/reminders/sync';
import { updateSettings } from '@/features/settings/settings';
import { createTestDb } from '../helpers/testDb';

jest.mock('@/features/reminders/sync');

const NOW = new Date(2026, 5, 10, 14, 0);

async function seed(db: Database) {
  const med = await createMedication(db, {
    name: 'Metformin',
    dosageAmount: 500,
    dosageUnit: 'mg',
    form: 'tablet',
    instructions: 'with food',
  });
  await createSchedule(db, {
    medicationId: med.id,
    type: 'weekdays',
    times: ['08:00', '20:00'],
    daysOfWeek: [1, 3, 5],
    startDate: '2026-01-01',
    doseQuantity: 2,
  });
  await createInventory(db, {
    medicationId: med.id,
    currentQuantity: 30,
    unit: 'tablets',
    refillThreshold: 7,
    refillThresholdUnit: 'days',
    refillsRemaining: 2,
    pharmacyName: 'Corner Pharmacy',
    pharmacyPhone: '(555) 123-4567',
  });
  await recordDose(db, {
    medicationId: med.id,
    scheduledFor: new Date(2026, 5, 8, 8, 0),
    status: 'taken',
    actedAt: new Date(2026, 5, 8, 8, 5),
    quantity: 2,
    note: 'with "breakfast"',
  });
  await recordDose(db, {
    medicationId: med.id,
    scheduledFor: new Date(2026, 5, 9, 8, 0),
    status: 'skipped',
  });
  await recordRefill(db, { medicationId: med.id, quantityAdded: 30, note: 'Picked up' });
  return med.id;
}

const dump = async (db: Database) => ({
  meds: await listMedications(db),
  inventory: await getInventory(db, 1),
  logs: await listDoseLogsInRange(db, '2000-01-01T00:00:00.000Z', '2100-01-01T00:00:00.000Z'),
  refills: await listRefillEventsForMedication(db, 1),
  schedules: await db.getAllAsync('SELECT * FROM schedules'),
});

describe('createBackup / parseBackup', () => {
  it('writes a versioned file that round-trips', async () => {
    const db = await createTestDb();
    await seed(db);
    const backup = await createBackup(db, NOW);
    expect(backup).toMatchObject({
      format: BACKUP_FORMAT,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: NOW.toISOString(),
    });
    expect(Object.keys(backup.tables)).toEqual([
      'medications',
      'schedules',
      'dose_logs',
      'inventory',
      'refill_events',
      'refill_alerts',
    ]);

    const parsed = parseBackup(serializeBackup(backup));
    expect(parsed).toMatchObject({
      ok: true,
      summary: {
        medications: 1,
        doseLogs: 2,
        refillEvents: 1,
        schemaVersion: BACKUP_SCHEMA_VERSION,
      },
    });
    expect(parsed.ok && parsed.backup.tables).toEqual(backup.tables);
  });

  it('names the file by date', () => {
    expect(backupFileName('2026-06-10')).toBe('offlinemedstrack-backup-2026-06-10.json');
  });
});

describe('restoreBackup', () => {
  it('rebuilds an identical database, including ids and relationships', async () => {
    const source = await createTestDb();
    await seed(source);
    const parsed = parseBackup(serializeBackup(await createBackup(source, NOW)));
    if (!parsed.ok) throw new Error(parsed.error);

    const target = await createTestDb();
    await restoreBackup(target, parsed.backup);
    expect(await dump(target)).toEqual(await dump(source));

    // New rows keep counting from the restored ids.
    const added = await createMedication(target, {
      name: 'New',
      dosageAmount: 1,
      dosageUnit: 'mg',
      form: 'tablet',
    });
    expect(added.id).toBe(2);
  });

  it('replaces whatever is in the app now', async () => {
    const source = await createTestDb();
    await seed(source);
    const parsed = parseBackup(serializeBackup(await createBackup(source, NOW)));
    if (!parsed.ok) throw new Error(parsed.error);

    const target = await createTestDb();
    const other = await createMedication(target, {
      name: 'Old',
      dosageAmount: 1,
      dosageUnit: 'g',
      form: 'other',
    });
    await createInventory(target, { medicationId: other.id, currentQuantity: 5, unit: 'units' });
    await restoreBackup(target, parsed.backup);
    expect((await listMedications(target)).map((m) => m.name)).toEqual(['Metformin']);
  });

  it('restores portable settings but keeps this device’s lock and onboarding state', async () => {
    const source = await createTestDb();
    await updateSettings(source, {
      snoozeMinutes: 15,
      theme: 'dark',
      appLock: true,
      onboardingComplete: true,
    });
    const backup = await createBackup(source, NOW);
    expect(backup.settings).toMatchObject({ snoozeMinutes: '15', theme: 'dark' });
    expect(backup.settings).not.toHaveProperty('appLock');
    expect(backup.settings).not.toHaveProperty('onboardingComplete');

    const target = await createTestDb();
    await updateSettings(target, { appLock: false, onboardingComplete: true, snoozeMinutes: 5 });
    await restoreBackup(target, backup);
    expect(await getSetting(target, 'snoozeMinutes')).toBe('15');
    expect(await getSetting(target, 'theme')).toBe('dark');
    expect(await getSetting(target, 'appLock')).toBe('false');
    expect(await getSetting(target, 'onboardingComplete')).toBe('true');
  });

  it('changes nothing if the database rejects any row', async () => {
    const db = await createTestDb();
    await seed(db);
    const before = await dump(db);

    const backup = await createBackup(db, NOW);
    // Valid types, but not a status the database allows.
    backup.tables.dose_logs[0] = { ...backup.tables.dose_logs[0], status: 'exploded' };
    const parsed = parseBackup(serializeBackup(backup));
    if (!parsed.ok) throw new Error(parsed.error);
    await expect(restoreBackup(db, parsed.backup)).rejects.toThrow();
    expect(await dump(db)).toEqual(before);
    await setSetting(db, 'theme', 'light'); // the database is still usable
  });
});

describe('parseBackup validation', () => {
  const valid = async (): Promise<BackupFile> => {
    const db = await createTestDb();
    await seed(db);
    return createBackup(db, NOW);
  };
  const error = (value: unknown) => {
    const result = parseBackup(typeof value === 'string' ? value : JSON.stringify(value));
    if (result.ok) throw new Error('expected an error');
    return result.error;
  };

  it('rejects files that are not backups', () => {
    expect(error('not json {')).toContain("couldn't be read");
    expect(error('[1,2,3]')).toContain("isn't an OfflineMedsTrack backup");
    expect(error({ format: 'something-else', schemaVersion: 1 })).toContain(
      "isn't an OfflineMedsTrack backup",
    );
  });

  it('checks the schema version', async () => {
    const backup = await valid();
    const newer = error({ ...backup, schemaVersion: BACKUP_SCHEMA_VERSION + 1 });
    expect(newer).toContain('newer version of the app');
    expect(newer).toContain(String(BACKUP_SCHEMA_VERSION + 1));
    for (const schemaVersion of [0, -1, 1.5, '3', null, undefined]) {
      expect(error({ ...backup, schemaVersion })).toContain('version number');
    }
  });

  it('accepts older backups; tables that did not exist yet are empty', async () => {
    const backup = await valid();
    const v1 = {
      ...backup,
      schemaVersion: 1,
      settings: undefined,
      tables: {
        medications: backup.tables.medications,
        schedules: backup.tables.schedules,
        dose_logs: backup.tables.dose_logs,
        inventory: backup.tables.inventory,
        refill_events: backup.tables.refill_events,
      },
    };
    const parsed = parseBackup(JSON.stringify(v1));
    expect(parsed).toMatchObject({ ok: true, summary: { schemaVersion: 1, medications: 1 } });
    expect(parsed.ok && parsed.backup.tables.refill_alerts).toEqual([]);
    expect(parsed.ok && parsed.backup.settings).toEqual({});

    const target = await createTestDb();
    if (parsed.ok) await restoreBackup(target, parsed.backup);
    expect((await listMedications(target)).length).toBe(1);
  });

  it('finds damaged rows and says where', async () => {
    const backup = await valid();
    const clone = () => JSON.parse(JSON.stringify(backup)) as BackupFile;

    const missing = clone();
    delete missing.tables.medications[0].name;
    expect(error(missing)).toBe('"medications" entry 1 is missing "name".');

    const wrongType = clone();
    wrongType.tables.dose_logs[1].medication_id = 'one';
    expect(error(wrongType)).toBe('"dose_logs" entry 2 has an invalid "medication_id".');

    const fractionalId = clone();
    fractionalId.tables.medications[0].id = 1.5;
    expect(error(fractionalId)).toContain('invalid "id"');

    const notFinite = clone();
    notFinite.tables.inventory[0].current_quantity = '30';
    expect(error(notFinite)).toContain('invalid "current_quantity"');

    const duplicate = clone();
    duplicate.tables.dose_logs.push({ ...duplicate.tables.dose_logs[0] });
    expect(error(duplicate)).toContain('appears twice');

    const notArray = clone() as unknown as { tables: Record<string, unknown> };
    notArray.tables.schedules = 'nope';
    expect(error(notArray)).toBe('The "schedules" part of this backup is damaged.');

    const notRow = clone() as unknown as { tables: Record<string, unknown[]> };
    notRow.tables.schedules[0] = 5;
    expect(error(notRow)).toBe('"schedules" entry 1 is damaged.');
  });

  it('rejects rows that point at a medication that is not in the file', async () => {
    const backup = await valid();
    backup.tables.dose_logs[0].medication_id = 999;
    expect(error(backup)).toContain("refers to a medication that isn't in it");
  });

  it('rejects damaged metadata and settings', async () => {
    const backup = await valid();
    expect(error({ ...backup, exportedAt: 'yesterday' })).toContain('missing its date');
    expect(error({ ...backup, tables: 5 })).toContain('no data');
    expect(error({ ...backup, settings: [] })).toContain('settings in this backup are damaged');
    expect(error({ ...backup, settings: { theme: 5 } })).toContain('"theme"');
  });

  it('ignores settings it does not recognise (including device-only ones)', async () => {
    const backup = await valid();
    const parsed = parseBackup(
      JSON.stringify({ ...backup, settings: { theme: 'dark', appLock: 'true', other: 'x' } }),
    );
    expect(parsed.ok && parsed.backup.settings).toEqual({ theme: 'dark' });
  });
});

describe('exportBackup', () => {
  class FakeExporter implements FileExporter {
    available = true;
    files: { name: string; content: string }[] = [];
    shared: { uri: string; kind: string }[] = [];
    async canShare() {
      return this.available;
    }
    async writeText(name: string, content: string) {
      this.files.push({ name, content });
      return `file:///cache/${name}`;
    }
    async htmlToPdf() {
      return '';
    }
    async share(uri: string, kind: 'csv' | 'pdf' | 'json') {
      this.shared.push({ uri, kind });
    }
  }

  it('writes the JSON file and opens the share sheet', async () => {
    const db = await createTestDb();
    await seed(db);
    const exporter = new FakeExporter();
    const result = await exportBackup(db, exporter, NOW);
    expect(result.fileName).toBe('offlinemedstrack-backup-2026-06-10.json');
    expect(result.summary).toMatchObject({ medications: 1, doseLogs: 2, refillEvents: 1 });
    expect(JSON.parse(exporter.files[0].content).format).toBe(BACKUP_FORMAT);
    expect(exporter.shared).toEqual([{ uri: `file:///cache/${result.fileName}`, kind: 'json' }]);
  });

  it('explains when sharing is unavailable', async () => {
    const exporter = new FakeExporter();
    exporter.available = false;
    await expect(exportBackup(await createTestDb(), exporter, NOW)).rejects.toThrow(
      'Sharing is not available',
    );
    expect(exporter.files).toEqual([]);
  });
});

describe('restoreFromPicker', () => {
  const picker = (text: string | null | Error): BackupPicker => ({
    async pickText() {
      if (text instanceof Error) throw text;
      return text;
    },
  });
  let source: Database;
  let backupText: string;

  beforeEach(async () => {
    jest.clearAllMocks();
    source = await createTestDb();
    await seed(source);
    backupText = serializeBackup(await createBackup(source, NOW));
  });

  it('restores after confirmation and refreshes reminders', async () => {
    const target = await createTestDb();
    const confirm = jest.fn().mockResolvedValue(true);
    const outcome = await restoreFromPicker(target, picker(backupText), confirm);
    expect(outcome).toMatchObject({ status: 'restored', summary: { medications: 1, doseLogs: 2 } });
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ medications: 1 }));
    expect((await listMedications(target)).length).toBe(1);
    expect(syncReminders).toHaveBeenCalledWith(target);
  });

  it('leaves everything alone when cancelled at the picker or at the confirmation', async () => {
    const target = await createTestDb();
    expect(await restoreFromPicker(target, picker(null), async () => true)).toEqual({
      status: 'cancelled',
    });
    expect(await restoreFromPicker(target, picker(backupText), async () => false)).toEqual({
      status: 'cancelled',
    });
    expect((await listMedications(target)).length).toBe(0);
    expect(syncReminders).not.toHaveBeenCalled();
  });

  it('reports a bad file without asking to replace anything', async () => {
    const target = await createTestDb();
    const confirm = jest.fn();
    const outcome = await restoreFromPicker(target, picker('{"format":"nope"}'), confirm);
    expect(outcome).toMatchObject({ status: 'error' });
    expect(confirm).not.toHaveBeenCalled();
    const unreadable = await restoreFromPicker(target, picker(new Error('denied')), confirm);
    expect(unreadable).toEqual({ status: 'error', message: "Couldn't open that file." });
  });

  it('keeps current data and says so when the restore itself fails', async () => {
    const target = await createTestDb();
    await seed(target);
    const before = await dump(target);
    const broken = JSON.parse(backupText) as BackupFile;
    broken.tables.dose_logs[0].status = 'exploded';
    const outcome = await restoreFromPicker(
      target,
      picker(JSON.stringify(broken)),
      async () => true,
    );
    expect(outcome).toMatchObject({ status: 'error' });
    expect(outcome.status === 'error' && outcome.message).toContain('left unchanged');
    expect(await dump(target)).toEqual(before);
  });
});
