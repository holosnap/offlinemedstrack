import type { Migration } from '../migrate';

export const refillAlerts: Migration = {
  version: 3,
  name: 'refill_alerts',
  async up(db) {
    // Remembers where each medication is in its refill-reminder cycle, so reminders are sent a
    // bounded number of times per low-supply episode instead of on every check.
    await db.execAsync(`
      CREATE TABLE refill_alerts (
        medication_id INTEGER PRIMARY KEY REFERENCES medications (id) ON DELETE CASCADE,
        low_since TEXT,
        low_quantity REAL,
        doctor_since TEXT
      );
    `);
  },
};
