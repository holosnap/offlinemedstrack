import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, StyleSheet, View } from 'react-native';

import { AppText, Button, spacing, usePalette } from '@/components';
import { useSettings } from '@/features/settings/SettingsProvider';
import { expoAuth, type AuthPort } from './auth';
import { shouldRelock } from './lockLogic';

const PROMPT = 'Unlock OfflineMedsTrack';

/**
 * Covers the app with a lock screen at launch and after it has been in the background for a while,
 * when app lock is on. While the app is inactive/in the background it is also covered so the app
 * switcher doesn't show health data. Turning the lock on or off in Settings (which already asked
 * for authentication) does not lock the person out of the session they are in.
 */
export function AppLockGate({
  children,
  auth = expoAuth,
}: {
  children: ReactNode;
  auth?: AuthPort;
}) {
  const palette = usePalette();
  const { settings, ready } = useSettings();
  const enabled = settings.appLock;
  const [unlocked, setUnlocked] = useState(false);
  const [covered, setCovered] = useState(false);
  const [failed, setFailed] = useState(false);
  const [tracked, setTracked] = useState<boolean | null>(null);
  const backgroundedAt = useRef<number | null>(null);

  // Adjust state while rendering when the setting changes after the first read.
  if (ready && tracked === null) setTracked(enabled);
  else if (ready && tracked !== enabled) {
    setTracked(enabled);
    setUnlocked(true);
  }

  useEffect(() => {
    if (!enabled) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        setCovered(false);
        if (shouldRelock({ enabled, backgroundedAt: backgroundedAt.current, now: Date.now() })) {
          setUnlocked(false);
          setFailed(false);
        }
        backgroundedAt.current = null;
      } else {
        setCovered(true);
        if (state === 'background' && backgroundedAt.current === null) {
          backgroundedAt.current = Date.now();
        }
      }
    });
    return () => sub.remove();
  }, [enabled]);

  const showLock = ready && enabled && !unlocked;

  // Ask right away whenever the lock screen appears.
  useEffect(() => {
    if (!showLock) return;
    let cancelled = false;
    auth.authenticate(PROMPT).then((ok) => {
      if (cancelled) return;
      if (ok) setUnlocked(true);
      else setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [showLock, auth]);

  const unlock = useCallback(async () => {
    setFailed(false);
    if (await auth.authenticate(PROMPT)) setUnlocked(true);
    else setFailed(true);
  }, [auth]);

  if (!ready) return <View style={[styles.fill, { backgroundColor: palette.background }]} />;

  return (
    <View style={styles.fill}>
      <View
        style={styles.fill}
        accessibilityElementsHidden={showLock}
        importantForAccessibility={showLock ? 'no-hide-descendants' : 'auto'}
      >
        {children}
      </View>
      {showLock ? (
        <View
          testID="lock-screen"
          style={[styles.overlay, { backgroundColor: palette.background }]}
          accessibilityViewIsModal
        >
          <AppText variant="title">OfflineMedsTrack is locked</AppText>
          <AppText muted>Your medication information is private. Unlock to continue.</AppText>
          {failed ? (
            <AppText color={palette.danger} accessibilityLiveRegion="assertive">
              {"Couldn't verify it's you. Try again."}
            </AppText>
          ) : null}
          <Button label="Unlock" onPress={unlock} />
        </View>
      ) : enabled && covered ? (
        <View
          testID="privacy-cover"
          style={[styles.overlay, { backgroundColor: palette.background }]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  overlay: {
    ...StyleSheet.absoluteFill,
    padding: spacing.lg,
    gap: spacing.md,
    justifyContent: 'center',
  },
});
