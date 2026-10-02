import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';

import type { Database } from '@/db/types';
import type { FileExporter } from '@/features/history/exporter';
import { syncReminders } from '@/features/reminders/sync';
import { localDateOf } from '@/lib/time';
import {
  backupFileName,
  createBackup,
  parseBackup,
  restoreBackup,
  serializeBackup,
  type BackupSummary,
} from './backup';

/** Lets the person choose a backup file; returns its text, or null if they cancelled. */
export interface BackupPicker {
  pickText(): Promise<string | null>;
}

export const expoBackupPicker: BackupPicker = {
  async pickText() {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/json', 'text/plain', '*/*'],
      copyToCacheDirectory: true,
    });
    if (result.canceled || result.assets.length === 0) return null;
    return new FileSystem.File(result.assets[0].uri).text();
  },
};

/** Writes all data to a JSON file and opens the share sheet to save or send it. */
export async function exportBackup(
  db: Database,
  exporter: FileExporter,
  now: Date = new Date(),
): Promise<{ fileName: string; summary: BackupSummary }> {
  if (!(await exporter.canShare())) throw new Error('Sharing is not available on this device.');
  const backup = await createBackup(db, now);
  const fileName = backupFileName(localDateOf(now));
  const uri = await exporter.writeText(fileName, serializeBackup(backup));
  await exporter.share(uri, 'json', 'Save medication backup');
  return {
    fileName,
    summary: {
      schemaVersion: backup.schemaVersion,
      exportedAt: backup.exportedAt,
      medications: backup.tables.medications.length,
      doseLogs: backup.tables.dose_logs.length,
      refillEvents: backup.tables.refill_events.length,
    },
  };
}

export type RestoreOutcome =
  | { status: 'cancelled' }
  | { status: 'restored'; summary: BackupSummary }
  | { status: 'error'; message: string };

/**
 * Pick a file, validate it completely, ask for confirmation (it replaces everything), then restore.
 * Nothing is changed unless the file is valid and the person confirms.
 */
export async function restoreFromPicker(
  db: Database,
  picker: BackupPicker,
  confirm: (summary: BackupSummary) => Promise<boolean>,
): Promise<RestoreOutcome> {
  let text: string | null;
  try {
    text = await picker.pickText();
  } catch {
    return { status: 'error', message: "Couldn't open that file." };
  }
  if (text === null) return { status: 'cancelled' };

  const parsed = parseBackup(text);
  if (!parsed.ok) return { status: 'error', message: parsed.error };
  if (!(await confirm(parsed.summary))) return { status: 'cancelled' };

  try {
    await restoreBackup(db, parsed.backup);
  } catch {
    return {
      status: 'error',
      message: "The backup couldn't be restored, so your current data was left unchanged.",
    };
  }
  await syncReminders(db);
  return { status: 'restored', summary: parsed.summary };
}
