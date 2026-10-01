import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Badge, minTouchTarget, radius, spacing, usePalette } from '@/components';
import { formatDateTime, formatQuantity } from '@/lib/format';
import type { MedicationSummary } from '../summary';
import { SupplyBadge } from '@/features/refills/components/SupplyBadge';
import { supplyIndicator } from '@/features/refills/format';

export function nextDoseLabel(summary: MedicationSummary, now: Date = new Date()): string {
  if (!summary.medication.active) return 'Paused';
  if (summary.asNeeded) return 'Take only when needed';
  if (summary.nextDose) return `Next dose: ${formatDateTime(summary.nextDose, now)}`;
  return 'No upcoming doses';
}

export function dosageLabel(summary: MedicationSummary): string {
  const { dosageAmount, dosageUnit } = summary.medication;
  const strength = `${formatQuantity(dosageAmount)} ${dosageUnit}`;
  const schedule = summary.schedules[0];
  if (!schedule || !summary.inventory) return strength;
  return `${strength} · take ${formatQuantity(schedule.doseQuantity)} ${summary.inventory.unit}`;
}

interface MedicationCardProps {
  summary: MedicationSummary;
  onPress: () => void;
  now?: Date;
}

export function MedicationCard({ summary, onPress, now }: MedicationCardProps) {
  const palette = usePalette();
  const { medication, lowSupply } = summary;
  const supply = summary.inventory ? supplyIndicator(summary) : null;
  const dose = dosageLabel(summary);
  const next = nextDoseLabel(summary, now);
  const spoken = [medication.name, dose, next, supply, lowSupply ? 'Low supply' : null]
    .filter(Boolean)
    .join('. ');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityHint="Opens medication details"
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: palette.surface, opacity: pressed ? 0.8 : 1 },
      ]}
    >
      <AppText variant="heading" accessibilityRole="text">
        {medication.name}
      </AppText>
      <AppText muted>{dose}</AppText>
      <AppText>{next}</AppText>
      {supply ? <AppText muted>{`Supply: ${supply}`}</AppText> : null}
      <View style={styles.badges}>
        {!medication.active ? <Badge label="Paused" /> : null}
        <SupplyBadge status={summary.supplyStatus} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: minTouchTarget,
    borderRadius: radius,
    padding: spacing.md,
    gap: spacing.xs,
  },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
