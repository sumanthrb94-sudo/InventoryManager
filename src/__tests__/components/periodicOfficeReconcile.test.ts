/**
 * Does the periodic table's headline count actually equal the office stock?
 *
 * The question is worth asking because the count is not read off the unit
 * list — it is rolled up from the TILES that got rendered:
 *
 *   buildGroups → per-series groups → per-model buckets → totalCount
 *                                   → .filter(g => g.elements.length > 0)
 *
 * Every step in that chain is a place a unit can quietly fall out. A model
 * string that matches no brand pattern, a unit with no model at all, a
 * storage the parser cannot read, a returned unit that came back into stock —
 * any of those going missing would leave the operator staring at a number
 * that is smaller than what they physically hold, with nothing to indicate it.
 *
 * So this reconciles the two sides directly, against deliberately awkward
 * data. It is the same rule the sell sheet and the bulk-sale grid use for
 * "what is sellable", which is why the numbers are comparable at all.
 */
import { describe, it, expect } from 'vitest';
import { buildGroups, SERIES_GROUPS } from '../../components/PeriodicInventory';
import { parseBrandModelStorage } from '../../lib/modelStorage';
import type { InventoryUnit } from '../../types';

const u = (over: Partial<InventoryUnit> & { id: string }): InventoryUnit => ({
  status: 'available', model: 'IPHONE 13', sku: 'IP13-128', storage: '128GB',
  colour: 'MIDNIGHT', buyPrice: 200, supplierName: 'MHL', ownerId: 'shared',
  createdAt: '', updatedAt: '',
  ...over,
} as InventoryUnit);

/** Exactly what PeriodicInventory does: series from the live parser, falling
 *  back to the stored field, then 'Other'. */
const seriesOf = (unit: InventoryUnit): string => {
  const live = parseBrandModelStorage(unit.model || '').series;
  if (live && live !== 'Other') return live;
  return (unit as unknown as { series?: string }).series || 'Other';
};

/** Sum of every tile the table would draw — against the REAL row list, not a
 *  copy of it, so removing a row from the component fails these tests. */
const tiled = (units: InventoryUnit[]) =>
  buildGroups(units, [], SERIES_GROUPS, seriesOf)
    .reduce((n, g) => n + g.elements.reduce((m, el) => m + el.count, 0), 0);

/** The office stock rule, verbatim from PeriodicInventory and SellSheet. */
const inOffice = (units: InventoryUnit[]) => units.filter(unit =>
  unit.status === 'available'
  || (unit.returnType === 'returned_to_inventory' && unit.status !== 'sold'));

describe('the periodic table counts every unit in office stock', () => {
  it('a plain shelf of stock reconciles exactly', () => {
    const units = [
      u({ id: '1' }), u({ id: '2' }),
      u({ id: '3', model: 'GALAXY S22', storage: '128GB' }),
      u({ id: '4', model: 'PIXEL 7', storage: '128GB' }),
    ];
    expect(tiled(inOffice(units))).toBe(4);
  });

  it('counts a unit whose model matches no brand at all', () => {
    // This is the one that would silently vanish if 'Other' were not a row:
    // the operator holds the handset, and the table would say they do not.
    const units = [u({ id: '1' }), u({ id: 'odd', model: 'NOKIA 3310 CLASSIC' })];
    expect(tiled(inOffice(units))).toBe(2);
  });

  it('counts a unit with no model string whatsoever', () => {
    const units = [u({ id: '1' }), u({ id: 'blank', model: '' })];
    expect(tiled(inOffice(units))).toBe(2);
  });

  it('counts a unit with no storage', () => {
    const units = [u({ id: '1' }), u({ id: 'nostore', model: 'APPLE WATCH SE', storage: undefined })];
    expect(tiled(inOffice(units))).toBe(2);
  });

  it('counts a handset that came back into stock from a return', () => {
    // It is sellable — the sell sheet offers it — so the table must show it.
    const units = [
      u({ id: '1' }),
      u({ id: 'back', status: 'returned', returnType: 'returned_to_inventory' }),
    ];
    expect(inOffice(units)).toHaveLength(2);
    expect(tiled(inOffice(units))).toBe(2);
  });

  it('does NOT count what is not office stock — sold, lost, or supplier-held', () => {
    const units = [
      u({ id: 'keep' }),
      u({ id: 'sold', status: 'sold' }),
      u({ id: 'lost', status: 'lost' }),
      u({ id: 'shs', status: 'incoming' }),
      u({ id: 'resold', status: 'sold', returnType: 'returned_to_inventory' }),
    ];
    expect(tiled(inOffice(units))).toBe(1);
  });

  it('reconciles across a messy shelf of every awkward case at once', () => {
    const units = [
      ...Array.from({ length: 7 }, (_, i) => u({ id: `ip${i}` })),
      ...Array.from({ length: 3 }, (_, i) => u({ id: `s${i}`, model: 'GALAXY S21 ULTRA' })),
      u({ id: 'noModel', model: '' }),
      u({ id: 'unknownBrand', model: 'XIAOMI REDMI NOTE 12' }),
      u({ id: 'noStorage', model: 'IPHONE 13', storage: undefined }),
      u({ id: 'returned', status: 'returned', returnType: 'returned_to_inventory' }),
      u({ id: 'sold', status: 'sold' }),               // excluded
      u({ id: 'incoming', status: 'incoming' }),       // excluded
    ];
    const office = inOffice(units);
    expect(office).toHaveLength(14);   // 7 iPhones + 3 Galaxy + 4 awkward ones
    expect(tiled(office), 'every unit in office is on a tile').toBe(office.length);
  });

  it('the same model at two storages is two tiles but still one count each', () => {
    // Bucketing is by model+storage, so this checks the split does not
    // duplicate or lose a unit.
    const units = [
      u({ id: 'a', model: 'IPHONE 13', storage: '128GB' }),
      u({ id: 'b', model: 'IPHONE 13', storage: '256GB' }),
      u({ id: 'c', model: 'IPHONE 13', storage: '256GB' }),
    ];
    expect(tiled(units)).toBe(3);
  });

  it('units differing only by connectivity tag aggregate without loss', () => {
    // Tiles bucket by model+storage and IGNORE the tag, so three tagged
    // variants must land on one tile with a count of three — not one tile
    // with a count of one.
    const units = [
      u({ id: 'a', model: 'GALAXY A32 5G' }),
      u({ id: 'b', model: 'GALAXY A32 DUAL SIM' }),
      u({ id: 'c', model: 'GALAXY A32' }),
    ];
    expect(tiled(units)).toBe(3);
  });

  it('scales: 200 units of mixed provenance still reconcile', () => {
    const models = ['IPHONE 13', 'IPHONE 14', 'GALAXY S22', 'PIXEL 7', 'NOKIA 3310', ''];
    const units = Array.from({ length: 200 }, (_, i) => u({
      id: `u${i}`,
      model: models[i % models.length],
      storage: i % 3 === 0 ? undefined : ['64GB', '128GB', '256GB'][i % 3],
      status: i % 11 === 0 ? 'sold' : i % 13 === 0 ? 'incoming' : 'available',
    }));
    const office = inOffice(units);
    expect(office.length).toBeGreaterThan(150);
    expect(tiled(office)).toBe(office.length);
  });
});

describe('the SHS table counts every supplier-held unit', () => {
  const inShs = (units: InventoryUnit[]) => units.filter(x => x.status === 'incoming');

  it('reconciles, including units with no IMEI on file yet', () => {
    const units = [
      u({ id: 'a', status: 'incoming', imei: '' }),
      u({ id: 'b', status: 'incoming', imei: '', model: 'GALAXY S22' }),
      u({ id: 'c', status: 'incoming', imei: '', model: 'MYSTERY DEVICE' }),
      u({ id: 'office' }),                              // not SHS
    ];
    const shs = inShs(units);
    expect(shs).toHaveLength(3);
    expect(tiled(shs)).toBe(3);
  });
});
