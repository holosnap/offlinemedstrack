import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { Linking } from 'react-native';
import type { ReactNode } from 'react';

import { DatabaseProvider } from '@/db/DatabaseProvider';
import {
  createInventory,
  createMedication,
  createSchedule,
  getInventory,
  listRefillEventsForMedication,
  recordRefill,
} from '@/db/repositories';
import type { Database } from '@/db/types';
import { MedicationDetailScreen } from '@/features/medications/screens/MedicationDetailScreen';
import { MedicationListScreen } from '@/features/medications/screens/MedicationListScreen';
import { RecordRefillScreen } from '@/features/refills/screens/RecordRefillScreen';
import { RefillsScreen } from '@/features/refills/screens/RefillsScreen';
import { getPermissionState } from '@/features/reminders/permissions';
import { syncReminders } from '@/features/reminders/sync';
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
jest.mock('@/features/reminders/permissions');

jest.setTimeout(20_000);

let db: Database;
let metformin: number;
let lisinopril: number;
let ibuprofen: number;

const wrap = async (node: ReactNode) =>
  await render(<DatabaseProvider getDatabase={() => Promise.resolve(db)}>{node}</DatabaseProvider>);

async function seed() {
  const mk = async (
    name: string,
    schedule: Parameters<typeof createSchedule>[1] extends infer S ? Partial<S> : never,
  ) => {
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
      ...schedule,
    });
    return med.id;
  };
  metformin = await mk('Metformin', {});
  await createInventory(db, {
    medicationId: metformin,
    currentQuantity: 8, // 2 a day: runs out in 4 days
    unit: 'tablets',
    refillThreshold: 7,
    refillThresholdUnit: 'days',
    refillsRemaining: 3,
    pharmacyName: 'Corner Pharmacy',
    pharmacyPhone: '(555) 123-4567',
  });
  lisinopril = await mk('Lisinopril', { times: ['09:00'] });
  await createInventory(db, {
    medicationId: lisinopril,
    currentQuantity: 100,
    unit: 'tablets',
    refillThreshold: 7,
    refillThresholdUnit: 'days',
  });
  ibuprofen = await mk('Ibuprofen', { type: 'as_needed', times: [] });
  await createInventory(db, { medicationId: ibuprofen, currentQuantity: 20, unit: 'tablets' });
}

beforeEach(async () => {
  jest.clearAllMocks();
  jest.mocked(getPermissionState).mockResolvedValue('granted');
  db = await createTestDb();
  await seed();
});

describe('RefillsScreen', () => {
  it('lists medications by soonest run-out date with supply status', async () => {
    await wrap(<RefillsScreen />);
    await screen.findByText('Sorted by when each supply is estimated to run out.');
    const names = screen
      .getAllByText(/^(Metformin|Lisinopril|Ibuprofen)$/)
      .map((n) => n.props.children as string);
    expect(names).toEqual(['Metformin', 'Lisinopril', 'Ibuprofen']);

    expect(screen.getByText('about 4 days left')).toBeTruthy();
    expect(screen.getByTestId('low-supply-badge')).toBeTruthy();
    expect(screen.getAllByTestId('supply-ok-badge')).toHaveLength(1);
    expect(screen.getByText('3 refills left')).toBeTruthy();
    expect(screen.getByText(/Can't estimate yet/)).toBeTruthy(); // as-needed, no history
  });

  it('records a refill and calls the pharmacy from the list', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await wrap(<RefillsScreen />);
    // Only Metformin has a phone number, so only one Call pharmacy button.
    await fireEvent.press(await screen.findByText('Call pharmacy'));
    expect(open).toHaveBeenCalledWith('tel:5551234567');
    expect(screen.getAllByText('Call pharmacy')).toHaveLength(1);

    await fireEvent.press(screen.getAllByText('Record refill')[0]);
    expect(mockRouter.push).toHaveBeenCalledWith(`/medications/${metformin}/refill`);
  });

  it('shows an empty state without medications', async () => {
    db = await createTestDb();
    await wrap(<RefillsScreen />);
    expect(await screen.findByText('No medications yet')).toBeTruthy();
  });
});

describe('RecordRefillScreen', () => {
  it('adds to supply, uses a refill, creates a refill event, and refreshes reminders', async () => {
    await wrap(<RecordRefillScreen medicationId={metformin} />);
    await screen.findByText('3 refills left on the prescription. Saving this uses one.');
    await fireEvent.changeText(screen.getByLabelText('Quantity added'), '30');
    await fireEvent.changeText(screen.getByLabelText('Note (optional)'), 'Corner Pharmacy');
    expect(screen.getByText('New total: 38 tablets')).toBeTruthy();
    await fireEvent.press(screen.getByText('Save refill'));

    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    expect(await getInventory(db, metformin)).toMatchObject({
      currentQuantity: 38,
      refillsRemaining: 2,
    });
    const [event] = await listRefillEventsForMedication(db, metformin);
    expect(event).toMatchObject({ quantityAdded: 30, note: 'Corner Pharmacy' });
    expect(syncReminders).toHaveBeenCalled();
  });

  it('validates the quantity and date without saving', async () => {
    await wrap(<RecordRefillScreen medicationId={metformin} />);
    await screen.findByLabelText('Quantity added');
    await fireEvent.press(screen.getByText('Save refill'));
    expect(await screen.findByText('Enter how much you picked up.')).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText('Quantity added'), '10');
    await fireEvent.changeText(screen.getByLabelText('Date picked up'), '2999-01-01');
    await fireEvent.press(screen.getByText('Save refill'));
    expect(await screen.findByText("That date hasn't happened yet.")).toBeTruthy();
    expect(mockRouter.back).not.toHaveBeenCalled();
    expect((await getInventory(db, metformin))?.currentQuantity).toBe(8);
    expect(await listRefillEventsForMedication(db, metformin)).toHaveLength(0);
  });

  it('asks to set up supply first when none is tracked', async () => {
    const bare = (
      await createMedication(db, {
        name: 'Bare',
        dosageAmount: 1,
        dosageUnit: 'mg',
        form: 'tablet',
      })
    ).id;
    await wrap(<RecordRefillScreen medicationId={bare} />);
    await fireEvent.press(await screen.findByText('Set up supply'));
    expect(mockRouter.replace).toHaveBeenCalledWith(`/medications/${bare}/edit`);
  });
});

describe('medication detail and list', () => {
  it('shows run-out date, refills left, pharmacy, history, and a Call pharmacy button', async () => {
    await recordRefill(db, { medicationId: metformin, quantityAdded: 10, note: 'Picked up' });
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await wrap(<MedicationDetailScreen medicationId={metformin} />);

    expect(await screen.findByText('Estimated to run out')).toBeTruthy();
    expect(screen.getByText(/about 9 days left/)).toBeTruthy(); // 18 tablets at 2/day
    expect(screen.getByText('Refills left on the prescription')).toBeTruthy();
    expect(screen.getByText('Corner Pharmacy · (555) 123-4567')).toBeTruthy();
    expect(screen.getByText('Refill history')).toBeTruthy();
    expect(screen.getByText('+10 tablets')).toBeTruthy();
    expect(screen.getByText('Picked up')).toBeTruthy();

    await fireEvent.press(screen.getByText('Call pharmacy'));
    expect(open).toHaveBeenCalledWith('tel:5551234567');
    await fireEvent.press(screen.getByText('Record refill'));
    expect(mockRouter.push).toHaveBeenCalledWith(`/medications/${metformin}/refill`);
  });

  it('hides Call pharmacy without a number and says how to add one', async () => {
    await wrap(<MedicationDetailScreen medicationId={lisinopril} />);
    await screen.findByText('Estimated to run out');
    expect(screen.queryByText('Call pharmacy')).toBeNull();
    expect(screen.getByText(/Add the pharmacy phone number in Edit/)).toBeTruthy();
  });

  it('says why an as-needed medication has no estimate', async () => {
    await wrap(<MedicationDetailScreen medicationId={ibuprofen} />);
    expect(await screen.findByText(/Can't estimate yet/)).toBeTruthy();
  });

  it('shows a supply indicator and low-supply badge on the list', async () => {
    await wrap(<MedicationListScreen />);
    expect(await screen.findByText('Supply: 8 tablets · about 4 days left')).toBeTruthy();
    const badges = screen.getAllByTestId('low-supply-badge');
    expect(badges).toHaveLength(1);
    expect(within(badges[0]).getByText(/Low supply/)).toBeTruthy();
    expect(screen.getByText(/Supply: 100 tablets/)).toBeTruthy();
  });
});
