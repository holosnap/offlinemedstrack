import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { DatabaseProvider } from '@/db/DatabaseProvider';
import { createMedication, listMedications } from '@/db/repositories';
import type { Database } from '@/db/types';
import type { BackupPicker } from '@/features/backup/flow';
import { createBackup, serializeBackup } from '@/features/backup/backup';
import { OnboardingScreen } from '@/features/onboarding/screens/OnboardingScreen';
import * as permissions from '@/features/reminders/permissions';
import { SettingsProvider } from '@/features/settings/SettingsProvider';
import { getSettings } from '@/features/settings/settings';
import { DISCLAIMER_TEXT } from '@/lib/disclaimer';
import { createTestDb } from '../helpers/testDb';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('@/features/reminders/permissions');
jest.mock('@/features/reminders/sync');
jest.mock('@/features/reminders/setup');
jest.mock('@/features/backup/components/BackupCard', () => ({
  confirmRestore: jest.fn().mockResolvedValue(true),
}));
jest.setTimeout(20_000);

const mockedPermissions = jest.mocked(permissions);
let db: Database;

const renderOnboarding = async (picker: BackupPicker = { pickText: async () => null }) =>
  await render(
    <DatabaseProvider getDatabase={() => Promise.resolve(db)}>
      <SettingsProvider>
        <OnboardingScreen picker={picker} />
      </SettingsProvider>
    </DatabaseProvider>,
  );

beforeEach(async () => {
  jest.clearAllMocks();
  db = await createTestDb();
});

describe('OnboardingScreen', () => {
  it('starts with an intro and the not-medical-advice disclaimer', async () => {
    await renderOnboarding();
    expect(await screen.findByText('Welcome to OfflineMedsTrack')).toBeTruthy();
    expect(screen.getByText('Step 1 of 3')).toBeTruthy();
    expect(screen.getByText('Not medical advice')).toBeTruthy();
    expect(screen.getByText(DISCLAIMER_TEXT)).toBeTruthy();
    expect(screen.getByText(/Everything stays on this phone/)).toBeTruthy();
  });

  it('walks through notifications and adding the first medication', async () => {
    mockedPermissions.requestPermission.mockResolvedValue('granted');
    await renderOnboarding();
    await fireEvent.press(await screen.findByText('I understand, continue'));
    expect(screen.getByText('Step 2 of 3')).toBeTruthy();
    expect(mockedPermissions.requestPermission).not.toHaveBeenCalled(); // explained first

    await fireEvent.press(screen.getByText('Turn on reminders'));
    expect(await screen.findByText('Add your first medication')).toBeTruthy();
    expect(screen.getByText(/Reminders are on/)).toBeTruthy();

    await fireEvent.press(screen.getByText('Add my first medication'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/'));
    expect(mockRouter.push).toHaveBeenCalledWith('/medications/new');
    expect((await getSettings(db)).onboardingComplete).toBe(true);
  });

  it('handles a denied permission gracefully and still lets the person continue', async () => {
    mockedPermissions.requestPermission.mockResolvedValue('denied');
    await renderOnboarding();
    await fireEvent.press(await screen.findByText('I understand, continue'));
    await fireEvent.press(screen.getByText('Turn on reminders'));

    expect(await screen.findByText(/Reminders are off, and the app still works/)).toBeTruthy();
    expect(screen.getByText(/open\s+Settings, choose Notifications/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Open Settings'));
    expect(mockedPermissions.openNotificationSettings).toHaveBeenCalled();

    await fireEvent.press(screen.getByText('Continue without reminders'));
    expect(await screen.findByText('Add your first medication')).toBeTruthy();
    expect(screen.queryByText(/Reminders are on/)).toBeNull();
  });

  it('lets the person skip reminders and adding a medication', async () => {
    await renderOnboarding();
    await fireEvent.press(await screen.findByText('I understand, continue'));
    await fireEvent.press(screen.getByText('Not now'));
    expect(mockedPermissions.requestPermission).not.toHaveBeenCalled();
    await fireEvent.press(await screen.findByText("I'll do this later"));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/'));
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect((await getSettings(db)).onboardingComplete).toBe(true);
  });

  it('can restore from a backup instead', async () => {
    const source = await createTestDb();
    await createMedication(source, {
      name: 'Restored',
      dosageAmount: 1,
      dosageUnit: 'mg',
      form: 'tablet',
    });
    const text = serializeBackup(await createBackup(source, new Date(2026, 5, 10)));
    await renderOnboarding({ pickText: async () => text });

    await fireEvent.press(await screen.findByText('Restore from a backup'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/'));
    expect((await listMedications(db)).map((m) => m.name)).toEqual(['Restored']);
    expect((await getSettings(db)).onboardingComplete).toBe(true);
  });

  it('shows why a bad backup file was refused and stays on the intro', async () => {
    await renderOnboarding({ pickText: async () => '{"format":"nope"}' });
    await fireEvent.press(await screen.findByText('Restore from a backup'));
    expect(await screen.findByText("This isn't an OfflineMedsTrack backup file.")).toBeTruthy();
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect((await getSettings(db)).onboardingComplete).toBe(false);
  });
});
