/**
 * Verifies the admin SKU Reconciliation tool (Admin → Configuration → SKU
 * Reconciliation) automatically benefits from today's normalizeOperatorSku
 * additions (IPAD brand code, VIN- vendor prefix, tightened whitespace
 * guard) with zero code changes here — isAutoFixable/buildAutoFixPatch
 * call the shared parser functions directly rather than duplicating any
 * SKU-recognition logic of their own.
 */
import { describe, it, expect } from 'vitest';
import { isAutoFixable, buildAutoFixPatch } from '../../components/SkuReconciliation';
import type { InventoryUnit } from '../../types';

const unit = (over: Partial<InventoryUnit>): InventoryUnit => ({
  id: 'u', imei: '350000000000111',
  model: '', brand: 'Other', category: 'Other', colour: 'Unknown',
  buyPrice: 0, dateIn: '2026-07-01',
  supplierId: 's', supplierName: 'MHL',
  status: 'sold',
  flags: [], notes: '', platformListed: false, listingSites: [],
  ownerId: 'shared', createdAt: '2026-07-01T00:00:00Z',
  ...over,
});

describe('SkuReconciliation — auto-fixable against real client SKU shapes', () => {
  it('the IPAD brand code (previously unrecognised) is now auto-fixable', () => {
    const u = unit({ rawModel: 'IPAD-11-128-BL', model: 'IPAD-11-128-BL' });
    expect(isAutoFixable(u)).toBe(true);
    const patch = buildAutoFixPatch(u);
    expect(patch?.model).toBe('iPad 11');
    expect(patch?.brand).toBe('Apple');
    expect(patch?.storage).toBe('128GB');
  });

  it('the VIN- vendor prefix (previously unrecognised) is now auto-fixable', () => {
    const u = unit({ rawModel: 'VIN-SG-A25-128-DBL-LN', model: 'VIN-SG-A25-128-DBL-LN' });
    expect(isAutoFixable(u)).toBe(true);
    const patch = buildAutoFixPatch(u);
    expect(patch?.model).toBe('Galaxy A25');
    expect(patch?.brand).toBe('Samsung');
    expect(patch?.storage).toBe('128GB');
  });

  it('a stray "- -" spreadsheet artifact is now auto-fixable', () => {
    const u = unit({ rawModel: 'IPAD-11THGEN-128- -BL', model: 'IPAD-11THGEN-128- -BL' });
    expect(isAutoFixable(u)).toBe(true);
  });

  it('a genuinely unrecognisable code is still NOT auto-fixable (no false positive)', () => {
    const u = unit({ rawModel: 'WX440-12-PK', model: 'WX440-12-PK' });
    expect(isAutoFixable(u)).toBe(false);
    expect(buildAutoFixPatch(u)).toBeNull();
  });

  it('the fused IP12 shorthand from Group A is still auto-fixable', () => {
    const u = unit({ rawModel: 'IP12-BK-64', model: 'IP12-BK-64' });
    expect(isAutoFixable(u)).toBe(true);
    expect(buildAutoFixPatch(u)?.model).toBe('iPhone 12');
  });
});
