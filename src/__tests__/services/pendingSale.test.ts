/**
 * Two-stage selling — the sales team records the order, the warehouse supplies
 * the handset.
 *
 * The tests that matter here are the ones about what must NOT happen at stage
 * 1, because every one of them would be a silent, expensive wrong answer:
 *
 *   - no unit may be marked sold (stock would vanish off the shelf on paper)
 *   - the sale must still carry full fees and VAT (the day's figures and the
 *     VAT return are computed from these rows the moment they exist)
 *   - two identical lines on one order must not overwrite each other
 *
 * And at stage 2, the money must be recomputed from the real handset. Leaving
 * the provisional buy price on a finished sale is the exact failure the
 * provisional flag exists to prevent.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const collections = new Map<string, Map<string, any>>();
const col = (name: string) => {
  if (!collections.has(name)) collections.set(name, new Map());
  return collections.get(name)!;
};

vi.mock('../../lib/dbService', () => {
  const dbService = {
    async create(c: string, id: string, data: any) { col(c).set(id, { ...data, id }); },
    async update(c: string, id: string, data: any) {
      col(c).set(id, { ...(col(c).get(id) ?? {}), ...data, id });
    },
    async delete(c: string, id: string) { col(c).delete(id); },
    async bulkCreate(entries: Array<{ collection: string; id: string; data: any }>) {
      for (const e of entries) col(e.collection).set(e.id, { ...e.data, id: e.id });
    },
    async readAll(c: string) { return Array.from(col(c).values()); },
    async getByImei(imei: string) {
      for (const u of col('inventoryUnits').values()) if (u.imei === imei) return u;
      return null;
    },
    async imeiExists() { return false; },
  };
  return { dbService };
});

vi.mock('../../lib/inventoryEvents', () => ({ logInventoryEvent: vi.fn(async () => {}) }));

import {
  recordPendingSale, linkImeiToPendingSale,
  pendingSales, pendingCountByModel, candidateUnitsFor, provisionalBuyPriceFor,
} from '../../services/pendingSaleService';

const unit = (over: Record<string, any>) => ({
  status: 'available', model: 'GALAXY S22', storage: '128GB', colour: 'Black',
  buyPrice: 140, ownerId: 'shared', createdAt: '', supplierId: 'sup-1',
  supplierName: 'NIHAL', ...over,
});

beforeEach(() => {
  collections.clear();
  col('inventoryUnits').set('u-cheap', unit({ id: 'u-cheap', imei: '350000000000001', buyPrice: 130 }));
  col('inventoryUnits').set('u-dear', unit({ id: 'u-dear', imei: '350000000000002', buyPrice: 160 }));
  col('inventoryUnits').set('u-other', unit({ id: 'u-other', imei: '350000000000003', model: 'IPHONE 14', buyPrice: 230 }));
});

const stage1 = (over: Record<string, any> = {}) => recordPendingSale({
  marketplace: 'AMAZON', orderNumber: 'AMZ-1', model: 'GALAXY S22',
  sku: 'SG-S22-128-BK', salePrice: 300, saleDate: '2026-08-12', ...over,
} as never);

describe('stage 1 — recorded by model, nothing sold', () => {
  it('NO unit is marked sold', async () => {
    const r = await stage1();
    expect(r.ok).toBe(true);
    const statuses = Array.from(col('inventoryUnits').values()).map(u => u.status);
    expect(statuses.every(s => s === 'available'), 'stock must not move at stage 1').toBe(true);
  });

  it('the sale carries no unit link at all', async () => {
    const r = await stage1();
    const sale = col('sales').get(r.saleId!);
    expect(sale.awaitingImei).toBe(true);
    expect(sale.unitId).toBeUndefined();
    expect(sale.imei).toBe('');
  });

  it('but IS financially complete — fees and VAT are there from the start', async () => {
    // The day's figures and the VAT return read these rows immediately. A
    // stage-1 sale that carried no fees would understate cost and overstate
    // profit for as long as it sat in the queue.
    const r = await stage1();
    const sale = col('sales').get(r.saleId!);
    expect(Number(sale.commission)).toBeGreaterThan(0);
    expect(Number(sale.totalVat)).not.toBeNaN();
    expect(Number(sale.salePrice)).toBe(300);
    expect(sale.model).toBe('GALAXY S22');
  });

  it('uses the CHEAPEST available unit as the provisional buy price', async () => {
    // Cheapest is the one choice that cannot flatter the figures.
    const r = await stage1();
    const sale = col('sales').get(r.saleId!);
    expect(sale.buyPrice).toBe(130);
    expect(sale.provisionalBuyPrice).toBe(true);
  });

  it('two identical lines on one order do not overwrite each other', async () => {
    // A customer buying two of the same phone is ordinary, and both share an
    // order number and SKU. Losing the second sale silently would be far worse
    // than an id that reads __2.
    const a = await stage1();
    const b = await stage1();
    expect(a.ok && b.ok).toBe(true);
    expect(b.saleId).not.toBe(a.saleId);
    expect(col('sales').size).toBe(2);
  });

  it('refuses the things the warehouse cannot recover from', async () => {
    expect((await stage1({ model: '' })).error).toBe('missing_model');
    expect((await stage1({ sku: '' })).error).toBe('missing_sku');
    expect((await stage1({ orderNumber: '' })).error).toBe('missing_order_number');
    expect((await stage1({ salePrice: 0 })).error).toBe('invalid_price');
  });
});

describe('stage 2 — the warehouse attaches a handset', () => {
  it('flips the unit and clears the pending markers', async () => {
    const r = await stage1();
    const res = await linkImeiToPendingSale({ saleId: r.saleId!, unitId: 'u-dear' });
    expect(res.ok).toBe(true);

    const sale = col('sales').get(r.saleId!);
    expect(sale.awaitingImei).toBe(false);
    expect(sale.unitId).toBe('u-dear');
    expect(sale.imei).toBe('350000000000002');
    expect(col('inventoryUnits').get('u-dear').status).toBe('sold');
  });

  it('recomputes the money from the REAL buy price', async () => {
    // The provisional £130 must not survive onto a finished sale.
    const r = await stage1();
    const before = col('sales').get(r.saleId!);
    await linkImeiToPendingSale({ saleId: r.saleId!, unitId: 'u-dear' });
    const after = col('sales').get(r.saleId!);

    expect(after.buyPrice).toBe(160);
    expect(after.provisionalBuyPrice).toBe(false);
    // A dearer handset means less profit — proof the figures actually moved
    // rather than the flag alone being flipped.
    expect(Number(after.grossProfit)).toBeLessThan(Number(before.grossProfit));
  });

  it('will not sell a unit that is not available', async () => {
    // Two warehouse users completing different orders with the same handset is
    // the realistic race, and it must not sell one phone twice.
    const a = await stage1();
    const b = await stage1({ orderNumber: 'AMZ-2' });
    expect((await linkImeiToPendingSale({ saleId: a.saleId!, unitId: 'u-dear' })).ok).toBe(true);
    const second = await linkImeiToPendingSale({ saleId: b.saleId!, unitId: 'u-dear' });
    expect(second.ok).toBe(false);
    expect(second.error).toBe('unit_not_available');
  });

  it('will not re-complete a sale that already has a handset', async () => {
    const r = await stage1();
    await linkImeiToPendingSale({ saleId: r.saleId!, unitId: 'u-dear' });
    const again = await linkImeiToPendingSale({ saleId: r.saleId!, unitId: 'u-cheap' });
    expect(again.error).toBe('not_pending');
    expect(col('inventoryUnits').get('u-cheap').status).toBe('available');
  });
});

describe('the queue helpers the UI reads', () => {
  it('candidateUnitsFor matches on model, ignoring brand-prefix spelling', async () => {
    col('inventoryUnits').set('u-prefixed', unit({
      id: 'u-prefixed', imei: '350000000000004', model: 'SAMSUNG GALAXY S22',
    }));
    const units = Array.from(col('inventoryUnits').values());
    const ids = candidateUnitsFor('GALAXY S22', units).map(u => u.id).sort();
    expect(ids, 'the prefixed spelling is the same phone').toContain('u-prefixed');
    expect(ids).not.toContain('u-other');
  });

  it('provisionalBuyPriceFor is 0 when nothing is in stock — no cost basis to quote', () => {
    expect(provisionalBuyPriceFor('NOT A REAL MODEL', Array.from(col('inventoryUnits').values()))).toBe(0);
  });

  it('pendingSales and pendingCountByModel report the shortfall the design accepts', async () => {
    await stage1();
    await stage1({ orderNumber: 'AMZ-2' });
    await stage1({ orderNumber: 'AMZ-3' });
    const sales = Array.from(col('sales').values());
    expect(pendingSales(sales)).toHaveLength(3);
    // Three sold against two in stock — the oversell this design surfaces
    // rather than prevents.
    const counts = pendingCountByModel(sales);
    expect([...counts.values()][0]).toBe(3);
    expect(candidateUnitsFor('GALAXY S22', Array.from(col('inventoryUnits').values()))).toHaveLength(2);
  });

  it('a completed sale leaves the queue', async () => {
    const r = await stage1();
    await linkImeiToPendingSale({ saleId: r.saleId!, unitId: 'u-dear' });
    expect(pendingSales(Array.from(col('sales').values()))).toHaveLength(0);
  });
});
