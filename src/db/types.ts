/**
 * The subset of expo-sqlite's `SQLiteDatabase` that the data layer uses. Repositories depend on
 * this interface (not on expo-sqlite) so tests can run against an in-memory SQLite in Node.
 * `SQLiteDatabase` satisfies it structurally.
 */
export type SqlValue = string | number | null;

export interface RunResult {
  lastInsertRowId: number;
  changes: number;
}

export interface Database {
  execAsync(source: string): Promise<void>;
  runAsync(source: string): Promise<RunResult>;
  runAsync(source: string, params: SqlValue[]): Promise<RunResult>;
  getFirstAsync<T>(source: string): Promise<T | null>;
  getFirstAsync<T>(source: string, params: SqlValue[]): Promise<T | null>;
  getAllAsync<T>(source: string): Promise<T[]>;
  getAllAsync<T>(source: string, params: SqlValue[]): Promise<T[]>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}
