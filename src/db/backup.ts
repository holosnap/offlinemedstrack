import { migrations } from './migrations';
import type { Database, SqlValue } from './types';

/** The schema version a backup is written for; equals the number of migrations. */
export const BACKUP_SCHEMA_VERSION = migrations.length;

type ColumnType = 'int' | 'real' | 'text';
interface Column {
  name: string;
  type: ColumnType;
  nullable?: boolean;
}
export interface TableSpec {
  name: string;
  columns: readonly Column[];
  /** Foreign keys: column -> table it must reference (checked before restoring). */
  references?: Readonly<Record<string, string>>;
  /** The column(s) that identify a row, for duplicate and reference checks. */
  key: string;
}

const text = (name: string, nullable = false): Column => ({ name, type: 'text', nullable });
const int = (name: string, nullable = false): Column => ({ name, type: 'int', nullable });
const real = (name: string, nullable = false): Column => ({ name, type: 'real', nullable });

/** Every table that holds the person's data, parents before children (insert order). */
export const BACKUP_TABLES: readonly TableSpec[] = [
  {
    name: 'medications',
    key: 'id',
    columns: [
      int('id'),
      text('name'),
      real('dosage_amount'),
      text('dosage_unit'),
      text('form'),
      text('instructions', true),
      text('color', true),
      text('icon', true),
      int('active'),
      text('created_at'),
      text('updated_at'),
    ],
  },
  {
    name: 'schedules',
    key: 'id',
    references: { medication_id: 'medications' },
    columns: [
      int('id'),
      int('medication_id'),
      text('type'),
      text('times'),
      text('days_of_week', true),
      int('interval_days', true),
      text('start_date'),
      text('end_date', true),
      real('dose_quantity'),
      text('created_at'),
      text('updated_at'),
    ],
  },
  {
    name: 'dose_logs',
    key: 'id',
    references: { medication_id: 'medications' },
    columns: [
      int('id'),
      int('medication_id'),
      text('scheduled_for'),
      text('status'),
      text('acted_at', true),
      real('quantity', true),
      real('supply_used', true),
      text('note', true),
      text('created_at'),
      text('updated_at'),
    ],
  },
  {
    name: 'inventory',
    key: 'medication_id',
    references: { medication_id: 'medications' },
    columns: [
      int('medication_id'),
      real('current_quantity'),
      text('unit'),
      real('refill_threshold', true),
      text('refill_threshold_unit', true),
      int('refills_remaining', true),
      text('pharmacy_name', true),
      text('pharmacy_phone', true),
      text('prescription_number', true),
      text('updated_at'),
    ],
  },
  {
    name: 'refill_events',
    key: 'id',
    references: { medication_id: 'medications' },
    columns: [
      int('id'),
      int('medication_id'),
      text('date'),
      real('quantity_added'),
      text('note', true),
      text('created_at'),
    ],
  },
  {
    name: 'refill_alerts',
    key: 'medication_id',
    references: { medication_id: 'medications' },
    columns: [
      int('medication_id'),
      text('low_since', true),
      real('low_quantity', true),
      text('doctor_since', true),
    ],
  },
];

/** App preferences that travel with a backup. Device-specific ones (lock, onboarding) do not. */
export const BACKUP_SETTING_KEYS = [
  'missedAfterMinutes',
  'snoozeMinutes',
  'refillThresholdValue',
  'refillThresholdUnit',
  'soundEnabled',
  'timeFormat',
  'theme',
  'groupBy',
] as const;

export type BackupRow = Record<string, SqlValue>;
export interface BackupData {
  tables: Record<string, BackupRow[]>;
  settings: Record<string, string>;
}

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;
const columnList = (spec: TableSpec) => spec.columns.map((c) => quote(c.name)).join(', ');

/** Reads every data table (and the portable settings) as plain rows. */
export async function readBackupData(db: Database): Promise<BackupData> {
  const tables: Record<string, BackupRow[]> = {};
  for (const spec of BACKUP_TABLES) {
    tables[spec.name] = await db.getAllAsync<BackupRow>(
      `SELECT ${columnList(spec)} FROM ${spec.name} ORDER BY ${quote(spec.key)}`,
    );
  }
  const rows = await db.getAllAsync<{ key: string; value: string }>(
    'SELECT key, value FROM settings',
  );
  const settings: Record<string, string> = {};
  for (const row of rows) {
    if ((BACKUP_SETTING_KEYS as readonly string[]).includes(row.key)) settings[row.key] = row.value;
  }
  return { tables, settings };
}

/**
 * Replaces all of the person's data with `data`, in one transaction: if any row is rejected by the
 * database, nothing changes. Device-specific settings (app lock, onboarding) are left as they are.
 */
export async function replaceBackupData(db: Database, data: BackupData): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (const spec of [...BACKUP_TABLES].reverse()) {
      await db.runAsync(`DELETE FROM ${spec.name}`);
    }
    const placeholders = BACKUP_SETTING_KEYS.map(() => '?').join(', ');
    await db.runAsync(`DELETE FROM settings WHERE key IN (${placeholders})`, [
      ...BACKUP_SETTING_KEYS,
    ]);

    for (const spec of BACKUP_TABLES) {
      const sql = `INSERT INTO ${spec.name} (${columnList(spec)}) VALUES (${spec.columns.map(() => '?').join(', ')})`;
      for (const row of data.tables[spec.name] ?? []) {
        await db.runAsync(
          sql,
          spec.columns.map((c) => row[c.name] ?? null),
        );
      }
    }
    for (const [key, value] of Object.entries(data.settings)) {
      await db.runAsync('INSERT INTO settings (key, value) VALUES (?, ?)', [key, value]);
    }
  });
}
