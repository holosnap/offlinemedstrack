import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Card, ChoiceGroup, radius, spacing, usePalette } from '@/components';
import { ADHERENCE_WINDOWS, type AdherenceWindow, type MedicationAdherence } from '../adherence';

const WINDOW_CHOICES = ADHERENCE_WINDOWS.map((d) => ({ value: d, label: `${d} days` }));

function AdherenceRow({ row, window }: { row: MedicationAdherence; window: AdherenceWindow }) {
  const palette = usePalette();
  const stats = row.windows[window];
  const detail = row.asNeeded
    ? `${row.asNeededCounts[window]} ${row.asNeededCounts[window] === 1 ? 'dose' : 'doses'} taken as needed`
    : stats.expected === 0
      ? 'No scheduled doses in this period'
      : `${stats.taken} of ${stats.expected} ${stats.expected === 1 ? 'dose' : 'doses'} taken`;
  const percent = row.asNeeded || stats.percent === null ? null : stats.percent;
  return (
    <View
      accessible
      accessibilityLabel={`${row.name}${row.active ? '' : ', paused'}. ${percent === null ? '' : `${percent} percent. `}${detail}`}
      style={styles.row}
    >
      <View style={styles.rowHeader}>
        <AppText variant="label" style={styles.name}>
          {row.active ? row.name : `${row.name} (paused)`}
        </AppText>
        {percent !== null ? <AppText variant="heading">{`${percent}%`}</AppText> : null}
      </View>
      {percent !== null ? (
        <View style={[styles.track, { backgroundColor: palette.infoBackground }]}>
          <View style={[styles.fill, { width: `${percent}%`, backgroundColor: palette.primary }]} />
        </View>
      ) : null}
      <AppText muted>{detail}</AppText>
    </View>
  );
}

/** Per-medication adherence over the last 7, 30 or 90 days. */
export function AdherenceCard({ rows }: { rows: readonly MedicationAdherence[] }) {
  const [window, setWindow] = useState<AdherenceWindow>(30);
  return (
    <Card title="Adherence">
      <ChoiceGroup label="Period" choices={WINDOW_CHOICES} selected={window} onChange={setWindow} />
      {rows.length === 0 ? (
        <AppText muted>Add a medication to see adherence.</AppText>
      ) : (
        rows.map((row) => <AdherenceRow key={row.medicationId} row={row} window={window} />)
      )}
      <AppText variant="caption" muted>
        Taken doses divided by doses due. Skipped and missed doses count as not taken.
      </AppText>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { gap: spacing.xs },
  rowHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  name: { flex: 1 },
  track: { height: 12, borderRadius: radius, overflow: 'hidden' },
  fill: { height: 12, borderRadius: radius },
});
