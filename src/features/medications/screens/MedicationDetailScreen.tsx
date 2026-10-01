import { Stack, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { AppText, Badge, Button, Card, Screen, spacing, usePalette } from '@/components';
import { useDatabase } from '@/db/DatabaseProvider';
import type { DoseLog } from '@/db/models';
import { describeSchedule, formatDateTime, formatQuantity } from '@/lib/format';
import { CallPharmacyButton } from '@/features/refills/components/CallPharmacyButton';
import { SupplyBadge } from '@/features/refills/components/SupplyBadge';
import { onHandText, runOutBasisNote, runOutLabel } from '@/features/refills/format';
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
  return onHandText(detail);
}

export function runOutText(detail: MedicationDetail): string {
  return runOutLabel(detail);
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
          <SupplyBadge status={data.supplyStatus} />
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
          {runOutBasisNote(data) ? (
            <AppText variant="caption" muted>
              {runOutBasisNote(data)}
            </AppText>
          ) : null}
        </View>
        {data.inventory && data.inventory.refillsRemaining !== null ? (
          <View>
            <AppText muted>Refills left on the prescription</AppText>
            <AppText variant="heading">
              {data.inventory.refillsRemaining === 0
                ? 'None. Contact your doctor for a new prescription'
                : String(data.inventory.refillsRemaining)}
            </AppText>
          </View>
        ) : null}
        {data.inventory?.pharmacyName || data.inventory?.pharmacyPhone ? (
          <View>
            <AppText muted>Pharmacy</AppText>
            <AppText variant="heading">
              {[data.inventory.pharmacyName, data.inventory.pharmacyPhone]
                .filter(Boolean)
                .join(' · ')}
            </AppText>
          </View>
        ) : null}
        {data.inventory ? (
          <>
            <Button
              label="Record refill"
              accessibilityHint="Adds a pickup to your supply"
              onPress={() => router.push(`/medications/${medicationId}/refill`)}
            />
            <CallPharmacyButton
              phone={data.inventory.pharmacyPhone}
              pharmacyName={data.inventory.pharmacyName}
            />
            {!data.inventory.pharmacyPhone ? (
              <AppText variant="caption" muted>
                Add the pharmacy phone number in Edit to call from here.
              </AppText>
            ) : null}
          </>
        ) : null}
      </Card>

      {data.refills.length > 0 ? (
        <Card title="Refill history">
          {data.refills.map((refill) => (
            <View
              key={refill.id}
              accessible
              accessibilityLabel={`${formatQuantity(refill.quantityAdded)} ${data.inventory?.unit ?? ''} added ${formatDateTime(refill.date, now)}${refill.note ? `. ${refill.note}` : ''}`}
              style={styles.historyRow}
            >
              <AppText style={styles.bold}>
                {`+${formatQuantity(refill.quantityAdded)} ${data.inventory?.unit ?? ''}`}
              </AppText>
              <AppText muted>{formatDateTime(refill.date, now)}</AppText>
              {refill.note ? <AppText muted>{refill.note}</AppText> : null}
            </View>
          ))}
        </Card>
      ) : null}

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
