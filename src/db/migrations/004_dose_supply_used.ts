import type { Migration } from '../migrate';

export const doseSupplyUsed: Migration = {
  version: 4,
  name: 'dose_supply_used',
  async up(db) {
    // How much supply a taken dose actually used. It is less than `quantity` when the recorded
    // supply ran out first (supply never goes below zero), so undoing or editing the dose later
    // gives back exactly what was used. NULL (older rows) means "the dose quantity".
    await db.execAsync(`
      ALTER TABLE dose_logs
        ADD COLUMN supply_used REAL CHECK (supply_used IS NULL OR supply_used >= 0);
    `);
  },
};
