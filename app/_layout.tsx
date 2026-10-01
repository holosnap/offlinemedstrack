import { Stack } from 'expo-router';

import { getDatabase } from '@/db';
import { DatabaseProvider } from '@/db/DatabaseProvider';
import '@/features/reminders/backgroundTask';
import { ReminderLifecycle } from '@/features/reminders/ReminderLifecycle';

export default function RootLayout() {
  return (
    <DatabaseProvider getDatabase={getDatabase}>
      <ReminderLifecycle />
      <Stack
        screenOptions={{
          headerTitleStyle: { fontSize: 20 },
          headerBackButtonDisplayMode: 'minimal',
        }}
      >
        <Stack.Screen name="index" options={{ title: 'My medications' }} />
        <Stack.Screen name="reminders/permission" options={{ title: 'Reminders' }} />
      </Stack>
    </DatabaseProvider>
  );
}
