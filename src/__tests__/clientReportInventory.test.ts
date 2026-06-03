import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import type { InventoryUnit, InventoryAggregate, Supplier, Sale } from '../types';
import {
  deriveInventoryAggregates,
  buildInventoryWorkbookBuffer,
  buildUnitHistoryRows,
} from '../lib/clientReport';

function makeSale(overrides: Partial<Sale> = {}): Sale {
  return {
    id: 'sale-x', marketplace: 'EBAY', orderNumber: 'ORD-1', imei: '999000000000050',
    saleDate: '2026-01-15', quantity: 1, buyPrice: 111, salePrice: 150,
    spMinusBp: 39, marginalTax: 0, commission: 0, postage: 8,
    ...overrides,
  } as Sale;
}

// ── Factories ─────────────────────────────────────────────────────────────────
function makeUnit(overrides: Partial<InventoryUnit> = {}): InventoryUnit {
  return {
    id: 'unit-x',
    imei: '353209102768686',
    model: 'iPhone 13 128GB',
    brand: 'Apple',
    category: 'iPhone',
    colour: 'Black',
    storage: '128GB',
    buyPrice: 150,
    dateIn: '2026-06-01',
    supplierId: 'sup-1',
    supplierName: 'MHL',
    status: 'available',
    flags: [],
    notes: '',
    platformListed: false,
    ownerId: 'shared',
    createdAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  } as InventoryUnit;
}

const SUPPLIERS: Supplier[] = [
  { id: 'sup-1', name: 'MHL' } as Supplier,
  { id: 'sup-2', name: 'NANAK' } as Supplier,
];

async function loadBuffer(buf: ArrayBuffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);
  return wb;
}

// ── deriveInventoryAggregates (pure) ──────────────────────────────────────────
describe('deriveInventoryAggregates', () => {
  it('groups available office stock by model and counts quantity', () => {
    const units = [
      makeUnit({ id: 'a', model: 'iPhone 13 128GB', colour: 'Black', supplierId: 'sup-1' }),
      makeUnit({ id: 'b', model: 'iPhone 13 128GB', colour: 'Blue', supplierId: 'sup-2' }),
      makeUnit({ id: 'c', model: 'Galaxy S22 128GB', colour: 'Black', supplierId: 'sup-1' }),
    ];
    const aggs = deriveInventoryAggregates(units);
    const iphone = aggs.find(a => a.model === 'iPhone 13 128GB')!;
    expect(iphone.quantityNum).toBe(2);
    expect(iphone.coloursMap).toEqual({ Black: 1, Blue: 1 });
    expect(iphone.supplierIds).toEqual(['sup-1', 'sup-2']);
    expect(aggs.map(a => a.model)).toEqual(['Galaxy S22 128GB', 'iPhone 13 128GB']); // A→Z
  });

  it('excludes sold / returned / incoming and soft-deleted units', () => {
    const units = [
      makeUnit({ id: 'ok', status: 'available' }),
      makeUnit({ id: 'sold', status: 'sold' }),
      makeUnit({ id: 'ret', status: 'returned' }),
      makeUnit({ id: 'shs', status: 'incoming' }),
      makeUnit({ id: 'del', status: 'available', ...( { deletedAt: '2026-06-02' } as any) }),
    ];
    const aggs = deriveInventoryAggregates(units);
    expect(aggs).toHaveLength(1);
    expect(aggs[0].quantityNum).toBe(1);
  });

  it('uses the most-recently-stocked unit for the latest BP', () => {
    const units = [
      makeUnit({ id: 'old', model: 'M', dateIn: '2026-01-01', buyPrice: 100 }),
      makeUnit({ id: 'new', model: 'M', dateIn: '2026-05-01', buyPrice: 175 }),
    ];
    expect(deriveInventoryAggregates(units)[0].buyPrice).toBe(175);
  });
});

// ── buildInventoryWorkbookBuffer (integration via exceljs) ────────────────────
describe('buildInventoryWorkbookBuffer', () => {
  const units = [
    makeUnit({ id: 'a', model: 'iPhone 13 128GB', colour: 'Black', buyPrice: 150 }),
    makeUnit({ id: 'b', model: 'iPhone 13 128GB', colour: 'Blue', buyPrice: 150 }),
    makeUnit({ id: 'c', model: 'Galaxy S22 128GB', colour: 'Black', buyPrice: 140 }),
    makeUnit({ id: 'sold', model: 'iPhone 13 128GB', status: 'sold' }),
  ];

  it('FIX #1: populates the INVENTORY summary sheet from units when no aggregates exist', async () => {
    const buf = await buildInventoryWorkbookBuffer({ units, aggregates: [], suppliers: SUPPLIERS, whatsappFeed: [] });
    const inv = (await loadBuffer(buf)).getWorksheet('INVENTORY')!;
    // header + 2 model rows (iPhone 13 128GB ×2 available, Galaxy S22 ×1) — NOT header-only.
    expect(inv.actualRowCount).toBe(3);

    const dataRows = inv.getRows(2, inv.actualRowCount - 1)!.map(r =>
      r.values as (string | number | object | null)[]);
    const iphoneRow = dataRows.find(v => v[1] === 'iPhone 13 128GB')!;
    expect(iphoneRow[1]).toBe('iPhone 13 128GB'); // MODEL (col A)
    expect(iphoneRow[2]).toBe(150);               // BP (col B)
    expect(iphoneRow[3]).toBe(2);                 // QUANTITY (col C) — 2 available
    expect((iphoneRow[5] as any).formula).toMatch(/^B\d+\*C\d+$/); // VALUE (col E) is BP*QTY formula
  });

  it('still honours caller-supplied aggregates (no derivation) when present', async () => {
    const aggregates: InventoryAggregate[] = [{
      id: 'agg-1', model: 'PROVIDED MODEL', buyPrice: 99, quantityNum: 7,
      coloursMap: { Black: 7 }, supplierIds: ['sup-1'], ownerId: 'shared',
      createdAt: null, updatedAt: null,
    } as InventoryAggregate];
    const buf = await buildInventoryWorkbookBuffer({ units, aggregates, suppliers: SUPPLIERS, whatsappFeed: [] });
    const inv = (await loadBuffer(buf)).getWorksheet('INVENTORY')!;
    expect(inv.actualRowCount).toBe(2); // header + the single provided aggregate
    expect(inv.getRow(2).getCell(1).value).toBe('PROVIDED MODEL');
    expect(inv.getRow(2).getCell(3).value).toBe(7);
  });

  it('writes the EXACT 15-digit IMEI verbatim (no rounding / scientific notation)', async () => {
    const exact = '999000000000001';
    const buf = await buildInventoryWorkbookBuffer({
      units: [makeUnit({ id: 'z', imei: exact, model: 'ZZTEST PHONE 128GB' })],
      aggregates: [], suppliers: SUPPLIERS, whatsappFeed: [],
    });
    const imeiSheet = (await loadBuffer(buf)).getWorksheet('IMEI NUMBERS')!;
    const cell = imeiSheet.getRow(2).getCell(3); // col C = IMEI NUMBER
    expect(cell.value).toBe(exact);              // strict string equality — exact
    expect(String(cell.value)).toHaveLength(15);
    expect(String(cell.value)).not.toContain('E'); // no 9.99E+14
  });

  it('FIX #2 re-check: STOCK IN DATE is a real Excel date cell (mm/dd/yyyy), not a raw string', async () => {
    const buf = await buildInventoryWorkbookBuffer({
      units: [makeUnit({ id: 'd', dateIn: '2026-06-03' })],
      aggregates: [], suppliers: SUPPLIERS, whatsappFeed: [],
    });
    const imeiSheet = (await loadBuffer(buf)).getWorksheet('IMEI NUMBERS')!;
    const dateCell = imeiSheet.getRow(2).getCell(1); // col A = STOCK IN DATE
    expect(dateCell.value instanceof Date).toBe(true);
    expect(dateCell.numFmt).toBe('mm/dd/yyyy');
  });

  it('lists every unit (all statuses) in the IMEI NUMBERS detail sheet', async () => {
    const buf = await buildInventoryWorkbookBuffer({ units, aggregates: [], suppliers: SUPPLIERS, whatsappFeed: [] });
    const imeiSheet = (await loadBuffer(buf)).getWorksheet('IMEI NUMBERS')!;
    expect(imeiSheet.actualRowCount).toBe(units.length + 1); // header + every unit incl. sold
  });
});

// ── UNIT HISTORY: a single unit's full resale/return story + loss ─────────────
describe('buildUnitHistoryRows', () => {
  const IMEI = '999000000000050';
  const unit = makeUnit({ id: 'u', imei: IMEI, model: 'ZZTEST PHONE 128GB', dateIn: '2026-01-01', buyPrice: 111, supplierName: 'ACME', status: 'available' });
  // Sold & returned 5 times, on 5 dates, supplied out of order, £8 postage each.
  const dates = ['2026-05-15', '2026-01-15', '2026-04-15', '2026-02-15', '2026-03-15'];
  const sales = dates.map((d, i) => makeSale({
    id: `s${i}`, imei: IMEI, saleDate: d, postage: 8, salePrice: 150,
    orderNumber: `ORD-${i + 1}`, voidedAt: d, voidReason: `return reason ${i + 1}`,
  }));

  it('counts cycles and totals the postage loss for a 5x-returned unit', () => {
    const rows = buildUnitHistoryRows([unit], sales);
    const summary = rows.find(r => r.EVENT === 'SUMMARY')!;
    expect(summary['TIMES SOLD']).toBe(5);
    expect(summary['TIMES RETURNED']).toBe(5);
    expect(summary['POSTAGE LOST']).toBe(40); // 5 × £8
    expect(summary['REASON / COMMENT']).toContain('Sold 5× · Returned 5× · Postage lost £40.00');
  });

  it('emits a chronological stock-in → sold → returned timeline with reasons', () => {
    const rows = buildUnitHistoryRows([unit], sales);
    expect(rows[0].EVENT).toBe('STOCK IN');
    expect(rows[0].DATE).toBe('2026-01-01');
    const events = rows.filter(r => r.EVENT === 'SOLD' || r.EVENT === 'RETURNED');
    // 5 SOLD + 5 RETURNED, interleaved, ordered by sale date ascending
    expect(events.map(e => e.EVENT)).toEqual(
      ['SOLD','RETURNED','SOLD','RETURNED','SOLD','RETURNED','SOLD','RETURNED','SOLD','RETURNED']);
    const soldDates = rows.filter(r => r.EVENT === 'SOLD').map(r => r.DATE);
    expect(soldDates).toEqual(['2026-01-15','2026-02-15','2026-03-15','2026-04-15','2026-05-15']);
    // each return carries its comment
    const returns = rows.filter(r => r.EVENT === 'RETURNED');
    expect(returns.every(r => /return reason \d/.test(r['REASON / COMMENT']))).toBe(true);
  });

  it('handles a unit sold once and never returned (zero loss)', () => {
    const rows = buildUnitHistoryRows([unit], [makeSale({ id: 'ok', imei: IMEI, voidedAt: undefined, voidReason: undefined })]);
    const summary = rows.find(r => r.EVENT === 'SUMMARY')!;
    expect(summary['TIMES SOLD']).toBe(1);
    expect(summary['TIMES RETURNED']).toBe(0);
    expect(summary['POSTAGE LOST']).toBe(0);
    expect(rows.some(r => r.EVENT === 'RETURNED')).toBe(false);
  });

  it('orders units most-returned-first', () => {
    const u2 = makeUnit({ id: 'u2', imei: '111', model: 'OTHER' });
    const oneReturn = [makeSale({ id: 'a', imei: '111', voidedAt: '2026-02-01', voidReason: 'x' })];
    const rows = buildUnitHistoryRows([unit, u2], [...sales, ...oneReturn]);
    // First IMEI block should be the 5x-returned one
    expect(rows[0].IMEI).toBe(IMEI);
  });

  it('excludes units that were never sold', () => {
    const rows = buildUnitHistoryRows([unit], []);
    expect(rows).toEqual([]);
  });

  it('UNIT HISTORY sheet is written into the workbook', async () => {
    const buf = await buildInventoryWorkbookBuffer({ units: [unit], aggregates: [], suppliers: SUPPLIERS, whatsappFeed: [], sales });
    const wb = await loadBuffer(buf);
    const sheet = wb.getWorksheet('UNIT HISTORY')!;
    expect(sheet).toBeTruthy();
    // header + (stock-in + 5×(sold+returned) + summary) = 1 + 12 = 13 rows
    expect(sheet.actualRowCount).toBe(13);
    expect(sheet.getRow(1).getCell(1).value).toBe('IMEI');
  });
});
