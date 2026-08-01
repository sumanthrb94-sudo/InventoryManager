/**
 * The backfill exists because decodeSkuAttributes only runs when a sale
 * CREATES a unit. The nine on the operator's Orphans list already existed,
 * and a re-import never revisits them: an IMEI already in inventory takes
 * the matched path, and the audit gate only asks for IMEI / model / supplier
 * / buy price, so a unit missing just storage and colour never surfaces.
 */
import { describe, it, expect } from 'vitest';
import {
  findUnitAttributeBackfill,
  applyUnitAttributeBackfill,
} from '../../lib/migrations/backfillUnitAttributesFromSku';
import { isOrphanSoldUnit } from '../../components/OrphanUnitsModal';

/** The nine exactly as they sit in the operator's database. */
const NINE = [
  { id: '1', model: '3-40-MN',       sku: 'AW SE 3-40-MN' },
  { id: '2', model: '3-40-MN',       sku: 'AW SE 3-40-MN' },
  { id: '3', model: '3-40-MN',       sku: 'AW SE 3-40-MN' },
  { id: '4', model: '3-40-MN',       sku: 'AW SE 3-40-MN' },
  { id: '5', model: '3-44-SL',       sku: 'AW SE-3-44-SL' },
  { id: '6', model: '3-44-SL',       sku: 'AW SE-3-44-SL' },
  { id: '7', model: 'Galaxy A21S',   sku: 'Samsung Galaxy A21S' },
  { id: '8', model: 'Galaxy A21S',   sku: 'Samsung Galaxy A21S' },
  { id: '9', model: 'Galaxy XCOVER', sku: 'Samsung Galaxy XCOVER' },
].map(u => ({ ...u, status: 'sold', colour: 'Unknown' }));

const applied = () => {
  const drift = findUnitAttributeBackfill(NINE);
  return NINE.map(u => {
    const p = drift.patches.find(x => x.id === u.id);
    return { ...u, saleDate: '2026-07-28', ...(p ? p.after : {}) } as any;
  });
};

describe('the nine clear after the backfill', () => {
  it('all nine are orphans beforehand', () => {
    expect(NINE.map(u => ({ ...u, saleDate: '2026-07-28' } as any)).filter(isOrphanSoldUnit)).toHaveLength(9);
  });

  it('none are orphans afterwards', () => {
    expect(applied().filter(isOrphanSoldUnit)).toHaveLength(0);
  });

  it('gives the watches a real model name and the colour from the SKU', () => {
    const after = applied();
    expect(after[0].model).toBe('Apple Watch SE 3 40mm');
    expect(after[0].colour).toBe('Midnight');
    expect(after[4].model).toBe('Apple Watch SE 3 44mm');
    expect(after[4].colour).toBe('Silver');
  });

  it('gives the A21S its confirmed 32GB', () => {
    expect(applied()[6].storage).toBe('32GB');
  });

  it('leaves XCover capacity blank — it ships in two, so it is not guessed', () => {
    const x = applied()[8];
    expect(x.storage).toBeUndefined();
    expect(x.colour).toBe('Unspecified');
  });
});

describe('it never overwrites real data', () => {
  it('keeps a human-readable model', () => {
    const d = findUnitAttributeBackfill([
      { id: 'a', sku: 'AW SE 3-40-MN', model: 'Apple Watch SE (operator edit)', status: 'sold', colour: 'Black' },
    ]);
    expect(d.patches).toHaveLength(0);
  });

  it('keeps an existing storage', () => {
    const d = findUnitAttributeBackfill([
      { id: 'a', sku: 'Samsung Galaxy A21S', model: 'Galaxy A21S', storage: '64GB', status: 'sold', colour: 'Black' },
    ]);
    expect(d.patches).toHaveLength(0);
  });

  it('keeps an operator-chosen colour', () => {
    const d = findUnitAttributeBackfill([
      { id: 'a', sku: 'AW SE 3-40-MN', model: '3-40-MN', status: 'sold', colour: 'Starlight' },
    ]);
    expect(d.patches[0].after.colour).toBeUndefined();
    expect(d.patches[0].after.model).toBe('Apple Watch SE 3 40mm');
  });

  it('ignores units that are not sold, and units with no SKU', () => {
    expect(findUnitAttributeBackfill([
      { id: 'a', sku: 'AW SE 3-40-MN', model: '3-40-MN', status: 'available', colour: 'Unknown' },
      { id: 'b', model: '3-40-MN', status: 'sold', colour: 'Unknown' },
    ]).patches).toHaveLength(0);
  });

  it('is idempotent — a second pass finds nothing', () => {
    expect(findUnitAttributeBackfill(applied()).patches).toHaveLength(0);
  });
});

describe('applyUnitAttributeBackfill', () => {
  it('writes only the resolved fields, as a merge', async () => {
    const writes: any[] = [];
    const db = { bulkCreate: async (e: any[]) => { writes.push(...e); } };
    const drift = findUnitAttributeBackfill([
      { id: 'u1', sku: 'AW SE 3-40-MN', model: '3-40-MN', status: 'sold', colour: 'Unknown' },
    ]);
    const res = await applyUnitAttributeBackfill(drift, db);
    expect(res.updated).toBe(1);
    expect(writes[0].collection).toBe('inventoryUnits');
    expect(writes[0].data).toEqual({ model: 'Apple Watch SE 3 40mm', colour: 'Midnight' });
  });

  it('writes nothing when there is nothing to do', async () => {
    let called = false;
    await applyUnitAttributeBackfill({ patches: [] }, { bulkCreate: async () => { called = true; } });
    expect(called).toBe(false);
  });
});
