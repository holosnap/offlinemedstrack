import type {
  Inventory,
  Medication,
  MedicationForm,
  RefillThresholdUnit,
  Schedule,
  ScheduleType,
} from '@/db/models';
import type { NewInventory, NewMedication, NewSchedule } from '@/db/repositories';
import { isLocalDate, localDateOf, parseTimeInput } from '@/lib/time';

export interface FormValues {
  name: string;
  dosageAmount: string;
  dosageUnit: string;
  form: MedicationForm;
  instructions: string;
  scheduleType: ScheduleType;
  /** What the person typed, one entry per row; parsed on submit. */
  times: string[];
  daysOfWeek: number[];
  intervalDays: string;
  startDate: string;
  endDate: string | null;
  doseQuantity: string;
  currentQuantity: string;
  inventoryUnit: string;
  refillThreshold: string;
  refillThresholdUnit: RefillThresholdUnit;
}

/** Keys are field names; per-row time errors use `time-<index>`. */
export type FormErrors = Record<string, string>;

export interface ValidatedMedication {
  medication: NewMedication;
  schedule: Omit<NewSchedule, 'medicationId'>;
  inventory: Omit<NewInventory, 'medicationId'>;
}

export type ValidationResult =
  { ok: true; value: ValidatedMedication } | { ok: false; errors: FormErrors };

export const FORM_UNIT_DEFAULTS: Record<MedicationForm, string> = {
  tablet: 'tablets',
  capsule: 'capsules',
  liquid: 'mL',
  injection: 'injections',
  inhaler: 'puffs',
  other: 'units',
};

export function emptyFormValues(now: Date = new Date()): FormValues {
  return {
    name: '',
    dosageAmount: '',
    dosageUnit: 'mg',
    form: 'tablet',
    instructions: '',
    scheduleType: 'daily',
    times: ['08:00'],
    daysOfWeek: [],
    intervalDays: '2',
    startDate: localDateOf(now),
    endDate: null,
    doseQuantity: '1',
    currentQuantity: '',
    inventoryUnit: FORM_UNIT_DEFAULTS.tablet,
    refillThreshold: '7',
    refillThresholdUnit: 'days',
  };
}

/** `20:30` → `8:30 PM`: locale-independent so it always round-trips through `parseTimeInput`. */
function toTimeInput(time: string): string {
  const [hour, minute] = time.split(':').map(Number);
  return `${hour % 12 === 0 ? 12 : hour % 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}

const num = (n: number) => String(Number(n.toFixed(4)));

export function formValuesFromStored(
  medication: Medication,
  schedule: Schedule | null,
  inventory: Inventory | null,
  now: Date = new Date(),
): FormValues {
  const base = emptyFormValues(now);
  return {
    ...base,
    name: medication.name,
    dosageAmount: num(medication.dosageAmount),
    dosageUnit: medication.dosageUnit,
    form: medication.form,
    instructions: medication.instructions ?? '',
    ...(schedule
      ? {
          scheduleType: schedule.type,
          times: schedule.times.length > 0 ? schedule.times.map(toTimeInput) : [''],
          daysOfWeek: schedule.daysOfWeek ?? [],
          intervalDays: String(schedule.intervalDays ?? base.intervalDays),
          startDate: schedule.startDate,
          endDate: schedule.endDate,
          doseQuantity: num(schedule.doseQuantity),
        }
      : {}),
    ...(inventory
      ? {
          currentQuantity: num(inventory.currentQuantity),
          inventoryUnit: inventory.unit,
          refillThreshold: inventory.refillThreshold === null ? '' : num(inventory.refillThreshold),
          refillThresholdUnit: inventory.refillThresholdUnit ?? 'days',
        }
      : { inventoryUnit: FORM_UNIT_DEFAULTS[medication.form] }),
  };
}

/** Accepts `2`, `0.5`, `1,5`; rejects empty, negative, and non-numeric text. */
export function parseNumber(text: string): number | null {
  const trimmed = text.trim().replace(',', '.');
  if (!/^(\d+\.?\d*|\.\d+)$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function positiveNumber(text: string, label: string, errors: FormErrors, key: string) {
  const value = parseNumber(text);
  if (text.trim() === '') errors[key] = `Enter ${label}.`;
  else if (value === null) errors[key] = `${capitalize(label)} must be a number, like 1 or 0.5.`;
  else if (value <= 0) errors[key] = `${capitalize(label)} must be greater than 0.`;
  return value;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function validateForm(values: FormValues): ValidationResult {
  const errors: FormErrors = {};

  const name = values.name.trim();
  if (name === '') errors.name = 'Enter the medication name.';

  const dosageAmount = positiveNumber(values.dosageAmount, 'the strength', errors, 'dosageAmount');
  const dosageUnit = values.dosageUnit.trim();
  if (dosageUnit === '') errors.dosageUnit = 'Enter the strength unit, like mg.';

  const doseQuantity = positiveNumber(
    values.doseQuantity,
    'how much you take each time',
    errors,
    'doseQuantity',
  );

  const times: string[] = [];
  if (values.scheduleType !== 'as_needed') {
    values.times.forEach((text, index) => {
      if (text.trim() === '') return; // blank rows are ignored
      const parsed = parseTimeInput(text);
      if (parsed === null) errors[`time-${index}`] = 'Enter a time like 8:00 AM or 20:30.';
      else times.push(parsed);
    });
    if (times.length === 0 && !Object.keys(errors).some((k) => k.startsWith('time-'))) {
      errors.times = 'Add at least one time of day.';
    }
  }

  if (values.scheduleType === 'weekdays' && values.daysOfWeek.length === 0) {
    errors.daysOfWeek = 'Choose at least one day of the week.';
  }

  let intervalDays: number | undefined;
  if (values.scheduleType === 'interval') {
    const n = parseNumber(values.intervalDays);
    if (n === null || !Number.isInteger(n) || n < 1) {
      errors.intervalDays = 'Enter a whole number of days, 1 or more.';
    } else {
      intervalDays = n;
    }
  }

  if (!isLocalDate(values.startDate)) errors.startDate = 'Enter a date like 2026-10-01.';

  const currentQuantity = parseNumber(values.currentQuantity);
  if (values.currentQuantity.trim() === '') errors.currentQuantity = 'Enter how much you have now.';
  else if (currentQuantity === null) {
    errors.currentQuantity = 'Supply must be a number, like 30. Use 0 if you have none.';
  }
  const inventoryUnit = values.inventoryUnit.trim();
  if (inventoryUnit === '') errors.inventoryUnit = 'Enter what you count, like tablets.';

  let refillThreshold: number | null = null;
  if (values.refillThreshold.trim() !== '') {
    refillThreshold = positiveNumber(
      values.refillThreshold,
      'the low-supply warning level',
      errors,
      'refillThreshold',
    );
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      medication: {
        name,
        dosageAmount: dosageAmount as number,
        dosageUnit,
        form: values.form,
        instructions: values.instructions.trim() === '' ? null : values.instructions.trim(),
      },
      schedule: {
        type: values.scheduleType,
        times,
        ...(values.scheduleType === 'weekdays' ? { daysOfWeek: values.daysOfWeek } : {}),
        ...(intervalDays !== undefined ? { intervalDays } : {}),
        startDate: values.startDate,
        endDate: values.endDate,
        doseQuantity: doseQuantity as number,
      },
      inventory: {
        currentQuantity: currentQuantity as number,
        unit: inventoryUnit,
        refillThreshold,
        refillThresholdUnit: refillThreshold === null ? null : values.refillThresholdUnit,
      },
    },
  };
}
