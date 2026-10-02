import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import TabsLayout from '../../app/(tabs)/_layout';
import { DEFAULT_SETTINGS } from '@/features/settings/settings';
import * as provider from '@/features/settings/SettingsProvider';

jest.mock('expo-router', () => {
  const { Text: T } = jest.requireActual<typeof import('react-native')>('react-native');
  function Tabs({ children }: { children: React.ReactNode }) {
    return <T>tabs{children}</T>;
  }
  Tabs.Screen = function Screen() {
    return null;
  };
  return {
    Tabs,
    Redirect: ({ href }: { href: string }) => <T>{`redirect:${href}`}</T>,
  };
});
jest.mock('@/features/settings/SettingsProvider');

const useSettings = jest.mocked(provider.useSettings);
const value = (over: Partial<typeof DEFAULT_SETTINGS>, ready = true) =>
  useSettings.mockReturnValue({
    settings: { ...DEFAULT_SETTINGS, ...over },
    ready,
    update: jest.fn(),
    reload: jest.fn(),
  });

describe('tabs layout', () => {
  it('sends first-time users to onboarding', async () => {
    value({ onboardingComplete: false });
    await render(<TabsLayout />);
    expect(screen.getByText('redirect:/onboarding')).toBeTruthy();
  });

  it('shows the tabs once onboarding is done', async () => {
    value({ onboardingComplete: true });
    await render(<TabsLayout />);
    expect(screen.queryByText(/redirect/)).toBeNull();
    expect(screen.getByText(/tabs/)).toBeTruthy();
  });

  it('waits for the settings to load before deciding', async () => {
    value({ onboardingComplete: false }, false);
    await render(
      <>
        <TabsLayout />
        <Text>after</Text>
      </>,
    );
    expect(screen.queryByText(/redirect/)).toBeNull();
    expect(screen.queryByText(/tabs/)).toBeNull();
  });
});
