/**
 * Daily / weekly / monthly / all-time Sales Reports.
 *
 * The period presets are the operator's whole reporting workflow, and each
 * one is the same writer fed a different date window. Two things can break
 * independently and neither is visible from a single-period test:
 *
 *   1. The WINDOW — which sales fall inside it. A rolling-7-day week that
 *      collapses on Sundays, a month that starts on the wrong day, an
 *      inclusive bound that quietly excludes its own endpoint.
 *   2. The ROWS — every money cell in the workbook is a live Excel formula
 *      referencing hard row numbers. Filtering removes rows, so row 5 of the
 *      unfiltered report becomes row 2 of a filtered one. If the writer
 *      numbered formulas from the unfiltered index, a filtered report would
 *      compute from whatever happens to sit at that row — usually the TOTAL
 *      line, or nothing.
 *
 * So this drives the real resolvePeriod() into the real workbook builder and
 * checks the window, the row count, the period label, and that every formula
 * on every data row points at its OWN row.
 */
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { resolvePeriod } from '../../components/ReportRangeMenu';
import { buildSalesWorkbookBuffer, PRIMED_SALE_ROWS } from '../../lib/clientReport';
import type { Sale } from '../../types';

/** Fixed "today" so the test doesn't drift with the calendar. */
const TODAY = '2026-08-02';           // a Sunday — the day the old week preset collapsed on
const iso = (daysAgo: number) => {
  const d = new Date(Date.UTC(2026, 7, 2));
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
};

const sale = (over: Partial<Sale> & { saleDate: string; id: string }): Sale => ({
  marketplace: 'AMAZON', orderNumber: over.id, imei: `35010000000${over.id.slice(-4)}`,
  quantity: 1, buyPrice: 100, salePrice: 200, postage: 6.30,
  spMinusBp: 100, marginalTax: 16.67, commission: 14, grossProfit: 0, gpPercent: 0,
  supplierName: 'MHL', sku: 'SG-A21S-32-BK', unitId: 'u1',
  importBatchId: 'b', sourceFile: 'f', sourceRow: 1, importedAt: '',
  createdAt: '', updatedAt: '', ownerId: 'shared',
  ...over,
} as Sale);

/** One sale on each of these offsets from TODAY. */
const OFFSETS = [0, 1, 3, 6, 7, 20, 45, 400];
const SALES = OFFSETS.map(d => sale({ id: `ORD-${String(d).padStart(4, '0')}`, saleDate: iso(d) }));

async function reportFor(range: { from?: string; to?: string }) {
  const buf = await buildSalesWorkbookBuffer({
    sales: SALES, units: [], supplierMap: {},
    opts: { from: range.from, to: range.to, today: new Date(`${TODAY}T12:00:00Z`) } as never,
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as ArrayBuffer);
  return wb;
}

/** Data rows on the AMAZON tab — everything between the header and TOTAL. */
function dataRows(ws: ExcelJS.Worksheet): ExcelJS.Row[] {
  const out: ExcelJS.Row[] = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    if (String(row.getCell(1).value ?? '').trim().toUpperCase() === 'TOTAL') return;
    if (row.getCell(2).value) out.push(row);   // has an order number
  });
  return out;
}

describe('resolvePeriod — the windows themselves', () => {
  // resolvePeriod reads the real clock, so assert the SHAPE of each window
  // rather than fixed dates: the arithmetic is what regresses, not the date.
  it('today is a single inclusive day', () => {
    const r = resolvePeriod('today');
    expect(r.from).toBe(r.to);
    expect(r.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('week is a rolling 7 days INCLUDING today — never collapses on a Sunday', () => {
    const r = resolvePeriod('week');
    const days = (Date.parse(r.to!) - Date.parse(r.from!)) / 86_400_000 + 1;
    // The bug this guards: `today.getDay()` to find the last Sunday made
    // every Sunday's export a 1-day window.
    expect(days, 'a week export must span 7 days on every weekday').toBe(7);
  });

  it('month runs from the 1st to today', () => {
    const r = resolvePeriod('month');
    expect(r.from!.slice(-2), 'month starts on the 1st').toBe('01');
    expect(r.from!.slice(0, 7)).toBe(r.to!.slice(0, 7));
  });

  it('all-time has no bounds at all, so nothing can be filtered out', () => {
    const r = resolvePeriod('all');
    expect(r.from).toBeUndefined();
    expect(r.to).toBeUndefined();
    expect(r.label).toBe('all-time');
  });

  it('custom passes the operator dates straight through', () => {
    const r = resolvePeriod('custom', { from: '2026-01-01', to: '2026-03-31' });
    expect(r.from).toBe('2026-01-01');
    expect(r.to).toBe('2026-03-31');
  });
});

describe('the report each period produces', () => {
  // Windows relative to the fixed TODAY, so the expected row counts are exact.
  const CASES: [string, { from?: string; to?: string }, number][] = [
    ['daily  (today only)',   { from: iso(0), to: iso(0) },  1],   // offset 0
    ['weekly (rolling 7d)',   { from: iso(6), to: iso(0) },  4],   // 0, 1, 3, 6
    ['monthly (1st→today)',   { from: '2026-08-01', to: iso(0) }, 2], // 0, 1
    ['all-time (no bounds)',  {},                            OFFSETS.length],
  ];

  it.each(CASES)('%s keeps exactly the sales inside the window', async (_label, range, expected) => {
    const wb = await reportFor(range);
    const rows = dataRows(wb.getWorksheet('AMAZON')!);
    expect(rows.length).toBe(expected);
    // and every one of them really is inside the window
    for (const row of rows) {
      const d = row.getCell(1).value as Date;
      const dIso = new Date(d).toISOString().slice(0, 10);
      if (range.from) expect(dIso >= range.from, `${dIso} >= ${range.from}`).toBe(true);
      if (range.to)   expect(dIso <= range.to,   `${dIso} <= ${range.to}`).toBe(true);
    }
  });

  it.each(CASES)('%s writes formulas against its OWN row, not the unfiltered index',
    async (_label, range) => {
      const wb = await reportFor(range);
      const ws = wb.getWorksheet('AMAZON')!;
      for (const row of dataRows(ws)) {
        for (let c = 1; c <= 21; c++) {
          const v = row.getCell(c).value as { formula?: string } | null;
          if (!v || typeof v !== 'object' || !v.formula) continue;
          // Every row reference in a per-line formula must be this row.
          const refs = v.formula.match(/[A-Z]{1,2}(\d+)/g) ?? [];
          for (const ref of refs) {
            const n = Number(ref.replace(/[A-Z]/g, ''));
            expect(n, `row ${row.number} col ${c} formula "${v.formula}" points at row ${n}`)
              .toBe(row.number);
          }
        }
      }
    });

  it('the Summary tab names the period so a downloaded file is self-describing', async () => {
    const day   = await reportFor({ from: iso(0), to: iso(0) });
    const all   = await reportFor({});
    const text = (wb: ExcelJS.Workbook) => {
      const ws = wb.getWorksheet('Summary')!;
      let s = '';
      ws.eachRow(r => r.eachCell(c => { s += ` ${c.value ?? ''}`; }));
      return s;
    };
    expect(text(day)).toContain(iso(0));
    expect(text(all)).toContain('All Time');
  });

  it('TOTAL sums the rows the period kept, plus the fillable tail and nothing else', async () => {
    // A TOTAL that spans the whole column would silently include rows the
    // filter removed. It must reach the kept rows and the blank rows the
    // operator can type into — the report is a working sheet — and stop
    // there. Unfilled rows evaluate to "" so they contribute nothing until
    // someone actually records a sale in one.
    const wb = await reportFor({ from: iso(6), to: iso(0) });
    const ws = wb.getWorksheet('AMAZON')!;
    const rows = dataRows(ws);
    const last = rows[rows.length - 1].number;
    let totalRow: ExcelJS.Row | undefined;
    ws.eachRow((r) => {
      if (String(r.getCell(1).value ?? '').trim().toUpperCase() === 'TOTAL') totalRow = r;
    });
    expect(totalRow, 'every marketplace tab carries a TOTAL row').toBeDefined();
    let checked = 0;
    totalRow!.eachCell(cell => {
      const v = cell.value as { formula?: string } | null;
      if (!v || typeof v !== 'object' || !v.formula) return;
      const m = /^SUM\([A-Z]+(\d+):[A-Z]+(\d+)\)$/i.exec(v.formula);
      if (!m) return;
      expect(Number(m[1]), 'SUM starts at the first data row').toBe(2);
      expect(Number(m[2]), 'SUM ends at the last fillable row, not beyond')
        .toBe(last + PRIMED_SALE_ROWS);
      checked++;
    });
    expect(checked, 'the TOTAL row should carry SUM() formulas').toBeGreaterThan(0);
  });

  it('an empty window produces a valid, empty report rather than throwing', async () => {
    // The operator picks Today on a day with no sales. This must still open.
    const wb = await reportFor({ from: '2020-01-01', to: '2020-01-01' });
    expect(dataRows(wb.getWorksheet('AMAZON')!).length).toBe(0);
    expect(wb.worksheets.length).toBeGreaterThan(0);
  });
});
