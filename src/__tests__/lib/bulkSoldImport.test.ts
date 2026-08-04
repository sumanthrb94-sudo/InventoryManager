/**
 * Reading a filled BULK SOLD sheet.
 *
 * This is the only path by which a spreadsheet can change stock, so what it
 * REFUSES matters more than what it accepts. Every rejection below is a way an
 * operator's sheet can be wrong in a way that would otherwise corrupt the
 * ledger quietly: selling a handset twice, selling one that was never in
 * stock, selling one already sold, or shifting every field by one because a
 * column was inserted.
 *
 * The accepted lines are handed to recordBulkSales — the same function Mark
 * Multiple Sold uses — so a sale from a sheet and a sale from the app are the
 * same write. Nothing here creates stock.
 */
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import {
  BULK_SOLD_HEADERS,
  parseBulkSoldWorkbook,
  buildBulkSoldPreview,
} from '../../lib/bulkSoldImport';
import type { InventoryUnit } from '../../types';

const unit = (over: Partial<InventoryUnit> & { imei: string }): InventoryUnit => ({
  id: `u-${over.imei}`, status: 'available', model: 'iPhone 13', sku: 'IP13-128-MID',
  buyPrice: 200, supplierName: 'MHL', ownerId: 'shared',
  createdAt: '', updatedAt: '',
  ...over,
} as InventoryUnit);

const STOCK: InventoryUnit[] = [
  unit({ imei: '350000000000001' }),                                  // office, available
  unit({ imei: '350000000000002', status: 'incoming' }),              // SHS
  unit({ imei: '350000000000003', status: 'sold' }),                  // already sold
  unit({ imei: '350000000000004', status: 'lost' }),                  // not sellable
  unit({ imei: '350000000000005', status: 'available',
         returnType: 'returned_to_inventory' }),                      // back in stock
];

/** Build a sheet the way an operator's filled template looks. */
async function sheet(rows: unknown[][], headers: readonly string[] = BULK_SOLD_HEADERS) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('BULK SOLD');
  ws.addRow([...headers]);
  for (const r of rows) ws.addRow(r);
  const buf = await wb.xlsx.writeBuffer();
  return buf as ArrayBuffer;
}

// `??` would swallow an intentional null, so read each field by presence —
// the tests need to say "this cell is EMPTY", not "use the default".
const ROW = (imei: string, over: Partial<Record<string, unknown>> = {}) => {
  const pick = (k: string, dflt: unknown) => (k in over ? over[k] : dflt);
  return [
    imei, pick('marketplace', 'AMAZON'), pick('orderNumber', 'AMZ-1'), pick('salePrice', 400),
    pick('saleDate', null), pick('postage', null), pick('paymentMode', null), pick('comments', null),
  ];
};

describe('reading the sheet', () => {
  it('reads a filled row into the fields the sale needs', async () => {
    const rows = await parseBulkSoldWorkbook(await sheet([
      ['350000000000001', 'AMAZON', 'AMZ-9', 449.99, new Date('2026-08-01'), 8, 'Paypal', 'note'],
    ]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sourceRow: 2, imei: '350000000000001', marketplace: 'AMAZON',
      orderNumber: 'AMZ-9', salePrice: 449.99, saleDate: '2026-08-01',
      postage: 8, paymentMode: 'Paypal', comments: 'note',
    });
  });

  it('reads a price typed as "£449.99" or with a thousands separator', async () => {
    const rows = await parseBulkSoldWorkbook(await sheet([
      ROW('350000000000001', { salePrice: '£449.99' }),
      ROW('350000000000002', { salePrice: '1,200.00' }),
    ]));
    expect(rows[0].salePrice).toBe(449.99);
    expect(rows[1].salePrice).toBe(1200);
  });

  it('finds its columns by NAME, so an inserted column does not shift every field', async () => {
    // The operator adds a notes column of their own at the front. Position-based
    // reading would put the IMEI into Marketplace and sell the wrong thing.
    const rows = await parseBulkSoldWorkbook(await sheet(
      [['my note', '350000000000001', 'AMAZON', 'AMZ-9', 400]],
      ['Notes', ...BULK_SOLD_HEADERS.slice(0, 4)],
    ));
    expect(rows[0].imei).toBe('350000000000001');
    expect(rows[0].marketplace).toBe('AMAZON');
    expect(rows[0].salePrice).toBe(400);
  });

  it('refuses a workbook that is not this template', async () => {
    await expect(parseBulkSoldWorkbook(await sheet([[1, 2]], ['Something', 'Else'])))
      .rejects.toThrow(/BULK SOLD template/);
  });
});

describe('deciding which rows can actually be sold', () => {
  const preview = async (rows: unknown[][]) =>
    buildBulkSoldPreview(await parseBulkSoldWorkbook(await sheet(rows)), STOCK);

  it('accepts an office unit and an SHS unit, and flags which is which', async () => {
    const p = await preview([ROW('350000000000001'), ROW('350000000000002', { orderNumber: 'AMZ-2' })]);
    expect(p.rejected).toEqual([]);
    expect(p.lines).toHaveLength(2);
    expect(p.lines[0]).toMatchObject({ kind: 'unit', isSHS: false, salePrice: 400 });
    expect(p.lines[1]).toMatchObject({ kind: 'unit', isSHS: true });
  });

  it('accepts a unit that came back into stock from a return', async () => {
    const p = await preview([ROW('350000000000005')]);
    expect(p.rejected).toEqual([]);
    expect(p.lines).toHaveLength(1);
  });

  it('carries the operator overrides onto the sale', async () => {
    const p = await preview([
      ROW('350000000000001', { saleDate: new Date('2026-07-15'), postage: 12.5, comments: 'chased' }),
    ]);
    expect(p.lines[0]).toMatchObject({
      saleDate: '2026-07-15', postageOverride: 12.5, comments: 'chased',
    });
  });

  it.each([
    ['an IMEI that is not in stock', ROW('359999999999999'), /no unit in stock/],
    ['a unit already marked sold',    ROW('350000000000003'), /already marked sold/],
    ['a unit that is not sellable',   ROW('350000000000004'), /is lost, not sellable/],
    ['no IMEI at all',                ROW('', {}),            /no IMEI/],
    ['an unknown marketplace',        ROW('350000000000001', { marketplace: 'GUMTREE' }), /not a marketplace/],
    ['no order number',               ROW('350000000000001', { orderNumber: '' }), /no order number/],
    ['no sale price',                 ROW('350000000000001', { salePrice: null }), /no sale price/],
    ['a sale price of zero',          ROW('350000000000001', { salePrice: 0 }), /not a sale/],
  ])('rejects %s, and says why', async (_label, row, reason) => {
    const p = await preview([row as unknown[]]);
    expect(p.lines).toEqual([]);
    expect(p.rejected).toHaveLength(1);
    expect(p.rejected[0].reason).toMatch(reason);
    expect(p.rejected[0].sourceRow, 'the rejection points at the row').toBe(2);
  });

  it('sells a handset once, however many times the sheet lists it', async () => {
    // The failure this prevents: a copy-paste slip double-posting one handset,
    // which would either write two sales or fail confusingly part-way through.
    const p = await preview([
      ROW('350000000000001'),
      ROW('350000000000001', { orderNumber: 'AMZ-2' }),
    ]);
    expect(p.lines).toHaveLength(1);
    expect(p.rejected).toHaveLength(1);
    expect(p.rejected[0].reason).toMatch(/already on row 2/);
  });

  it('reports the most actionable reason, not the duplicate one', async () => {
    // Row 3 repeats row 2's IMEI AND has a mistyped marketplace. Telling the
    // operator "duplicate" would send them to fix the wrong thing.
    const p = await preview([
      ROW('350000000000001'),
      ROW('350000000000001', { marketplace: 'GUMTREE', orderNumber: 'AMZ-2' }),
    ]);
    expect(p.rejected[0].reason).toMatch(/not a marketplace/);
  });

  it('a row that could never sell does not claim its IMEI from a later good row', async () => {
    // Row 2 is unsellable (no order number). Row 3 sells the same handset
    // properly. If the bad row had claimed the IMEI, the good one would be
    // refused as a duplicate and the handset would never be marked sold.
    const p = await preview([
      ROW('350000000000001', { orderNumber: '' }),
      ROW('350000000000001', { orderNumber: 'AMZ-2' }),
    ]);
    expect(p.lines, 'the good row still sells').toHaveLength(1);
    expect(p.lines[0].orderNumber).toBe('AMZ-2');
    expect(p.rejected).toHaveLength(1);
    expect(p.rejected[0].reason).toMatch(/no order number/);
  });

  it('skips untouched rows instead of failing them', async () => {
    // Empty strings rather than nulls: ExcelJS drops a wholly-empty row, but a
    // real template's blank rows carry number formats, so they DO come through
    // and have to be skipped rather than rejected.
    const p = await preview([ROW('350000000000001'), ['', '', '', ''], ['', '', '', '']]);
    expect(p.lines).toHaveLength(1);
    expect(p.rejected).toEqual([]);
    expect(p.blankRows).toBe(2);
  });

  it('keeps going after a bad row rather than abandoning the batch', async () => {
    const p = await preview([
      ROW('350000000000001'),
      ROW('359999999999999', { orderNumber: 'AMZ-2' }),   // not in stock
      ROW('350000000000002', { orderNumber: 'AMZ-3' }),
    ]);
    expect(p.lines).toHaveLength(2);
    expect(p.rejected).toHaveLength(1);
    expect(p.rejected[0].sourceRow).toBe(3);
  });
});
