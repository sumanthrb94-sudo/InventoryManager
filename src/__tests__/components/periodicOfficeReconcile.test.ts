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

/**
 * THE UNIFIED TABLE
 *
 * One table, one tile per model, carrying BOTH quantities — what is in the
 * office and what a supplier is holding — with lines the operator has run out
 * of still present and reading zero.
 *
 * The split tables could not be reconciled by eye. A model with 2 in office
 * and 3 on order lived on two tables that never showed each other; a model
 * with none of either lived on a third. "How many of these do we have" could
 * not be answered from one screen — and the sales data is too messy to answer
 * it from the other end, which is exactly why the intake side has to be exact.
 *
 * So the arithmetic must hold in both directions: every office unit counted
 * once and only once, every supplier-held unit likewise, and neither counted
 * on the other's side.
 */
describe('the unified table carries both quantities, exactly', () => {
  const unified = (office: InventoryUnit[], shs: InventoryUnit[], sold: InventoryUnit[] = []) =>
    buildGroups(office, shs, SERIES_GROUPS, seriesOf, { zeroFrom: sold });

  const totals = (groups: ReturnType<typeof unified>) => ({
    office: groups.reduce((n, g) => n + g.elements.reduce((m, el) => m + el.count, 0), 0),
    shs: groups.reduce((n, g) => n + g.elements.reduce((m, el) => m + el.shsCount, 0), 0),
    tiles: groups.reduce((n, g) => n + g.elements.length, 0),
    zeroTiles: groups.reduce(
      (n, g) => n + g.elements.filter(el => el.count === 0 && el.shsCount === 0).length, 0),
  });

  it('counts office and supplier-held separately, and both exactly', () => {
    const office = [u({ id: 'o1' }), u({ id: 'o2' }), u({ id: 'o3', model: 'GALAXY S22' })];
    const shs = [
      u({ id: 's1', status: 'incoming' }),
      u({ id: 's2', status: 'incoming', model: 'PIXEL 7' }),
    ];
    const t = totals(unified(office, shs));
    expect(t.office).toBe(3);
    expect(t.shs).toBe(2);
  });

  it('puts both quantities on the SAME tile when it is the same model', () => {
    // The whole point: 2 in office and 3 on order is one line reading 2 (+3),
    // not two lines on two tables that never show each other.
    const groups = unified(
      [u({ id: 'o1' }), u({ id: 'o2' })],
      [u({ id: 's1', status: 'incoming' }), u({ id: 's2', status: 'incoming' }),
       u({ id: 's3', status: 'incoming' })],
    );
    const tiles = groups.flatMap(g => g.elements);
    expect(tiles, 'one model, one tile').toHaveLength(1);
    expect(tiles[0]).toMatchObject({ count: 2, shsCount: 3 });
  });

  it('shows a sold-out model as zero rather than dropping it off the table', () => {
    // A missing tile is indistinguishable from a line never stocked. A zero
    // tile is a fact the operator can act on.
    const groups = unified(
      [u({ id: 'o1', model: 'IPHONE 13' })],
      [],
      [u({ id: 'gone', model: 'IPHONE 11', status: 'sold' })],
    );
    const tiles = groups.flatMap(g => g.elements);
    expect(tiles).toHaveLength(2);
    const soldOut = tiles.find(t => t.model.includes('11'));
    expect(soldOut, 'the sold-out model is still on the table').toBeTruthy();
    expect(soldOut).toMatchObject({ count: 0, shsCount: 0 });
  });

  it('does not zero a model that sold SOME but still has stock', () => {
    const groups = unified(
      [u({ id: 'o1' }), u({ id: 'o2' })],
      [],
      [u({ id: 'sold', status: 'sold' })],          // same model
    );
    const tiles = groups.flatMap(g => g.elements);
    expect(tiles, 'one tile, not a duplicate zero one').toHaveLength(1);
    expect(tiles[0].count, 'the sold unit does not reduce the count').toBe(2);
  });

  it('a model held ONLY by a supplier reads zero in office, not absent', () => {
    const groups = unified([], [u({ id: 's1', status: 'incoming', model: 'PIXEL 7' })]);
    const tiles = groups.flatMap(g => g.elements);
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toMatchObject({ count: 0, shsCount: 1 });
  });

  it('reconciles a full messy shelf — office, SHS, sold out, unknown models', () => {
    const office = [
      ...Array.from({ length: 6 }, (_, i) => u({ id: `o${i}` })),
      u({ id: 'oOdd', model: 'NOKIA 3310' }),
      u({ id: 'oBlank', model: '' }),
      u({ id: 'oBack', status: 'returned', returnType: 'returned_to_inventory' }),
    ];
    const shs = [
      ...Array.from({ length: 4 }, (_, i) => u({ id: `s${i}`, status: 'incoming', imei: '' })),
      u({ id: 'sOdd', status: 'incoming', model: 'XIAOMI 13' }),
    ];
    const sold = [
      u({ id: 'x1', model: 'IPHONE 11', status: 'sold' }),
      u({ id: 'x2', model: 'IPHONE 11', status: 'sold' }),   // same model, one tile
      u({ id: 'x3', model: 'GALAXY S10', status: 'sold' }),
    ];
    const t = totals(unified(office, shs, sold));
    expect(t.office, 'every office unit counted once').toBe(office.length);
    expect(t.shs, 'every supplier-held unit counted once').toBe(shs.length);
    expect(t.zeroTiles, 'two sold-out models, deduped').toBe(2);
  });

  it('scales: 300 units across all three states still reconcile exactly', () => {
    const models = ['IPHONE 13', 'IPHONE 14', 'GALAXY S22', 'PIXEL 7', 'NOKIA 3310', ''];
    const all = Array.from({ length: 300 }, (_, i) => u({
      id: `u${i}`,
      model: models[i % models.length],
      storage: i % 3 === 0 ? undefined : ['64GB', '128GB', '256GB'][i % 3],
      status: i % 7 === 0 ? 'sold' : i % 5 === 0 ? 'incoming' : 'available',
    }));
    const office = all.filter(x => x.status === 'available');
    const shs = all.filter(x => x.status === 'incoming');
    const sold = all.filter(x => x.status === 'sold');

    const t = totals(unified(office, shs, sold));
    expect(t.office).toBe(office.length);
    expect(t.shs).toBe(shs.length);
    // Nothing double-counted: office + SHS across every tile is exactly what
    // is physically on hand anywhere.
    expect(t.office + t.shs).toBe(office.length + shs.length);
  });

  it('never counts a sold unit as stock, however it arrives', () => {
    const sold = Array.from({ length: 20 }, (_, i) => u({ id: `s${i}`, status: 'sold' }));
    const t = totals(unified([], [], sold));
    expect(t.office).toBe(0);
    expect(t.shs).toBe(0);
    expect(t.tiles, 'they are on the table, at zero').toBeGreaterThan(0);
  });

  it('rolls the group totals up to the same numbers as the tiles', () => {
    // The header reads off the unit lists; the row labels read off the tiles.
    // If those disagree the operator sees two answers on one screen.
    const office = [u({ id: 'o1' }), u({ id: 'o2', model: 'GALAXY S22' })];
    const shs = [u({ id: 's1', status: 'incoming', model: 'GALAXY S22' })];
    const groups = unified(office, shs);
    for (const g of groups) {
      expect(g.totalCount).toBe(g.elements.reduce((n, el) => n + el.count, 0));
      expect(g.totalShs).toBe(g.elements.reduce((n, el) => n + el.shsCount, 0));
    }
    expect(groups.reduce((n, g) => n + g.totalCount, 0)).toBe(office.length);
    expect(groups.reduce((n, g) => n + g.totalShs, 0)).toBe(shs.length);
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
