/**
 * Sold → returned → back to inventory → sold again.
 *
 * The operator's own description of what the report must show: the returned
 * sale carries its return reason and its loss, exactly as a normal sold row
 * carries its profit; going back to inventory and selling again creates a
 * SECOND sale, and that one has its own profit; and the marketplace report
 * counts both — the loss from the first and the profit from the second.
 *
 * Both halves have gone wrong before, in opposite directions:
 *
 *   - a refunded row used to keep the full profit the sale would have made,
 *     showing +£22 where the truth was −£19.20, and pushing that phantom
 *     profit into the marketplace TOTAL
 *   - a RE-sale used to inherit the earlier return's postage loss, so a
 *     genuinely profitable second sale read as −£15.12
 *
 * The two are easy to confuse and a fix for one can reintroduce the other,
 * which is why the whole cycle is asserted here in one place.
 */
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { buildSalesWorkbookBuffer } from '../../lib/clientReport';
import type { InventoryUnit, Sale } from '../../types';

/** One handset, sold twice, returned once in between. */
const UNIT: InventoryUnit = {
  id: 'u-1', imei: '350799512745897', model: 'SAMSUNG GALAXY S21FE',
  storage: '128GB', colour: 'GRAY', status: 'sold', buyPrice: 115,
  dateIn: '2026-08-07', supplierName: 'NIHAL', flags: [],
  // The return that happened in between, still stamped on the unit.
  returnType: 'returned_to_inventory', returnDate: '2026-08-14',
  returnOutcome: 'refund', returnLegCost: 7.56,
} as InventoryUnit;

/** Cycle 1 — sold, then refunded. The money went back. */
const REFUNDED: Sale = {
  id: 's-1', marketplace: 'AMAZON', orderNumber: '204-7639131-4661133',
  saleDate: '2026-08-07', quantity: 1, buyPrice: 115, salePrice: 169.99,
  postage: 6.30, postageVat: 1.26, imei: '350799512745897', unitId: 'u-1',
  grossProfit: 22, voidedAt: '2026-08-14', voidOutcome: 'refund',
  voidReason: 'Change of Mind',
  gpBasis: 'returns_v2', customerRefunded: true,
} as Sale;

/** Cycle 2 — back on the shelf and sold again. This one keeps its money. */
const RESOLD: Sale = {
  id: 's-2', marketplace: 'AMAZON', orderNumber: '204-9999999-1111111',
  saleDate: '2026-08-20', quantity: 1, buyPrice: 115, salePrice: 175,
  postage: 6.30, postageVat: 1.26, imei: '350799512745897', unitId: 'u-1',
  grossProfit: 26,
} as Sale;

async function sheet(name: string, sales: Sale[], opts?: unknown) {
  const buf = await buildSalesWorkbookBuffer({ sales, units: [UNIT], opts } as never);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as never);
  const ws = wb.getWorksheet(name)!;
  let headerRow = 1;
  if (name === 'Returns & Profit') {
    for (let r = 1; r <= ws.rowCount; r++) {
      if (String(ws.getRow(r).getCell(1).value ?? '').trim() === 'Marketplace') { headerRow = r; break; }
    }
  }
  const headers = (ws.getRow(headerRow).values as unknown[]).slice(1).map(v => String(v ?? '').trim());
  const raw = (r: number, h: string) => ws.getRow(r).getCell(headers.indexOf(h) + 1).value;
  const rowWhere = (h: string, value: string) => {
    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      if (String(raw(r, h) ?? '').trim() === value) return r;
    }
    throw new Error(`no row where ${h} = ${value} on ${name}`);
  };
  return { raw, rowWhere };
}

describe('the returned sale shows its reason and its loss', () => {
  it('carries Return Date, Outcome, Reason, Shipping Legs and Postage Loss', async () => {
    const t = await sheet('AMAZON', [REFUNDED]);
    const r = t.rowWhere('Order Number', '204-7639131-4661133');
    expect(String(t.raw(r, 'Outcome'))).toMatch(/refund/i);
    expect(String(t.raw(r, 'Return Reason'))).toBe('Change of Mind');
    expect(Number(t.raw(r, 'Shipping Legs')), 'refund = outbound + inbound').toBe(2);
    expect(Number(t.raw(r, 'Postage Loss')), '2 legs x 7.56').toBeCloseTo(15.12, 2);
    expect(t.raw(r, 'Return Date')).toBeTruthy();
  });

  it('keeps NO profit — the customer got their money back', async () => {
    // It used to show the full profit the sale would have made, minus only
    // postage, and the TOTAL row summed that phantom figure.
    const t = await sheet('AMAZON', [REFUNDED]);
    const r = t.rowWhere('Order Number', '204-7639131-4661133');
    expect(Number(t.raw(r, 'GP')), 'zeroed on a refund').toBe(0);
  });

  it('its Net GP is the loss, not a profit', async () => {
    // Net GP £ = GP - Postage Loss, live. GP is 0, so Net GP is -15.12.
    const t = await sheet('AMAZON', [REFUNDED]);
    const r = t.rowWhere('Order Number', '204-7639131-4661133');
    expect(String((t.raw(r, 'Net GP £') as { formula?: string }).formula))
      .toMatch(/^[A-Z]+\d+-[A-Z]+\d+$/);
  });
});

describe('the re-sale after back-to-inventory is a normal sale again', () => {
  it('is its own row, with its own order number', async () => {
    const t = await sheet('AMAZON', [REFUNDED, RESOLD]);
    expect(t.rowWhere('Order Number', '204-9999999-1111111')).toBeGreaterThan(1);
    expect(t.rowWhere('Order Number', '204-7639131-4661133')).toBeGreaterThan(1);
  });

  it('keeps its profit and carries NO postage loss', async () => {
    // The unit still has returnDate stamped on it from the earlier cycle.
    // The re-sale happened AFTER that date, so the closed return must not be
    // stamped onto it — that bug turned a profitable second sale into
    // -£15.12.
    const t = await sheet('AMAZON', [REFUNDED, RESOLD]);
    const r = t.rowWhere('Order Number', '204-9999999-1111111');
    expect(t.raw(r, 'Postage Loss') ?? 0, 'no inherited loss').toBeFalsy();
    expect(t.raw(r, 'Outcome') ?? '', 'not marked as a return').toBeFalsy();
    expect(String((t.raw(r, 'GP') as { formula?: string })?.formula ?? ''),
      'a live GP formula, not a zeroed cell').toContain('-');
  });
});

describe('the marketplace report counts BOTH the loss and the later profit', () => {
  it('one channel, one return cost, one kept sale', async () => {
    // All-time so both cycles are in scope.
    const t = await sheet('Returns & Profit', [REFUNDED, RESOLD]);
    const r = t.rowWhere('Marketplace', 'AMAZON');
    expect(Number(t.raw(r, 'Sales')), 'the refunded one kept nothing').toBe(1);
    expect(Number(t.raw(r, 'Revenue £'))).toBeCloseTo(175, 2);
    expect(Number(t.raw(r, 'Gross GP £')), 'the re-sale\'s profit').toBeCloseTo(26, 2);
    expect(Number(t.raw(r, 'Returns'))).toBe(1);
    expect(Number(t.raw(r, 'Return Cost £'))).toBeCloseTo(15.12, 2);
    // The whole point: profit earned, minus loss incurred.
    expect(Number(t.raw(r, 'Net GP £'))).toBeCloseTo(26 - 15.12, 2);
  });

  it('the re-sale on another channel is calculated by THAT channel\'s rules', async () => {
    // The operator's model: each order number is a closed book. The Amazon
    // order ended at a loss and is finished. The eBay order is a new sale,
    // priced and charged by eBay's own schedule, with nothing carried over.
    //
    // Structurally this follows from every formula resolving through the
    // sale's own marketplace, but it is the assumption the whole loop rests
    // on, so it is asserted rather than reasoned about.
    const resoldOnEbay = { ...RESOLD, id: 's-3', marketplace: 'EBAY',
                           orderNumber: 'EB-1' } as Sale;

    const ebay = await sheet('EBAY', [REFUNDED, resoldOnEbay]);
    const r = ebay.rowWhere('Order Number', 'EB-1');
    // eBay's own fee lines, which Amazon does not have at all.
    expect(ebay.raw(r, 'ROF'), 'eBay charges a ROF').toBeTruthy();
    expect(ebay.raw(r, 'FVF')).toBeTruthy();
    expect(ebay.raw(r, 'T.COM')).toBeTruthy();
    // And no trace of the Amazon cycle.
    expect(ebay.raw(r, 'Postage Loss') ?? 0).toBeFalsy();
    expect(ebay.raw(r, 'Outcome') ?? '').toBeFalsy();
    expect(ebay.raw(r, 'Return Reason') ?? '').toBeFalsy();

    // The Amazon tab keeps the loss row and nothing else — the re-sale is
    // not on it, because it was not an Amazon sale.
    const amazon = await sheet('AMAZON', [REFUNDED, resoldOnEbay]);
    expect(() => amazon.rowWhere('Order Number', 'EB-1'))
      .toThrow(/no row where/);
    expect(Number(amazon.raw(amazon.rowWhere('Order Number', '204-7639131-4661133'),
      'Postage Loss'))).toBeCloseTo(15.12, 2);
  });

  it('and splits them when the two cycles sold on different channels', async () => {
    // A handset returned on Amazon and re-sold on eBay: the loss belongs to
    // Amazon, the profit to eBay. Netting them into one channel would flatter
    // whichever took the return.
    const resoldElsewhere = { ...RESOLD, id: 's-3', marketplace: 'EBAY',
                              orderNumber: 'EB-1' } as Sale;
    const t = await sheet('Returns & Profit', [REFUNDED, resoldElsewhere]);
    const amazon = t.rowWhere('Marketplace', 'AMAZON');
    const ebay = t.rowWhere('Marketplace', 'EBAY');

    expect(Number(t.raw(amazon, 'Return Cost £'))).toBeCloseTo(15.12, 2);
    expect(Number(t.raw(amazon, 'Sales')), 'Amazon kept no sale').toBe(0);
    expect(Number(t.raw(ebay, 'Return Cost £')), 'eBay took no return').toBe(0);
    expect(Number(t.raw(ebay, 'Gross GP £'))).toBeCloseTo(26, 2);
  });
});
