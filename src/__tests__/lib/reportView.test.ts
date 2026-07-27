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
      'Summary', 'AMAZON', 'BM', 'EBAY', 'ONBUY', 'TEMU',
      'Returns Summary', 'Returns Detail', 'Unit Histories',
    ]);
  });

  it('computes the EBAY GP and net GP% cells exactly as Excel would', async () => {
    const buf = await buildSalesWorkbookBuffer({
      sales: [baseSale({ buyPrice: 100, salePrice: 200, postage: 8 })],
    });
    const model = await viewModelFromXlsxBuffer(buf, 't');
    const ebay = model.sheets.find(s => s.name === 'EBAY')!;
    const dataRow = ebay.rows[1]; // row 1 = header, row 2 = first sale
    // Master math: I=100, J=16.67, T.COM=16.224, P=8, P.VAT=1.6,
    // Marketing=10, M.VAT=2, Acc=1 → GP = 44.506 → '44.51'
    expect(dataRow[21].display).toBe('44.51');           // V — GP
    // Net GP% = (GP − Postage Loss[blank→0]) / SP × 100 = 22.25
    expect(dataRow[22].display).toBe('22.25');           // W — GP %
    // Formula provenance is surfaced as a tooltip.
    expect(dataRow[21].title).toBe('=I2-J2-O2-P2-Q2-R2-S2-T2');
    // Dates render Excel-style.
    expect(dataRow[0].display).toBe('1-Jun-2026');
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
    const row = ebay.rows[1];
    expect(row[0].fillColor).toBe('#FEE2E2');            // rose-100 across the row
    expect(row[26].display).toBe('Refund');              // AA — Outcome
    expect(row[28].display).toBe('2');                   // AC — Shipping Legs
    expect(row[29].display).toBe('19.20');               // AD — Postage Loss (8+1.6)×2
    // Net GP% = (44.506 − 19.2) / 200 × 100 = 12.653 → '12.65'
    expect(row[22].display).toBe('12.65');
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
    const total = ebay.rows[3]; // header + 2 data rows + TOTAL
    expect(total[0].display).toBe('TOTAL');
    expect(total[6].display).toBe('150.00');             // G — SUM of BP 100+50
    expect(total[7].display).toBe('350.00');             // H — SUM of SP 200+150
    expect(total[0].bold).toBe(true);
    // Net GP% on the TOTAL row evaluates the IFERROR chain.
    expect(Number.isFinite(parseFloat(total[22].display))).toBe(true);
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
