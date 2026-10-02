import Constants from 'expo-constants';
import { useState } from 'react';

import { AppText, Card, ChoiceGroup, DisclaimerCard, Screen, usePalette } from '@/components';
import { BackupCard } from '@/features/backup/components/BackupCard';
import { expoBackupPicker, type BackupPicker } from '@/features/backup/flow';
import { expoExporter, type FileExporter } from '@/features/history/exporter';
import { expoAuth, type AuthPort } from '@/features/lock/auth';
import { confirmLockChange } from '@/features/lock/lockLogic';
import { useSettings } from '../SettingsProvider';
import {
  describeMinutes,
  MISSED_AFTER_CHOICES,
  SNOOZE_CHOICES,
  THRESHOLD_CHOICES,
  type AppSettings,
  type ThresholdUnit,
} from '../settings';

const onOff = [
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
] as const;

const withCurrent = (choices: readonly number[], current: number) =>
  (choices.includes(current) ? [...choices] : [...choices, current].sort((a, b) => a - b)).map(
    (value) => ({ value, label: String(value) }),
  );

interface SettingsScreenProps {
  auth?: AuthPort;
  exporter?: FileExporter;
  picker?: BackupPicker;
}

export function SettingsScreen({
  auth = expoAuth,
  exporter = expoExporter,
  picker = expoBackupPicker,
}: SettingsScreenProps) {
  const palette = usePalette();
  const { settings, ready, update, reload } = useSettings();
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const save = async (patch: Partial<AppSettings>) => {
    setMessage(null);
    try {
      await update(patch);
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : 'Could not save.', error: true });
    }
  };

  const changeLock = async (value: 'on' | 'off') => {
    const enabling = value === 'on';
    if (enabling === settings.appLock) return;
    setMessage(null);
    const result = await confirmLockChange(auth, enabling);
    if (!result.ok) {
      setMessage({ text: result.message, error: true });
      return;
    }
    await save({ appLock: enabling });
  };

  if (!ready) {
    return (
      <Screen>
        <AppText accessibilityLiveRegion="polite">Loading…</AppText>
      </Screen>
    );
  }

  const unit = settings.refillThresholdUnit;
  const version = Constants.expoConfig?.version;

  return (
    <Screen>
      <Card title="Reminders">
        <ChoiceGroup
          label="Mark a dose as missed after"
          choices={MISSED_AFTER_CHOICES.map((m) => ({ value: m, label: describeMinutes(m) }))}
          selected={settings.missedAfterMinutes}
          onChange={(missedAfterMinutes) => save({ missedAfterMinutes })}
        />
        <AppText variant="caption" muted>
          A dose you have not marked taken or skipped is recorded as missed after this long. Missed
          doses do not use up your supply.
        </AppText>
        <ChoiceGroup
          label="Snooze for"
          choices={SNOOZE_CHOICES.map((m) => ({ value: m, label: describeMinutes(m) }))}
          selected={settings.snoozeMinutes}
          onChange={(snoozeMinutes) => save({ snoozeMinutes })}
        />
        <ChoiceGroup
          label="Notification sound"
          choices={onOff}
          selected={settings.soundEnabled ? 'on' : 'off'}
          onChange={(v) => save({ soundEnabled: v === 'on' })}
        />
      </Card>

      <Card title="New medications">
        <ChoiceGroup
          label="Warn me when supply is low, by"
          choices={[
            { value: 'days', label: 'Days left' },
            { value: 'count', label: 'Amount left' },
          ]}
          selected={unit}
          onChange={(next: ThresholdUnit) =>
            save({
              refillThresholdUnit: next,
              refillThresholdValue:
                THRESHOLD_CHOICES[next][Math.min(2, THRESHOLD_CHOICES[next].length - 1)],
            })
          }
        />
        <ChoiceGroup
          label={unit === 'days' ? 'Days of supply left' : 'Amount left'}
          choices={withCurrent(THRESHOLD_CHOICES[unit], settings.refillThresholdValue)}
          selected={settings.refillThresholdValue}
          onChange={(refillThresholdValue) => save({ refillThresholdValue })}
        />
        <AppText variant="caption" muted>
          This is the starting value when you add a medication. You can change it for each one.
        </AppText>
      </Card>

      <Card title="Display">
        <ChoiceGroup
          label="Theme"
          choices={[
            { value: 'system', label: 'Match phone' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
          selected={settings.theme}
          onChange={(theme) => save({ theme })}
        />
        <ChoiceGroup
          label="Time format"
          choices={[
            { value: 'system', label: 'Match phone' },
            { value: '12h', label: '12-hour' },
            { value: '24h', label: '24-hour' },
          ]}
          selected={settings.timeFormat}
          onChange={(timeFormat) => save({ timeFormat })}
        />
        <ChoiceGroup
          label="Group today's doses by"
          choices={[
            { value: 'period', label: 'Time of day' },
            { value: 'time', label: 'Exact time' },
          ]}
          selected={settings.groupBy}
          onChange={(groupBy) => save({ groupBy })}
        />
      </Card>

      <Card title="Privacy">
        <ChoiceGroup
          label="App lock"
          choices={onOff}
          selected={settings.appLock ? 'on' : 'off'}
          onChange={changeLock}
        />
        <AppText variant="caption" muted>
          Ask for Face ID, a fingerprint, or your phone passcode when you open the app. Medication
          names can still appear in notifications on your lock screen.
        </AppText>
      </Card>

      {message ? (
        <AppText
          color={message.error ? palette.danger : undefined}
          accessibilityLiveRegion={message.error ? 'assertive' : 'polite'}
        >
          {message.text}
        </AppText>
      ) : null}

      <BackupCard exporter={exporter} picker={picker} onRestored={reload} />

      <DisclaimerCard />
      {version ? (
        <AppText variant="caption" muted>{`OfflineMedsTrack version ${version}`}</AppText>
      ) : null}
    </Screen>
  );
}
