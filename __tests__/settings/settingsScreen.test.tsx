import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { Alert, Appearance } from 'react-native';

import { DatabaseProvider } from '@/db/DatabaseProvider';
import type { Database } from '@/db/types';
import type { BackupPicker } from '@/features/backup/flow';
import type { FileExporter } from '@/features/history/exporter';
import type { AuthPort, AuthStatus } from '@/features/lock/auth';
import { setupNotifications } from '@/features/reminders/setup';
import { syncReminders } from '@/features/reminders/sync';
import { SettingsProvider } from '@/features/settings/SettingsProvider';
import { SettingsScreen } from '@/features/settings/screens/SettingsScreen';
import { getSettings, updateSettings } from '@/features/settings/settings';
import { createBackup, serializeBackup } from '@/features/backup/backup';
import { DISCLAIMER_TEXT } from '@/lib/disclaimer';
import { formatClock, setTimeFormatPreference } from '@/lib/format';
import { createTestDb } from '../helpers/testDb';

jest.mock('@/features/reminders/sync');
jest.mock('@/features/reminders/setup');
jest.setTimeout(20_000);

class FakeAuth implements AuthPort {
  statusValue: AuthStatus = 'ready';
  succeed = true;
  async status() {
    return this.statusValue;
  }
  async authenticate() {
    return this.succeed;
  }
}
const exporter: FileExporter = {
  canShare: async () => true,
  writeText: async (n) => n,
  htmlToPdf: async (n) => n,
  share: async () => undefined,
};
const picker: BackupPicker = { pickText: async () => null };

let db: Database;
let auth: FakeAuth;

const renderSettings = async () =>
  await render(
    <DatabaseProvider getDatabase={() => Promise.resolve(db)}>
      <SettingsProvider>
        <SettingsScreen auth={auth} exporter={exporter} picker={picker} />
      </SettingsProvider>
    </DatabaseProvider>,
  );
const selected = (label: string) => screen.getByLabelText(label).props.accessibilityState.selected;

beforeEach(async () => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  db = await createTestDb();
  auth = new FakeAuth();
});
afterEach(() => {
  setTimeFormatPreference('system');
  Appearance.setColorScheme('unspecified');
});

describe('SettingsScreen', () => {
  it('shows the current settings and the not-medical-advice disclaimer', async () => {
    await renderSettings();
    expect(await screen.findByText('Mark a dose as missed after')).toBeTruthy();
    expect(selected('2 hours')).toBe(true);
    expect(selected('10 min')).toBe(true);
    expect(screen.getByText('Not medical advice')).toBeTruthy();
    expect(screen.getByText(DISCLAIMER_TEXT)).toBeTruthy();
  });

  it('saves the missed window', async () => {
    await renderSettings();
    await fireEvent.press(await screen.findByLabelText('1 hour'));
    await waitFor(async () => expect((await getSettings(db)).missedAfterMinutes).toBe(60));
  });

  it('saves the snooze length and updates the notification button', async () => {
    await renderSettings();
    await fireEvent.press(await screen.findByLabelText('15 min'));
    await waitFor(async () => expect((await getSettings(db)).snoozeMinutes).toBe(15));
    expect(setupNotifications).toHaveBeenCalledWith({ snoozeMinutes: 15 });
    expect(syncReminders).not.toHaveBeenCalled();
  });

  it('turns notification sound off and refreshes the scheduled reminders', async () => {
    await renderSettings();
    const group = await screen.findByLabelText('Notification sound');
    await fireEvent.press(within(group).getByLabelText('Off'));
    await waitFor(async () => expect((await getSettings(db)).soundEnabled).toBe(false));
    expect(syncReminders).toHaveBeenCalledWith(db);
  });

  it('saves the default refill threshold, adjusting the value list to the unit', async () => {
    await renderSettings();
    await fireEvent.press(await screen.findByLabelText('10'));
    await waitFor(async () => expect((await getSettings(db)).refillThresholdValue).toBe(10));
    await fireEvent.press(screen.getByLabelText('Amount left'));
    await waitFor(async () =>
      expect(await getSettings(db)).toMatchObject({
        refillThresholdUnit: 'count',
        refillThresholdValue: 15,
      }),
    );
    expect(screen.getAllByText('Amount left').length).toBeGreaterThan(0);
  });

  it('applies the theme and the 12/24-hour setting immediately', async () => {
    const spy = jest.spyOn(Appearance, 'setColorScheme');
    await renderSettings();
    await fireEvent.press(await screen.findByLabelText('Dark'));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('dark'));
    expect((await getSettings(db)).theme).toBe('dark');
    await fireEvent.press(screen.getAllByLabelText('Match phone')[0]);
    await waitFor(() => expect(spy).toHaveBeenLastCalledWith('unspecified'));

    const evening = new Date(2026, 5, 10, 20, 5);
    await fireEvent.press(screen.getByLabelText('24-hour'));
    await waitFor(() => expect(formatClock(evening)).toBe('20:05'));
    await fireEvent.press(screen.getByLabelText('12-hour'));
    await waitFor(() => expect(formatClock(evening)).toMatch(/^8:05\s?PM$/));
  });

  describe('app lock', () => {
    it('turns on after the person is verified', async () => {
      await renderSettings();
      const group = await screen.findByLabelText('App lock');
      await fireEvent.press(within(group).getByLabelText('On'));
      await waitFor(async () => expect((await getSettings(db)).appLock).toBe(true));
    });

    it('explains when the phone has no biometric or screen lock set up', async () => {
      auth.statusValue = 'not_enrolled';
      await renderSettings();
      const group = await screen.findByLabelText('App lock');
      await fireEvent.press(within(group).getByLabelText('On'));
      expect(
        await screen.findByText(/Set up Face ID, a fingerprint, or a screen lock/),
      ).toBeTruthy();
      expect((await getSettings(db)).appLock).toBe(false);
    });

    it('stays off when verification fails, and needs verification to turn off', async () => {
      auth.succeed = false;
      await renderSettings();
      const group = await screen.findByLabelText('App lock');
      await fireEvent.press(within(group).getByLabelText('On'));
      expect(await screen.findByText(/Couldn't verify it's you/)).toBeTruthy();
      expect((await getSettings(db)).appLock).toBe(false);

      auth.succeed = true;
      await fireEvent.press(within(group).getByLabelText('On'));
      await waitFor(async () => expect((await getSettings(db)).appLock).toBe(true));
      auth.succeed = false;
      await fireEvent.press(within(group).getByLabelText('Off'));
      expect(await screen.findByText(/lock was not changed/)).toBeTruthy();
      expect((await getSettings(db)).appLock).toBe(true);
    });
  });

  it('includes backup and restore', async () => {
    await renderSettings();
    expect(await screen.findByText('Backup and restore')).toBeTruthy();
    expect(screen.getByText('Export backup')).toBeTruthy();
    expect(screen.getByText('Restore from backup')).toBeTruthy();
  });
});

describe('after restoring a backup', () => {
  it('re-applies the restored settings', async () => {
    const source = await createTestDb();
    await updateSettings(source, { theme: 'dark', timeFormat: '24h', snoozeMinutes: 30 });
    const text = serializeBackup(await createBackup(source, new Date(2026, 5, 10)));
    const spy = jest.spyOn(Appearance, 'setColorScheme');
    await render(
      <DatabaseProvider getDatabase={() => Promise.resolve(db)}>
        <SettingsProvider>
          <SettingsScreen auth={auth} exporter={exporter} picker={{ pickText: async () => text }} />
        </SettingsProvider>
      </DatabaseProvider>,
    );
    const pressed = fireEvent.press(await screen.findByText('Restore from backup'));
    // Restoring asks for confirmation in an Alert; accept it ("Replace").
    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
    const buttons = jest.mocked(Alert.alert).mock.calls[0][2] as {
      text: string;
      onPress: () => void;
    }[];
    buttons.find((b) => b.text === 'Replace')?.onPress();
    await pressed;

    await waitFor(() => expect(spy).toHaveBeenCalledWith('dark'));
    expect(formatClock(new Date(2026, 5, 10, 20, 5))).toBe('20:05');
    expect(setupNotifications).toHaveBeenCalledWith({ snoozeMinutes: 30 });
    await waitFor(() =>
      expect(
        within(screen.getByLabelText('Snooze for')).getByLabelText('30 min').props
          .accessibilityState.selected,
      ).toBe(true),
    );
  });
});
