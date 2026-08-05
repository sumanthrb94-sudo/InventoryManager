/**
 * Why the sold-out numbers on the Buy screen disagree — and why that is
 * correct.
 *
 * The operator saw three figures for what looked like one question:
 *
 *   Sold Out · Reorder        2   (Samsung S22 128GB, Apple iPhone 12 128GB)
 *   Out of Stock — Office     2   (the same two, on the periodic table)
 *   Out of Stock · 72h        1
 *   This Week Trending Sold   1   (S22 only)
 *
 * They are not one question. Two of them are lifetime and two are windowed,
 * and with the real data the window is exactly what separates them: the S22
 * sold today, the iPhone 12 128GB sold on 18 July. Eighteen days is inside
 * "ever" and outside both "last 72 hours" and "last 7 days".
 *
 * A headline reading 1 directly above a list of 2 is indistinguishable from a
 * bug unless something says why, which is what the tile's hint now does. This
 * pins the rule underneath it so the numbers cannot drift apart for a REAL
 * reason later and be dismissed as "that's just the window again".
 *
 * The dates below are the operator's own, from the screenshots.
 */
import { describe, it, expect } from 'vitest';
import { buildOutOfStockBuckets } from '../../components/BuySheet';
import type { InventoryUnit } from '../../types';

const TODAY = '2026-08-05';
const now = new Date(TODAY + 'T14:42:00Z').getTime();

const u = (over: Partial<InventoryUnit> & { id: string }): InventoryUnit => ({
  status: 'available', model: 'IPHONE 12', storage: '64GB', brand: 'Apple',
  colour: 'BLACK', buyPrice: 200, supplierName: 'MOBILE WHOLESALE LTD',
  ownerId: 'shared', createdAt: '', updatedAt: '',
  ...over,
} as InventoryUnit);

/** The operator's shelf, exactly as the two screenshots describe it. */
const SHELF: InventoryUnit[] = [
  // Sold out: one sold, none left. Sold TODAY.
  u({ id: 's22-sold', brand: 'Samsung', model: 'GALAXY S22', storage: '128GB',
      status: 'sold', saleDate: TODAY, supplierName: 'PHONEBOX DIRECT', buyPrice: 240 }),
  // Sold out: one sold, none left. Sold 18 days ago.
  u({ id: 'ip12-128-sold', model: 'IPHONE 12', storage: '128GB',
      status: 'sold', saleDate: '2026-07-18' }),
  // Running low, NOT sold out — a different storage of the same model.
  u({ id: 'ip12-64-a' }), u({ id: 'ip12-64-b' }),
  u({ id: 'ip12-64-sold', status: 'sold', saleDate: '2026-07-15' }),
  // Other low lines, none sold out.
  u({ id: 'ip13-a', model: 'IPHONE 13', storage: '128GB' }),
  u({ id: 'ip13-b', model: 'IPHONE 13', storage: '128GB' }),
];

/** Sold out, no time window — what Stock Alerts and the periodic table show. */
const soldOutEver = (units: InventoryUnit[]) =>
  buildOutOfStockBuckets(units, {})
    .filter(b => b.available === 0 && b.incoming === 0 && b.sold > 0);

/** Sold out AND the last sale falls inside the window — what the tile shows. */
const soldOutWithin = (units: InventoryUnit[], hours: number) => {
  const cutoff = now - hours * 60 * 60 * 1000;
  return soldOutEver(units).filter(b => {
    if (!b.lastSold) return false;
    const t = new Date(b.lastSold + 'T12:00:00').getTime();
    return Number.isFinite(t) && t >= cutoff;
  });
};

describe('the sold-out figures differ because of the window, not a defect', () => {
  it('lifetime finds both sold-out lines', () => {
    const labels = soldOutEver(SHELF).map(b => b.label).sort();
    expect(labels).toHaveLength(2);
    expect(labels.join(' | ')).toMatch(/S22/);
    expect(labels.join(' | ')).toMatch(/IPHONE 12 128GB/);
  });

  it('the 72-hour window finds only the one that sold today', () => {
    const labels = soldOutWithin(SHELF, 72).map(b => b.label);
    expect(labels, 'the iPhone 12 128GB sold 18 days ago').toHaveLength(1);
    expect(labels[0]).toMatch(/S22/);
  });

  it('a 7-day window agrees with the 72-hour one on this data', () => {
    // Which is why "This Week Trending Sold" shows the S22 alone.
    expect(soldOutWithin(SHELF, 24 * 7).map(b => b.label)).toEqual(
      soldOutWithin(SHELF, 72).map(b => b.label));
  });

  it('the windowed count is never larger than the lifetime one', () => {
    // The direction matters: a window can only ever hide lines, so a tile
    // reading HIGHER than the list below it would be a real defect.
    expect(soldOutWithin(SHELF, 72).length)
      .toBeLessThanOrEqual(soldOutEver(SHELF).length);
  });

  it('the same model at two storages is two different lines', () => {
    // The operator asked why the 128GB is out of stock when they hold 64GB.
    // Because those are different things to sell and different things to buy.
    const soldOut = soldOutEver(SHELF).map(b => b.label).join(' | ');
    expect(soldOut, 'the 128GB is gone').toMatch(/IPHONE 12 128GB/);
    expect(soldOut, 'the 64GB is not — two are on the shelf').not.toMatch(/IPHONE 12 64GB/);

    const sixtyFour = buildOutOfStockBuckets(SHELF, {})
      .find(b => b.label.includes('IPHONE 12 64GB'));
    expect(sixtyFour?.available, 'still holding two').toBe(2);
    expect(sixtyFour?.sold, 'and one of them did sell').toBe(1);
  });

  it('a line with stock on order from a supplier is not a reorder candidate', () => {
    // Nothing on the shelf, but the supplier is already sending one — buying
    // more would double-order.
    const withIncoming = [...SHELF,
      u({ id: 's22-incoming', brand: 'Samsung', model: 'GALAXY S22', storage: '128GB',
          status: 'incoming' })];
    expect(soldOutEver(withIncoming).map(b => b.label).join(' | ')).not.toMatch(/S22/);
  });

  it('a model that never sold is not sold out — it was never stocked out of', () => {
    const neverSold = [u({ id: 'x', model: 'IPHONE 15', storage: '128GB', status: 'lost' })];
    expect(soldOutEver(neverSold)).toHaveLength(0);
  });
});
