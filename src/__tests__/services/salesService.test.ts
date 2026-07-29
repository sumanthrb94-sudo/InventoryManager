/**
 * Integration tests for the sales service layer (recordSale / voidSale).
 *
 * Mocks `src/lib/dbService` with an in-memory implementation so we can exercise
 * the composite-id dedupe, unit status-flip, and calcSaleFinancials wiring
 * end-to-end without booting Firebase.
 *
 * Convention reference: src/__tests__/regressions.test.ts (kept untouched).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { InventoryUnit } from '../../types';

// ── In-memory dbService mock ───────────────────────────────────────────────

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
  };
  return { dbService };
});

// Import AFTER the mock is registered.
import { recordSale, voidSale, recordBulkSales, type BulkSaleLine } from '../../services/salesService';
import { calcSaleFinancials } from '../../lib/platforms';
import type { AccessoryStock } from '../../types';

// ── Helpers ────────────────────────────────────────────────────────────────

const goodImei = '356938035643809';

function clearAll() {
  for (const name of Object.keys(collections)) collections[name].clear();
}

function seedAccessory(over: Partial<AccessoryStock> = {}): AccessoryStock {
  const acc: AccessoryStock = {
    id: over.id ?? 'sku_charger', // matches slugify('SKU-CHARGER') in recordAccessorySale's lookup
    sku: over.sku ?? 'SKU-CHARGER',
    name: over.name ?? 'USB-C Charger',
    supplierId: 'sup_existing',
    supplierName: 'MHL',
    quantity: 10,
    totalReceived: 10,
    buyPrice: 5,
    ownerId: 'shared',
    createdAt: '2026-05-01T00:00:00Z',
    ...over,
  } as AccessoryStock;
  col('accessoryStock').set(acc.id, acc);
  return acc;
}

function seedUnit(over: Partial<InventoryUnit> = {}): InventoryUnit {
  const unit: InventoryUnit = {
    id: over.id ?? goodImei,
    imei: over.imei ?? goodImei,
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

beforeEach(() => {
  clearAll();
});

// ───────────────────────────────────────────────────────────────────────────
// recordSale
// ───────────────────────────────────────────────────────────────────────────

describe('recordSale', () => {
  it('happy path — writes the sale doc and flips the unit to sold + stamps sale fields', async () => {
    const unit = seedUnit();

    const r = await recordSale({
      marketplace: 'EBAY',
      orderNumber: 'ORD-001',
      imei: unit.imei,
      buyPrice: unit.buyPrice,
      salePrice: 400,
    });

    expect(r.ok).toBe(true);
    expect(r.saleId).toBe(`EBAY__ORD-001__${goodImei}`);

    // Sale doc was written.
    const sale = col('sales').get(`EBAY__ORD-001__${goodImei}`);
    expect(sale).toBeDefined();
    expect(sale.marketplace).toBe('EBAY');
    expect(sale.orderNumber).toBe('ORD-001');
    expect(sale.unitId).toBe(unit.id);
    expect(sale.imei).toBe(unit.imei);
    expect(sale.salePrice).toBe(400);

    // Unit was flipped to sold with sale provenance stamped on.
    const after = col('inventoryUnits').get(unit.id);
    expect(after.status).toBe('sold');
    expect(after.salePrice).toBe(400);
    expect(after.salePlatform).toBe('EBAY');
    expect(after.saleOrderId).toBe('ORD-001');
    expect(after.saleDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('stamps stockSource=office on a live sale of an office unit that never carried one', async () => {
    const unit = seedUnit({ status: 'available', stockSource: undefined });
    await recordSale({
      marketplace: 'EBAY', orderNumber: 'ORD-OFFICE', imei: unit.imei,
      buyPrice: unit.buyPrice, salePrice: 400,
    });
    expect(col('inventoryUnits').get(unit.id).stockSource).toBe('office');
  });

  it('stamps stockSource=shs on a live sale of an SHS unit (status incoming) with none set', async () => {
    // Mirrors a real SHS unit sold live via SellOrderModal's isSHS flow —
    // the operator types the IMEI at sale time, same recordSale() call as
    // an office sale, but the unit started life as status='incoming'.
    const unit = seedUnit({ status: 'incoming', stockSource: undefined });
    await recordSale({
      marketplace: 'EBAY', orderNumber: 'ORD-SHS', imei: unit.imei,
      buyPrice: unit.buyPrice, salePrice: 400,
    });
    expect(col('inventoryUnits').get(unit.id).stockSource).toBe('shs');
  });

  it('preserves an existing stockSource rather than re-deriving it', async () => {
    const unit = seedUnit({ status: 'available', stockSource: 'shs' as any });
    await recordSale({
      marketplace: 'EBAY', orderNumber: 'ORD-PRESERVE', imei: unit.imei,
      buyPrice: unit.buyPrice, salePrice: 400,
    });
    expect(col('inventoryUnits').get(unit.id).stockSource).toBe('shs');
  });

  it('uses composite doc id `${marketplace}__${orderNumber}` as natural dedupe key', async () => {
    const unit = seedUnit();
    const r = await recordSale({
      marketplace: 'AMAZON',
      orderNumber: 'A-12345',
      imei: unit.imei,
      buyPrice: 100,
      salePrice: 250,
    });
    expect(r.ok).toBe(true);
    expect(r.saleId).toBe(`AMAZON__A-12345__${goodImei}`);
    expect(col('sales').get(`AMAZON__A-12345__${goodImei}`)).toBeDefined();
  });

  it('rejects when orderNumber is empty / whitespace-only', async () => {
    seedUnit();
    const r = await recordSale({
      marketplace: 'EBAY',
      orderNumber: '   ',
      imei: goodImei,
      buyPrice: 100,
      salePrice: 250,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('missing_order_number');
    expect(col('sales').size).toBe(0);
  });

  it('rejects sale price <= 0', async () => {
    seedUnit();
    const zero = await recordSale({
      marketplace: 'EBAY',
      orderNumber: 'ORD-Z',
      imei: goodImei,
      buyPrice: 100,
      salePrice: 0,
    });
    expect(zero.ok).toBe(false);
    expect(zero.error).toBe('invalid_price');

    const neg = await recordSale({
      marketplace: 'EBAY',
      orderNumber: 'ORD-N',
      imei: goodImei,
      buyPrice: 100,
      salePrice: -5,
    });
    expect(neg.ok).toBe(false);
    expect(neg.error).toBe('invalid_price');

    expect(col('sales').size).toBe(0);
  });

  it('rejects when the inventory unit cannot be found', async () => {
    // No seedUnit() call — inventory is empty.
    const r = await recordSale({
      marketplace: 'EBAY',
      orderNumber: 'ORD-NF',
      imei: goodImei,
      buyPrice: 100,
      salePrice: 250,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('missing_unit');
    expect(col('sales').size).toBe(0);
  });

  it('runs calcSaleFinancials and stores derived GP / commission', async () => {
    const unit = seedUnit({ buyPrice: 200 });

    const r = await recordSale({
      marketplace: 'AMAZON',
      orderNumber: 'A-FIN',
      imei: unit.imei,
      buyPrice: 200,
      salePrice: 300,
    });
    expect(r.ok).toBe(true);

    const expected = calcSaleFinancials({
      marketplace: 'AMAZON',
      buyPrice: 200,
      salePrice: 300,
      hasPayPalKlarna: false,
    });

    const sale = col('sales').get(`AMAZON__A-FIN__${goodImei}`);
    expect(sale.spMinusBp).toBe(expected.spMinusBp);
    expect(sale.marginalTax).toBe(expected.marginalTax);
    expect(sale.commission).toBe(expected.commission);
    expect(sale.grossProfit).toBe(expected.grossProfit);
    expect(sale.gpPercent).toBe(expected.gpPercent);
    expect(sale.postage).toBe(expected.postage);
  });

  it('looks the unit up via unitId when no imei is supplied', async () => {
    const unit = seedUnit({ id: 'custom_unit_id', imei: '' });
    const r = await recordSale({
      marketplace: 'EBAY',
      orderNumber: 'ORD-UNIT-ID',
      unitId: unit.id,
      buyPrice: 100,
      salePrice: 250,
    });
    expect(r.ok).toBe(true);
    expect(col('inventoryUnits').get(unit.id)!.status).toBe('sold');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// voidSale
// ───────────────────────────────────────────────────────────────────────────

describe('voidSale', () => {
  it('deletes the sale row and reverts the unit back to available', async () => {
    const unit = seedUnit();
    // Record a sale first.
    const sold = await recordSale({
      marketplace: 'EBAY',
      orderNumber: 'ORD-V',
      imei: unit.imei,
      buyPrice: 200,
      salePrice: 400,
    });
    expect(sold.ok).toBe(true);
    expect(col('inventoryUnits').get(unit.id)!.status).toBe('sold');

    const r = await voidSale(sold.saleId!, 'customer cancelled');
    expect(r.ok).toBe(true);

    // Sale row removed.
    expect(col('sales').get(sold.saleId!)).toBeUndefined();
    // Unit reverted, sale fields cleared.
    const reverted = col('inventoryUnits').get(unit.id);
    expect(reverted.status).toBe('available');
    expect(reverted.salePrice).toBeNull();
    expect(reverted.saleDate).toBeNull();
    expect(reverted.salePlatform).toBeNull();
    expect(reverted.saleOrderId).toBeNull();
  });

  it('returns ok=false when the sale id is missing or unknown', async () => {
    const empty = await voidSale('', 'reason');
    expect(empty.ok).toBe(false);

    const unknown = await voidSale('EBAY__does-not-exist', 'reason');
    expect(unknown.ok).toBe(false);
    expect(unknown.message).toMatch(/not found/i);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// recordBulkSales
// ───────────────────────────────────────────────────────────────────────────

describe('recordBulkSales', () => {
  it('records a mixed batch of office, SHS, and accessory lines in one call', async () => {
    const office = seedUnit({ id: 'office-1', imei: '111111111111111', status: 'available' });
    const shs = seedUnit({ id: 'shs-1', imei: '', status: 'incoming' });
    const accessory = seedAccessory();

    const batch: BulkSaleLine[] = [
      { kind: 'unit', unit: office, isSHS: false, marketplace: 'EBAY', orderNumber: 'ORD-OFFICE', salePrice: 300 },
      { kind: 'unit', unit: shs, isSHS: true, imei: '222222222222222', marketplace: 'AMAZON', orderNumber: 'ORD-SHS', salePrice: 350 },
      { kind: 'accessory', sku: accessory.sku, quantity: 2, marketplace: 'ONBUY', orderNumber: 'ORD-ACC', salePrice: 20 },
    ];

    const result = await recordBulkSales(batch);

    expect(result.succeeded).toBe(3);
    expect(result.failed).toBe(0);
    expect(result.results.every(r => r.ok)).toBe(true);

    // Office unit sold.
    expect(col('inventoryUnits').get('office-1').status).toBe('sold');
    expect(col('inventoryUnits').get('office-1').stockSource).toBe('office');

    // SHS unit: IMEI stamped BEFORE the sale, then flipped to sold.
    const soldShs = col('inventoryUnits').get('shs-1');
    expect(soldShs.imei).toBe('222222222222222');
    expect(soldShs.status).toBe('sold');
    expect(soldShs.stockSource).toBe('shs');

    // Accessory pool decremented by the batch quantity.
    expect(col('accessoryStock').get(accessory.id).quantity).toBe(8);
    const accSale = col('sales').get(`ONBUY__ORD-ACC__${accessory.sku}`);
    expect(accSale.quantity).toBe(2);
    expect(accSale.salePrice).toBe(20);
  });

  it('does not abort the batch when one line fails — reports per-line results', async () => {
    const office = seedUnit({ id: 'office-2', imei: '333333333333333', status: 'available' });
    const shsNoImei = seedUnit({ id: 'shs-2', imei: '', status: 'incoming' });

    const batch: BulkSaleLine[] = [
      { kind: 'unit', unit: office, isSHS: false, marketplace: 'EBAY', orderNumber: 'ORD-OK', salePrice: 300 },
      // No imei supplied for an SHS unit with none on file — must fail without
      // touching the first (already-succeeded) line.
      { kind: 'unit', unit: shsNoImei, isSHS: true, marketplace: 'EBAY', orderNumber: 'ORD-BAD', salePrice: 200 },
    ];

    const result = await recordBulkSales(batch);

    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.results[0].ok).toBe(true);
    expect(result.results[1].ok).toBe(false);
    expect(result.results[1].error).toBe('missing_imei');

    expect(col('inventoryUnits').get('office-2').status).toBe('sold');
    expect(col('inventoryUnits').get('shs-2').status).toBe('incoming');
  });

  it('rejects a duplicate IMEI already on file for another unit', async () => {
    seedUnit({ id: 'existing-owner', imei: '444444444444444', status: 'sold' });
    const shs = seedUnit({ id: 'shs-3', imei: '', status: 'incoming' });

    const result = await recordBulkSales([
      { kind: 'unit', unit: shs, isSHS: true, imei: '444444444444444', marketplace: 'EBAY', orderNumber: 'ORD-DUP', salePrice: 200 },
    ]);

    expect(result.failed).toBe(1);
    expect(result.results[0].error).toBe('duplicate_imei');
    expect(col('inventoryUnits').get('shs-3').status).toBe('incoming');
  });

  it('returns an empty summary for an empty batch', async () => {
    const result = await recordBulkSales([]);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.results).toEqual([]);
  });
});
