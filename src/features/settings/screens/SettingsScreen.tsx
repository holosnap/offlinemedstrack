import { useCallback, useState } from 'react';

import { AppText, Card, ChoiceGroup, Screen, usePalette } from '@/components';
import { useDatabase } from '@/db/DatabaseProvider';
import { useLoad } from '@/features/medications/useLoad';
import {
  describeMinutes,
  getSettings,
  MISSED_AFTER_CHOICES,
  updateSettings,
  type AppSettings,
} from '../settings';

const MISSED_CHOICES = MISSED_AFTER_CHOICES.map((m) => ({ value: m, label: describeMinutes(m) }));
const GROUP_CHOICES = [
  { value: 'period', label: 'Time of day' },
  { value: 'time', label: 'Exact time' },
] as const;

export function SettingsScreen() {
  const getDatabase = useDatabase();
  const palette = usePalette();
  const { data, error, reload } = useLoad(getSettings);
  const [saveError, setSaveError] = useState<string | null>(null);

  const save = useCallback(
    async (patch: Partial<AppSettings>) => {
      setSaveError(null);
      try {
        await updateSettings(await getDatabase(), patch);
        reload();
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : 'Could not save.');
      }
    },
    [getDatabase, reload],
  );

  if (error || !data) {
    return (
      <Screen>
        <AppText accessibilityLiveRegion="polite">
          {error ? `Couldn't load settings. ${error}` : 'Loading…'}
        </AppText>
      </Screen>
    );
  }

  return (
    <Screen>
      <Card title="Missed doses">
        <AppText muted>
          A dose you have not marked taken or skipped is recorded as missed after this long. Missed
          doses do not use up your supply.
        </AppText>
        <ChoiceGroup
          label="Mark as missed after"
          choices={MISSED_CHOICES}
          selected={data.missedAfterMinutes}
          onChange={(missedAfterMinutes) => save({ missedAfterMinutes })}
        />
      </Card>
      <Card title="Today screen">
        <ChoiceGroup
          label="Group doses by"
          choices={GROUP_CHOICES}
          selected={data.groupBy}
          onChange={(groupBy) => save({ groupBy })}
        />
      </Card>
      {saveError ? (
        <AppText color={palette.danger} accessibilityLiveRegion="assertive">
          {saveError}
        </AppText>
      ) : null}
    </Screen>
  );
}
