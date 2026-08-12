/**
 * A unit that was returned, restocked and SOLD AGAIN must not drag its old
 * return onto the new sale.
 *
 * WHAT WENT WRONG IN PRODUCTION
 *
 * The Back Market tab showed a sale dated 12-Aug-2026 carrying Return Date
 * 11-Aug-2026 — returned the day before it was sold. The row painted red,
 * charged £15.12 of postage loss and reported a profitable sale as
 * Net GP -£15.12.
 *
 * buildSalesWorkbookBuffer enriches sales in two paths. Path 2 exists for
 * pre-2026-05 data where a void only ever landed on the unit, and it
 * synthesises voidedAt / voidOutcome from the unit's return markers. But
 * those markers describe the unit's CURRENT state, not this sale — a
 * returned-then-resold handset still carries them, so every future sale of
 * that unit inherited a closed return.
 *
 * The returns ledger already had the right rule (isOpenReturnUnit in
 * lib/returnsLedger.ts): a return is closed once the unit has been sold after
 * it. That is why the Returns page correctly showed nothing while the report
 * showed a refund — the two screens disagreed, and the report was wrong.
 *
 * These tests hold both sides of that line: the stale return must be dropped,
 * and the genuine legacy case path 2 was built for must still work.
 */
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { buildSalesWorkbookBuffer } from '../../lib/clientReport';
import type { Sale, InventoryUnit } from '../../types';

const sale = (over: Partial<Sale> & { id: string }): Sale => ({
  marketplace: 'BM', orderNumber: 'BM-1', sku: 'TABA-16-BK',
  imei: '350000000000001', saleDate: '2026-08-12', quantity: 1,
  buyPrice: 25, salePrice: 80, postage: 6.3, postageVat: 1.26,
  grossProfit: 20, ownerId: 'shared', createdAt: '', updatedAt: '',
  ...over,
} as Sale);

const unit = (over: Partial<InventoryUnit> & { id: string }): InventoryUnit => ({
  status: 'sold', model: 'GALAXY TAB A', storage: '16GB',
  imei: '350000000000001', buyPrice: 25, ownerId: 'shared',
  createdAt: '', updatedAt: '',
  ...over,
} as InventoryUnit);

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

const build = (sales: Sale[], units: InventoryUnit[] = []) =>
  buildSalesWorkbookBuffer({ sales, units, supplierMap: {}, opts: undefined } as never);

describe('a resold unit does not inherit its closed return', () => {
  it('the production case: sold 12-Aug, returned 11-Aug — no return on the new sale', async () => {
    const rows = await tabRows(await build(
      [sale({ id: 's-resold', orderNumber: 'BM-RESOLD', saleDate: '2026-08-12' })],
      [unit({
        id: 'u1',
        status: 'sold',
        saleDate: '2026-08-12',
        // The previous cycle's markers, still on the unit.
        returnType: 'returned_to_inventory',
        returnDate: '2026-08-11',
        returnReason: 'Refund — Change of Mind',
      })],
    ), 'BM');

    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r['Return Date'], 'no return date on a later sale').toBeFalsy();
    expect(r['Outcome'], 'no outcome on a later sale').toBeFalsy();
  });

  it('and the money is clean — no phantom postage loss, GP stays positive', async () => {
    const rows = await tabRows(await build(
      [sale({ id: 's-resold', orderNumber: 'BM-RESOLD', saleDate: '2026-08-12' })],
      [unit({
        id: 'u1', status: 'sold', saleDate: '2026-08-12',
        returnType: 'returned_to_inventory', returnDate: '2026-08-11',
      })],
    ), 'BM');

    // Postage Loss is the phantom charge — the operator saw £15.12 here, and
    // Net GP £ is written as the formula `GP - PostageLoss`, so a zero loss is
    // exactly what makes Net GP equal GP again. Net GP itself is not asserted
    // because ExcelJS returns no cached result for a formula it did not
    // evaluate; asserting on it reads NaN and proves nothing.
    expect(Number(rows[0]['Postage Loss']) || 0).toBe(0);
  });

  it('same-day is NOT treated as stale — a sale returned the day it sold still voids', async () => {
    // The rule is strictly "sold AFTER the return". Same day stays a return,
    // which is the common case for a next-day refund entered on one date.
    const rows = await tabRows(await build(
      [sale({ id: 's-sameday', orderNumber: 'BM-SAMEDAY', saleDate: '2026-08-11' })],
      [unit({
        id: 'u1', status: 'returned',
        returnType: 'returned_to_inventory', returnDate: '2026-08-11',
      })],
    ), 'BM');

    expect(rows[0]['Outcome'], 'same-day return still counts').toBeTruthy();
  });
});

describe('the legacy case path 2 exists for still works', () => {
  it('a unit returned AFTER its sale still synthesises the void', async () => {
    // Sold 10-Aug, returned 20-Aug, and the void only ever landed on the unit.
    // This is the pre-2026-05 shape path 2 was written for; it must survive.
    const rows = await tabRows(await build(
      [sale({ id: 's-legacy', orderNumber: 'BM-LEGACY', saleDate: '2026-08-10' })],
      [unit({
        id: 'u1', status: 'returned', saleDate: '2026-08-10',
        returnType: 'returned_to_inventory', returnDate: '2026-08-20',
        returnReason: 'Faulty',
      })],
    ), 'BM');

    expect(rows[0]['Return Date'], 'legacy void still painted').toBeTruthy();
    expect(rows[0]['Outcome']).toBeTruthy();
  });

  it('a sale already carrying its own voidedAt is untouched by any of this', async () => {
    // Path 1. The unit's markers are irrelevant when the SALE records the void.
    const rows = await tabRows(await build(
      [sale({
        id: 's-own', orderNumber: 'BM-OWN', saleDate: '2026-08-12',
        voidedAt: '2026-08-13', voidOutcome: 'refund', voidReason: 'Faulty',
      })],
      [unit({ id: 'u1', status: 'sold', saleDate: '2026-08-12' })],
    ), 'BM');

    expect(rows[0]['Return Date'], 'the sale-side void wins').toBeTruthy();
  });
});
