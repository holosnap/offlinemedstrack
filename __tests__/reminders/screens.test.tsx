import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { DatabaseProvider } from '@/db/DatabaseProvider';
import { ReminderStatusBanner } from '@/features/reminders/components/ReminderStatusBanner';
import { toPermissionState } from '@/features/reminders/expoPort';
import * as permissions from '@/features/reminders/permissions';
import { ReminderPermissionScreen } from '@/features/reminders/screens/ReminderPermissionScreen';
import * as sync from '@/features/reminders/sync';
import { createTestDb } from '../helpers/testDb';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn() };

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    useRouter: () => mockRouter,
    useFocusEffect: (effect: () => void | (() => void)) => useEffect(effect, [effect]),
  };
});
jest.mock('@/features/reminders/permissions');
jest.mock('@/features/reminders/sync');

jest.setTimeout(20_000);

const mockedPermissions = jest.mocked(permissions);
const wrap = async (node: ReactNode) => {
  const db = await createTestDb();
  return render(
    <DatabaseProvider getDatabase={() => Promise.resolve(db)}>{node}</DatabaseProvider>,
  );
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedPermissions.getPermissionState.mockResolvedValue('undetermined');
});

describe('toPermissionState', () => {
  it('maps OS permission responses', () => {
    expect(toPermissionState({ granted: true, canAskAgain: true })).toBe('granted');
    expect(toPermissionState({ granted: false, canAskAgain: true })).toBe('undetermined');
    expect(toPermissionState({ granted: false, canAskAgain: false })).toBe('denied');
  });
});

describe('ReminderPermissionScreen', () => {
  it('explains first, then reconciles and closes when permission is granted', async () => {
    mockedPermissions.requestPermission.mockResolvedValue('granted');
    await wrap(<ReminderPermissionScreen />);
    expect(screen.getByText(/uses notifications to tell you/i)).toBeTruthy();
    expect(mockedPermissions.requestPermission).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByText('Turn on reminders'));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    expect(sync.syncReminders).toHaveBeenCalled();
  });

  it('handles denial gracefully and shows how to enable reminders later', async () => {
    mockedPermissions.requestPermission.mockResolvedValue('denied');
    await wrap(<ReminderPermissionScreen />);
    await fireEvent.press(screen.getByText('Turn on reminders'));

    expect(await screen.findByText(/Reminders are off, and the app still works/)).toBeTruthy();
    expect(screen.getByText(/open Settings, choose Notifications/)).toBeTruthy();
    expect(mockRouter.back).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByText('Open Settings'));
    expect(mockedPermissions.openNotificationSettings).toHaveBeenCalled();

    await fireEvent.press(screen.getByText('Continue without reminders'));
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it('"Not now" leaves without asking the system', async () => {
    await wrap(<ReminderPermissionScreen />);
    await fireEvent.press(screen.getByText('Not now'));
    expect(mockRouter.back).toHaveBeenCalled();
    expect(mockedPermissions.requestPermission).not.toHaveBeenCalled();
  });
});

describe('ReminderStatusBanner', () => {
  it('offers to turn reminders on when permission was never asked', async () => {
    await wrap(<ReminderStatusBanner />);
    await fireEvent.press(await screen.findByText('Turn on reminders'));
    expect(mockRouter.push).toHaveBeenCalledWith('/reminders/permission');
  });

  it('points to system settings when notifications are blocked', async () => {
    mockedPermissions.getPermissionState.mockResolvedValue('denied');
    await wrap(<ReminderStatusBanner />);
    expect(await screen.findByText(/Notifications are blocked/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Open Settings'));
    expect(mockedPermissions.openNotificationSettings).toHaveBeenCalled();
  });

  it('renders nothing once reminders are on', async () => {
    mockedPermissions.getPermissionState.mockResolvedValue('granted');
    await wrap(<ReminderStatusBanner />);
    await waitFor(() => expect(mockedPermissions.getPermissionState).toHaveBeenCalled());
    expect(screen.queryByText('Reminders are off')).toBeNull();
  });
});
