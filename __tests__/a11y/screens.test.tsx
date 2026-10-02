import { fireEvent, render, screen, within } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { DatabaseProvider } from '@/db/DatabaseProvider';
import { createInventory, createMedication, createSchedule, recordDose } from '@/db/repositories';
import type { Database } from '@/db/types';
import { HistoryScreen } from '@/features/history/screens/HistoryScreen';
import { MedicationDetailScreen } from '@/features/medications/screens/MedicationDetailScreen';
import { MedicationFormScreen } from '@/features/medications/screens/MedicationFormScreen';
import { MedicationListScreen } from '@/features/medications/screens/MedicationListScreen';
import { OnboardingScreen } from '@/features/onboarding/screens/OnboardingScreen';
import { RecordRefillScreen } from '@/features/refills/screens/RecordRefillScreen';
import { RefillsScreen } from '@/features/refills/screens/RefillsScreen';
import { ReminderPermissionScreen } from '@/features/reminders/screens/ReminderPermissionScreen';
import * as permissions from '@/features/reminders/permissions';
import { SettingsProvider } from '@/features/settings/SettingsProvider';
import { SettingsScreen } from '@/features/settings/screens/SettingsScreen';
import { TodayScreen } from '@/features/today/screens/TodayScreen';
import { createTestDb } from '../helpers/testDb';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn() };
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    useRouter: () => mockRouter,
    useFocusEffect: (effect: () => void | (() => void)) => useEffect(effect, [effect]),
    Stack: { Screen: () => null },
  };
});
jest.mock('@/features/reminders/sync');
jest.mock('@/features/reminders/setup');
jest.mock('@/features/reminders/permissions');
jest.mock('@/features/reminders/expoPort', () => {
  const { FakePort } =
    jest.requireActual<typeof import('../helpers/fakePort')>('../helpers/fakePort');
  return { expoPort: new FakePort(), toPermissionState: jest.fn() };
});
jest.setTimeout(30_000);

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
const setNow = (d: Date) => jest.useFakeTimers({ now: d, doNotFake: [...REAL_TIMERS] });
const at = (day: number, h: number, m = 0) => new Date(2026, 5, day, h, m);

let db: Database;
let metformin: number;
let lisinopril: number;

type Element = ReturnType<typeof screen.getAllByRole>[number];

const wrap = (node: ReactNode) => (
  <DatabaseProvider getDatabase={() => Promise.resolve(db)}>
    <SettingsProvider>{node}</SettingsProvider>
  </DatabaseProvider>
);

/** The text a screen reader would read for an element with no explicit label. */
function textOf(el: Element): string {
  const parts = within(el)
    .queryAllByText(/./)
    .map((n) => String(n.props.children ?? ''));
  return parts.join(' ').trim();
}
const nameOf = (el: Element): string =>
  String(el.props.accessibilityLabel ?? el.props['aria-label'] ?? '').trim() || textOf(el);

const interactive = () => [
  ...screen.queryAllByRole('button'),
  ...screen.queryAllByRole('radio'),
  ...screen.queryAllByRole('checkbox'),
];

/** Every control must have a name; buttons on one screen must be distinguishable from each other. */
function expectAccessible(options: { unique?: boolean } = {}) {
  const controls = interactive();
  expect(controls.length).toBeGreaterThan(0);
  const unnamed = controls.filter((el) => nameOf(el) === '');
  expect(unnamed.map((el) => el.props.testID ?? el.type)).toEqual([]);

  if (options.unique !== false) {
    const buttons = screen.queryAllByRole('button').map(nameOf);
    const duplicates = buttons.filter((n, i) => buttons.indexOf(n) !== i);
    expect([...new Set(duplicates)]).toEqual([]);
  }
  // Every text field has a label (not just a placeholder).
  for (const input of screen.queryAllByDisplayValue(/.*/)) {
    expect(String(input.props.accessibilityLabel ?? '')).not.toBe('');
  }
}

beforeEach(async () => {
  jest.clearAllMocks();
  jest.mocked(permissions.getPermissionState).mockResolvedValue('undetermined');
  db = await createTestDb();
  setNow(at(1, 0));
  const mk = async (name: string, over: Record<string, unknown> = {}) => {
    const med = await createMedication(db, {
      name,
      dosageAmount: 500,
      dosageUnit: 'mg',
      form: 'tablet',
    });
    await createSchedule(db, {
      medicationId: med.id,
      type: 'daily',
      times: ['08:00', '20:00'],
      startDate: '2026-01-01',
      doseQuantity: 1,
      ...over,
    });
    await createInventory(db, {
      medicationId: med.id,
      currentQuantity: 8,
      unit: 'tablets',
      refillThreshold: 7,
      refillThresholdUnit: 'days',
      refillsRemaining: 2,
      pharmacyName: 'Corner Pharmacy',
      pharmacyPhone: '(555) 123-4567',
    });
    return med.id;
  };
  metformin = await mk('Metformin');
  lisinopril = await mk('Lisinopril', { times: ['09:00'] });
  const prn = await mk('Ibuprofen', { type: 'as_needed', times: [] });
  await recordDose(db, {
    medicationId: metformin,
    scheduledFor: at(9, 8),
    status: 'taken',
    actedAt: at(9, 8, 5),
    quantity: 1,
  });
  await recordDose(db, {
    medicationId: prn,
    scheduledFor: at(9, 13),
    status: 'taken',
    actedAt: at(9, 13),
    quantity: 1,
  });
  setNow(at(10, 14));
});
afterEach(() => jest.useRealTimers());

describe('screen reader support', () => {
  it('Today', async () => {
    await render(wrap(<TodayScreen />));
    await screen.findAllByText('Metformin');
    await fireEvent.press(screen.getAllByText('More options')[0]); // expanded controls too
    expectAccessible();
    expect(screen.getAllByRole('header').length).toBeGreaterThan(0);
  });

  it('Today buttons say which dose they act on', async () => {
    await render(wrap(<TodayScreen />));
    await screen.findAllByText('Metformin');
    const names = screen.getAllByRole('button').map(nameOf);
    expect(names.filter((n) => n.startsWith('Taken, Metformin'))).toHaveLength(2);
    expect(names).toContain('Taken, Lisinopril 9:00 AM');
    expect(names.some((n) => n.startsWith('Log 1 tablet of Ibuprofen'))).toBe(true);
  });

  it('History calendar, day log, and export', async () => {
    await render(
      wrap(
        <HistoryScreen
          exporter={{
            canShare: async () => true,
            writeText: async (n) => n,
            htmlToPdf: async (n) => n,
            share: async () => undefined,
          }}
        />,
      ),
    );
    await fireEvent.press(await screen.findByTestId('day-2026-06-09'));
    await screen.findByText('Add Ibuprofen dose');
    expectAccessible();
    const days = screen.getAllByTestId(/^day-/);
    expect(
      days.every(
        (d) =>
          /\d{4}|[A-Z][a-z]{2}/.test(String(d.props.accessibilityLabel)) &&
          String(d.props.accessibilityLabel).includes(','),
      ),
    ).toBe(true);
    const buttons = screen.getAllByRole('button').map(nameOf);
    expect(buttons).toContain('Previous month');
    expect(buttons).toContain('Next month');
  });

  it('Medication list, detail, form, refills and record refill', async () => {
    await render(wrap(<MedicationListScreen />));
    await screen.findByText('Add medication');
    expectAccessible();
  });

  it('Medication detail', async () => {
    await render(wrap(<MedicationDetailScreen medicationId={metformin} />));
    await screen.findByText('Estimated to run out');
    expectAccessible();
  });

  it('Medication form (new)', async () => {
    await render(wrap(<MedicationFormScreen />));
    await screen.findByLabelText('Name');
    expectAccessible({ unique: false });
    // Required fields are announced as required.
    expect(String(screen.getByLabelText('Name').props.accessibilityHint)).toContain('required');
  });

  it('Refills', async () => {
    await render(wrap(<RefillsScreen />));
    await screen.findByText('Sorted by when each supply is estimated to run out.');
    expectAccessible();
    const names = screen.getAllByRole('button').map(nameOf);
    expect(names).toContain('Record refill, Metformin');
    expect(names).toContain('Call pharmacy, Lisinopril');
  });

  it('Record refill', async () => {
    await render(wrap(<RecordRefillScreen medicationId={lisinopril} />));
    await screen.findByLabelText('Quantity added');
    expectAccessible();
  });

  it('Settings', async () => {
    await render(
      wrap(
        <SettingsScreen
          auth={{ status: async () => 'ready', authenticate: async () => true }}
          exporter={{
            canShare: async () => true,
            writeText: async (n) => n,
            htmlToPdf: async (n) => n,
            share: async () => undefined,
          }}
          picker={{ pickText: async () => null }}
        />,
      ),
    );
    await screen.findByText('Not medical advice');
    expectAccessible({ unique: false });
    // Choices are announced as radio buttons with their selected state.
    const radios = screen.getAllByRole('radio');
    expect(radios.length).toBeGreaterThan(10);
    expect(radios.every((r) => typeof r.props.accessibilityState?.selected === 'boolean')).toBe(
      true,
    );
  });

  it('Onboarding (all steps) and the reminders explanation screen', async () => {
    await render(wrap(<OnboardingScreen />));
    await screen.findByText('Welcome to OfflineMedsTrack');
    expectAccessible();
    await fireEvent.press(screen.getByText('I understand, continue'));
    expectAccessible();
    await fireEvent.press(screen.getByText('Not now'));
    expectAccessible();
  });

  it('Reminder permission screen', async () => {
    await render(wrap(<ReminderPermissionScreen />));
    await screen.findByText('Get dose reminders');
    expectAccessible();
  });
});
