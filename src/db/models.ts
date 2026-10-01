import type { LocalDate, LocalTime, UtcIso } from '@/lib/time';

export const MEDICATION_FORMS = [
  'tablet',
  'capsule',
  'liquid',
  'injection',
  'inhaler',
  'other',
] as const;
export type MedicationForm = (typeof MEDICATION_FORMS)[number];

export const SCHEDULE_TYPES = ['daily', 'weekdays', 'interval', 'as_needed'] as const;
export type ScheduleType = (typeof SCHEDULE_TYPES)[number];

export const DOSE_STATUSES = ['taken', 'skipped', 'missed', 'snoozed'] as const;
export type DoseStatus = (typeof DOSE_STATUSES)[number];

export const REFILL_THRESHOLD_UNITS = ['days', 'count'] as const;
export type RefillThresholdUnit = (typeof REFILL_THRESHOLD_UNITS)[number];

export interface Medication {
  id: number;
  name: string;
  dosageAmount: number;
  dosageUnit: string;
  form: MedicationForm;
  instructions: string | null;
  color: string | null;
  icon: string | null;
  active: boolean;
  createdAt: UtcIso;
  updatedAt: UtcIso;
}

export interface Schedule {
  id: number;
  medicationId: number;
  type: ScheduleType;
  /** Local wall-clock times (`HH:mm`), sorted. Empty for `as_needed`. */
  times: LocalTime[];
  /** 0 = Sunday … 6 = Saturday. Only for `weekdays`. */
  daysOfWeek: number[] | null;
  /** Only for `interval`: every N days counted from `startDate`. */
  intervalDays: number | null;
  startDate: LocalDate;
  endDate: LocalDate | null;
  /** Quantity (in the medication's form, e.g. tablets) taken per intake. */
  doseQuantity: number;
  createdAt: UtcIso;
  updatedAt: UtcIso;
}

export interface DoseLog {
  id: number;
  medicationId: number;
  scheduledFor: UtcIso;
  status: DoseStatus;
  actedAt: UtcIso | null;
  quantity: number | null;
  note: string | null;
  createdAt: UtcIso;
  updatedAt: UtcIso;
}

export interface Inventory {
  medicationId: number;
  currentQuantity: number;
  unit: string;
  /** Together with the unit: refill when supply drops to this many days or this count. */
  refillThreshold: number | null;
  refillThresholdUnit: RefillThresholdUnit | null;
  refillsRemaining: number | null;
  pharmacyName: string | null;
  pharmacyPhone: string | null;
  prescriptionNumber: string | null;
  updatedAt: UtcIso;
}

export interface RefillEvent {
  id: number;
  medicationId: number;
  date: UtcIso;
  quantityAdded: number;
  note: string | null;
  createdAt: UtcIso;
}
