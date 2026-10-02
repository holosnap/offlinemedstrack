import { Redirect, Tabs } from 'expo-router';

import { useSettings } from '@/features/settings/SettingsProvider';

export default function TabsLayout() {
  const { settings, ready } = useSettings();
  if (!ready) return null;
  // First run: the introduction comes before anything else.
  if (!settings.onboardingComplete) return <Redirect href="/onboarding" />;

  return (
    <Tabs
      screenOptions={{
        headerTitleStyle: { fontSize: 20 },
        tabBarLabelStyle: { fontSize: 16, fontWeight: '600' },
        tabBarIconStyle: { display: 'none' },
        tabBarItemStyle: { justifyContent: 'center' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Today' }} />
      <Tabs.Screen name="history" options={{ title: 'History' }} />
      <Tabs.Screen name="meds" options={{ title: 'Medications' }} />
      <Tabs.Screen name="refills" options={{ title: 'Refills' }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
    </Tabs>
  );
}
