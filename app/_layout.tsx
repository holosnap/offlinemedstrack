import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'react-native';

import { usePalette } from '@/components';
import { getDatabase } from '@/db';
import { DatabaseProvider } from '@/db/DatabaseProvider';
import { AppLockGate } from '@/features/lock/AppLockGate';
import '@/features/reminders/backgroundTask';
import { ReminderLifecycle } from '@/features/reminders/ReminderLifecycle';
import { SettingsProvider } from '@/features/settings/SettingsProvider';

function Navigation() {
  const dark = useColorScheme() === 'dark';
  const palette = usePalette();
  const base = dark ? DarkTheme : DefaultTheme;
  // Headers and tab bars follow the same palette (and light/dark choice) as the screens.
  const theme = {
    ...base,
    colors: {
      ...base.colors,
      background: palette.background,
      card: palette.surface,
      text: palette.text,
      border: palette.border,
      primary: palette.primary,
    },
  };
  return (
    <ThemeProvider value={theme}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <ReminderLifecycle />
      <Stack
        screenOptions={{
          headerTitleStyle: { fontSize: 20 },
          headerBackButtonDisplayMode: 'minimal',
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="reminders/permission" options={{ title: 'Reminders' }} />
      </Stack>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <DatabaseProvider getDatabase={getDatabase}>
      <SettingsProvider>
        <AppLockGate>
          <Navigation />
        </AppLockGate>
      </SettingsProvider>
    </DatabaseProvider>
  );
}
