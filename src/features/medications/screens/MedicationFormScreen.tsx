import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ScrollView, StyleSheet, View } from 'react-native';

import {
  AppText,
  Button,
  Card,
  ChoiceGroup,
  Screen,
  TextField,
  spacing,
  usePalette,
  type Choice,
} from '@/components';
import { useDatabase } from '@/db/DatabaseProvider';
import {
  MEDICATION_FORMS,
  REFILL_THRESHOLD_UNITS,
  type MedicationForm,
  type ScheduleType,
} from '@/db/models';
import { DAY_ABBREVIATIONS, DAY_NAMES } from '@/lib/format';
import { getPermissionState } from '@/features/reminders/permissions';
import { loadMedicationForEdit, saveMedication } from '../data';
import {
  FORM_UNIT_DEFAULTS,
  emptyFormValues,
  formValuesFromStored,
  validateForm,
  type FormErrors,
  type FormValues,
} from '../form';

const FORM_CHOICES: Choice<MedicationForm>[] = MEDICATION_FORMS.map((value) => ({
  value,
  label: value.charAt(0).toUpperCase() + value.slice(1),
}));

const SCHEDULE_CHOICES: Choice<ScheduleType>[] = [
  { value: 'daily', label: 'Every day' },
  { value: 'weekdays', label: 'Certain days' },
  { value: 'interval', label: 'Every few days' },
  { value: 'as_needed', label: 'Only when needed' },
];

const DAY_CHOICES: Choice<number>[] = DAY_NAMES.map((name, value) => ({
  value,
  label: DAY_ABBREVIATIONS[value],
  accessibilityLabel: name,
}));

const THRESHOLD_UNIT_CHOICES: Choice<(typeof REFILL_THRESHOLD_UNITS)[number]>[] = [
  { value: 'days', label: 'Days left' },
  { value: 'count', label: 'Amount left' },
];

interface MedicationFormScreenProps {
  /** Omit to add a new medication. */
  medicationId?: number;
}

export function MedicationFormScreen({ medicationId }: MedicationFormScreenProps) {
  const router = useRouter();
  const palette = usePalette();
  const getDatabase = useDatabase();
  const scrollRef = useRef<ScrollView>(null);
  const editing = medicationId !== undefined;

  const [values, setValues] = useState<FormValues>(() => emptyFormValues());
  const [errors, setErrors] = useState<FormErrors>({});
  const [loading, setLoading] = useState(editing);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (medicationId === undefined) return;
    let cancelled = false;
    getDatabase()
      .then((db) => loadMedicationForEdit(db, medicationId))
      .then((stored) => {
        if (cancelled) return;
        if (!stored) setLoadError('This medication no longer exists.');
        else setValues(formValuesFromStored(stored.medication, stored.schedule, stored.inventory));
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Something went wrong.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [getDatabase, medicationId]);

  const set = useCallback(
    <K extends keyof FormValues>(key: K, value: FormValues[K]) =>
      setValues((current) => ({ ...current, [key]: value })),
    [],
  );

  const setForm = (form: MedicationForm) =>
    setValues((current) => ({
      ...current,
      form,
      // Follow the form's default unit (tablets → mL) unless the person typed their own.
      inventoryUnit:
        current.inventoryUnit === FORM_UNIT_DEFAULTS[current.form]
          ? FORM_UNIT_DEFAULTS[form]
          : current.inventoryUnit,
    }));

  const setTime = (index: number, text: string) =>
    setValues((current) => ({
      ...current,
      times: current.times.map((t, i) => (i === index ? text : t)),
    }));

  const errorCount = Object.keys(errors).length;

  const onSave = async () => {
    const result = validateForm(values);
    if (!result.ok) {
      setErrors(result.errors);
      setSaveError(null);
      scrollRef.current?.scrollTo({ y: 0, animated: true });
      const count = Object.keys(result.errors).length;
      AccessibilityInfo.announceForAccessibility(
        `${count} ${count === 1 ? 'problem' : 'problems'} to fix. ${Object.values(result.errors)[0]}`,
      );
      return;
    }
    setErrors({});
    setSaving(true);
    setSaveError(null);
    try {
      const db = await getDatabase();
      await saveMedication(db, medicationId ?? null, result.value);
      // First reminder-worthy medication: explain notifications before asking for permission.
      if (
        result.value.schedule.type !== 'as_needed' &&
        (await getPermissionState()) === 'undetermined'
      ) {
        router.replace('/reminders/permission');
        return;
      }
      router.back();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Something went wrong.');
      setSaving(false);
    }
  };

  const title = editing ? 'Edit medication' : 'Add medication';

  if (loading || loadError) {
    return (
      <Screen>
        <Stack.Screen options={{ title }} />
        <AppText accessibilityLiveRegion="polite">{loadError ?? 'Loading…'}</AppText>
        {loadError ? <Button label="Go back" onPress={() => router.back()} /> : null}
      </Screen>
    );
  }

  const unit = values.inventoryUnit.trim() || 'units';
  const scheduled = values.scheduleType !== 'as_needed';

  return (
    <Screen
      scrollRef={scrollRef}
      footer={
        <View style={[styles.footer, { backgroundColor: palette.background }]}>
          <Button
            label={saving ? 'Saving…' : 'Save medication'}
            disabled={saving}
            onPress={onSave}
          />
          <Button label="Cancel" variant="secondary" onPress={() => router.back()} />
        </View>
      }
    >
      <Stack.Screen options={{ title }} />

      {errorCount > 0 ? (
        <View
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          style={[styles.banner, { borderColor: palette.danger, backgroundColor: palette.surface }]}
          testID="error-summary"
        >
          <AppText color={palette.danger} style={styles.bold}>
            {`Please fix ${errorCount} ${errorCount === 1 ? 'problem' : 'problems'} below.`}
          </AppText>
        </View>
      ) : null}
      {saveError ? (
        <AppText color={palette.danger} accessibilityLiveRegion="assertive">
          {`Couldn't save: ${saveError}`}
        </AppText>
      ) : null}

      <Card title="Medication">
        <TextField
          label="Name"
          required
          value={values.name}
          onChangeText={(v) => set('name', v)}
          error={errors.name}
          autoCapitalize="words"
          placeholder="e.g. Metformin"
        />
        <TextField
          label="Strength"
          required
          hint="The number printed on the label, like 500"
          value={values.dosageAmount}
          onChangeText={(v) => set('dosageAmount', v)}
          error={errors.dosageAmount}
          keyboardType="decimal-pad"
        />
        <TextField
          label="Strength unit"
          required
          hint="Like mg, mcg, or mL"
          value={values.dosageUnit}
          onChangeText={(v) => set('dosageUnit', v)}
          error={errors.dosageUnit}
          autoCapitalize="none"
        />
        <ChoiceGroup
          label="Form"
          choices={FORM_CHOICES}
          selected={values.form}
          onChange={setForm}
        />
        <TextField
          label="Instructions (optional)"
          hint="Like “take with food”"
          value={values.instructions}
          onChangeText={(v) => set('instructions', v)}
          multiline
        />
      </Card>

      <Card title="Schedule">
        <ChoiceGroup
          label="How often?"
          choices={SCHEDULE_CHOICES}
          selected={values.scheduleType}
          onChange={(v) => set('scheduleType', v)}
        />

        {values.scheduleType === 'weekdays' ? (
          <ChoiceGroup<number>
            multiple
            label="Which days?"
            choices={DAY_CHOICES}
            selected={values.daysOfWeek}
            onChange={(v) =>
              set(
                'daysOfWeek',
                [...v].sort((a, b) => a - b),
              )
            }
            error={errors.daysOfWeek}
          />
        ) : null}

        {values.scheduleType === 'interval' ? (
          <>
            <TextField
              label="Every how many days?"
              required
              value={values.intervalDays}
              onChangeText={(v) => set('intervalDays', v)}
              error={errors.intervalDays}
              keyboardType="number-pad"
            />
            <TextField
              label="First dose date"
              hint="Year-month-day, like 2026-10-01"
              value={values.startDate}
              onChangeText={(v) => set('startDate', v)}
              error={errors.startDate}
              autoCapitalize="none"
            />
          </>
        ) : null}

        {scheduled ? (
          <View style={styles.group}>
            <AppText variant="label">Times of day *</AppText>
            {errors.times ? (
              <AppText variant="caption" color={palette.danger} accessibilityLiveRegion="polite">
                {errors.times}
              </AppText>
            ) : null}
            {values.times.map((time, index) => (
              <View key={index} style={styles.group}>
                <TextField
                  label={`Time ${index + 1}`}
                  hint="Like 8:00 AM or 20:30"
                  value={time}
                  onChangeText={(v) => setTime(index, v)}
                  error={errors[`time-${index}`]}
                  autoCapitalize="none"
                />
                {values.times.length > 1 ? (
                  <Button
                    label={`Remove time ${index + 1}`}
                    variant="secondary"
                    onPress={() =>
                      set(
                        'times',
                        values.times.filter((_, i) => i !== index),
                      )
                    }
                  />
                ) : null}
              </View>
            ))}
            <Button
              label="Add another time"
              variant="secondary"
              onPress={() => set('times', [...values.times, ''])}
            />
          </View>
        ) : null}

        <TextField
          label="Amount to take each time"
          required
          hint={`Number of ${unit} per dose`}
          value={values.doseQuantity}
          onChangeText={(v) => set('doseQuantity', v)}
          error={errors.doseQuantity}
          keyboardType="decimal-pad"
        />
      </Card>

      <Card title={editing ? 'Supply' : 'Starting supply'}>
        <TextField
          label={editing ? 'How much you have now' : 'How much you have'}
          required
          hint="Use 0 if you have none yet"
          value={values.currentQuantity}
          onChangeText={(v) => set('currentQuantity', v)}
          error={errors.currentQuantity}
          keyboardType="decimal-pad"
        />
        <TextField
          label="What you count"
          required
          hint="Like tablets, capsules, or mL"
          value={values.inventoryUnit}
          onChangeText={(v) => set('inventoryUnit', v)}
          error={errors.inventoryUnit}
          autoCapitalize="none"
        />
        <TextField
          label="Warn me when supply is low (optional)"
          hint="Leave empty for no warning"
          value={values.refillThreshold}
          onChangeText={(v) => set('refillThreshold', v)}
          error={errors.refillThreshold}
          keyboardType="decimal-pad"
        />
        <ChoiceGroup
          label="Warn me by"
          choices={THRESHOLD_UNIT_CHOICES}
          selected={values.refillThresholdUnit}
          onChange={(v) => set('refillThresholdUnit', v)}
        />
      </Card>

      <Card title="Refills and pharmacy (optional)">
        <TextField
          label="Refills left on the prescription"
          hint="Leave empty if you don't track this. You'll be reminded to contact your doctor at 0"
          value={values.refillsRemaining}
          onChangeText={(v) => set('refillsRemaining', v)}
          error={errors.refillsRemaining}
          keyboardType="number-pad"
        />
        <TextField
          label="Pharmacy name"
          value={values.pharmacyName}
          onChangeText={(v) => set('pharmacyName', v)}
        />
        <TextField
          label="Pharmacy phone"
          hint="Used for the Call pharmacy button"
          value={values.pharmacyPhone}
          onChangeText={(v) => set('pharmacyPhone', v)}
          error={errors.pharmacyPhone}
          keyboardType="phone-pad"
        />
        <TextField
          label="Prescription number"
          value={values.prescriptionNumber}
          onChangeText={(v) => set('prescriptionNumber', v)}
          autoCapitalize="none"
        />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  footer: { padding: spacing.md, gap: spacing.sm },
  banner: { borderWidth: 3, borderRadius: 12, padding: spacing.md },
  bold: { fontWeight: '700' },
  group: { gap: spacing.sm },
});
