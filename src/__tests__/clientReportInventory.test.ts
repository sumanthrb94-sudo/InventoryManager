import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import type { InventoryUnit, InventoryAggregate, Supplier } from '../types';
import {
  deriveInventoryAggregates,
  buildInventoryWorkbookBuffer,
} from '../lib/clientReport';

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
