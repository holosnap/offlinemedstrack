import type { Migration } from '../migrate';

export const settings: Migration = {
  version: 2,
  name: 'settings',
  async up(db) {
    await db.execAsync(`
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  },
};
