import { useRouter } from 'expo-router';
import { FlatList, StyleSheet, View } from 'react-native';

import { AppText, Button, spacing, usePalette } from '@/components';
import { ReminderStatusBanner } from '@/features/reminders/components/ReminderStatusBanner';
import { loadMedicationSummaries } from '../data';
import { MedicationCard } from '../components/MedicationCard';
import { useLoad } from '../useLoad';

export function MedicationListScreen() {
  const router = useRouter();
  const palette = usePalette();
  const { data, error, loading, reload } = useLoad(loadMedicationSummaries);

  const addButton = (
    <Button
      label="Add medication"
      accessibilityHint="Opens a form to add a new medication"
      onPress={() => router.push('/medications/new')}
    />
  );

  let body;
  if (error) {
    body = (
      <View style={styles.message}>
        <AppText accessibilityLiveRegion="polite">{`Couldn't load your medications. ${error}`}</AppText>
        <Button label="Try again" onPress={reload} />
      </View>
    );
  } else if (loading && !data) {
    body = (
      <View style={styles.message}>
        <AppText accessibilityLiveRegion="polite">Loading your medications…</AppText>
      </View>
    );
  } else if (!data || data.length === 0) {
    body = (
      <View style={styles.message}>
        <AppText variant="heading">No medications yet</AppText>
        <AppText muted>
          Add the medicines you take to get a schedule, and to keep track of your supply.
        </AppText>
      </View>
    );
  } else {
    body = (
      <FlatList
        data={data}
        keyExtractor={(item) => String(item.medication.id)}
        contentContainerStyle={styles.list}
        ListHeaderComponent={<ReminderStatusBanner />}
        renderItem={({ item }) => (
          <MedicationCard
            summary={item}
            onPress={() => router.push(`/medications/${item.medication.id}`)}
          />
        )}
      />
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      {body}
      <View style={styles.footer}>{addButton}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  list: { padding: spacing.md, gap: spacing.md },
  message: { flex: 1, padding: spacing.lg, gap: spacing.md, justifyContent: 'center' },
  footer: { padding: spacing.md },
});
