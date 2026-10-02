import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Badge, Button, Card, spacing } from '@/components';
import type { Medication } from '@/db/models';
import { formatClock, formatLocalDate, formatQuantity } from '@/lib/format';
import type { LocalDate } from '@/lib/time';
import type { AsNeededDose, DayStats, HistoryDose } from '../adherence';
import { DAY_LABELS, doseStatusText } from '../format';
import type { HistoryActions } from '../useHistoryActions';
import { CustomLogForm } from '@/features/today/components/CustomLogForm';
import { DoseEditor } from './DoseEditor';

interface DayLogProps {
  day: DayStats;
  today: LocalDate;
  now: Date;
  units: ReadonlyMap<number, string>;
  asNeededMedications: readonly Medication[];
  actions: HistoryActions;
}

function ScheduledRow({
  dose,
  day,
  now,
  unit,
  actions,
}: {
  dose: HistoryDose;
  day: DayStats;
  now: Date;
  unit: string;
  actions: HistoryActions;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <Card style={styles.card}>
      <View
        accessible
        accessibilityLabel={`${dose.time}, ${dose.name}, ${dose.strength}, ${dose.amount}. ${doseStatusText(dose)}`}
        style={styles.info}
      >
        <AppText variant="heading">{dose.name}</AppText>
        <AppText muted>{`${dose.strength} · ${dose.amount} · scheduled ${dose.time}`}</AppText>
        <AppText>{doseStatusText(dose)}</AppText>
        {dose.status === 'missed' ? <Badge label="Missed" /> : null}
      </View>
      {editing ? (
        <DoseEditor
          date={day.date}
          now={now}
          log={dose.log}
          plannedQuantity={dose.quantity}
          plannedTime={dose.time}
          unit={unit}
          onCancel={() => setEditing(false)}
          onSave={async (edit) => {
            const ok = await actions.editDose(
              dose.name,
              { medicationId: dose.medicationId, scheduledFor: dose.scheduledFor },
              edit,
            );
            if (ok) setEditing(false);
            return ok;
          }}
        />
      ) : (
        <Button
          label="Edit"
          accessibilityLabel={`Edit ${dose.name} ${dose.time}`}
          variant="secondary"
          accessibilityHint="Change what happened with this dose"
          onPress={() => setEditing(true)}
        />
      )}
    </Card>
  );
}

function AsNeededRow({
  entry,
  day,
  now,
  actions,
}: {
  entry: AsNeededDose;
  day: DayStats;
  now: Date;
  actions: HistoryActions;
}) {
  const [editing, setEditing] = useState(false);
  const { log } = entry;
  const at = new Date(log.scheduledFor);
  const timeText = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  return (
    <Card style={styles.card}>
      <View style={styles.info}>
        <AppText variant="heading">{entry.name}</AppText>
        <AppText muted>{`${entry.strength} · as needed`}</AppText>
        <AppText>{`Taken at ${formatClock(log.scheduledFor)}, ${formatQuantity(log.quantity ?? 0)} taken`}</AppText>
      </View>
      {editing ? (
        <CustomLogForm
          defaultQuantity={log.quantity ?? 1}
          now={now}
          date={day.date}
          defaultTime={timeText}
          submitLabel="Save changes"
          onCancel={() => setEditing(false)}
          onSubmit={async ({ quantity, takenAt }) => {
            const ok = await actions.editAsNeeded(entry.name, log, { quantity, takenAt });
            if (ok) setEditing(false);
            return ok;
          }}
        />
      ) : (
        <View style={styles.buttons}>
          <Button
            label="Edit"
            accessibilityLabel={`Edit ${entry.name} dose at ${timeText}`}
            variant="secondary"
            onPress={() => setEditing(true)}
          />
          <Button
            label="Delete"
            accessibilityLabel={`Delete ${entry.name} dose at ${timeText}`}
            variant="danger"
            accessibilityHint="Removes this dose and gives the supply back"
            onPress={() => actions.removeAsNeeded(entry.name, log)}
          />
        </View>
      )}
    </Card>
  );
}

function AddAsNeeded({
  medication,
  day,
  now,
  actions,
}: {
  medication: Medication;
  day: DayStats;
  now: Date;
  actions: HistoryActions;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button
        label={`Add ${medication.name} dose`}
        variant="secondary"
        accessibilityHint="Records an as-needed dose you took on this day"
        onPress={() => setOpen(true)}
      />
    );
  }
  return (
    <Card style={styles.card}>
      <AppText variant="heading">{`Add ${medication.name} dose`}</AppText>
      <CustomLogForm
        defaultQuantity={1}
        now={now}
        defaultTime="12:00"
        submitLabel="Add dose"
        onCancel={() => setOpen(false)}
        onSubmit={async ({ quantity, takenAt }) => {
          const ok = await actions.addAsNeeded(medication.name, {
            medicationId: medication.id,
            quantity,
            takenAt,
          });
          if (ok) setOpen(false);
          return ok;
        }}
        date={day.date}
      />
    </Card>
  );
}

/** The selected day's doses with controls to correct what was recorded. */
export function DayLog({ day, today, now, units, asNeededMedications, actions }: DayLogProps) {
  const future = day.date > today;
  const counted = day.doses.filter((d) => d.status !== 'pending').length;
  return (
    <View style={styles.section}>
      <AppText variant="heading">{formatLocalDate(day.date, { weekday: true })}</AppText>
      <AppText muted accessibilityLiveRegion="polite">
        {future
          ? "This day hasn't happened yet."
          : counted > 0
            ? `${day.taken} of ${counted} ${counted === 1 ? 'dose' : 'doses'} taken (${DAY_LABELS[day.status]})`
            : DAY_LABELS[day.status][0].toUpperCase() + DAY_LABELS[day.status].slice(1)}
      </AppText>

      {day.doses.map((dose) => (
        <ScheduledRow
          key={dose.key}
          dose={dose}
          day={day}
          now={now}
          unit={units.get(dose.medicationId) ?? 'units'}
          actions={actions}
        />
      ))}
      {day.asNeeded.map((entry) => (
        <AsNeededRow key={entry.log.id} entry={entry} day={day} now={now} actions={actions} />
      ))}
      {!future
        ? asNeededMedications.map((m) => (
            <AddAsNeeded key={m.id} medication={m} day={day} now={now} actions={actions} />
          ))
        : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.md },
  card: { gap: spacing.md },
  info: { gap: spacing.xs },
  buttons: { gap: spacing.sm },
});
