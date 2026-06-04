import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseSalesWorkbook } from '../lib/salesImport';

/** Build a 1-sheet Amazon workbook in memory with the given data rows. */
async function parseAmazon(rows: any[][]) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['nw', 'Order Number', 'SKU', 'IMEI', 'Supplier', 'Quantity', 'BP', 'SP'],
      ...rows,
    ]),
    'AMAZON',
  );
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return parseSalesWorkbook(buf, 'fixture.xlsx');
}

describe('sales import — doc id', () => {
  it('is line-unique per IMEI so one order can hold multiple phones', async () => {
    const out = await parseAmazon([
      [new Date('2026-05-12T00:00:00Z'), 'ORD-1', 'SKU1', '353209102768686', 'NIHAL', 1, 200, 300],
      [new Date('2026-05-12T00:00:00Z'), 'ORD-1', 'SKU2', '359108096724237', 'NIHAL', 1, 210, 320],
    ]);
    expect(out.sales).toHaveLength(2);
    const ids = out.sales.map(s => s.id);
    expect(new Set(ids).size).toBe(2); // distinct — not collapsed to one
    expect(ids).toContain('AMAZON__ORD-1__353209102768686');
    expect(ids).toContain('AMAZON__ORD-1__359108096724237');
  });

  it('builds a slash-free doc id when one cell pastes two IMEIs (Firestore-safe)', async () => {
    const out = await parseAmazon([
      [new Date('2026-05-12T00:00:00Z'), '206-5248339-8852336', 'SKU9', '350019159355722 / 350019153943622', 'NIHAL', 2, 200, 600],
    ]);
    const s = out.sales[0];
    expect(s.id).not.toContain('/');
    expect(s.id).toBe('AMAZON__206-5248339-8852336__350019159355722-350019153943622');
  });
});
