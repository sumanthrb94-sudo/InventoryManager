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
  completeUnitBuyInfo,
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
});

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
