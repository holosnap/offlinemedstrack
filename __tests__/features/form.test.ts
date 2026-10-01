import { emptyFormValues, validateForm, type FormValues } from '@/features/medications/form';

const valid = (over: Partial<FormValues> = {}): FormValues => ({
  ...emptyFormValues(new Date(2026, 9, 1)),
  name: 'Metformin',
  dosageAmount: '500',
  currentQuantity: '30',
  ...over,
});

function errorsOf(values: FormValues) {
  const result = validateForm(values);
  if (result.ok) throw new Error('expected validation errors');
  return result.errors;
}

describe('validateForm', () => {
  it('accepts a complete form and normalizes it', () => {
    const result = validateForm(
      valid({ times: ['8 pm', '7:30 AM'], instructions: '  with food ' }),
    );
    expect(result).toEqual({
      ok: true,
      value: {
        medication: {
          name: 'Metformin',
          dosageAmount: 500,
          dosageUnit: 'mg',
          form: 'tablet',
          instructions: 'with food',
        },
        schedule: {
          type: 'daily',
          times: ['20:00', '07:30'],
          startDate: '2026-10-01',
          endDate: null,
          doseQuantity: 1,
        },
        inventory: {
          currentQuantity: 30,
          unit: 'tablets',
          refillThreshold: 7,
          refillThresholdUnit: 'days',
          refillsRemaining: null,
          pharmacyName: null,
          pharmacyPhone: null,
          prescriptionNumber: null,
        },
      },
    });
  });

  it('normalizes the refill and pharmacy fields', () => {
    const result = validateForm(
      valid({
        refillsRemaining: ' 2 ',
        pharmacyName: ' Corner Pharmacy ',
        pharmacyPhone: ' (555) 123-4567 ',
        prescriptionNumber: ' RX-1 ',
      }),
    );
    expect(result.ok && result.value.inventory).toMatchObject({
      refillsRemaining: 2,
      pharmacyName: 'Corner Pharmacy',
      pharmacyPhone: '(555) 123-4567',
      prescriptionNumber: 'RX-1',
    });
    expect(validateForm(valid({ refillsRemaining: '0' })).ok).toBe(true);
  });

  it('rejects bad refill counts and phone numbers', () => {
    expect(errorsOf(valid({ refillsRemaining: '1.5' })).refillsRemaining).toBeDefined();
    expect(errorsOf(valid({ refillsRemaining: 'two' })).refillsRemaining).toBeDefined();
    expect(errorsOf(valid({ pharmacyPhone: 'call me' })).pharmacyPhone).toBeDefined();
    expect(errorsOf(valid({ pharmacyPhone: '12' })).pharmacyPhone).toBeDefined();
  });

  it('rejects empty names', () => {
    expect(errorsOf(valid({ name: '   ' })).name).toBeDefined();
  });

  it.each(['', '0', '-1', 'abc'])('rejects dosage amount %p', (dosageAmount) => {
    expect(errorsOf(valid({ dosageAmount })).dosageAmount).toBeDefined();
  });

  it.each(['', '0', '-2'])('rejects dose quantity %p', (doseQuantity) => {
    expect(errorsOf(valid({ doseQuantity })).doseQuantity).toBeDefined();
  });

  it('accepts decimal quantities with a comma', () => {
    const result = validateForm(valid({ doseQuantity: '0,5' }));
    expect(result.ok && result.value.schedule.doseQuantity).toBe(0.5);
  });

  it('requires at least one time for scheduled medications', () => {
    expect(errorsOf(valid({ times: [] })).times).toBeDefined();
    expect(errorsOf(valid({ times: ['', '  '] })).times).toBeDefined();
    expect(errorsOf(valid({ scheduleType: 'interval', times: [] })).times).toBeDefined();
  });

  it('flags unparseable times on their own row', () => {
    const errors = errorsOf(valid({ times: ['8 am', 'soon'] }));
    expect(errors['time-1']).toBeDefined();
    expect(errors['time-0']).toBeUndefined();
  });

  it('does not require times for as-needed medications', () => {
    const result = validateForm(valid({ scheduleType: 'as_needed', times: [] }));
    expect(result.ok && result.value.schedule.times).toEqual([]);
  });

  it('requires days for weekday schedules and a whole interval', () => {
    expect(errorsOf(valid({ scheduleType: 'weekdays' })).daysOfWeek).toBeDefined();
    expect(
      errorsOf(valid({ scheduleType: 'interval', intervalDays: '1.5' })).intervalDays,
    ).toBeDefined();
    expect(
      errorsOf(valid({ scheduleType: 'interval', intervalDays: '0' })).intervalDays,
    ).toBeDefined();
  });

  it('allows zero starting supply but not negative or missing', () => {
    expect(validateForm(valid({ currentQuantity: '0' })).ok).toBe(true);
    expect(errorsOf(valid({ currentQuantity: '-3' })).currentQuantity).toBeDefined();
    expect(errorsOf(valid({ currentQuantity: '' })).currentQuantity).toBeDefined();
  });

  it('treats the low-supply warning as optional but positive when given', () => {
    const none = validateForm(valid({ refillThreshold: '' }));
    expect(none.ok && none.value.inventory.refillThreshold).toBeNull();
    expect(none.ok && none.value.inventory.refillThresholdUnit).toBeNull();
    expect(errorsOf(valid({ refillThreshold: '0' })).refillThreshold).toBeDefined();
  });
});
