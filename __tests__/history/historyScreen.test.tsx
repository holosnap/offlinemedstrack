import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { DatabaseProvider } from '@/db/DatabaseProvider';
import {
  createInventory,
  createMedication,
  createSchedule,
  getInventory,
  listRecentDoseLogs,
  recordDose,
} from '@/db/repositories';
import type { Database } from '@/db/types';
import type { FileExporter } from '@/features/history/exporter';
import { HistoryScreen } from '@/features/history/screens/HistoryScreen';
import { createTestDb } from '../helpers/testDb';

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return { useFocusEffect: (effect: () => void | (() => void)) => useEffect(effect, [effect]) };
});
jest.mock('@/features/reminders/sync');
jest.mock('@/features/history/exporter', () => ({ expoExporter: {} }));

jest.setTimeout(30_000);

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
const at = (day: number, h: number, m = 0) => new Date(2026, 5, day, h, m);

class FakeExporter implements FileExporter {
  available = true;
  files: { name: string; content: string }[] = [];
  shared: string[] = [];
  async canShare() {
    return this.available;
  }
  async writeText(name: string, content: string) {
    this.files.push({ name, content });
    return `file:///cache/${name}`;
  }
  async htmlToPdf(name: string, html: string) {
    this.files.push({ name, content: html });
    return `file:///cache/${name}`;
  }
  async share(uri: string) {
    this.shared.push(uri);
  }
}

let db: Database;
let exporter: FakeExporter;
let metformin: number;
let ibuprofen: number;

const supply = async (id: number) => (await getInventory(db, id))?.currentQuantity;
const renderHistory = async () =>
  await render(
    <DatabaseProvider getDatabase={() => Promise.resolve(db)}>
      <HistoryScreen exporter={exporter} />
    </DatabaseProvider>,
  );
const openDay = async (date: string) => fireEvent.press(await screen.findByTestId(`day-${date}`));

beforeEach(async () => {
  jest.clearAllMocks();
  exporter = new FakeExporter();
  db = await createTestDb();
  setNow(at(1, 0)); // schedules are stamped June 1
  const med = await createMedication(db, {
    name: 'Metformin',
    dosageAmount: 500,
    dosageUnit: 'mg',
    form: 'tablet',
  });
  metformin = med.id;
  await createSchedule(db, {
    medicationId: metformin,
    type: 'daily',
    times: ['08:00'],
    startDate: '2026-01-01',
    doseQuantity: 2,
  });
  await createInventory(db, { medicationId: metformin, currentQuantity: 20, unit: 'tablets' });
  const prn = await createMedication(db, {
    name: 'Ibuprofen',
    dosageAmount: 200,
    dosageUnit: 'mg',
    form: 'tablet',
  });
  ibuprofen = prn.id;
  await createSchedule(db, {
    medicationId: ibuprofen,
    type: 'as_needed',
    startDate: '2026-01-01',
    doseQuantity: 1,
  });
  await createInventory(db, { medicationId: ibuprofen, currentQuantity: 30, unit: 'tablets' });

  await recordDose(db, {
    medicationId: metformin,
    scheduledFor: at(8, 8),
    status: 'taken',
    actedAt: at(8, 8, 20),
    quantity: 2,
  });
  await recordDose(db, {
    medicationId: metformin,
    scheduledFor: at(9, 8),
    status: 'skipped',
    actedAt: at(9, 8, 5),
  });
  setNow(at(10, 14)); // Wed June 10, 14:00
});

afterEach(() => jest.useRealTimers());

describe('calendar', () => {
  it('colors days by adherence and says so in words', async () => {
    await renderHistory();
    expect((await screen.findByTestId('day-2026-06-08')).props.accessibilityLabel).toContain(
      'all doses taken',
    );
    expect(screen.getByTestId('day-2026-06-09').props.accessibilityLabel).toContain(
      'no doses taken',
    );
    expect(screen.getByTestId('day-2026-06-05').props.accessibilityLabel).toContain(
      'no doses taken',
    );
    expect(screen.getByTestId('day-2026-06-11').props.accessibilityLabel).toContain('upcoming');
    expect(screen.getByTestId('day-2026-06-10').props.accessibilityLabel).toContain('today');
    expect(screen.getByLabelText('Legend')).toBeTruthy();
  });

  it('shows days before any schedule as having nothing scheduled', async () => {
    await renderHistory();
    expect((await screen.findByTestId('day-2026-06-01')).props.accessibilityLabel).toContain(
      'no doses taken',
    );
    await fireEvent.press(screen.getByText('Previous'));
    expect((await screen.findByTestId('day-2026-05-15')).props.accessibilityLabel).toContain(
      'no doses scheduled',
    );
    expect(screen.getByText(/May 2026/)).toBeTruthy();
  });

  it('shows the selected day’s log', async () => {
    await renderHistory();
    await openDay('2026-06-08');
    expect(await screen.findByText(/^Taken at/)).toBeTruthy();
    expect(screen.getByText('1 of 1 dose taken (all doses taken)')).toBeTruthy();
    await openDay('2026-06-09');
    expect(await screen.findByText('Skipped')).toBeTruthy();
    await openDay('2026-06-11');
    expect(await screen.findByText("This day hasn't happened yet.")).toBeTruthy();
  });
});

describe('editing and backfilling', () => {
  it('turns a skipped dose into taken: supply is used, and Undo reverses it', async () => {
    await renderHistory();
    await openDay('2026-06-09');
    await fireEvent.press(await screen.findByText('Edit'));
    await fireEvent.press(screen.getByLabelText('Taken'));
    expect(await screen.findByText('This will use 2 tablets of your supply.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Save changes'));

    expect(await screen.findByText('Metformin updated')).toBeTruthy();
    await waitFor(async () => expect(await supply(metformin)).toBe(18));
    expect((await screen.findByTestId('day-2026-06-09')).props.accessibilityLabel).toContain(
      'all doses taken',
    );

    await fireEvent.press(screen.getAllByText('Undo')[0]);
    await waitFor(async () => expect(await supply(metformin)).toBe(20));
    await waitFor(() =>
      expect(screen.getByTestId('day-2026-06-09').props.accessibilityLabel).toContain(
        'no doses taken',
      ),
    );
  });

  it('backfills a forgotten dose with a time and quantity', async () => {
    await renderHistory();
    await openDay('2026-06-05'); // never recorded, so it counts as missed
    await fireEvent.press(await screen.findByText('Edit'));
    await fireEvent.changeText(screen.getByLabelText('Quantity taken'), '1');
    await fireEvent.changeText(screen.getByLabelText('Time taken'), '9:15 am');
    await fireEvent.press(screen.getByText('Save changes'));

    await waitFor(async () => expect(await supply(metformin)).toBe(19));
    const log = (await listRecentDoseLogs(db, metformin, 50)).find(
      (l) => new Date(l.scheduledFor).getDate() === 5,
    );
    expect(log).toMatchObject({
      status: 'taken',
      quantity: 1,
      actedAt: at(5, 9, 15).toISOString(),
    });
    expect((await screen.findByTestId('day-2026-06-05')).props.accessibilityLabel).toContain(
      'all doses taken',
    );
  });

  it('changing a taken dose to missed gives the supply back', async () => {
    await renderHistory();
    await openDay('2026-06-08');
    await fireEvent.press(await screen.findByText('Edit'));
    await fireEvent.press(screen.getByLabelText('Missed'));
    expect(await screen.findByText('This will add 2 tablets back to your supply.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Save changes'));
    await waitFor(async () => expect(await supply(metformin)).toBe(22));
  });

  it('rejects a time that has not happened yet', async () => {
    await renderHistory();
    await openDay('2026-06-10');
    await fireEvent.press(await screen.findByText('Edit'));
    await fireEvent.press(screen.getByLabelText('Taken'));
    await fireEvent.changeText(screen.getByLabelText('Time taken'), '6:00 pm');
    await fireEvent.press(screen.getByText('Save changes'));
    expect(await screen.findByText("That time hasn't happened yet")).toBeTruthy();
    expect(await supply(metformin)).toBe(20);
  });

  it('adds, then deletes, an as-needed dose on a past day', async () => {
    await renderHistory();
    await openDay('2026-06-08');
    await fireEvent.press(await screen.findByText('Add Ibuprofen dose'));
    await fireEvent.changeText(screen.getByLabelText('Quantity taken'), '2');
    await fireEvent.changeText(screen.getByLabelText('Time taken'), '12:00');
    await fireEvent.press(screen.getByText('Add dose'));

    expect(await screen.findByText(/Taken at .*, 2 taken/)).toBeTruthy();
    expect(await supply(ibuprofen)).toBe(28);
    await fireEvent.press(screen.getByText('Delete'));
    await waitFor(async () => expect(await supply(ibuprofen)).toBe(30));
  });
});

describe('adherence', () => {
  it('shows per-medication percentages and switches period', async () => {
    await renderHistory();
    // Doses due since the schedule began on June 1: Jun 1-10 (10), one taken.
    expect(await screen.findByText('10%')).toBeTruthy();
    expect(screen.getByText('1 of 10 doses taken')).toBeTruthy();
    expect(screen.getByText('0 doses taken as needed')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('7 days'));
    expect(await screen.findByText('14%')).toBeTruthy(); // 1 of 7
  });
});

describe('export', () => {
  it('shares a CSV for the chosen period', async () => {
    await renderHistory();
    await fireEvent.press(await screen.findByText('Export CSV'));
    expect(await screen.findByText(/Prepared \d+ entries to share/)).toBeTruthy();
    expect(exporter.files[0].name).toBe('medication-history-2026-06-10.csv');
    expect(exporter.shared).toEqual(['file:///cache/medication-history-2026-06-10.csv']);
  });

  it('shares a PDF', async () => {
    await renderHistory();
    await fireEvent.press(await screen.findByLabelText('Last 90 days'));
    await fireEvent.press(screen.getByText('Export PDF'));
    await waitFor(() => expect(exporter.shared).toHaveLength(1));
    expect(exporter.files[0].name).toBe('medication-history-2026-06-10.pdf');
  });

  it('explains when sharing is not available', async () => {
    exporter.available = false;
    await renderHistory();
    await fireEvent.press(await screen.findByText('Export CSV'));
    expect(await screen.findByText('Sharing is not available on this device.')).toBeTruthy();
    expect(exporter.shared).toEqual([]);
  });
});
