import { Stack, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { AppText, Badge, Button, Card, Screen, spacing, usePalette } from '@/components';
import { useDatabase } from '@/db/DatabaseProvider';
import type { DoseLog } from '@/db/models';
import { describeSchedule, formatDateTime, formatLocalDate, formatQuantity } from '@/lib/format';
import { LowSupplyBadge } from '../components/LowSupplyBadge';
import { dosageLabel, nextDoseLabel } from '../components/MedicationCard';
import { loadMedicationDetail, removeMedication, setActive, type MedicationDetail } from '../data';
import { useLoad } from '../useLoad';

const STATUS_LABELS: Record<DoseLog['status'], string> = {
  taken: '✓ Taken',
  skipped: '– Skipped',
  missed: '✗ Missed',
  snoozed: '⏰ Snoozed',
};

export function supplyText(detail: MedicationDetail): string {
  if (!detail.inventory) return 'No supply recorded';
  const { currentQuantity, unit } = detail.inventory;
  return `${formatQuantity(currentQuantity)} ${unit}`;
}

export function runOutText(detail: MedicationDetail): string {
  if (!detail.inventory) return 'Not available';
  if (detail.inventory.currentQuantity === 0) return 'Out of supply';
  if (detail.runOutDate === null || detail.daysOfSupply === null) {
    return detail.asNeeded
      ? "Can't estimate — this is taken only when needed"
      : "Can't estimate — no active schedule";
  }
  const days = Math.floor(detail.daysOfSupply);
  const left =
    days === 0 ? 'less than a day left' : `about ${days} ${days === 1 ? 'day' : 'days'} left`;
  return `${formatLocalDate(detail.runOutDate, { weekday: true })} (${left})`;
}

export function MedicationDetailScreen({ medicationId }: { medicationId: number }) {
  const router = useRouter();
  const palette = usePalette();
  const getDatabase = useDatabase();
  const loader = useCallback(
    (db: Parameters<typeof loadMedicationDetail>[0]) => loadMedicationDetail(db, medicationId),
    [medicationId],
  );
  const { data, error, loading, reload } = useLoad(loader);
  const [actionError, setActionError] = useState<string | null>(null);

  const run = async (action: (db: Awaited<ReturnType<typeof getDatabase>>) => Promise<unknown>) => {
    setActionError(null);
    try {
      await action(await getDatabase());
      return true;
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Something went wrong.');
      return false;
    }
  };

  const togglePause = async (detail: MedicationDetail) => {
    if (await run((db) => setActive(db, medicationId, !detail.medication.active))) reload();
  };

  const confirmDelete = (detail: MedicationDetail) => {
    Alert.alert(
      `Delete ${detail.medication.name}?`,
      'This permanently removes the medication, its schedule, supply, and dose history. This can’t be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (await run((db) => removeMedication(db, medicationId))) router.replace('/');
          },
        },
      ],
    );
  };

  if (error || loading || !data) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Medication' }} />
        <AppText accessibilityLiveRegion="polite">
          {error
            ? `Couldn't load this medication. ${error}`
            : loading
              ? 'Loading…'
              : 'This medication no longer exists.'}
        </AppText>
        {!loading ? <Button label="Go back" onPress={() => router.back()} /> : null}
      </Screen>
    );
  }

  const { medication, schedules, history } = data;
  const now = new Date();

  return (
    <Screen>
      <Stack.Screen options={{ title: medication.name }} />

      <View style={styles.header}>
        <AppText variant="title">{medication.name}</AppText>
        <AppText muted>{dosageLabel(data)}</AppText>
        <View style={styles.badges}>
          {!medication.active ? <Badge label="Paused" /> : null}
          {data.lowSupply ? <LowSupplyBadge /> : null}
        </View>
        {medication.instructions ? <AppText>{medication.instructions}</AppText> : null}
      </View>

      {!medication.active ? (
        <AppText accessibilityLiveRegion="polite">
          This medication is paused. You won’t get reminders until you resume it.
        </AppText>
      ) : null}
      {actionError ? (
        <AppText color={palette.danger} accessibilityLiveRegion="assertive">
          {actionError}
        </AppText>
      ) : null}

      <Card title="Schedule">
        {schedules.length === 0 ? (
          <AppText muted>No schedule set.</AppText>
        ) : (
          schedules.map((s) => <AppText key={s.id}>{describeSchedule(s)}</AppText>)
        )}
        <AppText muted>{nextDoseLabel(data, now)}</AppText>
      </Card>

      <Card title="Supply">
        <View>
          <AppText muted>You have</AppText>
          <AppText variant="heading">{supplyText(data)}</AppText>
        </View>
        <View>
          <AppText muted>Estimated to run out</AppText>
          <AppText variant="heading">{runOutText(data)}</AppText>
        </View>
      </Card>

      <Card title="Recent doses">
        {history.length === 0 ? (
          <AppText muted>No doses recorded yet.</AppText>
        ) : (
          history.map((log) => (
            <View
              key={log.id}
              accessible
              accessibilityLabel={`${STATUS_LABELS[log.status].replace(/^\S+ /, '')}, ${formatDateTime(log.scheduledFor, now)}`}
              style={styles.historyRow}
            >
              <AppText style={styles.bold}>{STATUS_LABELS[log.status]}</AppText>
              <AppText muted>{formatDateTime(log.scheduledFor, now)}</AppText>
            </View>
          ))
        )}
      </Card>

      <View style={styles.actions}>
        <Button
          label="Edit"
          onPress={() => router.push(`/medications/${medicationId}/edit`)}
          accessibilityHint="Change details, schedule, or supply"
        />
        <Button
          label={medication.active ? 'Pause medication' : 'Resume medication'}
          variant="secondary"
          accessibilityHint={
            medication.active
              ? 'Stops reminders without deleting anything'
              : 'Starts reminders again'
          }
          onPress={() => togglePause(data)}
        />
        <Button
          label="Delete medication"
          variant="danger"
          accessibilityHint="Asks you to confirm before deleting"
          onPress={() => confirmDelete(data)}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.xs },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  historyRow: { gap: 2 },
  bold: { fontWeight: '700' },
  actions: { gap: spacing.md },
});
