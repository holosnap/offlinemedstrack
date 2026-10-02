import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from './AppText';
import { radius, spacing, usePalette } from './theme';

interface CardProps {
  title?: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Card({ title, children, style, testID }: CardProps) {
  const palette = usePalette();
  return (
    <View testID={testID} style={[styles.card, { backgroundColor: palette.surface }, style]}>
      {title ? <AppText variant="heading">{title}</AppText> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius, padding: spacing.md, gap: spacing.md },
});
