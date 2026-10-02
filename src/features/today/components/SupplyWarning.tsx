import { StyleSheet, View } from 'react-native';

import { AppText, Badge, Button, radius, spacing, usePalette } from '@/components';

/** Shown when a dose was larger than the recorded supply (supply stops at zero). */
export function SupplyWarning({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  const palette = usePalette();
  return (
    <View
      testID="supply-warning"
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      style={[
        styles.box,
        { backgroundColor: palette.warningBackground, borderColor: palette.warningText },
      ]}
    >
      <Badge tone="warning" label="Check your supply" />
      <AppText color={palette.warningText}>{message}</AppText>
      <Button label="Dismiss" variant="secondary" onPress={onDismiss} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 2, borderRadius: radius, padding: spacing.md, gap: spacing.sm },
});
