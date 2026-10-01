import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { useDatabase } from '@/db/DatabaseProvider';
import type { Database } from '@/db/types';

export interface LoadState<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/** Runs `load` whenever the screen gains focus (so lists refresh after add/edit) and on `reload`. */
export function useLoad<T>(load: (db: Database) => Promise<T>): LoadState<T> {
  const getDatabase = useDatabase();
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      getDatabase()
        .then(load)
        .then((result) => {
          if (cancelled) return;
          setData(result);
          setError(null);
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(e instanceof Error ? e.message : 'Something went wrong.');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
      // `nonce` re-runs the effect on demand.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [getDatabase, load, nonce]),
  );

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, reload };
}
