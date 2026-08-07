/**
 * The £1 "Accessories" line is the BOX AND CHARGER that ships with a phone.
 *
 * The operator confirmed three things, and each one is a test below:
 *   - it is £1 on all five marketplaces
 *   - both office and SHS handsets carry it
 *   - a standalone accessory does not, because it has no box and charger —
 *     a charger sold on its own IS the charger
 *
 * Until 2026-08 the fee was charged per sale ROW, so a £9.99 charger was
 * booked £1 of cost that did not exist, against roughly £2 of margin.
 *
 * The subtle case is SHS. SHS means the SUPPLIER holds the stock: the sale is
 * confirmed first, and the handset is collected from the supplier afterwards.
 * So an SHS phone legitimately has no IMEI when it is sold — a blank IMEI is
 * normal for a handset, not a sign of an accessory. Worse, IMEI is not a
 * required import column, so such a sale can arrive with no inventory link
 * either, which is exactly the shape of a charger.
 *
 * `isAccessorySale` therefore consults the accessory catalogue when it has
 * one, and only falls back to "neither identifier present" when it does not.
 * Both cases are tested below, because getting it wrong takes £1 off every
 * supplier-fulfilled sale.
 */
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { buildSalesWorkbookBuffer } from '../../lib/clientReport';
import { calcSaleFinancials, isAccessorySale } from '../../lib/platforms';
import { MARKETPLACES } from '../../types';
import type { InventoryUnit, Sale } from '../../types';

const unit = (o: Partial<InventoryUnit> = {}): InventoryUnit => ({
  id: 'u1', imei: '350111000000011', model: 'iPhone 13', colour: 'Black',
  storage: '128GB', status: 'sold', buyPrice: 300, dateIn: '2026-07-01',
  flags: [], supplierId: 's1', supplierName: 'IMAX', ...o,
} as InventoryUnit);

const sale = (o: Partial<Sale> = {}): Sale => ({
  id: 's1', marketplace: 'AMAZON', orderNumber: 'ORD-1', saleDate: '2026-08-01',
  quantity: 1, buyPrice: 300, salePrice: 400, postage: 8, postageVat: 1.6, ...o,
} as Sale);

/** The Accessories cell of one row of a marketplace tab. The GP formula
 *  subtracts this cell, so it is the only place the number has to be right. */
async function feeOnRow(sales: Sale[], units: InventoryUnit[], rowNumber: number): Promise<number> {
  const buf = await buildSalesWorkbookBuffer({ sales, units } as any);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);
  const ws = wb.getWorksheet(sales[0]?.marketplace ?? 'AMAZON')!;
  const h = (ws.getRow(1).values as any[]).slice(1);
  return Number(ws.getRow(rowNumber).getCell(h.indexOf('Accessories') + 1).value ?? 0);
}

describe('who is charged for the box and charger', () => {
  it('an office handset is', async () => {
    const s = sale({ imei: '350111000000011', unitId: 'u1' });
    expect(await feeOnRow([s], [unit({ stockSource: 'office' })], 2)).toBe(1);
  });

  /**
   * Testing "no IMEI" alone would take this phone's £1 away. The operator's
   * rule is that office and SHS handsets both carry it.
   */
  it('an SHS handset is, even with no IMEI recorded', async () => {
    const s = sale({ id: 's2', orderNumber: 'SHS-1', imei: '', unitId: 'u2' });
    const u = unit({ id: 'u2', imei: '', stockSource: 'shs' });
    expect(await feeOnRow([s], [u], 2)).toBe(1);
  });

  /**
   * The hole the two-identifier test alone leaves open.
   *
   * SHS means the supplier holds the stock: the sale is confirmed first, the
   * handset is collected afterwards. IMEI is not a required import column, so
   * a sale uploaded in that window has NO IMEI and NO matched unit — exactly
   * the shape of a charger. Only the accessory catalogue tells them apart,
   * and a handset model is never in it.
   *
   * Get this wrong and every supplier-fulfilled sale silently loses £1.
   */
  it('an SHS handset sold before collection keeps its £1, with no IMEI and no unit', async () => {
    const s = sale({
      id: 's4', orderNumber: 'SHS-PRE-1', imei: '', unitId: undefined,
      sku: 'iPhone 13 128GB',
    });
    const buf = await buildSalesWorkbookBuffer({
      sales: [s], units: [],
      accessoryStock: [{ sku: 'USBC-20W', name: 'USB-C 20W Charger', quantity: 10 }],
    } as any);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as any);
    const ws = wb.getWorksheet('AMAZON')!;
    const h = (ws.getRow(1).values as any[]).slice(1);
    expect(Number(ws.getRow(2).getCell(h.indexOf('Accessories') + 1).value ?? 0)).toBe(1);
  });

  it('a charger sold on its own is NOT — it is the charger', async () => {
    const s = sale({
      id: 's3', orderNumber: 'CHG-1', imei: '', unitId: undefined,
      sku: 'USBC-20W', buyPrice: 3, salePrice: 9.99, postage: 2.5, postageVat: 0.5,
    });
    expect(await feeOnRow([s], [], 2)).toBe(0);
  });

  /**
   * The blank rows the operator types new sales into are primed by running a
   * synthetic EMPTY sale through the row writer. An empty sale has neither
   * identifier, so it reads as an accessory unless the priming says otherwise
   * — and every primed row would have silently lost the £1 constant.
   */
  it('a blank fillable row keeps the £1, ready for a handset', async () => {
    const s = sale({ imei: '350111000000011', unitId: 'u1' });
    // Row 2 is the sale; row 3 onward are primed blanks.
    expect(await feeOnRow([s], [unit()], 4)).toBe(1);
  });
});

describe('the rule holds on every marketplace', () => {
  it.each(MARKETPLACES)('%s charges a phone £1 and an accessory £0', async (m) => {
    const phone: any = calcSaleFinancials({
      marketplace: m, buyPrice: 300, salePrice: 400, quantity: 1, isAccessory: false,
    } as any);
    const acc: any = calcSaleFinancials({
      marketplace: m, buyPrice: 3, salePrice: 9.99, quantity: 1, isAccessory: true,
    } as any);
    expect(phone.accessoryFee, `${m} phone`).toBe(1);
    expect(acc.accessoryFee, `${m} accessory`).toBe(0);
  });

  it('the £1 comes off the accessory line\'s profit, not just the column', () => {
    const withFee: any = calcSaleFinancials({
      marketplace: 'AMAZON', buyPrice: 3, salePrice: 9.99, quantity: 1, isAccessory: false,
    } as any);
    const without: any = calcSaleFinancials({
      marketplace: 'AMAZON', buyPrice: 3, salePrice: 9.99, quantity: 1, isAccessory: true,
    } as any);
    expect(without.grossProfit - withFee.grossProfit).toBeCloseTo(1, 2);
  });
});

describe('isAccessorySale', () => {
  it('needs BOTH identifiers missing, not either', () => {
    expect(isAccessorySale({ unitId: undefined, imei: '' }), 'neither').toBe(true);
    expect(isAccessorySale({ unitId: 'u1', imei: '' }), 'linked unit, no IMEI').toBe(false);
    expect(isAccessorySale({ unitId: undefined, imei: '3501110' }), 'IMEI, no unit').toBe(false);
    expect(isAccessorySale({ unitId: 'u1', imei: '3501110' }), 'both').toBe(false);
  });

  it('with a catalogue, only a stocked accessory SKU counts', () => {
    const skus = new Set(['USBC-20W']);
    expect(isAccessorySale({ unitId: undefined, imei: '', sku: 'USBC-20W' }, skus),
      'a stocked accessory').toBe(true);
    // The SHS-before-collection case: no identifiers, but not an accessory.
    expect(isAccessorySale({ unitId: undefined, imei: '', sku: 'iPhone 13 128GB' }, skus),
      'an unreceived SHS handset').toBe(false);
  });

  it('matches SKUs case- and whitespace-insensitively', () => {
    const skus = new Set(['USBC-20W']);
    expect(isAccessorySale({ unitId: undefined, imei: '', sku: ' usbc-20w ' }, skus)).toBe(true);
  });

  it('treats whitespace as absent, since a blank cell imports as " "', () => {
    expect(isAccessorySale({ unitId: undefined, imei: '   ' })).toBe(true);
  });

  it('is false for nothing at all, rather than throwing', () => {
    expect(isAccessorySale(null)).toBe(false);
    expect(isAccessorySale(undefined)).toBe(false);
  });
});
