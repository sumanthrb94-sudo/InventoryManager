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
  BM: 28,
  EBAY: 34,
  ONBUY: 28,
  TEMU: 29,
};

/** §2.2 — "Trailing return-linkage block, every marketplace". */
const RETURN_BLOCK = [
  'Return Date', 'Outcome', 'Return Reason', 'Shipping Legs',
  'Postage Loss', 'Net GP £',
];

/** §2.2 — "Then, last on every marketplace sheet". */
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

  it('ends every tab with the return block, then Storage and Colour', async () => {
    const wb = await exportedWorkbook();
    for (const m of MARKETPLACES) {
      const h = headersOf(wb.getWorksheet(m)!);
      expect(h.slice(-8), `${m} tab tail`).toEqual([...RETURN_BLOCK, ...BUY_SIDE_TAIL]);
    }
  });

  /**
   * The reason the tail is fixed: every GP / GP % / Total VAT NTP / TOTAL
   * formula on these tabs references hard column letters (see `writeSaleRow`).
   * A column inserted mid-sheet shifts those letters and the arithmetic then
   * points one column left while still looking plausible. New columns go on
   * the end — this asserts `Model` closes the value block and nothing has
   * been slipped in beside `SKU`.
   */
  it('places Model after Comments, not beside SKU', async () => {
    const wb = await exportedWorkbook();
    for (const m of MARKETPLACES) {
      const h = headersOf(wb.getWorksheet(m)!);
      expect(h.indexOf('Model'), `${m} Model`).toBe(h.indexOf('Comments') + 1);
      expect(h.indexOf('Model'), `${m} Model`).toBe(h.indexOf('Return Date') - 1);
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
