import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Appearance } from 'react-native';

import { useDatabase } from '@/db/DatabaseProvider';
import { setupNotifications } from '@/features/reminders/setup';
import { syncReminders } from '@/features/reminders/sync';
import { setTimeFormatPreference } from '@/lib/format';
import { DEFAULT_SETTINGS, getSettings, updateSettings, type AppSettings } from './settings';

interface SettingsContextValue {
  settings: AppSettings;
  /** False until the stored settings have been read for the first time. */
  ready: boolean;
  /** Saves a change, applies it immediately, and refreshes anything that depends on it. */
  update: (patch: Partial<AppSettings>) => Promise<void>;
  /** Re-reads the stored settings (e.g. after a backup was restored) and applies them. */
  reload: () => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

/** Applies the display preferences (theme, 12/24-hour time) that affect the whole app. */
export function applyDisplaySettings(settings: Pick<AppSettings, 'theme' | 'timeFormat'>): void {
  Appearance.setColorScheme(settings.theme === 'system' ? 'unspecified' : settings.theme);
  setTimeFormatPreference(settings.timeFormat);
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const getDatabase = useDatabase();
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getDatabase()
      .then(getSettings)
      .then((loaded) => {
        if (cancelled) return;
        applyDisplaySettings(loaded);
        setSettings(loaded);
        setReady(true);
      })
      .catch(() => {
        // Fall back to defaults so the app is still usable.
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [getDatabase]);

  const update = useCallback(
    async (patch: Partial<AppSettings>) => {
      const db = await getDatabase();
      await updateSettings(db, patch);
      const next = await getSettings(db);
      applyDisplaySettings(next);
      setSettings(next);
      // Snooze length is shown on the notification button; sound is part of each scheduled
      // notification, so reconcile replaces the pending ones.
      if (patch.snoozeMinutes !== undefined) {
        try {
          await setupNotifications({ snoozeMinutes: next.snoozeMinutes });
        } catch {
          // Notifications may be unavailable; the setting is saved regardless.
        }
      }
      if (patch.soundEnabled !== undefined) await syncReminders(db);
    },
    [getDatabase],
  );

  const reload = useCallback(async () => {
    const next = await getSettings(await getDatabase());
    applyDisplaySettings(next);
    setSettings(next);
    try {
      await setupNotifications({ snoozeMinutes: next.snoozeMinutes });
    } catch {
      // Notifications may be unavailable; the setting is saved regardless.
    }
  }, [getDatabase]);

  const value = useMemo(
    () => ({ settings, ready, update, reload }),
    [settings, ready, update, reload],
  );
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext);
  if (!value) throw new Error('useSettings must be used inside <SettingsProvider>');
  return value;
}
