import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { AppText, Button, Screen } from '@/components';
import { useLoad } from '@/features/medications/useLoad';
import { SupplyWarning } from '@/features/today/components/SupplyWarning';
import { UndoBar } from '@/features/today/components/UndoBar';
import type { LocalDate } from '@/lib/time';
import { AdherenceCard } from '../components/AdherenceCard';
import { DayLog } from '../components/DayLog';
import { ExportCard } from '../components/ExportCard';
import { MonthCalendar } from '../components/MonthCalendar';
import { addMonths, firstOfMonth, monthOf, type MonthRef } from '../calendar';
import { loadHistory } from '../data';
import { expoExporter, type FileExporter } from '../exporter';
import { useHistoryActions } from '../useHistoryActions';
import { localDateOf } from '@/lib/time';

/** The History tab: adherence calendar, a day's log (editable), adherence per medication, export. */
export function HistoryScreen({ exporter = expoExporter }: { exporter?: FileExporter }) {
  const [month, setMonth] = useState<MonthRef>(() => monthOf(localDateOf(new Date())));
  const [selected, setSelected] = useState<LocalDate>(() => localDateOf(new Date()));
  const loader = useCallback(
    (db: Parameters<typeof loadHistory>[0]) => loadHistory(db, month, new Date()),
    [month],
  );
  const { data, error, loading, reload } = useLoad(loader);
  const actions = useHistoryActions(reload);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s === 'active' && reload());
    return () => sub.remove();
  }, [reload]);

  const move = (delta: number) => {
    const next = addMonths(month, delta);
    setMonth(next);
    const today = localDateOf(new Date());
    setSelected(
      monthOf(today).year === next.year && monthOf(today).month === next.month
        ? today
        : firstOfMonth(next),
    );
  };

  if (error) {
    return (
      <Screen>
        <AppText accessibilityLiveRegion="polite">{`Couldn't load history. ${error}`}</AppText>
        <Button label="Try again" onPress={reload} />
      </Screen>
    );
  }
  if (!data) {
    return (
      <Screen>
        <AppText accessibilityLiveRegion="polite">{loading ? 'Loading history…' : ''}</AppText>
      </Screen>
    );
  }

  const day = data.days.get(selected);
  const now = new Date();

  return (
    <Screen footer={<UndoBar undo={actions.undo} onDismiss={actions.dismissUndo} />}>
      <MonthCalendar
        month={data.month}
        days={data.days}
        selected={selected}
        today={data.today}
        onSelect={setSelected}
        onPrevious={() => move(-1)}
        onNext={() => move(1)}
      />
      {actions.warning ? (
        <SupplyWarning message={actions.warning} onDismiss={actions.dismissWarning} />
      ) : null}
      {actions.error ? (
        <AppText accessibilityLiveRegion="assertive">{actions.error}</AppText>
      ) : null}
      {day ? (
        <DayLog
          day={day}
          today={data.today}
          now={now}
          units={data.units}
          asNeededMedications={data.asNeededMedications}
          actions={actions}
        />
      ) : null}
      <AdherenceCard rows={data.adherence} />
      <ExportCard exporter={exporter} />
    </Screen>
  );
}
