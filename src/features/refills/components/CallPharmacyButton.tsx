import { useState } from 'react';
import { Linking, View } from 'react-native';

import { AppText, Button, usePalette } from '@/components';
import { phoneToTelUrl } from '@/lib/format';

/** Dials the stored pharmacy number. Renders nothing when there is no usable number. */
export function CallPharmacyButton({
  phone,
  pharmacyName,
}: {
  phone: string | null | undefined;
  pharmacyName?: string | null;
}) {
  const palette = usePalette();
  const [error, setError] = useState<string | null>(null);
  const url = phoneToTelUrl(phone);
  if (!url) return null;

  const call = async () => {
    setError(null);
    try {
      await Linking.openURL(url);
    } catch {
      setError(`Couldn't start the call. The number is ${phone}.`);
    }
  };

  return (
    <View style={{ gap: 8 }}>
      <Button
        label="Call pharmacy"
        variant="secondary"
        accessibilityHint={`Calls ${pharmacyName ? pharmacyName : 'the pharmacy'} at ${phone}`}
        onPress={call}
      />
      {error ? (
        <AppText color={palette.danger} accessibilityLiveRegion="assertive">
          {error}
        </AppText>
      ) : null}
    </View>
  );
}
