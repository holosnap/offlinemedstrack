import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Card, spacing } from '@/components';
import { openNotificationSettings } from '../permissions';
import { usePermissionState } from '../usePermissionState';

/** Shown on the medication list while reminders are not enabled; explains how to turn them on. */
export function ReminderStatusBanner() {
  const router = useRouter();
  const state = usePermissionState();
  if (state === null || state === 'granted') return null;

  return (
    <Card>
      <View style={styles.content}>
        <AppText variant="heading">Reminders are off</AppText>
        {state === 'undetermined' ? (
          <>
            <AppText>Turn on notifications to be reminded when it is time to take a dose.</AppText>
            <Button
              label="Turn on reminders"
              onPress={() => router.push('/reminders/permission')}
            />
          </>
        ) : (
          <>
            <AppText>
              Notifications are blocked for this app, so you will not be reminded. To turn them on:
              open Settings, choose Notifications for OfflineMedsTrack, and allow notifications.
            </AppText>
            <Button label="Open Settings" onPress={() => openNotificationSettings()} />
          </>
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({ content: { gap: spacing.sm } });
