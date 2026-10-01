import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { useDatabase } from '@/db/DatabaseProvider';
import { handleNotificationResponse, type ResponseLike } from './actions';
import { registerBackgroundTask } from './backgroundTask';
import { expoPort } from './expoPort';
import { setupNotifications } from './setup';
import { syncReminders } from './sync';

/**
 * Keeps reminders in step with the app: reconciles at launch and whenever the app returns to the
 * foreground (which also picks up time zone and DST changes), and handles notification responses.
 */
export function useReminderLifecycle(): void {
  const getDatabase = useDatabase();
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    const reconcileNow = async () => {
      const db = await getDatabase();
      if (!cancelled) await syncReminders(db);
    };

    const respond = async (response: ResponseLike) => {
      const db = await getDatabase();
      const outcome = await handleNotificationResponse({ db, port: expoPort }, response);
      if (outcome.type === 'logged') await syncReminders(db);
      if (outcome.type === 'open') router.push(`/medications/${outcome.medicationId}`);
    };

    (async () => {
      try {
        await setupNotifications();
        await registerBackgroundTask();
        await reconcileNow();
        // Cold start from a tap: the response arrived before the listener existed.
        const last = await Notifications.getLastNotificationResponseAsync();
        if (last && !cancelled) {
          await respond(last);
          await Notifications.clearLastNotificationResponseAsync();
        }
      } catch (e) {
        console.warn('Reminder setup failed', e);
      }
    })();

    const responses = Notifications.addNotificationResponseReceivedListener((response) => {
      respond(response).catch((e: unknown) => console.warn('Notification response failed', e));
    });
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') reconcileNow().catch(() => undefined);
    });

    return () => {
      cancelled = true;
      responses.remove();
      appState.remove();
    };
  }, [getDatabase, router]);
}
