import * as Notifications from 'expo-notifications';

import { DOSE_CATEGORY_ID, DOSE_CHANNEL_ID } from './constants';
import type { NotificationsPort, PermissionState } from './ports';

export function toPermissionState(response: {
  granted: boolean;
  canAskAgain: boolean;
}): PermissionState {
  if (response.granted) return 'granted';
  // iOS reports canAskAgain=false after a denial; Android allows one more prompt after the first.
  return response.canAskAgain ? 'undetermined' : 'denied';
}

export const expoPort: NotificationsPort = {
  async getPermissionState() {
    try {
      return toPermissionState(await Notifications.getPermissionsAsync());
    } catch {
      return 'denied';
    }
  },

  async listPending() {
    const requests = await Notifications.getAllScheduledNotificationsAsync();
    return requests.map((r) => {
      const content = r.content.data?.content;
      return { identifier: r.identifier, content: typeof content === 'string' ? content : null };
    });
  },

  async schedule({ identifier, title, body, fireAt, data }) {
    await Notifications.scheduleNotificationAsync({
      identifier,
      content: {
        title,
        body,
        data,
        categoryIdentifier: DOSE_CATEGORY_ID,
        sound: 'default',
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: fireAt,
        channelId: DOSE_CHANNEL_ID,
      },
    });
  },

  async cancel(identifier) {
    await Notifications.cancelScheduledNotificationAsync(identifier);
  },

  async dismiss(identifier) {
    await Notifications.dismissNotificationAsync(identifier);
  },
};
