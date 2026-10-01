import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import {
  ACTION_SKIP,
  ACTION_SNOOZE,
  ACTION_TAKEN,
  DOSE_CATEGORY_ID,
  DOSE_CHANNEL_ID,
  SNOOZE_MINUTES,
} from './constants';

// On Android a background task handles these without opening the app. iOS only delivers a
// response to JS when the app is alive or foregrounded, so there the actions open the app to make
// sure a tap is never silently lost.
const opensAppToForeground = Platform.OS === 'ios';

async function registerDoseCategory(): Promise<void> {
  await Notifications.setNotificationCategoryAsync(DOSE_CATEGORY_ID, [
    { identifier: ACTION_TAKEN, buttonTitle: 'Taken', options: { opensAppToForeground } },
    {
      identifier: ACTION_SNOOZE,
      buttonTitle: `Snooze ${SNOOZE_MINUTES} min`,
      options: { opensAppToForeground },
    },
    { identifier: ACTION_SKIP, buttonTitle: 'Skip', options: { opensAppToForeground } },
  ]);
}

/** One-time notification setup: foreground behavior, Android channel, action buttons. */
export async function setupNotifications(): Promise<void> {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(DOSE_CHANNEL_ID, {
      name: 'Dose reminders',
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  await registerDoseCategory();
}
