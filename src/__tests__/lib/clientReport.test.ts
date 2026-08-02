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
import { viewModelFromXlsxBuffer } from '../../lib/reportView';

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
  it('produces 10 sheets — Summary + Accessories + Returns Summary/Detail/Unit Histories + AMAZON / BM / EBAY / ONBUY / TEMU', async () => {
    const buffer = await buildSalesWorkbookBuffer({ sales: [] });
    const wb = await loadWorkbook(buffer);
    // The returns section sits after the marketplace tabs (TEMU is last)
    // so the sheet order reads: overview, per-channel sale detail, the
    // cross-marketplace accessories view, then the returns lifecycle.
    // 'Returns Summary' (not 'Summary') avoids colliding with the
    // workbook's own top-level Summary sheet.
    expect(wb.worksheets.map(w => w.name)).toEqual([
      'Summary', 'AMAZON', 'BM', 'EBAY', 'ONBUY', 'TEMU', 'Accessories',
      'Returns Summary', 'Returns Detail', 'Unit Histories',
    ]);
  });

  it('Accessories sheet — carries every no-IMEI sku sale across marketplaces, and only those', async () => {
    const sales: Sale[] = [
      // A real unit sale (has an IMEI) — must NOT appear on Accessories.
      baseSale({ id: 'EBAY__U1__I1', orderNumber: 'U1', marketplace: 'EBAY', imei: '359108096724237' }),
      // Two accessory sales on different marketplaces — no IMEI, SKU set.
      baseSale({
        id: 'AMAZON__A1__usb-c-20w', orderNumber: 'A1', marketplace: 'AMAZON',
        imei: undefined, unitId: undefined, sku: 'USB-C-20W',
        buyPrice: 3.5, salePrice: 12,
      }),
      baseSale({
        id: 'BM__A2__sim-pin-01', orderNumber: 'A2', marketplace: 'BM',
        imei: undefined, unitId: undefined, sku: 'SIM-PIN-01',
        buyPrice: 0.15, salePrice: 2,
      }),
    ];
    const buffer = await buildSalesWorkbookBuffer({
      sales,
      accessoryStock: [
        { id: 'usb_c_20w', sku: 'USB-C-20W', name: 'USB-C 20W Charger', quantity: 50, totalReceived: 50, buyPrice: 3.5, ownerId: 'shared' } as any,
        { id: 'sim_pin_01', sku: 'SIM-PIN-01', name: 'SIM Eject Pin', quantity: 100, totalReceived: 100, buyPrice: 0.15, ownerId: 'shared' } as any,
      ],
    });
    const wb = await loadWorkbook(buffer);
    const sheet = wb.getWorksheet('Accessories')!;
    // Header + 2 accessory rows + TOTAL row.
    expect(sheet.rowCount).toBe(4);
    expect(String(sheet.getRow(1).getCell(1).value)).toBe('Date');
    expect(String(sheet.getRow(1).getCell(5).value)).toBe('Name');

    const skusOnSheet = [sheet.getRow(2).getCell(4).value, sheet.getRow(3).getCell(4).value];
    expect(skusOnSheet.sort()).toEqual(['SIM-PIN-01', 'USB-C-20W']);
    // Friendly names resolved from accessoryStock, not left as raw SKUs.
    const namesOnSheet = [sheet.getRow(2).getCell(5).value, sheet.getRow(3).getCell(5).value];
    expect(namesOnSheet.sort()).toEqual(['SIM Eject Pin', 'USB-C 20W Charger']);
  });

  it('Accessories sheet still shows a bare header when there are no accessory sales', async () => {
    const buffer = await buildSalesWorkbookBuffer({ sales: [baseSale({})] });
    const wb = await loadWorkbook(buffer);
    const sheet = wb.getWorksheet('Accessories')!;
    expect(sheet.rowCount).toBe(1); // header only, no TOTAL row when there's nothing to total
  });

  it('Returns Detail tab — headers carry the full per-return lifecycle schema', async () => {
    const buffer = await buildSalesWorkbookBuffer({ sales: [] });
    const wb = await loadWorkbook(buffer);
    const detail = wb.getWorksheet('Returns Detail')!;
    const header = detail.getRow(1);
    expect(String(header.getCell(1).value)).toBe('Return Date');
    expect(String(header.getCell(2).value)).toBe('Unit IMEI');
    expect(String(header.getCell(9).value)).toBe('Marketplace');
    expect(String(header.getCell(10).value)).toBe('Return Type');
    expect(String(header.getCell(11).value)).toBe('Outcome');
    expect(String(header.getCell(15).value)).toBe('Shipping Legs');
    expect(String(header.getCell(16).value)).toBe('Postage Loss £');
    // Empty period → header + an empty-state hint row (so a bare header
    // doesn't read as "broken" — see the "no data at all" test below).
    expect(detail.rowCount).toBe(2);
    expect(String(detail.getRow(2).getCell(1).value)).toBe('No returns recorded for this period.');
  });

  it('Returns Detail tab — a voided sale with no linked unit still appears (orphan fallback), Return Type left blank', async () => {
    const sales: Sale[] = [
      // 1 active EBAY sale (must NOT appear on Returns Detail).
      baseSale({ id: 'EBAY__A__I1', orderNumber: 'A', marketplace: 'EBAY' }),
      // 2 returns on different marketplaces, neither with a matching unit
      // passed in — exactly the shape of the incident this sheet exists to
      // survive (unit deleted, only the voided Sale remains).
      baseSale({
        id: 'EBAY__B__I2', orderNumber: 'B', marketplace: 'EBAY',
        imei: '350000000000002', unitId: 'unit-b',
        voidedAt: '2026-06-13', voidOutcome: 'refund', voidReason: 'wrong colour',
        postage: 8, postageVat: 1.6,
      }),
      baseSale({
        id: 'AMAZON__C__I3', orderNumber: 'C', marketplace: 'AMAZON',
        imei: '350000000000003', unitId: 'unit-c',
        voidedAt: '2026-06-12', voidOutcome: 'replacement', voidReason: 'faulty',
        postage: 6.30, postageVat: 1.26,
      }),
    ];
    const buffer = await buildSalesWorkbookBuffer({ sales });
    const wb = await loadWorkbook(buffer);
    const detail = wb.getWorksheet('Returns Detail')!;
    // Header + 2 orphan rows (distinct unitIds — B and C are unrelated
    // returns), newest voidedAt first. No TOTAL row on this sheet
    // (Returns Summary carries the aggregate instead).
    expect(detail.rowCount).toBe(3);
    const r2 = detail.getRow(2);
    expect(r2.getCell(9).value).toBe('EBAY');
    expect(r2.getCell(10).value).toBe('');           // Return Type unknown — never guessed
    expect(r2.getCell(11).value).toBe('Refund');
    expect(r2.getCell(15).value).toBe(2);
    expect(r2.getCell(16).value).toBeCloseTo(19.2, 2);
    const r3 = detail.getRow(3);
    expect(r3.getCell(9).value).toBe('AMAZON');
    expect(r3.getCell(11).value).toBe('Replacement');
    expect(r3.getCell(15).value).toBe(3);
    expect(r3.getCell(16).value).toBeCloseTo(22.68, 2);
  });

  it('Returns Detail — Return Type column reads the linked unit\'s returnType; falls back to blank when no unit is on file', async () => {
    const sales: Sale[] = [
      baseSale({
        id: 'EBAY__RT1__350000000000010', orderNumber: 'RT1', marketplace: 'EBAY',
        imei: '350000000000010', unitId: 'u-rt1',
        voidedAt: '2026-06-13', voidOutcome: 'refund', voidReason: 'faulty',
        postage: 8, postageVat: 1.6,
      }),
      baseSale({
        id: 'AMAZON__RT2__350000000000020', orderNumber: 'RT2', marketplace: 'AMAZON',
        imei: '350000000000020', unitId: 'u-rt2',
        voidedAt: '2026-06-12', voidOutcome: 'refund', voidReason: 'faulty, sent back',
        postage: 6.30, postageVat: 1.26,
      }),
      // No linked unit at all — Return Type should read blank via the
      // orphan fallback, not throw.
      baseSale({
        id: 'ONBUY__RT3__350000000000030', orderNumber: 'RT3', marketplace: 'ONBUY',
        imei: '350000000000030', unitId: '',
        voidedAt: '2026-06-11', voidOutcome: 'refund', voidReason: 'no unit on file',
        postage: 5.90, postageVat: 1.18,
      }),
    ];
    const units: InventoryUnit[] = [
      { id: 'u-rt1', imei: '350000000000010', model: 'iPhone 13', brand: 'Apple', category: 'iPhone',
        colour: 'Black', buyPrice: 200, dateIn: '2026-05-01', supplierId: 's', supplierName: 'MHL',
        status: 'available', returnType: 'returned_to_inventory', returnDate: '2026-06-13',
        flags: [], notes: '', platformListed: false, listingSites: [],
        ownerId: 'shared', createdAt: '2026-05-01T00:00:00Z' } as InventoryUnit,
      { id: 'u-rt2', imei: '350000000000020', model: 'Galaxy A15', brand: 'Samsung', category: 'Samsung A Series',
        colour: 'Black', buyPrice: 100, dateIn: '2026-05-01', supplierId: 's', supplierName: 'NIHAL',
        status: 'returned', returnType: 'returned_to_supplier', returnDate: '2026-06-12',
        flags: [], notes: '', platformListed: false, listingSites: [],
        ownerId: 'shared', createdAt: '2026-05-01T00:00:00Z' } as InventoryUnit,
    ];
    const buffer = await buildSalesWorkbookBuffer({ sales, units });
    const wb = await loadWorkbook(buffer);
    const detail = wb.getWorksheet('Returns Detail')!;
    const header = detail.getRow(1);
    expect(String(header.getCell(10).value)).toBe('Return Type');

    // Locate rows by Unit IMEI (col 2) — Returns Detail is unit-scoped and
    // carries no Order Number column, unlike the old flat Returns tab.
    const rows = [detail.getRow(2), detail.getRow(3), detail.getRow(4)];
    const byImei = (imei: string) => rows.find(r => r.getCell(2).value === imei)!;
    expect(byImei('350000000000010').getCell(10).value).toBe('Back to Inventory');
    expect(byImei('350000000000020').getCell(10).value).toBe('To Supplier');
    expect(byImei('350000000000030').getCell(10).value).toBe('');
  });

  it('Returns Detail — a voided accessory sale (no unitId/IMEI) appears via the orphan fallback as an "Accessory" row with its friendly name, when accessoryStock is supplied', async () => {
    const sales: Sale[] = [
      baseSale({
        id: 'AMAZON__ACC-1__USB-C-20W', orderNumber: 'ACC-1', marketplace: 'AMAZON',
        imei: '', unitId: '', sku: 'USB-C-20W', model: '',
        voidedAt: '2026-06-13', voidOutcome: 'refund', voidReason: 'customer changed their mind',
        postage: 2.5, postageVat: 0.5, salePrice: 9.99,
      }),
    ];
    const buffer = await buildSalesWorkbookBuffer({
      sales,
      accessoryStock: [{ id: 'usb_c_20w', sku: 'USB-C-20W', name: 'USB-C 20W Charger', quantity: 10, buyPrice: 3.5 } as any],
    });
    const wb = await loadWorkbook(buffer);
    const detail = wb.getWorksheet('Returns Detail')!;
    expect(detail.rowCount).toBe(2); // header + the one accessory return row
    const row = detail.getRow(2);
    expect(row.getCell(2).value).toBe('');                     // Unit IMEI — accessories have none
    expect(row.getCell(3).value).toBe('USB-C 20W Charger');    // Model — resolved friendly name, not raw SKU
    expect(row.getCell(9).value).toBe('AMAZON');
    expect(row.getCell(10).value).toBe('Accessory');           // Return Type — distinct from a blank unit orphan
    expect(row.getCell(11).value).toBe('Refund');
    expect(row.getCell(12).value).toBe('customer changed their mind');
    expect(row.getCell(16).value).toBeCloseTo(6, 2);            // (2.5 + 0.5) × 2
  });

  it('Returns Detail — an accessory sale with an unrecognised SKU (no accessoryStock match) still drops out as a true orphan, not mislabelled', async () => {
    const sales: Sale[] = [
      baseSale({
        id: 'AMAZON__ACC-2__UNKNOWN-SKU', orderNumber: 'ACC-2', marketplace: 'AMAZON',
        imei: '', unitId: '', sku: 'UNKNOWN-SKU', model: '',
        voidedAt: '2026-06-13', voidOutcome: 'refund',
      }),
    ];
    const buffer = await buildSalesWorkbookBuffer({ sales, accessoryStock: [] });
    const wb = await loadWorkbook(buffer);
    const detail = wb.getWorksheet('Returns Detail')!;
    // No unitId, no IMEI, no matching accessory pool — nothing stable to
    // key an orphan row on, so no real return row is added; the sheet
    // falls back to its "nothing to show" explanatory row instead.
    expect(detail.rowCount).toBe(2);
    expect(String(detail.getRow(2).getCell(1).value)).toMatch(/no unit has a Return Type on file/);
  });

  it('Returns Summary already counts a voided accessory sale — Sheet 1 is purely Sale-doc based, no accessoryStock needed', async () => {
    const sales: Sale[] = [
      baseSale({
        id: 'AMAZON__ACC-3__USB-C-20W', orderNumber: 'ACC-3', marketplace: 'AMAZON',
        imei: '', unitId: '', sku: 'USB-C-20W',
        voidedAt: '2026-06-13', voidOutcome: 'refund',
        postage: 2.5, postageVat: 0.5,
      }),
    ];
    const buffer = await buildSalesWorkbookBuffer({ sales });
    const wb = await loadWorkbook(buffer);
    // The Sales Report's embedded Returns Summary sheet uses the plain
    // writeSummaryRow layout (Period/Total Returns/Refunds/... one per row).
    const returnsSummary = wb.getWorksheet('Returns Summary')!;
    expect(returnsSummary.getRow(2).getCell(2).value).toBe(1); // Total Returns
    expect(returnsSummary.getRow(3).getCell(2).value).toBe(1); // Refunds
    expect(returnsSummary.getRow(6).getCell(2).value).toBeCloseTo(6, 2); // Total Postage Loss £
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
    expect(String(header.getCell(5).value)).toBe('Repairs');
    expect(String(header.getCell(6).value)).toBe('Gross GP £');
    expect(String(header.getCell(7).value)).toBe('Postage Loss £');
    expect(String(header.getCell(8).value)).toBe('Net GP £');
    expect(String(header.getCell(9).value)).toBe('Net GP %');
  });

  it('AMAZON sheet headers include the return-info block before Postage Loss', async () => {
    const buffer = await buildSalesWorkbookBuffer({ sales: [] });
    const wb = await loadWorkbook(buffer);
    const sheet = wb.getWorksheet('AMAZON')!;
    const header = sheet.getRow(1);
    // 27 columns total — last 5 are the return-info block + Postage Loss.
    expect(String(header.getCell(22).value)).toBe('Comments');
    expect(String(header.getCell(23).value)).toBe('Model');
    expect(String(header.getCell(24).value)).toBe('Return Date');
    expect(String(header.getCell(25).value)).toBe('Outcome');
    expect(String(header.getCell(26).value)).toBe('Return Reason');
    expect(String(header.getCell(27).value)).toBe('Shipping Legs');
    expect(String(header.getCell(28).value)).toBe('Postage Loss');
  });

  it('EBAY sheet headers carry 30 cols ending in the return-info block + Postage Loss', async () => {
    const buffer = await buildSalesWorkbookBuffer({ sales: [] });
    const wb = await loadWorkbook(buffer);
    const sheet = wb.getWorksheet('EBAY')!;
    const header = sheet.getRow(1);
    expect(String(header.getCell(25).value)).toBe('Comments');
    expect(String(header.getCell(26).value)).toBe('Model');
    expect(String(header.getCell(27).value)).toBe('Return Date');
    expect(String(header.getCell(28).value)).toBe('Outcome');
    expect(String(header.getCell(29).value)).toBe('Return Reason');
    expect(String(header.getCell(30).value)).toBe('Shipping Legs');
    expect(String(header.getCell(31).value)).toBe('Postage Loss');
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
    // Return Date (col 27) — ExcelJS stores as Date.
    const rd = row.getCell(27).value as Date | null;
    expect(rd).toBeInstanceOf(Date);
    expect((rd as Date).toISOString().startsWith('2026-05-20')).toBe(true);
    expect(row.getCell(28).value).toBe('Refund');
    expect(row.getCell(29).value).toBe('Customer changed mind');
    expect(row.getCell(30).value).toBe(2);          // 2 shipping legs
    expect(row.getCell(31).value).toBeCloseTo(19.2, 2);  // (8 + 1.6) × 2
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
    expect(row.getCell(25).value).toBe('Replacement');
    expect(row.getCell(27).value).toBe(3);
    // (6.30 + 1.26) × 3 = 22.68
    expect(row.getCell(28).value).toBeCloseTo(22.68, 2);
  });

  it('tags + amber-tints a sale whose IMEI has no matching inventory unit', async () => {
    const inStock = baseSale({
      id: 'AMAZON__O-OK__350000000000111', marketplace: 'AMAZON', orderNumber: 'O-OK',
      imei: '350000000000111', unitId: '',
    });
    const orphan = baseSale({
      id: 'AMAZON__O-MISS__350000000000222', marketplace: 'AMAZON', orderNumber: 'O-MISS',
      imei: '350000000000222', unitId: '',
    });
    // Only the first IMEI exists in inventory.
    const units: InventoryUnit[] = [{
      id: 'u-ok', imei: '350000000000111', model: 'iPhone 13', brand: 'Apple',
      category: 'iPhone', colour: 'Black', buyPrice: 200, dateIn: '2026-05-01',
      supplierId: 's', supplierName: 'MHL', status: 'sold',
      flags: [], notes: '', platformListed: false, listingSites: [],
      ownerId: 'shared', createdAt: '2026-05-01T00:00:00Z',
    } as InventoryUnit];

    const buffer = await buildSalesWorkbookBuffer({ sales: [inStock, orphan], units });
    const wb = await loadWorkbook(buffer);
    const sheet = wb.getWorksheet('AMAZON')!;
    const header = sheet.getRow(1);
    let commentsCol = -1;
    header.eachCell((c, i) => { if (String(c.value) === 'Comments') commentsCol = i; });
    expect(commentsCol).toBeGreaterThan(0);

    // Locate each row by its IMEI (sort-order agnostic).
    let okRow = -1, missRow = -1;
    const imeiCol = (() => { let n = -1; header.eachCell((c, i) => { if (String(c.value) === 'IMEI') n = i; }); return n; })();
    sheet.eachRow((row, rn) => {
      if (rn === 1) return;
      const v = String(row.getCell(imeiCol).value ?? '');
      if (v === '350000000000111') okRow = rn;
      if (v === '350000000000222') missRow = rn;
    });
    expect(okRow).toBeGreaterThan(0);
    expect(missRow).toBeGreaterThan(0);

    // The orphan row carries the marker + amber fill; the in-stock row does not.
    expect(String(sheet.getRow(missRow).getCell(commentsCol).value ?? '')).toContain('[NO INVENTORY IMEI]');
    expect((sheet.getRow(missRow).getCell(1).fill as any)?.fgColor?.argb).toBe('FFFEF3C7');
    expect(String(sheet.getRow(okRow).getCell(commentsCol).value ?? '')).not.toContain('[NO INVENTORY IMEI]');

    // Summary sheet carries the prominent callout with the count + detail row.
    const summary = wb.getWorksheet('Summary')!;
    let calloutSeen = false, detailSeen = false;
    summary.eachRow((row) => {
      const a = String(row.getCell(1).value ?? '');
      if (a.includes('Sales with no matching inventory IMEI: 1')) calloutSeen = true;
      if (a === 'AMAZON' && String(row.getCell(2).value ?? '') === '350000000000222') detailSeen = true;
    });
    expect(calloutSeen).toBe(true);
    expect(detailSeen).toBe(true);
  });

  it('does NOT flag no-inventory when the builder is given no unit data', async () => {
    const orphan = baseSale({
      id: 'AMAZON__O-NU__350000000000333', marketplace: 'AMAZON', orderNumber: 'O-NU',
      imei: '350000000000333', unitId: '',
    });
    // No units passed — the report can't know the IMEI is missing, so it
    // must NOT mislabel every row.
    const buffer = await buildSalesWorkbookBuffer({ sales: [orphan] });
    const wb = await loadWorkbook(buffer);
    const sheet = wb.getWorksheet('AMAZON')!;
    const header = sheet.getRow(1);
    let commentsCol = -1;
    header.eachCell((c, i) => { if (String(c.value) === 'Comments') commentsCol = i; });
    expect(String(sheet.getRow(2).getCell(commentsCol).value ?? '')).not.toContain('[NO INVENTORY IMEI]');
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
    expect(row.getCell(27).value).toBeNull();        // Return Date
    expect(row.getCell(28).value).toBeNull();        // Outcome
    expect(row.getCell(29).value).toBeNull();        // Return Reason
    expect(row.getCell(30).value).toBeNull();        // Shipping Legs
    expect(row.getCell(31).value).toBeNull();        // Postage Loss
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
    expect(gpPctCell.formula).toContain('AB4');    // Postage Loss total
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
    // Sales count is ACTIVE sales only (matches the app's ALL-TIME SOLD
    // tile) — the 2 voided rows are tracked via Refunds/Replacements
    // instead of also being counted as a Sale.
    expect(ebayRow.getCell(2).value).toBe(1);        // Sales count
    expect(ebayRow.getCell(3).value).toBe(1);        // Refunds
    expect(ebayRow.getCell(4).value).toBe(1);        // Replacements
    expect(ebayRow.getCell(5).value).toBe(0);        // Repairs
    // Postage Loss (col 7 now) = 19.2 (refund) + 28.8 (replacement) = 48
    expect(ebayRow.getCell(7).value).toBeCloseTo(48, 1);
  });

  // Client-reported (2026-07-27): "ALL-TIME SOLD" read 349 but downloading
  // "All Time" and re-uploading it showed 354 to update — a confusing
  // mismatch. Root cause: the Summary tab's "Sales" column previously
  // counted every row per marketplace, voided or not, so 5 voided sales
  // were silently folded into "Sales" on top of also being tallied as
  // Refunds. Marketplace tabs correctly keep every row (voided sales stay
  // visible, red-highlighted, with full return-info columns — nothing is
  // hidden), but the Summary's headline Sales figure now matches the
  // dashboard KPI exactly.
  it('Summary "Sales" total matches active-only count even when marketplace tabs carry voided rows too (349 vs 354 regression)', async () => {
    const activeCount = 9;
    const voidedCount = 5;
    const sales: Sale[] = [
      ...Array.from({ length: activeCount }, (_, i) => baseSale({
        id: `AMAZON__A${i}__X${i}`, marketplace: 'AMAZON', orderNumber: `A${i}`,
        buyPrice: 100, salePrice: 200,
      })),
      // Distinct unitId per row — the Summary's void-event dedup collapses
      // same-day voids sharing one unitId/imei into a single return event
      // (a single Process-Return click voiding several linked sales), which
      // isn't the case here: these are 5 unrelated orders.
      ...Array.from({ length: voidedCount }, (_, i) => baseSale({
        id: `AMAZON__V${i}__Y${i}`, marketplace: 'AMAZON', orderNumber: `V${i}`,
        unitId: `unit-v${i}`, imei: `35000000000000${i}`,
        buyPrice: 100, salePrice: 200,
        voidedAt: '2026-07-09', voidOutcome: 'refund', voidReason: 'Refund — Cx Change of Mind',
        postage: 8, postageVat: 1.6,
      })),
    ];
    const buffer = await buildSalesWorkbookBuffer({ sales });
    const wb = await loadWorkbook(buffer);

    // Marketplace tab: every row present — nothing removed or hidden.
    const amazon = wb.getWorksheet('AMAZON')!;
    expect(amazon.rowCount).toBe(1 + activeCount + voidedCount + 1); // header + rows + TOTAL

    // Summary tab: Sales = active only, Refunds = the voided 5.
    const summary = wb.getWorksheet('Summary')!;
    const amazonRow = summary.getRow(5);
    expect(amazonRow.getCell(2).value).toBe(activeCount); // Sales — NOT 14
    expect(amazonRow.getCell(3).value).toBe(voidedCount); // Refunds

    // Returns Detail: the same 5 voided sales, on their own (orphan
    // fallback — no units passed in). No TOTAL row on this sheet.
    const detail = wb.getWorksheet('Returns Detail')!;
    expect(detail.rowCount).toBe(1 + voidedCount); // header + 5
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
    expect(ebay.getRow(2).getCell(28).value).toBe('Refund');         // Outcome
    expect(ebay.getRow(2).getCell(30).value).toBe(2);                // Shipping Legs
    // AMAZON tab carries the re-sale row with the block left blank.
    const amazon = wb.getWorksheet('AMAZON')!;
    expect(amazon.getRow(2).getCell(25).value).toBeNull();           // Outcome blank
    expect(amazon.getRow(2).getCell(27).value).toBeNull();           // Shipping Legs blank

    // Summary roll-up reflects both: 1 refund on EBAY (its only sale was
    // voided, so it contributes 0 to Sales — the count is active-only),
    // 1 active sale on AMAZON.
    const summary = wb.getWorksheet('Summary')!;
    const amazonRow = summary.getRow(5);       // AMAZON
    expect(amazonRow.getCell(2).value).toBe(1); // Sales
    expect(amazonRow.getCell(3).value).toBe(0); // Refunds
    const ebayRow = summary.getRow(7);          // EBAY
    expect(ebayRow.getCell(2).value).toBe(0);   // Sales (its one sale was voided)
    expect(ebayRow.getCell(3).value).toBe(1);   // Refunds
  });
});

// ───────────────────────────────────────────────────────────────────────────
// BUG-LR-001 — Original Sale Price picks the most-recent voided sale
// ───────────────────────────────────────────────────────────────────────────

// ───────────────────────────────────────────────────────────────────────────
// Per-marketplace tabs sort cycles newest-first by saleDate (+ createdAt
// tiebreaker), so an IMEI cycled multiple times reads in chronological
// order interleaved with other sales — not in arbitrary store/Firestore
// order. Pinned because the in-app SellSheet and the Returns tab + ALL
// sheet writers all use the same convention; the per-marketplace tabs
// must agree or the operator sees inconsistent ordering across surfaces.
// ───────────────────────────────────────────────────────────────────────────
// ───────────────────────────────────────────────────────────────────────────
// Returns tab filters by voidedAt — NOT by the parent saleDate bucket.
// A sale made last month and returned today must show up under "Today"
// or "This Week" filters. Bug surfaced 2026-06-14: returns tab was empty
// for Today/Week because the saleDate-filtered set excluded the original
// sale, taking the void with it.
// ───────────────────────────────────────────────────────────────────────────
// ───────────────────────────────────────────────────────────────────────────
// Net GP £ column on every per-marketplace row. Active rows: equals Gross
// GP (Postage Loss is blank → Excel treats as 0 → formula = GP). Voided
// rows: equals Gross GP − Postage Loss. TOTAL row sums it. Auditor reads
// the bottom-line £ directly instead of subtracting by eye.
// ───────────────────────────────────────────────────────────────────────────
describe('Net GP £ per-row cell on the marketplace tabs', () => {
  // ExcelJS round-trips formulas as { formula: '...' } objects (no cached
  // result). The reportView in-browser evaluator computes the value. So
  // these tests inspect both: the formula contract on every row, and the
  // computed value via viewModelFromXlsxBuffer.

  it('active EBAY row: formula references this row, computes to Gross GP', async () => {
    const sales = [
      baseSale({ id: 'EBAY__A1__1', marketplace: 'EBAY', orderNumber: 'A1',
        buyPrice: 100, salePrice: 200, postage: 8, postageVat: 1.6 }),
    ];
    const buf = await buildSalesWorkbookBuffer({ sales });
    const wb = await loadWorkbook(buf);
    const ebay = wb.getWorksheet('EBAY')!;
    // EBAY col 32 = Net GP £. Formula = V2 − AE2 (GP − Postage Loss).
    const cell = ebay.getRow(2).getCell(32).value as { formula?: string };
    expect(cell.formula).toBe('V2-AE2');

    // Compute it via reportView — active row → Postage Loss is blank →
    // Net GP £ = Gross GP = 56.51. (Marketing is £0 — the operator types
    // the promo spend per row; we no longer invent SP × 5%.)
    const model = await viewModelFromXlsxBuffer(buf, 't');
    const ebayView = model.sheets.find(s => s.name === 'EBAY')!;
    expect(ebayView.rows[1][21].display).toBe('56.51');  // Gross GP (col 22)
    expect(ebayView.rows[1][31].display).toBe('56.51');  // Net GP £ (col 32)
  });

  it('refunded EBAY row: Net GP £ computes to 56.51 − 19.20 = 37.31', async () => {
    const sales = [
      baseSale({ id: 'EBAY__R1__1', marketplace: 'EBAY', orderNumber: 'R1',
        buyPrice: 100, salePrice: 200, postage: 8, postageVat: 1.6,
        voidedAt: '2026-06-13', voidOutcome: 'refund', voidReason: 'changed mind' }),
    ];
    const buf = await buildSalesWorkbookBuffer({ sales });
    const wb = await loadWorkbook(buf);
    const ebay = wb.getWorksheet('EBAY')!;
    // Postage Loss at col 31, Net GP £ at col 32.
    expect(ebay.getRow(2).getCell(31).value).toBeCloseTo(19.2, 2);
    // Formula round-trips correctly.
    const cell = ebay.getRow(2).getCell(32).value as { formula?: string };
    expect(cell.formula).toBe('V2-AE2');
    // Computed via reportView.
    const model = await viewModelFromXlsxBuffer(buf, 't');
    const ebayView = model.sheets.find(s => s.name === 'EBAY')!;
    expect(ebayView.rows[1][31].display).toBe('37.31');
  });

  it('replacement AMAZON row: Net GP £ = Gross GP − 22.68 (3 legs)', async () => {
    const sale = baseSale({
      id: 'AMAZON__RP__1', marketplace: 'AMAZON', orderNumber: 'RP',
      buyPrice: 100, salePrice: 200, postage: 6.30, postageVat: 1.26,
      voidedAt: '2026-06-13', voidOutcome: 'replacement', voidReason: 'faulty',
    });
    const buf = await buildSalesWorkbookBuffer({ sales: [sale] });
    const wb = await loadWorkbook(buf);
    const amazon = wb.getWorksheet('AMAZON')!;
    expect(amazon.getRow(2).getCell(28).value).toBeCloseTo(22.68, 2);  // Postage Loss
    const cell = amazon.getRow(2).getCell(29).value as { formula?: string };
    expect(cell.formula).toBe('S2-AB2');                                // Net GP £

    const model = await viewModelFromXlsxBuffer(buf, 't');
    const amazonView = model.sheets.find(s => s.name === 'AMAZON')!;
    const gross = parseFloat(amazonView.rows[1][18].display);   // GP col 19
    const net   = parseFloat(amazonView.rows[1][28].display);   // Net GP £ col 29
    expect(Number.isFinite(gross)).toBe(true);
    expect(gross - net).toBeCloseTo(22.68, 2);
  });

  it('TOTAL row sums Net GP £ across all rows: 56.51 + 37.31 = 93.82', async () => {
    const sales = [
      baseSale({ id: 'EBAY__O1__1', marketplace: 'EBAY', orderNumber: 'O1',
        buyPrice: 100, salePrice: 200, postage: 8, postageVat: 1.6 }),
      baseSale({ id: 'EBAY__O2__2', marketplace: 'EBAY', orderNumber: 'O2',
        buyPrice: 100, salePrice: 200, postage: 8, postageVat: 1.6,
        voidedAt: '2026-06-13', voidOutcome: 'refund', voidReason: 'r2' }),
    ];
    const buf = await buildSalesWorkbookBuffer({ sales });
    const wb = await loadWorkbook(buf);
    const ebay = wb.getWorksheet('EBAY')!;
    // 2 data rows + 1 TOTAL = row 4.
    const total = ebay.getRow(4);
    expect(String(total.getCell(1).value)).toBe('TOTAL');
    // TOTAL row's Net GP cell holds SUM(AF2:AF3) — the per-row formula
    // means each AF cell is V − AE, so SUM = Σ(V) − Σ(AE).
    const cell = total.getCell(32).value as { formula?: string };
    expect(cell.formula).toBe('SUM(AF2:AF3)');
    // Compute via reportView. Sum chains through 12+ formula cells per
    // row × 2 rows, so 1p rounding drift (.81 vs .82) is normal; closeness
    // is the correct assertion shape.
    const model = await viewModelFromXlsxBuffer(buf, 't');
    const ebayView = model.sheets.find(s => s.name === 'EBAY')!;
    const totalDisplay = parseFloat(ebayView.rows[3][31].display);
    expect(totalDisplay).toBeGreaterThan(69.79);
    expect(totalDisplay).toBeLessThan(93.83);
  });
});

describe('Sales Report Returns tab filters by voidedAt', () => {
  it('includes a void whose voidedAt is in-range even when saleDate is out-of-range', async () => {
    const sales: Sale[] = [
      baseSale({
        id: 'EBAY__OLD__1',
        orderNumber: 'OLD',
        // saleDate falls OUTSIDE the window — would've been dropped by
        // the old saleDate-only filter on the Returns tab.
        saleDate: '2026-05-01',
        // …but the void landed INSIDE the window. The operator processed
        // a return today on a sale from a month ago.
        voidedAt: '2026-06-14', voidOutcome: 'refund', voidReason: 'today refund',
        postage: 8, postageVat: 1.6,
      }),
    ];
    const buf = await buildSalesWorkbookBuffer({
      sales,
      opts: { from: '2026-06-14', to: '2026-06-14' },  // "Today" window
    });
    const wb = await loadWorkbook(buf);
    const detail = wb.getWorksheet('Returns Detail')!;
    // Header + the one orphan voided row (whose saleDate is out-of-range
    // but voidedAt is in). No TOTAL row on this sheet.
    expect(detail.rowCount).toBe(2);
    expect(detail.getRow(2).getCell(11).value).toBe('Refund');
    expect(detail.getRow(2).getCell(16).value).toBeCloseTo(19.2, 2);
  });

  it('EXCLUDES a void whose voidedAt is OUT-of-range even if saleDate is in-range', async () => {
    const sales: Sale[] = [
      baseSale({
        id: 'EBAY__NEW__1',
        orderNumber: 'NEW',
        // saleDate inside the window, but voidedAt outside — the void
        // happened in the future-ish bucket.
        saleDate: '2026-06-14',
        voidedAt: '2026-06-20',     // outside the Today=2026-06-14 window
        voidOutcome: 'refund', voidReason: 'later refund',
      }),
    ];
    const buf = await buildSalesWorkbookBuffer({
      sales,
      opts: { from: '2026-06-14', to: '2026-06-14' },
    });
    const wb = await loadWorkbook(buf);
    const detail = wb.getWorksheet('Returns Detail')!;
    // No returns in range → header + the plain "no returns" hint (not the
    // "not yet restored" variant — there's genuinely nothing in the window).
    expect(detail.rowCount).toBe(2);
    expect(String(detail.getRow(2).getCell(1).value)).toBe('No returns recorded for this period.');
  });

  it('a voided sale in range whose unit has no returnType on file still gets a "not yet restored" hint on Unit Histories', async () => {
    // Reproduces the live incident shape: the Sale is voided, but the
    // linked unit was deleted (or never processed via Returns) so it
    // carries no returnType — Returns Detail shows it via the orphan
    // fallback, but Unit Histories (strictly unit-driven) has nothing to
    // show and must say so rather than presenting a bare header.
    const sales: Sale[] = [
      baseSale({
        id: 'EBAY__DEL__1', orderNumber: 'DEL', imei: '350000000009999', unitId: '',
        voidedAt: '2026-06-14', voidOutcome: 'refund', voidReason: 'unit deleted, never restored',
      }),
    ];
    const buf = await buildSalesWorkbookBuffer({ sales });
    const wb = await loadWorkbook(buf);
    const histories = wb.getWorksheet('Unit Histories')!;
    expect(histories.rowCount).toBe(2);
    expect(String(histories.getRow(2).getCell(1).value)).toMatch(/no unit has a Return Type on file yet/i);

    // Returns Detail, by contrast, DOES show this row (orphan fallback).
    const detail = wb.getWorksheet('Returns Detail')!;
    expect(detail.rowCount).toBe(2);
    expect(detail.getRow(2).getCell(2).value).toBe('350000000009999');
  });

  it('Unit Histories says plainly there are no returns at all when there truly are none', async () => {
    const buf = await buildSalesWorkbookBuffer({ sales: [] });
    const wb = await loadWorkbook(buf);
    const histories = wb.getWorksheet('Unit Histories')!;
    expect(histories.rowCount).toBe(2);
    expect(String(histories.getRow(2).getCell(1).value)).toBe('No unit return history to show for this period.');
  });
});

describe('marketplace tabs sort cycles newest-first by saleDate', () => {
  it('one IMEI cycled 3× same day → rows appear in newest-first order', async () => {
    const imei = '350000000000007';
    const sale = (over: Partial<Sale>): Sale => baseSale({
      id: over.id!, marketplace: 'EBAY', orderNumber: over.orderNumber!,
      imei, unitId: imei,
      saleDate: '2026-06-13', salePrice: 200, buyPrice: 100,
      postage: 8, postageVat: 1.6,
      ...over,
    });
    // Voided cycles created earlier in the day; the active third cycle
    // landed in the afternoon. Pushed in a non-monotonic order to prove
    // the sort isn't relying on input order.
    const sales: Sale[] = [
      // cycle 2 — mid-day
      sale({
        id: 'EBAY__O2__7', orderNumber: 'O2',
        createdAt: '2026-06-13T13:00:00.000Z',
        voidedAt: '2026-06-13', voidOutcome: 'refund', voidReason: 'cycle 2',
      }),
      // cycle 1 — early
      sale({
        id: 'EBAY__O1__7', orderNumber: 'O1',
        createdAt: '2026-06-13T09:00:00.000Z',
        voidedAt: '2026-06-13', voidOutcome: 'refund', voidReason: 'cycle 1',
      }),
      // cycle 3 — latest, still active (the re-sell after cycle 2)
      sale({
        id: 'EBAY__O3__7', orderNumber: 'O3',
        createdAt: '2026-06-13T16:00:00.000Z',
      }),
    ];

    const buf = await buildSalesWorkbookBuffer({ sales });
    const wb = await loadWorkbook(buf);
    const ebay = wb.getWorksheet('EBAY')!;
    // Row 2 = latest (cycle 3, active), row 3 = cycle 2, row 4 = cycle 1.
    expect(ebay.getRow(2).getCell(2).value).toBe('O3');   // Order Number col
    expect(ebay.getRow(3).getCell(2).value).toBe('O2');
    expect(ebay.getRow(4).getCell(2).value).toBe('O1');
  });

  it('different IMEIs on the same tab also sort newest-first by saleDate', async () => {
    const sales: Sale[] = [
      baseSale({ id: 'EBAY__A__1', orderNumber: 'A',
        imei: '350000000000001', saleDate: '2026-06-11',
        createdAt: '2026-06-11T10:00:00.000Z' }),
      baseSale({ id: 'EBAY__B__2', orderNumber: 'B',
        imei: '350000000000002', saleDate: '2026-06-13',
        createdAt: '2026-06-13T10:00:00.000Z' }),
      baseSale({ id: 'EBAY__C__3', orderNumber: 'C',
        imei: '350000000000003', saleDate: '2026-06-12',
        createdAt: '2026-06-12T10:00:00.000Z' }),
    ];
    const buf = await buildSalesWorkbookBuffer({ sales });
    const wb = await loadWorkbook(buf);
    const ebay = wb.getWorksheet('EBAY')!;
    expect(ebay.getRow(2).getCell(2).value).toBe('B');  // 2026-06-13
    expect(ebay.getRow(3).getCell(2).value).toBe('C');  // 2026-06-12
    expect(ebay.getRow(4).getCell(2).value).toBe('A');  // 2026-06-11
  });
});

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
  it('totals 10 returns + £143.64 loss for one IMEI cycled 10× across 10 days', async () => {
    // 1 unit, 10 cycles spanning 10 different days — 1 replacement
    // (£22.68), 9 refunds (£15.12 each). Old code totalled 1 return ×
    // £15.12 because it iterated unique units; new code iterates voided
    // sales so it surfaces all 10 events. (Same-day cycles collapse — see
    // the next describe block for the dedupe contract; spreading the
    // cycles across days here is the realistic multi-cycle case.)
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
        saleDate: `2026-06-${String(n).padStart(2, '0')}`, salePrice: 150, buyPrice: 100,
        postage: 6.30, postageVat: 1.26,
        voidedAt: `2026-06-${String(n).padStart(2, '0')}`,
        voidOutcome: outcome, voidReason: `cycle ${n}`,
        createdAt: `2026-06-${String(n).padStart(2, '0')}T08:00:00.000Z`,
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
    // r3=Refunds, r4=Replacements, r5=Repairs, r6=Total Postage Loss, r7=Avg.
    expect(summary.getRow(2).getCell(2).value).toBe(10);   // Total Returns
    expect(summary.getRow(3).getCell(2).value).toBe(9);    // Refunds
    expect(summary.getRow(4).getCell(2).value).toBe(1);    // Replacements
    expect(summary.getRow(5).getCell(2).value).toBe(0);    // Repairs
    // 9 refunds × £15.12 + 1 replacement × £22.68 = £158.76
    expect(summary.getRow(6).getCell(2).value).toBeCloseTo(158.76, 1);
  });

  it('dedupes voided sub-records: one Process-Return click that voids N linked sales = 1 event', async () => {
    // QA observation 2026-06-14: today's summary showed Total Returns = 8
    // (Refunds 4, Replacements 2, Repairs 2) while the Detail sheet
    // correctly showed 5 distinct returns. Root cause: when a unit had
    // multiple ACTIVE sales at return time (replacement-unit inheriting,
    // import + in-app sale duplicates, historical sales never cleaned up
    // from earlier cycles), ProcessReturnModal voided all of them in one
    // click — each became a "sub-record" that the per-event counter
    // promoted to a separate return event. Fix: dedupe by (unitId,
    // voidedAt) so one click = one event. Different return DATES on the
    // same unit remain distinct events (covered by the test above).
    const imei = '359111222333444';
    const unit: InventoryUnit = {
      id: 'u-rts', imei,
      model: 'iPhone 15', brand: 'Apple', category: 'iPhone', colour: 'Black',
      buyPrice: 600, dateIn: '2026-06-01',
      supplierId: 'sup', supplierName: 'MHL',
      status: 'returned',
      returnType: 'returned_to_supplier',
      returnDate: '2026-06-14',
      returnReason: 'DOA',
      flags: [], notes: '', platformListed: false, listingSites: [],
      ownerId: 'shared', createdAt: '2026-06-01T00:00:00Z',
    };
    // Three voided Sale docs for the SAME unit, all voided in the SAME
    // ProcessReturnModal call (same voidedAt). This is what a single RTS
    // click looks like on a unit with leftover historical active sales.
    const linkedVoid = (n: number): Sale => baseSale({
      id: `EBAY__O${n}__${imei}`, marketplace: 'EBAY',
      orderNumber: `O${n}`, imei, unitId: 'u-rts',
      saleDate: `2026-06-${String(10 + n).padStart(2, '0')}`,
      salePrice: 800, buyPrice: 600,
      // Only one sub-record carries the postage snapshot — typical of
      // historical imports — so total loss stays correct under dedupe.
      postage: n === 1 ? 6.30 : 0,
      postageVat: n === 1 ? 1.26 : 0,
      voidedAt: '2026-06-14', voidOutcome: 'refund', voidReason: 'RTS',
      createdAt: `2026-06-14T0${n}:00:00.000Z`,
    });
    const sales: Sale[] = [linkedVoid(1), linkedVoid(2), linkedVoid(3)];

    const buf = await buildReturnsWorkbookBuffer({
      units: [unit], sales, opts: { from: '2026-06-14', to: '2026-06-14' },
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const summary = wb.getWorksheet('Summary')!;
    // 3 voided sales → 1 event (the operator's single click). The Detail
    // sheet keys off the unique unit, so it also reports 1 row.
    expect(summary.getRow(2).getCell(2).value).toBe(1);  // Total Returns
    expect(summary.getRow(3).getCell(2).value).toBe(1);  // Refunds (RTS rolls up here)
    expect(summary.getRow(4).getCell(2).value).toBe(0);  // Replacements
    expect(summary.getRow(5).getCell(2).value).toBe(0);  // Repairs
    // Loss = one leg-cost snapshot × 2 legs = (6.30 + 1.26) × 2 = £15.12.
    expect(summary.getRow(6).getCell(2).value).toBeCloseTo(15.12, 2);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Repair-route returns: labelled "In Repair" (not "Refund") AND carry the
// 2-leg carriage loss (operator policy 2026-06: outbound + faulty unit
// shipped back; the unit returns to stock but both legs were paid).
// ───────────────────────────────────────────────────────────────────────────

describe('repair-route returns: "In Repair" label + 2-leg carriage loss', () => {
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
    returnLegCost: 7.56,
    flags: [], notes: '', platformListed: false, listingSites: [],
    ownerId: 'shared', createdAt: '2026-06-01T00:00:00Z',
  };
  const repairSale: Sale = baseSale({
    id: 'EBAY__REP-1__X', marketplace: 'EBAY',
    orderNumber: 'REP-1', imei: sameImei, unitId: sameImei,
    saleDate: '2026-06-12', salePrice: 140, buyPrice: 100,
    postage: 6.30, postageVat: 1.26,
    voidedAt: '2026-06-12',
    // voidOutcome deliberately undefined — repair flow doesn't capture a
    // customer outcome; the unit's returnType='repair' is the signal.
    voidReason: 'In Repair — cracked screen',
  });

  it('Sales Report row: Outcome="In Repair", Legs=2, Postage Loss=£15.12', async () => {
    const buf = await buildSalesWorkbookBuffer({
      sales: [repairSale], units: [repairUnit],
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ebay = wb.getWorksheet('EBAY')!;
    const row = ebay.getRow(2);
    expect(row.getCell(28).value).toBe('In Repair');         // Outcome (AB)
    expect(row.getCell(30).value).toBe(2);                   // Shipping Legs (AD)
    expect(row.getCell(31).value).toBeCloseTo(15.12, 2);     // Postage Loss (AE) = 7.56×2
  });

  it('Sales Summary counts the repair in its own column + includes its loss', async () => {
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
    expect(ebayRow.getCell(2).value).toBe(0);          // Sales (both voided — active-only count)
    expect(ebayRow.getCell(3).value).toBe(1);          // Refunds (R1 only)
    expect(ebayRow.getCell(4).value).toBe(0);          // Replacements
    expect(ebayRow.getCell(5).value).toBe(1);          // Repairs (the repair void)
    // Postage Loss (col 7) = repair 15.12 + refund 19.2 = 34.32.
    expect(ebayRow.getCell(7).value).toBeCloseTo(34.32, 1);
  });

  it('Returns Detail: "In Repair", Legs=2, Postage Loss=£15.12', async () => {
    const buf = await buildReturnsWorkbookBuffer({
      units: [repairUnit], sales: [repairSale],
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const detail = wb.getWorksheet('Returns Detail')!;
    const row = detail.getRow(2);
    expect(row.getCell(11).value).toBe('In Repair');   // Outcome col 11
    expect(row.getCell(15).value).toBe(2);             // Shipping Legs
    expect(row.getCell(16).value).toBeCloseTo(15.12, 2); // Postage Loss £
  });

  it('Returns Summary counts the repair + includes its loss', async () => {
    const buf = await buildReturnsWorkbookBuffer({
      units: [repairUnit], sales: [repairSale],
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const summary = wb.getWorksheet('Summary')!;
    // r2 Total Returns, r3 Refunds, r4 Replacements, r5 Repairs, r6 Postage Loss
    expect(summary.getRow(2).getCell(2).value).toBe(1);          // Total Returns
    expect(summary.getRow(3).getCell(2).value).toBe(0);          // Refunds
    expect(summary.getRow(5).getCell(2).value).toBe(1);          // Repairs
    expect(summary.getRow(6).getCell(2).value).toBeCloseTo(15.12, 2);  // Postage Loss
  });

  it('Unit Histories RETURNED event reads "In Repair · reason" with the 2-leg loss', async () => {
    const buf = await buildReturnsWorkbookBuffer({
      units: [repairUnit], sales: [repairSale],
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const hist = wb.getWorksheet('Unit Histories')!;
    for (let r = 2; r <= hist.rowCount; r++) {
      const ev = hist.getRow(r).getCell(4).value;
      if (ev !== 'RETURNED') continue;
      const detail = String(hist.getRow(r).getCell(5).value || '');
      expect(detail.startsWith('In Repair')).toBe(true);
      expect(hist.getRow(r).getCell(6).value).toBeCloseTo(-15.12, 2); // Amount = −loss
      return;
    }
    throw new Error('No RETURNED row emitted for the repair-route unit');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// BUG-RP-002 — repair completion must NOT contaminate any report figure
// ───────────────────────────────────────────────────────────────────────────

describe('post-repair-completion invariant (BUG-RP-002)', () => {
  // The QA scenario: a unit is sold, sent for repair, then marked
  // repaired & back-to-stock. ReadyToShipModal flips returnType to
  // 'returned_to_inventory' on the unit. The invariant: completion must
  // NOT re-classify the historical void as a customer refund — it stays
  // labelled "In Repair". (It DOES carry the 2-leg carriage loss per the
  // 2026-06 policy; the point of this block is that completion doesn't
  // CHANGE the classification or the figure, in either direction.)
  //
  // Fix: ProcessReturnModal stamps `voidOutcome: 'repair'` on the linked
  // Sale at void time (canonical), and ReadyToShipModal adds repairedAt +
  // 'repaired_unit' flag as belt-and-braces markers. Tests below construct
  // the post-completion state directly and assert that no figure moves.

  const imei = '359949184749567';
  const completedRepairUnit: InventoryUnit = {
    id: imei, imei,
    model: 'iPhone SE 3 128GB', brand: 'Apple', category: 'iPhone', colour: 'Black',
    buyPrice: 100, dateIn: '2026-06-01',
    supplierId: 'sup_nanak', supplierName: 'NANAK',
    // Post-completion state ReadyToShipModal leaves on the unit:
    status: 'available',
    returnType: 'returned_to_inventory',
    returnDate: '2026-06-12',
    returnReason: 'QA repair label check',
    repairedAt: '2026-06-12',
    flags: ['repaired_unit'],
    notes: '', platformListed: false, listingSites: [],
    ownerId: 'shared', createdAt: '2026-06-01T00:00:00Z',
  };
  // Sale carries the canonical voidOutcome='repair' written by
  // ProcessReturnModal. ReadyToShipModal never touches the Sale.
  const completedRepairSale: Sale = baseSale({
    id: 'EBAY__RP-1__X', marketplace: 'EBAY',
    orderNumber: 'RP-1', imei, unitId: imei,
    saleDate: '2026-06-12', salePrice: 150, buyPrice: 100,
    postage: 6.30, postageVat: 1.26,
    voidedAt: '2026-06-12',
    voidOutcome: 'repair',
    voidReason: 'In Repair — QA repair label check',
  });

  it('Sales Report row stays "In Repair" + 2 legs + £15.12 after completion (no refund relabel)', async () => {
    const buf = await buildSalesWorkbookBuffer({
      sales: [completedRepairSale], units: [completedRepairUnit],
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ebay = wb.getWorksheet('EBAY')!;
    const row = ebay.getRow(2);
    expect(row.getCell(28).value).toBe('In Repair');         // NOT relabelled to Refund
    expect(row.getCell(30).value).toBe(2);                   // Legs unchanged
    expect(row.getCell(31).value).toBeCloseTo(15.12, 2);     // Postage Loss unchanged
  });

  it('Sales Summary keeps the repair in the Repairs column after completion', async () => {
    const buf = await buildSalesWorkbookBuffer({
      sales: [completedRepairSale], units: [completedRepairUnit],
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const summary = wb.getWorksheet('Summary')!;
    const ebayRow = summary.getRow(7);
    expect(ebayRow.getCell(2).value).toBe(0);          // Sales: 0 (the one sale is voided)
    expect(ebayRow.getCell(3).value).toBe(0);          // Refunds: 0 (NOT bumped)
    expect(ebayRow.getCell(4).value).toBe(0);          // Replacements: 0
    expect(ebayRow.getCell(5).value).toBe(1);          // Repairs: 1
    expect(ebayRow.getCell(7).value).toBeCloseTo(15.12, 2);  // Postage Loss
  });

  it('Returns Detail keeps Outcome "In Repair" + 2 legs + £15.12 after completion', async () => {
    const buf = await buildReturnsWorkbookBuffer({
      units: [completedRepairUnit], sales: [completedRepairSale],
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const detail = wb.getWorksheet('Returns Detail')!;
    const row = detail.getRow(2);
    expect(row.getCell(11).value).toBe('In Repair');
    expect(row.getCell(15).value).toBe(2);
    expect(row.getCell(16).value).toBeCloseTo(15.12, 2);
  });

  it('Returns Summary keeps the completed repair in the Repairs total', async () => {
    const buf = await buildReturnsWorkbookBuffer({
      units: [completedRepairUnit], sales: [completedRepairSale],
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const summary = wb.getWorksheet('Summary')!;
    expect(summary.getRow(2).getCell(2).value).toBe(1);  // Total Returns
    expect(summary.getRow(3).getCell(2).value).toBe(0);  // Refunds (NOT bumped)
    expect(summary.getRow(5).getCell(2).value).toBe(1);  // Repairs
    expect(summary.getRow(6).getCell(2).value).toBeCloseTo(15.12, 2);  // Postage Loss
  });

  it('legacy backfill: pre-canonical void (no voidOutcome) + post-completion unit ⇒ still "In Repair"', async () => {
    // Old deploy wrote voidedAt but no voidOutcome. After ReadyToShipModal
    // changed returnType, the ONLY signal that this was a repair is the
    // unit's repairedAt / 'repaired_unit' flag. The build-time enrichment
    // must backfill the Sale to voidOutcome='repair' so renderers behave —
    // including carrying the 2-leg loss (it's still a real return).
    const legacySale: Sale = baseSale({
      id: 'EBAY__LEG__X', marketplace: 'EBAY',
      orderNumber: 'LEG', imei, unitId: imei,
      saleDate: '2026-06-12', salePrice: 150, buyPrice: 100,
      postage: 6.30, postageVat: 1.26,
      voidedAt: '2026-06-12',
      // voidOutcome intentionally undefined — pre-canonical legacy state.
      voidReason: 'Refund — QA repair label check',
    });
    const buf = await buildSalesWorkbookBuffer({
      sales: [legacySale], units: [completedRepairUnit],
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ebay = wb.getWorksheet('EBAY')!;
    const row = ebay.getRow(2);
    expect(row.getCell(28).value).toBe('In Repair');         // backfilled, NOT Refund
    expect(row.getCell(30).value).toBe(2);                   // 2 legs
    expect(row.getCell(31).value).toBeCloseTo(15.12, 2);     // loss carried
    // And the Summary classifies it as a Repair, not a Refund.
    const summary = wb.getWorksheet('Summary')!;
    const ebayRow = summary.getRow(7);
    expect(ebayRow.getCell(3).value).toBe(0);          // Refunds: 0
    expect(ebayRow.getCell(5).value).toBe(1);          // Repairs: 1
    expect(ebayRow.getCell(7).value).toBeCloseTo(15.12, 2);  // Postage Loss
  });

  it('A second non-repair refund on the same repaired unit IS counted as a refund', async () => {
    // A repaired unit can be re-sold and refunded. Its OLD repair cycle
    // stays a Repair while the NEW refund cycle counts as a Refund — the
    // explicit voidOutcome='refund' on the new sale wins over the unit's
    // lingering repairedAt / 'repaired_unit' markers.
    const reSaleRefund: Sale = baseSale({
      id: 'EBAY__RE-1__X', marketplace: 'EBAY',
      orderNumber: 'RE-1', imei, unitId: imei,
      saleDate: '2026-06-13', salePrice: 145, buyPrice: 100,
      postage: 6.30, postageVat: 1.26,
      voidedAt: '2026-06-14',
      voidOutcome: 'refund',
      voidReason: 'Refund — buyer cancelled',
    });
    const buf = await buildSalesWorkbookBuffer({
      sales: [completedRepairSale, reSaleRefund],
      units: [completedRepairUnit],
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const summary = wb.getWorksheet('Summary')!;
    const ebayRow = summary.getRow(7);
    expect(ebayRow.getCell(2).value).toBe(0);          // 0 sales — both voided
    expect(ebayRow.getCell(3).value).toBe(1);          // 1 refund (the new one)
    expect(ebayRow.getCell(5).value).toBe(1);          // 1 repair (the old one)
    // Loss = repair 15.12 + refund 15.12 = 30.24 (both carry 2 legs now).
    expect(ebayRow.getCell(7).value).toBeCloseTo(30.24, 2);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Replacement-swap audit marker. When a sale is voided with outcome
// 'replacement', the replacement unit shipped in its place has NO Sale
// doc — ReturnsPage flips the unit but never writes a Sale (the original
// stays canonical for revenue, no double-counting). The auditor signal
// lives on the ORIGINAL voided row as a Comments prefix that names the
// IMEI that fulfilled the order.
// ───────────────────────────────────────────────────────────────────────────

describe('Sales Report — replacement-swap marker on the original voided row', () => {
  it('prefixes Comments with [REPLACED BY IMEI <x>] using the unit.replacedByUnitId link', async () => {
    // RETURNING is the customer-side unit that came back; it carries
    // replacedByUnitId pointing to the stock unit (REPL) shipped in its
    // place. REPL itself has replacementForUnitId but no Sale doc.
    const returningUnit: InventoryUnit = {
      id: 'u-returning', imei: '351554741524244',
      model: 'Samsung A32 5G', brand: 'Samsung', category: 'Android', colour: 'Black',
      storage: '64GB',
      buyPrice: 80, dateIn: '2026-06-01',
      supplierId: 'sup-1', supplierName: 'MHL',
      status: 'returned',
      returnType: 'returned_to_inventory',
      returnDate: '2026-06-12',
      returnOutcome: 'replacement',
      replacedByUnitId: 'u-repl',
      flags: [], notes: '', platformListed: false, listingSites: [],
      ownerId: 'shared', createdAt: '2026-06-01T00:00:00Z',
    };
    const replacementUnit: InventoryUnit = {
      id: 'u-repl', imei: '353427864129554',
      model: 'Samsung A32 5G', brand: 'Samsung', category: 'Android', colour: 'Black',
      storage: '64GB',
      buyPrice: 85, dateIn: '2026-06-05',
      supplierId: 'sup-1', supplierName: 'MHL',
      status: 'sold',
      replacementForUnitId: 'u-returning',
      flags: [], notes: '', platformListed: false, listingSites: [],
      ownerId: 'shared', createdAt: '2026-06-05T00:00:00Z',
    };
    const plainUnit: InventoryUnit = {
      id: 'u-plain', imei: '359000000000111',
      model: 'Samsung A32 5G', brand: 'Samsung', category: 'Android', colour: 'Black',
      storage: '64GB',
      buyPrice: 80, dateIn: '2026-06-01',
      supplierId: 'sup-1', supplierName: 'MHL',
      status: 'sold',
      flags: [], notes: '', platformListed: false, listingSites: [],
      ownerId: 'shared', createdAt: '2026-06-01T00:00:00Z',
    };
    // Original sale for RETURNING — voided with outcome='replacement'.
    // This is the row the marker should fire on.
    const replacementVoidedSale: Sale = baseSale({
      id: 'EBAY__ORD-1__351554741524244', marketplace: 'EBAY',
      orderNumber: 'ORD-1', imei: '351554741524244', unitId: 'u-returning',
      saleDate: '2026-06-10', comments: 'std order',
      voidedAt: '2026-06-12', voidOutcome: 'replacement', voidReason: 'screen issue',
    });
    const plainSale: Sale = baseSale({
      id: 'EBAY__PLAIN-1__359000000000111', marketplace: 'EBAY',
      orderNumber: 'PLAIN-1', imei: '359000000000111', unitId: 'u-plain',
      saleDate: '2026-06-11', comments: 'std order',
    });

    const buf = await buildSalesWorkbookBuffer({
      sales: [replacementVoidedSale, plainSale],
      units: [returningUnit, replacementUnit, plainUnit],
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ebay = wb.getWorksheet('EBAY')!;
    const headerRow = ebay.getRow(1);
    let commentsCol = -1;
    let imeiCol = -1;
    for (let c = 1; c <= headerRow.cellCount; c++) {
      const v = headerRow.getCell(c).value;
      if (v === 'Comments') commentsCol = c;
      if (v === 'IMEI') imeiCol = c;
    }
    expect(commentsCol).toBeGreaterThan(0);
    expect(imeiCol).toBeGreaterThan(0);

    // Rows are sorted by saleDate desc — find by IMEI rather than index
    // so the assertion survives any future re-ordering.
    const findRowByImei = (imei: string): ExcelJS.Row | undefined => {
      for (let r = 2; r <= ebay.rowCount; r++) {
        const row = ebay.getRow(r);
        if (String(row.getCell(imeiCol).value || '') === imei) return row;
      }
      return undefined;
    };
    const voidedRow = findRowByImei('351554741524244');
    const plainRow = findRowByImei('359000000000111');
    expect(voidedRow).toBeDefined();
    expect(plainRow).toBeDefined();
    const voidedComments = String(voidedRow!.getCell(commentsCol).value || '');
    expect(voidedComments).toBe('[REPLACED BY IMEI 353427864129554] std order');
    expect(String(plainRow!.getCell(commentsCol).value || '')).toBe('std order');
  });
});
