import {
  BACKUP_SCHEMA_VERSION,
  BACKUP_SETTING_KEYS,
  BACKUP_TABLES,
  readBackupData,
  replaceBackupData,
  type BackupData,
  type BackupRow,
} from '@/db/backup';
import type { Database } from '@/db/types';

export const BACKUP_FORMAT = 'offlinemedstrack-backup';

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  /** The database schema version the data was written for. */
  schemaVersion: number;
  exportedAt: string;
  tables: Record<string, BackupRow[]>;
  settings: Record<string, string>;
}

export interface BackupSummary {
  schemaVersion: number;
  exportedAt: string;
  medications: number;
  doseLogs: number;
  refillEvents: number;
}

export type ParseResult =
  { ok: true; backup: BackupFile; summary: BackupSummary } | { ok: false; error: string };

export async function createBackup(db: Database, now: Date = new Date()): Promise<BackupFile> {
  const data = await readBackupData(db);
  return {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    tables: data.tables,
    settings: data.settings,
  };
}

export function serializeBackup(backup: BackupFile): string {
  return JSON.stringify(backup, null, 2);
}

export const backupFileName = (today: string) => `offlinemedstrack-backup-${today}.json`;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const bad = (error: string): ParseResult => ({ ok: false, error });

/**
 * Reads and fully validates a backup file before anything is changed: the format marker, the
 * schema version (backups from a newer app are refused; older ones are accepted and any tables
 * they predate are simply empty), every row's columns and types, and that every row points at a
 * medication that is in the file.
 */
export function parseBackup(raw: string): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return bad("This file isn't a valid backup (it couldn't be read).");
  }
  if (!isRecord(json) || json.format !== BACKUP_FORMAT) {
    return bad("This isn't an OfflineMedsTrack backup file.");
  }
  const version = json.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return bad('This backup has no valid version number, so it can’t be restored.');
  }
  if (version > BACKUP_SCHEMA_VERSION) {
    return bad(
      `This backup was made by a newer version of the app (data version ${version}; this app supports up to ${BACKUP_SCHEMA_VERSION}). Update the app, then try again.`,
    );
  }
  if (typeof json.exportedAt !== 'string' || Number.isNaN(new Date(json.exportedAt).getTime())) {
    return bad('This backup is missing its date, so it can’t be restored.');
  }
  if (!isRecord(json.tables)) return bad('This backup has no data in it.');

  const tables: Record<string, BackupRow[]> = {};
  const keys = new Map<string, Set<number>>();
  for (const spec of BACKUP_TABLES) {
    const rows = json.tables[spec.name];
    if (rows === undefined) {
      tables[spec.name] = []; // a table that didn't exist yet in an older version
      keys.set(spec.name, new Set());
      continue;
    }
    if (!Array.isArray(rows)) return bad(`The "${spec.name}" part of this backup is damaged.`);
    const seen = new Set<number>();
    const checked: BackupRow[] = [];
    for (const [index, row] of rows.entries()) {
      const where = `"${spec.name}" entry ${index + 1}`;
      if (!isRecord(row)) return bad(`${where} is damaged.`);
      const clean: BackupRow = {};
      for (const column of spec.columns) {
        const value = row[column.name];
        if (value === null || value === undefined) {
          if (!column.nullable) return bad(`${where} is missing "${column.name}".`);
          clean[column.name] = null;
          continue;
        }
        const valid =
          column.type === 'text'
            ? typeof value === 'string'
            : typeof value === 'number' &&
              Number.isFinite(value) &&
              (column.type !== 'int' || Number.isInteger(value));
        if (!valid) return bad(`${where} has an invalid "${column.name}".`);
        clean[column.name] = value as string | number;
      }
      const id = clean[spec.key] as number;
      if (seen.has(id)) return bad(`${where} appears twice.`);
      seen.add(id);
      checked.push(clean);
    }
    tables[spec.name] = checked;
    keys.set(spec.name, seen);
  }
  for (const spec of BACKUP_TABLES) {
    for (const [column, parent] of Object.entries(spec.references ?? {})) {
      for (const row of tables[spec.name]) {
        if (!keys.get(parent)?.has(row[column] as number)) {
          return bad(
            `The "${spec.name}" part of this backup refers to a medication that isn't in it.`,
          );
        }
      }
    }
  }

  const settings: Record<string, string> = {};
  if (json.settings !== undefined) {
    if (!isRecord(json.settings)) return bad('The settings in this backup are damaged.');
    for (const key of BACKUP_SETTING_KEYS) {
      const value = json.settings[key];
      if (value === undefined) continue;
      if (typeof value !== 'string') return bad(`The setting "${key}" in this backup is damaged.`);
      settings[key] = value;
    }
  }

  return {
    ok: true,
    backup: {
      format: BACKUP_FORMAT,
      schemaVersion: version,
      exportedAt: json.exportedAt,
      tables,
      settings,
    },
    summary: {
      schemaVersion: version,
      exportedAt: json.exportedAt,
      medications: tables.medications.length,
      doseLogs: tables.dose_logs.length,
      refillEvents: tables.refill_events.length,
    },
  };
}

/** Replaces all current data with the (already validated) backup, atomically. */
export async function restoreBackup(db: Database, backup: BackupFile): Promise<void> {
  const data: BackupData = { tables: backup.tables, settings: backup.settings };
  await replaceBackupData(db, data);
}
