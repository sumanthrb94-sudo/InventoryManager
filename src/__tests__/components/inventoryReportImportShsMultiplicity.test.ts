/**
 * SHS (supplier-held) rows have no IMEI, so a re-upload can only recognise
 * "the same holding" by (model, supplier, BP, dateIn). A bulk order of N
 * identical phones — same model, same supplier, same buy price, same
 * intake date — is an entirely ordinary case, not a contrived edge case,
 * and N real, distinct existing units can legitimately share that exact
 * tuple.
 *
 * The matching used to be a plain `Map<key, unit>`, which only ever
 * remembers the LAST unit seen for a given key. Every one of the N rows
 * sharing that key would then resolve to that SAME single unit:
 *   - N-1 of the real existing units silently never got written to again —
 *     any correction made to "row 2 of 5" in the spreadsheet would land on
 *     whichever unit happened to be last in Firestore's return order,
 *     never on unit #2 specifically.
 *   - Worse: if the file had MORE matching rows than existing units for
 *     that key (an operator adding genuinely new stock to an existing
 *     line), every extra row still showed as "to update" against the
 *     already-claimed unit instead of falling through to "to create" —
 *     so the new units were silently never created at all.
 *
 * The fix treats existing units sharing a key as a pool and consumes one
 * distinct unit per matching row (in file order), only falling through to
 * "to create" once the pool for that key is exhausted.
 */
import { describe, it, expect } from 'vitest';
import { buildPreview } from '../../components/InventoryReportImport';
import type { ParsedRow } from '../../lib/inventoryImportParse';
import type { InventoryUnit, Supplier } from '../../types';

function shsRow(overrides: Partial<ParsedRow> = {}): ParsedRow {
  return {
    rowNum: 2,
    dateIn: '2026-07-02',
    model: 'SAMSUNG GALAXY A56',
    imei: '',
    grade: 'ONU',
    storage: '256GB',
    simType: '',
    colour: 'Black',
    supplier: 'MHL',
    buyPrice: 218,
    stockType: 'shs',
    notes: '',
    errors: [],
    ...overrides,
  };
}

function shsUnit(overrides: Partial<InventoryUnit> = {}): InventoryUnit {
  return {
    id: 'manual_shs_1',
    imei: '',
    model: 'SAMSUNG GALAXY A56',
    rawModel: 'SAMSUNG GALAXY A56',
    brand: 'Samsung',
    category: 'phone',
    colour: 'Black',
    storage: '256GB',
    buyPrice: 218,
    dateIn: '2026-07-02',
    supplierId: 'sup1',
    supplierName: 'MHL',
    status: 'incoming',
    ...overrides,
  } as InventoryUnit;
}

const MHL_SUPPLIER: Supplier[] = [{ id: 'sup1', name: 'MHL', portal: 'Direct' } as Supplier];

describe('InventoryReportImport buildPreview — SHS multiplicity (bulk-identical holdings)', () => {
  it('3 identical existing SHS units + 3 matching rows: all 3 update, each against a DISTINCT unit', () => {
    const existing = [
      shsUnit({ id: 'manual_shs_1' }),
      shsUnit({ id: 'manual_shs_2' }),
      shsUnit({ id: 'manual_shs_3' }),
    ];
    const rows = [
      shsRow({ rowNum: 2 }),
      shsRow({ rowNum: 3 }),
      shsRow({ rowNum: 4 }),
    ];
    const preview = buildPreview(rows, existing, MHL_SUPPLIER, new Set());

    expect(preview.toUpdate).toHaveLength(3);
    expect(preview.toCreate).toHaveLength(0);

    const matchedIds = rows.map(r => preview.shsMatches.get(r.rowNum)?.id);
    expect(matchedIds).toEqual(['manual_shs_1', 'manual_shs_2', 'manual_shs_3']);
    // Every row must map to a DIFFERENT existing doc — this is the crux of
    // the bug: the old code would have every one of these equal 'manual_shs_3'.
    expect(new Set(matchedIds).size).toBe(3);
  });

  it('3 identical existing SHS units + 5 matching rows: 3 update against the 3 real units, the 2 EXTRA genuinely create (not silently lost)', () => {
    const existing = [
      shsUnit({ id: 'manual_shs_1' }),
      shsUnit({ id: 'manual_shs_2' }),
      shsUnit({ id: 'manual_shs_3' }),
    ];
    const rows = [2, 3, 4, 5, 6].map(rowNum => shsRow({ rowNum }));
    const preview = buildPreview(rows, existing, MHL_SUPPLIER, new Set());

    expect(preview.toUpdate).toHaveLength(3);
    expect(preview.toCreate).toHaveLength(2);

    const updatedRowNums = preview.toUpdate.map(r => r.rowNum).sort();
    const createdRowNums = preview.toCreate.map(r => r.rowNum).sort();
    expect(updatedRowNums).toEqual([2, 3, 4]);
    expect(createdRowNums).toEqual([5, 6]);

    const matchedIds = preview.toUpdate.map(r => preview.shsMatches.get(r.rowNum)?.id).sort();
    expect(matchedIds).toEqual(['manual_shs_1', 'manual_shs_2', 'manual_shs_3']);
  });

  it('5 identical existing SHS units + only 2 matching rows: 2 update against 2 distinct units, the other 3 existing units are simply left untouched', () => {
    const existing = [1, 2, 3, 4, 5].map(n => shsUnit({ id: `manual_shs_${n}` }));
    const rows = [shsRow({ rowNum: 2 }), shsRow({ rowNum: 3 })];
    const preview = buildPreview(rows, existing, MHL_SUPPLIER, new Set());

    expect(preview.toUpdate).toHaveLength(2);
    expect(preview.toCreate).toHaveLength(0);
    const matchedIds = rows.map(r => preview.shsMatches.get(r.rowNum)?.id);
    expect(new Set(matchedIds).size).toBe(2);
  });

  it('two DIFFERENT SHS lines (different models) never cross-consume each other\'s pool', () => {
    const existing = [
      shsUnit({ id: 'a56_1', model: 'SAMSUNG GALAXY A56', rawModel: 'SAMSUNG GALAXY A56' }),
      shsUnit({ id: 'a56_2', model: 'SAMSUNG GALAXY A56', rawModel: 'SAMSUNG GALAXY A56' }),
      shsUnit({ id: 'a36_1', model: 'SAMSUNG GALAXY A36', rawModel: 'SAMSUNG GALAXY A36', buyPrice: 203 }),
    ];
    const rows = [
      shsRow({ rowNum: 2, model: 'SAMSUNG GALAXY A56' }),
      shsRow({ rowNum: 3, model: 'SAMSUNG GALAXY A56' }),
      shsRow({ rowNum: 4, model: 'SAMSUNG GALAXY A36', buyPrice: 203 }),
    ];
    const preview = buildPreview(rows, existing, MHL_SUPPLIER, new Set());

    expect(preview.toUpdate).toHaveLength(3);
    expect(preview.shsMatches.get(2)?.id).toMatch(/^a56_/);
    expect(preview.shsMatches.get(3)?.id).toMatch(/^a56_/);
    expect(preview.shsMatches.get(2)?.id).not.toBe(preview.shsMatches.get(3)?.id);
    expect(preview.shsMatches.get(4)?.id).toBe('a36_1');
  });

  it('a single existing SHS unit + a single matching row still updates normally (no regression on the common case)', () => {
    const preview = buildPreview([shsRow({ rowNum: 2 })], [shsUnit()], MHL_SUPPLIER, new Set());
    expect(preview.toUpdate).toHaveLength(1);
    expect(preview.toCreate).toHaveLength(0);
    expect(preview.shsMatches.get(2)?.id).toBe('manual_shs_1');
  });
});
