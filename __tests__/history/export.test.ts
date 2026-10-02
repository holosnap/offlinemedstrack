import { createInventory, createMedication, createSchedule, recordDose } from '@/db/repositories';
import type { Database } from '@/db/types';
import type { DayStats } from '@/features/history/adherence';
import { buildCsv, csvCell, CSV_COLUMNS, historyRows } from '@/features/history/csv';
import { exportHistory } from '@/features/history/exportHistory';
import type { FileExporter } from '@/features/history/exporter';
import { escapeHtml, renderHistoryHtml } from '@/features/history/pdf';
import { loadHistory } from '@/features/history/data';
import { createTestDb } from '../helpers/testDb';

const NOW = new Date(2026, 5, 10, 14, 0);
const at = (day: number, h: number, m = 0) => new Date(2026, 5, day, h, m);

describe('csvCell', () => {
  it('quotes commas, quotes and newlines, and doubles embedded quotes', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
  });

  it('neutralises spreadsheet formulas', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-2')).toBe("'-2");
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell('=1,2')).toBe(`"'=1,2"`);
    expect(csvCell('safe=equals')).toBe('safe=equals');
  });
});

describe('buildCsv', () => {
  it('writes a header and CRLF-terminated rows', () => {
    const rows = [
      Object.fromEntries(CSV_COLUMNS.map((c) => [c, c === 'Medication' ? 'A, B' : 'x'])),
    ] as unknown as Parameters<typeof buildCsv>[0];
    const csv = buildCsv(rows);
    expect(csv.split('\r\n')).toEqual([CSV_COLUMNS.join(','), 'x,x,"A, B",x,x,x,x,x,x', '']);
  });
});

describe('export of real data', () => {
  let db: Database;
  let medId: number;
  let prnId: number;

  let nowSpy: jest.SpyInstance;

  beforeEach(async () => {
    // Schedules are stamped with "now" when created; make that June 1 so June history counts.
    nowSpy = jest.spyOn(Date, 'now').mockReturnValue(new Date(2026, 5, 1, 0, 0).getTime());
    db = await createTestDb();
    medId = (
      await createMedication(db, {
        name: '=Evil, "Med"',
        dosageAmount: 500,
        dosageUnit: 'mg',
        form: 'tablet',
      })
    ).id;
    await createSchedule(db, {
      medicationId: medId,
      type: 'daily',
      times: ['08:00'],
      startDate: '2026-01-01',
      doseQuantity: 2,
    });
    await createInventory(db, { medicationId: medId, currentQuantity: 20, unit: 'tablets' });
    prnId = (
      await createMedication(db, {
        name: 'Ibuprofen',
        dosageAmount: 200,
        dosageUnit: 'mg',
        form: 'tablet',
      })
    ).id;
    await createSchedule(db, {
      medicationId: prnId,
      type: 'as_needed',
      startDate: '2026-01-01',
      doseQuantity: 1,
    });
    // History: Jun 8 taken (note), Jun 9 skipped, Jun 10 08:00 not logged (missed); PRN on Jun 9.
    await recordDose(db, {
      medicationId: medId,
      scheduledFor: at(8, 8),
      status: 'taken',
      actedAt: at(8, 8, 20),
      quantity: 2,
      note: 'with "breakfast", fine',
    });
    await recordDose(db, {
      medicationId: medId,
      scheduledFor: at(9, 8),
      status: 'skipped',
      actedAt: at(9, 8, 5),
    });
    await recordDose(db, {
      medicationId: prnId,
      scheduledFor: at(9, 13, 45),
      status: 'taken',
      actedAt: at(9, 13, 45),
      quantity: 1,
    });
  });

  afterEach(() => nowSpy.mockRestore());

  const days = async (): Promise<DayStats[]> => {
    const data = await loadHistory(db, { year: 2026, month: 6 }, NOW);
    return [...data.days.values()].filter((d) => d.date >= '2026-06-08' && d.date <= '2026-06-10');
  };

  it('lists scheduled, skipped, missed and as-needed doses in date order', async () => {
    const rows = historyRows(await days());
    expect(
      rows.map((r) => [
        r.Date,
        r.Medication,
        r.Type,
        r.Status,
        r['Time taken'],
        r['Quantity taken'],
      ]),
    ).toEqual([
      ['2026-06-08', '=Evil, "Med"', 'Scheduled', 'taken', '08:20', '2'],
      ['2026-06-09', '=Evil, "Med"', 'Scheduled', 'skipped', '', ''],
      ['2026-06-09', 'Ibuprofen', 'As needed', 'taken', '13:45', '1'],
      ['2026-06-10', '=Evil, "Med"', 'Scheduled', 'missed', '', ''],
    ]);
  });

  it('escapes the CSV so hostile names and notes are safe', async () => {
    const csv = buildCsv(historyRows(await days()));
    expect(csv).toContain(`"'=Evil, ""Med"""`);
    expect(csv).toContain('"with ""breakfast"", fine"');
    expect(csv.split('\r\n')[1].startsWith('2026-06-08,08:00,')).toBe(true);
  });

  it('renders an escaped PDF report with the adherence summary', async () => {
    const data = await days();
    const html = renderHistoryHtml({
      from: '2026-06-08',
      to: '2026-06-10',
      generatedOn: '2026-06-10',
      summary: [
        {
          medicationId: medId,
          name: '<script>x</script>',
          taken: 1,
          skipped: 1,
          missed: 1,
          expected: 3,
          percent: 33,
          asNeededDoses: 0,
        },
      ],
      days: data,
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(html).toContain('33%');
    expect(html).toContain('2026-06-09');
    expect(html).toContain('Ibuprofen (as needed)');
    expect(html).toContain('with &quot;breakfast&quot;, fine');
    expect(escapeHtml(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  });

  describe('exportHistory', () => {
    class FakeExporter implements FileExporter {
      available = true;
      files: { name: string; content: string }[] = [];
      shared: { uri: string; kind: string }[] = [];
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
      async share(uri: string, kind: 'csv' | 'pdf') {
        this.shared.push({ uri, kind });
      }
    }

    it('writes a CSV and opens the share sheet', async () => {
      const exporter = new FakeExporter();
      const result = await exportHistory(db, exporter, { format: 'csv', range: 30, now: NOW });
      expect(result).toEqual({ fileName: 'medication-history-2026-06-10.csv', rows: 11 }); // Jun 1-10 scheduled doses (floor: schedule created Jun 1) + 1 as-needed
      expect(exporter.files[0].content.split('\r\n')[0]).toBe(CSV_COLUMNS.join(','));
      expect(exporter.shared).toEqual([
        { uri: 'file:///cache/medication-history-2026-06-10.csv', kind: 'csv' },
      ]);
    });

    it('writes a PDF with a summary and the log', async () => {
      const exporter = new FakeExporter();
      await exportHistory(db, exporter, { format: 'pdf', range: 'all', now: NOW });
      expect(exporter.files[0].name).toBe('medication-history-2026-06-10.pdf');
      expect(exporter.files[0].content).toContain('Adherence summary');
      expect(exporter.files[0].content).toContain('2026-06-08');
      expect(exporter.shared[0].kind).toBe('pdf');
    });

    it('limits the range', async () => {
      const exporter = new FakeExporter();
      const result = await exportHistory(db, exporter, {
        format: 'csv',
        range: 30,
        now: new Date(2026, 7, 1, 12, 0), // Aug 1: the June doses are older than 30 days
      });
      expect(result.rows).toBe(30); // one unlogged (missed) 08:00 dose on each of the 30 days
      expect(exporter.files[0].content).not.toContain('2026-06-08');
    });

    it('explains when sharing is unavailable or there is nothing to export', async () => {
      const exporter = new FakeExporter();
      exporter.available = false;
      await expect(
        exportHistory(db, exporter, { format: 'csv', range: 30, now: NOW }),
      ).rejects.toThrow('Sharing is not available');
      expect(exporter.files).toHaveLength(0);

      const empty = await createTestDb();
      await expect(
        exportHistory(empty, new FakeExporter(), { format: 'csv', range: 30, now: NOW }),
      ).rejects.toThrow('no recorded doses');
    });

    it('does not share when writing the file fails', async () => {
      const exporter = new FakeExporter();
      exporter.writeText = async () => {
        throw new Error('disk full');
      };
      await expect(
        exportHistory(db, exporter, { format: 'csv', range: 30, now: NOW }),
      ).rejects.toThrow('disk full');
      expect(exporter.shared).toEqual([]);
    });
  });
});
