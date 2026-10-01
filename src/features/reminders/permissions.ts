import * as Notifications from 'expo-notifications';
import { Linking } from 'react-native';

import { expoPort, toPermissionState } from './expoPort';
import type { PermissionState } from './ports';

export const getPermissionState = (): Promise<PermissionState> => expoPort.getPermissionState();

/** Shows the system prompt (only call this after the explanation screen). */
export async function requestPermission(): Promise<PermissionState> {
  try {
    return toPermissionState(await Notifications.requestPermissionsAsync());
  } catch {
    return 'denied';
  }
}

export function openNotificationSettings(): Promise<void> {
  return Linking.openSettings();
}
