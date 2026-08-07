/**
 * Tests for the in-browser report viewer (src/lib/reportView.ts).
 *
 * Two layers:
 *   1. evaluateFormula — the mini Excel evaluator must compute the exact
 *      formula set our writers emit (arithmetic, %, multi-letter cols,
 *      SUM ranges, IFERROR) and reject anything else.
 *   2. viewModelFromXlsxBuffer — golden integration: build the REAL sales
 *      workbook via buildSalesWorkbookBuffer, parse it into the view model,
 *      and assert the grid shows the same numbers Excel would compute
 *      (GP / net GP% / TOTAL SUMs), plus the voided-row red fill and the
 *      Summary tab — i.e. the preview is byte-equivalent to the download.
 */
import { describe, it, expect } from 'vitest';
import {
  evaluateFormula,
  viewModelFromXlsxBuffer,
  viewModelFromRows,
  numToCol,
  colToNum,
  type RefResolver,
} from '../../lib/reportView';
import { buildSalesWorkbookBuffer } from '../../lib/clientReport';
import type { Sale } from '../../types';

// ── Helpers ────────────────────────────────────────────────────────────────

const resolverFrom = (cells: Record<string, number>): RefResolver =>
  (ref) => cells[ref] ?? 0;

const baseSale = (over: Partial<Sale>): Sale => ({
  id: over.id ?? 'EBAY__ORD-1__IMEI-1',
  marketplace: 'EBAY',
  orderNumber: 'ORD-1',
  imei: '359108096724237',
  unitId: 'unit-1',
  supplierId: 'sup-1',
  supplierName: 'MHL',
  saleDate: '2026-06-01',
  quantity: 1,
  buyPrice: 100,
  salePrice: 200,
  postage: 8,
  postageVat: 1.6,
  importBatchId: 'test',
  sourceFile: 'test',
  sourceRow: 1,
  ownerId: 'shared',
  createdAt: '2026-06-01T00:00:00Z',
  updatedAt: '2026-06-01T00:00:00Z',
  ...over,
});

/**
 * Address a rendered cell by its COLUMN HEADER rather than its index.
 *
 * The indices used to be written as literals with the letter in a trailing
 * comment (`row[27]  // AB — Outcome`). That made every one of these tests a
 * second, silent copy of the column order: reordering the sheet moved the
 * numbers, the comments went stale, and the assertions carried on comparing
 * whatever happened to land in slot 27. Looking the column up by name states
 * what is actually being checked and survives the next reorder.
 */
const col = (sheet: { rows: any[][] }, header: string) => {
  const i = sheet.rows[0].findIndex(c => String(c.display ?? '').trim() === header);
  if (i < 0) throw new Error(`no "${header}" column — headers: ${sheet.rows[0].map((c: any) => c.display).join(' | ')}`);
  return i;
};
const cell = (sheet: { rows: any[][] }, rowIndex: number, header: string) =>
  sheet.rows[rowIndex][col(sheet, header)];

// ───────────────────────────────────────────────────────────────────────────
// evaluateFormula
// ───────────────────────────────────────────────────────────────────────────

describe('evaluateFormula', () => {
  it('basic arithmetic with cell refs', () => {
    const r = resolverFrom({ H2: 10, G2: 4 });
    expect(evaluateFormula('H2-G2', r)).toBe(6);
    expect(evaluateFormula('H2/100*7', r)).toBeCloseTo(0.7, 10);
  });

  it('percent literals divide by 100 (Excel semantics)', () => {
    const r = resolverFrom({ I2: 60, H2: 200 });
    expect(evaluateFormula('I2*16.67%', r)).toBeCloseTo(10.002, 6);
    expect(evaluateFormula('H2*5%', r)).toBeCloseTo(10, 10);
  });

  it("eBay's reduced-commission chain matches the master sheet", () => {
    const r = resolverFrom({ H2: 200 });
    // (200×6.9%) − (200×6.9%)×10% = 13.8 − 1.38 = 12.42
    expect(evaluateFormula('(H2*6.9%)-(H2*6.9%)*10%', r)).toBeCloseTo(12.42, 6);
  });

  it('multi-letter column refs (past Z) resolve', () => {
    const r = resolverFrom({ AA4: 19.2, AD2: 28.8, S4: 100, G4: 50 });
    expect(evaluateFormula('(S4-AA4)/G4*100', r)).toBeCloseTo(161.6, 6);
    expect(evaluateFormula('AD2*2', r)).toBeCloseTo(57.6, 6);
  });

  it('SUM over a range', () => {
    const r = resolverFrom({ G2: 100, G3: 150, G4: 50 });
    expect(evaluateFormula('SUM(G2:G4)', r)).toBe(300);
    expect(evaluateFormula('SUM(G2:G3)+G4', r)).toBe(300);
  });

  it('IFERROR catches division by zero', () => {
    const r = resolverFrom({ S4: 100, AA4: 0, G4: 0 });
    expect(evaluateFormula('IFERROR((S4-AA4)/G4*100,0)', r)).toBe(0);
    // …and passes the value through when the denominator is fine.
    const r2 = resolverFrom({ S4: 100, AA4: 0, G4: 50 });
    expect(evaluateFormula('IFERROR((S4-AA4)/G4*100,0)', r2)).toBeCloseTo(200, 10);
  });

  it('unary minus and nested parens', () => {
    const r = resolverFrom({ A1: 5 });
    expect(evaluateFormula('-A1+(2*(3+1))', r)).toBe(3);
  });

  it('throws on unsupported functions (caller falls back to raw text)', () => {
    expect(() => evaluateFormula('VLOOKUP(A1,B1:C9,2)', resolverFrom({}))).toThrow();
  });
});

describe('column letter helpers', () => {
  it('round-trips through the AA boundary', () => {
    for (const n of [1, 26, 27, 30, 52, 53, 702, 703]) {
      expect(colToNum(numToCol(n))).toBe(n);
    }
    expect(numToCol(30)).toBe('AD');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Golden integration — preview ≡ download
// ───────────────────────────────────────────────────────────────────────────

describe('viewModelFromXlsxBuffer — exact Excel view of the Sales Report', () => {
  it('renders sheet tabs in workbook order', async () => {
    const buf = await buildSalesWorkbookBuffer({ sales: [] });
    const model = await viewModelFromXlsxBuffer(buf, 'Sales Report · all-time');
    expect(model.title).toBe('Sales Report · all-time');
    expect(model.sheets.map(s => s.name)).toEqual([
      'Summary', 'AMAZON', 'BM', 'EBAY', 'ONBUY', 'TEMU', 'Returns & Profit', 'Accessories',
      'Returns Summary', 'Returns Detail', 'Unit Histories',
    ]);
  });

  it('computes the EBAY GP and net GP% cells exactly as Excel would', async () => {
    const buf = await buildSalesWorkbookBuffer({
      sales: [baseSale({ buyPrice: 100, salePrice: 200, postage: 8 })],
    });
    const model = await viewModelFromXlsxBuffer(buf, 't');
    const ebay = model.sheets.find(s => s.name === 'EBAY')!;
    // Row 0 = header, row 1 = first sale.
    // Master math: SP−BP=100, Marginal Tax=16.67, T.COM=16.224, Postage=8,
    // P. VAT=1.6 (carried from the sale — eBay does not derive it),
    // Marketing=0, M. VAT=0, Acc=1 → GP = 56.506 → '56.51'. Marketing is £0
    // because the operator's master types the spend per row and this fixture
    // sets none; before 2026-08 we invented SP × 5% = £10 (+£2 VAT) and
    // charged it to GP.
    expect(cell(ebay, 1, 'GP').display).toBe('56.51');
    // Net GP% = (GP − Postage Loss[blank→0]) / SP × 100 = 28.25
    expect(cell(ebay, 1, 'GP %').display).toBe('28.25');
    // Formula provenance is surfaced as a tooltip. The operand list is what
    // matters — SP−BP less Marginal Tax, T.COM, Postage, P. VAT, Marketing,
    // M. VAT and Accessories — and salesReportFormulaParity.test.ts pins it
    // independently against SALES_SCHEMA_AND_CALCULATIONS.md.
    expect(cell(ebay, 1, 'GP').title).toBe('=L2-M2-R2-S2-T2-U2-V2-W2');
    // Dates render Excel-style.
    expect(cell(ebay, 1, 'Date').display).toBe('1-Jun-2026');
  });

  it('voided rows carry the red fill + return block; net GP% subtracts the loss', async () => {
    const buf = await buildSalesWorkbookBuffer({
      sales: [baseSale({
        id: 'EBAY__ORD-V__IMEI-9', orderNumber: 'ORD-V',
        buyPrice: 100, salePrice: 200, postage: 8,
        voidedAt: '2026-06-05', voidOutcome: 'refund', voidReason: 'changed mind',
      })],
    });
    const model = await viewModelFromXlsxBuffer(buf, 't');
    const ebay = model.sheets.find(s => s.name === 'EBAY')!;
    expect(cell(ebay, 1, 'Date').fillColor).toBe('#FEE2E2');   // rose-100 across the row
    expect(cell(ebay, 1, 'Outcome').display).toBe('Refund');
    expect(cell(ebay, 1, 'Shipping Legs').display).toBe('2');
    expect(cell(ebay, 1, 'Postage Loss').display).toBe('19.20'); // (8+1.6)×2
    // Net GP% = (56.506 − 19.2) / 200 × 100 = 18.653 → '18.65'
    expect(cell(ebay, 1, 'GP %').display).toBe('18.65');
  });

  it('TOTAL row SUMs compute and render bold', async () => {
    const buf = await buildSalesWorkbookBuffer({
      sales: [
        baseSale({ id: 'EBAY__O1__A', orderNumber: 'O1', buyPrice: 100, salePrice: 200 }),
        baseSale({ id: 'EBAY__O2__B', orderNumber: 'O2', buyPrice: 50,  salePrice: 150 }),
      ],
    });
    const model = await viewModelFromXlsxBuffer(buf, 't');
    const ebay = model.sheets.find(s => s.name === 'EBAY')!;
    const total = ebay.rows.find(r => r[0].display === 'TOTAL')!;
    expect(total, 'the preview renders a TOTAL row').toBeDefined();
    // Blank fillable rows sit between the data and the TOTAL. They contribute
    // nothing, so the sums are still just the two real sales.
    expect(total[col(ebay, 'BP')].display).toBe('150.00');   // 100 + 50
    expect(total[col(ebay, 'SP')].display).toBe('350.00');   // 200 + 150
    expect(total[0].bold).toBe(true);
    // Net GP% on the TOTAL row evaluates the IFERROR chain.
    expect(Number.isFinite(parseFloat(total[col(ebay, 'GP %')].display))).toBe(true);

    // And the fillable rows themselves render EMPTY, not as a wall of 0.00 —
    // the guard is IF($<SP>n="","",…) and the preview must honour it.
    expect(cell(ebay, 3, 'SP-BP').display, 'SP-BP on an untouched row').toBe('');
    expect(cell(ebay, 3, 'GP').display, 'GP on an untouched row').toBe('');
  });

  it('Summary tab carries the per-marketplace roll-up', async () => {
    const buf = await buildSalesWorkbookBuffer({
      sales: [baseSale({ buyPrice: 100, salePrice: 200 })],
    });
    const model = await viewModelFromXlsxBuffer(buf, 't');
    const summary = model.sheets[0];
    expect(summary.name).toBe('Summary');
    const flat = summary.rows.map(r => r.map(c => c.display).join('|'));
    expect(flat.some(line => line.startsWith('Marketplace'))).toBe(true);
    expect(flat.some(line => line.startsWith('TOTAL'))).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// CSV-rows adapter (Inventory Report)
// ───────────────────────────────────────────────────────────────────────────

describe('viewModelFromRows — Inventory Report preview', () => {
  it('renders header + typed cells from the same row objects the CSV saves', () => {
    const model = viewModelFromRows('Inventory Report · today', 'INVENTORY', [
      { 'Stock In Date': '2026-06-01', 'Model': 'IPHONE SE 3 128GB', 'BP': 100.5, 'Age (days)': 11 },
    ]);
    expect(model.sheets).toHaveLength(1);
    const sheet = model.sheets[0];
    expect(sheet.name).toBe('INVENTORY');
    const [header, row] = sheet.rows;
    expect(header.map(c => c.display)).toEqual(['Stock In Date', 'Model', 'BP', 'Age (days)']);
    expect(header.every(c => c.bold)).toBe(true);
    expect(row[2].display).toBe('100.50');
    expect(row[2].align).toBe('right');
    expect(row[3].display).toBe('11');
    expect(row[1].align).toBe('left');
  });

  it('handles an empty report without blowing up', () => {
    const model = viewModelFromRows('Inventory Report · today', 'INVENTORY', []);
    expect(model.sheets[0].rows).toEqual([]);
  });
});
