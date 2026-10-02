import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, TextField, spacing } from '@/components';
import { resolveTakenAt } from '@/features/doses/doseActions';
import { formatQuantity } from '@/lib/format';
import { localDateOf, parseTimeInput, type LocalDate } from '@/lib/time';

interface CustomLogFormProps {
  defaultQuantity: number;
  /** The current time; the time taken can't be later than this. */
  now: Date;
  /** Local day the dose belongs to. Defaults to today. */
  date?: LocalDate;
  /** Initial value of the time field (HH:mm). Defaults to the current time. */
  defaultTime?: string;
  submitLabel?: string;
  onSubmit: (value: { quantity: number; takenAt: Date }) => Promise<boolean> | boolean;
  onCancel: () => void;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Lets the person log a dose at a different time and/or with a different quantity. */
export function CustomLogForm({
  defaultQuantity,
  now,
  date,
  defaultTime,
  submitLabel = 'Save',
  onSubmit,
  onCancel,
}: CustomLogFormProps) {
  const [quantityText, setQuantityText] = useState(formatQuantity(defaultQuantity));
  const [timeText, setTimeText] = useState(
    defaultTime ?? `${pad(now.getHours())}:${pad(now.getMinutes())}`,
  );
  const [errors, setErrors] = useState<{ quantity?: string; time?: string }>({});
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const next: typeof errors = {};
    const quantity = Number(quantityText.replace(',', '.'));
    if (!quantityText.trim() || !Number.isFinite(quantity) || quantity <= 0) {
      next.quantity = 'Enter a quantity greater than 0';
    }
    const taken = resolveTakenAt(date ?? localDateOf(now), parseTimeInput(timeText), now);
    if (!taken.ok) next.time = taken.error;
    setErrors(next);
    if (next.quantity || next.time || !taken.ok) return;
    setSaving(true);
    const ok = await onSubmit({ quantity, takenAt: taken.value });
    if (!ok) setSaving(false);
  };

  return (
    <View style={styles.form}>
      <TextField
        label="Quantity taken"
        value={quantityText}
        onChangeText={setQuantityText}
        keyboardType="decimal-pad"
        error={errors.quantity}
      />
      <TextField
        label="Time taken"
        hint="For example 8:30 am or 20:30"
        value={timeText}
        onChangeText={setTimeText}
        autoCapitalize="none"
        error={errors.time}
      />
      <Button label={submitLabel} onPress={submit} disabled={saving} />
      <Button label="Cancel" variant="secondary" onPress={onCancel} />
    </View>
  );
}

const styles = StyleSheet.create({ form: { gap: spacing.md } });
