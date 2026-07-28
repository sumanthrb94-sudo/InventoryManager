/**
 * Integration tests for the inventory service layer.
 *
 * Mocks `src/lib/dbService` with an in-memory implementation so we can exercise
 * the real business rules in `addUnitManual` / `ensureSupplier` /
 * `receiveShsAggregate` / `backfillImei` end-to-end without booting Firebase.
 *
 * Convention reference: src/__tests__/regressions.test.ts (kept untouched).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { InventoryAggregate } from '../../types';

// ── In-memory dbService mock ───────────────────────────────────────────────
// One Map<id, data> per collection name. Methods read/write that map.

const collections: Record<string, Map<string, any>> = {};

function col(name: string): Map<string, any> {
  return (collections[name] ??= new Map());
}

vi.mock('../../lib/dbService', () => {
  const dbService = {
    async create(collectionName: string, id: string, data: any) {
      col(collectionName).set(id, { ...data, id });
    },
    async update(collectionName: string, id: string, data: any) {
      const existing = col(collectionName).get(id);
      col(collectionName).set(id, { ...(existing ?? {}), ...data, id });
    },
    async delete(collectionName: string, id: string) {
      col(collectionName).delete(id);
    },
    async bulkCreate(entries: Array<{ collection: string; id: string; data: any }>) {
      for (const entry of entries) {
        col(entry.collection).set(entry.id, { ...entry.data, id: entry.id });
      }
    },
    async readAll(collectionName: string) {
      return Array.from(col(collectionName).values());
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
    async createImportBatch() { return 'batch_mock'; },
    async bulkUpsertSales() { /* not used by inventoryService */ },
    applyCacheItem(collectionName: string, id: string, data: any) {
      const existing = col(collectionName).get(id);
      col(collectionName).set(id, { ...(existing ?? {}), ...data, id });
    },
  };
  return { dbService };
});

// Import AFTER the mock is registered so the SUT picks up the mocked module.
import {
  addUnitManual,
  ensureSupplier,
  receiveShsAggregate,
  backfillImei,
  addSoldUnitFromSale,
  restoreUnitReturnFromImport,
  completeUnitBuyInfo,
  upsertAccessoryStock,
  decrementAccessoryStock,
  restoreAccessoryStockFromImport,
  adjustAccessoryStock,
  returnAccessoryStock,
  recordAccessorySale,
} from '../../services/inventoryService';
import type { Sale } from '../../types';

// ── Helpers ────────────────────────────────────────────────────────────────

function clearAll() {
  for (const name of Object.keys(collections)) collections[name].clear();
}

const goodImei = '356938035643809'; // canonical 15-digit IMEI
const altImei  = '490154203237518';

const makeAggregate = (over: Partial<InventoryAggregate> = {}): InventoryAggregate => ({
  id: 'agg_test_1',
  model: 'iPhone XR',
  storage: '64GB',
  buyPrice: 200,
  quantityNum: 2,
  supplierIds: ['sup_existing'],
  ownerId: 'shared',
  createdAt: '2026-05-17',
  updatedAt: '2026-05-17',
  ...over,
});

beforeEach(() => {
  clearAll();
});

// ───────────────────────────────────────────────────────────────────────────
// addUnitManual
// ───────────────────────────────────────────────────────────────────────────

describe('addUnitManual', () => {
  it('happy path — creates a unit with default status / ownerId / dateIn', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const r = await addUnitManual({
      imei: goodImei,
      model: 'iPhone 13 128GB',
      buyPrice: 300,
      supplierName: 'MHL',
    });

    expect(r.ok).toBe(true);
    expect(r.id).toBe(goodImei);

    const written = collections['inventoryUnits'].get(goodImei);
    expect(written).toBeDefined();
    expect(written.status).toBe('available');
    expect(written.ownerId).toBe('shared');
    expect(written.dateIn).toBe(today);
    expect(written.imei).toBe(goodImei);
    // flags & listingSites default to empty arrays
    expect(Array.isArray(written.flags)).toBe(true);
    expect(written.flags).toEqual([]);
    expect(Array.isArray(written.listingSites)).toBe(true);
    expect(written.platformListed).toBe(false);
  });

  it('rejects when model is missing', async () => {
    const r = await addUnitManual({
      imei: goodImei,
      model: '   ',
      buyPrice: 300,
      supplierName: 'MHL',
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('missing_model');
    expect(collections['inventoryUnits']?.size ?? 0).toBe(0);
  });

  it('rejects invalid IMEI for a non-Apple device (alphanumeric serial)', async () => {
    // Non-Apple model — Apple-serial form is not unlocked.
    const r = await addUnitManual({
      imei: 'NL6CMQCYTD',
      model: 'Samsung Galaxy S22',
      buyPrice: 250,
      supplierName: 'MHL',
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('invalid_imei');
    expect(r.message).toMatch(/15-digit IMEI/i);
  });

  it('rejects buy price <= 0', async () => {
    const zero = await addUnitManual({
      imei: goodImei,
      model: 'iPhone 13',
      buyPrice: 0,
      supplierName: 'MHL',
    });
    expect(zero.ok).toBe(false);
    expect(zero.error).toBe('missing_buy_price');

    const neg = await addUnitManual({
      imei: goodImei,
      model: 'iPhone 13',
      buyPrice: -1,
      supplierName: 'MHL',
    });
    expect(neg.ok).toBe(false);
    expect(neg.error).toBe('missing_buy_price');
  });

  it('rejects when supplier is missing', async () => {
    const r = await addUnitManual({
      imei: goodImei,
      model: 'iPhone 13',
      buyPrice: 300,
      supplierName: '   ',
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('missing_supplier');
  });

  it('rejects duplicate IMEI (already in inventoryUnits)', async () => {
    // Pre-seed an existing unit with the same IMEI.
    col('inventoryUnits').set('existing', {
      id: 'existing',
      imei: goodImei,
      model: 'iPhone X',
      status: 'available',
    });

    const r = await addUnitManual({
      imei: goodImei,
      model: 'iPhone 13',
      buyPrice: 300,
      supplierName: 'MHL',
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('duplicate_imei');
    expect(r.message).toContain(goodImei);
  });

  it('auto-creates a supplier via ensureSupplier when the name is new', async () => {
    expect(col('suppliers').size).toBe(0);

    const r = await addUnitManual({
      imei: goodImei,
      model: 'iPhone 13',
      buyPrice: 300,
      supplierName: 'BRAND_NEW_SUPPLIER',
    });
    expect(r.ok).toBe(true);

    const suppliers = Array.from(col('suppliers').values());
    expect(suppliers).toHaveLength(1);
    expect(suppliers[0].name).toBe('BRAND_NEW_SUPPLIER');

    const written = collections['inventoryUnits'].get(goodImei);
    expect(written.supplierId).toBe(suppliers[0].id);
  });

  it('parses brand / model / storage correctly for "Apple iPhone XS 64GB"', async () => {
    const r = await addUnitManual({
      imei: goodImei,
      model: 'Apple iPhone XS 64GB',
      buyPrice: 300,
      supplierName: 'MHL',
    });
    expect(r.ok).toBe(true);

    const written = collections['inventoryUnits'].get(goodImei);
    expect(written.brand).toBe('Apple');
    expect(written.model).toBe('iPhone XS');
    expect(written.storage).toBe('64GB');
    expect(written.category).toBe('iPhone');
  });

  it('accepts an Apple alphanumeric serial when the model is Apple', async () => {
    const r = await addUnitManual({
      imei: 'NL6CMQCYTD', // 10-char alphanumeric Apple serial
      model: 'iPhone 13 Pro',
      buyPrice: 400,
      supplierName: 'MHL',
    });
    expect(r.ok).toBe(true);
    expect(r.id).toBe('NL6CMQCYTD');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// ensureSupplier
// ───────────────────────────────────────────────────────────────────────────

describe('ensureSupplier', () => {
  it('returns existing supplier id (case-insensitive match)', async () => {
    const existingId = 'sup_seed_1';
    col('suppliers').set(existingId, {
      id: existingId,
      name: 'NIHAL',
      portal: 'Wholesale',
      ownerId: 'shared',
    });

    const got = await ensureSupplier('nihal'); // lowercase input
    expect(got).toBe(existingId);
    // Should NOT have written a new supplier doc.
    expect(col('suppliers').size).toBe(1);
  });

  it('creates a new supplier when no match exists', async () => {
    expect(col('suppliers').size).toBe(0);
    const id = await ensureSupplier('FreshCo');
    expect(id).toMatch(/^sup_/);
    expect(col('suppliers').size).toBe(1);
    const created = col('suppliers').get(id);
    expect(created.name).toBe('FreshCo');
  });

  it('returns empty string when name is blank', async () => {
    const id = await ensureSupplier('   ');
    expect(id).toBe('');
    expect(col('suppliers').size).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// receiveShsAggregate
// ───────────────────────────────────────────────────────────────────────────

describe('receiveShsAggregate', () => {
  it('happy path — receives 2 valid IMEIs against a 2-quantity aggregate', async () => {
    const aggregate = makeAggregate({ quantityNum: 2 });
    col('inventoryAggregates').set(aggregate.id, aggregate);

    const r = await receiveShsAggregate({
      aggregate,
      scanned: [
        { imei: goodImei, colour: 'Black' },
        { imei: altImei,  colour: 'White' },
      ],
    });

    expect(r.ok).toBe(true);
    expect(r.receivedCount).toBe(2);
    expect(r.remainingQty).toBe(0);
    expect(r.errors).toEqual([]);

    // Two unit docs written, indexed by IMEI.
    expect(col('inventoryUnits').get(goodImei)).toBeDefined();
    expect(col('inventoryUnits').get(altImei)).toBeDefined();
    expect(col('inventoryUnits').get(goodImei)!.status).toBe('available');
    expect(col('inventoryUnits').get(altImei)!.colour).toBe('White');

    // Aggregate fully received → quantityText flipped.
    const finalAgg = col('inventoryAggregates').get(aggregate.id);
    expect(finalAgg.quantityNum).toBe(0);
    expect(finalAgg.quantityText).toBe('RECEIVED');
  });

  it('hard-caps at expectedQty — extra scans return { reason: "cap" }', async () => {
    const aggregate = makeAggregate({ quantityNum: 1 });
    col('inventoryAggregates').set(aggregate.id, aggregate);

    const r = await receiveShsAggregate({
      aggregate,
      scanned: [
        { imei: goodImei, colour: 'Black' },
        { imei: altImei,  colour: 'White' }, // over the cap
      ],
    });

    expect(r.ok).toBe(true);
    expect(r.receivedCount).toBe(1);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toEqual({ imei: altImei, reason: 'cap' });
    expect(col('inventoryUnits').get(altImei)).toBeUndefined();
  });

  it('rejects invalid IMEIs with reason "invalid_imei"', async () => {
    const aggregate = makeAggregate({ quantityNum: 2, model: 'Samsung Galaxy S22' });
    col('inventoryAggregates').set(aggregate.id, aggregate);

    const r = await receiveShsAggregate({
      aggregate,
      scanned: [
        { imei: 'NOTANIMEI', colour: 'Black' }, // not 15 digits, not Apple → invalid
        { imei: goodImei,    colour: 'White' },
      ],
    });

    expect(r.ok).toBe(true);
    expect(r.receivedCount).toBe(1);
    const invalid = r.errors.find(e => e.imei === 'NOTANIMEI');
    expect(invalid?.reason).toBe('invalid_imei');
    expect(col('inventoryUnits').get('NOTANIMEI')).toBeUndefined();
  });

  it('rejects duplicates within the batch AND against existing inventoryUnits', async () => {
    const aggregate = makeAggregate({ quantityNum: 5 });
    col('inventoryAggregates').set(aggregate.id, aggregate);

    // Pre-seed a clashing IMEI already in inventoryUnits.
    const seededImei = '999999999999999';
    col('inventoryUnits').set(seededImei, {
      id: seededImei,
      imei: seededImei,
      model: 'pre-existing',
      status: 'available',
    });

    const r = await receiveShsAggregate({
      aggregate,
      scanned: [
        { imei: goodImei,   colour: 'Black' }, // accepted
        { imei: goodImei,   colour: 'Black' }, // duplicate_in_batch
        { imei: seededImei, colour: 'Red'   }, // duplicate_imei (in DB)
      ],
    });

    expect(r.receivedCount).toBe(1);
    const reasons = r.errors.map(e => e.reason).sort();
    expect(reasons).toEqual(['duplicate_imei', 'duplicate_in_batch']);
  });

  it('decrements quantityNum and coloursMap on partial receive', async () => {
    const aggregate = makeAggregate({
      quantityNum: 3,
      coloursMap: { BLACK: 2, WHITE: 1 },
    });
    col('inventoryAggregates').set(aggregate.id, aggregate);

    const r = await receiveShsAggregate({
      aggregate,
      scanned: [{ imei: goodImei, colour: 'BLACK' }],
    });

    expect(r.ok).toBe(true);
    expect(r.receivedCount).toBe(1);
    expect(r.remainingQty).toBe(2);

    const finalAgg = col('inventoryAggregates').get(aggregate.id);
    // Partial receive → keeps a numeric quantity, no RECEIVED flag.
    expect(finalAgg.quantityNum).toBe(2);
    expect(finalAgg.quantityText).not.toBe('RECEIVED');
    expect(finalAgg.coloursMap).toEqual({ BLACK: 1, WHITE: 1 });
    expect(finalAgg.originalColoursMap).toEqual({ BLACK: 2, WHITE: 1 });
  });

  it('sets quantityText="RECEIVED" when fully received', async () => {
    const aggregate = makeAggregate({ quantityNum: 1 });
    col('inventoryAggregates').set(aggregate.id, aggregate);

    await receiveShsAggregate({
      aggregate,
      scanned: [{ imei: goodImei, colour: 'Black' }],
    });

    const finalAgg = col('inventoryAggregates').get(aggregate.id);
    expect(finalAgg.quantityText).toBe('RECEIVED');
    expect(finalAgg.quantityNum).toBe(0);
    expect(finalAgg.receivedAt).toBeDefined();
  });

  it('deletes the synthetic SHS placeholder unit (id starts with "shs_")', async () => {
    // Aggregate fields produce a deterministic placeholder id.
    const aggregate: any = makeAggregate({
      model: 'iPhone XR',
      quantityNum: 1,
      sourceRow: 42,
      supplierIds: ['sup_existing'],
    });
    aggregate.supplierName = 'MHL'; // pushes through the slugify(supplierName) branch
    col('inventoryAggregates').set(aggregate.id, aggregate);

    // shs_<slug(model)>_<slug(supplierName)>_<sourceRow>
    const placeholderId = 'shs_iphone_xr_mhl_42';
    col('inventoryUnits').set(placeholderId, {
      id: placeholderId,
      model: aggregate.model,
      status: 'incoming',
    });

    await receiveShsAggregate({
      aggregate,
      scanned: [{ imei: goodImei, colour: 'Black' }],
    });

    expect(col('inventoryUnits').get(placeholderId)).toBeUndefined();
    // The real per-IMEI unit was still written.
    expect(col('inventoryUnits').get(goodImei)).toBeDefined();
  });

  it('handles coloursMap sum > quantityNum (4 colours, qty=undefined → expects 4)', async () => {
    const aggregate = makeAggregate({
      quantityNum: undefined,
      coloursMap: { PINK: 1, BLUE: 1, SILVER: 1, YELLOW: 1 },
    });
    col('inventoryAggregates').set(aggregate.id, aggregate);

    const scanned = [
      { imei: '111111111111118', colour: 'PINK'   },
      { imei: '222222222222226', colour: 'BLUE'   },
      { imei: '333333333333334', colour: 'SILVER' },
      { imei: '444444444444442', colour: 'YELLOW' },
      { imei: '555555555555550', colour: 'EXTRA'  }, // should hit the cap
    ];
    const r = await receiveShsAggregate({ aggregate, scanned });

    expect(r.receivedCount).toBe(4);
    expect(r.errors.some(e => e.reason === 'cap')).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// backfillImei
// ───────────────────────────────────────────────────────────────────────────

describe('backfillImei', () => {
  it('writes the IMEI to the existing unit', async () => {
    const unitId = 'manual_shs_111';
    col('inventoryUnits').set(unitId, {
      id: unitId,
      imei: '',
      model: 'iPhone 12',
      status: 'incoming',
    });

    const r = await backfillImei(unitId, goodImei);
    expect(r.ok).toBe(true);
    expect(r.id).toBe(unitId);
    expect(col('inventoryUnits').get(unitId)!.imei).toBe(goodImei);
  });

  it('rejects when the IMEI is already on another unit', async () => {
    const target = 'manual_shs_target';
    const other  = 'manual_shs_other';
    col('inventoryUnits').set(target, {
      id: target, imei: '', model: 'iPhone 12', status: 'incoming',
    });
    col('inventoryUnits').set(other, {
      id: other, imei: goodImei, model: 'iPhone 13', status: 'available',
    });

    const r = await backfillImei(target, goodImei);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('duplicate_imei');
    // Target unit should still have empty imei.
    expect(col('inventoryUnits').get(target)!.imei).toBe('');
  });

  it('rejects an invalid IMEI for a non-Apple device', async () => {
    const unitId = 'manual_shs_222';
    col('inventoryUnits').set(unitId, {
      id: unitId,
      imei: '',
      model: 'Samsung Galaxy S22',
      status: 'incoming',
    });

    const r = await backfillImei(unitId, 'NOTAVALIDIMEI');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('invalid_imei');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// addSoldUnitFromSale
// ───────────────────────────────────────────────────────────────────────────

const orphanSale = (over: Partial<Sale> = {}): Sale => ({
  id: 'AMAZON__O-1__350000000000111',
  marketplace: 'AMAZON',
  orderNumber: 'O-1',
  imei: '350000000000111',
  unitId: '',
  supplierId: '',
  supplierName: 'NIHAL',
  saleDate: '2026-06-14',
  quantity: 1,
  buyPrice: 120,
  salePrice: 169.99,
  postage: 6.3,
  sku: 'ASI-SG-A32-5G-64-BK-EX',
  importBatchId: 't', sourceFile: 't', sourceRow: 1, ownerId: 'shared',
  createdAt: '2026-06-14T00:00:00Z', updatedAt: '2026-06-14T00:00:00Z',
  ...over,
} as any as Sale);

describe('addSoldUnitFromSale', () => {
  it('creates a SOLD unit from the sale and back-links sale.unitId', async () => {
    const sale = orphanSale();
    col('sales').set(sale.id, { ...sale });

    const r = await addSoldUnitFromSale({
      sale,
      imei: sale.imei,
      model: 'Samsung Galaxy A32 5G',
    });
    expect(r.ok).toBe(true);
    expect(r.id).toBe('350000000000111');

    const unit = collections['inventoryUnits'].get('350000000000111');
    expect(unit).toBeDefined();
    expect(unit.status).toBe('sold');
    // Sale provenance carried onto the unit.
    expect(unit.salePrice).toBe(169.99);
    expect(unit.saleDate).toBe('2026-06-14');
    expect(unit.salePlatform).toBe('AMAZON');
    expect(unit.saleOrderId).toBe('O-1');
    expect(unit.postageCost).toBe(6.3);
    // Defaults pulled from the sale.
    expect(unit.buyPrice).toBe(120);
    expect(unit.supplierName).toBe('NIHAL');
    expect(unit.sku).toBe('ASI-SG-A32-5G-64-BK-EX');

    // The sale is back-linked so the report join resolves + flag clears.
    expect(collections['sales'].get(sale.id).unitId).toBe('350000000000111');
  });

  it('accepts an alphanumeric serial when the model is a tablet', async () => {
    const sale = orphanSale({
      id: 'AMAZON__O-TAB__r8ywa0aldft',
      imei: 'r8ywa0aldft',
      sku: 'ASI-SG-TABA8-32GB-BK-EX',
    });
    col('sales').set(sale.id, { ...sale });

    const r = await addSoldUnitFromSale({
      sale,
      imei: 'r8ywa0aldft',
      model: 'Samsung Galaxy Tab A8 32GB',
    });
    expect(r.ok).toBe(true);
    // Serial upper-cased for the doc id.
    expect(r.id).toBe('R8YWA0ALDFT');
    expect(collections['inventoryUnits'].get('R8YWA0ALDFT')?.status).toBe('sold');
  });

  it('accepts a Tab SKU as the model (TABA8 word fused with series digit)', async () => {
    // Field-confirmed regression: the orphan-add loop defaults model to
    // the sale's SKU (`ASI-SG-TABA8-32GB-BK-EX`). The old isAppleDevice
    // regex used \bTAB\b which didn't match TABA8 (no boundary between
    // TAB and A8), so the Amazon serial `r8ywa0aldft` got rejected and
    // exactly one tablet per import landed on the No-Inventory badge.
    const sale = orphanSale({
      id: 'AMAZON__O-TAB2__r9ty70b985b',
      imei: 'r9ty70b985b',
      sku: 'ASI-SG-TABA9+-128GB-GR-EX',
    });
    col('sales').set(sale.id, { ...sale });

    // Pass the SKU directly as model (mirrors the orphan-add default).
    const r = await addSoldUnitFromSale({
      sale,
      imei: 'r9ty70b985b',
      model: 'ASI-SG-TABA9+-128GB-GR-EX',
    });
    expect(r.ok).toBe(true);
    expect(r.id).toBe('R9TY70B985B');
    const unit = collections['inventoryUnits'].get('R9TY70B985B');
    expect(unit?.status).toBe('sold');
    expect(unit?.category).toBe('Tablet');
  });

  it('rejects a non-IMEI serial when the model is a plain phone', async () => {
    const sale = orphanSale({ imei: 'notanimei' });
    const r = await addSoldUnitFromSale({ sale, imei: 'notanimei', model: 'Samsung A32' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('invalid_imei');
  });

  it('accepts a 10-12 char serial regardless of model (permissive orphan-add path)', async () => {
    // Future-proofing: the orphan-add path no longer depends on the SKU
    // matching one of the known tablet/Apple device-family tokens. If the
    // marketplace gave us an 11-char alphanumeric serial, we trust it
    // and create the unit — the strict device-family gate only applies
    // to manual stock entry (addUnitManual).
    const sale = orphanSale({
      id: 'AMAZON__O-UNKNOWN__abc12def345',
      imei: 'abc12def345',
      sku: 'SOMETHING-WE-HAVENT-SEEN-BEFORE',
    });
    col('sales').set(sale.id, { ...sale });

    // Pass a model that explicitly DOESN'T contain any of the known
    // tablet/Apple/Watch keywords — addUnitManual would reject this,
    // but addSoldUnitFromSale must accept because the sale is real.
    const r = await addSoldUnitFromSale({
      sale,
      imei: 'abc12def345',
      model: 'NoFamilyKeywordsHere',
    });
    expect(r.ok).toBe(true);
    expect(r.id).toBe('ABC12DEF345');
  });

  it('still rejects garbage that isn\'t IMEI-like or serial-like', async () => {
    // 9 chars — too short for either format. The permissive path still
    // applies a sanity floor (10-12 alphanumeric OR 15 digits).
    const sale = orphanSale({ imei: 'too-short' });
    const r = await addSoldUnitFromSale({
      sale,
      imei: 'too-short',
      model: 'AnyModel',
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('invalid_imei');
  });

  it('rejects when the IMEI already exists in inventory', async () => {
    col('inventoryUnits').set('350000000000111', { id: '350000000000111', imei: '350000000000111' });
    const sale = orphanSale();
    const r = await addSoldUnitFromSale({ sale, imei: sale.imei, model: 'Samsung A32 5G' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('duplicate_imei');
  });

  it('rejects a zero buy price', async () => {
    const sale = orphanSale({ buyPrice: 0 });
    const r = await addSoldUnitFromSale({ sale, imei: sale.imei, model: 'Samsung A32 5G', buyPrice: 0 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('missing_buy_price');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// restoreUnitReturnFromImport
// ───────────────────────────────────────────────────────────────────────────

const voidedSale = (over: Partial<Sale> = {}): Sale => ({
  id: 'AMAZON__O-RET-1__350000000000222',
  marketplace: 'AMAZON',
  orderNumber: 'O-RET-1',
  imei: '350000000000222',
  unitId: '350000000000222',
  supplierId: '',
  supplierName: 'NIHAL',
  saleDate: '2026-06-01',
  quantity: 1,
  buyPrice: 120,
  salePrice: 169.99,
  postage: 6.3,
  postageVat: 1.26,
  sku: 'ASI-SG-A32-5G-64-BK-EX',
  voidedAt: '2026-06-14',
  voidReason: 'Refund — Cx Change of Mind',
  voidOutcome: 'refund',
  importBatchId: 't', sourceFile: 't', sourceRow: 1, ownerId: 'shared',
  createdAt: '2026-06-01T00:00:00Z', updatedAt: '2026-06-01T00:00:00Z',
  ...over,
} as any as Sale);

const soldUnit = (over: Record<string, any> = {}) => ({
  id: '350000000000222',
  imei: '350000000000222',
  model: 'Samsung Galaxy A32 5G',
  brand: 'Samsung',
  category: 'Samsung A Series',
  colour: 'Black',
  buyPrice: 120,
  dateIn: '2026-01-01',
  supplierId: 'sup_1',
  supplierName: 'NIHAL',
  status: 'sold',
  flags: [],
  notes: '',
  platformListed: true,
  listingSites: [],
  salePrice: 169.99,
  saleDate: '2026-06-01',
  salePlatform: 'AMAZON',
  saleOrderId: 'O-RET-1',
  postageCost: 6.3,
  ownerId: 'shared',
  createdAt: '2026-01-01T00:00:00Z',
  ...over,
});

describe('restoreUnitReturnFromImport', () => {
  it('patches an existing SOLD unit to returned_to_inventory → available, clearing sale-provenance fields', async () => {
    const sale = voidedSale();
    col('inventoryUnits').set(sale.imei!, soldUnit());

    const r = await restoreUnitReturnFromImport({ sale, returnType: 'returned_to_inventory' });
    expect(r.ok).toBe(true);
    expect(r.created).toBe(false);

    const unit = collections['inventoryUnits'].get('350000000000222');
    expect(unit.status).toBe('available');
    expect(unit.returnType).toBe('returned_to_inventory');
    expect(unit.returnDate).toBe('2026-06-14');
    expect(unit.returnReason).toBe('Refund — Cx Change of Mind');
    expect(unit.returnOutcome).toBe('refund');
    expect(unit.returnLegCost).toBeCloseTo(7.56);
    expect(unit.pendingCrmReview).toBe(false);
    expect(unit.platformListed).toBe(false);
    expect(unit.listingSites).toEqual([]);
    // Sale provenance cleared, matching returnsService's buildReturningUnitPatch.
    expect(unit.salePrice).toBeNull();
    expect(unit.saleDate).toBeNull();
    expect(unit.salePlatform).toBeNull();
    expect(unit.saleOrderId).toBeNull();
    expect(unit.postageCost).toBeNull();
  });

  it('returned_to_supplier and repair land on status "returned", not "available"', async () => {
    col('inventoryUnits').set('350000000000222', soldUnit());
    const r1 = await restoreUnitReturnFromImport({
      sale: voidedSale(), returnType: 'returned_to_supplier',
    });
    expect(r1.ok).toBe(true);
    expect(collections['inventoryUnits'].get('350000000000222').status).toBe('returned');

    col('inventoryUnits').set('350000000000333', soldUnit({ id: '350000000000333', imei: '350000000000333' }));
    const r2 = await restoreUnitReturnFromImport({
      sale: voidedSale({ id: 'AMAZON__O-RET-2__350000000000333', imei: '350000000000333', voidOutcome: 'repair', voidReason: 'In Repair — screen cracked' }),
      returnType: 'repair',
    });
    expect(r2.ok).toBe(true);
    const unit2 = collections['inventoryUnits'].get('350000000000333');
    expect(unit2.status).toBe('returned');
    // repair voids carry no customer outcome — independent of returnType.
    expect(unit2.returnOutcome).toBeNull();
  });

  it('no matching unit at all — reconstructs one directly in returned shape, skipping the sold intermediate', async () => {
    const sale = voidedSale({ id: 'AMAZON__O-RET-3__350000000000444', imei: '350000000000444', unitId: '' });
    const r = await restoreUnitReturnFromImport({ sale, returnType: 'returned_to_inventory' });
    expect(r.ok).toBe(true);
    expect(r.created).toBe(true);
    expect(r.unitId).toBe('350000000000444');

    const unit = collections['inventoryUnits'].get('350000000000444');
    expect(unit).toBeDefined();
    expect(unit.status).toBe('available');
    expect(unit.returnType).toBe('returned_to_inventory');
    expect(unit.model).toContain('Galaxy A32');
    expect(unit.buyPrice).toBe(120);
    // No live "sold" moment for a unit whose entire life this import is
    // "it came back" — sale-provenance fields never got set in the first place.
    expect(unit.salePrice).toBeNull();
    expect(unit.saleOrderId).toBeNull();
  });

  it('is idempotent — re-running against an already-restored unit is a no-op (no duplicate audit event, same state)', async () => {
    const sale = voidedSale();
    col('inventoryUnits').set(sale.imei!, soldUnit());
    await restoreUnitReturnFromImport({ sale, returnType: 'returned_to_inventory' });
    const afterFirst = { ...collections['inventoryUnits'].get('350000000000222') };

    const r2 = await restoreUnitReturnFromImport({ sale, returnType: 'returned_to_inventory' });
    expect(r2.ok).toBe(true);
    expect(r2.created).toBe(false);
    expect(collections['inventoryUnits'].get('350000000000222')).toEqual(afterFirst);
  });

  it('rejects a sale that was never voided — nothing to restore', async () => {
    const sale = voidedSale({ voidedAt: undefined, voidOutcome: undefined, voidReason: undefined });
    const r = await restoreUnitReturnFromImport({ sale, returnType: 'returned_to_inventory' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('not_voided');
  });

  it('rejects a sale with no IMEI to restore against', async () => {
    const sale = voidedSale({ imei: '' });
    const r = await restoreUnitReturnFromImport({ sale, returnType: 'returned_to_inventory' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('missing_imei');
  });

  it('reconstruction path surfaces missing_supplier when the sale has no supplier at all', async () => {
    const sale = voidedSale({
      id: 'AMAZON__O-RET-5__350000000000555', imei: '350000000000555',
      unitId: '', supplierName: '',
    });
    const r = await restoreUnitReturnFromImport({ sale, returnType: 'returned_to_inventory' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('missing_supplier');
  });

  it('multi-cycle guard: refuses to restore a historical return once the unit has been re-sold under a different order', async () => {
    // sell -> return -> sell again -> everything re-imports in one file.
    // By the time the returns-restore step runs, the unit is ALREADY
    // 'sold' again (linked to the NEW order) via the normal sync/audit
    // step that runs first. Restoring the OLD (now-historical) return
    // must not clobber that newer sale.
    const sale = voidedSale(); // orderNumber 'O-RET-1', voided 2026-06-14
    col('inventoryUnits').set(sale.imei!, {
      ...soldUnit(),
      // Currently sold via a DIFFERENT, newer order — the re-sale cycle.
      salePrice: 220, saleDate: '2026-07-01', salePlatform: 'EBAY', saleOrderId: 'O-NEW-2',
    });
    const r = await restoreUnitReturnFromImport({ sale, returnType: 'returned_to_inventory' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('superseded_by_newer_sale');
    // The newer sale's link must survive untouched.
    const unit = collections['inventoryUnits'].get('350000000000222');
    expect(unit.status).toBe('sold');
    expect(unit.saleOrderId).toBe('O-NEW-2');
    expect(unit.salePrice).toBe(220);
    expect(unit.returnType).toBeUndefined();
  });

  it('multi-cycle: still restores correctly when the unit IS currently sold via the SAME sale being restored', async () => {
    const sale = voidedSale();
    col('inventoryUnits').set(sale.imei!, soldUnit()); // saleOrderId defaults to 'O-RET-1', matching the sale
    const r = await restoreUnitReturnFromImport({ sale, returnType: 'returned_to_inventory' });
    expect(r.ok).toBe(true);
    expect(collections['inventoryUnits'].get('350000000000222').status).toBe('available');
  });

  it('two historical return cycles (never resold between them) both restore correctly, ending on the NEWER cycle\'s returnDate/reason — not stuck on the older one', async () => {
    // A unit returned, never resold, then somehow returned a second time (or
    // more realistically: a full-wipe rebuild replays BOTH historical voided
    // sales for this IMEI, but the Returns Detail sheet only ever carries the
    // unit's LATEST cycle's Return Type — see parseReturnsTab — so both
    // restore calls below are made with the SAME returnType, differing only
    // in which sale (and therefore which returnDate/reason) drives them.
    const oldSale = voidedSale({
      id: 'AMAZON__O-RET-OLD__350000000000222', orderNumber: 'O-RET-OLD',
      voidedAt: '2026-05-01', voidReason: 'Old cycle reason',
    });
    const newSale = voidedSale({
      id: 'AMAZON__O-RET-NEW__350000000000222', orderNumber: 'O-RET-NEW',
      voidedAt: '2026-06-14', voidReason: 'Newer cycle reason',
    });

    // Oldest cycle restores first (no existing unit — births one).
    const r1 = await restoreUnitReturnFromImport({ sale: oldSale, returnType: 'returned_to_inventory' });
    expect(r1.ok).toBe(true);
    expect(r1.created).toBe(true);
    let unit = collections['inventoryUnits'].get('350000000000222');
    expect(unit.returnDate).toBe('2026-05-01');
    expect(unit.returnReason).toBe('Old cycle reason');

    // Newest cycle restores second — same returnType as the first call, so
    // the OLD (status+type-only) idempotency check would have wrongly
    // treated this as a no-op. It must actually apply and overwrite with
    // the newer cycle's own date/reason.
    const r2 = await restoreUnitReturnFromImport({ sale: newSale, returnType: 'returned_to_inventory' });
    expect(r2.ok).toBe(true);
    expect(r2.created).toBe(false);
    unit = collections['inventoryUnits'].get('350000000000222');
    expect(unit.returnDate).toBe('2026-06-14');
    expect(unit.returnReason).toBe('Newer cycle reason');

    // Re-running the newest cycle a second time (a genuine re-upload of the
    // unchanged file) must still be a true no-op — same date, same reason.
    const r3 = await restoreUnitReturnFromImport({ sale: newSale, returnType: 'returned_to_inventory' });
    expect(r3.ok).toBe(true);
    expect(r3.created).toBe(false);
    unit = collections['inventoryUnits'].get('350000000000222');
    expect(unit.returnDate).toBe('2026-06-14');
    expect(unit.returnReason).toBe('Newer cycle reason');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// completeUnitBuyInfo
// ───────────────────────────────────────────────────────────────────────────

describe('completeUnitBuyInfo', () => {
  it('patches an existing unit\'s buy-side fields for audit completeness', async () => {
    // Unit exists but is missing audit data: BP=0, blank supplier, SKU model.
    col('inventoryUnits').set('355808981119999', {
      id: '355808981119999', imei: '355808981119999',
      model: 'ASI-SG-A32-64-5G-DS-BK-DD2', brand: 'Other', category: 'Other',
      colour: 'Unknown', buyPrice: 0, dateIn: '2026-06-15',
      supplierId: '', supplierName: '', status: 'available',
      flags: [], notes: '', platformListed: false, listingSites: [],
      ownerId: 'shared', createdAt: '2026-06-15T00:00:00Z',
    });

    const r = await completeUnitBuyInfo({
      unitId: '355808981119999',
      model: 'Samsung Galaxy A32 5G',
      supplierName: 'NANAK',
      buyPrice: 57,
      colour: 'Black',
    });
    expect(r.ok).toBe(true);

    const u = collections['inventoryUnits'].get('355808981119999');
    expect(u.buyPrice).toBe(57);
    expect(u.supplierName).toBe('NANAK');
    expect(u.model).toBe('Galaxy A32');       // parseBrandModelStorage cleans it
    expect(u.category).toBe('Samsung A Series');
    expect(u.colour).toBe('Black');
    // Status untouched — completeUnitBuyInfo only fixes buy-side data.
    expect(u.status).toBe('available');
  });

  it('rejects when model / supplier / BP are missing', async () => {
    col('inventoryUnits').set('u-x', { id: 'u-x', imei: '1', model: 'X', status: 'available' });
    expect((await completeUnitBuyInfo({ unitId: 'u-x', model: '', supplierName: 'A', buyPrice: 5 })).error).toBe('missing_model');
    expect((await completeUnitBuyInfo({ unitId: 'u-x', model: 'M', supplierName: '', buyPrice: 5 })).error).toBe('missing_supplier');
    expect((await completeUnitBuyInfo({ unitId: 'u-x', model: 'M', supplierName: 'A', buyPrice: 0 })).error).toBe('missing_buy_price');
  });

  it('rejects when the unit does not exist', async () => {
    const r = await completeUnitBuyInfo({ unitId: 'nope', model: 'M', supplierName: 'A', buyPrice: 5 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('write_failed');
  });
});

describe('stockSource capture (office vs SHS)', () => {
  const orphanSaleSrc = (over: Partial<Sale> = {}): Sale => ({
    id: 'AMAZON__O-SRC__350000000000222',
    marketplace: 'AMAZON', orderNumber: 'O-SRC', imei: '350000000000222', unitId: '',
    supplierId: '', supplierName: 'NANAK', saleDate: '2026-06-14', quantity: 1,
    buyPrice: 57, salePrice: 84.99, sku: 'SG-A32', importBatchId: 't', sourceFile: 't',
    sourceRow: 1, ownerId: 'shared', createdAt: '2026-06-14T00:00:00Z', updatedAt: '2026-06-14T00:00:00Z',
    ...over,
  } as any as Sale);

  it('addSoldUnitFromSale persists stockSource=shs', async () => {
    const sale = orphanSaleSrc();
    col('sales').set(sale.id, { ...sale });
    const r = await addSoldUnitFromSale({ sale, imei: sale.imei!, model: 'Samsung Galaxy A32 5G', stockSource: 'shs' });
    expect(r.ok).toBe(true);
    expect(collections['inventoryUnits'].get('350000000000222').stockSource).toBe('shs');
  });

  it('addSoldUnitFromSale defaults stockSource=office', async () => {
    const sale = orphanSaleSrc({ id: 'AMAZON__O-OFF__350000000000223', imei: '350000000000223' });
    col('sales').set(sale.id, { ...sale });
    const r = await addSoldUnitFromSale({ sale, imei: sale.imei!, model: 'Samsung Galaxy A32 5G' });
    expect(r.ok).toBe(true);
    expect(collections['inventoryUnits'].get('350000000000223').stockSource).toBe('office');
  });

  it('completeUnitBuyInfo persists stockSource when provided', async () => {
    col('inventoryUnits').set('u-src', {
      id: 'u-src', imei: '1', model: 'X', brand: 'Other', category: 'Other',
      colour: 'Unknown', buyPrice: 0, supplierName: '', status: 'available',
      flags: [], notes: '', platformListed: false, listingSites: [], ownerId: 'shared', createdAt: 'x',
    });
    const r = await completeUnitBuyInfo({ unitId: 'u-src', model: 'Galaxy A32', supplierName: 'NANAK', buyPrice: 57, stockSource: 'shs' });
    expect(r.ok).toBe(true);
    expect(collections['inventoryUnits'].get('u-src').stockSource).toBe('shs');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Accessory stock — no-IMEI quantity pools (chargers, SIM pins, cables)
// ───────────────────────────────────────────────────────────────────────────

describe('upsertAccessoryStock', () => {
  it('creates a new SKU pool, doc id = slugified sku', async () => {
    const r = await upsertAccessoryStock({ sku: 'USB-C 20W', name: 'USB-C 20W Charger', quantity: 50, buyPrice: 3.5 });
    expect(r.ok).toBe(true);
    expect(r.id).toBe('usb_c_20w');
    expect(r.quantity).toBe(50);
    const doc = collections['accessoryStock'].get('usb_c_20w');
    expect(doc.sku).toBe('USB-C 20W');
    expect(doc.name).toBe('USB-C 20W Charger');
    expect(doc.quantity).toBe(50);
    expect(doc.buyPrice).toBe(3.5);
  });

  it('tops up an existing SKU pool by adding, not replacing, quantity', async () => {
    await upsertAccessoryStock({ sku: 'SIM-PIN', name: 'SIM Eject Pin', quantity: 100, buyPrice: 0.1 });
    const r = await upsertAccessoryStock({ sku: 'SIM-PIN', name: 'SIM Eject Pin', quantity: 25, buyPrice: 0.12 });
    expect(r.ok).toBe(true);
    expect(r.quantity).toBe(125);
    const doc = collections['accessoryStock'].get('sim_pin');
    expect(doc.quantity).toBe(125);
    expect(doc.buyPrice).toBe(0.12); // latest BP wins
  });

  it('rejects a blank SKU', async () => {
    const r = await upsertAccessoryStock({ sku: '', name: 'x', quantity: 1, buyPrice: 1 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('missing_sku');
  });

  it('rejects a non-positive quantity', async () => {
    const r = await upsertAccessoryStock({ sku: 'X', name: 'x', quantity: 0, buyPrice: 1 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('invalid_quantity');
  });
});

describe('decrementAccessoryStock', () => {
  it('consumes quantity from a matching pool', async () => {
    await upsertAccessoryStock({ sku: 'USB-C 20W', name: 'USB-C 20W Charger', quantity: 50, buyPrice: 3.5 });
    const r = await decrementAccessoryStock('USB-C 20W', 5);
    expect(r.matched).toBe(true);
    expect(r.remaining).toBe(45);
    expect(collections['accessoryStock'].get('usb_c_20w').quantity).toBe(45);
  });

  it('floors at 0 rather than going negative', async () => {
    await upsertAccessoryStock({ sku: 'USB-C 20W', name: 'USB-C 20W Charger', quantity: 3, buyPrice: 3.5 });
    const r = await decrementAccessoryStock('USB-C 20W', 10);
    expect(r.matched).toBe(true);
    expect(r.remaining).toBe(0);
  });

  it('is a no-op (matched: false) when no pool exists for the SKU — the ordinary case for every non-accessory sale', async () => {
    const r = await decrementAccessoryStock('SG-A17-128GB-OB', 1);
    expect(r.matched).toBe(false);
    expect(r.remaining).toBeUndefined();
  });
});

describe('upsertAccessoryStock — totalReceived (cumulative intake, feeds the Inventory Report export)', () => {
  it('seeds totalReceived equal to quantity on a brand-new pool', async () => {
    const r = await upsertAccessoryStock({ sku: 'USB-C 20W', name: 'USB-C 20W Charger', quantity: 50, buyPrice: 3.5 });
    expect(r.ok).toBe(true);
    expect(collections['accessoryStock'].get('usb_c_20w').totalReceived).toBe(50);
  });

  it('accumulates totalReceived across top-ups — unlike quantity, a sale never reduces it', async () => {
    await upsertAccessoryStock({ sku: 'USB-C 20W', name: 'USB-C 20W Charger', quantity: 50, buyPrice: 3.5 });
    await decrementAccessoryStock('USB-C 20W', 20); // a sale — drops quantity, not totalReceived
    const r = await upsertAccessoryStock({ sku: 'USB-C 20W', name: 'USB-C 20W Charger', quantity: 10, buyPrice: 3.5 });
    expect(r.ok).toBe(true);
    const doc = collections['accessoryStock'].get('usb_c_20w');
    expect(doc.quantity).toBe(40);       // 50 - 20 + 10
    expect(doc.totalReceived).toBe(60);  // 50 + 10, the sale never touched this
  });

  it('self-heals a legacy doc with no totalReceived field by falling back to its current quantity', async () => {
    collections['accessoryStock'].set('legacy_sku', {
      id: 'legacy_sku', sku: 'LEGACY-SKU', name: 'Old Pool', quantity: 30, buyPrice: 1, ownerId: 'shared', createdAt: 'x',
    });
    const r = await upsertAccessoryStock({ sku: 'LEGACY-SKU', name: 'Old Pool', quantity: 10, buyPrice: 1 });
    expect(r.ok).toBe(true);
    const doc = collections['accessoryStock'].get('legacy_sku');
    expect(doc.quantity).toBe(40);
    expect(doc.totalReceived).toBe(40); // 30 (fallback baseline) + 10
  });
});

describe('restoreAccessoryStockFromImport — the wipe + re-upload recovery path', () => {
  it('creates a fresh pool at quantity = totalReceived when none exists (the post-wipe case)', async () => {
    const r = await restoreAccessoryStockFromImport({
      sku: 'USB-C-20W', name: 'USB-C 20W Charger', supplierName: 'MOBILE WHOLESALE LTD',
      totalReceived: 50, buyPrice: 3.5,
    });
    expect(r.ok).toBe(true);
    expect(r.created).toBe(true);
    const doc = collections['accessoryStock'].get('usb_c_20w');
    expect(doc.quantity).toBe(50);
    expect(doc.totalReceived).toBe(50);
    expect(doc.name).toBe('USB-C 20W Charger');
  });

  it('is a no-op when a pool for the SKU already exists — never clobbers live state with a stale export', async () => {
    await upsertAccessoryStock({ sku: 'USB-C-20W', name: 'USB-C 20W Charger', quantity: 48, buyPrice: 3.5 });
    const r = await restoreAccessoryStockFromImport({
      sku: 'USB-C-20W', name: 'USB-C 20W Charger', totalReceived: 999, buyPrice: 3.5,
    });
    expect(r.ok).toBe(true);
    expect(r.created).toBe(false);
    // Untouched — still the live value, not the (wrong) 999 from the stale import.
    expect(collections['accessoryStock'].get('usb_c_20w').quantity).toBe(48);
  });

  it('rejects a blank SKU', async () => {
    const r = await restoreAccessoryStockFromImport({ sku: '', name: 'x', totalReceived: 10, buyPrice: 1 });
    expect(r.ok).toBe(false);
    expect(r.created).toBe(false);
  });

  it('the full round trip: create, sell some, wipe, restore, replay the sale — lands back at the exact pre-wipe quantity', async () => {
    // Before the wipe: 50 added, 2 sold, live quantity 48.
    await upsertAccessoryStock({ sku: 'USB-C-20W', name: 'USB-C 20W Charger', quantity: 50, buyPrice: 3.5 });
    await decrementAccessoryStock('USB-C-20W', 2);
    const beforeWipe = collections['accessoryStock'].get('usb_c_20w');
    expect(beforeWipe.quantity).toBe(48);
    expect(beforeWipe.totalReceived).toBe(50);

    // Wipe: the pool doc is gone entirely (accessoryStock is in every wipe scope).
    collections['accessoryStock'].delete('usb_c_20w');
    expect(collections['accessoryStock'].get('usb_c_20w')).toBeUndefined();

    // Re-upload the Inventory Report's Accessories sheet (exports totalReceived, not quantity).
    await restoreAccessoryStockFromImport({
      sku: 'USB-C-20W', name: 'USB-C 20W Charger', totalReceived: beforeWipe.totalReceived, buyPrice: 3.5,
    });
    expect(collections['accessoryStock'].get('usb_c_20w').quantity).toBe(50); // gross baseline, sale not yet replayed

    // Re-upload the Sales Report: replays the historical sale via the ordinary decrement path.
    await decrementAccessoryStock('USB-C-20W', 2);
    expect(collections['accessoryStock'].get('usb_c_20w').quantity).toBe(48); // back to the exact pre-wipe figure
  });
});

// ── AccessoryStockEvent ledger — every mutation gets a traceable row ────────

function accessoryEvents(): any[] {
  return Array.from((collections['accessoryStockEvents'] ?? new Map()).values());
}

describe('AccessoryStockEvent ledger — existing accessory functions', () => {
  it('upsertAccessoryStock writes a topup event', async () => {
    await upsertAccessoryStock({ sku: 'USB-C-20W', name: 'USB-C 20W Charger', quantity: 50, buyPrice: 3.5 });
    const events = accessoryEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ sku: 'USB-C-20W', type: 'topup', delta: 50, quantityAfter: 50, source: 'manual' });
  });

  it('decrementAccessoryStock writes a sale event sourced from the Sales Report import, carrying order/marketplace context', async () => {
    await upsertAccessoryStock({ sku: 'USB-C-20W', name: 'USB-C 20W Charger', quantity: 50, buyPrice: 3.5 });
    await decrementAccessoryStock('USB-C-20W', 2, { orderNumber: 'AMZ-1001', marketplace: 'AMAZON' as any });
    const saleEvent = accessoryEvents().find(e => e.type === 'sale');
    expect(saleEvent).toMatchObject({
      delta: -2, quantityAfter: 48, source: 'sales_report_import',
      orderNumber: 'AMZ-1001', marketplace: 'AMAZON',
    });
  });

  it('restoreAccessoryStockFromImport writes a restore event', async () => {
    await restoreAccessoryStockFromImport({ sku: 'USB-C-20W', name: 'USB-C 20W Charger', totalReceived: 50, buyPrice: 3.5 });
    const restoreEvent = accessoryEvents().find(e => e.type === 'restore');
    expect(restoreEvent).toMatchObject({ delta: 50, quantityAfter: 50 });
  });
});

describe('adjustAccessoryStock — stock count corrections (damaged / lost / found)', () => {
  it('a positive delta ("found more") also bumps totalReceived, same as a top-up', async () => {
    await upsertAccessoryStock({ sku: 'USB-C-20W', name: 'USB-C 20W Charger', quantity: 50, buyPrice: 3.5 });
    const r = await adjustAccessoryStock({ sku: 'USB-C-20W', delta: 5, reason: 'found a box in the back' });
    expect(r.ok).toBe(true);
    expect(r.quantity).toBe(55);
    const doc = collections['accessoryStock'].get('usb_c_20w');
    expect(doc.totalReceived).toBe(55);
    const event = accessoryEvents().find(e => e.type === 'adjustment');
    expect(event).toMatchObject({ delta: 5, quantityAfter: 55, reason: 'found a box in the back' });
  });

  it('a negative delta ("damaged") reduces quantity but leaves totalReceived untouched', async () => {
    await upsertAccessoryStock({ sku: 'USB-C-20W', name: 'USB-C 20W Charger', quantity: 50, buyPrice: 3.5 });
    const r = await adjustAccessoryStock({ sku: 'USB-C-20W', delta: -4, reason: 'damaged in storage' });
    expect(r.ok).toBe(true);
    expect(r.quantity).toBe(46);
    expect(collections['accessoryStock'].get('usb_c_20w').totalReceived).toBe(50);
  });

  it('floors at 0 rather than going negative', async () => {
    await upsertAccessoryStock({ sku: 'USB-C-20W', name: 'USB-C 20W Charger', quantity: 3, buyPrice: 3.5 });
    const r = await adjustAccessoryStock({ sku: 'USB-C-20W', delta: -10, reason: 'stock count came up short' });
    expect(r.quantity).toBe(0);
  });

  it('rejects a missing reason — an unexplained adjustment is indistinguishable from a bug', async () => {
    await upsertAccessoryStock({ sku: 'USB-C-20W', name: 'USB-C 20W Charger', quantity: 50, buyPrice: 3.5 });
    const r = await adjustAccessoryStock({ sku: 'USB-C-20W', delta: 5, reason: '' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('missing_reason');
  });

  it('rejects a zero delta and an unknown SKU', async () => {
    await upsertAccessoryStock({ sku: 'USB-C-20W', name: 'USB-C 20W Charger', quantity: 50, buyPrice: 3.5 });
    expect((await adjustAccessoryStock({ sku: 'USB-C-20W', delta: 0, reason: 'x' })).error).toBe('zero_delta');
    expect((await adjustAccessoryStock({ sku: 'NO-SUCH-SKU', delta: 1, reason: 'x' })).error).toBe('not_found');
  });
});

const accessorySale = (over: Partial<Sale> = {}): Sale => ({
  id: 'AMAZON__O-ACC-1__USB-C-20W-1',
  marketplace: 'AMAZON',
  orderNumber: 'O-ACC-1',
  sku: 'USB-C-20W',
  imei: '',
  unitId: '',
  supplierId: '',
  supplierName: '',
  saleDate: '2026-06-14',
  quantity: 2,
  buyPrice: 3.5,
  salePrice: 9.99,
  postage: 2.5,
  importBatchId: 't', sourceFile: 't', sourceRow: 1, ownerId: 'shared',
  createdAt: '2026-06-14T00:00:00Z', updatedAt: '2026-06-14T00:00:00Z',
  ...over,
} as any as Sale);

describe('returnAccessoryStock — voids the marketplace sale and restores its exact quantity', () => {
  it('voids the sale (voidedAt/voidOutcome/voidReason) and adds sale.quantity back, without touching totalReceived', async () => {
    await upsertAccessoryStock({ sku: 'USB-C-20W', name: 'USB-C 20W Charger', quantity: 50, buyPrice: 3.5 });
    await decrementAccessoryStock('USB-C-20W', 5);
    const sale = accessorySale({ quantity: 2 });
    col('sales').set(sale.id, { ...sale });

    const r = await returnAccessoryStock({ sku: 'USB-C-20W', saleId: sale.id, outcome: 'refund', reason: 'changed their mind' });
    expect(r.ok).toBe(true);
    expect(r.quantity).toBe(47); // 50 - 5 + 2 (the sale's own quantity, not a caller-chosen amount)
    expect(r.voidedSaleId).toBe(sale.id);
    expect(collections['accessoryStock'].get('usb_c_20w').totalReceived).toBe(50);

    const voided = collections['sales'].get(sale.id);
    expect(voided.voidedAt).toBeTruthy();
    expect(voided.voidOutcome).toBe('refund');
    expect(voided.voidReason).toBe('changed their mind');

    const event = accessoryEvents().find(e => e.type === 'return');
    expect(event).toMatchObject({ delta: 2, quantityAfter: 47, orderNumber: 'O-ACC-1', marketplace: 'AMAZON' });
  });

  it('auto-picks the most recent non-voided sale for the SKU when saleId is omitted', async () => {
    await upsertAccessoryStock({ sku: 'USB-C-20W', name: 'USB-C 20W Charger', quantity: 50, buyPrice: 3.5 });
    const older = accessorySale({ id: 'older', orderNumber: 'O-OLD', saleDate: '2026-06-01', quantity: 1 });
    const newer = accessorySale({ id: 'newer', orderNumber: 'O-NEW', saleDate: '2026-06-20', quantity: 3 });
    col('sales').set(older.id, { ...older });
    col('sales').set(newer.id, { ...newer });

    const r = await returnAccessoryStock({ sku: 'USB-C-20W', outcome: 'replacement' });
    expect(r.ok).toBe(true);
    expect(r.voidedSaleId).toBe(newer.id);
    expect(r.quantity).toBe(53); // 50 + 3 (the newer sale's quantity)
    expect(collections['sales'].get(newer.id).voidedAt).toBeTruthy();
    expect(collections['sales'].get(older.id).voidedAt).toBeFalsy();
  });

  it('rejects when no matching un-voided sale exists for the SKU', async () => {
    await upsertAccessoryStock({ sku: 'USB-C-20W', name: 'USB-C 20W Charger', quantity: 50, buyPrice: 3.5 });
    expect((await returnAccessoryStock({ sku: 'USB-C-20W', outcome: 'refund' })).error).toBe('no_matching_sale');

    const alreadyVoided = accessorySale({ id: 'gone', voidedAt: '2026-06-10', voidOutcome: 'refund' } as any);
    col('sales').set(alreadyVoided.id, { ...alreadyVoided });
    expect((await returnAccessoryStock({ sku: 'USB-C-20W', outcome: 'refund' })).error).toBe('no_matching_sale');
  });

  it('rejects an unknown SKU and a missing SKU', async () => {
    expect((await returnAccessoryStock({ sku: 'NO-SUCH-SKU', outcome: 'refund' })).error).toBe('not_found');
    expect((await returnAccessoryStock({ sku: '', outcome: 'refund' })).error).toBe('missing_sku');
  });
});

describe('recordAccessorySale — in-app single-line marketplace sale (Record a Sale → Accessories)', () => {
  it('writes a real Sale doc and decrements the pool by quantity', async () => {
    await upsertAccessoryStock({ sku: 'USB-C-20W', name: 'USB-C 20W Charger', quantity: 50, buyPrice: 3.5 });
    const r = await recordAccessorySale({
      sku: 'USB-C-20W', marketplace: 'AMAZON', orderNumber: 'MAN-1001',
      quantity: 3, salePrice: 29.97, saleDate: '2026-07-20',
    });
    expect(r.ok).toBe(true);
    expect(r.quantity).toBe(47); // 50 - 3
    expect(collections['accessoryStock'].get('usb_c_20w').quantity).toBe(47);
    expect(collections['accessoryStock'].get('usb_c_20w').totalReceived).toBe(50); // a sale never bumps totalReceived

    const sale = collections['sales'].get(r.saleId!);
    expect(sale).toBeDefined();
    expect(sale.sku).toBe('USB-C-20W');
    expect(sale.quantity).toBe(3);
    expect(sale.buyPrice).toBe(10.5); // 3.5/unit × 3 — line total, not per-unit
    expect(sale.salePrice).toBe(29.97);
    expect(sale.marketplace).toBe('AMAZON');
    expect(sale.orderNumber).toBe('MAN-1001');
    expect(sale.imei).toBeFalsy();
    expect(sale.unitId).toBeFalsy();
    expect(typeof sale.grossProfit).toBe('number'); // calcSaleFinancials ran

    const event = accessoryEvents().find(e => e.type === 'sale' && e.source === 'manual');
    expect(event).toMatchObject({ delta: -3, quantityAfter: 47, orderNumber: 'MAN-1001', marketplace: 'AMAZON' });
  });

  it('rejects a quantity greater than what is on hand — a typed one-off entry fails loudly, unlike bulk import', async () => {
    await upsertAccessoryStock({ sku: 'USB-C-20W', name: 'USB-C 20W Charger', quantity: 2, buyPrice: 3.5 });
    const r = await recordAccessorySale({
      sku: 'USB-C-20W', marketplace: 'EBAY', orderNumber: 'MAN-1002', quantity: 5, salePrice: 20,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('insufficient_stock');
    expect(collections['accessoryStock'].get('usb_c_20w').quantity).toBe(2); // untouched
  });

  it('rejects missing sku / marketplace / order number / invalid quantity / invalid price', async () => {
    await upsertAccessoryStock({ sku: 'USB-C-20W', name: 'USB-C 20W Charger', quantity: 10, buyPrice: 3.5 });
    expect((await recordAccessorySale({ sku: '', marketplace: 'EBAY', orderNumber: 'X', quantity: 1, salePrice: 5 })).error).toBe('missing_sku');
    expect((await recordAccessorySale({ sku: 'USB-C-20W', marketplace: '' as any, orderNumber: 'X', quantity: 1, salePrice: 5 })).error).toBe('missing_marketplace');
    expect((await recordAccessorySale({ sku: 'USB-C-20W', marketplace: 'EBAY', orderNumber: '', quantity: 1, salePrice: 5 })).error).toBe('missing_order_number');
    expect((await recordAccessorySale({ sku: 'USB-C-20W', marketplace: 'EBAY', orderNumber: 'X', quantity: 0, salePrice: 5 })).error).toBe('invalid_quantity');
    expect((await recordAccessorySale({ sku: 'USB-C-20W', marketplace: 'EBAY', orderNumber: 'X', quantity: 1, salePrice: 0 })).error).toBe('invalid_price');
  });

  it('rejects an unknown SKU', async () => {
    const r = await recordAccessorySale({ sku: 'NO-SUCH-SKU', marketplace: 'EBAY', orderNumber: 'X', quantity: 1, salePrice: 5 });
    expect(r.error).toBe('not_found');
  });
});
