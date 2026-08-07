/**
 * Returns & Profit by marketplace.
 *
 * The sheet exists because the top-level Summary's return figures predate
 * three corrections — repair invoices, supplier credits, and a replacement
 * costing carriage rather than a second handset. It is built on
 * returnCostFor, the same function the Returns screen uses, so the two cannot
 * drift; these tests pin the arithmetic that connects them.
 */
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { buildSalesWorkbookBuffer } from '../../lib/clientReport';
import type { InventoryUnit, Sale } from '../../types';

const unit = (over: Partial<InventoryUnit>): InventoryUnit => ({
  id: 'u1', imei: '111', model: 'iPhone 13', brand: 'Apple', category: 'iPhone',
  colour: 'Black', storage: '128GB', buyPrice: 300, dateIn: '2026-06-01',
  supplierId: 's1', status: 'available', flags: [], notes: '', platformListed: false,
  returnLegCost: 9.6, ...over,
} as InventoryUnit);

const sale = (over: Partial<Sale>): Sale => ({
  id: 's1', unitId: 'u1', imei: '111', marketplace: 'AMAZON', orderNumber: 'A1',
  saleDate: '2026-08-01', buyPrice: 300, salePrice: 400, postage: 8, postageVat: 1.6,
  grossProfit: 60, gpPercent: 20, ...over,
} as Sale);

async function sheetRows(sales: Sale[], units: InventoryUnit[]) {
  const buf = await buildSalesWorkbookBuffer({ sales, units } as any);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);
  const sh = wb.getWorksheet('Returns & Profit')!;
  const hdr = (sh.getRow(4).values as any[]).slice(1);
  const rows: Record<string, any>[] = [];
  for (let r = 5; r <= sh.rowCount; r++) {
    const v = (sh.getRow(r).values as any[]).slice(1);
    if (!v[0]) continue;
    rows.push(Object.fromEntries(hdr.map((h, i) => [h, v[i]])));
  }
  return rows;
}

describe('the sheet exists and totals', () => {
  it('is present in the Sales Report', async () => {
    const buf = await buildSalesWorkbookBuffer({ sales: [sale({})], units: [unit({})] } as any);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as any);
    expect(wb.worksheets.map(w => w.name)).toContain('Returns & Profit');
  });

  it('carries a TOTAL row summing the channels', async () => {
    const rows = await sheetRows(
      [sale({}), sale({ id: 's2', unitId: 'u2', imei: '222', marketplace: 'TEMU', salePrice: 500, grossProfit: 80 })],
      [unit({}), unit({ id: 'u2', imei: '222' })],
    );
    const total = rows.find(r => r.Marketplace === 'TOTAL')!;
    expect(total.Sales).toBe(2);
    expect(total['Revenue £']).toBe(900);
    expect(total['Gross GP £']).toBe(140);
  });
});

describe('which sales count toward revenue', () => {
  it('a refunded sale contributes nothing', async () => {
    const rows = await sheetRows(
      [sale({ voidedAt: '2026-08-05', voidOutcome: 'refund', customerRefunded: true, gpBasis: 'returns_v2' })],
      [unit({ returnType: 'returned_to_inventory', returnOutcome: 'refund' })],
    );
    const amazon = rows.find(r => r.Marketplace === 'AMAZON')!;
    expect(amazon.Sales).toBe(0);
    expect(amazon['Revenue £']).toBe(0);
    expect(amazon.Returns).toBe(1);
  });

  it('a replacement contributes in full — the customer kept paying', async () => {
    const rows = await sheetRows(
      [sale({ voidedAt: '2026-08-05', voidOutcome: 'replacement', customerRefunded: false, gpBasis: 'returns_v2' })],
      [unit({ returnType: 'returned_to_inventory', returnOutcome: 'replacement' })],
    );
    const amazon = rows.find(r => r.Marketplace === 'AMAZON')!;
    expect(amazon.Sales).toBe(1);
    expect(amazon['Revenue £']).toBe(400);
    expect(amazon['Gross GP £']).toBe(60);
  });
});

describe('what the returns cost', () => {
  it('a replacement costs three carriage legs and nothing else', async () => {
    const rows = await sheetRows(
      [sale({ voidedAt: '2026-08-05', voidOutcome: 'replacement', customerRefunded: false, gpBasis: 'returns_v2' })],
      [unit({ returnType: 'returned_to_inventory', returnOutcome: 'replacement', replacementUnitCost: 300 })],
    );
    const a = rows.find(r => r.Marketplace === 'AMAZON')!;
    expect(a['Carriage £']).toBeCloseTo(28.8, 2);
    expect(a['Return Cost £']).toBeCloseTo(28.8, 2);   // no handset charge
  });

  it('adds the repair invoice', async () => {
    const rows = await sheetRows(
      [sale({ voidedAt: '2026-08-05', voidOutcome: 'repair', customerRefunded: true, gpBasis: 'returns_v2' })],
      [unit({ returnType: 'repair', repairCost: 64.5 })],
    );
    const a = rows.find(r => r.Marketplace === 'AMAZON')!;
    expect(a['Repair Invoices £']).toBeCloseTo(64.5, 2);
    expect(a['Return Cost £']).toBeCloseTo(19.2 + 64.5, 2);
  });

  it('nets a supplier credit off, and can go negative when it exceeds the carriage', async () => {
    const rows = await sheetRows(
      [sale({ voidedAt: '2026-08-05', voidOutcome: 'refund', customerRefunded: true, gpBasis: 'returns_v2' })],
      [unit({ returnType: 'returned_to_supplier', returnOutcome: 'refund', supplierCreditAmount: 210 })],
    );
    const a = rows.find(r => r.Marketplace === 'AMAZON')!;
    expect(a['Supplier Credits £']).toBe(210);
    expect(a['To Supplier']).toBe(1);
    // Recovered more than the carriage cost — a return that made money back.
    expect(a['Return Cost £']).toBeCloseTo(19.2 - 210, 2);
  });

  it('counts a cost nobody has entered rather than treating it as zero', async () => {
    const rows = await sheetRows(
      [sale({ voidedAt: '2026-08-05', voidOutcome: 'repair', customerRefunded: true, gpBasis: 'returns_v2' })],
      [unit({ returnType: 'repair' })],   // no invoice entered
    );
    const a = rows.find(r => r.Marketplace === 'AMAZON')!;
    expect(a['Repair Invoices £']).toBe(0);
    expect(a['Costs Outstanding']).toBe(1);
  });
});

describe('channels with no activity', () => {
  it('are left off rather than padding the sheet with zero rows', async () => {
    const rows = await sheetRows([sale({})], [unit({})]);
    const names = rows.map(r => r.Marketplace);
    expect(names).toContain('AMAZON');
    expect(names).not.toContain('EBAY');
    expect(names).toContain('TOTAL');
  });
});
