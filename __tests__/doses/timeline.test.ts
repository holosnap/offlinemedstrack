import type { DoseLog, Medication, Schedule } from '@/db/models';
import {
  buildAsNeeded,
  buildTimeline,
  describeAmount,
  groupDoses,
  isMissed,
  expandSlots,
} from '@/features/doses/timeline';
import { localToUtc } from '@/lib/time';

const med = (over: Partial<Medication> = {}): Medication => ({
  id: 1,
  name: 'Metformin',
  dosageAmount: 500,
  dosageUnit: 'mg',
  form: 'tablet',
  instructions: null,
  color: null,
  icon: null,
  active: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

let nextId = 1;
const schedule = (over: Partial<Schedule> = {}): Schedule => ({
  id: nextId++,
  medicationId: 1,
  type: 'daily',
  times: ['08:00'],
  daysOfWeek: null,
  intervalDays: null,
  startDate: '2026-01-01',
  endDate: null,
  doseQuantity: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

const log = (over: Partial<DoseLog> & Pick<DoseLog, 'scheduledFor' | 'status'>): DoseLog => ({
  id: nextId++,
  medicationId: 1,
  actedAt: null,
  quantity: null,
  note: null,
  createdAt: '2026-06-10T00:00:00.000Z',
  updatedAt: '2026-06-10T00:00:00.000Z',
  ...over,
});

const DATE = '2026-06-10';
const at = (time: string) => localToUtc(DATE, time);
const timeline = (
  now: Date,
  over: { schedules?: Schedule[]; logs?: DoseLog[]; meds?: Medication[]; window?: number } = {},
) =>
  buildTimeline({
    medications: new Map((over.meds ?? [med()]).map((m) => [m.id, m])),
    schedules: over.schedules ?? [schedule({ times: ['08:00', '14:00', '20:00'] })],
    logs: over.logs ?? [],
    date: DATE,
    now,
    missedAfterMinutes: over.window ?? 120,
  });

describe('buildTimeline status', () => {
  it('is upcoming before the time, overdue after it, missed after the window', () => {
    const doses = timeline(new Date(2026, 5, 10, 10, 30));
    expect(doses.map((d) => [d.time, d.status, d.overdue])).toEqual(
      [
        ['08:00', 'overdue', true], // 2.5h late with a 2h window → missed
        ['14:00', 'upcoming', false],
        ['20:00', 'upcoming', false],
      ].map(([t, s, o]) => (t === '08:00' ? [t, 'missed', false] : [t, s, o])),
    );
  });

  it('marks a dose overdue (highlighted) between its time and the missed window', () => {
    const [first] = timeline(new Date(2026, 5, 10, 9, 0));
    expect(first).toMatchObject({ status: 'overdue', overdue: true });
  });

  it('is not overdue exactly at the scheduled time', () => {
    const [first] = timeline(new Date(2026, 5, 10, 8, 0));
    expect(first).toMatchObject({ status: 'upcoming', overdue: false });
  });

  it('becomes missed exactly when the window elapses', () => {
    expect(timeline(new Date(2026, 5, 10, 9, 59))[0].status).toBe('overdue');
    expect(timeline(new Date(2026, 5, 10, 10, 0))[0].status).toBe('missed');
  });

  it('honours a configurable window', () => {
    const now = new Date(2026, 5, 10, 8, 45);
    expect(timeline(now, { window: 30 })[0].status).toBe('missed');
    expect(timeline(now, { window: 60 })[0].status).toBe('overdue');
  });

  it('reflects logged outcomes and never shows them as overdue', () => {
    const logs = [
      log({ scheduledFor: at('08:00'), status: 'taken', actedAt: at('08:05'), quantity: 1 }),
      log({ scheduledFor: at('14:00'), status: 'skipped' }),
    ];
    const doses = timeline(new Date(2026, 5, 10, 23, 0), { logs });
    expect(doses.map((d) => [d.status, d.overdue])).toEqual([
      ['taken', false],
      ['skipped', false],
      ['missed', false],
    ]);
  });

  it('keeps a stored missed log as missed', () => {
    const logs = [log({ scheduledFor: at('08:00'), status: 'missed' })];
    expect(timeline(new Date(2026, 5, 10, 8, 30), { logs })[0].status).toBe('missed');
  });

  it('shows a snoozed dose as snoozed, still highlighted as overdue', () => {
    const logs = [log({ scheduledFor: at('08:00'), status: 'snoozed', actedAt: at('08:01') })];
    const [first] = timeline(new Date(2026, 5, 10, 8, 5), { logs });
    expect(first).toMatchObject({ status: 'snoozed', overdue: true });
  });

  it('turns a snoozed dose into missed once the window has elapsed', () => {
    const logs = [log({ scheduledFor: at('08:00'), status: 'snoozed', actedAt: at('09:50') })];
    expect(timeline(new Date(2026, 5, 10, 10, 5), { logs })[0].status).toBe('missed');
  });

  it('hides unlogged doses from before the schedule was last edited', () => {
    const edited = schedule({
      times: ['08:00', '20:00'],
      updatedAt: new Date(2026, 5, 10, 15, 0).toISOString(),
    });
    const doses = timeline(new Date(2026, 5, 10, 16, 0), { schedules: [edited] });
    expect(doses.map((d) => d.time)).toEqual(['20:00']);
  });

  it('still shows a pre-edit dose the person already logged', () => {
    const edited = schedule({ updatedAt: new Date(2026, 5, 10, 15, 0).toISOString() });
    const logs = [log({ scheduledFor: at('08:00'), status: 'taken', quantity: 1 })];
    const doses = timeline(new Date(2026, 5, 10, 16, 0), { schedules: [edited], logs });
    expect(doses.map((d) => d.status)).toEqual(['taken']);
  });

  it('describes the dose and sorts by time then medication', () => {
    const other = med({ id: 2, name: 'Aspirin', dosageAmount: 81 });
    const doses = timeline(new Date(2026, 5, 10, 6, 0), {
      meds: [med(), other],
      schedules: [
        schedule({ medicationId: 1, times: ['08:00'], doseQuantity: 2 }),
        schedule({ medicationId: 2, times: ['08:00'] }),
      ],
    });
    expect(doses.map((d) => [d.name, d.strength, d.amount])).toEqual([
      ['Metformin', '500 mg', '2 tablets'],
      ['Aspirin', '81 mg', '1 tablet'],
    ]);
  });

  it('skips schedules of unknown medications and non-matching days', () => {
    expect(timeline(new Date(2026, 5, 10, 6, 0), { meds: [] })).toEqual([]);
    const weekday = schedule({ type: 'weekdays', daysOfWeek: [0] }); // Sunday; Jun 10 is Wed
    expect(timeline(new Date(2026, 5, 10, 6, 0), { schedules: [weekday] })).toEqual([]);
  });
});

describe('groupDoses', () => {
  const doses = () =>
    timeline(new Date(2026, 5, 10, 6, 0), {
      schedules: [schedule({ times: ['06:30', '08:00', '12:00', '16:59', '17:00', '21:00'] })],
    });

  it('groups by morning, afternoon, and evening', () => {
    const groups = groupDoses(doses(), 'period');
    expect(groups.map((g) => [g.title, g.doses.map((d) => d.time)])).toEqual([
      ['Morning', ['06:30', '08:00']],
      ['Afternoon', ['12:00', '16:59']],
      ['Evening', ['17:00', '21:00']],
    ]);
  });

  it('groups doses at the same exact time together', () => {
    const two = timeline(new Date(2026, 5, 10, 6, 0), {
      meds: [med(), med({ id: 2, name: 'Aspirin' })],
      schedules: [
        schedule({ medicationId: 1, times: ['08:00', '20:00'] }),
        schedule({ medicationId: 2, times: ['08:00'] }),
      ],
    });
    const groups = groupDoses(two, 'time');
    expect(groups.map((g) => [g.key, g.doses.length])).toEqual([
      ['08:00', 2],
      ['20:00', 1],
    ]);
  });

  it('omits empty periods', () => {
    const only = timeline(new Date(2026, 5, 10, 6, 0));
    expect(groupDoses(only, 'period').map((g) => g.title)).toEqual([
      'Morning',
      'Afternoon',
      'Evening',
    ]);
    const evening = timeline(new Date(2026, 5, 10, 6, 0), {
      schedules: [schedule({ times: ['20:00'] })],
    });
    expect(groupDoses(evening, 'period').map((g) => g.title)).toEqual(['Evening']);
  });
});

describe('isMissed / expandSlots', () => {
  it('expands schedules across several days', () => {
    const slots = expandSlots([schedule({ times: ['08:00'] })], '2026-06-08', '2026-06-10');
    expect(slots).toHaveLength(3);
  });

  it('treats no log and a snoozed log as unresolved, but not other statuses', () => {
    const [slot] = expandSlots([schedule()], DATE, DATE);
    const now = new Date(2026, 5, 10, 12, 0);
    expect(isMissed(slot, null, now, 120)).toBe(true);
    expect(
      isMissed(slot, log({ scheduledFor: slot.scheduledFor, status: 'snoozed' }), now, 120),
    ).toBe(true);
    for (const status of ['taken', 'skipped', 'missed'] as const) {
      expect(isMissed(slot, log({ scheduledFor: slot.scheduledFor, status }), now, 120)).toBe(
        false,
      );
    }
  });
});

describe('describeAmount', () => {
  it('pluralizes countable forms and uses "dose" for the rest', () => {
    expect(describeAmount(med(), 1)).toBe('1 tablet');
    expect(describeAmount(med({ form: 'capsule' }), 0.5)).toBe('0.5 capsules');
    expect(describeAmount(med({ form: 'liquid' }), 1)).toBe('1 dose');
    expect(describeAmount(med({ form: 'inhaler' }), 2)).toBe('2 doses');
  });
});

describe('buildAsNeeded', () => {
  it('lists as-needed medications with today’s taken doses, newest first', () => {
    const entries = buildAsNeeded({
      medications: new Map([
        [1, med({ id: 1, name: 'Ibuprofen' })],
        [2, med({ id: 2, name: 'Daily pill' })],
      ]),
      schedules: [
        schedule({ medicationId: 1, type: 'as_needed', times: [], doseQuantity: 2 }),
        schedule({ medicationId: 2 }),
      ],
      logs: [
        log({ medicationId: 1, scheduledFor: at('09:00'), status: 'taken', quantity: 2 }),
        log({ medicationId: 1, scheduledFor: at('13:00'), status: 'taken', quantity: 1 }),
        log({ medicationId: 2, scheduledFor: at('08:00'), status: 'taken' }),
      ],
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ quantity: 2, amount: '2 tablets' });
    expect(entries[0].today.map((l) => l.scheduledFor)).toEqual([at('13:00'), at('09:00')]);
  });
});
