import * as LocalAuthentication from 'expo-local-authentication';

export type AuthStatus = 'ready' | 'no_hardware' | 'not_enrolled';

/** The device's biometric / passcode check, behind an interface so logic can be tested. */
export interface AuthPort {
  status(): Promise<AuthStatus>;
  /** Shows the system prompt (Face ID, fingerprint, or the device passcode as a fallback). */
  authenticate(promptMessage: string): Promise<boolean>;
}

export const expoAuth: AuthPort = {
  async status() {
    try {
      const level = await LocalAuthentication.getEnrolledLevelAsync();
      if (level !== LocalAuthentication.SecurityLevel.NONE) return 'ready';
      return (await LocalAuthentication.hasHardwareAsync()) ? 'not_enrolled' : 'no_hardware';
    } catch {
      return 'no_hardware';
    }
  },

  async authenticate(promptMessage) {
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage,
        // Let people fall back to the device passcode so a broken sensor can't lock them out.
        disableDeviceFallback: false,
      });
      return result.success;
    } catch {
      return false;
    }
  },
};
