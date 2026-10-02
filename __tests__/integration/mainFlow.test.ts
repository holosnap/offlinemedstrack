/**
 * End-to-end flows through the real data layer, with a fake notification center and a controllable
 * clock. "Receiving" a reminder means the fake OS delivers the pending notification; tapping a
 * button builds the same response object the OS gives the app.
 */
import {
  getInventory,
  getRefillAlert,
  listRefillEventsForMedication,
  listRecentDoseLogs,
} from '@/db/repositories';
import type { Database } from '@/db/types';
import { takeDose, undoDose } from '@/features/doses/doseActions';
import { markMissedDoses } from '@/features/doses/missed';
import { loadHistory } from '@/features/history/data';
import {
  emptyFormValues,
  formValuesFromStored,
  validateForm,
  type FormValues,
} from '@/features/medications/form';
import {
  loadMedicationForEdit,
  removeMedication,
  saveMedication,
  setActive,
} from '@/features/medications/data';
import { saveRefill } from '@/features/refills/data';
import { handleNotificationResponse, type ResponseLike } from '@/features/reminders/actions';
import { ACTION_SNOOZE, ACTION_TAKEN } from '@/features/reminders/constants';
import { updateSettings } from '@/features/settings/settings';
import { loadToday } from '@/features/today/data';
import { FakePort, localString, withTimeZone } from '../helpers/fakePort';
import { createTestDb } from '../helpers/testDb';

const mockState = { port: null as unknown as FakePort, now: new Date(2026, 5, 10, 7, 0) };

jest.mock('@/features/reminders/sync', () => ({
  syncReminders: jest.fn(async (db: Database) => {
    const actual = jest.requireActual<typeof import('@/features/reminders/reconcile')>(
      '@/features/reminders/reconcile',
    );
    await actual.reconcile({ db, port: mockState.port, now: () => mockState.now });
  }),
}));

const DEFAULT_ACTION = 'expo.modules.notifications.actions.DEFAULT';
const at = (day: number, h: number, m = 0, s = 0) => new Date(2026, 5, day, h, m, s);

let db: Database;
let nowSpy: jest.SpyInstance;

const port = () => mockState.port;
const clock = (d: Date) => {
  mockState.now = d;
};
const ids = (prefix: string) =>
  [...port().pending.keys()].filter((id) => id.startsWith(prefix)).sort();

/** The fake OS delivers a pending notification: it leaves the schedule and appears in the shade. */
function deliver(id: string) {
  const request = port().pending.get(id);
  if (!request) throw new Error(`No pending notification ${id}`);
  port().pending.delete(id);
  port().presented.push({
    identifier: id,
    medicationId: (request.data.medicationId as number) ?? null,
  });
  return request;
}

/** What the app receives when the person taps the notification or one of its buttons. */
const responseTo = (
  request: ReturnType<typeof deliver>,
  actionIdentifier = DEFAULT_ACTION,
): ResponseLike => ({
  actionIdentifier,
  notification: {
    request: {
      identifier: request.identifier,
      content: { title: request.title, body: request.body, data: request.data },
    },
  },
});

const respond = (response: ResponseLike) =>
  handleNotificationResponse({ db, port: port(), now: () => mockState.now }, response);

const validFormFor = (over: Partial<FormValues> = {}) => {
  const result = validateForm({
    ...emptyFormValues(mockState.now),
    name: 'Metformin',
    dosageAmount: '500',
    times: ['8:00 AM', '8:00 PM'],
    doseQuantity: '1',
    currentQuantity: '6',
    refillThreshold: '2',
    refillThresholdUnit: 'days',
    refillsRemaining: '1',
    pharmacyName: 'Corner Pharmacy',
    pharmacyPhone: '(555) 123-4567',
    ...over,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.value;
};

const syncNow = async () => {
  const { syncReminders } = jest.requireMock('@/features/reminders/sync') as {
    syncReminders: (db: Database) => Promise<void>;
  };
  await syncReminders(db);
};

beforeEach(async () => {
  mockState.port = new FakePort();
  clock(at(10, 7));
  nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => mockState.now.getTime());
  db = await createTestDb();
});
afterEach(() => nowSpy.mockRestore());

describe('main flow: add medication → reminder → log dose → supply drops → refill reminder → record refill', () => {
  it('works end to end', async () => {
    // 1. Add a medication (7:00 AM Wednesday).
    const medId = await saveMedication(db, null, validFormFor());
    expect(port().localTimes().slice(0, 3)).toEqual([
      '2026-06-10 08:00',
      '2026-06-10 20:00',
      '2026-06-11 08:00',
    ]);
    expect(ids('refill:')).toEqual([]); // 6 tablets last 3 days: not low yet

    // 2. The 8:00 reminder arrives and the person taps "Taken" in the notification.
    clock(at(10, 8, 0, 2));
    const reminder = deliver(`dose:${medId}:${at(10, 8).toISOString()}`);
    expect(reminder.title).toBe('Time for Metformin');
    expect(port().presented.map((p) => p.identifier)).toContain(reminder.identifier);
    const outcome = await respond(responseTo(reminder, ACTION_TAKEN));
    expect(outcome).toEqual({ type: 'logged', status: 'taken', medicationId: medId });
    expect(port().presented).toEqual([]); // dismissed from the shade

    // 3. The dose is logged and supply went down.
    expect((await getInventory(db, medId))?.currentQuantity).toBe(5);
    const [log] = await listRecentDoseLogs(db, medId, 5);
    expect(log).toMatchObject({
      status: 'taken',
      quantity: 1,
      scheduledFor: at(10, 8).toISOString(),
    });

    // 4. The app (back in the foreground) re-checks reminders: supply is now low, so refill
    //    reminders are scheduled, once, for 9:00 today and 9:00 two days later.
    await syncNow();
    expect(ids('refill:')).toEqual([`refill:${medId}:1`, `refill:${medId}:2`]);
    expect(localString(port().pending.get(`refill:${medId}:1`)!.fireAt)).toBe('2026-06-10 09:00');
    expect(localString(port().pending.get(`refill:${medId}:2`)!.fireAt)).toBe('2026-06-12 09:00');
    expect(port().localTimes()[0]).toBe('2026-06-10 20:00'); // the taken 8:00 dose isn't repeated

    // 5. The refill reminder fires; tapping it opens the medication.
    clock(at(10, 9, 0, 1));
    const refill = deliver(`refill:${medId}:1`);
    expect(refill.title).toBe('Time to refill Metformin');
    expect(refill.body).toContain('Corner Pharmacy');
    expect(await respond(responseTo(refill))).toEqual({ type: 'open', medicationId: medId });
    await syncNow();
    expect(ids('refill:')).toEqual([`refill:${medId}:2`]); // not sent again

    // 6. Evening dose taken in the app; the follow-up reminder two days later still fires once.
    clock(at(10, 20, 3));
    await takeDose(
      { db, port: port(), now: () => mockState.now },
      { medicationId: medId, scheduledFor: at(10, 20).toISOString(), quantity: 1 },
    );
    await syncNow();
    expect((await getInventory(db, medId))?.currentQuantity).toBe(4);
    expect(ids('refill:')).toEqual([`refill:${medId}:2`]);
    clock(at(12, 9, 0, 1));
    deliver(`refill:${medId}:2`);
    await syncNow();
    expect(ids('refill:')).toEqual([]); // two reminders per episode, never more

    // 7. The prescription is picked up: supply and refills update, a record is kept, and the
    //    last refill triggers a single "contact your doctor" reminder.
    clock(at(12, 10));
    await saveRefill(db, {
      medicationId: medId,
      quantityAdded: 30,
      date: mockState.now,
      note: 'Picked up',
    });
    expect(await getInventory(db, medId)).toMatchObject({
      currentQuantity: 34,
      refillsRemaining: 0,
    });
    const events = await listRefillEventsForMedication(db, medId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ quantityAdded: 30, note: 'Picked up' });
    expect(await getRefillAlert(db, medId)).toMatchObject({ lowSince: null, lowQuantity: null });
    expect(ids('refill:')).toEqual([`refill:${medId}:doctor`]);
    expect(port().pending.get(`refill:${medId}:doctor`)?.body).toBe(
      'Contact your doctor for a new prescription.',
    );
  });

  it('does not repeat reminders for doses already handled in the app', async () => {
    const medId = await saveMedication(db, null, validFormFor({ currentQuantity: '60' }));
    clock(at(10, 7, 30));
    await takeDose(
      { db, port: port(), now: () => mockState.now },
      { medicationId: medId, scheduledFor: at(10, 8).toISOString(), quantity: 1 },
    );
    await syncNow();
    expect(port().localTimes()[0]).toBe('2026-06-10 20:00');
  });

  it('snoozing from a reminder schedules a follow-up that later disappears once the dose is taken', async () => {
    const medId = await saveMedication(db, null, validFormFor({ currentQuantity: '60' }));
    clock(at(10, 8, 0, 1));
    const reminder = deliver(`dose:${medId}:${at(10, 8).toISOString()}`);
    await respond(responseTo(reminder, ACTION_SNOOZE));
    const snoozeId = `snooze:${medId}:${at(10, 8).toISOString()}`;
    expect(localString(port().pending.get(snoozeId)!.fireAt)).toBe('2026-06-10 08:10');

    clock(at(10, 8, 12));
    await takeDose(
      { db, port: port(), now: () => mockState.now },
      { medicationId: medId, scheduledFor: at(10, 8).toISOString(), quantity: 1 },
    );
    await syncNow();
    expect(port().pending.has(snoozeId)).toBe(false);
  });
});

describe('device restart, app update, and time zone changes', () => {
  it('re-creates reminders the OS lost, and changes nothing when they are all still there', async () => {
    await saveMedication(db, null, validFormFor({ currentQuantity: '60' }));
    const before = [...port().pending.keys()].sort();
    expect(before.length).toBeGreaterThan(5);

    // Launch / foreground with everything intact: nothing to do.
    const calls = port().scheduleCalls + port().cancelCalls;
    await syncNow();
    expect(port().scheduleCalls + port().cancelCalls).toBe(calls);

    // The OS lost its schedule (e.g. app data cleared, a restore onto a new phone).
    port().pending.clear();
    await syncNow();
    expect([...port().pending.keys()].sort()).toEqual(before);
  });

  it('after the phone has been off, only reminders still in the future are scheduled', async () => {
    await saveMedication(db, null, validFormFor({ currentQuantity: '60' }));
    port().pending.clear(); // phone was off through the 8:00 dose
    clock(at(10, 12));
    await syncNow();
    expect(port().localTimes()[0]).toBe('2026-06-10 20:00');
  });

  it('moves reminders to the same local wall-clock times after a time zone change', async () => {
    await saveMedication(db, null, validFormFor({ currentQuantity: '60' }));
    expect(port().localTimes().slice(0, 2)).toEqual(['2026-06-10 08:00', '2026-06-10 20:00']);
    const newYork = port().pending.get(`dose:1:${at(10, 20).toISOString()}`);
    expect(newYork).toBeDefined();

    await withTimeZone('Asia/Tokyo', async () => {
      clock(new Date('2026-06-10T00:00:00.000Z')); // 09:00 in Tokyo
      await syncNow();
      expect(port().localTimes().slice(0, 2)).toEqual(['2026-06-10 20:00', '2026-06-11 08:00']);
      expect(
        port()
          .localTimes()
          .every((t) => t.endsWith('08:00') || t.endsWith('20:00')),
      ).toBe(true);
    });
  });

  it('survives an app update that changes notification wording', async () => {
    const medId = await saveMedication(db, null, validFormFor({ currentQuantity: '60' }));
    // Old build scheduled different text; the current build replaces it.
    const stale = port().pending.get(`dose:${medId}:${at(10, 8).toISOString()}`)!;
    port().pending.set(stale.identifier, {
      ...stale,
      title: 'Old wording',
      data: { ...stale.data, content: 'Old wording\n500 mg\nsound' },
    });
    await syncNow();
    expect(port().pending.get(stale.identifier)?.title).toBe('Time for Metformin');
  });

  it('keeps reminders going: a notice follows the last scheduled reminder, and moves as the window rolls', async () => {
    await saveMedication(db, null, validFormFor({ currentQuantity: '600' }));
    const first = ids('nudge:');
    expect(first).toHaveLength(1);
    const last = [...port().pending.values()]
      .filter((r) => r.identifier.startsWith('dose:'))
      .at(-1)!;
    expect(port().pending.get(first[0])!.fireAt.getTime()).toBe(last.fireAt.getTime() + 60_000);
    expect(port().pending.get(first[0])!.title).toBe('Keep your reminders going');

    clock(at(14, 12)); // days later, the app is opened again
    await syncNow();
    expect(ids('nudge:')).toHaveLength(1);
    expect(ids('nudge:')[0]).not.toBe(first[0]); // replaced, not accumulated
  });

  it('adds no notice when the schedule ends inside the window', async () => {
    const value = validFormFor({ currentQuantity: '60' });
    value.schedule.endDate = '2026-06-12';
    await saveMedication(db, null, value);
    expect(ids('nudge:')).toEqual([]);
  });
});

describe('editing a schedule mid-day', () => {
  async function setup() {
    const medId = await saveMedication(
      db,
      null,
      validFormFor({ times: ['8:00 AM'], currentQuantity: '60' }),
    );
    clock(at(10, 8, 10));
    const reminder = deliver(`dose:${medId}:${at(10, 8).toISOString()}`);
    await respond(responseTo(reminder, ACTION_TAKEN));
    clock(at(10, 8, 30));
    return medId;
  }
  const edit = async (medId: number, changes: Partial<FormValues>) => {
    const stored = await loadMedicationForEdit(db, medId);
    if (!stored) throw new Error('missing');
    const values = {
      ...formValuesFromStored(stored.medication, stored.schedule, stored.inventory, mockState.now),
      ...changes,
    };
    const result = validateForm(values);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    await saveMedication(db, medId, result.value);
  };

  it('does not duplicate a dose that was already logged when its time is changed', async () => {
    const medId = await setup();
    await edit(medId, { times: ['9:00 AM'] });

    const today = await loadToday(db, at(10, 8, 35));
    expect(today.doses.map((d) => [d.time, d.status])).toEqual([['08:00', 'taken']]);
    expect(port().localTimes()[0]).toBe('2026-06-11 09:00'); // no second reminder today

    await markMissedDoses(db, at(12, 12), 120);
    const logs = (await listRecentDoseLogs(db, medId, 20)).filter(
      (l) => new Date(l.scheduledFor).getDate() === 10,
    );
    expect(logs.map((l) => l.status)).toEqual(['taken']);
    expect((await getInventory(db, medId))?.currentQuantity).toBe(59); // used once
    const history = await loadHistory(db, { year: 2026, month: 6 }, at(12, 12));
    expect(history.days.get('2026-06-10')).toMatchObject({
      status: 'all_taken',
      expected: 1,
      taken: 1,
    });
  });

  it('still reminds about the other doses of the day', async () => {
    const medId = await saveMedication(
      db,
      null,
      validFormFor({ times: ['8:00 AM', '8:00 PM'], currentQuantity: '60' }),
    );
    clock(at(10, 8, 10));
    await takeDose(
      { db, port: port(), now: () => mockState.now },
      { medicationId: medId, scheduledFor: at(10, 8).toISOString(), quantity: 1 },
    );
    clock(at(10, 8, 30));
    await edit(medId, { times: ['9:00 AM', '9:00 PM'] });
    expect(port().localTimes()[0]).toBe('2026-06-10 21:00');
    const today = await loadToday(db, at(10, 8, 35));
    expect(today.doses.map((d) => [d.time, d.status])).toEqual([
      ['08:00', 'taken'],
      ['21:00', 'upcoming'],
    ]);
  });

  it('keeps today’s unlogged earlier doses when only the quantity or end date changes', async () => {
    const medId = await saveMedication(
      db,
      null,
      validFormFor({ times: ['8:00 AM', '12:00 PM', '8:00 PM'], currentQuantity: '60' }),
    );
    clock(at(10, 15));
    await edit(medId, { doseQuantity: '2' });
    const today = await loadToday(db, at(10, 15, 5));
    expect(today.doses.map((d) => d.time)).toEqual(['08:00', '12:00', '20:00']);
  });
});

describe('supply never goes negative', () => {
  it('stops at zero, warns, and gives back exactly what was used', async () => {
    const medId = await saveMedication(
      db,
      null,
      validFormFor({ times: ['8:00 AM'], doseQuantity: '2', currentQuantity: '1' }),
    );
    clock(at(10, 8, 5));
    const ref = { medicationId: medId, scheduledFor: at(10, 8).toISOString(), quantity: 2 };
    const result = await takeDose({ db, port: port(), now: () => mockState.now }, ref);
    expect((await getInventory(db, medId))?.currentQuantity).toBe(0);
    expect(result.shortfall).toBe(1);

    await syncNow(); // out of supply: the person is told to refill
    expect(ids('refill:')).toEqual([`refill:${medId}:1`, `refill:${medId}:2`]);

    await undoDose({ db, port: port() }, ref, result.prior);
    expect((await getInventory(db, medId))?.currentQuantity).toBe(1);
  });
});

describe('deleting or pausing a medication', () => {
  it('cancels every notification kind, clears the shade, and leaves no rows behind', async () => {
    const medId = await saveMedication(db, null, validFormFor());
    clock(at(10, 8, 0, 1));
    const reminder = deliver(`dose:${medId}:${at(10, 8).toISOString()}`);
    await respond(responseTo(reminder, ACTION_SNOOZE)); // a snooze reminder, still in the shade
    await takeDose(
      { db, port: port(), now: () => mockState.now },
      { medicationId: medId, scheduledFor: at(10, 20).toISOString(), quantity: 1 },
    ); // low supply → refill reminders
    await syncNow();
    expect(ids('refill:').length).toBeGreaterThan(0);
    expect(ids('nudge:').length + ids('dose:').length + ids('snooze:').length).toBeGreaterThan(0);
    port().presented.push({ identifier: `dose:${medId}:old`, medicationId: medId });

    await removeMedication(db, medId);
    expect([...port().pending.keys()]).toEqual([]);
    expect(port().presented).toEqual([]);
    for (const table of [
      'medications',
      'schedules',
      'dose_logs',
      'inventory',
      'refill_events',
      'refill_alerts',
    ]) {
      expect(await db.getAllAsync(`SELECT * FROM ${table}`)).toEqual([]);
    }

    // A button tapped on a notification that was already delivered is ignored.
    const tapped = await respond(responseTo(reminder, ACTION_TAKEN));
    expect(tapped).toEqual({ type: 'ignored' });
    expect(await db.getAllAsync('SELECT * FROM dose_logs')).toEqual([]);
  });

  it('pausing cancels reminders and resuming brings them back', async () => {
    const medId = await saveMedication(db, null, validFormFor({ currentQuantity: '60' }));
    expect(ids('dose:').length).toBeGreaterThan(0);
    await setActive(db, medId, false);
    expect([...port().pending.keys()]).toEqual([]);
    await setActive(db, medId, true);
    expect(ids('dose:').length).toBeGreaterThan(0);
  });

  it('turning notification sound off makes every pending reminder silent', async () => {
    await saveMedication(db, null, validFormFor({ currentQuantity: '60' }));
    await updateSettings(db, { soundEnabled: false });
    await syncNow();
    expect([...port().pending.values()].every((r) => !r.sound)).toBe(true);
  });
});
