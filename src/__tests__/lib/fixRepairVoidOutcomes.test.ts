/**
 * Tests for the one-shot data fix that backfills voidOutcome='repair' on
 * Sale docs corrupted by the pre-`f0f8e1e` ProcessReturnModal (round 3/4
 * BUG-RP-003). The safety property is critical: a legitimate refund of a
 * previously-repaired unit must NOT be re-classified as a repair.
 */
import { describe, it, expect } from 'vitest';
import {
  findCorruptedRepairVoids,
  fixCorruptedRepairVoids,
} from '../../lib/migrations/fixRepairVoidOutcomes';
import type { Sale, InventoryUnit } from '../../types';

const sale = (over: Partial<Sale>): Sale => ({
  id: 'S', marketplace: 'EBAY', orderNumber: 'O', imei: '1',
  unitId: 'u', supplierId: 's1', supplierName: 'X',
  saleDate: '2026-06-12', quantity: 1, buyPrice: 100, salePrice: 150,
  importBatchId: 't', sourceFile: 't', sourceRow: 1, ownerId: 'shared',
  createdAt: '2026-06-12T08:00:00.000Z', updatedAt: '2026-06-12T08:00:00.000Z',
  ...over,
});
const unit = (over: Partial<InventoryUnit>): InventoryUnit => ({
  id: 'u', imei: '1', model: 'X', brand: 'X', category: 'iPhone', colour: 'X',
  buyPrice: 100, dateIn: '2026-06-01',
  supplierId: 's1', supplierName: 'X',
  status: 'returned', flags: [], notes: '',
  platformListed: false, listingSites: [],
  ownerId: 'shared', createdAt: '2026-06-01T00:00:00Z',
  ...over,
});

describe('findCorruptedRepairVoids', () => {
  it('detects mid-cycle repair void wrongly stamped refund (returnType=repair)', () => {
    const s = sale({
      voidedAt: '2026-06-12', voidOutcome: 'refund',
      voidReason: 'Refund — prod gate repair',
    });
    const u = unit({ returnType: 'repair', returnDate: '2026-06-12' });
    const out = findCorruptedRepairVoids([s], [u]);
    expect(out.autoFixable).toHaveLength(1);
    expect(out.autoFixable[0].patch.voidOutcome).toBe('repair');
    expect(out.autoFixable[0].patch.voidReason).toBe('In Repair — prod gate repair');
    expect(out.manualReview).toHaveLength(0);
  });

  it('detects post-completion corruption via repairedAt + repaired_unit flag', () => {
    const s = sale({
      voidedAt: '2026-06-12', voidOutcome: 'refund',
      voidReason: 'Refund — prod gate repair',
    });
    const u = unit({
      status: 'available',
      returnType: 'returned_to_inventory',
      returnDate: '2026-06-12',
      repairedAt: '2026-06-12',
      flags: ['repaired_unit'],
    });
    const out = findCorruptedRepairVoids([s], [u]);
    expect(out.autoFixable).toHaveLength(1);
    expect(out.autoFixable[0].patch.voidOutcome).toBe('repair');
  });

  it('does NOT touch a legitimate stored "replacement"', () => {
    const s = sale({ voidedAt: '2026-06-12', voidOutcome: 'replacement' });
    const u = unit({ returnType: 'repair' });
    const out = findCorruptedRepairVoids([s], [u]);
    expect(out.autoFixable).toHaveLength(0);
    expect(out.manualReview).toHaveLength(0);
  });

  it('does NOT touch an unmatched Sale (no linked unit)', () => {
    const s = sale({ voidedAt: '2026-06-12', voidOutcome: 'refund', unitId: '', imei: 'lonely' });
    const out = findCorruptedRepairVoids([s], [unit({ id: 'u', imei: 'other' })]);
    expect(out.autoFixable).toHaveLength(0);
    expect(out.manualReview).toHaveLength(0);
  });

  it('does NOT touch a refund on a unit with no repair markers', () => {
    const s = sale({ voidedAt: '2026-06-12', voidOutcome: 'refund' });
    const u = unit({
      status: 'available',
      returnType: 'returned_to_inventory',
      returnDate: '2026-06-12',
      returnOutcome: 'refund',
    });
    const out = findCorruptedRepairVoids([s], [u]);
    expect(out.autoFixable).toHaveLength(0);
    expect(out.manualReview).toHaveLength(0);
  });

  it('safety: multi-cycle units with a repair marker go to manualReview, not auto-fix', () => {
    // Cycle 1: repair (corrupted as refund in the DB).
    const repairSale = sale({
      id: 'S1', orderNumber: 'C1',
      voidedAt: '2026-06-12', voidOutcome: 'refund',
      voidReason: 'Refund — cycle 1 repair',
      createdAt: '2026-06-12T09:00:00.000Z',
    });
    // Cycle 2: a real later refund. Stored correctly as 'refund'.
    const realRefund = sale({
      id: 'S2', orderNumber: 'C2',
      voidedAt: '2026-06-13', voidOutcome: 'refund',
      voidReason: 'Refund — cycle 2 buyer cancelled',
      createdAt: '2026-06-13T11:00:00.000Z',
    });
    // Unit currently shows repair markers (the lingering ones never get
    // cleared) AND most-recently went through Back-to-Inventory refund.
    const u = unit({
      status: 'available',
      returnType: 'returned_to_inventory',
      returnDate: '2026-06-13',
      repairedAt: '2026-06-12',
      flags: ['repaired_unit'],
      returnOutcome: 'refund',
    });
    const out = findCorruptedRepairVoids([repairSale, realRefund], [u]);
    // Neither cycle is auto-fixed — the heuristic can't tell from unit
    // state which void was the repair. The unit goes to manualReview
    // with both Sale IDs surfaced so a human picks.
    expect(out.autoFixable).toHaveLength(0);
    expect(out.manualReview).toHaveLength(1);
    expect(out.manualReview[0].unitId).toBe('u');
    expect(out.manualReview[0].voidedSaleIds.sort()).toEqual(['S1', 'S2']);
  });

  it('joins by IMEI when unitId is missing on the Sale', () => {
    const s = sale({
      unitId: '',  // legacy un-linked sale
      imei: 'ABC123',
      voidedAt: '2026-06-12', voidOutcome: 'refund',
      voidReason: 'Refund — old repair',
    });
    const u = unit({ id: 'u-via-imei', imei: 'ABC123', returnType: 'repair' });
    const out = findCorruptedRepairVoids([s], [u]);
    expect(out.autoFixable).toHaveLength(1);
  });
});

describe('fixCorruptedRepairVoids', () => {
  it('writes one update per item and reports per-item success', async () => {
    const writes: Array<{ collection: string; id: string; data: Record<string, unknown> }> = [];
    const fakeDb = {
      update: async (collection: string, id: string, data: Record<string, unknown>) => {
        writes.push({ collection, id, data });
      },
    };
    const { autoFixable } = findCorruptedRepairVoids(
      [sale({ voidedAt: '2026-06-12', voidOutcome: 'refund', voidReason: 'Refund — x' })],
      [unit({ returnType: 'repair' })],
    );
    const results = await fixCorruptedRepairVoids(autoFixable, fakeDb);
    expect(results).toEqual([{ saleId: 'S', ok: true }]);
    expect(writes).toHaveLength(1);
    expect(writes[0].collection).toBe('sales');
    expect(writes[0].data).toEqual({
      voidOutcome: 'repair',
      voidReason: 'In Repair — x',
    });
  });

  it('reports per-item errors without aborting the batch', async () => {
    const fakeDb = {
      update: async (_c: string, id: string) => {
        if (id === 'S2') throw new Error('boom');
      },
    };
    const results = await fixCorruptedRepairVoids(
      [
        { saleId: 'S1', unitId: 'u', imei: '1', current: {}, patch: { voidOutcome: 'repair', voidReason: 'In Repair — a' } },
        { saleId: 'S2', unitId: 'u', imei: '1', current: {}, patch: { voidOutcome: 'repair', voidReason: 'In Repair — b' } },
        { saleId: 'S3', unitId: 'u', imei: '1', current: {}, patch: { voidOutcome: 'repair', voidReason: 'In Repair — c' } },
      ],
      fakeDb,
    );
    expect(results.map(r => r.ok)).toEqual([true, false, true]);
    expect(results[1].err).toBe('boom');
  });
});
