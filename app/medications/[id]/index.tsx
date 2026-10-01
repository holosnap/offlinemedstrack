import { useLocalSearchParams } from 'expo-router';

import { MedicationDetailScreen } from '@/features/medications/screens/MedicationDetailScreen';

export default function MedicationDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <MedicationDetailScreen medicationId={Number(id)} />;
}
