import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { AppState, StyleSheet, View } from 'react-native';

import { AppText, Button, Screen, spacing, usePalette } from '@/components';
import { formatLocalDate } from '@/lib/format';
import { useLoad } from '@/features/medications/useLoad';
import { loadTodayNow } from '../data';
import { useTodayActions } from '../useTodayActions';
import { AsNeededSection } from '../components/AsNeededSection';
import { DoseRow } from '../components/DoseRow';
import { UndoBar } from '../components/UndoBar';

const REFRESH_MS = 60_000;

export function TodayScreen() {
  const router = useRouter();
  const palette = usePalette();
  const { data, error, loading, reload } = useLoad(loadTodayNow);
  const actions = useTodayActions(reload);

  // Keep overdue/missed status current while the screen stays open and when returning to the app.
  useEffect(() => {
    const timer = setInterval(reload, REFRESH_MS);
    const sub = AppState.addEventListener('change', (s) => s === 'active' && reload());
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [reload]);

  const footer = <UndoBar undo={actions.undo} onDismiss={actions.dismissUndo} />;

  if (error) {
    return (
      <Screen>
        <AppText accessibilityLiveRegion="polite">{`Couldn't load today. ${error}`}</AppText>
        <Button label="Try again" onPress={reload} />
      </Screen>
    );
  }
  if (loading && !data) {
    return (
      <Screen>
        <AppText accessibilityLiveRegion="polite">Loading today…</AppText>
      </Screen>
    );
  }
  if (!data) return null;

  const empty = data.doses.length === 0 && data.asNeeded.length === 0;

  return (
    <Screen footer={footer}>
      <View style={styles.header}>
        <AppText variant="title">Today</AppText>
        <AppText muted>{formatLocalDate(data.date, { weekday: true })}</AppText>
        {data.doses.length > 0 ? (
          <AppText accessibilityLiveRegion="polite">
            {`${data.done} of ${data.doses.length} doses done`}
          </AppText>
        ) : null}
      </View>

      {actions.error ? (
        <AppText color={palette.danger} accessibilityLiveRegion="assertive">
          {actions.error}
        </AppText>
      ) : null}

      {empty ? (
        <View style={styles.empty}>
          <AppText variant="heading">Nothing scheduled today</AppText>
          <AppText muted>Add a medication to see its doses here.</AppText>
          <Button label="Add medication" onPress={() => router.push('/medications/new')} />
        </View>
      ) : null}

      {data.groups.map((group) => (
        <View key={group.key} style={styles.group}>
          <AppText variant="heading">{group.title}</AppText>
          {group.doses.map((dose) => (
            <DoseRow
              key={dose.key}
              dose={dose}
              actions={actions}
              now={data.now}
              snoozeMinutes={data.settings.snoozeMinutes}
            />
          ))}
        </View>
      ))}

      <AsNeededSection entries={data.asNeeded} actions={actions} now={data.now} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.xs },
  group: { gap: spacing.md },
  empty: { gap: spacing.md },
});
