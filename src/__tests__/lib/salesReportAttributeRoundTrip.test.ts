/**
 * The round trip the Storage / Colour columns exist for:
 *   export a Sales Report → re-import it → the buy-side attributes come back.
 *
 * Before these columns, a sale for an IMEI that had never been in stock had
 * nowhere to get storage or colour from (the marketplace tabs carried
 * neither — only Returns Detail did), so every such unit landed on the
 * Orphans list and had to be completed by hand.
 */
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { buildSalesWorkbookBuffer } from '../../lib/clientReport';
import { MARKETPLACES } from '../../types';
import type { InventoryUnit, Sale } from '../../types';

const unit = (o: Partial<InventoryUnit>): InventoryUnit => ({
  id: 'u1', imei: '350111000000011', model: 'Galaxy A21S', storage: '32GB', colour: 'Midnight',
  status: 'sold', buyPrice: 50, dateIn: '2026-07-01', flags: [], platformListed: false,
  supplierId: 'sup-1', supplierName: 'IMAX', ownerId: 'shared', createdAt: '2026-07-01',
  ...o,
} as InventoryUnit);

const sale = (o: Partial<Sale>): Sale => ({
  id: 'AMAZON__A1__350111000000011', marketplace: 'AMAZON', orderNumber: 'A1',
  imei: '350111000000011', unitId: 'u1', sku: 'Samsung Galaxy A21S',
  saleDate: '2026-07-29', quantity: 1, buyPrice: 50, salePrice: 89.99,
  spMinusBp: 39.99, marginalTax: 6.67, commission: 6.3, postage: 6.3,
  grossProfit: 20, gpPercent: 40,
  importBatchId: 'b1', sourceFile: 'f', sourceRow: 1, importedAt: '', createdAt: '',
  updatedAt: '', ownerId: 'shared',
  ...o,
} as Sale);

async function buildAndRead(sales: Sale[], units: InventoryUnit[]) {
  const buf = await buildSalesWorkbookBuffer({ sales, units, supplierMap: {}, opts: {} as any });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as ArrayBuffer);
  return wb;
}

const headersOf = (ws: ExcelJS.Worksheet) =>
  (ws.getRow(1).values as unknown[]).slice(1).map(h => String(h ?? '').trim());

describe('Sales Report carries Storage + Colour', () => {
  it('adds both columns to every marketplace tab', async () => {
    const wb = await buildAndRead([sale({})], [unit({})]);
    for (const m of MARKETPLACES) {
      const ws = wb.getWorksheet(m)!;
      const h = headersOf(ws);
      expect(h, `${m} tab`).toContain('Storage');
      expect(h, `${m} tab`).toContain('Colour');
    }
  });

  it('writes the linked unit\'s values onto the sale row', async () => {
    const wb = await buildAndRead([sale({})], [unit({})]);
    const ws = wb.getWorksheet('AMAZON')!;
    const h = headersOf(ws);
    const row = ws.getRow(2);
    expect(String(row.getCell(h.indexOf('Storage') + 1).value)).toBe('32GB');
    expect(String(row.getCell(h.indexOf('Colour') + 1).value)).toBe('Midnight');
  });

  it('leaves them blank when no unit is linked, rather than inventing values', async () => {
    const wb = await buildAndRead([sale({ unitId: undefined, imei: '359999999999999' })], []);
    const ws = wb.getWorksheet('AMAZON')!;
    const h = headersOf(ws);
    const row = ws.getRow(2);
    expect(row.getCell(h.indexOf('Storage') + 1).value ?? '').toBe('');
    expect(row.getCell(h.indexOf('Colour') + 1).value ?? '').toBe('');
  });

  /**
   * The regression that would hurt most, restated.
   *
   * These columns used to be appended AFTER every formula column, because the
   * formulas carried hard-coded column letters and moving a column shifted the
   * arithmetic one cell left while still looking plausible. That constraint is
   * gone: `excelFormulaFor` resolves letters through `salesColLetter(name)`,
   * which throws on an unknown column. So the invariant to pin is no longer
   * "these columns sit at the end" but the stronger one — **the formula
   * addresses whatever cell the header row says it should**.
   *
   * Derived from the header row rather than written as literals, so this test
   * keeps its meaning through the next reorder instead of needing an edit.
   */
  it('addresses the money cells by name, wherever the columns sit', async () => {
    const wb = await buildAndRead([sale({})], [unit({})]);
    const ws = wb.getWorksheet('AMAZON')!;
    const h = headersOf(ws);
    const letter = (name: string) => {
      const i = h.indexOf(name);
      expect(i, `header "${name}"`).toBeGreaterThanOrEqual(0);
      return ws.getColumn(i + 1).letter;
    };
    // GP % is gross profit over buy price — the two cells it must name.
    const gpPct = ws.getRow(2).getCell(h.indexOf('GP %') + 1).value as { formula?: string };
    expect(gpPct.formula).toContain(`/${letter('BP')}2*100`);
    expect(gpPct.formula).toContain(`${letter('GP')}2`);
    // Net GP £ is GP less the postage loss, same test from the other side.
    const net = ws.getRow(2).getCell(h.indexOf('Net GP £') + 1).value as { formula?: string };
    expect(net.formula).toContain(`${letter('GP')}2`);
    expect(net.formula).toContain(`${letter('Return Cost')}2`);
  });

  /**
   * Direct guard for the bug adding these columns caused: returnBlockOffsets
   * positioned the return block as "the last six columns", so appending two
   * shifted Outcome / Shipping Legs / Postage Loss into the new cells. Voided
   * rows exported with those blank, which meant Net GP £ silently equalled
   * Gross GP on exactly the rows where the loss matters. Offsets are now
   * looked up by header name.
   */
  it('still writes the return block to the right cells on a voided row', async () => {
    const wb = await buildAndRead(
      [sale({ voidedAt: '2026-07-30', voidOutcome: 'refund', voidReason: 'changed mind', postage: 8 })],
      [unit({})],
    );
    const ws = wb.getWorksheet('AMAZON')!;
    const h = headersOf(ws);
    const row = ws.getRow(2);
    expect(String(row.getCell(h.indexOf('Outcome') + 1).value)).toBe('Refund');
    expect(String(row.getCell(h.indexOf('Shipping Legs') + 1).value)).toBe('2');
    expect(Number(row.getCell(h.indexOf('Postage Loss') + 1).value)).toBeGreaterThan(0);
    // …and the new columns are still the ones carrying the attributes.
    expect(String(row.getCell(h.indexOf('Colour') + 1).value)).toBe('Midnight');
  });
});
