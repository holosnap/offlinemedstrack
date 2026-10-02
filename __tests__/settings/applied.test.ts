import { createInventory, createMedication, createSchedule } from '@/db/repositories';
import type { Database } from '@/db/types';
import { snoozeDose } from '@/features/doses/doseActions';
import { snoozeUntil } from '@/features/doses/timeline';
import { emptyFormValues } from '@/features/medications/form';
import { reconcile } from '@/features/reminders/reconcile';
import { updateSettings } from '@/features/settings/settings';
import { formatClock, formatTime, setTimeFormatPreference } from '@/lib/format';
import { FakePort } from '../helpers/fakePort';
import { createTestDb } from '../helpers/testDb';

const NOW = new Date(2026, 5, 10, 8, 30);
let db: Database;
let port: FakePort;
let medId: number;

beforeEach(async () => {
  db = await createTestDb();
  port = new FakePort();
  medId = (
    await createMedication(db, {
      name: 'Metformin',
      dosageAmount: 500,
      dosageUnit: 'mg',
      form: 'tablet',
    })
  ).id;
  await createSchedule(db, {
    medicationId: medId,
    type: 'daily',
    times: ['20:00'],
    startDate: '2026-01-01',
    doseQuantity: 1,
  });
  await createInventory(db, { medicationId: medId, currentQuantity: 100, unit: 'tablets' });
});
afterEach(() => setTimeFormatPreference('system'));

describe('snooze length setting', () => {
  const ref = () => ({
    medicationId: medId,
    scheduledFor: new Date(2026, 5, 10, 8, 0).toISOString(),
    quantity: 1,
  });

  it('uses the default of 10 minutes', async () => {
    const { until } = await snoozeDose({ db, port, now: () => NOW }, ref(), {
      title: 't',
      body: 'b',
    });
    expect(until.getTime() - NOW.getTime()).toBe(10 * 60_000);
  });

  it('uses the chosen length for the reminder and the on-screen time', async () => {
    await updateSettings(db, { snoozeMinutes: 30 });
    const { until } = await snoozeDose({ db, port, now: () => NOW }, ref(), {
      title: 't',
      body: 'b',
    });
    expect(until.getTime() - NOW.getTime()).toBe(30 * 60_000);
    expect([...port.pending.values()][0].fireAt).toEqual(until);
    const log = { actedAt: NOW.toISOString() } as Parameters<typeof snoozeUntil>[0];
    expect(snoozeUntil(log, 30)?.getTime()).toBe(until.getTime());
  });
});

describe('notification sound setting', () => {
  const run = () => reconcile({ db, port, now: () => NOW, windowDays: 1 });

  it('schedules reminders with sound by default and records it', async () => {
    await run();
    const requests = [...port.pending.values()];
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((r) => r.sound && r.data.sound === true)).toBe(true);
  });

  it('reschedules everything silently when sound is turned off, and back again', async () => {
    await run();
    await updateSettings(db, { soundEnabled: false });
    const result = await run();
    expect(result.cancelled).toBe(result.scheduled);
    expect([...port.pending.values()].every((r) => !r.sound && r.data.sound === false)).toBe(true);

    port.scheduleCalls = 0;
    await run(); // stable once applied
    expect(port.scheduleCalls).toBe(0);

    await updateSettings(db, { soundEnabled: true });
    await run();
    expect([...port.pending.values()].every((r) => r.sound)).toBe(true);
  });

  it('applies to snoozes too', async () => {
    await updateSettings(db, { soundEnabled: false });
    await snoozeDose(
      { db, port, now: () => NOW },
      { medicationId: medId, scheduledFor: new Date(2026, 5, 10, 8, 0).toISOString(), quantity: 1 },
      { title: 't', body: 'b' },
    );
    expect([...port.pending.values()][0].sound).toBe(false);
  });
});

describe('refill threshold default', () => {
  it('starts new medications at 7 days and follows the setting', () => {
    expect(emptyFormValues(NOW)).toMatchObject({
      refillThreshold: '7',
      refillThresholdUnit: 'days',
    });
    expect(
      emptyFormValues(NOW, { refillThreshold: 15, refillThresholdUnit: 'count' }),
    ).toMatchObject({
      refillThreshold: '15',
      refillThresholdUnit: 'count',
    });
  });
});

describe('12/24-hour time', () => {
  const evening = new Date(2026, 5, 10, 20, 5);

  it('formats every time the app shows according to the preference', () => {
    setTimeFormatPreference('24h');
    expect(formatClock(evening)).toBe('20:05');
    expect(formatTime('08:30')).toBe('08:30');
    setTimeFormatPreference('12h');
    expect(formatClock(evening)).toMatch(/^8:05\s?PM$/);
    expect(formatTime('08:30')).toMatch(/^8:30\s?AM$/);
  });

  it('matches the phone by default', () => {
    setTimeFormatPreference('system');
    expect(formatClock(evening)).toBe(
      evening.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
    );
  });
});
