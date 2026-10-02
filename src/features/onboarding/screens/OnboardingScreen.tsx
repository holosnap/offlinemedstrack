import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Card, DisclaimerCard, Screen, spacing, usePalette } from '@/components';
import { useDatabase } from '@/db/DatabaseProvider';
import { confirmRestore } from '@/features/backup/components/BackupCard';
import { expoBackupPicker, restoreFromPicker, type BackupPicker } from '@/features/backup/flow';
import { openNotificationSettings, requestPermission } from '@/features/reminders/permissions';
import { useSettings } from '@/features/settings/SettingsProvider';

type Step = 'welcome' | 'reminders' | 'medication';
const STEPS: readonly Step[] = ['welcome', 'reminders', 'medication'];

/** First run: what the app is (and isn't), notification permission, then the first medication. */
export function OnboardingScreen({ picker = expoBackupPicker }: { picker?: BackupPicker }) {
  const router = useRouter();
  const palette = usePalette();
  const getDatabase = useDatabase();
  const { update } = useSettings();
  const [step, setStep] = useState<Step>('welcome');
  const [denied, setDenied] = useState(false);
  const [granted, setGranted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const finish = async (addMedication: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await update({ onboardingComplete: true });
      router.replace('/');
      if (addMedication) router.push('/medications/new');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
      setBusy(false);
    }
  };

  const turnOnReminders = async () => {
    setBusy(true);
    const result = await requestPermission();
    setBusy(false);
    if (result === 'granted') {
      setGranted(true);
      setStep('medication');
    } else {
      setDenied(true);
    }
  };

  const restore = async () => {
    setBusy(true);
    setError(null);
    const outcome = await restoreFromPicker(await getDatabase(), picker, confirmRestore);
    if (outcome.status === 'restored') {
      await finish(false);
      return;
    }
    if (outcome.status === 'error') setError(outcome.message);
    setBusy(false);
  };

  return (
    <Screen>
      <AppText variant="caption" muted accessibilityLiveRegion="polite">
        {`Step ${STEPS.indexOf(step) + 1} of ${STEPS.length}`}
      </AppText>

      {step === 'welcome' ? (
        <>
          <AppText variant="title">Welcome to OfflineMedsTrack</AppText>
          <Card>
            <AppText>Get reminded when it is time to take each medication.</AppText>
            <AppText>
              See today&apos;s doses at a glance and mark them taken, skipped or snoozed.
            </AppText>
            <AppText>Keep track of your supply and know when to refill.</AppText>
            <AppText variant="label">
              Everything stays on this phone. There is no account and nothing is uploaded.
            </AppText>
          </Card>
          <DisclaimerCard />
          <Button label="I understand, continue" onPress={() => setStep('reminders')} />
          <Button
            label="Restore from a backup"
            variant="secondary"
            accessibilityHint="Choose a backup file to bring your data over from another phone"
            onPress={restore}
            disabled={busy}
          />
        </>
      ) : null}

      {step === 'reminders' ? (
        <>
          <AppText variant="title">Get dose reminders</AppText>
          <AppText>
            OfflineMedsTrack uses notifications to tell you when it is time to take a medication.
            You can mark a dose as taken, snooze it, or skip it right from the notification.
          </AppText>
          <AppText muted>Reminders are created on this phone. Nothing is sent anywhere.</AppText>
          {denied ? (
            <View style={styles.group}>
              <AppText accessibilityLiveRegion="polite">
                No problem. Reminders are off, and the app still works. To turn them on later, open
                Settings, choose Notifications for OfflineMedsTrack, and allow notifications.
              </AppText>
              <Button label="Open Settings" onPress={() => openNotificationSettings()} />
              <Button label="Continue without reminders" onPress={() => setStep('medication')} />
            </View>
          ) : (
            <View style={styles.group}>
              <Button label="Turn on reminders" onPress={turnOnReminders} disabled={busy} />
              <Button label="Not now" variant="secondary" onPress={() => setStep('medication')} />
            </View>
          )}
        </>
      ) : null}

      {step === 'medication' ? (
        <>
          <AppText variant="title">Add your first medication</AppText>
          <AppText>
            {granted ? 'Reminders are on. ' : ''}
            Enter the name, strength, when you take it, and how much you have. It only takes a
            minute.
          </AppText>
          <View style={styles.group}>
            <Button label="Add my first medication" onPress={() => finish(true)} disabled={busy} />
            <Button
              label="I'll do this later"
              variant="secondary"
              onPress={() => finish(false)}
              disabled={busy}
            />
          </View>
        </>
      ) : null}

      {error ? (
        <AppText color={palette.danger} accessibilityLiveRegion="assertive">
          {error}
        </AppText>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({ group: { gap: spacing.md } });
