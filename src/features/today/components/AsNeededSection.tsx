import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Card, spacing } from '@/components';
import type { AsNeededEntry } from '@/features/doses/timeline';
import { formatClock, formatQuantity } from '@/lib/format';
import type { TodayActions } from '../useTodayActions';
import { CustomLogForm } from './CustomLogForm';

function Entry({
  entry,
  actions,
  now,
}: {
  entry: AsNeededEntry;
  actions: TodayActions;
  now: Date;
}) {
  const [custom, setCustom] = useState(false);
  const { medication } = entry;
  return (
    <Card style={styles.card}>
      <View style={styles.info}>
        <AppText variant="heading">{medication.name}</AppText>
        <AppText
          muted
        >{`${formatQuantity(medication.dosageAmount)} ${medication.dosageUnit}`}</AppText>
      </View>

      {custom ? (
        <CustomLogForm
          defaultQuantity={entry.quantity}
          now={now}
          submitLabel="Log dose"
          onCancel={() => setCustom(false)}
          onSubmit={async ({ quantity, takenAt }) => {
            const ok = await actions.logAsNeeded(entry, { quantity, takenAt });
            if (ok) setCustom(false);
            return ok;
          }}
        />
      ) : (
        <>
          <Button
            label={`Log ${entry.amount} now`}
            accessibilityHint={`Records a ${medication.name} dose taken right now`}
            onPress={() => actions.logAsNeeded(entry)}
          />
          <Button
            label="Different time or quantity"
            variant="secondary"
            onPress={() => setCustom(true)}
          />
        </>
      )}

      {entry.today.length > 0 ? (
        <View style={styles.history}>
          <AppText variant="label">Taken today</AppText>
          {entry.today.map((log) => (
            <View key={log.id} style={styles.logRow}>
              <AppText style={styles.logText}>
                {`${formatClock(log.scheduledFor)} · ${formatQuantity(log.quantity ?? 0)} taken`}
              </AppText>
              <Button
                label="Undo"
                variant="secondary"
                accessibilityHint={`Removes the ${formatClock(log.scheduledFor)} ${medication.name} dose`}
                onPress={() => actions.removeAsNeeded(entry, log)}
              />
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

/** As-needed (PRN) medications: log a dose at any time, with one tap. */
export function AsNeededSection({
  entries,
  actions,
  now,
}: {
  entries: AsNeededEntry[];
  actions: TodayActions;
  now: Date;
}) {
  if (entries.length === 0) return null;
  return (
    <View style={styles.section}>
      <AppText variant="heading">As needed</AppText>
      {entries.map((entry) => (
        <Entry key={entry.medication.id} entry={entry} actions={actions} now={now} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.md },
  card: { gap: spacing.md },
  info: { gap: spacing.xs },
  history: { gap: spacing.sm },
  logRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  logText: { flex: 1 },
});
