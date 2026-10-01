import { useLocalSearchParams } from 'expo-router';

import { MedicationFormScreen } from '@/features/medications/screens/MedicationFormScreen';

export default function EditMedicationRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <MedicationFormScreen medicationId={Number(id)} />;
}
