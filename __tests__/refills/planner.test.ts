import type { RefillAlertState } from '@/db/repositories';
import {
  nextReminderTime,
  planRefillReminders,
  refillNotificationId,
  type RefillInput,
} from '@/features/refills/planner';
import { localString } from '../helpers/fakePort';

const EMPTY: RefillAlertState = { lowSince: null, lowQuantity: null, doctorSince: null };
const NOW = new Date(2026, 5, 10, 14, 0); // Wed Jun 10 2026, 14:00 local

const input = (over: Partial<RefillInput> = {}): RefillInput => ({
  medicationId: 7,
  name: 'Metformin',
  quantity: 5,
  low: true,
  refillsRemaining: 3,
  pharmacyName: null,
  state: EMPTY,
  ...over,
});
const plan = (over: Partial<RefillInput> = {}, now = NOW) => planRefillReminders(input(over), now);
const times = (p: ReturnType<typeof plan>) =>
  p.reminders.map((r) => [r.kind, localString(r.fireAt)]);

describe('nextReminderTime', () => {
  it('is 09:00 today before 9, otherwise 09:00 tomorrow', () => {
    expect(localString(nextReminderTime(new Date(2026, 5, 10, 8, 0).toISOString()))).toBe(
      '2026-06-10 09:00',
    );
    expect(localString(nextReminderTime(new Date(2026, 5, 10, 9, 0).toISOString()))).toBe(
      '2026-06-11 09:00',
    );
    expect(localString(nextReminderTime(new Date(2026, 5, 10, 23, 59).toISOString()))).toBe(
      '2026-06-11 09:00',
    );
  });
});

describe('low-supply reminders', () => {
  it('starts an episode and plans a first reminder, then a second two days later', () => {
    const p = plan();
    expect(p.state).toEqual({ lowSince: NOW.toISOString(), lowQuantity: 5, doctorSince: null });
    expect(times(p)).toEqual([
      ['1', '2026-06-11 09:00'],
      ['2', '2026-06-13 09:00'],
    ]);
    expect(p.reminders.map((r) => r.id)).toEqual(['refill:7:1', 'refill:7:2']);
    expect(p.reminders[0]).toMatchObject({ title: 'Time to refill Metformin' });
    expect(p.reminders[0].body).toBe('Supply is running low. Refill it soon.');
    expect(p.reminders[1].title).toBe('Reminder: refill Metformin');
  });

  it('delivers the first reminder the same morning when noticed before 9', () => {
    expect(times(plan({}, new Date(2026, 5, 10, 8, 0)))).toEqual([
      ['1', '2026-06-10 09:00'],
      ['2', '2026-06-12 09:00'],
    ]);
  });

  it('mentions the pharmacy when known', () => {
    expect(plan({ pharmacyName: 'Corner Pharmacy' }).reminders[0].body).toBe(
      'Supply is running low. Refill it soon at Corner Pharmacy.',
    );
  });

  it('does not plan a reminder whose time has already passed', () => {
    const state = { ...EMPTY, lowSince: new Date(2026, 5, 9, 20, 0).toISOString(), lowQuantity: 5 };
    expect(times(plan({ state }, new Date(2026, 5, 10, 14, 0)))).toEqual([
      ['2', '2026-06-12 09:00'],
    ]);
    expect(plan({ state }, new Date(2026, 5, 13, 10, 0)).reminders).toEqual([]);
  });

  it('keeps the episode start so repeated checks do not move the reminders', () => {
    const first = plan();
    const later = plan({ state: first.state }, new Date(2026, 5, 10, 18, 0));
    expect(later.state.lowSince).toBe(first.state.lowSince);
    expect(times(later)).toEqual(times(first));
  });

  it('never produces more than two reminders per episode, however often it is checked', () => {
    let state = EMPTY;
    const fired = new Set<string>();
    const start = new Date(2026, 5, 10, 14, 0).getTime();
    for (let hour = 0; hour < 24 * 30; hour++) {
      const now = new Date(start + hour * 3_600_000);
      const p = planRefillReminders(input({ state }), now);
      state = p.state;
      const until = now.getTime() + 3_600_000;
      for (const r of p.reminders) if (r.fireAt.getTime() <= until) fired.add(r.id);
    }
    expect([...fired].sort()).toEqual(['refill:7:1', 'refill:7:2']);
  });

  it('plans nothing when supply is fine and clears the episode', () => {
    const state = { ...EMPTY, lowSince: NOW.toISOString(), lowQuantity: 5 };
    const p = plan({ low: false, quantity: 40, state });
    expect(p.reminders).toEqual([]);
    expect(p.state).toEqual(EMPTY);
  });

  it('starts a fresh episode after a refill that still leaves supply low', () => {
    const state = { ...EMPTY, lowSince: new Date(2026, 5, 1, 9, 0).toISOString(), lowQuantity: 2 };
    const p = plan({ quantity: 6, state });
    expect(p.state).toEqual({ lowSince: NOW.toISOString(), lowQuantity: 6, doctorSince: null });
    expect(p.reminders).toHaveLength(2);
  });

  it('a new low after a full refill is a new episode', () => {
    let p = plan();
    p = planRefillReminders(input({ low: false, quantity: 60, state: p.state }), NOW);
    expect(p.state).toEqual(EMPTY);
    const later = new Date(2026, 6, 20, 10, 0);
    p = planRefillReminders(input({ quantity: 5, state: p.state }), later);
    expect(times(p)).toEqual([
      ['1', '2026-07-21 09:00'],
      ['2', '2026-07-23 09:00'],
    ]);
  });

  it('does not restart when supply only briefly rises above the threshold without a refill', () => {
    const first = plan({ quantity: 5 });
    const dipped = planRefillReminders(
      input({ low: false, quantity: 5, state: first.state }),
      new Date(2026, 5, 10, 16, 0),
    );
    expect(dipped.state.lowSince).toBe(first.state.lowSince);
    expect(dipped.reminders).toEqual([]);
    const lowAgain = planRefillReminders(
      input({ quantity: 5, state: dipped.state }),
      new Date(2026, 5, 10, 17, 0),
    );
    expect(lowAgain.state.lowSince).toBe(first.state.lowSince);
    expect(lowAgain.reminders.map((r) => r.id)).toEqual(['refill:7:1', 'refill:7:2']);
  });

  it('tracks the lowest quantity so a later refill is recognised', () => {
    const first = plan({ quantity: 5 });
    const lower = planRefillReminders(input({ quantity: 3, state: first.state }), NOW);
    expect(lower.state.lowQuantity).toBe(3);
    const refilled = planRefillReminders(input({ quantity: 4, state: lower.state }), NOW);
    expect(refilled.state.lowSince).toBe(NOW.toISOString()); // 4 > 3: new episode
  });

  it('delivers at 09:00 local on both sides of a DST change', () => {
    const spring = plan({}, new Date(2026, 2, 7, 22, 0));
    expect(spring.reminders.map((r) => r.fireAt.toISOString())).toEqual([
      '2026-03-08T13:00:00.000Z', // 09:00 EDT
      '2026-03-10T13:00:00.000Z',
    ]);
    const fall = plan({}, new Date(2026, 9, 31, 22, 0));
    expect(fall.reminders.map((r) => r.fireAt.toISOString())).toEqual([
      '2026-11-01T14:00:00.000Z', // 09:00 EST
      '2026-11-03T14:00:00.000Z',
    ]);
  });
});

describe('no refills remaining (contact the doctor)', () => {
  it('plans a single doctor reminder at the next 09:00 when supply is not low', () => {
    const p = plan({ low: false, quantity: 30, refillsRemaining: 0 });
    expect(p.reminders).toHaveLength(1);
    expect(p.reminders[0]).toMatchObject({
      id: refillNotificationId(7, 'doctor'),
      title: 'No refills left for Metformin',
      body: 'Contact your doctor for a new prescription.',
    });
    expect(localString(p.reminders[0].fireAt)).toBe('2026-06-11 09:00');
    expect(p.state.doctorSince).toBe(NOW.toISOString());
  });

  it('is sent once: not planned again after its time has passed', () => {
    const first = plan({ low: false, quantity: 30, refillsRemaining: 0 });
    const after = planRefillReminders(
      input({ low: false, quantity: 30, refillsRemaining: 0, state: first.state }),
      new Date(2026, 5, 11, 12, 0),
    );
    expect(after.reminders).toEqual([]);
    expect(after.state.doctorSince).toBe(first.state.doctorSince);
  });

  it('is cleared when refills are available again or not tracked', () => {
    const first = plan({ low: false, quantity: 30, refillsRemaining: 0 });
    for (const refillsRemaining of [2, null]) {
      const p = planRefillReminders(
        input({ low: false, quantity: 30, refillsRemaining, state: first.state }),
        NOW,
      );
      expect(p.state.doctorSince).toBeNull();
      expect(p.reminders).toEqual([]);
    }
  });

  it('folds the message into the low-supply reminders instead of sending two', () => {
    const p = plan({ refillsRemaining: 0 });
    expect(p.reminders.map((r) => r.kind)).toEqual(['1', '2']);
    expect(p.reminders[0].body).toBe(
      'Supply is running low and no refills are left. Contact your doctor for a new prescription.',
    );
  });

  it('does not nag about refills when none are tracked', () => {
    expect(plan({ low: false, refillsRemaining: null }).reminders).toEqual([]);
  });
});
