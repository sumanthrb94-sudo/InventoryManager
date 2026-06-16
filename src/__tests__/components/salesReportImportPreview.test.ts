/**
 * Pins the import preview's `inventoryFlips` list against the actual
 * post-import sync that buildPostImportSyncPatches runs. The two MUST
 * agree — the preview is the operator's only chance to spot a wrong
 * IMEI before the inventory KPI drops. If the gate in
 * buildPostImportSyncPatches ever changes (status filter, returned/
 * incoming exclusion, etc) and this test doesn't fail, the preview
 * starts lying to the operator.
 */
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { buildPreview } from '../../components/SalesReportImport';
import { buildPostImportSyncPatches } from '../../services/salesService';
import type { Sale, InventoryUnit, Marketplace } from '../../types';

const unit = (over: Partial<InventoryUnit>): InventoryUnit => ({
  id: 'u', imei: '1',
  model: 'iPhone 13 128GB', brand: 'Apple', category: 'iPhone', colour: 'Black',
  buyPrice: 200, dateIn: '2026-05-01',
  supplierId: 's', supplierName: 'MHL',
  status: 'available',
  flags: [], notes: '', platformListed: false, listingSites: [],
  ownerId: 'shared', createdAt: '2026-05-01T00:00:00Z',
  ...over,
});

const sale = (over: Partial<Sale> & { marketplace: Marketplace }): Sale => ({
  id: over.id ?? 'EBAY__O1__1',
  marketplace: over.marketplace,
  orderNumber: over.orderNumber ?? 'O1',
  imei: over.imei ?? '1',
  unitId: over.unitId ?? '',
  supplierId: over.supplierId ?? 's',
  supplierName: over.supplierName ?? 'MHL',
  saleDate: over.saleDate ?? '2026-06-13',
  quantity: 1,
  buyPrice: over.buyPrice ?? 200,
  salePrice: over.salePrice ?? 300,
  importBatchId: 't', sourceFile: 't', sourceRow: 1, ownerId: 'shared',
  createdAt: '2026-06-13T00:00:00Z', updatedAt: '2026-06-13T00:00:00Z',
  ...over,
});

describe('SalesReportImport preview ↔ buildPostImportSyncPatches parity', () => {
  it('inventoryFlips list matches the units the post-import sync would flip', () => {
    const units: InventoryUnit[] = [
      unit({ id: 'u-flip-1', imei: '111', status: 'available' }),
      unit({ id: 'u-flip-2', imei: '222', status: 'available', model: 'iPhone 12' }),
      // Already-sold unit — sync no-ops, preview must NOT flag it.
      unit({ id: 'u-sold',   imei: '333', status: 'sold' }),
      // Incoming SHS — sync skips, preview must NOT flag it.
      unit({ id: 'u-shs',    imei: '444', status: 'incoming' }),
      // Returned unit — sync skips, preview must NOT flag it.
      unit({ id: 'u-ret',    imei: '555', status: 'returned' }),
    ];

    const sales: Sale[] = [
      sale({ id: 'EBAY__O1__111',  marketplace: 'EBAY',   orderNumber: 'O1', imei: '111' }),
      sale({ id: 'AMAZON__O2__222', marketplace: 'AMAZON', orderNumber: 'O2', imei: '222' }),
      sale({ id: 'EBAY__O3__333',  marketplace: 'EBAY',   orderNumber: 'O3', imei: '333' }),
      sale({ id: 'EBAY__O4__444',  marketplace: 'EBAY',   orderNumber: 'O4', imei: '444' }),
      sale({ id: 'EBAY__O5__555',  marketplace: 'EBAY',   orderNumber: 'O5', imei: '555' }),
      // Voided — both sides ignore it.
      sale({ id: 'EBAY__O6__111',  marketplace: 'EBAY',   orderNumber: 'O6', imei: '111', voidedAt: '2026-06-13', voidOutcome: 'refund' }),
      // No IMEI on the sale — both sides skip.
      sale({ id: 'EBAY__O7__inapp', marketplace: 'EBAY',  orderNumber: 'O7', imei: '' }),
    ];

    const preview = buildPreview(
      { sales, perSheetCounts: { AMAZON: 0, BM: 0, EBAY: 0, ONBUY: 0 }, errors: [] },
      [],
      units,
    );
    const { unitPatches } = buildPostImportSyncPatches(sales, units);

    // Subset, not equality: the sync also backfills sale fields on
    // ALREADY-sold units (status==='sold' but salePrice/saleDate
    // mismatched), and those patches don't affect the stock count.
    // What MUST hold is that every previewed "flip to sold" is in fact
    // patched by the sync — the preview can't lie about what the import
    // will do. The sync may write MORE (the harmless backfills).
    const patchIds = new Set(unitPatches.map(p => p.id));
    for (const flip of preview.inventoryFlips) {
      expect(patchIds.has(flip.unitId), `previewed flip ${flip.unitId} must also be in sync's patch set`).toBe(true);
    }
    // And the sync's set is a superset only by sold-unit backfills —
    // assert the extra entries are all units already at status='sold'.
    const previewedIds = new Set(preview.inventoryFlips.map(f => f.unitId));
    const byId = new Map(units.map(u => [u.id, u]));
    for (const p of unitPatches) {
      if (previewedIds.has(p.id)) continue;
      const u = byId.get(p.id);
      expect(u?.status, `sync patched ${p.id} but it wasn't previewed — only sold-unit backfills are allowed`).toBe('sold');
    }

    // Specific assertions on what landed.
    expect(preview.inventoryFlips).toHaveLength(2);
    const ids = new Set(preview.inventoryFlips.map(f => f.unitId));
    expect(ids.has('u-flip-1')).toBe(true);
    expect(ids.has('u-flip-2')).toBe(true);
    expect(ids.has('u-sold')).toBe(false);
    expect(ids.has('u-shs')).toBe(false);
    expect(ids.has('u-ret')).toBe(false);

    // Preview surfaces the marketplace + order + price so the operator can
    // sanity-check the row that's about to flip.
    const flip1 = preview.inventoryFlips.find(f => f.unitId === 'u-flip-1')!;
    expect(flip1.marketplace).toBe('EBAY');
    expect(flip1.saleOrderId).toBe('O1');
    expect(flip1.salePrice).toBe(300);
    expect(flip1.model).toBe('iPhone 13 128GB');
  });

  it('returns an empty inventoryFlips list when nothing would change', () => {
    const units = [unit({ id: 'u1', imei: '1', status: 'sold' })];
    const sales = [sale({ id: 'EBAY__O__1', marketplace: 'EBAY', imei: '1' })];
    const preview = buildPreview(
      { sales, perSheetCounts: { AMAZON: 0, BM: 0, EBAY: 0, ONBUY: 0 }, errors: [] },
      [],
      units,
    );
    expect(preview.inventoryFlips).toEqual([]);
  });

  it('dedupes per unit even when multiple sales target the same IMEI', () => {
    const units = [unit({ id: 'u1', imei: '1', status: 'available' })];
    const sales = [
      sale({ id: 'EBAY__A__1',   marketplace: 'EBAY',   imei: '1' }),
      sale({ id: 'AMAZON__B__1', marketplace: 'AMAZON', imei: '1' }),
    ];
    const preview = buildPreview(
      { sales, perSheetCounts: { AMAZON: 0, BM: 0, EBAY: 0, ONBUY: 0 }, errors: [] },
      [],
      units,
    );
    expect(preview.inventoryFlips).toHaveLength(1);
    expect(preview.inventoryFlips[0].unitId).toBe('u1');
  });
});

describe('SalesReportImport preview — stale combined multi-IMEI cleanup', () => {
  it('flags existing combined docs for the imported order as stale', () => {
    // DB already holds a combined doc (imei = "A / B") for order O-BULK,
    // written by the old parser. The new upload splits it into two per-IMEI
    // rows. The combined doc must be queued for deletion.
    const existing: Sale[] = [
      sale({
        id: 'AMAZON__O-BULK__A_B', marketplace: 'AMAZON', orderNumber: 'O-BULK',
        imei: '351554748581221 / 351554746670497', salePrice: 169.78,
      }),
    ];
    const split: Sale[] = [
      sale({ id: 'AMAZON__O-BULK__351554748581221', marketplace: 'AMAZON', orderNumber: 'O-BULK', imei: '351554748581221', salePrice: 84.89 }),
      sale({ id: 'AMAZON__O-BULK__351554746670497', marketplace: 'AMAZON', orderNumber: 'O-BULK', imei: '351554746670497', salePrice: 84.89 }),
    ];
    const preview = buildPreview(
      { sales: split, perSheetCounts: { AMAZON: 2, BM: 0, EBAY: 0, ONBUY: 0 }, errors: [] },
      existing,
      [],
    );
    expect(preview.staleCombined).toHaveLength(1);
    expect(preview.staleCombined[0].id).toBe('AMAZON__O-BULK__A_B');
    // The split rows are brand-new ids → toCreate, not toUpdate.
    expect(preview.toCreate).toHaveLength(2);
  });

  it('collapses duplicate combined docs (two import dates) for the same order', () => {
    // Same bulk order imported twice with slightly different IMEI-cell text →
    // two combined docs under different ids. Both must be purged.
    const existing: Sale[] = [
      sale({ id: 'AMAZON__O-DUP__A_B_14', marketplace: 'AMAZON', orderNumber: 'O-DUP', imei: '111111111111111 / 222222222222222', saleDate: '2026-06-14', salePrice: 539.96 }),
      sale({ id: 'AMAZON__O-DUP__A_B_15', marketplace: 'AMAZON', orderNumber: 'O-DUP', imei: '111111111111111 / 222222222222222 / 333333333333333', saleDate: '2026-06-15', salePrice: 539.96 }),
    ];
    const split: Sale[] = [
      sale({ id: 'AMAZON__O-DUP__111111111111111', marketplace: 'AMAZON', orderNumber: 'O-DUP', imei: '111111111111111' }),
      sale({ id: 'AMAZON__O-DUP__222222222222222', marketplace: 'AMAZON', orderNumber: 'O-DUP', imei: '222222222222222' }),
      sale({ id: 'AMAZON__O-DUP__333333333333333', marketplace: 'AMAZON', orderNumber: 'O-DUP', imei: '333333333333333' }),
    ];
    const preview = buildPreview(
      { sales: split, perSheetCounts: { AMAZON: 3, BM: 0, EBAY: 0, ONBUY: 0 }, errors: [] },
      existing,
      [],
    );
    expect(preview.staleCombined.map(s => s.id).sort()).toEqual(
      ['AMAZON__O-DUP__A_B_14', 'AMAZON__O-DUP__A_B_15'],
    );
  });

  it('flags sales whose IMEI has no matching inventory unit (orphan list)', () => {
    // Two sales: one IMEI matches a unit, the other doesn't. Only the
    // orphan should appear in noInventory; voided sales never do.
    const units = [unit({ id: 'u1', imei: '111', status: 'available' })];
    const split: Sale[] = [
      sale({ id: 'EBAY__O-OK__111',  marketplace: 'EBAY',  orderNumber: 'O-OK',  imei: '111' }),
      sale({ id: 'AMAZON__O-NO__222', marketplace: 'AMAZON', orderNumber: 'O-NO', imei: '222' }),
      // Voided + orphan — expected to be skipped, the unit might have been returned out.
      sale({ id: 'EBAY__O-V__333', marketplace: 'EBAY', orderNumber: 'O-V', imei: '333', voidedAt: '2026-06-13', voidOutcome: 'refund' }),
      // No IMEI at all — can't be auto-added, skip.
      sale({ id: 'EBAY__O-X__inapp', marketplace: 'EBAY', orderNumber: 'O-X', imei: '' }),
    ];
    const preview = buildPreview(
      { sales: split, perSheetCounts: { AMAZON: 1, BM: 0, EBAY: 3, ONBUY: 0 }, errors: [] },
      [],
      units,
    );
    expect(preview.noInventory).toHaveLength(1);
    expect(preview.noInventory[0].imei).toBe('222');
    expect(preview.noInventory[0].orderNumber).toBe('O-NO');
    expect(preview.noInventory[0].marketplace).toBe('AMAZON');
  });

  it('returns an empty orphan list when every IMEI matches a unit', () => {
    const units = [
      unit({ id: 'u1', imei: '111', status: 'available' }),
      unit({ id: 'u2', imei: '222', status: 'sold' }),
    ];
    const split: Sale[] = [
      sale({ id: 'EBAY__O1__111', marketplace: 'EBAY', orderNumber: 'O1', imei: '111' }),
      sale({ id: 'EBAY__O2__222', marketplace: 'EBAY', orderNumber: 'O2', imei: '222' }),
    ];
    const preview = buildPreview(
      { sales: split, perSheetCounts: { AMAZON: 0, BM: 0, EBAY: 2, ONBUY: 0 }, errors: [] },
      [],
      units,
    );
    expect(preview.noInventory).toEqual([]);
  });

  it('never touches single-IMEI docs or orders absent from the upload', () => {
    const existing: Sale[] = [
      // Single-IMEI doc — no "/", must be left alone even if order matches.
      sale({ id: 'EBAY__O1__1', marketplace: 'EBAY', orderNumber: 'O1', imei: '1' }),
      // Combined doc for an order NOT in this upload — must be left alone.
      sale({ id: 'EBAY__OTHER__A_B', marketplace: 'EBAY', orderNumber: 'OTHER', imei: '111 / 222' }),
    ];
    const split: Sale[] = [
      sale({ id: 'EBAY__O1__1', marketplace: 'EBAY', orderNumber: 'O1', imei: '1' }),
    ];
    const preview = buildPreview(
      { sales: split, perSheetCounts: { AMAZON: 0, BM: 0, EBAY: 1, ONBUY: 0 }, errors: [] },
      existing,
      [],
    );
    expect(preview.staleCombined).toEqual([]);
  });
});
