import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, ChoiceGroup, TextField, spacing } from '@/components';
import type { DoseLog } from '@/db/models';
import { formatQuantity } from '@/lib/format';
import type { LocalDate } from '@/lib/time';
import { parseEditForm, type PastDoseEdit } from '../historyActions';
import { supplyEffectText } from '../format';

type Choice = 'taken' | 'skipped' | 'missed' | 'clear';

const CHOICES = [
  { value: 'taken', label: 'Taken' },
  { value: 'skipped', label: 'Skipped' },
  { value: 'missed', label: 'Missed' },
  { value: 'clear', label: 'Not recorded' },
] as const;

const pad = (n: number) => String(n).padStart(2, '0');

interface DoseEditorProps {
  date: LocalDate;
  now: Date;
  /** The current log (null if nothing is recorded). */
  log: DoseLog | null;
  plannedQuantity: number;
  /** Planned time (HH:mm), the default for "time taken" when backfilling. */
  plannedTime: string;
  unit: string;
  onSave: (edit: PastDoseEdit) => Promise<boolean>;
  onCancel: () => void;
}

/** Inline editor for one past dose: change its outcome, and for "Taken" the time and quantity. */
export function DoseEditor({
  date,
  now,
  log,
  plannedQuantity,
  plannedTime,
  unit,
  onSave,
  onCancel,
}: DoseEditorProps) {
  const [choice, setChoice] = useState<Choice>(
    log ? (log.status === 'snoozed' ? 'clear' : log.status) : 'taken',
  );
  const [quantity, setQuantity] = useState(formatQuantity(log?.quantity ?? plannedQuantity));
  const [time, setTime] = useState(() => {
    if (log?.actedAt && log.status === 'taken') {
      const d = new Date(log.actedAt);
      return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    return plannedTime;
  });
  const [errors, setErrors] = useState<{ quantity?: string; time?: string }>({});
  const [saving, setSaving] = useState(false);

  const nextTaken = choice === 'taken' ? Number(quantity.replace(',', '.')) || 0 : 0;
  const effect = supplyEffectText(log, nextTaken, unit);

  const save = async () => {
    let edit: PastDoseEdit;
    if (choice === 'taken') {
      const parsed = parseEditForm({ quantity, time }, date, now);
      if (!parsed.ok) {
        setErrors(parsed.errors);
        return;
      }
      edit = { kind: 'taken', quantity: parsed.quantity, takenAt: parsed.takenAt };
    } else {
      edit = { kind: choice };
    }
    setErrors({});
    setSaving(true);
    if (!(await onSave(edit))) setSaving(false);
  };

  return (
    <View style={styles.form}>
      <ChoiceGroup label="What happened" choices={CHOICES} selected={choice} onChange={setChoice} />
      {choice === 'taken' ? (
        <>
          <TextField
            label="Quantity taken"
            value={quantity}
            onChangeText={setQuantity}
            keyboardType="decimal-pad"
            error={errors.quantity}
          />
          <TextField
            label="Time taken"
            hint="For example 8:30 am or 20:30"
            value={time}
            onChangeText={setTime}
            autoCapitalize="none"
            error={errors.time}
          />
        </>
      ) : null}
      {effect ? (
        <AppText muted accessibilityLiveRegion="polite">
          {effect}
        </AppText>
      ) : null}
      <Button label="Save changes" onPress={save} disabled={saving} />
      <Button label="Cancel" variant="secondary" onPress={onCancel} />
    </View>
  );
}

const styles = StyleSheet.create({ form: { gap: spacing.md } });
