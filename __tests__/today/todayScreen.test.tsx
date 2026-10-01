import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { DatabaseProvider } from '@/db/DatabaseProvider';
import {
  createInventory,
  createMedication,
  createSchedule,
  getInventory,
  listRecentDoseLogs,
} from '@/db/repositories';
import type { Database } from '@/db/types';
import { updateSettings } from '@/features/settings/settings';
import { TodayScreen } from '@/features/today/screens/TodayScreen';
import { createTestDb } from '../helpers/testDb';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn() };

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    useRouter: () => mockRouter,
    useFocusEffect: (effect: () => void | (() => void)) => useEffect(effect, [effect]),
  };
});
jest.mock('@/features/reminders/sync');
jest.mock('@/features/reminders/expoPort', () => {
  const { FakePort } =
    jest.requireActual<typeof import('../helpers/fakePort')>('../helpers/fakePort');
  return { expoPort: new FakePort() };
});

jest.setTimeout(20_000);

// Only Date is faked, so async work and RN timers behave normally.
const REAL_TIMERS = [
  'hrtime',
  'nextTick',
  'performance',
  'queueMicrotask',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'requestIdleCallback',
  'cancelIdleCallback',
  'setImmediate',
  'clearImmediate',
  'setInterval',
  'clearInterval',
  'setTimeout',
  'clearTimeout',
] as const;
const setNow = (date: Date) => jest.useFakeTimers({ now: date, doNotFake: [...REAL_TIMERS] });

let db: Database;
let metforminId: number;
let ibuprofenId: number;

const todaysLogs = async () =>
  (await listRecentDoseLogs(db, metforminId, 100)).filter(
    (l) => new Date(l.scheduledFor).getDate() === 10,
  );
const supply = async (id: number) => (await getInventory(db, id))?.currentQuantity;
const renderToday = async (extra?: ReactNode) =>
  await render(
    <DatabaseProvider getDatabase={() => Promise.resolve(db)}>
      <TodayScreen />
      {extra}
    </DatabaseProvider>,
  );

async function seed() {
  setNow(new Date(2026, 5, 1, 0, 0));
  const metformin = await createMedication(db, {
    name: 'Metformin',
    dosageAmount: 500,
    dosageUnit: 'mg',
    form: 'tablet',
  });
  await createSchedule(db, {
    medicationId: metformin.id,
    type: 'daily',
    times: ['08:00', '20:00'],
    startDate: '2026-06-01',
    doseQuantity: 2,
  });
  await createInventory(db, { medicationId: metformin.id, currentQuantity: 20, unit: 'tablets' });

  const ibuprofen = await createMedication(db, {
    name: 'Ibuprofen',
    dosageAmount: 200,
    dosageUnit: 'mg',
    form: 'tablet',
  });
  await createSchedule(db, {
    medicationId: ibuprofen.id,
    type: 'as_needed',
    startDate: '2026-06-01',
    doseQuantity: 1,
  });
  await createInventory(db, { medicationId: ibuprofen.id, currentQuantity: 30, unit: 'tablets' });
  metforminId = metformin.id;
  ibuprofenId = ibuprofen.id;
}

beforeEach(async () => {
  jest.clearAllMocks();
  db = await createTestDb();
  await seed();
  setNow(new Date(2026, 5, 10, 9, 0)); // Wed 9:00 — the 08:00 dose is overdue, 20:00 upcoming
});

afterEach(() => jest.useRealTimers());

describe('TodayScreen timeline', () => {
  it('groups doses by time of day with medication, dose, and status', async () => {
    await renderToday();
    expect(await screen.findByText('Morning')).toBeTruthy();
    expect(screen.getByText('Evening')).toBeTruthy();
    expect(screen.queryByText('Afternoon')).toBeNull();
    expect(screen.getAllByText('Metformin')).toHaveLength(2);
    expect(screen.getAllByText('500 mg · 2 tablets')).toHaveLength(2);
    expect(screen.getByText(/Overdue, was due/)).toBeTruthy();
    expect(screen.getByText(/^Due /)).toBeTruthy();
    expect(screen.getByText('0 of 2 doses done')).toBeTruthy();
  });

  it('highlights an overdue dose with a text badge, not just color', async () => {
    await renderToday();
    expect(await screen.findByText('⚠ Overdue')).toBeTruthy();
  });

  it('groups by exact time when the setting says so', async () => {
    await updateSettings(db, { groupBy: 'time' });
    await renderToday();
    await screen.findAllByText('Metformin');
    expect(screen.queryByText('Morning')).toBeNull();
    expect(screen.getAllByText(/^8:00/).length).toBeGreaterThan(0);
  });

  it('shows an empty state with a way to add a medication', async () => {
    db = await createTestDb();
    await renderToday();
    expect(await screen.findByText('Nothing scheduled today')).toBeTruthy();
    await fireEvent.press(screen.getByText('Add medication'));
    expect(mockRouter.push).toHaveBeenCalledWith('/medications/new');
  });
});

describe('TodayScreen actions', () => {
  it('Taken logs the dose, uses supply, and offers undo', async () => {
    await renderToday();
    await fireEvent.press((await screen.findAllByText('Taken'))[0]);

    expect(await screen.findByText('Metformin marked taken')).toBeTruthy();
    expect(await screen.findByText(/^Taken at/)).toBeTruthy();
    expect(screen.getByText('1 of 2 doses done')).toBeTruthy();
    expect(await supply(metforminId)).toBe(18);

    const undoButtons = screen.getAllByText('Undo'); // the dose's own button, then the undo bar
    expect(undoButtons).toHaveLength(2);
    await fireEvent.press(undoButtons[1]);
    await waitFor(async () => expect(await supply(metforminId)).toBe(20));
    expect(await todaysLogs()).toHaveLength(0);
    expect(await screen.findByText('0 of 2 doses done')).toBeTruthy();
  });

  it('a resolved dose can be reset with its own Undo button', async () => {
    await renderToday();
    await fireEvent.press((await screen.findAllByText('Taken'))[0]);
    await screen.findByText(/^Taken at/);
    await fireEvent.press(screen.getAllByText('Undo')[0]); // the dose's own Undo button
    await waitFor(async () => expect(await supply(metforminId)).toBe(20));
    expect(await todaysLogs()).toHaveLength(0);
  });

  it('Skip records a skipped dose without using supply', async () => {
    await renderToday();
    await fireEvent.press((await screen.findAllByText('More options'))[0]);
    await fireEvent.press(await screen.findByText('Skip'));

    expect(await screen.findByText('Skipped')).toBeTruthy();
    expect(await supply(metforminId)).toBe(20);
    expect((await todaysLogs())[0].status).toBe('skipped');
  });

  it('Snooze marks the dose snoozed without using supply', async () => {
    await renderToday();
    await fireEvent.press((await screen.findAllByText('More options'))[0]);
    await fireEvent.press(await screen.findByText('Snooze 10 min'));

    expect(await screen.findByText(/^Snoozed until/)).toBeTruthy();
    expect(await supply(metforminId)).toBe(20);
  });

  it('logs a different time and quantity, using that quantity of supply', async () => {
    await renderToday();
    await fireEvent.press((await screen.findAllByText('More options'))[0]);
    await fireEvent.press((await screen.findAllByText('Different time or quantity'))[0]);
    await fireEvent.changeText(screen.getByLabelText('Quantity taken'), '1');
    await fireEvent.changeText(screen.getByLabelText('Time taken'), '8:30');
    await fireEvent.press(screen.getByText('Save dose'));

    expect(await screen.findByText(/, 1 taken$/)).toBeTruthy();
    expect(await supply(metforminId)).toBe(19);
    const [log] = await todaysLogs();
    expect(log.actedAt).toBe(new Date(2026, 5, 10, 8, 30).toISOString());
  });

  it('rejects a bad quantity or a time in the future', async () => {
    await renderToday();
    await fireEvent.press((await screen.findAllByText('More options'))[0]);
    await fireEvent.press((await screen.findAllByText('Different time or quantity'))[0]);
    await fireEvent.changeText(screen.getByLabelText('Quantity taken'), '0');
    await fireEvent.changeText(screen.getByLabelText('Time taken'), '11:00');
    await fireEvent.press(screen.getByText('Save dose'));

    expect(await screen.findByText('Enter a quantity greater than 0')).toBeTruthy();
    expect(screen.getByText("That time hasn't happened yet")).toBeTruthy();
    expect(await supply(metforminId)).toBe(20);
  });
});

describe('missed doses', () => {
  it('marks a dose missed after the window without touching supply', async () => {
    setNow(new Date(2026, 5, 10, 10, 30));
    await renderToday();
    expect(await screen.findByText(/^Missed, was due/)).toBeTruthy();
    expect(await supply(metforminId)).toBe(20);
    const statuses = (await listRecentDoseLogs(db, metforminId)).map((l) => l.status);
    expect(statuses).toContain('missed');
  });

  it('uses the window from settings', async () => {
    await updateSettings(db, { missedAfterMinutes: 30 });
    setNow(new Date(2026, 5, 10, 8, 45));
    await renderToday();
    expect(await screen.findByText(/^Missed, was due/)).toBeTruthy();
  });

  it('a missed dose can still be logged late, which then uses supply', async () => {
    setNow(new Date(2026, 5, 10, 10, 30));
    await renderToday();
    await screen.findByText(/^Missed, was due/);
    await fireEvent.press((await screen.findAllByText('Taken'))[0]);
    await screen.findByText(/^Taken at/);
    expect(await supply(metforminId)).toBe(18);
  });
});

describe('as-needed section', () => {
  it('logs a PRN dose with one tap, uses supply, and can undo it', async () => {
    await renderToday();
    expect(await screen.findByText('As needed')).toBeTruthy();
    await fireEvent.press(screen.getByText('Log 1 tablet now'));

    expect(await screen.findByText('Taken today')).toBeTruthy();
    expect(await supply(ibuprofenId)).toBe(29);

    // The entry's own Undo button removes just that dose.
    const undoButtons = screen.getAllByText('Undo');
    await fireEvent.press(undoButtons[undoButtons.length - 1]);
    await waitFor(async () => expect(await supply(ibuprofenId)).toBe(30));
    await waitFor(() => expect(screen.queryByText('Taken today')).toBeNull());
  });

  it('logs a PRN dose at a different time and quantity', async () => {
    await renderToday();
    const buttons = await screen.findAllByText('Different time or quantity');
    await fireEvent.press(buttons[buttons.length - 1]);
    await fireEvent.changeText(screen.getByLabelText('Quantity taken'), '2');
    await fireEvent.changeText(screen.getByLabelText('Time taken'), '7:15');
    await fireEvent.press(screen.getByText('Log dose'));

    expect(await screen.findByText(/2 taken/)).toBeTruthy();
    expect(await supply(ibuprofenId)).toBe(28);
  });

  it('can log several doses in a day', async () => {
    await renderToday();
    await fireEvent.press(await screen.findByText('Log 1 tablet now'));
    await screen.findByText('Taken today');
    jest.setSystemTime(new Date(2026, 5, 10, 9, 5));
    await fireEvent.press(screen.getByText('Log 1 tablet now'));
    await waitFor(async () => expect(await supply(ibuprofenId)).toBe(28));
  });

  it('is hidden when no medication is as-needed', async () => {
    db = await createTestDb();
    await renderToday();
    await screen.findByText('Nothing scheduled today');
    expect(screen.queryByText('As needed')).toBeNull();
  });
});
