import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import type { ReactNode } from 'react';

import {
  createInventory,
  createMedication,
  createSchedule,
  getMedication,
  listMedications,
  recordDose,
} from '@/db/repositories';
import type { Database } from '@/db/types';
import { DatabaseProvider } from '@/db/DatabaseProvider';
import { SettingsProvider } from '@/features/settings/SettingsProvider';
import { getPermissionState } from '@/features/reminders/permissions';
import { MedicationDetailScreen } from '@/features/medications/screens/MedicationDetailScreen';
import { MedicationFormScreen } from '@/features/medications/screens/MedicationFormScreen';
import { MedicationListScreen } from '@/features/medications/screens/MedicationListScreen';
import { createTestDb } from './../helpers/testDb';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn() };

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    useRouter: () => mockRouter,
    // Run the effect on mount, like a focused screen would.
    useFocusEffect: (effect: () => void | (() => void)) => useEffect(effect, [effect]),
    Stack: { Screen: () => null },
  };
});

jest.mock('@/features/reminders/sync');
jest.mock('@/features/reminders/permissions');

// The first run compiles a lot of RN modules; don't let a cold cache fail a test.
jest.setTimeout(20_000);

let db: Database;

const wrap = (node: ReactNode) => (
  <DatabaseProvider getDatabase={() => Promise.resolve(db)}>
    <SettingsProvider>{node}</SettingsProvider>
  </DatabaseProvider>
);

async function seed(name: string, over: { quantity?: number; threshold?: number | null } = {}) {
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
    startDate: '2020-01-01',
    doseQuantity: 1,
  });
  await createInventory(db, {
    medicationId: med.id,
    currentQuantity: over.quantity ?? 60,
    unit: 'tablets',
    refillThreshold: over.threshold === undefined ? 7 : over.threshold,
    refillThresholdUnit: over.threshold === null ? null : 'days',
  });
  return med;
}

beforeEach(async () => {
  jest.clearAllMocks();
  jest.mocked(getPermissionState).mockResolvedValue('granted');
  db = await createTestDb();
});

describe('MedicationListScreen', () => {
  it('shows an empty state with a large add button', async () => {
    await render(wrap(<MedicationListScreen />));
    expect(await screen.findByText('No medications yet')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Add medication' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/medications/new');
  });

  it('lists medications with dosage, next dose, and a low-supply badge only when low', async () => {
    await seed('Metformin', { quantity: 6 }); // 3 days at 2/day <= 7
    await seed('Aspirin', { quantity: 200 });
    await render(wrap(<MedicationListScreen />));

    expect(await screen.findByText('Metformin')).toBeTruthy();
    expect(screen.getByText('Aspirin')).toBeTruthy();
    expect(screen.getAllByText(/500 mg/)).toHaveLength(2);
    expect(screen.getAllByText(/Next dose: /)).toHaveLength(2);
    expect(screen.getAllByTestId('low-supply-badge')).toHaveLength(1);

    const card = screen.getByRole('button', { name: /^Metformin\./ });
    expect(card.props.accessibilityLabel).toMatch(/Low supply/);
    await fireEvent.press(card);
    expect(mockRouter.push).toHaveBeenCalledWith(expect.stringMatching(/^\/medications\/\d+$/));
  });

  it('shows paused medications as paused', async () => {
    const med = await seed('Metformin');
    await db.runAsync('UPDATE medications SET active = 0 WHERE id = ?', [med.id]);
    await render(wrap(<MedicationListScreen />));
    expect(await screen.findByText('Metformin')).toBeTruthy();
    expect(screen.getAllByText('Paused').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Next dose/)).toBeNull();
  });
});

describe('MedicationFormScreen', () => {
  it('shows validation errors and does not save an empty form', async () => {
    await render(wrap(<MedicationFormScreen />));
    await fireEvent.press(screen.getByRole('button', { name: 'Save medication' }));
    expect(await screen.findByText('Enter the medication name.')).toBeTruthy();
    expect(screen.getByTestId('error-summary')).toBeTruthy();
    expect(screen.getByText('Enter how much you have now.')).toBeTruthy();
    expect(await listMedications(db)).toHaveLength(0);
    expect(mockRouter.back).not.toHaveBeenCalled();
  });

  it('requires a time for scheduled medications', async () => {
    await render(wrap(<MedicationFormScreen />));
    await fireEvent.changeText(screen.getByLabelText('Time 1'), '');
    await fireEvent.press(screen.getByRole('button', { name: 'Save medication' }));
    expect(await screen.findByText('Add at least one time of day.')).toBeTruthy();
  });

  it('creates a medication with schedule and inventory', async () => {
    await render(wrap(<MedicationFormScreen />));
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Lisinopril');
    await fireEvent.changeText(screen.getByLabelText('Strength'), '10');
    await fireEvent.changeText(screen.getByLabelText('How much you have'), '30');
    await fireEvent.press(screen.getByRole('button', { name: 'Add another time' }));
    await fireEvent.changeText(screen.getByLabelText('Time 2'), '8 pm');
    await fireEvent.press(screen.getByRole('button', { name: 'Save medication' }));

    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    const [med] = await listMedications(db);
    expect(med.name).toBe('Lisinopril');
    const sched = await db.getFirstAsync<{ times: string }>('SELECT times FROM schedules');
    expect(JSON.parse(sched?.times ?? '[]')).toEqual(['08:00', '20:00']);
    const inv = await db.getFirstAsync<{ current_quantity: number; unit: string }>(
      'SELECT * FROM inventory',
    );
    expect(inv).toMatchObject({ current_quantity: 30, unit: 'tablets' });
  });

  it('edits an existing medication', async () => {
    const med = await seed('Metformin');
    await render(wrap(<MedicationFormScreen medicationId={med.id} />));
    const name = await screen.findByLabelText('Name');
    expect(name.props.value).toBe('Metformin');
    expect(screen.getByLabelText('Time 1').props.value).toBe('8:00 AM');
    await fireEvent.changeText(name, 'Metformin XR');
    await fireEvent.changeText(screen.getByLabelText('How much you have now'), '45');
    await fireEvent.press(screen.getByRole('button', { name: 'Save medication' }));

    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    expect((await getMedication(db, med.id))?.name).toBe('Metformin XR');
    const inv = await db.getFirstAsync<{ current_quantity: number }>('SELECT * FROM inventory');
    expect(inv?.current_quantity).toBe(45);
  });

  it('exposes weekday choices as labelled checkboxes', async () => {
    await render(wrap(<MedicationFormScreen />));
    await fireEvent.press(screen.getByRole('radio', { name: 'Certain days' }));
    const monday = screen.getByRole('checkbox', { name: 'Monday' });
    await fireEvent.press(monday);
    expect(screen.getByRole('checkbox', { name: 'Monday', checked: true })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Save medication' }));
    expect(await screen.findByText('Enter the medication name.')).toBeTruthy();
  });
});

describe('MedicationDetailScreen', () => {
  it('shows schedule, supply, run-out estimate, and dose history', async () => {
    const med = await seed('Metformin', { quantity: 20 }); // 10 days at 2/day
    await recordDose(db, {
      medicationId: med.id,
      scheduledFor: new Date(Date.now() - 3_600_000),
      status: 'taken',
    });
    await render(wrap(<MedicationDetailScreen medicationId={med.id} />));

    expect(await screen.findByText('20 tablets')).toBeTruthy();
    expect(screen.getByText(/^Every day at /)).toBeTruthy();
    expect(screen.getByText(/about 10 days left/)).toBeTruthy();
    expect(screen.getByText('✓ Taken')).toBeTruthy();
    expect(screen.queryByTestId('low-supply-badge')).toBeNull();
  });

  it('shows the low-supply badge and an empty history', async () => {
    const med = await seed('Metformin', { quantity: 4 });
    await render(wrap(<MedicationDetailScreen medicationId={med.id} />));
    expect(await screen.findByTestId('low-supply-badge')).toBeTruthy();
    expect(screen.getByText('No doses recorded yet.')).toBeTruthy();
  });

  it('pauses and resumes', async () => {
    const med = await seed('Metformin');
    await render(wrap(<MedicationDetailScreen medicationId={med.id} />));
    await fireEvent.press(await screen.findByRole('button', { name: 'Pause medication' }));
    expect(await screen.findByRole('button', { name: 'Resume medication' })).toBeTruthy();
    expect((await getMedication(db, med.id))?.active).toBe(false);
    await fireEvent.press(screen.getByRole('button', { name: 'Resume medication' }));
    expect(await screen.findByRole('button', { name: 'Pause medication' })).toBeTruthy();
    expect((await getMedication(db, med.id))?.active).toBe(true);
  });

  it('asks for confirmation before deleting, and cancel keeps the medication', async () => {
    const med = await seed('Metformin');
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await render(wrap(<MedicationDetailScreen medicationId={med.id} />));
    await fireEvent.press(await screen.findByRole('button', { name: 'Delete medication' }));

    expect(alert).toHaveBeenCalledTimes(1);
    const buttons = alert.mock.calls[0][2] ?? [];
    expect(buttons.map((b) => b.text)).toEqual(['Cancel', 'Delete']);
    expect(await getMedication(db, med.id)).not.toBeNull();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('deletes only after the destructive button is pressed', async () => {
    const med = await seed('Metformin');
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await render(wrap(<MedicationDetailScreen medicationId={med.id} />));
    await fireEvent.press(await screen.findByRole('button', { name: 'Delete medication' }));
    const confirm = (alert.mock.calls[0][2] ?? []).find((b) => b.style === 'destructive');
    await confirm?.onPress?.();

    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/'));
    expect(await getMedication(db, med.id)).toBeNull();
  });
});
