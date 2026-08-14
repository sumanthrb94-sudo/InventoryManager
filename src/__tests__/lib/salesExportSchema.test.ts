/**
 * The Sales Report's EXPORT column contract, pinned against the SOP.
 *
 * Why this file exists: `templates/REPORT_SCHEMAS.md` §2.2 is the document an
 * accountant or a new operator reads to know what a downloaded Sales Report
 * contains. It had drifted — it claimed AMAZON 28 / BM 25 / EBAY 31 / ONBUY 25
 * / TEMU 26 columns while the exporter had been emitting three more on every
 * tab (`Model`, then `Storage` / `Colour`) since those columns were added.
 * Nothing failed, because nothing compared the two.
 *
 * So the expectations below are transcribed BY HAND from §2.2, deliberately
 * NOT imported from `clientReport.ts`. If they were imported the test would
 * only prove the exporter agrees with itself. Adding a column to a marketplace
 * tab must fail here, and the fix is to update §2.2 in the same commit.
 *
 * These assertions read a workbook actually produced by
 * `buildSalesWorkbookBuffer`, not the `SALES_HEADERS` constant, so they pin
 * what an operator really downloads.
 */
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { buildSalesWorkbookBuffer } from '../../lib/clientReport';
import { MARKETPLACES } from '../../types';
import type { InventoryUnit, Marketplace, Sale } from '../../types';

/** templates/REPORT_SCHEMAS.md §2.2 — "Column counts". */
const DOCUMENTED_COUNTS: Record<Marketplace, number> = {
  AMAZON: 31,
  // 2026-08-14, from the client's own report: BM gained Payment Mode and
  // PSF; TEMU gained Commission+VAT.
  BM: 30,
  EBAY: 34,
  ONBUY: 28,
  TEMU: 30,
};

/** §2.2 block 3 — "Return", the tail of every marketplace sheet.
 *  `Postage Loss` / `Net GP £` are no longer here: they close the money block,
 *  which is where the bottom line belongs. */
const RETURN_BLOCK = [
  'Return Date', 'Outcome', 'Shipping Legs', 'Return Reason', 'Comments',
];

/** §2.2 — the attributes that make a re-import self-healing. They now sit in
 *  the identity block beside `Model` rather than trailing the sheet. */
const BUY_SIDE_TAIL = ['Storage', 'Colour'];

/** §2.2 — "Marketplace-specific fee columns". */
const FEE_COLUMNS: Record<Marketplace, string[]> = {
  AMAZON: ['C. VAT', 'DSF', 'DSF. VAT'],
  BM: ['Customer Care Fees'],
  EBAY: ['ROF', 'FVF', 'VAT', 'T.COM', 'Marketing', 'M. VAT'],
  ONBUY: ['VAT 20%'],
  TEMU: ['Commission VAT'],
};

const unit = (o: Partial<InventoryUnit> = {}): InventoryUnit => ({
  id: 'u1', imei: '350111000000011', model: 'Galaxy A21S', storage: '32GB',
  colour: 'Midnight', status: 'sold', buyPrice: 50, dateIn: '2026-07-01',
  flags: [], platformListed: false, supplierId: 'sup-1', supplierName: 'IMAX',
  ownerId: 'shared', createdAt: '2026-07-01',
  ...o,
} as InventoryUnit);

const sale = (m: Marketplace): Sale => ({
  id: `${m}__A1__350111000000011`, marketplace: m, orderNumber: 'A1',
  imei: '350111000000011', unitId: 'u1', sku: 'Samsung Galaxy A21S',
  saleDate: '2026-07-29', quantity: 1, buyPrice: 50, salePrice: 89.99,
  spMinusBp: 39.99, marginalTax: 6.67, commission: 6.3, postage: 6.3,
  grossProfit: 20, gpPercent: 40,
  importBatchId: 'b1', sourceFile: 'f', sourceRow: 1, importedAt: '',
  createdAt: '', updatedAt: '', ownerId: 'shared',
} as Sale);

const headersOf = (ws: ExcelJS.Worksheet) =>
  (ws.getRow(1).values as unknown[]).slice(1).map(h => String(h ?? '').trim());

async function exportedWorkbook() {
  const buf = await buildSalesWorkbookBuffer({
    sales: MARKETPLACES.map(sale),
    units: [unit()],
    supplierMap: {},
    opts: {} as never,
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as ArrayBuffer);
  return wb;
}

describe('Sales Report export matches templates/REPORT_SCHEMAS.md §2.2', () => {
  it('emits exactly the documented number of columns per marketplace', async () => {
    const wb = await exportedWorkbook();
    const actual = Object.fromEntries(
      MARKETPLACES.map(m => [m, headersOf(wb.getWorksheet(m)!).length]),
    );
    // One assertion over the whole map, so a failure names every tab that
    // drifted rather than stopping at the first.
    expect(actual).toEqual(DOCUMENTED_COUNTS);
  });

  it('ends every tab with the return block, closing on Comments', async () => {
    const wb = await exportedWorkbook();
    for (const m of MARKETPLACES) {
      const h = headersOf(wb.getWorksheet(m)!);
      expect(h.slice(-RETURN_BLOCK.length), `${m} tab tail`).toEqual(RETURN_BLOCK);
    }
  });

  /**
   * §2.2's first block: the handset is described in one place. `Model`,
   * `Colour` and `Storage` sit directly after `IMEI` so a row reads
   * "iPhone 13 / Black / 128GB" side by side instead of scattering the three
   * across a 34-column sheet.
   *
   * This used to assert the opposite — Model appended after Comments — because
   * the formulas referenced hard column letters and appending was the only
   * safe way to add a column. They now resolve by header name via `salesCol`,
   * so the order is a presentation decision and this pins the chosen one.
   */
  it('describes the handset in one block, right after IMEI', async () => {
    const wb = await exportedWorkbook();
    for (const m of MARKETPLACES) {
      const h = headersOf(wb.getWorksheet(m)!);
      expect(h.slice(0, 8), `${m} identity block`).toEqual([
        'Date', 'Order Number', 'SKU', 'IMEI',
        'Model', 'Colour', 'Storage', 'Supplier',
      ]);
    }
  });

  /**
   * The money block runs unbroken from the quantity column to the bottom
   * line, with nothing descriptive wedged into it. Asserted as a contiguous
   * run rather than fixed indices, because ONBUY has no quantity column and
   * each marketplace carries its own fee columns in the middle.
   */
  it('runs the money columns in one unbroken block ending on Net GP £', async () => {
    const wb = await exportedWorkbook();
    for (const m of MARKETPLACES) {
      const h = headersOf(wb.getWorksheet(m)!);
      // Nothing from the identity or return blocks appears between BP and the
      // bottom line.
      const money = h.slice(h.indexOf('BP'), h.indexOf('Net GP £') + 1);
      for (const stray of ['Model', 'Colour', 'Storage', 'Supplier', 'SKU',
                           'IMEI', 'Return Date', 'Outcome', 'Comments']) {
        expect(money, `${m} money block contains ${stray}`).not.toContain(stray);
      }
      expect(money.slice(-5), `${m} money tail`).toEqual([
        'GP', 'GP %', 'Total VAT NTP', 'Postage Loss', 'Net GP £',
      ]);
    }
  });

  it('still carries Storage and Colour so a re-import can self-heal', async () => {
    const wb = await exportedWorkbook();
    for (const m of MARKETPLACES) {
      const h = headersOf(wb.getWorksheet(m)!);
      for (const c of BUY_SIDE_TAIL) expect(h, `${m} ${c}`).toContain(c);
    }
  });

  it('carries the documented marketplace-specific fee columns', async () => {
    const wb = await exportedWorkbook();
    for (const m of MARKETPLACES) {
      const h = headersOf(wb.getWorksheet(m)!);
      for (const c of FEE_COLUMNS[m]) expect(h, `${m} tab`).toContain(c);
    }
  });

  /**
   * Two absences §2.2 calls out explicitly, because both are easy to
   * "helpfully" add back and both would be wrong:
   *   BM    — no Total VAT column; its only VAT line is P. VAT, so
   *           Total VAT NTP = Marginal Tax − P. VAT directly.
   *   ONBUY — no Quantity column at all, which is why its BP and SP sit one
   *           position left of every other marketplace.
   */
  it('keeps BM without Total VAT and ONBUY without Quantity', async () => {
    const wb = await exportedWorkbook();
    expect(headersOf(wb.getWorksheet('BM')!)).not.toContain('Total VAT');
    expect(headersOf(wb.getWorksheet('ONBUY')!)).not.toContain('Quantity');
  });

  it('uses Units, not Quantity, on the eBay tab', async () => {
    const wb = await exportedWorkbook();
    const h = headersOf(wb.getWorksheet('EBAY')!);
    expect(h).toContain('Units');
    expect(h).not.toContain('Quantity');
  });
});
