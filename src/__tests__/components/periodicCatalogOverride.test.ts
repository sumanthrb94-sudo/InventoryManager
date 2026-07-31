/**
 * Locks the periodic table's admin-catalog override: PeriodicInventory
 * previously never consulted the admin's curated model catalog at all —
 * bucketing/display was derived purely by regex-parsing the raw stored
 * `unit.model`. buildGroups now accepts an optional `catalogIndex`
 * (built via modelReconciliation's buildCatalogIndex) and, when a
 * (brand, model) matches an entry, uses the admin's canonical spelling
 * for both the bucket key AND the tile label — so two units of the same
 * seeded model, spelled differently, collapse into one tile.
 */
import { describe, it, expect } from 'vitest';
import { buildGroups } from '../../components/PeriodicInventory';
import { buildCatalogIndex } from '../../lib/modelReconciliation';
import type { InventoryUnit } from '../../types';

const GROUP_COLOR = { bg: '#000', light: '#fff', text: '#000', border: '#000' };
const GROUP_DEFS = [{ id: 'g1', label: 'Group', color: GROUP_COLOR }];
const assignToG1 = () => 'g1';

function unit(id: string, brand: string, model: string, storage = '128GB'): InventoryUnit {
  return {
    id, brand, model, storage,
    imei: id,
    category: 'Other',
    colour: 'Black',
    buyPrice: 100,
    dateIn: '2026-07-01',
    supplierId: 's', supplierName: 'Test',
    status: 'available',
    flags: [], notes: '', platformListed: false, listingSites: [],
    ownerId: 'shared',
  } as InventoryUnit;
}

describe('buildGroups — admin catalog override', () => {
  it('collapses two differently-spelled units of the same seeded model into one tile', () => {
    const catalogIndex = buildCatalogIndex([{ brand: 'Samsung', model: 'Galaxy S23 Ultra' }]);
    const units = [
      unit('u1', 'Samsung', 'S23 Ultra'),
      unit('u2', 'Samsung', 'GALAXY S23 ULTRA'),
    ];
    const [group] = buildGroups(units, [], GROUP_DEFS, assignToG1, { catalogIndex });
    expect(group.elements).toHaveLength(1);
    expect(group.elements[0].model).toBe('Galaxy S23 Ultra');
    expect(group.elements[0].count).toBe(2);
  });

  it('with no catalogIndex passed, falls back to today\'s regex-only bucketing unchanged', () => {
    const units = [unit('u1', 'Samsung', 'S23 Ultra'), unit('u2', 'Samsung', 'GALAXY S23 ULTRA')];
    const [group] = buildGroups(units, [], GROUP_DEFS, assignToG1);
    // Same normalizeBucketModel folding already merges these regardless of
    // the catalog — this just proves passing no catalogIndex doesn't throw
    // or otherwise change existing behaviour.
    expect(group.elements).toHaveLength(1);
  });

  it('an unseeded model is completely unaffected by a populated catalogIndex', () => {
    const catalogIndex = buildCatalogIndex([{ brand: 'Samsung', model: 'Galaxy S23 Ultra' }]);
    const units = [unit('u1', 'Google', 'Pixel 8 Pro')];
    const [group] = buildGroups(units, [], GROUP_DEFS, assignToG1, { catalogIndex });
    expect(group.elements[0].model).toBe('Pixel 8 Pro');
  });

  it('regression: passing options WITHOUT an explicit valueFn must not crash', () => {
    // buildGroups' value-getter option is named `valueFn`, deliberately NOT
    // `valueOf` — every plain object literal inherits Object.prototype.valueOf,
    // so a `valueOf`-named option would make `opts?.valueOf ?? default` silently
    // pick up the INHERITED method instead of falling back, which then gets
    // called as a bare function and throws, caught by buildGroups' own
    // try/catch as an empty result. `{ catalogIndex }` alone (the exact shape
    // every new call site in this fix passes) must still produce a real,
    // non-empty tile.
    const catalogIndex = buildCatalogIndex([]);
    const units = [unit('u1', 'Samsung', 'Galaxy S23')];
    const [group] = buildGroups(units, [], GROUP_DEFS, assignToG1, { catalogIndex });
    expect(group.elements).toHaveLength(1);
    expect(group.elements[0].value).toBe(100); // real buyPrice-based default, not 0/NaN
  });
});
