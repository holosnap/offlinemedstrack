import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppState, Text, type AppStateStatus } from 'react-native';

import { DatabaseProvider } from '@/db/DatabaseProvider';
import type { AuthPort, AuthStatus } from '@/features/lock/auth';
import { AppLockGate } from '@/features/lock/AppLockGate';
import { confirmLockChange, LOCK_GRACE_MS, shouldRelock } from '@/features/lock/lockLogic';
import { SettingsProvider, useSettings } from '@/features/settings/SettingsProvider';
import { updateSettings } from '@/features/settings/settings';
import type { Database } from '@/db/types';
import { createTestDb } from '../helpers/testDb';

jest.mock('@/features/reminders/sync');
jest.setTimeout(20_000);

class FakeAuth implements AuthPort {
  statusValue: AuthStatus = 'ready';
  succeed = true;
  prompts: string[] = [];
  async status() {
    return this.statusValue;
  }
  async authenticate(prompt: string) {
    this.prompts.push(prompt);
    return this.succeed;
  }
}

describe('shouldRelock', () => {
  it('locks only when enabled and away for at least the grace period', () => {
    const base = { enabled: true, backgroundedAt: 1000, now: 1000 + LOCK_GRACE_MS };
    expect(shouldRelock(base)).toBe(true);
    expect(shouldRelock({ ...base, now: 1000 + LOCK_GRACE_MS - 1 })).toBe(false);
    expect(shouldRelock({ ...base, enabled: false })).toBe(false);
    expect(shouldRelock({ ...base, backgroundedAt: null })).toBe(false);
    expect(shouldRelock({ ...base, graceMs: 0, now: 1000 })).toBe(true);
  });
});

describe('confirmLockChange', () => {
  it('requires a usable lock method and a successful check to turn the lock on', async () => {
    const auth = new FakeAuth();
    expect(await confirmLockChange(auth, true)).toEqual({ ok: true });
    expect(auth.prompts).toEqual(['Turn on app lock']);

    auth.statusValue = 'not_enrolled';
    const notEnrolled = await confirmLockChange(auth, true);
    expect(notEnrolled).toMatchObject({ ok: false });
    expect(!notEnrolled.ok && notEnrolled.message).toContain('Set up Face ID');

    auth.statusValue = 'no_hardware';
    const none = await confirmLockChange(auth, true);
    expect(!none.ok && none.message).toContain("doesn't have");
    expect(auth.prompts).toHaveLength(1); // never prompted when unavailable
  });

  it('fails when the person is not verified, and also asks before turning the lock off', async () => {
    const auth = new FakeAuth();
    auth.succeed = false;
    expect(await confirmLockChange(auth, true)).toMatchObject({ ok: false });
    expect(await confirmLockChange(auth, false)).toMatchObject({ ok: false });
    expect(auth.prompts).toEqual(['Turn on app lock', 'Turn off app lock']);
    auth.succeed = true;
    expect(await confirmLockChange(auth, false)).toEqual({ ok: true });
  });
});

describe('AppLockGate', () => {
  let db: Database;
  let auth: FakeAuth;
  let appStateHandler: ((s: AppStateStatus) => void) | null;
  let now: number;

  beforeEach(async () => {
    db = await createTestDb();
    auth = new FakeAuth();
    appStateHandler = null;
    now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((
      _: string,
      h: (s: AppStateStatus) => void,
    ) => {
      appStateHandler = h;
      return { remove: jest.fn() };
    }) as unknown as typeof AppState.addEventListener);
  });
  afterEach(() => jest.restoreAllMocks());

  function Toggle() {
    const { update } = useSettings();
    return <Text onPress={() => update({ appLock: true })}>enable-lock</Text>;
  }
  const renderGate = async () =>
    await render(
      <DatabaseProvider getDatabase={() => Promise.resolve(db)}>
        <SettingsProvider>
          <AppLockGate auth={auth}>
            <Text>secret medications</Text>
            <Toggle />
          </AppLockGate>
        </SettingsProvider>
      </DatabaseProvider>,
    );
  const send = async (state: AppStateStatus) => {
    await act(async () => {
      appStateHandler?.(state);
    });
  };

  it('does nothing when the lock is off', async () => {
    await renderGate();
    expect(await screen.findByText('secret medications')).toBeTruthy();
    expect(screen.queryByTestId('lock-screen')).toBeNull();
    expect(auth.prompts).toEqual([]);
  });

  it('locks at launch, prompts right away, and opens after a successful check', async () => {
    await updateSettings(db, { appLock: true });
    await renderGate();
    await waitFor(() => expect(auth.prompts).toEqual(['Unlock OfflineMedsTrack']));
    await waitFor(() => expect(screen.queryByTestId('lock-screen')).toBeNull());
    expect(screen.getByText('secret medications')).toBeTruthy();
  });

  it('stays locked when the check fails, and can be retried', async () => {
    await updateSettings(db, { appLock: true });
    auth.succeed = false;
    await renderGate();
    expect(await screen.findByTestId('lock-screen')).toBeTruthy();
    expect(await screen.findByText("Couldn't verify it's you. Try again.")).toBeTruthy();

    auth.succeed = true;
    await fireEvent.press(screen.getByText('Unlock'));
    await waitFor(() => expect(screen.queryByTestId('lock-screen')).toBeNull());
  });

  it('covers the app while inactive, and locks again after a long time away', async () => {
    await updateSettings(db, { appLock: true });
    await renderGate();
    await waitFor(() => expect(screen.queryByTestId('lock-screen')).toBeNull());

    await send('inactive');
    expect(screen.getByTestId('privacy-cover')).toBeTruthy();
    await send('active');
    expect(screen.queryByTestId('privacy-cover')).toBeNull();
    expect(screen.queryByTestId('lock-screen')).toBeNull(); // only inactive: no re-lock

    await send('background');
    now += 5_000;
    auth.succeed = false;
    await send('active');
    expect(screen.queryByTestId('lock-screen')).toBeNull(); // short absence: still unlocked

    await send('background');
    now += LOCK_GRACE_MS + 1;
    await send('active');
    expect(await screen.findByTestId('lock-screen')).toBeTruthy();
  });

  it('does not lock you out right after you turn the lock on in Settings', async () => {
    await renderGate();
    await fireEvent.press(await screen.findByText('enable-lock'));
    await waitFor(() => expect(screen.queryByTestId('privacy-cover')).toBeNull());
    expect(screen.queryByTestId('lock-screen')).toBeNull();
    expect(screen.getByText('secret medications')).toBeTruthy();
  });
});
