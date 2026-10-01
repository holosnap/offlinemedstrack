import { useLocalSearchParams } from 'expo-router';

import { RecordRefillScreen } from '@/features/refills/screens/RecordRefillScreen';

export default function RecordRefillRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <RecordRefillScreen medicationId={Number(id)} />;
}
