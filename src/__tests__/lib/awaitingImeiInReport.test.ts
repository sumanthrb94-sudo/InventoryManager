/**
 * A sale awaiting its IMEI must say so in the Excel, not just be blank.
 *
 * Stage 1 of a two-stage sale is recorded by the sales team before anyone has
 * been to the shelf, so it genuinely has no IMEI. An empty cell would read as
 * "this row is missing data" — the IMEI column already has plenty of blanks
 * for accessories — rather than "this row is waiting on you". The cell carries
 * the instruction instead, because it is exactly where the warehouse looks and
 * exactly what is absent.
 *
 * The rest of the row matters just as much: fees, VAT and a provisional profit
 * are all present, so the day's figures are not held up waiting for a handset.
 * A stage-1 row that exported as an empty shell would understate the month.
 */
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { buildSalesWorkbookBuffer, AWAITING_IMEI_CELL } from '../../lib/clientReport';
import type { Sale } from '../../types';

const sale = (over: Partial<Sale> & { id: string }): Sale => ({
  marketplace: 'AMAZON', orderNumber: 'AMZ-1', sku: 'SG-S22-128-BK',
  model: 'GALAXY S22', imei: '', saleDate: '2026-08-12', quantity: 1,
  buyPrice: 130, salePrice: 300, postage: 6.3, postageVat: 1.26,
  commission: 21, grossProfit: 40, ownerId: 'shared', createdAt: '', updatedAt: '',
  ...over,
} as Sale);

async function tabRows(buf: ArrayBuffer, sheet: string) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.getWorksheet(sheet);
  if (!ws) return [];
  const headers = ((ws.getRow(1).values ?? []) as unknown[]).slice(1).map(v => String(v ?? ''));
  const out: Array<Record<string, unknown>> = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const order = row.getCell(headers.indexOf('Order Number') + 1).value;
    if (!order || String(order).toUpperCase() === 'TOTAL') return;
    const rec: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      const v = row.getCell(i + 1).value as { formula?: string; result?: unknown } | unknown;
      rec[h] = v && typeof v === 'object' && 'formula' in (v as object)
        ? (v as { result?: unknown }).result : v;
    });
    out.push(rec);
  });
  return out;
}

const build = (sales: Sale[]) =>
  buildSalesWorkbookBuffer({ sales, units: [], supplierMap: {}, opts: undefined } as never);

describe('a sale awaiting its IMEI', () => {
  it('says UPDATE IMEI & MARK SOLD in the IMEI cell', async () => {
    const rows = await tabRows(await build([
      sale({ id: 's-pending', awaitingImei: true, provisionalBuyPrice: true }),
    ]), 'AMAZON');
    expect(rows).toHaveLength(1);
    expect(rows[0]['IMEI']).toBe(AWAITING_IMEI_CELL);
  });

  it('still carries its model, SKU and sale price so the row is actionable', async () => {
    // The warehouse finds the handset by MODEL — a row that named neither the
    // model nor the order would be impossible to action.
    const rows = await tabRows(await build([
      sale({ id: 's-pending', awaitingImei: true }),
    ]), 'AMAZON');
    expect(rows[0]['Order Number']).toBe('AMZ-1');
    expect(String(rows[0]['SKU'])).toBe('SG-S22-128-BK');
    expect(Number(rows[0]['SP'])).toBe(300);
  });

  it('a finished sale is untouched — it shows its real IMEI', async () => {
    const rows = await tabRows(await build([
      sale({ id: 's-done', imei: '350000000000002', awaitingImei: false }),
    ]), 'AMAZON');
    expect(String(rows[0]['IMEI'])).toBe('350000000000002');
  });

  it('an ordinary sale with no IMEI is NOT mislabelled', async () => {
    // Accessories and older unlinked rows legitimately have a blank IMEI and
    // are not waiting on anybody. Only the flag earns the instruction.
    const rows = await tabRows(await build([
      sale({ id: 's-blank', imei: '' }),
    ]), 'AMAZON');
    expect(rows[0]['IMEI']).not.toBe(AWAITING_IMEI_CELL);
  });

  it('and once the IMEI is attached the instruction is gone', async () => {
    // Guards the transition: awaitingImei false + a real IMEI must read as a
    // normal finished row, or the warehouse would keep seeing completed work.
    const rows = await tabRows(await build([
      sale({ id: 's-x', imei: '350000000000009', awaitingImei: false, provisionalBuyPrice: false }),
    ]), 'AMAZON');
    expect(String(rows[0]['IMEI'])).toBe('350000000000009');
  });
});
