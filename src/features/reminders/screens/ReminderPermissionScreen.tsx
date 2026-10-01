import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { AppText, Button, Screen } from '@/components';
import { useDatabase } from '@/db/DatabaseProvider';
import { openNotificationSettings, requestPermission } from '../permissions';
import { syncReminders } from '../sync';

/** Explains why notifications are needed before the system prompt, and handles a "no" kindly. */
export function ReminderPermissionScreen() {
  const router = useRouter();
  const getDatabase = useDatabase();
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);

  const turnOn = async () => {
    setBusy(true);
    const result = await requestPermission();
    if (result === 'granted') {
      await syncReminders(await getDatabase());
      router.back();
      return;
    }
    setDenied(true);
    setBusy(false);
  };

  return (
    <Screen>
      <AppText variant="title">Get dose reminders</AppText>
      {denied ? (
        <>
          <AppText accessibilityLiveRegion="polite">
            No problem. Reminders are off, and the app still works. If you change your mind, open
            Settings, choose Notifications for OfflineMedsTrack, and allow notifications.
          </AppText>
          <Button label="Open Settings" onPress={() => openNotificationSettings()} />
          <Button label="Continue without reminders" variant="secondary" onPress={router.back} />
        </>
      ) : (
        <>
          <AppText>
            OfflineMedsTrack uses notifications to tell you when it is time to take a medication.
            You can mark a dose as taken, snooze it for 10 minutes, or skip it right from the
            notification.
          </AppText>
          <AppText muted style={styles.note}>
            Everything stays on your phone. Reminders are created on this device and nothing is sent
            anywhere.
          </AppText>
          <Button label="Turn on reminders" onPress={turnOn} disabled={busy} />
          <Button label="Not now" variant="secondary" onPress={router.back} />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({ note: { marginBottom: 8 } });
