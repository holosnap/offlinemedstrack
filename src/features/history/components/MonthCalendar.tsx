import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, radius, spacing, usePalette, type Palette } from '@/components';
import { formatLocalDate } from '@/lib/format';
import type { LocalDate } from '@/lib/time';
import type { DayStats, DayStatus } from '../adherence';
import { monthGrid, monthTitle, type MonthRef } from '../calendar';
import { DAY_LABELS, DAY_SYMBOLS } from '../format';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function colorsFor(status: DayStatus, palette: Palette): { bg: string; fg: string } {
  switch (status) {
    case 'all_taken':
      return { bg: palette.successBackground, fg: palette.successText };
    case 'partial':
      return { bg: palette.warningBackground, fg: palette.warningText };
    case 'none':
      return { bg: palette.dangerBackground, fg: palette.dangerText };
    case 'pending':
      return { bg: palette.infoBackground, fg: palette.infoText };
    default:
      return { bg: palette.surface, fg: palette.textMuted };
  }
}

const LEGEND: { status: DayStatus; label: string }[] = [
  { status: 'all_taken', label: 'All taken' },
  { status: 'partial', label: 'Some missed' },
  { status: 'none', label: 'None taken' },
  { status: 'no_doses', label: 'Nothing scheduled' },
];

interface MonthCalendarProps {
  month: MonthRef;
  days: ReadonlyMap<LocalDate, DayStats>;
  selected: LocalDate;
  today: LocalDate;
  onSelect: (date: LocalDate) => void;
  onPrevious: () => void;
  onNext: () => void;
}

/** A month grid where each day is colored by adherence and also carries a symbol and a spoken label. */
export function MonthCalendar({
  month,
  days,
  selected,
  today,
  onSelect,
  onPrevious,
  onNext,
}: MonthCalendarProps) {
  const palette = usePalette();
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Button label="Previous" variant="secondary" onPress={onPrevious} style={styles.nav} />
        <AppText variant="heading" style={styles.title} accessibilityLiveRegion="polite">
          {monthTitle(month)}
        </AppText>
        <Button label="Next" variant="secondary" onPress={onNext} style={styles.nav} />
      </View>

      <View style={styles.row} accessibilityElementsHidden importantForAccessibility="no">
        {WEEKDAYS.map((d) => (
          <AppText key={d} variant="caption" muted style={styles.cell}>
            {d}
          </AppText>
        ))}
      </View>

      {monthGrid(month).map((week, i) => (
        <View key={i} style={styles.row}>
          {week.map((date, j) => {
            if (date === null) return <View key={j} style={styles.cell} />;
            const status = days.get(date)?.status ?? 'no_doses';
            const { bg, fg } = colorsFor(status, palette);
            const isSelected = date === selected;
            return (
              <Pressable
                key={date}
                testID={`day-${date}`}
                accessibilityRole="button"
                accessibilityLabel={`${formatLocalDate(date, { weekday: true })}, ${DAY_LABELS[status]}${date === today ? ', today' : ''}`}
                accessibilityState={{ selected: isSelected }}
                onPress={() => onSelect(date)}
                style={[
                  styles.cell,
                  styles.day,
                  {
                    backgroundColor: bg,
                    borderColor: isSelected
                      ? palette.primary
                      : date === today
                        ? palette.text
                        : 'transparent',
                    borderWidth: isSelected ? 3 : date === today ? 2 : 0,
                  },
                ]}
              >
                <AppText variant="caption" color={fg} style={styles.number}>
                  {Number(date.slice(8))}
                </AppText>
                <AppText variant="caption" color={fg}>
                  {DAY_SYMBOLS[status]}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      ))}

      <View style={styles.legend} accessibilityLabel="Legend">
        {LEGEND.map(({ status, label }) => {
          const { bg, fg } = colorsFor(status, palette);
          return (
            <View key={status} style={styles.legendItem}>
              <View style={[styles.swatch, { backgroundColor: bg, borderColor: palette.border }]}>
                <AppText variant="caption" color={fg}>
                  {DAY_SYMBOLS[status]}
                </AppText>
              </View>
              <AppText variant="caption">{label}</AppText>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.xs },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  nav: { paddingHorizontal: spacing.md },
  title: { flex: 1, textAlign: 'center' },
  row: { flexDirection: 'row', gap: 4 },
  cell: { flex: 1, textAlign: 'center' },
  day: {
    minHeight: 56,
    borderRadius: radius / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  number: { fontWeight: '700' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  swatch: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
