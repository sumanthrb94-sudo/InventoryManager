/**
 * The downloaded Sales Report is a working sheet, not only a record.
 *
 * The client asked for a report they can type the next sale into and have the
 * money columns calculate themselves. Three things have to hold for that, and
 * each can break on its own:
 *
 *   1. There are blank rows to type into, between the last sale and the TOTAL.
 *      Without them the operator types over the totals.
 *   2. Those rows carry the report's OWN formulas, wrapped in a guard so an
 *      untouched row stays empty. If the guard's contents ever drift from what
 *      a real row carries, the operator's spreadsheet and the application stop
 *      agreeing — silently, because both look plausible.
 *   3. Filling one actually produces the right number. This is the assertion
 *      that matters: evaluate the row's own formulas with the app's formula
 *      engine and reconcile against calcSaleFinancials.
 *
 * The Summary is checked here too. It carries an audited baseline plus a live
 * term over the fillable rows, and the split is deliberate — see the comment
 * in writeSalesSummarySheet. What is asserted is that the live term points at
 * the right rows on the right sheet.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import ExcelJS from 'exceljs';
import {
  buildSalesWorkbookBuffer,
  PRIMED_SALE_ROWS,
} from '../../lib/clientReport';
import { calcSaleFinancials } from '../../lib/platforms';
import { evaluateFormula, colToNum, numToCol } from '../../lib/reportView';
import { MARKETPLACES } from '../../types';
import type { Marketplace, Sale } from '../../types';

/** One real sale per marketplace, so every tab has data AND a fillable tail. */
const SALES = MARKETPLACES.map(m => ({
  id: `${m}__SEED__1`, marketplace: m, orderNumber: 'SEED-1',
  imei: '350100000000001', sku: 'SG-A21S-32-BK', supplierName: 'MHL',
  saleDate: '2026-08-20', quantity: 1, buyPrice: 100, salePrice: 200, postage: 6.3,
  spMinusBp: 0, marginalTax: 0, commission: 0, grossProfit: 0, gpPercent: 0,
  importBatchId: '', sourceFile: '', sourceRow: 2, importedAt: '',
  createdAt: '', updatedAt: '', ownerId: 'shared',
})) as unknown as Sale[];

let wb: ExcelJS.Workbook;

beforeAll(async () => {
  const buf = await buildSalesWorkbookBuffer({
    sales: SALES, units: [], supplierMap: {}, opts: {} as never,
  });
  wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as ArrayBuffer);
});

const headerRow = (ws: ExcelJS.Worksheet): string[] =>
  ((ws.getRow(1).values ?? []) as unknown[]).slice(1).map(v => String(v ?? '').trim());

const totalRowNum = (ws: ExcelJS.Worksheet): number => {
  for (let n = ws.rowCount; n >= 1; n--) {
    if (String(ws.getRow(n).getCell(1).value ?? '').trim().toUpperCase() === 'TOTAL') return n;
  }
  throw new Error(`${ws.name}: no TOTAL row`);
};

/** Strip the blank-row guard, leaving the report's own formula. */
const GUARD = /^IF\(\$[A-Z]+\d+="","",(.*)\)$/s;

describe('the report leaves room to type the next sale', () => {
  it.each(MARKETPLACES)('%s — data, then a fillable tail, then TOTAL', (m) => {
    const ws = wb.getWorksheet(m)!;
    // 1 header + 1 seeded sale + the tail + TOTAL.
    expect(totalRowNum(ws)).toBe(2 + 1 + PRIMED_SALE_ROWS - 1 + 1);
    expect(ws.rowCount).toBe(1 + 1 + PRIMED_SALE_ROWS + 1);
  });

  it.each(MARKETPLACES)('%s — the TOTAL sums across the fillable rows too', (m) => {
    const ws = wb.getWorksheet(m)!;
    const n = totalRowNum(ws);
    let sums = 0;
    ws.getRow(n).eachCell({ includeEmpty: false }, (cell) => {
      const f = (cell.value as { formula?: string } | null)?.formula;
      const range = f && /^SUM\([A-Z]+(\d+):[A-Z]+(\d+)\)$/.exec(f);
      if (!range) return;
      expect(Number(range[1]), 'starts at the first data row').toBe(2);
      expect(Number(range[2]), 'ends at the row above TOTAL').toBe(n - 1);
      sums++;
    });
    expect(sums, `${m} TOTAL should carry SUM formulas`).toBeGreaterThan(4);
  });

  it.each(MARKETPLACES)('%s — an untouched fillable row is guarded on its own SP cell', (m) => {
    const ws = wb.getWorksheet(m)!;
    const spCol = numToCol(headerRow(ws).indexOf('SP') + 1);
    const row = 3;                                     // first blank row
    let guarded = 0;
    ws.getRow(row).eachCell({ includeEmpty: false }, (cell) => {
      const f = (cell.value as { formula?: string } | null)?.formula;
      if (!f) return;
      expect(f, 'every primed formula guards on its own SP cell')
        .toMatch(new RegExp(`^IF\\(\\$${spCol}${row}="","",`));
      guarded++;
    });
    expect(guarded, `${m} should carry live formulas on blank rows`).toBeGreaterThan(4);
  });

  it.each(MARKETPLACES)('%s — the guard wraps the report\'s own formula, unchanged', (m) => {
    const ws = wb.getWorksheet(m)!;
    // Row 2 is a real sale. Row 3 must carry the same formulas with every row
    // reference bumped by one — nothing else.
    const real = new Map<number, string>();
    ws.getRow(2).eachCell({ includeEmpty: false }, (cell, c) => {
      const f = (cell.value as { formula?: string } | null)?.formula;
      if (f) real.set(c, f);
    });
    const mismatches: string[] = [];
    ws.getRow(3).eachCell({ includeEmpty: false }, (cell, c) => {
      const f = (cell.value as { formula?: string } | null)?.formula;
      if (!f) return;
      const inner = GUARD.exec(f)?.[1];
      if (inner == null) { mismatches.push(`col ${c}: not guarded — "${f}"`); return; }
      const fromReal = real.get(c);
      if (!fromReal) { mismatches.push(`col ${c}: blank row has a formula the data row does not`); return; }
      const expected = fromReal.replace(/([A-Z]{1,2})(\d+)/g, (_s, col, n) => `${col}${Number(n) + 1}`);
      if (inner !== expected) mismatches.push(`col ${c}: "${inner}" vs "${expected}"`);
    });
    expect(mismatches, `\n${m}\n${mismatches.join('\n')}\n`).toEqual([]);
    // and the data row writes no formula the blank row dropped
    for (const c of real.keys()) {
      const f = (wb.getWorksheet(m)!.getRow(3).getCell(c).value as { formula?: string } | null)?.formula;
      expect(f, `${m} col ${numToCol(c)} is a formula on a data row but not on a fillable one`).toBeTruthy();
    }
  });
});

describe('typing a sale into the report computes it', () => {
  // What an operator does: put a BP, an SP and a postage on the first blank
  // row, and read the GP. Evaluated with the app's own formula engine, it has
  // to match what the application would have calculated for the same sale.
  const INPUTS: Record<Marketplace, { bp: number; sp: number; postage: number }> = {
    AMAZON: { bp: 100, sp: 139.99, postage: 6.30 },
    BM:     { bp: 73,  sp: 129,    postage: 6.30 },
    EBAY:   { bp: 30,  sp: 55.99,  postage: 4.65 },
    ONBUY:  { bp: 110, sp: 159.99, postage: 6.30 },
    TEMU:   { bp: 55,  sp: 83.99,  postage: 6.30 },
  };

  it.each(MARKETPLACES)('%s — GP matches calcSaleFinancials', (m) => {
    const ws = wb.getWorksheet(m)!;
    const headers = headerRow(ws);
    const idx = (name: string) => headers.indexOf(name) + 1;
    const { bp, sp, postage } = INPUTS[m];
    const ROW = 3;

    const typed = new Map<string, number>([
      [`${numToCol(idx('BP'))}${ROW}`, bp],
      [`${numToCol(idx('SP'))}${ROW}`, sp],
      [`${numToCol(idx('Postage'))}${ROW}`, postage],
    ]);
    // Temu's commission is invoiced per order, so the operator types it —
    // there is no formula for it in their master either.
    const commissionOverride = m === 'TEMU' ? Number((sp * 4.61 / 100).toFixed(2)) : undefined;
    if (commissionOverride !== undefined) {
      typed.set(`${numToCol(idx('Commission'))}${ROW}`, commissionOverride);
    }

    const seen = new Set<string>();
    const resolve = (ref: string): number => {
      if (typed.has(ref)) return typed.get(ref)!;
      const parts = /^([A-Z]+)(\d+)$/.exec(ref);
      if (!parts) return 0;
      const cell = ws.getRow(Number(parts[2])).getCell(colToNum(parts[1]));
      const v = cell.value as { formula?: string } | null;
      if (v && typeof v === 'object' && v.formula) {
        if (seen.has(ref)) return 0;                   // cycle guard
        seen.add(ref);
        const out = evaluateFormula(GUARD.exec(v.formula)?.[1] ?? v.formula, resolve);
        seen.delete(ref);
        return out;
      }
      return typeof v === 'number' ? v : 0;
    };

    const gp = resolve(`${numToCol(idx('GP'))}${ROW}`);
    const expected = calcSaleFinancials({
      marketplace: m, buyPrice: bp, salePrice: sp, postageOverride: postage,
      ...(commissionOverride !== undefined ? { commissionOverride } : {}),
    } as never);

    expect(Math.round(gp * 100) / 100, `${m} GP from the report's own formulas`)
      .toBeCloseTo(expected.grossProfit, 1);
  });
});

describe('the Summary follows what gets typed in', () => {
  const summaryRow = (label: string): ExcelJS.Row => {
    const ws = wb.getWorksheet('Summary')!;
    for (let n = 1; n <= ws.rowCount; n++) {
      if (String(ws.getRow(n).getCell(1).value ?? '').trim() === label) return ws.getRow(n);
    }
    throw new Error(`Summary: no row for ${label}`);
  };

  // Sales (2) and Gross GP (6) grow as rows are filled. Refunds (3),
  // Replacements (4), Repairs (5) and Postage Loss (7) do NOT, and that is
  // deliberate: a row typed into the blank tail is a new sale, and it cannot
  // have been returned — returns are processed in the application, which is
  // also what writes those columns.
  it.each(MARKETPLACES)('%s — Sales and Gross GP track that tab\'s fillable rows', (m) => {
    const row = summaryRow(m);
    const first = 1 + 1 + 1;                       // header + 1 seeded sale + 1
    const last = 1 + 1 + PRIMED_SALE_ROWS;
    for (const col of [2, 6]) {
      const f = (row.getCell(col).value as { formula?: string }).formula ?? '';
      expect(f, `Summary ${m} col ${col} should reference its own tab`).toContain(`'${m}'!`);
      expect(f, `Summary ${m} col ${col} should span the fillable rows`)
        .toMatch(new RegExp(`\\$${first}:\\$[A-Z]+\\$${last}`));
    }
  });

  it.each(MARKETPLACES)('%s — the return columns stay as exported', (m) => {
    const row = summaryRow(m);
    for (const col of [3, 4, 5, 7]) {
      expect(typeof row.getCell(col).value, `Summary ${m} col ${col} should be a plain figure`)
        .toBe('number');
    }
  });

  it('Net GP and Net GP % read this row, so they follow the two cells above them', () => {
    const row = summaryRow('AMAZON');
    const n = row.number;
    expect((row.getCell(8).value as { formula: string }).formula).toBe(`F${n}-G${n}`);
    const pct = (row.getCell(9).value as { formula: string }).formula;
    expect(pct).toContain(`F${n}-G${n}`);
    expect(pct).toContain('IFERROR');
  });

  it('the grand total sums the marketplace rows rather than keeping its own copy', () => {
    const total = summaryRow('TOTAL');
    const rowNums = MARKETPLACES.map(m => summaryRow(m).number);
    for (const col of [2, 3, 4, 5, 6, 7, 8]) {
      const f = (total.getCell(col).value as { formula: string }).formula;
      expect(f).toBe(rowNums.map(n => `${numToCol(col)}${n}`).join('+'));
    }
  });
});
