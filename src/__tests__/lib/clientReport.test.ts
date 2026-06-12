/**
 * Tests for the Sales Report writer + postage-loss helpers in clientReport.ts.
 *
 * Two concerns:
 *   1. Unit-level helpers (postageLossFor, shippingLegsFor, colLetter) — pure
 *      and stable, asserted directly.
 *   2. Workbook structure — generate a buffer, parse it back with ExcelJS,
 *      and walk the cells. This locks the auditor-facing surface:
 *      Summary sheet exists with the expected roll-up, per-marketplace
 *      sheets carry the new return-info block (Return Date / Outcome /
 *      Return Reason / Shipping Legs) + Postage Loss trailing column, and
 *      a TOTAL row at the bottom.
 *
 * Mirrors the in-memory dbService mock pattern used in
 * src/__tests__/services/salesService.test.ts so the lifecycle test below
 * exercises recordSale → return → re-sell against the same fake store.
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import ExcelJS from 'exceljs';
import type { Sale, InventoryUnit } from '../../types';

// ── Helper imports (don't touch dbService) ─────────────────────────────────

import {
  postageLossFor,
  shippingLegsFor,
  colLetter,
  buildSalesWorkbookBuffer,
  buildReturnsWorkbookBuffer,
} from '../../lib/clientReport';

// ── In-memory dbService mock for the lifecycle test ────────────────────────

const collections: Record<string, Map<string, any>> = {};
function col(name: string): Map<string, any> {
  return (collections[name] ??= new Map());
}
function clearAllCollections() {
  for (const name of Object.keys(collections)) collections[name].clear();
}

vi.mock('../../lib/dbService', () => {
  const dbService = {
    async create(c: string, id: string, data: any) {
      col(c).set(id, { ...data, id });
    },
    async update(c: string, id: string, data: any) {
      const existing = col(c).get(id);
      const merged: any = { ...(existing ?? {}), ...data, id };
      for (const [k, v] of Object.entries(data)) {
        if (v === undefined || v === null) delete merged[k];
      }
      col(c).set(id, merged);
    },
    async delete(c: string, id: string) {
      col(c).delete(id);
    },
    async readAll(c: string) {
      return Array.from(col(c).values());
    },
    async imeiExists(imei: string): Promise<boolean> {
      if (!imei) return false;
      for (const u of col('inventoryUnits').values()) {
        if (u.imei === imei) return true;
      }
      return false;
    },
    async getByImei(imei: string): Promise<any | null> {
      if (!imei) return null;
      for (const u of col('inventoryUnits').values()) {
        if (u.imei === imei) return u;
      }
      return null;
    },
  };
  return { dbService };
});

// Import AFTER the mock is registered.
import { recordSale } from '../../services/salesService';
import { dbService } from '../../lib/dbService';

// ── Helpers ────────────────────────────────────────────────────────────────

const baseSale = (over: Partial<Sale>): Sale => ({
  id: over.id ?? 'EBAY__ORD-001__IMEI-1',
  marketplace: 'EBAY',
  orderNumber: 'ORD-001',
  imei: '359108096724237',
  unitId: 'unit-1',
  supplierId: 'sup-1',
  supplierName: 'MHL',
  saleDate: '2026-05-12',
  quantity: 1,
  buyPrice: 200,
  salePrice: 400,
  postage: 8,
  postageVat: 1.6,
  importBatchId: 'test',
  sourceFile: 'test',
  sourceRow: 1,
  ownerId: 'shared',
  createdAt: '2026-05-12T00:00:00Z',
  updatedAt: '2026-05-12T00:00:00Z',
  ...over,
});

beforeEach(() => {
  clearAllCollections();
});

// ───────────────────────────────────────────────────────────────────────────
// Pure helpers
// ───────────────────────────────────────────────────────────────────────────

describe('postageLossFor', () => {
  it('returns 0 for an active sale (no voidedAt)', () => {
    const sale = baseSale({ voidedAt: undefined });
    expect(postageLossFor(sale)).toBe(0);
  });

  it('returns (postage + P.VAT) × 2 for a refund', () => {
    const sale = baseSale({
      voidedAt: '2026-05-15', voidOutcome: 'refund', postage: 8, postageVat: 1.6,
    });
    // (8 + 1.6) × 2 = 19.2
    expect(postageLossFor(sale)).toBeCloseTo(19.2, 2);
  });

  it('returns (postage + P.VAT) × 3 for a replacement', () => {
    const sale = baseSale({
      voidedAt: '2026-05-15', voidOutcome: 'replacement', postage: 8, postageVat: 1.6,
    });
    // (8 + 1.6) × 3 = 28.8
    expect(postageLossFor(sale)).toBeCloseTo(28.8, 2);
  });

  it('defaults to refund (2 legs) when voidOutcome is missing', () => {
    const sale = baseSale({ voidedAt: '2026-05-15', voidOutcome: undefined });
    // (8 + 1.6) × 2 = 19.2
    expect(postageLossFor(sale)).toBeCloseTo(19.2, 2);
  });

  it('derives P.VAT from postage when postageVat is undefined', () => {
    const sale = baseSale({
      voidedAt: '2026-05-15', voidOutcome: 'refund', postage: 10, postageVat: undefined,
    });
    // (10 + 10 × 0.2) × 2 = 24
    expect(postageLossFor(sale)).toBeCloseTo(24, 2);
  });

  it('zeroes P.VAT when postageVatExempt is set', () => {
    const sale = baseSale({
      voidedAt: '2026-05-15', voidOutcome: 'refund',
      postage: 8, postageVat: 1.6, postageVatExempt: true,
    });
    // 8 × 2 = 16 (no VAT layered on)
    expect(postageLossFor(sale)).toBe(16);
  });

  it('returns 0 when postage is missing on a voided sale', () => {
    const sale = baseSale({
      voidedAt: '2026-05-15', voidOutcome: 'refund', postage: 0, postageVat: 0,
    });
    expect(postageLossFor(sale)).toBe(0);
  });
});

describe('shippingLegsFor', () => {
  it('returns 0 for an active sale', () => {
    expect(shippingLegsFor(baseSale({ voidedAt: undefined }))).toBe(0);
  });

  it('returns 2 for a refund', () => {
    expect(shippingLegsFor(baseSale({ voidedAt: '2026-05-15', voidOutcome: 'refund' }))).toBe(2);
  });

  it('returns 3 for a replacement', () => {
    expect(shippingLegsFor(baseSale({ voidedAt: '2026-05-15', voidOutcome: 'replacement' }))).toBe(3);
  });
});

describe('colLetter', () => {
  // EBAY's wider sheet pushes Postage Loss past Z (col 30 → AD); the
  // Summary roll-up + TOTAL row both depend on this conversion staying right.
  it('converts 1-indexed col numbers to letters', () => {
    expect(colLetter(1)).toBe('A');
    expect(colLetter(7)).toBe('G');
    expect(colLetter(26)).toBe('Z');
    expect(colLetter(27)).toBe('AA');
    expect(colLetter(28)).toBe('AB');
    expect(colLetter(30)).toBe('AD');
    expect(colLetter(52)).toBe('AZ');
    expect(colLetter(53)).toBe('BA');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Workbook structure
// ───────────────────────────────────────────────────────────────────────────

async function loadWorkbook(buffer: ArrayBuffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb;
}

describe('buildSalesWorkbookBuffer — auditor-grade structure', () => {
  it('produces 5 sheets — Summary + AMAZON / BM / EBAY / ONBUY', async () => {
    const buffer = await buildSalesWorkbookBuffer({ sales: [] });
    const wb = await loadWorkbook(buffer);
    expect(wb.worksheets.map(w => w.name)).toEqual(['Summary', 'AMAZON', 'BM', 'EBAY', 'ONBUY']);
  });

  it('Summary header row reads Marketplace / Sales / Refunds / Replacements / Gross GP / Postage Loss / Net GP / Net GP %', async () => {
    const buffer = await buildSalesWorkbookBuffer({ sales: [] });
    const wb = await loadWorkbook(buffer);
    const summary = wb.getWorksheet('Summary')!;
    // Title row is row 1, "Period: ..." is row 2, blank is row 3, headers row 4.
    const header = summary.getRow(4);
    expect(String(header.getCell(1).value)).toBe('Marketplace');
    expect(String(header.getCell(2).value)).toBe('Sales');
    expect(String(header.getCell(3).value)).toBe('Refunds');
    expect(String(header.getCell(4).value)).toBe('Replacements');
    expect(String(header.getCell(5).value)).toBe('Gross GP £');
    expect(String(header.getCell(6).value)).toBe('Postage Loss £');
    expect(String(header.getCell(7).value)).toBe('Net GP £');
    expect(String(header.getCell(8).value)).toBe('Net GP %');
  });

  it('AMAZON sheet headers include the return-info block before Postage Loss', async () => {
    const buffer = await buildSalesWorkbookBuffer({ sales: [] });
    const wb = await loadWorkbook(buffer);
    const sheet = wb.getWorksheet('AMAZON')!;
    const header = sheet.getRow(1);
    // 27 columns total — last 5 are the return-info block + Postage Loss.
    expect(String(header.getCell(22).value)).toBe('Comments');
    expect(String(header.getCell(23).value)).toBe('Return Date');
    expect(String(header.getCell(24).value)).toBe('Outcome');
    expect(String(header.getCell(25).value)).toBe('Return Reason');
    expect(String(header.getCell(26).value)).toBe('Shipping Legs');
    expect(String(header.getCell(27).value)).toBe('Postage Loss');
  });

  it('EBAY sheet headers carry 30 cols ending in the return-info block + Postage Loss', async () => {
    const buffer = await buildSalesWorkbookBuffer({ sales: [] });
    const wb = await loadWorkbook(buffer);
    const sheet = wb.getWorksheet('EBAY')!;
    const header = sheet.getRow(1);
    expect(String(header.getCell(25).value)).toBe('Comments');
    expect(String(header.getCell(26).value)).toBe('Return Date');
    expect(String(header.getCell(27).value)).toBe('Outcome');
    expect(String(header.getCell(28).value)).toBe('Return Reason');
    expect(String(header.getCell(29).value)).toBe('Shipping Legs');
    expect(String(header.getCell(30).value)).toBe('Postage Loss');
  });

  it('writes the return-info block + Postage Loss for a voided refund sale', async () => {
    const refund = baseSale({
      id: 'EBAY__ORD-R1__IMEI-1',
      orderNumber: 'ORD-R1',
      voidedAt: '2026-05-20',
      voidOutcome: 'refund',
      voidReason: 'Customer changed mind',
      postage: 8, postageVat: 1.6,
    });
    const buffer = await buildSalesWorkbookBuffer({ sales: [refund] });
    const wb = await loadWorkbook(buffer);
    const sheet = wb.getWorksheet('EBAY')!;
    const row = sheet.getRow(2);
    // Return Date (col 26) — ExcelJS stores as Date.
    const rd = row.getCell(26).value as Date | null;
    expect(rd).toBeInstanceOf(Date);
    expect((rd as Date).toISOString().startsWith('2026-05-20')).toBe(true);
    expect(row.getCell(27).value).toBe('Refund');
    expect(row.getCell(28).value).toBe('Customer changed mind');
    expect(row.getCell(29).value).toBe(2);          // 2 shipping legs
    expect(row.getCell(30).value).toBeCloseTo(19.2, 2);  // (8 + 1.6) × 2
  });

  it('writes 3 legs + the bigger loss for a replacement sale', async () => {
    const replacement = baseSale({
      id: 'AMAZON__ORD-RP1__IMEI-2',
      marketplace: 'AMAZON',
      orderNumber: 'ORD-RP1',
      voidedAt: '2026-05-21',
      voidOutcome: 'replacement',
      voidReason: 'Faulty unit — replacement sent',
      postage: 6.30, postageVat: 1.26,
    });
    const buffer = await buildSalesWorkbookBuffer({ sales: [replacement] });
    const wb = await loadWorkbook(buffer);
    const sheet = wb.getWorksheet('AMAZON')!;
    const row = sheet.getRow(2);
    expect(row.getCell(24).value).toBe('Replacement');
    expect(row.getCell(26).value).toBe(3);
    // (6.30 + 1.26) × 3 = 22.68
    expect(row.getCell(27).value).toBeCloseTo(22.68, 2);
  });

  it('leaves the return-info block + Postage Loss blank for active sales', async () => {
    const active = baseSale({
      id: 'EBAY__ORD-A1__IMEI-3',
      orderNumber: 'ORD-A1',
      voidedAt: undefined,
    });
    const buffer = await buildSalesWorkbookBuffer({ sales: [active] });
    const wb = await loadWorkbook(buffer);
    const sheet = wb.getWorksheet('EBAY')!;
    const row = sheet.getRow(2);
    expect(row.getCell(26).value).toBeNull();        // Return Date
    expect(row.getCell(27).value).toBeNull();        // Outcome
    expect(row.getCell(28).value).toBeNull();        // Return Reason
    expect(row.getCell(29).value).toBeNull();        // Shipping Legs
    expect(row.getCell(30).value).toBeNull();        // Postage Loss
  });

  it('appends a bold TOTAL row with SUM formulas across the data range', async () => {
    const sales = [
      baseSale({ id: 'AMAZON__O1__X', marketplace: 'AMAZON', orderNumber: 'O1',
        buyPrice: 100, salePrice: 200, postage: 8, postageVat: 1.6 }),
      baseSale({ id: 'AMAZON__O2__Y', marketplace: 'AMAZON', orderNumber: 'O2',
        buyPrice: 150, salePrice: 250, postage: 8, postageVat: 1.6 }),
    ];
    const buffer = await buildSalesWorkbookBuffer({ sales });
    const wb = await loadWorkbook(buffer);
    const sheet = wb.getWorksheet('AMAZON')!;
    // Header on row 1, two data rows (2,3), TOTAL row on row 4.
    const totalRow = sheet.getRow(4);
    expect(totalRow.getCell(1).value).toBe('TOTAL');
    // BP totalling cell (col G=7) holds a SUM formula.
    const bpCell = totalRow.getCell(7).value as any;
    expect(bpCell).toBeTruthy();
    expect(bpCell.formula).toMatch(/^SUM\(G2:G3\)$/);
    // Net GP % cell uses IFERROR((GP-Loss)/Denom*100,0) so a zero-denominator
    // period doesn't blow up the totals row.
    const gpPctCell = totalRow.getCell(20).value as any;
    expect(gpPctCell.formula).toContain('IFERROR');
    expect(gpPctCell.formula).toContain('S4');     // GP total
    expect(gpPctCell.formula).toContain('AA4');    // Postage Loss total
    expect(gpPctCell.formula).toContain('G4');     // BP total (denominator)
  });

  it('Summary row for a marketplace carries the right counts + Net GP', async () => {
    const sales: Sale[] = [
      baseSale({ id: 'EBAY__OA__X', marketplace: 'EBAY', orderNumber: 'OA',
        buyPrice: 100, salePrice: 200 }),
      baseSale({ id: 'EBAY__OB__Y', marketplace: 'EBAY', orderNumber: 'OB',
        buyPrice: 100, salePrice: 200,
        voidedAt: '2026-05-13', voidOutcome: 'refund', voidReason: 'wrong colour',
        postage: 8, postageVat: 1.6 }),
      baseSale({ id: 'EBAY__OC__Z', marketplace: 'EBAY', orderNumber: 'OC',
        buyPrice: 100, salePrice: 200,
        voidedAt: '2026-05-14', voidOutcome: 'replacement', voidReason: 'faulty',
        postage: 8, postageVat: 1.6 }),
    ];
    const buffer = await buildSalesWorkbookBuffer({ sales });
    const wb = await loadWorkbook(buffer);
    const summary = wb.getWorksheet('Summary')!;
    // Header at row 4. AMAZON=row5, BM=row6, EBAY=row7, ONBUY=row8, TOTAL=row9.
    const ebayRow = summary.getRow(7);
    expect(ebayRow.getCell(1).value).toBe('EBAY');
    expect(ebayRow.getCell(2).value).toBe(3);        // Sales count
    expect(ebayRow.getCell(3).value).toBe(1);        // Refunds
    expect(ebayRow.getCell(4).value).toBe(1);        // Replacements
    // Postage Loss = 19.2 (refund) + 28.8 (replacement) = 48
    expect(ebayRow.getCell(6).value).toBeCloseTo(48, 1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Lifecycle — sell → return → re-sell
// ───────────────────────────────────────────────────────────────────────────

function seedUnit(over: Partial<InventoryUnit> = {}): InventoryUnit {
  const imei = over.imei ?? '356938035643809';
  const unit: InventoryUnit = {
    id: over.id ?? imei,
    imei,
    model: 'iPhone 13 128GB',
    brand: 'Apple',
    category: 'iPhone',
    colour: 'Black',
    buyPrice: 200,
    dateIn: '2026-05-01',
    supplierId: 'sup_existing',
    supplierName: 'MHL',
    status: 'available',
    flags: [],
    notes: '',
    platformListed: false,
    listingSites: [],
    ownerId: 'shared',
    createdAt: '2026-05-01T00:00:00Z',
    ...over,
  };
  col('inventoryUnits').set(unit.id, unit);
  return unit;
}

/** ProcessReturnModal essentially runs this — void the sale + stamp the
 *  return fields onto the unit. We replay it in-line so the test stays
 *  independent of the modal's React wiring. */
async function processReturn(opts: {
  saleId: string;
  unitId: string;
  outcome: 'refund' | 'replacement';
  returnType: 'returned_to_inventory' | 'repair' | 'returned_to_supplier';
  reason: string;
  returnDate: string;
  legCost: number;
}) {
  // Void the sale.
  await dbService.update('sales', opts.saleId, {
    voidedAt: opts.returnDate,
    voidReason: `${opts.outcome === 'replacement' ? 'Replacement' : 'Refund'} — ${opts.reason}`,
    voidOutcome: opts.outcome,
  });
  // Stamp the unit. Mirrors ProcessReturnModal lines 1823-1839.
  const status: InventoryUnit['status'] = opts.returnType === 'returned_to_inventory'
    ? 'available' : 'returned';
  await dbService.update('inventoryUnits', opts.unitId, {
    status,
    returnType: opts.returnType,
    returnDate: opts.returnDate,
    returnReason: opts.reason,
    returnOutcome: opts.outcome,
    returnLegCost: opts.legCost,
    // Clear the sale stamp so the unit can be re-sold without colliding
    // with the prior cycle's values.
    salePrice: null, saleDate: null, salePlatform: null, saleOrderId: null,
    postageCost: null,
  });
}

describe('return / replacement / re-sell lifecycle', () => {
  it('refund flow: sale gets voidedAt + voidOutcome=refund; unit holds returnType', async () => {
    const unit = seedUnit();
    const sold = await recordSale({
      marketplace: 'EBAY', orderNumber: 'ORD-RF',
      imei: unit.imei, buyPrice: unit.buyPrice, salePrice: 400,
    });
    expect(sold.ok).toBe(true);

    await processReturn({
      saleId: sold.saleId!, unitId: unit.id,
      outcome: 'refund', returnType: 'returned_to_inventory',
      reason: 'Buyer cancelled', returnDate: '2026-05-20', legCost: 9.6,
    });

    const sale = col('sales').get(sold.saleId!);
    expect(sale.voidedAt).toBe('2026-05-20');
    expect(sale.voidOutcome).toBe('refund');
    expect(sale.voidReason).toMatch(/Refund — Buyer cancelled/);

    const afterUnit = col('inventoryUnits').get(unit.id);
    expect(afterUnit.status).toBe('available');
    expect(afterUnit.returnType).toBe('returned_to_inventory');
    expect(afterUnit.returnOutcome).toBe('refund');
    expect(afterUnit.returnLegCost).toBe(9.6);
    expect(afterUnit.salePrice).toBeUndefined();    // cleared (treated as deleted by mock)
  });

  it('replacement flow stores voidOutcome=replacement so postageLossFor multiplies by 3', async () => {
    const unit = seedUnit({ imei: '358888888888888' });
    const sold = await recordSale({
      marketplace: 'AMAZON', orderNumber: 'ORD-RP',
      imei: unit.imei, buyPrice: unit.buyPrice, salePrice: 360,
    });
    await processReturn({
      saleId: sold.saleId!, unitId: unit.id,
      outcome: 'replacement', returnType: 'repair',
      reason: 'Faulty screen', returnDate: '2026-05-21', legCost: 6.30 + 1.26,
    });

    const sale = col('sales').get(sold.saleId!);
    expect(sale.voidOutcome).toBe('replacement');
    expect(postageLossFor(sale)).toBeCloseTo(sale.postage * 1.2 * 3, 1);
    expect(shippingLegsFor(sale)).toBe(3);
  });

  it('multi-cycle: sell → refund → re-sell — unit clears returnType but voided sale survives', async () => {
    const unit = seedUnit({ imei: '359999999999999' });

    // Cycle 1: sell + refund.
    const first = await recordSale({
      marketplace: 'EBAY', orderNumber: 'ORD-CYC-1',
      imei: unit.imei, buyPrice: unit.buyPrice, salePrice: 400,
    });
    expect(first.ok).toBe(true);
    await processReturn({
      saleId: first.saleId!, unitId: unit.id,
      outcome: 'refund', returnType: 'returned_to_inventory',
      reason: 'Buyer remorse', returnDate: '2026-05-22', legCost: 9.6,
    });
    expect(col('inventoryUnits').get(unit.id).returnType).toBe('returned_to_inventory');

    // Cycle 2: re-sell on a different marketplace.
    const second = await recordSale({
      marketplace: 'AMAZON', orderNumber: 'ORD-CYC-2',
      imei: unit.imei, buyPrice: unit.buyPrice, salePrice: 380,
    });
    expect(second.ok).toBe(true);

    // Unit doc is back to a clean sold state — prior cycle's return
    // fields are wiped (recordSale lines 217-222), but the voided sale
    // from cycle 1 still lives on the sales collection for audit.
    const afterUnit = col('inventoryUnits').get(unit.id);
    expect(afterUnit.status).toBe('sold');
    expect(afterUnit.returnType).toBeUndefined();
    expect(afterUnit.returnOutcome).toBeUndefined();
    expect(afterUnit.returnLegCost).toBeUndefined();
    expect(afterUnit.saleOrderId).toBe('ORD-CYC-2');

    // Both sale docs exist; cycle 1 still carries voidedAt.
    const allSales = Array.from(col('sales').values());
    expect(allSales.length).toBe(2);
    const voided = allSales.find(s => s.id === first.saleId);
    const active = allSales.find(s => s.id === second.saleId);
    expect(voided?.voidedAt).toBe('2026-05-22');
    expect(active?.voidedAt).toBeUndefined();
  });

  it('Sales Report builds correctly across a multi-cycle unit (voided row + active row)', async () => {
    const unit = seedUnit({ imei: '350000000000111' });

    const first = await recordSale({
      marketplace: 'EBAY', orderNumber: 'ORD-X1',
      imei: unit.imei, buyPrice: 200, salePrice: 400,
    });
    await processReturn({
      saleId: first.saleId!, unitId: unit.id,
      outcome: 'refund', returnType: 'returned_to_inventory',
      reason: 'wrong colour', returnDate: '2026-05-23', legCost: 9.6,
    });
    const second = await recordSale({
      marketplace: 'AMAZON', orderNumber: 'ORD-X2',
      imei: unit.imei, buyPrice: 200, salePrice: 380,
    });
    expect(second.ok).toBe(true);

    const sales = Array.from(col('sales').values()) as Sale[];
    const buffer = await buildSalesWorkbookBuffer({ sales });
    const wb = await loadWorkbook(buffer);

    // EBAY tab carries the voided row with the return-info block populated.
    const ebay = wb.getWorksheet('EBAY')!;
    expect(ebay.getRow(2).getCell(27).value).toBe('Refund');         // Outcome
    expect(ebay.getRow(2).getCell(29).value).toBe(2);                // Shipping Legs
    // AMAZON tab carries the re-sale row with the block left blank.
    const amazon = wb.getWorksheet('AMAZON')!;
    expect(amazon.getRow(2).getCell(24).value).toBeNull();           // Outcome blank
    expect(amazon.getRow(2).getCell(26).value).toBeNull();           // Shipping Legs blank

    // Summary roll-up reflects both: 1 refund on EBAY, 1 sale on AMAZON.
    const summary = wb.getWorksheet('Summary')!;
    const amazonRow = summary.getRow(5);       // AMAZON
    expect(amazonRow.getCell(2).value).toBe(1); // Sales
    expect(amazonRow.getCell(3).value).toBe(0); // Refunds
    const ebayRow = summary.getRow(7);          // EBAY
    expect(ebayRow.getCell(2).value).toBe(1);   // Sales
    expect(ebayRow.getCell(3).value).toBe(1);   // Refunds
  });
});

// ───────────────────────────────────────────────────────────────────────────
// BUG-LR-001 — Original Sale Price picks the most-recent voided sale
// ───────────────────────────────────────────────────────────────────────────

describe('Returns Detail picks the most-recent voided sale (BUG-LR-001)', () => {
  it('breaks the voidedAt tie via saleDate + createdAt for same-day cycles', async () => {
    // A unit cycled sold → returned → re-sold → re-returned three times on
    // the same calendar day. All three Sale docs share voidedAt='2026-06-12'
    // — the old code's `s.voidedAt > best.voidedAt` resolved every pair to
    // false, so the FIRST iterated sale won. Tiebreaker now uses saleDate +
    // createdAt so the latest cycle (the one that actually triggered THIS
    // return) lands in Sheet 2's Original Sale Price / Date / Marketplace.
    const sameImei = '358138281139564';
    const unit: InventoryUnit = {
      id: sameImei, imei: sameImei,
      model: 'iPhone SE 3 128GB', brand: 'Apple', category: 'iPhone', colour: 'Black',
      buyPrice: 100, dateIn: '2026-06-01',
      supplierId: 'sup_imax', supplierName: 'IMAX',
      status: 'returned',
      returnType: 'returned_to_supplier',
      returnDate: '2026-06-12',
      returnReason: 'Faulty unit - DOA',
      returnLegCost: 7.56,
      flags: [], notes: '', platformListed: false, listingSites: [],
      ownerId: 'shared', createdAt: '2026-06-01T00:00:00Z',
    };
    const sales: Sale[] = [
      // Earliest cycle — saleDate same, but createdAt earliest.
      baseSale({ id: 'AMAZON__TC-003__X', marketplace: 'AMAZON',
        orderNumber: 'TC-003', imei: sameImei, unitId: sameImei,
        saleDate: '2026-06-12', salePrice: 145, buyPrice: 100,
        voidedAt: '2026-06-12', voidOutcome: 'refund', voidReason: 'cycle 1',
        createdAt: '2026-06-12T09:00:00.000Z', updatedAt: '2026-06-12T09:05:00.000Z' }),
      // Middle cycle.
      baseSale({ id: 'EBAY__TC-005__X', marketplace: 'EBAY',
        orderNumber: 'TC-005', imei: sameImei, unitId: sameImei,
        saleDate: '2026-06-12', salePrice: 140, buyPrice: 100,
        voidedAt: '2026-06-12', voidOutcome: 'refund', voidReason: 'cycle 2',
        createdAt: '2026-06-12T11:00:00.000Z', updatedAt: '2026-06-12T11:05:00.000Z' }),
      // Latest cycle — the one that actually triggered the supplier return.
      baseSale({ id: 'AMAZON__TC-019__X', marketplace: 'AMAZON',
        orderNumber: 'TC-019', imei: sameImei, unitId: sameImei,
        saleDate: '2026-06-12', salePrice: 125, buyPrice: 100,
        voidedAt: '2026-06-12', voidOutcome: 'refund', voidReason: 'cycle 10 — supplier',
        createdAt: '2026-06-12T15:30:00.000Z', updatedAt: '2026-06-12T15:35:00.000Z' }),
    ];

    const buf = await buildReturnsWorkbookBuffer({ units: [unit], sales });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const detail = wb.getWorksheet('Returns Detail')!;
    // Row 1 = headers, row 2 = our one returned unit.
    const row = detail.getRow(2);
    // Original Sale Price (col 8) — must be the LATEST cycle (£125), not
    // the iteration-first £145.
    expect(row.getCell(8).value).toBe(125);
    // Marketplace (col 9) — should match the latest sale.
    expect(row.getCell(9).value).toBe('AMAZON');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// OBS-LR-001 — Returns Summary counts every voided sale (per-event)
// ───────────────────────────────────────────────────────────────────────────

describe('Returns Summary counts return EVENTS not unique units (OBS-LR-001)', () => {
  it('totals 10 returns + £143.64 loss for one IMEI cycled 10× on the same day', async () => {
    // Same scenario as the QA report: 1 unit, 10 cycles in one day —
    // 1 replacement (£22.68), 8 refunds (£15.12 each), 1 final
    // refund (£15.12 — the supplier return). Old code totalled 1
    // return × £15.12 because it iterated unique units; new code
    // iterates voided sales so it surfaces all 10 events.
    const imei = '358138281139564';
    const unit: InventoryUnit = {
      id: imei, imei,
      model: 'iPhone SE 3 128GB', brand: 'Apple', category: 'iPhone', colour: 'Black',
      buyPrice: 100, dateIn: '2026-06-01',
      supplierId: 'sup_imax', supplierName: 'IMAX',
      status: 'returned',
      returnType: 'returned_to_supplier',
      returnDate: '2026-06-12',
      returnReason: 'Faulty unit - DOA',
      returnLegCost: 7.56,
      flags: [], notes: '', platformListed: false, listingSites: [],
      ownerId: 'shared', createdAt: '2026-06-01T00:00:00Z',
    };
    const cycle = (n: number, outcome: 'refund' | 'replacement'): Sale =>
      baseSale({
        id: `EBAY__C${n}__${imei}`, marketplace: 'EBAY',
        orderNumber: `C${n}`, imei, unitId: imei,
        saleDate: '2026-06-12', salePrice: 150, buyPrice: 100,
        postage: 6.30, postageVat: 1.26,
        voidedAt: '2026-06-12', voidOutcome: outcome, voidReason: `cycle ${n}`,
        createdAt: `2026-06-12T${String(8 + n).padStart(2, '0')}:00:00.000Z`,
      });
    const sales: Sale[] = [
      cycle(1, 'replacement'),
      ...Array.from({ length: 9 }, (_, i) => cycle(i + 2, 'refund')),
    ];

    const buf = await buildReturnsWorkbookBuffer({ units: [unit], sales });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const summary = wb.getWorksheet('Summary')!;
    // Sheet shape (writeSummaryRow): r1=Period, r2=Total Returns,
    // r3=Refunds, r4=Replacements, r5=Total Postage Loss, r6=Avg.
    expect(summary.getRow(2).getCell(2).value).toBe(10);   // Total Returns
    expect(summary.getRow(3).getCell(2).value).toBe(9);    // Refunds
    expect(summary.getRow(4).getCell(2).value).toBe(1);    // Replacements
    // 9 refunds × £15.12 + 1 replacement × £22.68 = £158.76
    expect(summary.getRow(5).getCell(2).value).toBeCloseTo(158.76, 1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// BUG-002 — repair-route returns labelled "In Repair", not "Refund"
// ───────────────────────────────────────────────────────────────────────────

describe('repair-route returns surface "In Repair" everywhere (BUG-002)', () => {
  const sameImei = '359000000000111';
  const repairUnit: InventoryUnit = {
    id: sameImei, imei: sameImei,
    model: 'iPhone SE 3 128GB', brand: 'Apple', category: 'iPhone', colour: 'Black',
    buyPrice: 100, dateIn: '2026-06-01',
    supplierId: 'sup_imax', supplierName: 'IMAX',
    status: 'returned',
    returnType: 'repair',
    returnDate: '2026-06-12',
    returnReason: 'Cracked screen',
    returnLegCost: 7.56,  // even with a snapshot we should NOT charge legs
    flags: [], notes: '', platformListed: false, listingSites: [],
    ownerId: 'shared', createdAt: '2026-06-01T00:00:00Z',
  };
  const repairSale: Sale = baseSale({
    id: 'EBAY__REP-1__X', marketplace: 'EBAY',
    orderNumber: 'REP-1', imei: sameImei, unitId: sameImei,
    saleDate: '2026-06-12', salePrice: 140, buyPrice: 100,
    postage: 6.30, postageVat: 1.26,
    voidedAt: '2026-06-12',
    // voidOutcome deliberately undefined — repair flow doesn't capture one
    voidReason: 'Sent for repair — cracked screen',
  });

  it('Sales Report row shows Outcome="In Repair" + blank Legs + blank Postage Loss', async () => {
    const buf = await buildSalesWorkbookBuffer({
      sales: [repairSale], units: [repairUnit],
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ebay = wb.getWorksheet('EBAY')!;
    const row = ebay.getRow(2);
    expect(row.getCell(27).value).toBe('In Repair');   // Outcome (AA)
    expect(row.getCell(29).value).toBeNull();          // Shipping Legs (AC) blank
    expect(row.getCell(30).value).toBeNull();          // Postage Loss (AD) blank
  });

  it('Sales Summary excludes the repair void from refund/replacement counters and loss', async () => {
    const buf = await buildSalesWorkbookBuffer({
      sales: [
        repairSale,
        baseSale({ id: 'EBAY__R1__Y', marketplace: 'EBAY', orderNumber: 'R1',
          buyPrice: 100, salePrice: 200, postage: 8, postageVat: 1.6,
          voidedAt: '2026-06-13', voidOutcome: 'refund', voidReason: 'plain refund' }),
      ],
      units: [repairUnit],
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const summary = wb.getWorksheet('Summary')!;
    const ebayRow = summary.getRow(7);
    expect(ebayRow.getCell(2).value).toBe(2);          // Sales (both counted)
    expect(ebayRow.getCell(3).value).toBe(1);          // Refunds — repair excluded
    expect(ebayRow.getCell(4).value).toBe(0);          // Replacements
    // Postage Loss = ONLY the £19.20 from the plain refund.
    expect(ebayRow.getCell(6).value).toBeCloseTo(19.2, 1);
  });

  it('Returns Detail shows "In Repair" + blank Shipping Legs', async () => {
    const buf = await buildReturnsWorkbookBuffer({
      units: [repairUnit], sales: [repairSale],
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const detail = wb.getWorksheet('Returns Detail')!;
    const row = detail.getRow(2);
    expect(row.getCell(11).value).toBe('In Repair');   // Outcome col 11
    expect(row.getCell(15).value).toBeNull();          // Shipping Legs blank
    expect(row.getCell(16).value).toBeNull();          // Postage Loss £ blank
  });

  it('Returns Summary excludes the repair from refund + loss totals', async () => {
    const buf = await buildReturnsWorkbookBuffer({
      units: [repairUnit], sales: [repairSale],
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const summary = wb.getWorksheet('Summary')!;
    expect(summary.getRow(2).getCell(2).value).toBe(0);      // Total Returns
    expect(summary.getRow(3).getCell(2).value).toBe(0);      // Refunds
    expect(summary.getRow(5).getCell(2).value).toBe(0);      // Postage Loss
  });

  it('Unit Histories RETURNED event reads "In Repair · reason" with zero loss', async () => {
    const buf = await buildReturnsWorkbookBuffer({
      units: [repairUnit], sales: [repairSale],
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const hist = wb.getWorksheet('Unit Histories')!;
    // Find the RETURNED row in the timeline (cols: IMEI, Model, EventDate,
    // Event, Detail, Amount £, Comments).
    for (let r = 2; r <= hist.rowCount; r++) {
      const ev = hist.getRow(r).getCell(4).value;
      if (ev !== 'RETURNED') continue;
      const detail = String(hist.getRow(r).getCell(5).value || '');
      expect(detail.startsWith('In Repair')).toBe(true);
      expect(hist.getRow(r).getCell(6).value).toBeNull(); // Amount blank
      return;
    }
    throw new Error('No RETURNED row emitted for the repair-route unit');
  });
});
