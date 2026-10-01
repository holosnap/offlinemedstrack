import { createContext, useContext, type ReactNode } from 'react';

import type { Database } from './types';

type GetDatabase = () => Promise<Database>;

const DatabaseContext = createContext<GetDatabase | null>(null);

/** Supplies the database opener to the tree (the real one in the app, an in-memory one in tests). */
export function DatabaseProvider({
  getDatabase,
  children,
}: {
  getDatabase: GetDatabase;
  children: ReactNode;
}) {
  return <DatabaseContext.Provider value={getDatabase}>{children}</DatabaseContext.Provider>;
}

export function useDatabase(): GetDatabase {
  const getDatabase = useContext(DatabaseContext);
  if (!getDatabase) throw new Error('useDatabase must be used inside <DatabaseProvider>');
  return getDatabase;
}
