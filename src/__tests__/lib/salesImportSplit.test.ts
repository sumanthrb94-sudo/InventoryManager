/**
 * Multi-IMEI split: a bulk order whose IMEI cell holds several IMEIs
 * separated by " / " must parse into one Sale row per IMEI, with BP/SP
 * divided evenly so the order total is preserved. Single-IMEI rows and
 * non-IMEI serials (tablets) must pass through untouched.
 *
 * Mirrors the live SALES_REPORT: Amazon order 026-... ships 2 A32 phones
 * with both IMEIs in one cell; order 204-... ships 4 A25 phones likewise.
 */
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseSalesWorkbook } from '../../lib/salesImport';

function makeWorkbook(amazonRows: any[][]): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const header = ['Date', 'Order Number', 'SKU', 'IMEI', 'Supplier', 'Quantity', 'BP', 'SP'];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([header, ...amazonRows]),
    'AMAZON',
  );
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

describe('parseSalesWorkbook — multi-IMEI split', () => {
  it('splits a 2-IMEI cell into two rows with halved BP/SP', async () => {
    const buf = makeWorkbook([
      [new Date('2026-06-14T00:00:00Z'), '026-6081380-8104355', 'A32', '351554748581221 / 351554746670497', 'NANAK', 2, 114, 169.78],
    ]);
    const out = await parseSalesWorkbook(buf, 'fixture.xlsx');
    const amazon = out.sales.filter(s => s.marketplace === 'AMAZON');
    expect(amazon).toHaveLength(2);
    expect(amazon.map(s => s.imei).sort()).toEqual(['351554746670497', '351554748581221']);
    for (const s of amazon) {
      expect(s.quantity).toBe(1);
      expect(s.buyPrice).toBe(57);        // 114 / 2
      expect(s.salePrice).toBe(84.89);    // 169.78 / 2
    }
    // Revenue preserved.
    expect(amazon.reduce((t, s) => t + (s.salePrice ?? 0), 0)).toBeCloseTo(169.78, 2);
    // Each row gets a distinct, deterministic per-IMEI id.
    expect(new Set(amazon.map(s => s.id)).size).toBe(2);
    expect(amazon.some(s => s.id === 'AMAZON__026-6081380-8104355__351554748581221')).toBe(true);
  });

  it('splits a 4-IMEI cell (mixed spacing) into four rows', async () => {
    const buf = makeWorkbook([
      [new Date('2026-06-15T00:00:00Z'), '204-0877891-0211532', 'A25', '354454655917921 / 354454655917269 / 354454655923036/354454652453094', 'NIHAL', 4, 428, 539.96],
    ]);
    const out = await parseSalesWorkbook(buf, 'fixture.xlsx');
    const amazon = out.sales.filter(s => s.marketplace === 'AMAZON');
    expect(amazon).toHaveLength(4);
    expect(amazon.reduce((t, s) => t + (s.salePrice ?? 0), 0)).toBeCloseTo(539.96, 2);
    expect(amazon.reduce((t, s) => t + (s.buyPrice ?? 0), 0)).toBeCloseTo(428, 2);
    // The 4th IMEI (no leading space before the slash) is still extracted.
    expect(amazon.some(s => s.imei === '354454652453094')).toBe(true);
  });

  it('leaves a single-IMEI row and a non-IMEI serial untouched', async () => {
    const buf = makeWorkbook([
      [new Date('2026-06-13T00:00:00Z'), 'A-1', 'A30S', '351886110513840', 'NANAK', 1, 100, 150],
      [new Date('2026-06-15T00:00:00Z'), '205-5043879-4695542', 'TABA8', 'r8ywa0aldft', 'NANAK', 1, 78, 119.99],
    ]);
    const out = await parseSalesWorkbook(buf, 'fixture.xlsx');
    const amazon = out.sales.filter(s => s.marketplace === 'AMAZON');
    expect(amazon).toHaveLength(2);
    const single = amazon.find(s => s.orderNumber === 'A-1')!;
    expect(single.imei).toBe('351886110513840');
    expect(single.salePrice).toBe(150);
    const tablet = amazon.find(s => s.orderNumber === '205-5043879-4695542')!;
    expect(tablet.imei).toBe('r8ywa0aldft');   // non-numeric serial preserved as-is
    expect(tablet.salePrice).toBe(119.99);
  });
});
