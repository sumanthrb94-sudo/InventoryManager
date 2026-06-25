/**
 * Locks the buildDeviceCatalog dedup fix against the operator's
 * 2026-06-20 audit. Before this fix, "GALAXY S23" + "S23" formed two
 * separate catalog entries because the local `normaliseModelKey` only
 * lowercased — it didn't strip the "Galaxy"/"Samsung" prefix. The
 * picker then showed two adjacent suggestions with split unit counts.
 *
 * Now buildDeviceCatalog uses `normalizeBucketModel` (shared with the
 * periodic-table dedup) so all prefix + case variants of one product
 * collapse to a single entry whose canonical display label is the
 * most-frequent raw variant in the cluster.
 */
import { describe, it, expect } from 'vitest';
import { buildDeviceCatalog, catalogEntryFor, type ModelSeed } from '../../lib/deviceCatalog';
import type { InventoryUnit } from '../../types';

function unit(id: string, brand: string, model: string, dateIn = '2026-06-15'): InventoryUnit {
  return {
    id, brand, model, imei: id,
    category: 'Other',
    colour: 'Black',
    buyPrice: 100, dateIn,
    supplierId: 's', supplierName: 'Test',
    status: 'available',
    flags: [], notes: '',
    platformListed: false, listingSites: [],
    ownerId: 'shared',
  } as InventoryUnit;
}

describe('buildDeviceCatalog — prefix + case dedup', () => {
  it('collapses GALAXY S23 / Galaxy S23 / S23 into one entry with summed count', () => {
    const units = [
      ...Array.from({ length: 5 }, (_, i) => unit(`a${i}`, 'Samsung', 'GALAXY S23')),
      ...Array.from({ length: 8 }, (_, i) => unit(`b${i}`, 'Samsung', 'Galaxy S23')),
      unit('c', 'Samsung', 'S23'),
    ];
    const catalog = buildDeviceCatalog(units);
    expect(catalog).toHaveLength(1);
    expect(catalog[0].count).toBe(14);
    // Canonical label = most-frequent raw variant ('Galaxy S23' wins).
    expect(catalog[0].model).toBe('Galaxy S23');
    expect(catalog[0].source).toBe('inventory');
  });

  it('keeps variant SUFFIXES distinct (S23 / S23 Ultra / S23 FE)', () => {
    const units = [
      unit('a', 'Samsung', 'Galaxy S23'),
      unit('b', 'Samsung', 'Galaxy S23 Ultra'),
      unit('c', 'Samsung', 'Galaxy S23 FE'),
    ];
    const catalog = buildDeviceCatalog(units);
    expect(catalog).toHaveLength(3);
    expect(new Set(catalog.map(e => e.model))).toEqual(
      new Set(['Galaxy S23', 'Galaxy S23 Ultra', 'Galaxy S23 FE']),
    );
  });

  it('merges admin-curated seeds with matching inventory clusters', () => {
    const units = [unit('u1', 'Samsung', 'Galaxy S26')];
    const seeds: ModelSeed[] = [
      { id: 'm1', brand: 'Samsung', model: 'S26' }, // collapses with the unit
      { id: 'm2', brand: 'Apple',   model: 'iPhone 18' }, // seed-only, no stock
    ];
    const catalog = buildDeviceCatalog(units, seeds);
    expect(catalog).toHaveLength(2);
    const s26 = catalog.find(e => e.brand === 'Samsung')!;
    expect(s26.count).toBe(1);             // one real unit
    expect(s26.source).toBe('inventory');  // not 'seed' because stock exists
    const iphone = catalog.find(e => e.brand === 'Apple')!;
    expect(iphone.count).toBe(0);
    expect(iphone.source).toBe('seed');
  });
});

describe('catalogEntryFor — case + prefix tolerance', () => {
  it('finds the cluster regardless of how the lookup string is cased', () => {
    const units = [unit('u', 'Samsung', 'Galaxy S23')];
    const catalog = buildDeviceCatalog(units);
    expect(catalogEntryFor(catalog, 'samsung', 'GALAXY S23')).toBeDefined();
    expect(catalogEntryFor(catalog, 'SAMSUNG', 'S23')).toBeDefined();
    expect(catalogEntryFor(catalog, 'Samsung', 's23')).toBeDefined();
  });
});
