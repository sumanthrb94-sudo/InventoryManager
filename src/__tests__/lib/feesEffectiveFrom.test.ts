/**
 * The 2026-08-14 fee changes are NOT retroactive.
 *
 * BM's PSF and Temu's 3.96% commission apply to units marked sold from
 * deployment onward. Anything sold before that keeps the schedule that was in
 * force when it happened.
 *
 * This is not a cosmetic distinction. The Sales Report's money columns are
 * LIVE EXCEL FORMULAS regenerated at export from the current fee schedule —
 * not stored values — so without a date gate, downloading the report would
 * take 1% of the sale price off the GP of every BM sale ever made and put
 * margin back on every Temu sale ever made, in workbooks the operator had
 * already reconciled and filed.
 *
 * The stored sale documents were never at risk: an export does not write to
 * them. What was at risk was the number the client reads.
 */
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import {
  calcSaleFinancials, getMarketplaceFee, excelFormulaFor, salesColLetter,
  FEES_EFFECTIVE_FROM,
} from '../../lib/platforms';
import { buildSalesWorkbookBuffer } from '../../lib/clientReport';
import type { InventoryUnit, Sale } from '../../types';

/** A day before the cutover, and one on it. */
const BEFORE = '2026-04-02';
const ON = FEES_EFFECTIVE_FROM;

describe('the fee schedule knows what day it is', () => {
  it('BM had no PSF before the cutover, and has it from the cutover on', () => {
    expect(getMarketplaceFee('BM', BEFORE).psfPct).toBe(0);
    expect(getMarketplaceFee('BM', ON).psfPct).toBe(1);
  });

  it('Temu was 4.61% before the cutover, 3.96% from it', () => {
    expect(getMarketplaceFee('TEMU', BEFORE).commissionPct).toBe(4.61);
    expect(getMarketplaceFee('TEMU', ON).commissionPct).toBe(3.96);
  });

  it('no date means today\'s schedule — every new sale takes this path', () => {
    expect(getMarketplaceFee('BM').psfPct).toBe(1);
    expect(getMarketplaceFee('TEMU').commissionPct).toBe(3.96);
  });

  it('only the fields that changed are frozen', () => {
    // A sparse patch, not a snapshot. If BM's commission or care fee is
    // corrected tomorrow, historic rows must pick that up — those were not
    // part of the 14-Aug change and freezing them would be a second,
    // accidental effective-date nobody asked for.
    const then = getMarketplaceFee('BM', BEFORE);
    const now = getMarketplaceFee('BM', ON);
    expect(then.commissionPct).toBe(now.commissionPct);
    expect(then.customerCareFees).toBe(now.customerCareFees);
    expect(then.accessoryFee).toBe(now.accessoryFee);
  });

  it('a date carrying a time still resolves to the right side', () => {
    // Sale dates are yyyy-mm-dd, but a Firestore round trip can hand back an
    // ISO timestamp. The comparison takes the first ten characters.
    expect(getMarketplaceFee('TEMU', `${BEFORE}T23:59:59.000Z`).commissionPct).toBe(4.61);
    expect(getMarketplaceFee('TEMU', `${ON}T00:00:00.000Z`).commissionPct).toBe(3.96);
  });

  it('leaves the other three marketplaces alone entirely', () => {
    for (const m of ['AMAZON', 'EBAY', 'ONBUY'] as const) {
      expect(getMarketplaceFee(m, BEFORE)).toEqual(getMarketplaceFee(m, ON));
    }
  });
});

describe('the runtime calculator does not restate a historic sale', () => {
  it('a BM sale from before the cutover carries no PSF', () => {
    const then = calcSaleFinancials({
      marketplace: 'BM', buyPrice: 105, salePrice: 205, postageOverride: 6.30,
      saleDate: BEFORE,
    });
    const now = calcSaleFinancials({
      marketplace: 'BM', buyPrice: 105, salePrice: 205, postageOverride: 6.30,
      saleDate: ON,
    });
    expect(then.psf).toBe(0);
    expect(now.psf).toBe(2.05);
    // The whole difference in GP is the fee, and nothing else moved.
    expect(Math.round((then.grossProfit - now.grossProfit) * 100) / 100).toBe(2.05);
  });

  it('a Temu sale from before the cutover keeps 4.61%', () => {
    const then = calcSaleFinancials({
      marketplace: 'TEMU', buyPrice: 58, salePrice: 83.99, postageOverride: 6.30,
      saleDate: BEFORE,
    });
    expect(then.commission).toBe(3.87);      // 83.99 x 4.61%
    const now = calcSaleFinancials({
      marketplace: 'TEMU', buyPrice: 58, salePrice: 83.99, postageOverride: 6.30,
      saleDate: ON,
    });
    expect(now.commission).toBe(3.33);       // 83.99 x 3.96%
  });
});

describe('the report exports each row at the rates that applied to it', () => {
  const unit = (id: string, imei: string): InventoryUnit => ({
    id, imei, model: 'iPhone 13', colour: 'Black', storage: '128GB', status: 'sold',
    buyPrice: 105, dateIn: '2026-03-01', flags: [], supplierName: 'NANAK',
  } as InventoryUnit);

  const sale = (o: Partial<Sale>): Sale => ({
    quantity: 1, buyPrice: 105, salePrice: 205, postage: 6.30, ...o,
  } as Sale);

  /**
   * Cells addressed by ORDER NUMBER, never by row position. The writer sorts a
   * tab newest-first, so the row an older sale lands on is not the row it was
   * passed in at — an early version of this test asserted position and read
   * the wrong sale's cells.
   */
  async function tab(name: string, sales: Sale[], units: InventoryUnit[]) {
    const buf = await buildSalesWorkbookBuffer({ sales, units } as never);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as never);
    const ws = wb.getWorksheet(name)!;
    const headers = (ws.getRow(1).values as unknown[]).slice(1).map(v => String(v ?? '').trim());
    const raw = (row: number, header: string) => {
      const v = ws.getRow(row).getCell(headers.indexOf(header) + 1).value as
        { formula?: string } | number | null;
      return v && typeof v === 'object' && 'formula' in v ? `=${v.formula}` : v;
    };
    const rowOf = (orderNumber: string) => {
      for (let r = 2; r <= ws.rowCount; r++) {
        if (String(raw(r, 'Order Number') ?? '') === orderNumber) return r;
      }
      throw new Error(`no row for order ${orderNumber} on ${name}`);
    };
    /** First blank primed row — the one an operator would type into next. */
    const firstPrimedRow = () => {
      for (let r = 2; r <= ws.rowCount; r++) {
        if (!String(raw(r, 'Order Number') ?? '').trim()) return r;
      }
      throw new Error(`no primed row on ${name}`);
    };
    return { raw, rowOf, firstPrimedRow,
             cellFor: (order: string, header: string) => raw(rowOf(order), header) };
  }

  it('an old BM row gets a plain 0 for PSF; a new one gets the formula', async () => {
    const t = await tab('BM', [
      sale({ id: 'a', marketplace: 'BM', orderNumber: 'OLD', saleDate: BEFORE,
             imei: '350111000000011', unitId: 'u1' }),
      sale({ id: 'b', marketplace: 'BM', orderNumber: 'NEW', saleDate: ON,
             imei: '350111000000012', unitId: 'u2' }),
    ], [unit('u1', '350111000000011'), unit('u2', '350111000000012')]);

    expect(t.cellFor('OLD', 'PSF'), 'a sale made before the fee existed').toBe(0);
    expect(t.cellFor('NEW', 'PSF'))
      .toBe(`=${salesColLetter('BM', 'SP')}${t.rowOf('NEW')}*1%`);
  });

  it('the old row\'s GP still subtracts the PSF cell, so the column totals', async () => {
    // The cell is 0, not absent. Dropping it from the chain would make one
    // row's GP formula differ in shape from its neighbours' — and the TOTAL
    // row sums the column either way.
    const t = await tab('BM', [
      sale({ id: 'a', marketplace: 'BM', orderNumber: 'OLD', saleDate: BEFORE,
             imei: '350111000000011', unitId: 'u1' }),
    ], [unit('u1', '350111000000011')]);
    expect(String(t.cellFor('OLD', 'GP')))
      .toContain(`-${salesColLetter('BM', 'PSF')}${t.rowOf('OLD')}`);
  });

  it('an old Temu row exports at 4.61%, a new one at 3.96%', async () => {
    const t = await tab('TEMU', [
      sale({ id: 'a', marketplace: 'TEMU', orderNumber: 'OLD', saleDate: BEFORE,
             salePrice: 83.99, imei: '350111000000011', unitId: 'u1' }),
      sale({ id: 'b', marketplace: 'TEMU', orderNumber: 'NEW', saleDate: ON,
             salePrice: 83.99, imei: '350111000000012', unitId: 'u2' }),
    ], [unit('u1', '350111000000011'), unit('u2', '350111000000012')]);

    const sp = salesColLetter('TEMU', 'SP');
    expect(t.cellFor('OLD', 'Commission')).toBe(`=${sp}${t.rowOf('OLD')}*4.61%`);
    expect(t.cellFor('NEW', 'Commission')).toBe(`=${sp}${t.rowOf('NEW')}*3.96%`);
  });

  it('the blank primed rows are future sales, so they carry the new rates', async () => {
    // They exist to be typed into. A row the operator fills in tomorrow is a
    // sale made tomorrow, whatever the rows above it say.
    const t = await tab('BM', [
      sale({ id: 'a', marketplace: 'BM', orderNumber: 'OLD', saleDate: BEFORE,
             imei: '350111000000011', unitId: 'u1' }),
    ], [unit('u1', '350111000000011')]);
    expect(String(t.raw(t.firstPrimedRow(), 'PSF'))).toContain('1%');
  });
});

describe('excelFormulaFor on its own', () => {
  it('omits PSF entirely for a pre-cutover row', () => {
    expect(excelFormulaFor('BM', 2, BEFORE).psf).toBeUndefined();
    expect(excelFormulaFor('BM', 2, ON).psf).toBeDefined();
  });

  it('with no date, behaves exactly as it did before the gate existed', () => {
    expect(excelFormulaFor('BM', 2)).toEqual(excelFormulaFor('BM', 2, ON));
    expect(excelFormulaFor('TEMU', 2)).toEqual(excelFormulaFor('TEMU', 2, ON));
  });
});
