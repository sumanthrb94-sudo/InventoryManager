/**
 * A return belongs to the week the money went out.
 *
 * The Returns & Profit sheet used to filter EVERYTHING by sale date, which
 * silently dropped any return whose sale fell outside the window. The
 * operator hit it on a real unit: a Samsung S21FE sold on AMAZON on 7 Aug and
 * refunded on 14 Aug simply vanished from a 9-15 Aug report — Amazon showed a
 * Return Cost of 0.00 and a Net GP GBP 15.12 too high, while the Returns
 * Summary sheet in the same workbook reported two returns and GBP 30.24.
 *
 * The confusing part was that the sheet was not empty: the ONE return it did
 * show belonged to a different unit, sold inside the window, on a different
 * marketplace. So it read as "the Amazon return was posted to BM" when in
 * fact the Amazon return was not there at all.
 *
 * Revenue and Gross GP stay on SALE date. Only the return half moved.
 */
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { buildSalesWorkbookBuffer } from '../../lib/clientReport';
import type { InventoryUnit, Sale } from '../../types';

const WEEK = { from: '2026-08-09', to: '2026-08-15' };

/** The operator's actual unit, to the penny. */
const S21FE: InventoryUnit = {
  id: 'u-s21fe', imei: '350799512745897', model: 'SAMSUNG GALAXY S21FE',
  storage: '128GB', colour: 'GRAY', status: 'available', buyPrice: 115,
  dateIn: '2026-08-07', supplierName: 'NIHAL', flags: [],
  returnType: 'returned_to_inventory', returnDate: '2026-08-14',
  returnOutcome: 'refund', returnLegCost: 7.56,
} as InventoryUnit;

/** Sold BEFORE the window, returned INSIDE it. */
const AMAZON_SALE: Sale = {
  id: 's-amz', marketplace: 'AMAZON', orderNumber: '204-7639131-4661133',
  saleDate: '2026-08-07', quantity: 1, buyPrice: 115, salePrice: 169.99,
  postage: 6.30, postageVat: 1.26, imei: '350799512745897', unitId: 'u-s21fe',
  grossProfit: 22, voidedAt: '2026-08-14', voidOutcome: 'refund',
  voidReason: 'Change of Mind',
} as Sale;

/** A clean AMAZON sale inside the window, so the channel has revenue too. */
const AMAZON_KEPT: Sale = {
  id: 's-amz2', marketplace: 'AMAZON', orderNumber: 'AMZ-KEPT',
  saleDate: '2026-08-12', quantity: 1, buyPrice: 100, salePrice: 200,
  postage: 6.30, imei: '350111000000099', unitId: 'u-keep', grossProfit: 40,
} as Sale;
const KEPT_UNIT = { id: 'u-keep', imei: '350111000000099', model: 'iPhone 13',
  status: 'sold', buyPrice: 100, dateIn: '2026-08-01', flags: [] } as InventoryUnit;

async function returnsProfit(sales: Sale[], units: InventoryUnit[]) {
  const buf = await buildSalesWorkbookBuffer({ sales, units, opts: WEEK } as never);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as never);
  const ws = wb.getWorksheet('Returns & Profit')!;
  // The header row is the one starting "Marketplace"; rows follow until TOTAL.
  let headerRow = 0;
  for (let r = 1; r <= ws.rowCount; r++) {
    if (String(ws.getRow(r).getCell(1).value ?? '').trim() === 'Marketplace') { headerRow = r; break; }
  }
  const headers = (ws.getRow(headerRow).values as unknown[]).slice(1).map(v => String(v ?? '').trim());
  const rowFor = (label: string) => {
    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      if (String(ws.getRow(r).getCell(1).value ?? '').trim() === label) return r;
    }
    throw new Error(`no "${label}" row on Returns & Profit`);
  };
  return (label: string, header: string) =>
    Number(ws.getRow(rowFor(label)).getCell(headers.indexOf(header) + 1).value ?? 0);
}

describe('a return lands on the marketplace that took it, in the week it happened', () => {
  it('the Amazon return appears even though the sale predates the window', async () => {
    const cell = await returnsProfit([AMAZON_SALE, AMAZON_KEPT], [S21FE, KEPT_UNIT]);
    expect(cell('AMAZON', 'Returns'), 'the return is counted').toBe(1);
    expect(cell('AMAZON', 'Refunds')).toBe(1);
    // 2 legs x 7.56 — the figure the Returns screen shows for this unit.
    expect(cell('AMAZON', 'Carriage £')).toBeCloseTo(15.12, 2);
    expect(cell('AMAZON', 'Return Cost £')).toBeCloseTo(15.12, 2);
  });

  it('its cost comes off that channel\'s Net GP, not another one\'s', async () => {
    const cell = await returnsProfit([AMAZON_SALE, AMAZON_KEPT], [S21FE, KEPT_UNIT]);
    // Only the kept sale contributes gross profit; the refunded one kept none.
    expect(cell('AMAZON', 'Gross GP £')).toBeCloseTo(40, 2);
    expect(cell('AMAZON', 'Net GP £'), 'gross minus the return cost')
      .toBeCloseTo(40 - 15.12, 2);
  });

  it('the refunded sale still contributes no revenue — it did not keep the money', async () => {
    const cell = await returnsProfit([AMAZON_SALE, AMAZON_KEPT], [S21FE, KEPT_UNIT]);
    expect(cell('AMAZON', 'Sales'), 'one kept sale, not two').toBe(1);
    expect(cell('AMAZON', 'Revenue £')).toBeCloseTo(200, 2);
  });

  it('a return OUTSIDE the window stays out, sale date notwithstanding', async () => {
    // The mirror image, and the reason this is a filter rather than a
    // free-for-all: sold inside the week, returned weeks later. The cost
    // belongs to September, so this week must not carry it.
    //
    // The channel ends up with NO ROW at all, which is right and worth
    // stating: the only sale it had was refunded, so it kept no revenue
    // (saleKeptItsRevenue), and its return is in a later period. Nothing
    // happened on Amazon this week that this sheet reports on. A row of
    // zeroes would imply the channel was active and broke even.
    const laterReturn = { ...S21FE, returnDate: '2026-09-02' } as InventoryUnit;
    const soldInside = { ...AMAZON_SALE, saleDate: '2026-08-11',
                         voidedAt: '2026-09-02' } as Sale;
    const cell = await returnsProfit([soldInside, {
      ...AMAZON_KEPT, marketplace: 'BM', id: 's-bm-keep',
    } as Sale], [laterReturn, KEPT_UNIT]);

    expect(() => cell('AMAZON', 'Returns'),
      'Amazon has nothing to report this week').toThrow(/no "AMAZON" row/);
    // And the cost did not leak onto whatever channel WAS active.
    expect(cell('BM', 'Return Cost £')).toBe(0);
    expect(cell('TOTAL', 'Return Cost £')).toBe(0);
  });

  it('two returns on two channels each land on their own', async () => {
    // The shape that made the bug look like mis-attribution rather than a
    // dropped row: one return survives the old filter, the other does not,
    // and they are on different marketplaces.
    const bmUnit = { id: 'u-bm', imei: 'R52H81JPZCZ', model: 'SG TABA',
      status: 'available', buyPrice: 80, dateIn: '2026-08-01', flags: [],
      returnType: 'returned_to_inventory', returnDate: '2026-08-13',
      returnOutcome: 'refund', returnLegCost: 7.56 } as InventoryUnit;
    const bmSale = { id: 's-bm', marketplace: 'BM', orderNumber: 'BM-1',
      saleDate: '2026-08-11', quantity: 1, buyPrice: 80, salePrice: 120,
      postage: 6.30, postageVat: 1.26, imei: 'R52H81JPZCZ', unitId: 'u-bm',
      grossProfit: 10, voidedAt: '2026-08-13', voidOutcome: 'refund' } as Sale;

    const cell = await returnsProfit([AMAZON_SALE, bmSale], [S21FE, bmUnit]);
    expect(cell('AMAZON', 'Returns'), 'sold 7 Aug, returned 14 Aug').toBe(1);
    expect(cell('BM', 'Returns'), 'sold 11 Aug, returned 13 Aug').toBe(1);
    expect(cell('AMAZON', 'Return Cost £')).toBeCloseTo(15.12, 2);
    expect(cell('BM', 'Return Cost £')).toBeCloseTo(15.12, 2);
    expect(cell('TOTAL', 'Return Cost £'), 'both, not one').toBeCloseTo(30.24, 2);
  });

  it('an all-time report is unaffected — no window, everything counts', async () => {
    const buf = await buildSalesWorkbookBuffer({
      sales: [AMAZON_SALE], units: [S21FE],
    } as never);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as never);
    const ws = wb.getWorksheet('Returns & Profit')!;
    let found = false;
    for (let r = 1; r <= ws.rowCount; r++) {
      if (String(ws.getRow(r).getCell(1).value ?? '').trim() === 'AMAZON') { found = true; break; }
    }
    expect(found, 'AMAZON has a row').toBe(true);
  });
});
