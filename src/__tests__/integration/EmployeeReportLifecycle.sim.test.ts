/**
 * EmployeeReportLifecycle.sim — a simulated operator session, end to end.
 *
 * Drives ONE dataset through the sequence a real employee follows after
 * login, with the priority the operator asked for: uploading a report to
 * reconcile inventory / SHS / returns / replacements.
 *
 *   Act 1  Login — what an employee (non-admin) can actually reach
 *   Act 2  Upload a Sales Report — real .xlsx through the real parser
 *   Act 3  Confirm the import — reconcile sales against inventory + SHS
 *   Act 4  Returns, replacement and repair on top of imported sales
 *   Act 5  Re-upload the SAME report — idempotency of the whole chain
 *
 * Assertions record CURRENT behaviour. Where current behaviour looks
 * wrong, the test asserts what actually happens and the comment names
 * the defect, so the suite stays green while the report below (and the
 * chat summary) carries the finding. Tests that silently encode a bug
 * without saying so are how bugs become "expected behaviour".
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import * as XLSX from 'xlsx';
import type { InventoryUnit, Sale } from '../../types';

// ── Mocks ────────────────────────────────────────────────────────────────────
const session = vi.hoisted(() => ({
  // Swapped between acts to simulate employee vs admin.
  currentUser: { email: 'ops1@inventorymanager.com', uid: 'emp-1' } as { email: string; uid: string } | null,
}));

vi.mock('firebase/firestore', async () => {
  const { firestoreMock } = await import('../mocks/memoryDb');
  return firestoreMock;
});

vi.mock('../../lib/firebase', async () => {
  const ADMIN_EMAILS = new Set(['admin@inventorymanager.com', 'sumanthbolla97@gmail.com', 'sai@inventorymanager.com']);
  return {
    db: { app: { name: '[DEFAULT]' } },
    auth: { get currentUser() { return session.currentUser; } },
    isAdmin: (u: any) => !!u?.email && ADMIN_EMAILS.has(String(u.email).toLowerCase().trim()),
  };
});

vi.mock('../../lib/dbService', async () => {
  const { memoryDbService } = await import('../mocks/memoryDb');
  return { dbService: memoryDbService };
});

vi.mock('../../lib/inventoryEvents', () => ({ logInventoryEvent: vi.fn(async () => {}) }));

import { all, clearStore, col, seed } from '../mocks/memoryDb';
import { parseSalesWorkbook, type ParsedSales } from '../../lib/salesImport';
import { buildPostImportSyncPatches } from '../../services/salesService';
import { processReturn } from '../../services/returnsService';
import { buildPreview } from '../../components/SalesReportImport';
import { isOpenReturnUnit, returnUnits, returnCounts } from '../../lib/returnsLedger';
import { isOfficeStockUnit, isShsUnit } from '../../lib/wipeScopes';

// ── Fixture: inventory as it stands before the operator uploads ──────────────
const IMEI_OFFICE_A = '350000000000001';
const IMEI_OFFICE_B = '350000000000002';
const IMEI_SHS      = '350000000000003';
const IMEI_ORPHAN   = '350000000000009';   // sold on the report, never in stock
const IMEI_SPARE    = '350000000000004';   // replacement donor

function makeUnit(over: Partial<InventoryUnit>): InventoryUnit {
  return {
    id: over.imei || over.id || 'u',
    model: 'IPHONE 12',
    storage: '64GB',
    colour: 'BLACK',
    status: 'available',
    buyPrice: 200,
    dateIn: '2026-06-01',
    flags: [],
    platformListed: false,
    ownerId: 'shared',
    createdAt: '2026-06-01',
    ...over,
  } as InventoryUnit;
}

function seedInventory() {
  seed('inventoryUnits', [
    makeUnit({ id: 'u-office-a', imei: IMEI_OFFICE_A }),
    makeUnit({ id: 'u-office-b', imei: IMEI_OFFICE_B }),
    makeUnit({ id: 'u-shs', imei: IMEI_SHS, status: 'incoming', stockSource: 'shs' }),
    makeUnit({ id: 'u-spare', imei: IMEI_SPARE }),
  ]);
}

// ── Fixture: the operator's Sales Report workbook ────────────────────────────
const AMAZON_HEADERS = [
  'nw', 'Order Number', 'SKU', 'IMEI', 'Supplier', 'Quantity',
  'BP', 'SP', 'SP-BP', 'Marginal Tax', 'Commission', 'Postage',
  'GP', 'GP %', 'Comments',
];

/** row helper — positional, matching AMAZON_HEADERS above. */
function amazonRow(o: {
  date: string; order: string; sku: string; imei: string;
  supplier?: string; qty?: number; bp: number; sp: number; postage?: number;
}) {
  return [
    o.date, o.order, o.sku, o.imei, o.supplier ?? 'SUPPLIER ONE', o.qty ?? 1,
    o.bp, o.sp, o.sp - o.bp, '', '', o.postage ?? 8, '', '', '',
  ];
}

function buildSalesWorkbookFile(): File {
  const rows = [
    AMAZON_HEADERS,
    amazonRow({ date: '2026-07-02', order: 'AMZ-1001', sku: 'IP12-64-BLK', imei: IMEI_OFFICE_A, bp: 200, sp: 320 }),
    amazonRow({ date: '2026-07-03', order: 'AMZ-1002', sku: 'IP12-64-BLK', imei: IMEI_OFFICE_B, bp: 200, sp: 330 }),
    // SHS unit: supplier shipped it, so the sale fulfils the incoming unit
    amazonRow({ date: '2026-07-04', order: 'AMZ-1003', sku: 'IP12-64-BLK', imei: IMEI_SHS, bp: 210, sp: 340 }),
    // Orphan: sold but never tracked in our inventory
    amazonRow({ date: '2026-07-05', order: 'AMZ-1004', sku: 'IP12-64-BLK', imei: IMEI_ORPHAN, bp: 205, sp: 335 }),
    // Exact duplicate of row 2 — operator pasted the same order twice
    amazonRow({ date: '2026-07-02', order: 'AMZ-1001', sku: 'IP12-64-BLK', imei: IMEI_OFFICE_A, bp: 200, sp: 320 }),
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'AMAZON');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new File([buf], 'SALES_REPORT_2026.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

/** Replays SalesReportImport.handleConfirm's write sequence. */
async function commitImport(parsed: ParsedSales) {
  const { dbService } = await import('../../lib/dbService');
  const units = all<InventoryUnit>('inventoryUnits');
  const sales = all<Sale>('sales');
  const preview = buildPreview(parsed, sales, units);

  await dbService.bulkCreate(
    [...preview.toCreate, ...preview.toUpdate].map(s => ({
      collection: 'sales',
      id: s.id,
      data: { ...s, importBatchId: 'batch-1', sourceFile: 'SALES_REPORT_2026.xlsx', ownerId: 'shared' },
    })),
  );

  // Post-import sync — mirrors the component: parsed rows merged OVER
  // their stored docs so void state survives the round trip.
  const storedById = new Map(sales.map(s => [s.id, s]));
  const allImported = [...preview.toCreate, ...preview.toUpdate]
    .map(s => ({ ...(storedById.get(s.id) ?? {}), ...s }) as Sale);
  const { unitPatches, salePatches } = buildPostImportSyncPatches(
    allImported,
    all<InventoryUnit>('inventoryUnits'),
  );
  if (unitPatches.length || salePatches.length) {
    await dbService.bulkCreate([...unitPatches, ...salePatches] as any);
  }
  return { preview, unitPatches, salePatches };
}

let workbook: File;
let parsed: ParsedSales;

beforeAll(async () => {
  workbook = buildSalesWorkbookFile();
});

beforeEach(async () => {
  clearStore();
  seedInventory();
  session.currentUser = { email: 'ops1@inventorymanager.com', uid: 'emp-1' };
  parsed = await parseSalesWorkbook(workbook, 'SALES_REPORT_2026.xlsx');
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Act 1 · employee signs in', () => {
  it('is not admin, so every admin-gated service call is refused', async () => {
    const { isAdmin, auth } = await import('../../lib/firebase');
    expect(isAdmin(auth.currentUser)).toBe(false);

    const { adminUpdateUnit, deleteOfficeUnit } = await import('../../services/inventoryService');
    const unit = col('inventoryUnits')['u-office-a'] as InventoryUnit;

    expect((await adminUpdateUnit(unit, { buyPrice: 1 })).message).toMatch(/admin access required/i);
    expect((await deleteOfficeUnit(unit, 'test')).message).toMatch(/admin access required/i);
  });

  it('FINDING: the Import entry point is hidden from EVERYONE, admins included', async () => {
    const { readFileSync } = await import('node:fs');
    const app = readFileSync('src/App.tsx', 'utf8');
    // This finding used to read "Import is admin-only, so an employee cannot
    // upload any report". It's now stronger: after the 2026-08 migration
    // completed, the operator took Import out of the UI entirely — admins
    // included — so an accidental re-import can't land on a database that is
    // known correct. Both report uploads still hang off the one header
    // button, now behind SHOW_IMPORT_UI as well as userIsAdmin.
    const importBlock = app.slice(app.indexOf('{SHOW_IMPORT_UI && userIsAdmin && ('), app.indexOf('Sales Report'));
    expect(importBlock).toContain('setIsImportModalOpen(true)');
    expect(importBlock).toContain('userIsAdmin');
    expect(importBlock).toContain('SHOW_IMPORT_UI');
  });

  it('FINDING: hiding Import does not remove the pipeline — only the doors', async () => {
    const { readFileSync } = await import('node:fs');
    // The flag hides entry points; the parsers, services and modals are
    // untouched and still under test. Restoring Import is one line plus a
    // redeploy, which is the whole point of doing it as a flag.
    const flags = readFileSync('src/lib/featureFlags.ts', 'utf8');
    expect(flags).toContain('SHOW_IMPORT_UI');
    // Gated on VITE_E2E rather than hard-coded false so the 36 scripts that
    // drive imports through the real UI keep working.
    expect(flags).toContain('VITE_E2E');
    for (const f of ['src/components/SalesReportImport.tsx', 'src/components/InventoryReportImport.tsx']) {
      expect(readFileSync(f, 'utf8').length).toBeGreaterThan(0);
    }
  });

  it('employees CAN add stock and record SHS — the intake half of the job is open', async () => {
    const buySheet = (await import('node:fs')).readFileSync('src/components/BuySheet.tsx', 'utf8');
    const start = buySheet.indexOf('{/* Action row');
    const actionRow = buySheet.slice(start, buySheet.indexOf('5 clickable KPI tiles', start));
    expect(actionRow).toContain('Add Stock');
    expect(actionRow).toContain('Bulk Order');
    // …but every wipe control in that same row is admin-gated
    expect(actionRow).toContain('userIsAdmin');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Act 2 · upload the Sales Report', () => {
  it('parses every row of a real .xlsx through the production parser', () => {
    // No row-level errors: every data row parsed cleanly
    expect(parsed.errors.filter(e => e.row > 0)).toEqual([]);
    // 5 data rows, one of which is a duplicate of another
    expect(parsed.sales).toHaveLength(5);
    expect(parsed.sales.every(s => s.marketplace === 'AMAZON')).toBe(true);
  });

  it('FINDING: a single-marketplace workbook reports 4 "missing sheet" errors', () => {
    // An operator uploading only their Amazon sheet gets four red errors
    // for BM / EBAY / ONBUY / TEMU even though the import is completely valid.
    const sheetErrors = parsed.errors.filter(e => /missing from workbook/.test(e.message));
    expect(sheetErrors.map(e => e.sheet).sort()).toEqual(['BM', 'EBAY', 'ONBUY', 'TEMU']);
  });

  it('recomputes financials instead of trusting the sheet', () => {
    const row = parsed.sales.find(s => s.imei === IMEI_OFFICE_A)!;
    expect(row.salePrice).toBe(320);
    expect(row.buyPrice).toBe(200);
    expect(row.commission).toBeGreaterThan(0);
    expect(row.grossProfit).toBeLessThan(row.salePrice - row.buyPrice);
  });

  it('preview flags the in-file duplicate and the units that will flip to sold', () => {
    const preview = buildPreview(parsed, [], all<InventoryUnit>('inventoryUnits'));
    expect(preview.duplicatesInFile).toHaveLength(1);
    // 4 distinct orders survive dedupe
    expect(preview.toCreate).toHaveLength(4);
    // office A, office B and the SHS unit flip; the orphan has no unit
    expect(preview.inventoryFlips.map(f => f.imei).sort())
      .toEqual([IMEI_OFFICE_A, IMEI_OFFICE_B, IMEI_SHS].sort());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Act 3 · confirm — reconcile sales against inventory and SHS', () => {
  it('marks matched units sold, links sale→unit, and fulfils the SHS unit', async () => {
    await commitImport(parsed);

    const units = all<InventoryUnit>('inventoryUnits');
    const byId = Object.fromEntries(units.map(u => [u.id, u]));

    expect(byId['u-office-a'].status).toBe('sold');
    expect(byId['u-office-a'].salePrice).toBe(320);
    expect(byId['u-office-b'].status).toBe('sold');
    // SHS: a sale is proof the supplier shipped, so incoming → sold
    expect(byId['u-shs'].status).toBe('sold');
    expect(isShsUnit(byId['u-shs'])).toBe(false);

    const sales = all<Sale>('sales');
    expect(sales).toHaveLength(4);
    expect(sales.find(s => s.imei === IMEI_OFFICE_A)!.unitId).toBe('u-office-a');
  });

  it('leaves the orphan sale unlinked — it needs the audit-completion step', async () => {
    await commitImport(parsed);
    const orphan = all<Sale>('sales').find(s => s.imei === IMEI_ORPHAN)!;
    expect(orphan.unitId).toBeUndefined();
    expect(all<InventoryUnit>('inventoryUnits').some(u => u.imei === IMEI_ORPHAN)).toBe(false);
  });

  it('office stock drops to exactly the units that did not sell', async () => {
    await commitImport(parsed);
    const office = all<InventoryUnit>('inventoryUnits').filter(isOfficeStockUnit);
    expect(office.map(u => u.id)).toEqual(['u-spare']);
  });

  it('FIXED: a sold SHS unit keeps its SHS provenance', async () => {
    await commitImport(parsed);
    const shs = col('inventoryUnits')['u-shs'] as InventoryUnit;
    expect(shs.stockSource).toBe('shs');

    // The real regression was the unit with NO explicit stockSource — a
    // parser-created placeholder. Incoming now implies SHS.
    const noSource = makeUnit({ id: 'u-shs2', imei: '350000000000077', status: 'incoming' });
    const { unitPatches, shsFulfilled } = buildPostImportSyncPatches(
      [{ id: 's', imei: noSource.imei, salePrice: 1, saleDate: '2026-07-06', marketplace: 'AMAZON', orderNumber: 'x' } as Sale],
      [noSource],
    );
    expect(unitPatches[0].data.stockSource).toBe('shs');
    // And the caller is told to clear the placeholder / master row behind it.
    expect(shsFulfilled.map(f => f.unitId)).toEqual(['u-shs2']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Act 4 · returns, replacement and repair on imported sales', () => {
  beforeEach(async () => {
    await commitImport(parsed);
    session.currentUser = { email: 'admin@inventorymanager.com', uid: 'admin-1' };
  });

  it('a refund return voids the sale and puts the unit back on the shelf', async () => {
    const unit = col('inventoryUnits')['u-office-a'] as InventoryUnit;
    const res = await processReturn({
      unit, returnType: 'returned_to_inventory', returnDate: '2026-07-10',
      reason: 'Screen fault', outcome: 'refund',
    });
    expect(res.ok).toBe(true);

    const after = col('inventoryUnits')['u-office-a'] as InventoryUnit;
    expect(after.status).toBe('available');
    expect(after.returnType).toBe('returned_to_inventory');

    const sale = all<Sale>('sales').find(s => s.imei === IMEI_OFFICE_A)!;
    expect(sale.voidedAt).toBe('2026-07-10');
    expect(sale.voidOutcome).toBe('refund');

    // Both surfaces count the same ledger: 1 return
    expect(returnUnits(all('inventoryUnits'))).toHaveLength(1);
    expect(returnCounts(all('inventoryUnits'), '2026-07-10', '2026-07-01'))
      .toEqual({ today: 1, month: 1, all: 1 });
  });

  it('a replacement return consumes a spare unit and links both sides', async () => {
    const unit = col('inventoryUnits')['u-office-b'] as InventoryUnit;
    const spare = col('inventoryUnits')['u-spare'] as InventoryUnit;
    const res = await processReturn({
      unit, returnType: 'returned_to_inventory', returnDate: '2026-07-11',
      reason: 'DOA', outcome: 'replacement', replacementUnit: spare,
    });
    expect(res.ok).toBe(true);

    const returned = col('inventoryUnits')['u-office-b'] as InventoryUnit;
    const shipped  = col('inventoryUnits')['u-spare'] as InventoryUnit;
    expect(returned.replacedByUnitId).toBe('u-spare');
    expect(shipped.replacementForUnitId).toBe('u-office-b');
    // The replacement left the building
    expect(shipped.status).toBe('sold');
    expect(all<InventoryUnit>('inventoryUnits').filter(isOfficeStockUnit).map(u => u.id))
      .toEqual(['u-office-b']);
  });

  it('refuses to process the same return twice', async () => {
    const unit = col('inventoryUnits')['u-office-a'] as InventoryUnit;
    await processReturn({
      unit, returnType: 'returned_to_inventory', returnDate: '2026-07-10',
      reason: 'Screen fault', outcome: 'refund',
    });
    const second = await processReturn({
      unit, returnType: 'returned_to_inventory', returnDate: '2026-07-12',
      reason: 'again', outcome: 'refund',
    });
    expect(second.ok).toBe(false);
    expect(second.error).toBe('unit_not_sold');
  });

  it('FIXED: a return voiding two sale docs still reads as ONE return on both screens', async () => {
    // Duplicate sale doc for the same IMEI — the exact shape produced by an
    // in-app sale plus an imported row for one phone.
    col('sales')['AMAZON__LEGACY__' + IMEI_OFFICE_A] = {
      id: 'AMAZON__LEGACY__' + IMEI_OFFICE_A,
      marketplace: 'AMAZON', orderNumber: 'LEGACY', imei: IMEI_OFFICE_A,
      saleDate: '2026-07-02', salePrice: 320, buyPrice: 200, ownerId: 'shared',
    };

    const unit = col('inventoryUnits')['u-office-a'] as InventoryUnit;
    await processReturn({
      unit, returnType: 'returned_to_inventory', returnDate: '2026-07-10',
      reason: 'Screen fault', outcome: 'refund',
    });

    // processReturn still voids both docs — that part is correct, both
    // sales really were reversed.
    const voided = all<Sale>('sales').filter(s => s.voidedAt);
    expect(voided).toHaveLength(2);
    // But a return belongs to a UNIT, and both screens now count units,
    // so neither reports 2. This is the 5-vs-4 mismatch, closed.
    expect(all<InventoryUnit>('inventoryUnits').filter(isOpenReturnUnit)).toHaveLength(1);
    expect(returnUnits(all('inventoryUnits'))).toHaveLength(1);
    expect(returnCounts(all('inventoryUnits'), '2026-07-10', '2026-07-01').all).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Act 5 · re-upload the same report', () => {
  it('is idempotent for sales: no duplicate docs, no double revenue', async () => {
    await commitImport(parsed);
    const firstCount = all<Sale>('sales').length;
    await commitImport(await parseSalesWorkbook(workbook, 'SALES_REPORT_2026.xlsx'));
    expect(all<Sale>('sales')).toHaveLength(firstCount);
  });

  it('FIXED: a re-upload no longer erases a processed return', async () => {
    await commitImport(parsed);
    session.currentUser = { email: 'admin@inventorymanager.com', uid: 'admin-1' };

    // Operator processes a return: unit goes back on the shelf.
    await processReturn({
      unit: col('inventoryUnits')['u-office-a'] as InventoryUnit,
      returnType: 'returned_to_inventory', returnDate: '2026-07-10',
      reason: 'Screen fault', outcome: 'refund',
    });
    expect(returnUnits(all('inventoryUnits')).length).toBe(1);

    // Same report uploaded again — e.g. a corrected monthly file.
    await commitImport(await parseSalesWorkbook(workbook, 'SALES_REPORT_2026.xlsx'));

    const unit = col('inventoryUnits')['u-office-a'] as InventoryUnit;
    const sale = all<Sale>('sales').find(s => s.imei === IMEI_OFFICE_A)!;

    // The return supersedes the sale being re-imported: the unit stays on
    // the shelf with its return history intact.
    expect(unit.status).toBe('available');
    expect(unit.returnType).toBe('returned_to_inventory');
    expect(unit.returnDate).toBe('2026-07-10');
    expect(sale.voidedAt).toBe('2026-07-10');

    // Both surfaces still agree afterwards.
    expect(returnUnits(all('inventoryUnits'))).toHaveLength(1);
  });

  it('a genuine re-sale after a return still clears the stale return flags', async () => {
    await commitImport(parsed);
    session.currentUser = { email: 'admin@inventorymanager.com', uid: 'admin-1' };
    await processReturn({
      unit: col('inventoryUnits')['u-office-a'] as InventoryUnit,
      returnType: 'returned_to_inventory', returnDate: '2026-07-10',
      reason: 'Screen fault', outcome: 'refund',
    });

    // A LATER sale of the same phone — the case the clearing behaviour exists for.
    const { unitPatches } = buildPostImportSyncPatches(
      [{
        id: 'AMAZON__AMZ-2001__' + IMEI_OFFICE_A, marketplace: 'AMAZON', orderNumber: 'AMZ-2001',
        imei: IMEI_OFFICE_A, saleDate: '2026-08-01', salePrice: 315, buyPrice: 200,
      } as Sale],
      all<InventoryUnit>('inventoryUnits'),
    );
    expect(unitPatches).toHaveLength(1);
    expect(unitPatches[0].data.status).toBe('sold');
    expect(unitPatches[0].data.returnType).toBeNull();   // stale cycle cleared
  });

  it('a repair-route return survives a re-upload (status "returned" IS skipped)', async () => {
    await commitImport(parsed);
    session.currentUser = { email: 'admin@inventorymanager.com', uid: 'admin-1' };
    await processReturn({
      unit: col('inventoryUnits')['u-office-b'] as InventoryUnit,
      returnType: 'repair', returnDate: '2026-07-10', reason: 'Battery', outcome: 'refund',
    });
    expect((col('inventoryUnits')['u-office-b'] as InventoryUnit).status).toBe('returned');

    await commitImport(await parseSalesWorkbook(workbook, 'SALES_REPORT_2026.xlsx'));

    const unit = col('inventoryUnits')['u-office-b'] as InventoryUnit;
    expect(unit.status).toBe('returned');
    expect(unit.returnType).toBe('repair');
    // The asymmetry is the bug: identical operator intent, opposite outcome.
  });

  it('FIXED: a replacement pair still reads as one sale after a re-upload', async () => {
    await commitImport(parsed);
    session.currentUser = { email: 'admin@inventorymanager.com', uid: 'admin-1' };
    // Customer returns office-b; we ship the spare as a replacement.
    await processReturn({
      unit: col('inventoryUnits')['u-office-b'] as InventoryUnit,
      returnType: 'returned_to_inventory', returnDate: '2026-07-11',
      reason: 'DOA', outcome: 'replacement',
      replacementUnit: col('inventoryUnits')['u-spare'] as InventoryUnit,
    });

    await commitImport(await parseSalesWorkbook(workbook, 'SALES_REPORT_2026.xlsx'));

    const returned = col('inventoryUnits')['u-office-b'] as InventoryUnit;
    const shipped  = col('inventoryUnits')['u-spare'] as InventoryUnit;
    // The returned unit stays returned; only the shipped replacement is sold.
    expect(returned.status).toBe('available');
    expect(returned.returnType).toBe('returned_to_inventory');
    expect(shipped.status).toBe('sold');
    expect(returned.replacedByUnitId).toBe('u-spare');

    // One customer order, one full-price sold unit — £330, not £660.
    const soldForOrder = all<InventoryUnit>('inventoryUnits')
      .filter(u => u.status === 'sold' && u.saleOrderId === 'AMZ-1002');
    expect(soldForOrder.map(u => u.id)).toEqual(['u-spare']);
    expect(soldForOrder.reduce((sum, u) => sum + (u.salePrice ?? 0), 0)).toBe(330);

    // SellSheet's legacy-unit path now counts the replacement only.
    const countedByLegacyPath = all<InventoryUnit>('inventoryUnits')
      .filter(u => u.status === 'sold' && u.salePrice != null && !u.returnType);
    expect(countedByLegacyPath.map(u => u.id)).not.toContain('u-office-b');
    expect(countedByLegacyPath.map(u => u.id)).toContain('u-spare');
  });

  it('FIXED: refunded revenue stays out of the sold figures after a re-upload', async () => {
    await commitImport(parsed);
    session.currentUser = { email: 'admin@inventorymanager.com', uid: 'admin-1' };
    await processReturn({
      unit: col('inventoryUnits')['u-office-a'] as InventoryUnit,
      returnType: 'returned_to_inventory', returnDate: '2026-07-10',
      reason: 'Screen fault', outcome: 'refund',
    });
    await commitImport(await parseSalesWorkbook(workbook, 'SALES_REPORT_2026.xlsx'));

    // SellSheet excludes voided sales from revenue, and the unit no longer
    // gets resurrected, so the refunded £320 stays out of the sold figures.
    const unit = col('inventoryUnits')['u-office-a'] as InventoryUnit;
    expect(unit.status).toBe('available');
    expect(unit.returnType).toBe('returned_to_inventory');
    const countedByLegacyPath = all<InventoryUnit>('inventoryUnits')
      .filter(u => u.status === 'sold' && u.salePrice != null && !u.returnType);
    expect(countedByLegacyPath.map(u => u.id)).not.toContain('u-office-a');
    // The return is still counted once, on both screens.
    expect(returnUnits(all('inventoryUnits'))).toHaveLength(1);
  });
});
