import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Badge, Button, Card, spacing, usePalette } from '@/components';
import { snoozeUntil, type TimelineDose } from '@/features/doses/timeline';
import { formatClock, formatQuantity } from '@/lib/format';
import type { TodayActions } from '../useTodayActions';
import { CustomLogForm } from './CustomLogForm';

interface DoseRowProps {
  dose: TimelineDose;
  actions: TodayActions;
  now: Date;
  /** Snooze length from Settings, shown on the button. */
  snoozeMinutes: number;
}

export function statusText(dose: TimelineDose, snoozeMinutes: number): string {
  const due = formatClock(dose.scheduledFor);
  switch (dose.status) {
    case 'upcoming':
      return `Due ${due}`;
    case 'overdue':
      return `Overdue, was due ${due}`;
    case 'snoozed': {
      const until = dose.log ? snoozeUntil(dose.log, snoozeMinutes) : null;
      return until ? `Snoozed until ${formatClock(until)}` : 'Snoozed';
    }
    case 'taken': {
      const at = dose.log?.actedAt ? ` at ${formatClock(dose.log.actedAt)}` : '';
      const qty = dose.log?.quantity;
      const different =
        qty != null && qty !== dose.quantity ? `, ${formatQuantity(qty)} taken` : '';
      return `Taken${at}${different}`;
    }
    case 'skipped':
      return 'Skipped';
    case 'missed':
      return `Missed, was due ${due}`;
  }
}

/** One scheduled dose: what it is, its status, and the actions that apply to that status. */
export function DoseRow({ dose, actions, now, snoozeMinutes }: DoseRowProps) {
  const palette = usePalette();
  const [mode, setMode] = useState<'closed' | 'more' | 'custom'>('closed');
  const resolved = dose.status === 'taken' || dose.status === 'skipped';
  const label = `${dose.name} ${formatClock(dose.scheduledFor)}`;

  return (
    <Card
      style={[
        styles.card,
        dose.overdue && { borderWidth: 3, borderColor: palette.danger },
        dose.status === 'missed' && { borderWidth: 2, borderColor: palette.border },
      ]}
    >
      <View
        testID={`dose-${dose.key}`}
        accessible
        accessibilityLabel={`${dose.name}, ${dose.strength}, ${dose.amount}. ${statusText(dose, snoozeMinutes)}`}
        style={styles.info}
      >
        <AppText variant="heading">{dose.name}</AppText>
        <AppText muted>{`${dose.strength} · ${dose.amount}`}</AppText>
        <AppText
          color={dose.overdue ? palette.danger : undefined}
          style={dose.overdue ? styles.bold : undefined}
        >
          {statusText(dose, snoozeMinutes)}
        </AppText>
        {dose.overdue ? <Badge tone="warning" label="Overdue" /> : null}
        {dose.status === 'missed' ? <Badge label="Missed" /> : null}
      </View>

      {resolved ? (
        <Button
          label="Undo"
          accessibilityLabel={`Undo ${label}`}
          variant="secondary"
          accessibilityHint="Resets this dose to not yet logged"
          onPress={() => actions.clear(dose)}
        />
      ) : mode === 'custom' ? (
        <CustomLogForm
          defaultQuantity={dose.quantity}
          now={now}
          submitLabel="Save dose"
          onCancel={() => setMode('more')}
          onSubmit={({ quantity, takenAt }) => actions.taken(dose, { quantity, takenAt })}
        />
      ) : (
        <>
          <Button
            label="Taken"
            accessibilityLabel={`Taken, ${label}`}
            accessibilityHint="Marks this dose as taken"
            onPress={() => actions.taken(dose)}
          />
          {mode === 'more' ? (
            <View style={styles.more}>
              <Button
                label="Skip"
                accessibilityLabel={`Skip ${label}`}
                variant="secondary"
                accessibilityHint="Skips this dose"
                onPress={() => actions.skip(dose)}
              />
              {dose.status !== 'missed' ? (
                <Button
                  label={`Snooze ${snoozeMinutes} min`}
                  accessibilityLabel={`Snooze ${snoozeMinutes} min, ${label}`}
                  variant="secondary"
                  onPress={() => actions.snooze(dose)}
                />
              ) : null}
              <Button
                label="Different time or quantity"
                accessibilityLabel={`Different time or quantity, ${label}`}
                variant="secondary"
                onPress={() => setMode('custom')}
              />
              <Button
                label="Fewer options"
                accessibilityLabel={`Fewer options for ${label}`}
                variant="secondary"
                onPress={() => setMode('closed')}
              />
            </View>
          ) : (
            <Button
              label="More options"
              accessibilityLabel={`More options for ${label}`}
              variant="secondary"
              onPress={() => setMode('more')}
            />
          )}
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  info: { gap: spacing.xs },
  more: { gap: spacing.sm },
  bold: { fontWeight: '700' },
});
