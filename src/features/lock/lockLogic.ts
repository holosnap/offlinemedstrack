import type { AuthPort } from './auth';

/** Leaving the app for less than this doesn't lock it (e.g. a system permission dialog). */
export const LOCK_GRACE_MS = 30_000;

/** Whether returning to the app should show the lock screen. */
export function shouldRelock(input: {
  enabled: boolean;
  /** When the app was sent to the background; null if it wasn't (e.g. only briefly inactive). */
  backgroundedAt: number | null;
  now: number;
  graceMs?: number;
}): boolean {
  if (!input.enabled || input.backgroundedAt === null) return false;
  return input.now - input.backgroundedAt >= (input.graceMs ?? LOCK_GRACE_MS);
}

export const AUTH_UNAVAILABLE_MESSAGES = {
  no_hardware:
    "This device doesn't have Face ID, a fingerprint sensor, or a screen lock that the app can use.",
  not_enrolled:
    'Set up Face ID, a fingerprint, or a screen lock in your phone’s settings first, then try again.',
} as const;

export type EnableLockResult = { ok: true } | { ok: false; message: string };

/** Turning the lock on or off requires proving it's you, so it can't be done on an unlocked phone by anyone. */
export async function confirmLockChange(
  auth: AuthPort,
  enabling: boolean,
): Promise<EnableLockResult> {
  if (enabling) {
    const status = await auth.status();
    if (status !== 'ready') return { ok: false, message: AUTH_UNAVAILABLE_MESSAGES[status] };
  }
  const ok = await auth.authenticate(enabling ? 'Turn on app lock' : 'Turn off app lock');
  return ok
    ? { ok: true }
    : { ok: false, message: "Couldn't verify it's you, so the lock was not changed." };
}
