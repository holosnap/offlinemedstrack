import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';

import { getDatabase } from '@/db/client';
import { handleNotificationResponse, type ResponseLike } from './actions';
import { expoPort } from './expoPort';

const TASK_NAME = 'dose-notification-response';

function isResponse(data: unknown): data is ResponseLike {
  return typeof data === 'object' && data !== null && 'actionIdentifier' in data;
}

// Must be defined at module scope so it exists when the OS starts the app headlessly. On Android
// this records Taken/Snooze/Skip while the app is backgrounded or killed, without opening it.
TaskManager.defineTask<unknown>(TASK_NAME, async ({ data, error }) => {
  if (error || !isResponse(data)) return;
  try {
    const db = await getDatabase();
    await handleNotificationResponse({ db, port: expoPort }, data);
  } catch (e) {
    console.warn('Could not handle notification action', e);
  }
});

export async function registerBackgroundTask(): Promise<void> {
  try {
    await Notifications.registerTaskAsync(TASK_NAME);
  } catch (e) {
    console.warn('Could not register the notification task', e);
  }
}
