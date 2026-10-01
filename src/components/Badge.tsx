import { StyleSheet, View } from 'react-native';

import { AppText } from './AppText';
import { spacing, usePalette } from './theme';

interface BadgeProps {
  label: string;
  tone?: 'warning' | 'info';
  testID?: string;
}

/** A small status pill. The text carries the meaning; color only reinforces it. */
export function Badge({ label, tone = 'info', testID }: BadgeProps) {
  const palette = usePalette();
  const background = tone === 'warning' ? palette.warningBackground : palette.infoBackground;
  const color = tone === 'warning' ? palette.warningText : palette.infoText;
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={label}
      style={[styles.badge, { backgroundColor: background, borderColor: color }]}
    >
      <AppText variant="caption" color={color} style={styles.text}>
        {tone === 'warning' ? '⚠ ' : ''}
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  text: { fontWeight: '700' },
});
