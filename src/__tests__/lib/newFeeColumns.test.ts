/**
 * The two fee columns added on 2026-08-14, as they land in a real workbook.
 *
 * Both came from the client, and both move money:
 *
 *   BM · PSF — Payment Seller Fee. His column is `=I2*1%`, I being SP, so
 *   the base is the sale price and not sale price plus postage. It comes out
 *   of GP and stays out of Total VAT NTP: it is a charge, not a tax.
 *
 *   TEMU · Commission — was a literal per-row value, on the belief that
 *   Temu's referral rate varies by category. His report applies one rate to
 *   every row, `=H2*3.96%`, so it is a formula now. `Commission+VAT` is the
 *   two cells beside it added up and is deliberately NOT subtracted in GP.
 *
 * These assertions read a workbook produced by buildSalesWorkbookBuffer
 * rather than SALES_HEADERS, so they pin what the operator downloads. The
 * formulas are compared as strings against the letters the columns actually
 * resolve to — a column moving would change both sides together, which is
 * why clientColumnOrder.test.ts pins the order separately.
 */
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { buildSalesWorkbookBuffer } from '../../lib/clientReport';
import { calcSaleFinancials, salesColLetter } from '../../lib/platforms';
import type { InventoryUnit, Marketplace, Sale } from '../../types';

const unit = (o: Partial<InventoryUnit> = {}): InventoryUnit => ({
  id: 'u1', imei: '350111000000011', model: 'iPhone 13', colour: 'Black',
  storage: '128GB', status: 'sold', buyPrice: 105, dateIn: '2026-07-01',
  flags: [], supplierId: 's1', supplierName: 'NANAK', ...o,
} as InventoryUnit);

const sale = (o: Partial<Sale> = {}): Sale => ({
  id: 's1', marketplace: 'BM', orderNumber: 'ORD-1', saleDate: '2026-08-20',
  quantity: 1, buyPrice: 105, salePrice: 205, postage: 6.30,
  imei: '350111000000011', unitId: 'u1', ...o,
} as Sale);

async function tab(m: Marketplace, sales: Sale[]) {
  const buf = await buildSalesWorkbookBuffer({ sales, units: [unit()] } as never);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as never);
  const ws = wb.getWorksheet(m)!;
  const headers = (ws.getRow(1).values as unknown[]).slice(1).map(String);
  /** A row-2 cell by header name: its formula if it has one, else its value. */
  const cell = (name: string) => {
    const v = ws.getRow(2).getCell(headers.indexOf(name) + 1).value as
      { formula?: string } | string | number | null;
    return v && typeof v === 'object' && 'formula' in v ? `=${v.formula}` : v;
  };
  return { ws, headers, cell };
}

describe('BM · PSF — the Payment Seller Fee', () => {
  it('is SP × 1%, off the sale price alone', async () => {
    const { cell } = await tab('BM', [sale()]);
    expect(cell('PSF')).toBe(`=${salesColLetter('BM', 'SP')}2*1%`);
  });

  it('is subtracted in GP', async () => {
    const { cell } = await tab('BM', [sale()]);
    expect(String(cell('GP'))).toContain(`-${salesColLetter('BM', 'PSF')}2`);
  });

  it('is NOT in Total VAT NTP — a charge is not a tax', async () => {
    // His own NTP is `=K2-P2`: Marginal Tax minus P. VAT, nothing else.
    const { cell } = await tab('BM', [sale()]);
    expect(cell('Total VAT NTP')).toBe(
      `=${salesColLetter('BM', 'Marginal Tax')}2-${salesColLetter('BM', 'P. VAT')}2`,
    );
  });

  it('the app computes the £2.05 his own row 83746265 shows', async () => {
    // BP £105, SP £205 — a real row of his 14-Aug report, where PSF reads
    // 2.05 and GP reads 41.18. The workbook writes a formula, so this is the
    // other half: the runtime calculator has to reach the same figures, or
    // the app's GP and the downloaded sheet's GP disagree.
    const f = calcSaleFinancials({
      marketplace: 'BM', buyPrice: 105, salePrice: 205, postageOverride: 6.30,
    });
    expect(f.psf).toBe(2.05);
    expect(f.grossProfit).toBe(41.18);
  });
});

describe('BM · Payment Mode', () => {
  it('writes what the sale recorded, in his column', async () => {
    const { cell } = await tab('BM', [sale({ paymentMode: 'Klarna' })]);
    expect(cell('Payment Mode')).toBe('Klarna');
  });

  it('is blank rather than absent when the sale carries none', async () => {
    // His own rows are blank on plenty of orders. A missing cell would shift
    // nothing (columns resolve by name) but would read as data loss.
    const { cell, headers } = await tab('BM', [sale()]);
    expect(headers).toContain('Payment Mode');
    expect(cell('Payment Mode')).toBe('');
  });
});

describe('TEMU · Commission and Commission+VAT', () => {
  const temu = (o: Partial<Sale> = {}) =>
    sale({ marketplace: 'TEMU', buyPrice: 58, salePrice: 83.99, ...o });

  it('Commission is a formula at 3.96%, not a stored literal', async () => {
    // It used to be written from sale.commission. A literal cannot be audited
    // in Excel and disagrees with his sheet the moment a rate changes.
    const { cell } = await tab('TEMU', [temu({ commission: 999 })]);
    expect(cell('Commission')).toBe(`=${salesColLetter('TEMU', 'SP')}2*3.96%`);
  });

  it('Commission+VAT adds the two cells beside it', async () => {
    const { cell } = await tab('TEMU', [temu()]);
    expect(cell('Commission+VAT')).toBe(
      `=${salesColLetter('TEMU', 'Commission')}2+${salesColLetter('TEMU', 'Commission VAT')}2`,
    );
  });

  it('Commission+VAT is not subtracted in GP — that would charge it twice', async () => {
    const { cell } = await tab('TEMU', [temu()]);
    expect(String(cell('GP')))
      .not.toContain(`-${salesColLetter('TEMU', 'Commission+VAT')}2`);
    // The commission itself still is.
    expect(String(cell('GP'))).toContain(`-${salesColLetter('TEMU', 'Commission')}2`);
  });

  it('Total VAT stays P. VAT alone', async () => {
    // His row 2 reads `=L2+O2` (Commission VAT + P. VAT) while rows 3-131 all
    // read `=O2`. We follow the 129, and this test is what will fail loudly
    // if that decision is ever revisited.
    const { cell } = await tab('TEMU', [temu()]);
    expect(cell('Total VAT')).toBe(`=${salesColLetter('TEMU', 'P. VAT')}2`);
  });
});

describe('Acc — his header, not ours', () => {
  it.each(['AMAZON', 'BM', 'EBAY', 'ONBUY', 'TEMU'] as Marketplace[])(
    '%s says Acc, never Accessories', async (m) => {
      const { headers } = await tab(m, [sale({ marketplace: m })]);
      expect(headers).toContain('Acc');
      expect(headers).not.toContain('Accessories');
    });
});
