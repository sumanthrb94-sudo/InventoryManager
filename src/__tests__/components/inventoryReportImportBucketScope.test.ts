/**
 * An Inventory Report re-upload used to match "to update" purely by IMEI,
 * with no regard for which stock bucket the existing unit was actually in.
 * An OFFICE-tagged row could silently rewrite an existing SHS (incoming)
 * unit's Model/Colour/Storage/Supplier/BP — a report that never mentioned
 * SHS reaching into a bucket it had no business touching. Reported live:
 * uploading an all-OFFICE workbook after "Wipe Office Stock" showed "6 to
 * update" and the SHS Stock KPI grew, even though the file had no SHS rows.
 *
 * The fix scopes the match: a row can only "update" an existing unit whose
 * bucket (office / shs, per wipeScopes' own taxonomy) matches what the row
 * declares. A same-IMEI hit in a different bucket is neither created (that
 * would mint a second unit for a real IMEI) nor updated (wrong bucket) — it
 * lands in `bucketConflicts` so the operator can see it and go fix it
 * through the flow that actually owns that bucket.
 */
import { describe, it, expect } from 'vitest';
import { buildPreview } from '../../components/InventoryReportImport';
import type { ParsedRow } from '../../lib/inventoryImportParse';
import type { InventoryUnit, Supplier } from '../../types';

function row(overrides: Partial<ParsedRow> = {}): ParsedRow {
  return {
    rowNum: 2,
    dateIn: '2026-07-26',
    model: 'APPLE IPHONE 12',
    imei: '356427677484680',
    grade: 'A',
    storage: '64GB',
    simType: '',
    colour: 'Black',
    supplier: 'NANAK',
    buyPrice: 100,
    stockType: 'office',
    notes: '',
    errors: [],
    ...overrides,
  };
}

function unit(overrides: Partial<InventoryUnit> = {}): InventoryUnit {
  return {
    id: 'u1',
    imei: '356427677484680',
    model: 'Apple iPhone 12 64GB',
    brand: 'Apple',
    category: 'phone',
    colour: 'Black',
    buyPrice: 90,
    dateIn: '2026-01-01',
    supplierId: 'sup1',
    supplierName: 'NANAK',
    status: 'available',
    ...overrides,
  } as InventoryUnit;
}

const NO_SUPPLIERS: Supplier[] = [];
const NANAK_SUPPLIER: Supplier[] = [{ id: 'sup1', name: 'NANAK', portal: 'Direct' } as Supplier];

describe('InventoryReportImport buildPreview — bucket-scoped matching', () => {
  it('an OFFICE row matching an existing OFFICE unit updates normally', () => {
    const preview = buildPreview([row()], [unit({ status: 'available' })], NANAK_SUPPLIER, new Set());
    expect(preview.toUpdate).toHaveLength(1);
    expect(preview.toCreate).toHaveLength(0);
    expect(preview.bucketConflicts).toHaveLength(0);
  });

  it('an OFFICE row matching an existing SHS (incoming) unit does NOT update it', () => {
    const preview = buildPreview([row()], [unit({ status: 'incoming' })], NANAK_SUPPLIER, new Set());
    expect(preview.toUpdate).toHaveLength(0);
    expect(preview.toCreate).toHaveLength(0);
    expect(preview.bucketConflicts).toHaveLength(1);
    expect(preview.bucketConflicts[0].existingBucket).toBe('shs');
  });

  it('an SHS row matching an existing OFFICE (available) unit does NOT update it', () => {
    const preview = buildPreview(
      [row({ stockType: 'shs' })],
      [unit({ status: 'available' })],
      NANAK_SUPPLIER,
      new Set(),
    );
    expect(preview.toUpdate).toHaveLength(0);
    expect(preview.bucketConflicts).toHaveLength(1);
    expect(preview.bucketConflicts[0].existingBucket).toBe('office');
  });

  it('an OFFICE row matching an already-sold unit does not resurrect or overwrite it', () => {
    const preview = buildPreview([row()], [unit({ status: 'sold' })], NANAK_SUPPLIER, new Set());
    expect(preview.toUpdate).toHaveLength(0);
    expect(preview.toCreate).toHaveLength(0);
    expect(preview.bucketConflicts).toHaveLength(1);
    expect(preview.bucketConflicts[0].existingBucket).toBe('sold');
  });

  it('a bucket conflict is neither created nor updated — it is excluded from both', () => {
    const preview = buildPreview([row()], [unit({ status: 'incoming' })], NANAK_SUPPLIER, new Set());
    const total = preview.toCreate.length + preview.toUpdate.length + preview.bucketConflicts.length;
    expect(total).toBe(1);
  });

  it('an IMEI with no existing unit at all still creates fresh, regardless of bucket', () => {
    const preview = buildPreview([row()], [], NO_SUPPLIERS, new Set());
    expect(preview.toCreate).toHaveLength(1);
    expect(preview.toUpdate).toHaveLength(0);
    expect(preview.bucketConflicts).toHaveLength(0);
  });

  it('a returned-to-inventory unit still counts as office for matching', () => {
    const preview = buildPreview(
      [row()],
      [unit({ status: 'returned', returnType: 'returned_to_inventory' } as Partial<InventoryUnit>)],
      NANAK_SUPPLIER,
      new Set(),
    );
    expect(preview.toUpdate).toHaveLength(1);
    expect(preview.bucketConflicts).toHaveLength(0);
  });
});
