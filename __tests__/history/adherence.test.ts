import type { DoseLog, Medication, Schedule } from '@/db/models';
import { adherenceByMedication, buildDayStats, type DayStats } from '@/features/history/adherence';
import { addDays, localToUtc } from '@/lib/time';

// Jest runs in America/New_York. DST 2026: spring forward Mar 8, fall back Nov 1.
const NOW = new Date(2026, 5, 10, 14, 0); // Wed Jun 10 2026, 14:00 local
const OLD = '2026-01-01T00:00:00.000Z';

let nextId = 1;
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
  createdAt: OLD,
  updatedAt: OLD,
  ...over,
});
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
  createdAt: OLD,
  updatedAt: OLD,
  ...over,
});
const log = (date: string, time: string, over: Partial<DoseLog> = {}): DoseLog => ({
  id: nextId++,
  medicationId: 1,
  scheduledFor: localToUtc(date, time),
  status: 'taken',
  actedAt: localToUtc(date, time),
  quantity: 1,
  note: null,
  createdAt: OLD,
  updatedAt: OLD,
  ...over,
});

interface Setup {
  meds?: Medication[];
  schedules?: Schedule[];
  logs?: DoseLog[];
  from?: string;
  to?: string;
  now?: Date;
}
const stats = (s: Setup = {}): Map<string, DayStats> =>
  buildDayStats({
    medications: s.meds ?? [med()],
    schedules: s.schedules ?? [schedule()],
    logs: s.logs ?? [],
    from: s.from ?? '2026-06-07',
    to: s.to ?? '2026-06-11',
    now: s.now ?? NOW,
    missedAfterMinutes: 120,
  });
const statusOf = (m: Map<string, DayStats>, date: string) => m.get(date)?.status;

describe('day status', () => {
  it('colors days by what happened', () => {
    const twice = schedule({ times: ['08:00', '20:00'] });
    const m = stats({
      schedules: [twice],
      logs: [
        log('2026-06-07', '08:00'),
        log('2026-06-07', '20:00'), // all taken
        log('2026-06-08', '08:00'), // 20:00 never logged: partial
        // Jun 9: nothing logged: none
      ],
    });
    expect(statusOf(m, '2026-06-07')).toBe('all_taken');
    expect(statusOf(m, '2026-06-08')).toBe('partial');
    expect(statusOf(m, '2026-06-09')).toBe('none');
  });

  it('marks days with nothing scheduled and days that have not happened', () => {
    const weekdays = schedule({ type: 'weekdays', daysOfWeek: [1] }); // Mondays only
    const m = stats({ schedules: [weekdays], logs: [log('2026-06-08', '08:00')] });
    expect(statusOf(m, '2026-06-08')).toBe('all_taken'); // Monday
    expect(statusOf(m, '2026-06-09')).toBe('no_doses');
    expect(statusOf(m, '2026-06-11')).toBe('future');
  });

  it('counts only doses that are due today, and shows an unresolved dose as pending', () => {
    const twice = schedule({ times: ['08:00', '20:00'] });
    const done = stats({ schedules: [twice], logs: [log('2026-06-10', '08:00')] });
    expect(statusOf(done, '2026-06-10')).toBe('all_taken'); // 20:00 is not due yet
    const morning = stats({ schedules: [twice], now: new Date(2026, 5, 10, 9, 0) });
    expect(statusOf(morning, '2026-06-10')).toBe('pending'); // 08:00 overdue but inside the window
    const late = stats({ schedules: [twice], now: new Date(2026, 5, 10, 10, 0) });
    expect(statusOf(late, '2026-06-10')).toBe('none'); // window elapsed: missed
  });

  it('treats skipped as not taken and late doses as taken', () => {
    const twice = schedule({ times: ['08:00', '20:00'] });
    const m = stats({
      schedules: [twice],
      logs: [
        log('2026-06-07', '08:00'),
        log('2026-06-07', '20:00', { status: 'skipped', quantity: null }),
        log('2026-06-08', '08:00', { actedAt: localToUtc('2026-06-09', '07:00') }),
        log('2026-06-08', '20:00', { actedAt: localToUtc('2026-06-09', '07:05') }),
        log('2026-06-09', '08:00', { status: 'skipped', quantity: null }),
        log('2026-06-09', '20:00', { status: 'skipped', quantity: null }),
      ],
    });
    expect(statusOf(m, '2026-06-07')).toBe('partial');
    expect(statusOf(m, '2026-06-08')).toBe('all_taken');
    expect(statusOf(m, '2026-06-09')).toBe('none');
  });

  it('follows every-N-days and weekday schedules', () => {
    const every2 = schedule({ type: 'interval', intervalDays: 2, startDate: '2026-06-01' });
    const m = stats({ schedules: [every2], from: '2026-06-06', to: '2026-06-10' });
    // Jun 1, 3, 5, 7, 9 are dose days.
    expect(
      [6, 7, 8, 9, 10].map((d) => statusOf(m, `2026-06-${String(d).padStart(2, '0')}`)),
    ).toEqual(['no_doses', 'none', 'no_doses', 'none', 'no_doses']);
  });

  it('lists a dose that was logged even if the schedule has since changed', () => {
    const m = stats({
      schedules: [schedule({ times: ['09:30'] })],
      logs: [log('2026-06-08', '08:00')],
    });
    const day = m.get('2026-06-08');
    expect(day?.doses.map((d) => [d.time, d.status])).toEqual([
      ['08:00', 'taken'],
      ['09:30', 'missed'],
    ]);
    expect(day?.status).toBe('partial');
  });

  it('does not invent misses before the schedule was last edited', () => {
    const edited = schedule({ updatedAt: new Date(2026, 5, 9, 15, 0).toISOString() });
    const m = stats({ schedules: [edited], logs: [log('2026-06-08', '08:00')] });
    expect(statusOf(m, '2026-06-08')).toBe('all_taken'); // the logged one still counts
    expect(statusOf(m, '2026-06-07')).toBe('no_doses'); // unlogged and before the edit
    expect(statusOf(m, '2026-06-09')).toBe('no_doses'); // 08:00 on Jun 9 is before the edit too
    expect(statusOf(m, '2026-06-10')).toBe('none'); // after the edit and due
  });

  it('keeps one dose per slot across the DST changes', () => {
    const spring = stats({
      schedules: [schedule({ times: ['02:30'] })],
      from: '2026-03-07',
      to: '2026-03-09',
      now: new Date(2026, 2, 10, 12, 0),
    });
    expect([...spring.values()].map((d) => d.doses.length)).toEqual([1, 1, 1]);
    const fall = stats({
      schedules: [schedule({ times: ['01:30'] })],
      from: '2026-10-31',
      to: '2026-11-02',
      now: new Date(2026, 10, 3, 12, 0),
    });
    expect([...fall.values()].map((d) => d.doses.length)).toEqual([1, 1, 1]);
  });
});

describe('as-needed and paused medications', () => {
  const prn = med({ id: 2, name: 'Ibuprofen' });
  const prnSchedule = schedule({ medicationId: 2, type: 'as_needed', times: [] });

  it('lists as-needed doses without counting them toward adherence', () => {
    const m = stats({
      meds: [prn],
      schedules: [prnSchedule],
      logs: [log('2026-06-08', '12:15', { medicationId: 2 })],
    });
    const day = m.get('2026-06-08');
    expect(day?.asNeeded.map((a) => a.name)).toEqual(['Ibuprofen']);
    expect(day?.doses).toEqual([]);
    expect(day?.status).toBe('no_doses');
    expect(day?.expected).toBe(0);
  });

  it('keeps the logged doses of a paused medication but expects nothing new', () => {
    const m = stats({
      meds: [med({ active: false })],
      logs: [log('2026-06-08', '08:00')],
    });
    expect(statusOf(m, '2026-06-08')).toBe('all_taken');
    expect(statusOf(m, '2026-06-09')).toBe('no_doses');
  });

  it('ignores logs of medications that no longer exist', () => {
    const m = stats({ meds: [], schedules: [], logs: [log('2026-06-08', '08:00')] });
    expect(m.get('2026-06-08')?.doses).toEqual([]);
  });
});

describe('adherenceByMedication', () => {
  const TODAY = '2026-06-10';
  const range = (schedules: Schedule[], logs: DoseLog[], meds: Medication[] = [med()]) => {
    const days = buildDayStats({
      medications: meds,
      schedules,
      logs,
      from: addDays(TODAY, -89),
      to: TODAY,
      now: NOW,
      missedAfterMinutes: 120,
    });
    return adherenceByMedication(days, meds, schedules, TODAY);
  };

  it('reports taken / expected over 7, 30 and 90 days', () => {
    // Taken every day from May 1 to Jun 10 except Jun 7 and Jun 2.
    const logs: DoseLog[] = [];
    for (let d = new Date(2026, 4, 1); d <= new Date(2026, 5, 10); d.setDate(d.getDate() + 1)) {
      const date = `2026-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (date !== '2026-06-07' && date !== '2026-06-02') logs.push(log(date, '08:00'));
    }
    const edited = schedule({ updatedAt: new Date(2026, 4, 1, 0, 0).toISOString() });
    const [row] = range([edited], logs);
    expect(row.windows[7]).toEqual({ taken: 6, expected: 7, percent: 86 });
    expect(row.windows[30]).toEqual({ taken: 28, expected: 30, percent: 93 });
    // 90-day window is clipped to when the schedule started tracking (May 1 .. Jun 10: 41 days).
    expect(row.windows[90]).toEqual({ taken: 39, expected: 41, percent: 95 });
  });

  it('counts today only for doses that are due', () => {
    const [row] = range([schedule()], [log('2026-06-10', '08:00')]);
    expect(row.windows[7].expected).toBe(7);
  });

  it('has no percentage when nothing was due, and rounds sensibly', () => {
    expect(range([schedule({ type: 'weekdays', daysOfWeek: [] })], [])[0].windows[7]).toEqual({
      taken: 0,
      expected: 0,
      percent: null,
    });
    const twice = schedule({ times: ['08:00', '20:00'], startDate: '2026-06-09' });
    const [row] = range(
      [twice],
      [log('2026-06-09', '08:00'), log('2026-06-09', '20:00'), log('2026-06-10', '08:00')],
    );
    // Jun 9: 2 of 2, Jun 10: 08:00 taken (20:00 not due): 3 of 3 = 100%.
    expect(row.windows[7].percent).toBe(100);
    const [two] = range([schedule({ startDate: '2026-06-08' })], [log('2026-06-08', '08:00')]);
    expect(two.windows[7]).toEqual({ taken: 1, expected: 3, percent: 33 });
  });

  it('reports as-needed doses taken instead of a percentage', () => {
    const prn = med({ id: 2, name: 'Ibuprofen' });
    const prnSchedule = schedule({ medicationId: 2, type: 'as_needed', times: [] });
    const [row] = range(
      [prnSchedule],
      [
        log('2026-06-09', '10:00', { medicationId: 2 }),
        log('2026-05-20', '10:00', { medicationId: 2 }),
      ],
      [prn],
    );
    expect(row.asNeeded).toBe(true);
    expect(row.asNeededCounts).toEqual({ 7: 1, 30: 2, 90: 2 });
    expect(row.windows[7].percent).toBeNull();
  });

  it('lists active medications first, then by name', () => {
    const meds = [
      med({ id: 1, name: 'Zed' }),
      med({ id: 2, name: 'Alpha', active: false }),
      med({ id: 3, name: 'Beta' }),
    ];
    const rows = range(
      [schedule({ medicationId: 1 }), schedule({ medicationId: 2 }), schedule({ medicationId: 3 })],
      [],
      meds,
    );
    expect(rows.map((r) => r.name)).toEqual(['Beta', 'Zed', 'Alpha']);
  });
});
