import { Stack } from 'expo-router';

import { getDatabase } from '@/db';
import { DatabaseProvider } from '@/db/DatabaseProvider';

export default function RootLayout() {
  return (
    <DatabaseProvider getDatabase={getDatabase}>
      <Stack
        screenOptions={{
          headerTitleStyle: { fontSize: 20 },
          headerBackButtonDisplayMode: 'minimal',
        }}
      >
        <Stack.Screen name="index" options={{ title: 'My medications' }} />
      </Stack>
    </DatabaseProvider>
  );
}
