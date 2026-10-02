import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Card, Screen, spacing } from '@/components';
import type { MedicationSummary } from '@/features/medications/summary';
import { useLoad } from '@/features/medications/useLoad';
import { formatLocalDate } from '@/lib/format';
import { loadRefillsNow } from '../data';
import { daysLeftText, onHandText, runOutBasisNote, runOutLabel } from '../format';
import { CallPharmacyButton } from '../components/CallPharmacyButton';
import { SupplyBadge } from '../components/SupplyBadge';

function RefillRow({ summary }: { summary: MedicationSummary }) {
  const router = useRouter();
  const { medication, inventory } = summary;
  const note = runOutBasisNote(summary);
  return (
    <Card style={styles.card}>
      <View
        accessible
        accessibilityLabel={`${medication.name}. ${onHandText(summary)}. Runs out: ${runOutLabel(summary)}`}
        style={styles.info}
      >
        <AppText variant="heading">{medication.name}</AppText>
        <AppText muted>{onHandText(summary)}</AppText>
        <AppText>
          {inventory
            ? summary.runOutDate
              ? `Runs out ${formatLocalDate(summary.runOutDate, { weekday: true })}`
              : runOutLabel(summary)
            : 'Set up supply to track refills'}
        </AppText>
        {summary.runOutDate && summary.daysOfSupply !== null ? (
          <AppText muted>{daysLeftText(summary.daysOfSupply)}</AppText>
        ) : null}
        {note ? (
          <AppText variant="caption" muted>
            {note}
          </AppText>
        ) : null}
        {inventory && inventory.refillsRemaining !== null ? (
          <AppText muted>
            {inventory.refillsRemaining === 0
              ? 'No refills left. Contact your doctor for a new prescription.'
              : `${inventory.refillsRemaining} ${inventory.refillsRemaining === 1 ? 'refill' : 'refills'} left`}
          </AppText>
        ) : null}
        <SupplyBadge status={summary.supplyStatus} showOk />
      </View>
      {inventory ? (
        <>
          <Button
            label="Record refill"
            accessibilityLabel={`Record refill, ${medication.name}`}
            accessibilityHint="Adds a pickup to your supply"
            onPress={() => router.push(`/medications/${medication.id}/refill`)}
          />
          <CallPharmacyButton
            phone={inventory.pharmacyPhone}
            pharmacyName={inventory.pharmacyName}
            medicationName={medication.name}
          />
        </>
      ) : (
        <Button
          label="Set up supply"
          accessibilityLabel={`Set up supply, ${medication.name}`}
          onPress={() => router.push(`/medications/${medication.id}/edit`)}
        />
      )}
    </Card>
  );
}

/** All active medications, soonest run-out first. */
export function RefillsScreen() {
  const router = useRouter();
  const { data, error, loading, reload } = useLoad(loadRefillsNow);

  if (error) {
    return (
      <Screen>
        <AppText accessibilityLiveRegion="polite">{`Couldn't load refills. ${error}`}</AppText>
        <Button label="Try again" onPress={reload} />
      </Screen>
    );
  }
  if (loading && !data) {
    return (
      <Screen>
        <AppText accessibilityLiveRegion="polite">Loading refills…</AppText>
      </Screen>
    );
  }
  if (!data || data.items.length === 0) {
    return (
      <Screen>
        <AppText variant="heading">No medications yet</AppText>
        <AppText muted>Add a medication to track its supply and refills.</AppText>
        <Button label="Add medication" onPress={() => router.push('/medications/new')} />
      </Screen>
    );
  }
  return (
    <Screen>
      <AppText muted>Sorted by when each supply is estimated to run out.</AppText>
      {data.items.map((summary) => (
        <RefillRow key={summary.medication.id} summary={summary} />
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  info: { gap: spacing.xs },
});
