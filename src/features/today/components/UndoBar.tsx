import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, radius, spacing, usePalette } from '@/components';
import type { UndoState } from '../useTodayActions';

const UNDO_VISIBLE_MS = 8000;

/** "Marked taken · Undo" bar for accidental taps; disappears on its own. */
export function UndoBar({ undo, onDismiss }: { undo: UndoState | null; onDismiss: () => void }) {
  const palette = usePalette();
  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(onDismiss, UNDO_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [undo, onDismiss]);

  if (!undo) return null;
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.bar, { backgroundColor: palette.surface, borderColor: palette.border }]}
    >
      <AppText style={styles.message}>{undo.message}</AppText>
      <Button label="Undo" onPress={undo.run} accessibilityHint="Reverses the last change" />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    margin: spacing.md,
    padding: spacing.md,
    borderRadius: radius,
    borderWidth: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  message: { flex: 1 },
});
