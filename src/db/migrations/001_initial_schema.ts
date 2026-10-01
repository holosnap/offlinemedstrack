import type { Migration } from '../migrate';

export const initialSchema: Migration = {
  version: 1,
  name: 'initial_schema',
  async up(db) {
    await db.execAsync(`
      CREATE TABLE medications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL CHECK (length(trim(name)) > 0),
        dosage_amount REAL NOT NULL CHECK (dosage_amount > 0),
        dosage_unit TEXT NOT NULL CHECK (length(trim(dosage_unit)) > 0),
        form TEXT NOT NULL
          CHECK (form IN ('tablet', 'capsule', 'liquid', 'injection', 'inhaler', 'other')),
        instructions TEXT,
        color TEXT,
        icon TEXT,
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_medications_active ON medications (active);

      CREATE TABLE schedules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        medication_id INTEGER NOT NULL REFERENCES medications (id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('daily', 'weekdays', 'interval', 'as_needed')),
        times TEXT NOT NULL DEFAULT '[]',
        days_of_week TEXT,
        interval_days INTEGER CHECK (interval_days IS NULL OR interval_days >= 1),
        start_date TEXT NOT NULL,
        end_date TEXT,
        dose_quantity REAL NOT NULL CHECK (dose_quantity > 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (end_date IS NULL OR end_date >= start_date)
      );
      CREATE INDEX idx_schedules_medication ON schedules (medication_id);

      CREATE TABLE dose_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        medication_id INTEGER NOT NULL REFERENCES medications (id) ON DELETE CASCADE,
        scheduled_for TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('taken', 'skipped', 'missed', 'snoozed')),
        acted_at TEXT,
        quantity REAL CHECK (quantity IS NULL OR quantity >= 0),
        note TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX uq_dose_logs_medication_scheduled
        ON dose_logs (medication_id, scheduled_for);
      CREATE INDEX idx_dose_logs_scheduled_for ON dose_logs (scheduled_for);

      CREATE TABLE inventory (
        medication_id INTEGER PRIMARY KEY REFERENCES medications (id) ON DELETE CASCADE,
        current_quantity REAL NOT NULL DEFAULT 0 CHECK (current_quantity >= 0),
        unit TEXT NOT NULL,
        refill_threshold REAL CHECK (refill_threshold IS NULL OR refill_threshold >= 0),
        refill_threshold_unit TEXT CHECK (refill_threshold_unit IN ('days', 'count')),
        refills_remaining INTEGER CHECK (refills_remaining IS NULL OR refills_remaining >= 0),
        pharmacy_name TEXT,
        pharmacy_phone TEXT,
        prescription_number TEXT,
        updated_at TEXT NOT NULL,
        CHECK ((refill_threshold IS NULL) = (refill_threshold_unit IS NULL))
      );

      CREATE TABLE refill_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        medication_id INTEGER NOT NULL REFERENCES medications (id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        quantity_added REAL NOT NULL CHECK (quantity_added > 0),
        note TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_refill_events_medication_date ON refill_events (medication_id, date);
    `);
  },
};
