import { useState } from 'react';
import { Alert } from 'react-native';

import { AppText, Button, Card, usePalette } from '@/components';
import { useDatabase } from '@/db/DatabaseProvider';
import type { FileExporter } from '@/features/history/exporter';
import { formatLocalDate } from '@/lib/format';
import { localDateOf } from '@/lib/time';
import type { BackupSummary } from '../backup';
import { exportBackup, restoreFromPicker, type BackupPicker } from '../flow';

/** Asks before a restore replaces everything. */
export function confirmRestore(summary: BackupSummary): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      'Replace all data with this backup?',
      `It contains ${summary.medications} ${summary.medications === 1 ? 'medication' : 'medications'} and ${summary.doseLogs} dose ${summary.doseLogs === 1 ? 'record' : 'records'}, saved ${formatLocalDate(localDateOf(new Date(summary.exportedAt)))}. Everything currently in the app will be replaced. This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Replace', style: 'destructive', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

interface BackupCardProps {
  exporter: FileExporter;
  picker: BackupPicker;
  confirm?: (summary: BackupSummary) => Promise<boolean>;
  /** Called after a successful restore so the screen can reload its settings. */
  onRestored?: () => void;
}

/** Back up all data to a JSON file, or restore from one. */
export function BackupCard({
  exporter,
  picker,
  confirm = confirmRestore,
  onRestored,
}: BackupCardProps) {
  const palette = usePalette();
  const getDatabase = useDatabase();
  const [busy, setBusy] = useState<'export' | 'restore' | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const doExport = async () => {
    setBusy('export');
    setMessage(null);
    try {
      const { summary } = await exportBackup(await getDatabase(), exporter);
      setMessage({
        text: `Backup ready: ${summary.medications} ${summary.medications === 1 ? 'medication' : 'medications'}, ${summary.doseLogs} dose records.`,
        error: false,
      });
    } catch (e) {
      setMessage({
        text: e instanceof Error ? e.message : 'Could not create the backup.',
        error: true,
      });
    } finally {
      setBusy(null);
    }
  };

  const doRestore = async () => {
    setBusy('restore');
    setMessage(null);
    try {
      const outcome = await restoreFromPicker(await getDatabase(), picker, confirm);
      if (outcome.status === 'restored') {
        setMessage({
          text: `Restored ${outcome.summary.medications} ${outcome.summary.medications === 1 ? 'medication' : 'medications'} and ${outcome.summary.doseLogs} dose records.`,
          error: false,
        });
        onRestored?.();
      } else if (outcome.status === 'error') {
        setMessage({ text: outcome.message, error: true });
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card title="Backup and restore">
      <AppText muted>
        Save everything in the app to one file, and restore it later or on a new phone. The file is
        not encrypted and contains your health information, so keep it somewhere private.
      </AppText>
      <Button label="Export backup" onPress={doExport} disabled={busy !== null} />
      <Button
        label="Restore from backup"
        variant="secondary"
        accessibilityHint="Replaces everything in the app with the contents of a backup file"
        onPress={doRestore}
        disabled={busy !== null}
      />
      {busy ? <AppText accessibilityLiveRegion="polite">Working…</AppText> : null}
      {message ? (
        <AppText
          color={message.error ? palette.danger : undefined}
          accessibilityLiveRegion={message.error ? 'assertive' : 'polite'}
        >
          {message.text}
        </AppText>
      ) : null}
    </Card>
  );
}
