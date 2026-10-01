/// <reference types="node" />
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';

import { migrate } from '@/db/migrate';
import type { Database, RunResult, SqlValue } from '@/db/types';

// Jest's resolver doesn't know the `node:sqlite` builtin yet, so load it through the process.
const { DatabaseSync: SqliteDatabase } = process.getBuiltinModule('node:sqlite');

/** Adapts Node's built-in SQLite to the `Database` interface that expo-sqlite also satisfies. */
class NodeSqliteDatabase implements Database {
  constructor(private readonly sqlite: DatabaseSync) {}

  async execAsync(source: string): Promise<void> {
    this.sqlite.exec(source);
  }

  async runAsync(source: string, params: SqlValue[] = []): Promise<RunResult> {
    const result = this.sqlite.prepare(source).run(...(params as SQLInputValue[]));
    return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
  }

  async getFirstAsync<T>(source: string, params: SqlValue[] = []): Promise<T | null> {
    const row = this.sqlite.prepare(source).get(...(params as SQLInputValue[]));
    return row ? ({ ...row } as T) : null;
  }

  async getAllAsync<T>(source: string, params: SqlValue[] = []): Promise<T[]> {
    return this.sqlite
      .prepare(source)
      .all(...(params as SQLInputValue[]))
      .map((r) => ({ ...r }) as T);
  }

  async withTransactionAsync(task: () => Promise<void>): Promise<void> {
    this.sqlite.exec('BEGIN');
    try {
      await task();
      this.sqlite.exec('COMMIT');
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }
}

/** A fresh in-memory database with foreign keys on, optionally migrated to the latest schema. */
export async function createTestDb(options: { migrate?: boolean } = {}): Promise<Database> {
  const sqlite = new SqliteDatabase(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  const db = new NodeSqliteDatabase(sqlite);
  if (options.migrate !== false) await migrate(db);
  return db;
}
