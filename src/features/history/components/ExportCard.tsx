import { useState } from 'react';

import { AppText, Button, Card, ChoiceGroup, usePalette } from '@/components';
import { useDatabase } from '@/db/DatabaseProvider';
import {
  EXPORT_RANGES,
  exportHistory,
  type ExportFormat,
  type ExportRange,
} from '../exportHistory';
import type { FileExporter } from '../exporter';

/** Export the history as CSV or PDF through the system share sheet (e.g. for a doctor's visit). */
export function ExportCard({ exporter }: { exporter: FileExporter }) {
  const palette = usePalette();
  const getDatabase = useDatabase();
  const [range, setRange] = useState<ExportRange>(30);
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const run = async (format: ExportFormat) => {
    setBusy(format);
    setMessage(null);
    try {
      const { rows } = await exportHistory(await getDatabase(), exporter, { format, range });
      setMessage({
        text: `Prepared ${rows} ${rows === 1 ? 'entry' : 'entries'} to share.`,
        error: false,
      });
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : 'Could not export.', error: true });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card title="Share with your doctor">
      <AppText muted>
        Create a file of your dose history. Nothing is sent anywhere until you choose where to share
        it.
      </AppText>
      <ChoiceGroup
        label="Period"
        choices={EXPORT_RANGES.map((r) => ({ value: String(r.value), label: r.label }))}
        selected={String(range)}
        onChange={(v) => setRange(v === 'all' ? 'all' : (Number(v) as 30 | 90))}
      />
      <Button label="Export CSV" onPress={() => run('csv')} disabled={busy !== null} />
      <Button label="Export PDF" onPress={() => run('pdf')} disabled={busy !== null} />
      {busy ? (
        <AppText accessibilityLiveRegion="polite">{`Preparing ${busy.toUpperCase()}…`}</AppText>
      ) : null}
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
