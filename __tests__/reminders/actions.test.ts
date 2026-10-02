import {
  createInventory,
  createMedication,
  getInventory,
  listRecentDoseLogs,
  recordDose,
} from '@/db/repositories';
import type { Database } from '@/db/types';
import { handleNotificationResponse, type ResponseLike } from '@/features/reminders/actions';
import { ACTION_SKIP, ACTION_SNOOZE, ACTION_TAKEN } from '@/features/reminders/constants';
import { snoozeNotificationId } from '@/features/reminders/planner';
import { FakePort } from '../helpers/fakePort';
import { createTestDb } from '../helpers/testDb';

const SCHEDULED = '2026-06-10T12:00:00.000Z';
const NOW = new Date('2026-06-10T12:00:05.000Z');

let db: Database;
let port: FakePort;
let medId: number;

const response = (
  actionIdentifier: string,
  data: Record<string, unknown> | null = {
    medicationId: medId,
    scheduledFor: SCHEDULED,
    quantity: 2,
  },
): ResponseLike => ({
  actionIdentifier,
  notification: {
    request: {
      identifier: `dose:${medId}:${SCHEDULED}`,
      content: { title: 'Time for Metformin', body: '500 mg', data: data ?? undefined },
    },
  },
});

const act = (r: ResponseLike) => handleNotificationResponse({ db, port, now: () => NOW }, r);
const logs = () => listRecentDoseLogs(db, medId);
const supply = async () => (await getInventory(db, medId))?.currentQuantity;

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
  await createInventory(db, { medicationId: medId, currentQuantity: 10, unit: 'tablets' });
});

describe('handleNotificationResponse', () => {
  it('Taken logs the dose, uses up supply, and dismisses the notification', async () => {
    const outcome = await act(response(ACTION_TAKEN));
    expect(outcome).toEqual({ type: 'logged', status: 'taken', medicationId: medId });
    const [log] = await logs();
    expect(log).toMatchObject({ status: 'taken', scheduledFor: SCHEDULED, quantity: 2 });
    expect(await supply()).toBe(8);
    expect(port.dismissed).toContain(`dose:${medId}:${SCHEDULED}`);
  });

  it('is idempotent: handling the same response twice logs and counts once', async () => {
    await act(response(ACTION_TAKEN));
    await act(response(ACTION_TAKEN));
    expect(await logs()).toHaveLength(1);
    expect(await supply()).toBe(8);
  });

  it('Skip logs a skipped dose without touching supply', async () => {
    await act(response(ACTION_SKIP));
    expect((await logs())[0]).toMatchObject({ status: 'skipped', quantity: null });
    expect(await supply()).toBe(10);
  });

  it('changing Taken to Skip gives the supply back', async () => {
    await act(response(ACTION_TAKEN));
    await act(response(ACTION_SKIP));
    expect((await logs())[0].status).toBe('skipped');
    expect(await supply()).toBe(10);
  });

  it('Snooze logs a snoozed dose and schedules a reminder 10 minutes later', async () => {
    const outcome = await act(response(ACTION_SNOOZE));
    expect(outcome).toMatchObject({ type: 'logged', status: 'snoozed' });
    expect((await logs())[0].status).toBe('snoozed');
    expect(await supply()).toBe(10);
    const pending = port.pending.get(snoozeNotificationId(medId, SCHEDULED));
    expect(pending?.fireAt.toISOString()).toBe('2026-06-10T12:10:05.000Z');
    expect(pending?.title).toBe('Time for Metformin');
  });

  it('Taken after a snooze replaces the log and cancels the pending snooze', async () => {
    await act(response(ACTION_SNOOZE));
    await act(response(ACTION_TAKEN));
    const all = await logs();
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe('taken');
    expect(port.pending.size).toBe(0);
  });

  it('a late Snooze does not undo a dose already taken', async () => {
    await act(response(ACTION_TAKEN));
    const outcome = await act(response(ACTION_SNOOZE));
    expect(outcome).toEqual({ type: 'ignored' });
    expect((await logs())[0].status).toBe('taken');
    expect(port.pending.size).toBe(0);
  });

  it('tapping the notification itself opens the medication without logging', async () => {
    const outcome = await act(response('expo.modules.notifications.actions.DEFAULT'));
    expect(outcome).toEqual({ type: 'open', medicationId: medId });
    expect(await logs()).toHaveLength(0);
  });

  it('ignores responses without usable dose data', async () => {
    expect(await act(response(ACTION_TAKEN, null))).toEqual({ type: 'ignored' });
    expect(
      await act(response(ACTION_TAKEN, { medicationId: 'x', scheduledFor: SCHEDULED })),
    ).toEqual({
      type: 'ignored',
    });
    expect(
      await act(response(ACTION_TAKEN, { medicationId: medId, scheduledFor: 'nope' })),
    ).toEqual({
      type: 'ignored',
    });
    expect(await logs()).toHaveLength(0);
  });

  it('works for a medication without tracked supply', async () => {
    const other = await createMedication(db, {
      name: 'Aspirin',
      dosageAmount: 81,
      dosageUnit: 'mg',
      form: 'tablet',
    });
    const r = response(ACTION_TAKEN, { medicationId: other.id, scheduledFor: SCHEDULED });
    expect(await act(r)).toMatchObject({ type: 'logged', status: 'taken' });
  });

  it('keeps an existing log untouched when the same dose is recorded elsewhere first', async () => {
    await recordDose(db, {
      medicationId: medId,
      scheduledFor: SCHEDULED,
      status: 'taken',
      quantity: 2,
    });
    await act(response(ACTION_TAKEN));
    expect(await supply()).toBe(10); // already counted by whoever logged it first
  });
});
