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
import { buildPreview, auditRowMissing } from '../../components/SalesReportImport';
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

describe('auditRowMissing — supplier bar', () => {
  const row = (supplierName: string) => ({
    imei: '350000000000444', model: 'Galaxy A32', supplierName,
    buyPrice: 30, salePrice: 49.99, saleDate: '2026-07-08',
    marketplace: 'EBAY', orderNumber: 'O-1',
  });

  it('a single character is NOT a supplier — it is a half-typed name', () => {
    // Any non-empty value used to satisfy the gate, so a row could be
    // confirmed mid-word with "M" saved as the supplier.
    expect(auditRowMissing(row('M'))).toContain('supplier');
  });

  it('two characters or more is accepted', () => {
    expect(auditRowMissing(row('AB'))).not.toContain('supplier');
    expect(auditRowMissing(row('MOBILE KIT'))).not.toContain('supplier');
  });

  it('whitespace alone is still missing', () => {
    expect(auditRowMissing(row('   '))).toContain('supplier');
  });
});

describe('SalesReportImport preview ↔ buildPostImportSyncPatches parity', () => {
  it('inventoryFlips list matches the units the post-import sync would flip', () => {
    const units: InventoryUnit[] = [
      unit({ id: 'u-flip-1', imei: '111', status: 'available' }),
      unit({ id: 'u-flip-2', imei: '222', status: 'available', model: 'iPhone 12' }),
      // Already-sold unit — sync no-ops, preview must NOT flag it.
      unit({ id: 'u-sold',   imei: '333', status: 'sold' }),
      // Incoming SHS — selling it FULFILS from the supplier, so it DOES flip.
      unit({ id: 'u-shs',    imei: '444', status: 'incoming' }),
      // Returned unit — re-sale cycle, sync skips, preview must NOT flag it.
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
      { sales, perSheetCounts: { AMAZON: 0, BM: 0, EBAY: 0, ONBUY: 0, TEMU: 0 }, errors: [] },
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

    // Specific assertions on what landed: 2 office + 1 SHS = 3 fulfilments.
    expect(preview.inventoryFlips).toHaveLength(3);
    const ids = new Set(preview.inventoryFlips.map(f => f.unitId));
    expect(ids.has('u-flip-1')).toBe(true);
    expect(ids.has('u-flip-2')).toBe(true);
    expect(ids.has('u-shs')).toBe(true);      // incoming unit fulfils on sale
    expect(ids.has('u-sold')).toBe(false);
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
      { sales, perSheetCounts: { AMAZON: 0, BM: 0, EBAY: 0, ONBUY: 0, TEMU: 0 }, errors: [] },
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
      { sales, perSheetCounts: { AMAZON: 0, BM: 0, EBAY: 0, ONBUY: 0, TEMU: 0 }, errors: [] },
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
      { sales: split, perSheetCounts: { AMAZON: 2, BM: 0, EBAY: 0, ONBUY: 0, TEMU: 0 }, errors: [] },
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
      { sales: split, perSheetCounts: { AMAZON: 3, BM: 0, EBAY: 0, ONBUY: 0, TEMU: 0 }, errors: [] },
      existing,
      [],
    );
    expect(preview.staleCombined.map(s => s.id).sort()).toEqual(
      ['AMAZON__O-DUP__A_B_14', 'AMAZON__O-DUP__A_B_15'],
    );
  });

  it('flags an orphan device sale as a record to complete (CREATE path)', () => {
    // u1 is complete (model/supplier/BP from the unit() helper) → it just
    // flips, NOT a completion row. The second IMEI has no unit → orphan
    // completion row. Voided + no-IMEI sales are out of scope. Real-format
    // 15-digit IMEIs throughout — a fake short one like '111' now correctly
    // fails the format check added for the placeholder/legacy-combined-IMEI
    // gap (see auditRowMissing), which would confuse what this test pins.
    const units = [unit({ id: 'u1', imei: '350000000000111', status: 'available' })];
    const split: Sale[] = [
      sale({ id: 'EBAY__O-OK__111',  marketplace: 'EBAY',  orderNumber: 'O-OK',  imei: '350000000000111' }),
      sale({ id: 'AMAZON__O-NO__222', marketplace: 'AMAZON', orderNumber: 'O-NO', imei: '350000000000222' }),
      sale({ id: 'EBAY__O-V__333', marketplace: 'EBAY', orderNumber: 'O-V', imei: '350000000000333', voidedAt: '2026-06-13', voidOutcome: 'refund' }),
      sale({ id: 'EBAY__O-X__inapp', marketplace: 'EBAY', orderNumber: 'O-X', imei: '' }),
    ];
    const preview = buildPreview(
      { sales: split, perSheetCounts: { AMAZON: 1, BM: 0, EBAY: 3, ONBUY: 0, TEMU: 0 }, errors: [] },
      [],
      units,
    );
    expect(preview.recordsToComplete).toHaveLength(1);
    const row = preview.recordsToComplete[0];
    expect(row.imei).toBe('350000000000222');
    expect(row.orderNumber).toBe('O-NO');
    expect(row.marketplace).toBe('AMAZON');
    expect(row.existingUnitId).toBeUndefined();   // CREATE path
  });

  it('pre-fills an orphan\'s Model AND Storage from the SKU column, split into their own fields (own-export round trip)', () => {
    // The app's OWN Sales Report export writes the resolved friendly model
    // name into the SKU column (e.g. "Samsung Galaxy A32 64GB"), not a
    // dash-delimited operator code. normalizeOperatorSku bails on anything
    // containing whitespace (real names carry spaces), so without a
    // fallback to the raw SKU, every row of a downloaded-then-reimported
    // file would come back with the Model field blank — exactly what broke
    // a full wipe+reimport round trip.
    //
    // The seed is now run through parseBrandModelStorage, so the brand and
    // the storage are lifted OUT of the model field rather than left fused
    // into it. Seeding the literal "Samsung Galaxy A32 64GB" as the model
    // is what created units carrying brand+storage inside their name — the
    // store's reparse gate then leaves such a name alone forever, because
    // it correctly refuses to rewrite anything that isn't a raw SKU code.
    const split: Sale[] = [
      sale({ id: 'AMAZON__O-CLEAN__1', marketplace: 'AMAZON', orderNumber: 'O-CLEAN', imei: '350000000000444', sku: 'Samsung Galaxy A32 64GB' }),
    ];
    const preview = buildPreview(
      { sales: split, perSheetCounts: { AMAZON: 1, BM: 0, EBAY: 0, ONBUY: 0, TEMU: 0 }, errors: [] },
      [],
      [],
    );
    expect(preview.recordsToComplete).toHaveLength(1);
    expect(preview.recordsToComplete[0].model).toBe('Galaxy A32');
    // Storage used to arrive blank on an orphan row, because only a matched
    // inventory unit could supply it. It now comes off the SKU.
    expect(preview.recordsToComplete[0].storage).toBe('64GB');
    expect(auditRowMissing(preview.recordsToComplete[0])).not.toContain('model');
  });

  it('snaps a seeded model to the admin catalog spelling when one matches', () => {
    // The whole point of passing the catalog in: a final re-import should
    // land names matching what the operator curated, not a second spelling
    // that then has to be reconciled afterwards.
    const split: Sale[] = [
      sale({ id: 'AMAZON__O-CAT__1', marketplace: 'AMAZON', orderNumber: 'O-CAT', imei: '350000000000777', sku: 'SAMSUNG GALAXY A32 64GB' }),
    ];
    const preview = buildPreview(
      { sales: split, perSheetCounts: { AMAZON: 1, BM: 0, EBAY: 0, ONBUY: 0, TEMU: 0 }, errors: [] },
      [],
      [],
      [{ brand: 'Samsung', model: 'Galaxy A32' }] as any,
    );
    expect(preview.recordsToComplete[0].model).toBe('Galaxy A32');
  });

  it('re-separates a qualifier fused onto the model number by the marketplace export', () => {
    // "S205G" is a real value seen in the client's data — the export dropped
    // the space. Left alone it buckets separately from "Galaxy S20 5G".
    const split: Sale[] = [
      sale({ id: 'AMAZON__O-FUSED__1', marketplace: 'AMAZON', orderNumber: 'O-FUSED', imei: '350000000000888', sku: 'Samsung Galaxy S205G 128GB' }),
    ];
    const preview = buildPreview(
      { sales: split, perSheetCounts: { AMAZON: 1, BM: 0, EBAY: 0, ONBUY: 0, TEMU: 0 }, errors: [] },
      [],
      [],
    );
    expect(preview.recordsToComplete[0].model).toBe('Galaxy S20');
    expect(preview.recordsToComplete[0].storage).toBe('128GB');
  });

  it('still leaves Model blank for an unrecognised dash-coded SKU with no spaces (forces a deliberate pick)', () => {
    const split: Sale[] = [
      sale({ id: 'AMAZON__O-CODE__1', marketplace: 'AMAZON', orderNumber: 'O-CODE', imei: '350000000000555', sku: 'XYZ-UNKNOWN-CODE' }),
    ];
    const preview = buildPreview(
      { sales: split, perSheetCounts: { AMAZON: 1, BM: 0, EBAY: 0, ONBUY: 0, TEMU: 0 }, errors: [] },
      [],
      [],
    );
    expect(preview.recordsToComplete).toHaveLength(1);
    expect(preview.recordsToComplete[0].model).toBe('');
  });

  it('flags a matched-but-incomplete unit as a record to complete (PATCH path)', () => {
    // Unit exists for IMEI 111 but has BP=0 and a blank supplier — selling it
    // would write an audit-incomplete sold record, so it must be completed.
    const units = [unit({ id: 'u1', imei: '111', status: 'available', buyPrice: 0, supplierName: '' })];
    const split: Sale[] = [
      sale({ id: 'EBAY__O1__111', marketplace: 'EBAY', orderNumber: 'O1', imei: '111' }),
    ];
    const preview = buildPreview(
      { sales: split, perSheetCounts: { AMAZON: 0, BM: 0, EBAY: 1, ONBUY: 0, TEMU: 0 }, errors: [] },
      [],
      units,
    );
    expect(preview.recordsToComplete).toHaveLength(1);
    expect(preview.recordsToComplete[0].existingUnitId).toBe('u1');  // PATCH path
  });

  it('returns an empty completion list when every sold record is audit-complete', () => {
    const units = [
      unit({ id: 'u1', imei: '350000000000111', status: 'available' }),
      unit({ id: 'u2', imei: '350000000000222', status: 'sold' }),
    ];
    const split: Sale[] = [
      sale({ id: 'EBAY__O1__111', marketplace: 'EBAY', orderNumber: 'O1', imei: '350000000000111' }),
      sale({ id: 'EBAY__O2__222', marketplace: 'EBAY', orderNumber: 'O2', imei: '350000000000222' }),
    ];
    const preview = buildPreview(
      { sales: split, perSheetCounts: { AMAZON: 0, BM: 0, EBAY: 2, ONBUY: 0, TEMU: 0 }, errors: [] },
      [],
      units,
    );
    expect(preview.recordsToComplete).toEqual([]);
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
      { sales: split, perSheetCounts: { AMAZON: 0, BM: 0, EBAY: 1, ONBUY: 0, TEMU: 0 }, errors: [] },
      existing,
      [],
    );
    expect(preview.staleCombined).toEqual([]);
  });

  it('purges blank-IMEI legacy duplicates when the upload provides per-IMEI replacements', () => {
    // Field scenario: order 026-6081380-8104355 + 204-0877891-0211532 sit in
    // the DB as N rows with blank IMEI (from an earlier import where the
    // bulk-order IMEI cell arrived empty). The new upload now carries
    // proper per-IMEI rows for the same orders — the blank dupes must be
    // purged so the per-IMEI rows are the only docs that survive.
    const existing: Sale[] = [
      sale({ id: 'AMAZON__O-BULK__r28', marketplace: 'AMAZON', orderNumber: 'O-BULK', imei: '' }),
      sale({ id: 'AMAZON__O-BULK__r29', marketplace: 'AMAZON', orderNumber: 'O-BULK', imei: '' }),
    ];
    const split: Sale[] = [
      sale({ id: 'AMAZON__O-BULK__111111111111111', marketplace: 'AMAZON', orderNumber: 'O-BULK', imei: '111111111111111' }),
      sale({ id: 'AMAZON__O-BULK__222222222222222', marketplace: 'AMAZON', orderNumber: 'O-BULK', imei: '222222222222222' }),
    ];
    const preview = buildPreview(
      { sales: split, perSheetCounts: { AMAZON: 2, BM: 0, EBAY: 0, ONBUY: 0, TEMU: 0 }, errors: [] },
      existing,
      [],
    );
    expect(preview.staleCombined.map(s => s.id).sort()).toEqual(
      ['AMAZON__O-BULK__r28', 'AMAZON__O-BULK__r29'],
    );
  });

  it('keeps a blank-IMEI legacy row when the upload has no per-IMEI replacement for that order', () => {
    // Safety net: if the upload's row for this order ALSO has a blank IMEI
    // (e.g. operator still missing the data), don't delete the only surviving
    // record — the operator can fill it in later.
    const existing: Sale[] = [
      sale({ id: 'AMAZON__O-PEND__r28', marketplace: 'AMAZON', orderNumber: 'O-PEND', imei: '' }),
    ];
    const upload: Sale[] = [
      // New row also blank — no per-IMEI replacement available.
      sale({ id: 'AMAZON__O-PEND__r28', marketplace: 'AMAZON', orderNumber: 'O-PEND', imei: '' }),
    ];
    const preview = buildPreview(
      { sales: upload, perSheetCounts: { AMAZON: 1, BM: 0, EBAY: 0, ONBUY: 0, TEMU: 0 }, errors: [] },
      existing,
      [],
    );
    expect(preview.staleCombined).toEqual([]);
  });
});

describe('auditRowMissing — audit completeness gate', () => {
  const base = {
    imei: '350000000000111', model: 'Galaxy S20', supplierName: 'NANAK',
    buyPrice: 57, salePrice: 84.99, saleDate: '2026-06-14',
    marketplace: 'AMAZON', orderNumber: 'O-1',
  };
  it('returns [] when every required field is present', () => {
    expect(auditRowMissing(base)).toEqual([]);
  });
  it('flags each missing field by name', () => {
    expect(auditRowMissing({ ...base, imei: '' })).toContain('IMEI');
    expect(auditRowMissing({ ...base, model: '  ' })).toContain('model');
    expect(auditRowMissing({ ...base, supplierName: '' })).toContain('supplier');
    expect(auditRowMissing({ ...base, buyPrice: 0 })).toContain('buy price');
    expect(auditRowMissing({ ...base, salePrice: 0 })).toContain('sale price');
    expect(auditRowMissing({ ...base, saleDate: '' })).toContain('sale date');
    expect(auditRowMissing({ ...base, marketplace: '' })).toContain('marketplace');
    expect(auditRowMissing({ ...base, orderNumber: '' })).toContain('order number');
  });
  it('accumulates multiple missing fields', () => {
    const missing = auditRowMissing({ ...base, model: '', supplierName: '', buyPrice: 0 });
    expect(missing).toEqual(expect.arrayContaining(['model', 'supplier', 'buy price']));
    expect(missing).toHaveLength(3);
  });

  // A live production report had 9 confirmed sales permanently unmatchable
  // to any unit — 4 of them because the source file's IMEI cell held
  // placeholder text or the pre-splitter legacy combined-serial format, and
  // the gate only ever checked "is this field non-empty", not "is it a real
  // identifier". Those 4 satisfied presence and got waved through.
  it('flags placeholder text as an invalid IMEI, not a present one', () => {
    for (const bogus of ['not mentioned in App', 'GENERIC', 'N/A', 'n/a', 'unknown']) {
      const missing = auditRowMissing({ ...base, imei: bogus });
      expect(missing).not.toContain('IMEI');            // it IS present...
      expect(missing).toContain('IMEI (invalid format)'); // ...but not valid
    }
  });

  it('flags the legacy combined multi-serial format ("A / B") as invalid', () => {
    const missing = auditRowMissing({ ...base, imei: 'R52H70ZDQAX / R52HA12QETX' });
    expect(missing).toContain('IMEI (invalid format)');
  });

  it('accepts a real 15-digit IMEI and a real Apple/tablet alphanumeric serial', () => {
    expect(auditRowMissing({ ...base, imei: '350000000000111' })).toEqual([]);
    expect(auditRowMissing({ ...base, imei: 'KLQ2W2TTWR', model: 'Apple iPad 11 WiFi' })).toEqual([]);
  });
});

describe('recordsToComplete — IMEI editability follows validity', () => {
  it('locks the IMEI field when the source value is already valid (nothing to fix)', () => {
    const sales: Sale[] = [
      sale({ id: 'AMAZON__O1__x', marketplace: 'AMAZON', orderNumber: 'O1', imei: '350000000000999' }),
    ];
    const preview = buildPreview(
      { sales, perSheetCounts: { AMAZON: 1, BM: 0, EBAY: 0, ONBUY: 0, TEMU: 0 }, errors: [] },
      [],
      [],
    );
    expect(preview.recordsToComplete).toHaveLength(1);
    expect(preview.recordsToComplete[0].imeiReadOnly).toBe(true);
  });

  it('unlocks the IMEI field for editing when the source value is bogus', () => {
    const sales: Sale[] = [
      sale({ id: 'EBAY__O2__x', marketplace: 'EBAY', orderNumber: 'O2', imei: 'GENERIC' }),
    ];
    const preview = buildPreview(
      { sales, perSheetCounts: { AMAZON: 0, BM: 0, EBAY: 1, ONBUY: 0, TEMU: 0 }, errors: [] },
      [],
      [],
    );
    expect(preview.recordsToComplete).toHaveLength(1);
    expect(preview.recordsToComplete[0].imeiReadOnly).toBe(false);
  });
});

describe('buildPreview — return restoration buckets (returnsToRestore / returnsNeedingType)', () => {
  it('a voided sale with a Returns-tab Return Type lands in returnsToRestore', () => {
    const sales: Sale[] = [
      sale({
        id: 'AMAZON__O1__111', marketplace: 'AMAZON', orderNumber: 'O1', imei: '111',
        voidedAt: '2026-06-14', voidOutcome: 'refund', voidReason: 'Refund — Cx Change of Mind',
      }),
    ];
    const preview = buildPreview(
      {
        sales, perSheetCounts: { AMAZON: 0, BM: 0, EBAY: 0, ONBUY: 0, TEMU: 0 }, errors: [],
        returnRows: [{ marketplace: 'AMAZON', imei: '111', returnType: 'returned_to_inventory' }],
      },
      [],
      [],
    );
    expect(preview.returnsToRestore).toHaveLength(1);
    expect(preview.returnsNeedingType).toHaveLength(0);
    expect(preview.returnsToRestore[0]).toMatchObject({
      saleId: 'AMAZON__O1__111', imei: '111', marketplace: 'AMAZON', orderNumber: 'O1',
      returnType: 'returned_to_inventory', existingUnitId: undefined, alreadyRestored: false,
    });
  });

  it('a voided sale with NO matching Returns-tab row lands in returnsNeedingType instead', () => {
    const sales: Sale[] = [
      sale({ id: 'AMAZON__O2__222', marketplace: 'AMAZON', orderNumber: 'O2', imei: '222', voidedAt: '2026-06-14', voidOutcome: 'refund' }),
    ];
    const preview = buildPreview(
      { sales, perSheetCounts: { AMAZON: 0, BM: 0, EBAY: 0, ONBUY: 0, TEMU: 0 }, errors: [], returnRows: [] },
      [],
      [],
    );
    expect(preview.returnsToRestore).toHaveLength(0);
    expect(preview.returnsNeedingType).toEqual([
      { saleId: 'AMAZON__O2__222', imei: '222', marketplace: 'AMAZON', orderNumber: 'O2' },
    ]);
  });

  it('a file with no returnRows array at all (legacy fixture) never throws — everything needing a type is still surfaced', () => {
    const sales: Sale[] = [
      sale({ id: 'AMAZON__O3__333', marketplace: 'AMAZON', orderNumber: 'O3', imei: '333', voidedAt: '2026-06-14' }),
    ];
    const preview = buildPreview(
      { sales, perSheetCounts: { AMAZON: 0, BM: 0, EBAY: 0, ONBUY: 0, TEMU: 0 }, errors: [] },
      [],
      [],
    );
    expect(preview.returnsToRestore).toHaveLength(0);
    expect(preview.returnsNeedingType).toHaveLength(1);
  });

  it('an active (non-voided) sale never appears in either return bucket', () => {
    const sales: Sale[] = [sale({ id: 'AMAZON__O4__444', marketplace: 'AMAZON', orderNumber: 'O4', imei: '444' })];
    const preview = buildPreview(
      {
        sales, perSheetCounts: { AMAZON: 0, BM: 0, EBAY: 0, ONBUY: 0, TEMU: 0 }, errors: [],
        returnRows: [{ marketplace: 'AMAZON', imei: '444', returnType: 'returned_to_inventory' }],
      },
      [],
      [],
    );
    expect(preview.returnsToRestore).toHaveLength(0);
    expect(preview.returnsNeedingType).toHaveLength(0);
  });

  it('marks alreadyRestored when the matched unit is already in the returned Return Type + non-sold status', () => {
    const units: InventoryUnit[] = [
      unit({ id: '555', imei: '555', status: 'available', returnType: 'returned_to_inventory' } as Partial<InventoryUnit>),
    ];
    const sales: Sale[] = [
      sale({ id: 'AMAZON__O5__555', marketplace: 'AMAZON', orderNumber: 'O5', imei: '555', voidedAt: '2026-06-14', voidOutcome: 'refund' }),
    ];
    const preview = buildPreview(
      {
        sales, perSheetCounts: { AMAZON: 0, BM: 0, EBAY: 0, ONBUY: 0, TEMU: 0 }, errors: [],
        returnRows: [{ marketplace: 'AMAZON', imei: '555', returnType: 'returned_to_inventory' }],
      },
      [],
      units,
    );
    expect(preview.returnsToRestore).toHaveLength(1);
    expect(preview.returnsToRestore[0].alreadyRestored).toBe(true);
    expect(preview.returnsToRestore[0].existingUnitId).toBe('555');
  });

  it('a voided sale with no IMEI never appears in either bucket — nothing to restore against', () => {
    const sales: Sale[] = [
      sale({ id: 'AMAZON__O6__blank', marketplace: 'AMAZON', orderNumber: 'O6', imei: '', voidedAt: '2026-06-14' }),
    ];
    const preview = buildPreview(
      { sales, perSheetCounts: { AMAZON: 0, BM: 0, EBAY: 0, ONBUY: 0, TEMU: 0 }, errors: [], returnRows: [] },
      [],
      [],
    );
    expect(preview.returnsToRestore).toHaveLength(0);
    expect(preview.returnsNeedingType).toHaveLength(0);
  });
});

describe('buildPostImportSyncPatches — stockSource stamping', () => {
  it('stamps office for a shelf unit and SHS for a supplier-held one', () => {
    const units: InventoryUnit[] = [
      unit({ id: 'u-office', imei: '111', status: 'available' }),
      unit({ id: 'u-inc',    imei: '222', status: 'incoming' }),
    ];
    const sales: Sale[] = [
      sale({ id: 'EBAY__O1__111', marketplace: 'EBAY', orderNumber: 'O1', imei: '111' }),
      sale({ id: 'EBAY__O2__222', marketplace: 'EBAY', orderNumber: 'O2', imei: '222' }),
    ];
    const { unitPatches } = buildPostImportSyncPatches(sales, units);
    const byId = new Map(unitPatches.map(p => [p.id, p.data]));
    expect(byId.get('u-office')?.stockSource).toBe('office');
    // An incoming unit is supplier-held by definition, so the sale that
    // fulfils it is an SHS sale. Stamping 'office' here (the old rule)
    // relabelled every parser-created SHS placeholder the moment it sold
    // and lost it from the SHS column of every report.
    expect(byId.get('u-inc')?.stockSource).toBe('shs');
  });

  it('reports which units were SHS-fulfilled so their trail can be cleared', () => {
    const units: InventoryUnit[] = [
      unit({ id: 'u-office', imei: '111', status: 'available' }),
      unit({ id: 'u-inc',    imei: '222', status: 'incoming', model: 'IPHONE 13', supplierName: 'CELLHUB' }),
    ];
    const sales: Sale[] = [
      sale({ id: 'EBAY__O1__111', marketplace: 'EBAY', orderNumber: 'O1', imei: '111' }),
      sale({ id: 'EBAY__O2__222', marketplace: 'EBAY', orderNumber: 'O2', imei: '222' }),
    ];
    const { shsFulfilled } = buildPostImportSyncPatches(sales, units);
    // Only the supplier-held one — the shelf unit has no SHS trail.
    expect(shsFulfilled).toEqual([
      { unitId: 'u-inc', model: 'IPHONE 13', supplierName: 'CELLHUB' },
    ]);
  });

  it('preserves an explicitly-set shs source on a matched unit', () => {
    const units: InventoryUnit[] = [
      unit({ id: 'u-shs', imei: '333', status: 'available', stockSource: 'shs' }),
    ];
    const sales: Sale[] = [sale({ id: 'EBAY__O3__333', marketplace: 'EBAY', orderNumber: 'O3', imei: '333' })];
    const { unitPatches } = buildPostImportSyncPatches(sales, units);
    expect(unitPatches.find(p => p.id === 'u-shs')?.data.stockSource).toBe('shs');
  });
});
