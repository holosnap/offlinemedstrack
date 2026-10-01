import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { DatabaseProvider } from '@/db/DatabaseProvider';
import type { Database } from '@/db/types';
import { SettingsScreen } from '@/features/settings/screens/SettingsScreen';
import { getSettings } from '@/features/settings/settings';
import { createTestDb } from '../helpers/testDb';

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return { useFocusEffect: (effect: () => void | (() => void)) => useEffect(effect, [effect]) };
});

jest.setTimeout(20_000);

let db: Database;
beforeEach(async () => {
  db = await createTestDb();
});

describe('SettingsScreen', () => {
  it('shows the current missed window and saves a new one', async () => {
    await render(
      <DatabaseProvider getDatabase={() => Promise.resolve(db)}>
        <SettingsScreen />
      </DatabaseProvider>,
    );
    expect(await screen.findByText('Mark as missed after')).toBeTruthy();
    expect(screen.getByLabelText('2 hours', { exact: true })).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ selected: true }),
    );

    await fireEvent.press(screen.getByLabelText('1 hour'));
    await waitFor(async () => expect((await getSettings(db)).missedAfterMinutes).toBe(60));

    await fireEvent.press(screen.getByLabelText('Exact time'));
    await waitFor(async () => expect((await getSettings(db)).groupBy).toBe('time'));
  });
});
