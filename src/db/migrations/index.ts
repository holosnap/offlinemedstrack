import type { Migration } from '../migrate';
import { initialSchema } from './001_initial_schema';
import { settings } from './002_settings';
import { refillAlerts } from './003_refill_alerts';
import { doseSupplyUsed } from './004_dose_supply_used';

/** Append new migrations to the end. Never edit or reorder ones that have shipped. */
export const migrations: readonly Migration[] = [
  initialSchema,
  settings,
  refillAlerts,
  doseSupplyUsed,
];
