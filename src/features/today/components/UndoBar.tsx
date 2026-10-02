import { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';

import { AppText, Button, radius, spacing, usePalette } from '@/components';
import type { UndoState } from '../useTodayActions';

const UNDO_VISIBLE_MS = 8000;

/**
 * "Marked taken · Undo" bar for accidental taps. It disappears on its own after a few seconds, but
 * not for screen-reader users, who need longer to find it: for them it stays until dismissed.
 */
export function UndoBar({ undo, onDismiss }: { undo: UndoState | null; onDismiss: () => void }) {
  const palette = usePalette();
  const [screenReader, setScreenReader] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isScreenReaderEnabled?.()
      .then((enabled) => {
        if (!cancelled) setScreenReader(enabled);
      })
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener?.('screenReaderChanged', setScreenReader);
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, []);

  useEffect(() => {
    if (!undo || screenReader) return;
    const timer = setTimeout(onDismiss, UNDO_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [undo, onDismiss, screenReader]);

  if (!undo) return null;
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.bar, { backgroundColor: palette.surface, borderColor: palette.border }]}
    >
      <AppText style={styles.message}>{undo.message}</AppText>
      <Button label="Undo" onPress={undo.run} accessibilityHint="Reverses the last change" />
      {screenReader ? <Button label="Dismiss" variant="secondary" onPress={onDismiss} /> : null}
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
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.md,
  },
  message: { flex: 1, minWidth: 160 },
});
