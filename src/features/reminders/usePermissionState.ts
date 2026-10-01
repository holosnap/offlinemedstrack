import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { getPermissionState } from './permissions';
import type { PermissionState } from './ports';

/** Current notification permission, refreshed on focus and when returning from system Settings. */
export function usePermissionState(): PermissionState | null {
  const [state, setState] = useState<PermissionState | null>(null);
  const refresh = useCallback(() => {
    getPermissionState().then(setState, () => setState('denied'));
  }, []);
  useFocusEffect(refresh);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s === 'active' && refresh());
    return () => sub.remove();
  }, [refresh]);
  return state;
}
