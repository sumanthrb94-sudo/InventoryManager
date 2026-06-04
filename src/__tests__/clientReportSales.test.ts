import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { buildSalesWorkbookBuffer } from '../lib/clientReport';
import { parseSalesWorkbook } from '../lib/salesImport';
import type { Sale } from '../types';

// exceljs writeBuffer() returns a Node Buffer under vitest; coerce to a plain
// ArrayBuffer so parseSalesWorkbook's `instanceof ArrayBuffer` branch is taken.
const toAB = (b: any): ArrayBuffer => (b instanceof ArrayBuffer ? b : new Uint8Array(b).buffer);

function makeSale(o: Partial<Sale>): Sale {
  return {
    id: o.id ?? 'AMAZON__A1',
    marketplace: o.marketplace ?? 'AMAZON',
    orderNumber: o.orderNumber ?? 'A1',
    saleDate: o.saleDate ?? '2026-04-01',
    quantity: 1, buyPrice: 200, salePrice: 320,
    spMinusBp: 120, marginalTax: 0, commission: 0,
    ...o,
  } as Sale;
}

describe('sales report — date round-trip (no timezone day-drift)', () => {
  it('keeps 1-Apr as 1-Apr through export → re-import', async () => {
    const buf = await buildSalesWorkbookBuffer({
      sales: [makeSale({ marketplace: 'AMAZON', orderNumber: 'A1', saleDate: '2026-04-01' })],
      opts: { today: new Date() },
    });
    const out = await parseSalesWorkbook(toAB(buf), 'roundtrip.xlsx');
    const s = out.sales.find(x => x.orderNumber === 'A1');
    expect(s?.saleDate).toBe('2026-04-01'); // not 31-Mar
  });
});

describe('sales report — returns surfaced', () => {
  it('writes RETURNED=Yes + the reason for a voided sale', async () => {
    const buf = await buildSalesWorkbookBuffer({
      sales: [makeSale({
        marketplace: 'AMAZON', orderNumber: 'A2', saleDate: '2026-04-01',
        voidedAt: '2026-04-02', voidReason: 'screen fault',
      } as any)],
      opts: { today: new Date() },
    });
    const wb = XLSX.read(buf, { type: 'array' });
    const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets['AMAZON'], { header: 1 });
    const header = rows[0] as string[];
    expect(header).toContain('RETURNED');
    expect(header).toContain('RETURN REASON');
    const data = rows[1] as any[];
    expect(data[header.indexOf('RETURNED')]).toBe('Yes');
    expect(data[header.indexOf('RETURN REASON')]).toBe('screen fault');
  });

  it('writes RETURNED=No for an active sale', async () => {
    const buf = await buildSalesWorkbookBuffer({
      sales: [makeSale({ marketplace: 'BM', orderNumber: 'B1' })],
      opts: { today: new Date() },
    });
    const wb = XLSX.read(buf, { type: 'array' });
    const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets['BM'], { header: 1 });
    const header = rows[0] as string[];
    const data = rows[1] as any[];
    expect(data[header.indexOf('RETURNED')]).toBe('No');
  });
});
