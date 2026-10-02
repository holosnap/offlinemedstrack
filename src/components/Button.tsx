import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from './AppText';
import { minTouchTarget, radius, spacing, usePalette } from './theme';

interface ButtonProps {
  label: string;
  /**
   * What a screen reader announces, when the visible label needs context (e.g. "Taken" on a list of
   * doses becomes "Taken, Metformin 8:00 AM"). Defaults to the label.
   */
  accessibilityLabel?: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  accessibilityHint?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export function Button({
  label,
  accessibilityLabel,
  onPress,
  variant = 'primary',
  disabled = false,
  accessibilityHint,
  testID,
  style,
}: ButtonProps) {
  const palette = usePalette();
  const filled = variant !== 'secondary';
  const background =
    variant === 'primary' ? palette.primary : variant === 'danger' ? palette.danger : 'transparent';
  const textColor =
    variant === 'primary'
      ? palette.onPrimary
      : variant === 'danger'
        ? palette.onDanger
        : palette.primary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: background,
          borderColor: filled ? background : palette.primary,
          opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
        },
        style,
      ]}
    >
      <AppText variant="label" color={textColor} style={styles.label}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: minTouchTarget,
    borderRadius: radius,
    borderWidth: 2,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { textAlign: 'center' },
});
