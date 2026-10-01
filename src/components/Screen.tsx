import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';

import { spacing, usePalette } from './theme';

interface ScreenProps {
  children: ReactNode;
  /** Rendered below the scrolling content, e.g. a primary action that should stay visible. */
  footer?: ReactNode;
  scrollRef?: React.RefObject<ScrollView | null>;
}

export function Screen({ children, footer, scrollRef }: ScreenProps) {
  const palette = usePalette();
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.flex, { backgroundColor: palette.background }]}
    >
      <ScrollView
        ref={scrollRef}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
      >
        {children}
      </ScrollView>
      {footer}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xl },
});
