import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import {
  ACTION_SKIP,
  ACTION_SNOOZE,
  ACTION_TAKEN,
  DOSE_CATEGORY_ID,
  DOSE_CHANNEL_ID,
  DOSE_SILENT_CHANNEL_ID,
  SNOOZE_MINUTES,
} from './constants';

// On Android a background task handles these without opening the app. iOS only delivers a
// response to JS when the app is alive or foregrounded, so there the actions open the app to make
// sure a tap is never silently lost.
const opensAppToForeground = Platform.OS === 'ios';

async function registerDoseCategory(snoozeMinutes: number): Promise<void> {
  await Notifications.setNotificationCategoryAsync(DOSE_CATEGORY_ID, [
    { identifier: ACTION_TAKEN, buttonTitle: 'Taken', options: { opensAppToForeground } },
    {
      identifier: ACTION_SNOOZE,
      buttonTitle: `Snooze ${snoozeMinutes} min`,
      options: { opensAppToForeground },
    },
    { identifier: ACTION_SKIP, buttonTitle: 'Skip', options: { opensAppToForeground } },
  ]);
}

/**
 * Notification setup: foreground behavior, Android channels, and action buttons. Safe to call
 * again when the snooze length changes (the button label shows it).
 */
export async function setupNotifications(options: { snoozeMinutes?: number } = {}): Promise<void> {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => ({
      shouldShowBanner: true,
      shouldShowList: true,
      // Each notification records whether sound was on when it was scheduled.
      shouldPlaySound: notification.request.content.data?.sound !== false,
      shouldSetBadge: false,
    }),
  });
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(DOSE_CHANNEL_ID, {
      name: 'Dose reminders',
      importance: Notifications.AndroidImportance.HIGH,
    });
    await Notifications.setNotificationChannelAsync(DOSE_SILENT_CHANNEL_ID, {
      name: 'Dose reminders (silent)',
      importance: Notifications.AndroidImportance.HIGH,
      sound: null,
    });
  }
  await registerDoseCategory(options.snoozeMinutes ?? SNOOZE_MINUTES);
}
