/**
 * Do returned sales appear on the marketplace tabs — and when do they not?
 *
 * The operator asked to cross-verify this. They do appear: a voided sale keeps
 * its row on the marketplace sheet it was sold on, carrying Return Date,
 * Outcome, Shipping Legs, Postage Loss and a Net GP formula. It is not moved
 * to the Returns sheets; those are a cross-marketplace VIEW of the same rows.
 *
 * There is one case where a return really is absent from a marketplace tab,
 * and it is deliberate rather than a gap:
 *
 *   the marketplace tabs filter by SALE DATE
 *   the Returns sheets filter by VOID DATE
 *
 * So a handset sold in July and returned in August is on the August Returns
 * Summary but NOT on the August marketplace tab — its sale belongs to July.
 * That keeps each tab's revenue and GP self-consistent with the rows that
 * produced them. On an All Time export both carry everything, which is why
 * the reports handed over reconcile.
 *
 * Also covered: a repair voids the sale exactly as a refund does. That is the
 * operator's own reading — "in repair is technically in repair AND refunded"
 * — and the accounting agrees, because voiding removes the revenue, which IS
 * the refund.
 */
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { buildSalesWorkbookBuffer } from '../../lib/clientReport';
import type { Sale, InventoryUnit } from '../../types';

const sale = (over: Partial<Sale> & { id: string }): Sale => ({
  marketplace: 'AMAZON', orderNumber: 'AMZ-1', sku: 'IP13-128-MID',
  imei: '350000000000001', saleDate: '2026-07-10', quantity: 1,
  buyPrice: 200, salePrice: 320, postage: 8, postageVat: 1.6,
  grossProfit: 60, ownerId: 'shared', createdAt: '', updatedAt: '',
  ...over,
} as Sale);

const unit = (over: Partial<InventoryUnit> & { id: string }): InventoryUnit => ({
  status: 'sold', model: 'IPHONE 13', storage: '128GB', sku: 'IP13-128-MID',
  imei: '350000000000001', buyPrice: 200, ownerId: 'shared',
  createdAt: '', updatedAt: '',
  ...over,
} as InventoryUnit);

/** Read a marketplace tab back as {header: value} rows, resolving formulas. */
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

const build = (sales: Sale[], units: InventoryUnit[] = [], opts?: { from?: string; to?: string }) =>
  buildSalesWorkbookBuffer({ sales, units, supplierMap: {}, opts } as never);

describe('a returned sale keeps its row on the marketplace tab', () => {
  it('is present, with its outcome and postage loss', async () => {
    const rows = await tabRows(await build([
      sale({ id: 's1', orderNumber: 'AMZ-ACTIVE' }),
      sale({ id: 's2', orderNumber: 'AMZ-RETURNED', imei: '350000000000002',
             voidedAt: '2026-07-20', voidOutcome: 'refund', voidReason: 'Faulty' }),
    ]), 'AMAZON');

    expect(rows, 'both rows are on the tab').toHaveLength(2);
    const returned = rows.find(r => r['Order Number'] === 'AMZ-RETURNED')!;
    expect(returned, 'the returned sale did not vanish').toBeTruthy();
    expect(returned['Outcome']).toBe('Refund');
    expect(returned['Return Reason']).toBe('Faulty');
    expect(returned['Shipping Legs']).toBe(2);
    // (8 postage + 1.60 P.VAT) x 2 legs
    expect(Number(returned['Postage Loss'])).toBeCloseTo(19.2, 2);
  });

  it('a replacement carries three legs, not two', async () => {
    const rows = await tabRows(await build([
      sale({ id: 's1', orderNumber: 'AMZ-REPL',
             voidedAt: '2026-07-20', voidOutcome: 'replacement', voidReason: 'Swapped' }),
    ]), 'AMAZON');
    expect(rows[0]['Shipping Legs']).toBe(3);
    expect(Number(rows[0]['Postage Loss'])).toBeCloseTo(28.8, 2);
  });

  it('a REPAIR is voided and charged like a refund — two legs', async () => {
    // The operator's reading: in repair is technically in repair AND refunded.
    // Voiding removes the revenue, which is the refund; the handset then goes
    // to the repairer and comes back to inventory.
    const rows = await tabRows(await build([
      sale({ id: 's1', orderNumber: 'AMZ-REPAIR',
             voidedAt: '2026-07-20', voidOutcome: 'repair', voidReason: 'Cracked screen' }),
    ]), 'AMAZON');
    expect(rows[0]['Outcome']).toBe('In Repair');
    expect(rows[0]['Shipping Legs'], 'same carriage exposure as a refund').toBe(2);
    expect(Number(rows[0]['Postage Loss'])).toBeCloseTo(19.2, 2);
  });

  it('lands on the marketplace it was sold on, not all of them', async () => {
    const buf = await build([
      sale({ id: 's1', marketplace: 'EBAY', orderNumber: 'EB-RET',
             voidedAt: '2026-07-20', voidOutcome: 'refund' }),
    ]);
    expect(await tabRows(buf, 'EBAY')).toHaveLength(1);
    expect(await tabRows(buf, 'AMAZON'), 'not duplicated onto other tabs').toHaveLength(0);
  });

  it('a unit sold, returned, then SOLD AGAIN shows both sales on the tab', async () => {
    // The operator's S22: sold on eBay, returned to repair, sold again on
    // Temu, returned again. Each sale is its own row on its own tab; the
    // second return must not retro-void the first sale.
    const buf = await build([
      sale({ id: 's1', marketplace: 'EBAY', orderNumber: 'EB-2007', saleDate: '2026-07-16',
             salePrice: 375, voidedAt: '2026-07-22', voidOutcome: 'repair' }),
      sale({ id: 's2', marketplace: 'TEMU', orderNumber: 'TEMU-1', saleDate: '2026-08-05',
             salePrice: 300, voidedAt: '2026-08-05', voidOutcome: 'repair' }),
    ], [unit({ id: 'u1' })]);

    const ebay = await tabRows(buf, 'EBAY');
    const temu = await tabRows(buf, 'TEMU');
    expect(ebay, 'first cycle on eBay').toHaveLength(1);
    expect(temu, 'second cycle on Temu').toHaveLength(1);
    expect(ebay[0]['Outcome']).toBe('In Repair');
    expect(temu[0]['Outcome']).toBe('In Repair');
  });
});

describe('when a return IS absent from a marketplace tab, and why', () => {
  const soldJulyReturnedAugust = sale({
    id: 's1', orderNumber: 'AMZ-JULY', saleDate: '2026-07-10',
    voidedAt: '2026-08-05', voidOutcome: 'refund', voidReason: 'Faulty',
  });

  it('an August export omits it — the SALE belongs to July', async () => {
    const rows = await tabRows(
      await build([soldJulyReturnedAugust], [], { from: '2026-08-01', to: '2026-08-31' }),
      'AMAZON',
    );
    expect(rows, 'the tab filters by sale date, and this sold in July').toHaveLength(0);
  });

  it('an All Time export carries it', async () => {
    const rows = await tabRows(await build([soldJulyReturnedAugust]), 'AMAZON');
    expect(rows).toHaveLength(1);
    expect(rows[0]['Outcome']).toBe('Refund');
  });

  it('and the Returns Summary sees it in August, because that filters by VOID date', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await build([soldJulyReturnedAugust], [], { from: '2026-08-01', to: '2026-08-31' }));
    const ws = wb.getWorksheet('Returns Detail');
    expect(ws, 'the Returns Detail sheet exists').toBeTruthy();
    // Returns Detail is keyed by the UNIT, not the order — its columns are
    // Return Date / Unit IMEI / Original Sale Date / Outcome / Postage Loss.
    // Asserting on the order number would have been testing the wrong sheet.
    const text = JSON.stringify(ws!.getSheetValues());
    expect(text, 'the returned handset is on the August returns view').toContain('350000000000001');
    expect(text, 'and it names the July sale it reverses').toContain('2026-07-10');
    expect(text, 'with its outcome').toContain('Refund');
    expect(text, 'and the carriage it cost').toContain('19.2');
  });
});
