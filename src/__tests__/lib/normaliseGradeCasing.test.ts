/**
 * Grade / SIM casing repair.
 *
 * The migration's safety property is that it only ever changes
 * capitalisation and padding — never meaning. These tests exist mostly to
 * pin that: a free-text grade an operator genuinely typed must survive
 * untouched, however odd it looks.
 */
import { describe, it, expect, vi } from 'vitest';
import { findGradeCasingDrift, fixGradeCasing } from '../../lib/migrations/normaliseGradeCasing';
import { normaliseGrade, normaliseSimType, GRADE_OPTIONS } from '../../lib/unitConstants';
import type { InventoryUnit } from '../../types';

const unit = (over: Partial<InventoryUnit>): InventoryUnit => ({
  id: 'u1', model: 'IPHONE 13', status: 'available', flags: [],
  platformListed: false, ownerId: 'shared', createdAt: '2026-07-01',
  ...over,
} as InventoryUnit);

describe('normaliseGrade', () => {
  it('snaps any casing to the canonical option', () => {
    expect(normaliseGrade('Brand New')).toBe('Brand new');
    expect(normaliseGrade('BRAND NEW')).toBe('Brand new');
    expect(normaliseGrade('brand new')).toBe('Brand new');
    expect(normaliseGrade('  Brand New  ')).toBe('Brand new');
    expect(normaliseGrade('onu')).toBe('ONU');
    expect(normaliseGrade('a')).toBe('A');
  });

  it('leaves an already-canonical value alone', () => {
    for (const g of GRADE_OPTIONS) expect(normaliseGrade(g)).toBe(g);
  });

  it('never rewrites a grade that matches no option', () => {
    expect(normaliseGrade('A/B mix')).toBe('A/B mix');
    expect(normaliseGrade('Grade A-')).toBe('Grade A-');
    expect(normaliseGrade('A+')).toBe('A+');   // not an option — operator's own
  });

  it('handles blank and missing input', () => {
    expect(normaliseGrade('')).toBe('');
    expect(normaliseGrade(undefined)).toBe('');
    expect(normaliseGrade(null)).toBe('');
    expect(normaliseGrade('   ')).toBe('');
  });
});

describe('normaliseSimType', () => {
  it('snaps casing to the canonical option', () => {
    expect(normaliseSimType('physical sim')).toBe('Physical SIM');
    expect(normaliseSimType('DUAL PHYSICAL SIM')).toBe('Dual Physical SIM');
    expect(normaliseSimType('Physical SIM + eSIM')).toBe('Physical SIM + eSIM');
  });

  it('leaves a free-text "Other" value alone', () => {
    // The intake dropdown has an Other escape hatch; whatever was typed
    // there is the operator's, not ours to rewrite.
    expect(normaliseSimType('eSIM only, no tray')).toBe('eSIM only, no tray');
  });
});

describe('findGradeCasingDrift', () => {
  it('finds the Brand New / Brand new split and counts it', () => {
    const units = [
      unit({ id: 'u1', grade: 'Brand New' }),
      unit({ id: 'u2', grade: 'Brand New' }),
      unit({ id: 'u3', grade: 'Brand new' }),   // already canonical
      unit({ id: 'u4', grade: 'A' }),
    ];
    const drift = findGradeCasingDrift(units);
    expect(drift.patches.map(p => p.unitId)).toEqual(['u1', 'u2']);
    expect(drift.patches[0].data).toEqual({ grade: 'Brand new' });
    expect(drift.patches[0].before).toEqual({ grade: 'Brand New' });
    expect(drift.summary).toEqual([
      { field: 'grade', from: 'Brand New', to: 'Brand new', count: 2 },
    ]);
  });

  it('patches grade and simType together on one unit', () => {
    const units = [unit({ id: 'u1', grade: 'ONU ', simType: 'physical sim' } as any)];
    const drift = findGradeCasingDrift(units);
    expect(drift.patches).toHaveLength(1);
    expect(drift.patches[0].data).toEqual({ grade: 'ONU', simType: 'Physical SIM' });
  });

  it('emits nothing for clean data', () => {
    const units = [
      unit({ id: 'u1', grade: 'A', simType: 'Physical SIM' } as any),
      unit({ id: 'u2', grade: 'Brand new' }),
      unit({ id: 'u3' }),   // no grade at all
    ];
    expect(findGradeCasingDrift(units)).toEqual({ patches: [], summary: [] });
  });

  it('leaves free-text grades out of the patch set entirely', () => {
    const units = [
      unit({ id: 'u1', grade: 'A/B mix' }),
      unit({ id: 'u2', grade: 'Refurbished' }),
    ];
    expect(findGradeCasingDrift(units).patches).toEqual([]);
  });

  it('orders the summary by impact so the operator sees the big one first', () => {
    const units = [
      unit({ id: 'u1', grade: 'Brand New' }),
      unit({ id: 'u2', grade: 'Brand New' }),
      unit({ id: 'u3', grade: 'Brand New' }),
      unit({ id: 'u4', grade: 'onu' }),
    ];
    const { summary } = findGradeCasingDrift(units);
    expect(summary[0]).toEqual({ field: 'grade', from: 'Brand New', to: 'Brand new', count: 3 });
    expect(summary[1]).toEqual({ field: 'grade', from: 'onu', to: 'ONU', count: 1 });
  });

  it('carries the IMEI so a review table can identify the unit', () => {
    const units = [unit({ id: 'u1', imei: '350100000000000', grade: 'Brand New' })];
    expect(findGradeCasingDrift(units).patches[0].imei).toBe('350100000000000');
  });

  it('is a no-op on an empty database', () => {
    expect(findGradeCasingDrift([])).toEqual({ patches: [], summary: [] });
    expect(findGradeCasingDrift()).toEqual({ patches: [], summary: [] });
  });
});

describe('fixGradeCasing', () => {
  it('writes only the changed fields, so nothing else on the unit moves', async () => {
    const bulkCreate = vi.fn(async () => ({ created: 2, failed: 0 }));
    const units = [
      unit({ id: 'u1', grade: 'Brand New', buyPrice: 500 }),
      unit({ id: 'u2', grade: 'onu' }),
    ];
    const { patches } = findGradeCasingDrift(units);

    const res = await fixGradeCasing(patches, { bulkCreate });

    expect(res).toEqual({ updated: 2 });
    expect(bulkCreate).toHaveBeenCalledWith([
      { collection: 'inventoryUnits', id: 'u1', data: { grade: 'Brand new' } },
      { collection: 'inventoryUnits', id: 'u2', data: { grade: 'ONU' } },
    ]);
  });

  it('does not touch the database when there is nothing to fix', async () => {
    const bulkCreate = vi.fn(async () => ({ created: 0, failed: 0 }));
    expect(await fixGradeCasing([], { bulkCreate })).toEqual({ updated: 0 });
    expect(bulkCreate).not.toHaveBeenCalled();
  });

  it('is idempotent — a second run finds nothing left', async () => {
    const units = [unit({ id: 'u1', grade: 'Brand New' })];
    const { patches } = findGradeCasingDrift(units);
    const after = units.map(u => ({ ...u, ...patches.find(p => p.unitId === u.id)?.data }));
    expect(findGradeCasingDrift(after as InventoryUnit[]).patches).toEqual([]);
  });
});
