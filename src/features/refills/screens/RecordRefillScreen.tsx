import { Stack, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Card, Screen, TextField, spacing, usePalette } from '@/components';
import { useDatabase } from '@/db/DatabaseProvider';
import { loadMedicationDetail } from '@/features/medications/data';
import { useLoad } from '@/features/medications/useLoad';
import { formatQuantity } from '@/lib/format';
import {
  emptyRefillForm,
  saveRefill,
  validateRefillForm,
  type RefillFormErrors,
  type RefillFormValues,
} from '../data';
import { onHandText } from '../format';

export function RecordRefillScreen({ medicationId }: { medicationId: number }) {
  const router = useRouter();
  const palette = usePalette();
  const getDatabase = useDatabase();
  const loader = useCallback(
    (db: Parameters<typeof loadMedicationDetail>[0]) => loadMedicationDetail(db, medicationId),
    [medicationId],
  );
  const { data, error, loading } = useLoad(loader);
  const [values, setValues] = useState<RefillFormValues>(() => emptyRefillForm());
  const [errors, setErrors] = useState<RefillFormErrors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const set = <K extends keyof RefillFormValues>(key: K, value: RefillFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  const save = async () => {
    const result = validateRefillForm(values);
    if (!result.ok) {
      setErrors(result.errors);
      setSaveError(null);
      return;
    }
    setErrors({});
    setSaving(true);
    setSaveError(null);
    try {
      await saveRefill(await getDatabase(), { medicationId, ...result.value });
      router.back();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Something went wrong.');
      setSaving(false);
    }
  };

  if (error || loading || !data) {
    return (
      <Screen>
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

  const { medication, inventory } = data;
  const unit = inventory?.unit ?? 'units';

  return (
    <Screen
      footer={
        <View style={styles.footer}>
          <Button label="Save refill" onPress={save} disabled={saving || !inventory} />
          <Button label="Cancel" variant="secondary" onPress={() => router.back()} />
        </View>
      }
    >
      <Stack.Screen options={{ title: 'Record refill' }} />
      <AppText variant="title">{medication.name}</AppText>

      {!inventory ? (
        <View style={styles.group}>
          <AppText accessibilityLiveRegion="polite">
            Supply is not set up for this medication yet. Add it first, then record the refill.
          </AppText>
          <Button
            label="Set up supply"
            onPress={() => router.replace(`/medications/${medicationId}/edit`)}
          />
        </View>
      ) : (
        <>
          <Card>
            <AppText muted>You have now</AppText>
            <AppText variant="heading">{onHandText(data)}</AppText>
            {inventory.refillsRemaining !== null ? (
              <AppText muted>
                {`${inventory.refillsRemaining} ${inventory.refillsRemaining === 1 ? 'refill' : 'refills'} left on the prescription. Saving this uses one.`}
              </AppText>
            ) : null}
          </Card>
          <TextField
            label="Quantity added"
            required
            hint={`How many ${unit} you picked up`}
            value={values.quantity}
            onChangeText={(v) => set('quantity', v)}
            error={errors.quantity}
            keyboardType="decimal-pad"
          />
          <TextField
            label="Date picked up"
            required
            hint="Like 2026-10-01"
            value={values.date}
            onChangeText={(v) => set('date', v)}
            error={errors.date}
            autoCapitalize="none"
          />
          <TextField
            label="Note (optional)"
            value={values.note}
            onChangeText={(v) => set('note', v)}
            multiline
          />
          {values.quantity.trim() !== '' && !errors.quantity && Number(values.quantity) > 0 ? (
            <AppText muted accessibilityLiveRegion="polite">
              {`New total: ${formatQuantity(inventory.currentQuantity + Number(values.quantity.replace(',', '.')))} ${unit}`}
            </AppText>
          ) : null}
        </>
      )}
      {saveError ? (
        <AppText color={palette.danger} accessibilityLiveRegion="assertive">
          {saveError}
        </AppText>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  footer: { padding: spacing.md, gap: spacing.sm },
  group: { gap: spacing.md },
});
