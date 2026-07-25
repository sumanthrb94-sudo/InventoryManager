import { describe, it, expect } from 'vitest';
import {
  buildWipePlan,
  buildReturnResetPatch,
  isOfficeStockUnit,
  isShsUnit,
  isSoldUnit,
  isReturnUnit,
} from '../../lib/wipeScopes';
import type { InventoryUnit, InventoryAggregate, InventoryEvent, Sale } from '../../types';

const unit = (over: Partial<InventoryUnit>): InventoryUnit => ({
  id: 'u1',
  model: 'iPhone 13',
  status: 'available',
  flags: [],
  platformListed: false,
  ownerId: 'shared',
  createdAt: '2026-01-01',
  ...over,
} as InventoryUnit);

const agg = (over: Partial<InventoryAggregate>): InventoryAggregate => ({
  id: 'a1',
  model: 'iPhone 13',
  supplierIds: [],
  ownerId: 'shared',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  ...over,
} as InventoryAggregate);

const sale = (id: string): Sale => ({ id, ownerId: 'shared' } as Sale);

const SOURCE = () => ({
  units: [
    unit({ id: 'office-1', status: 'available' }),
    unit({ id: 'office-2', status: 'returned', returnType: 'returned_to_inventory', returnDate: '2026-02-01' }),
    unit({ id: 'shs-1', status: 'incoming' }),
    unit({ id: 'shs_placeholder', status: 'incoming' }),
    unit({ id: 'sold-1', status: 'sold', salePrice: 400, saleDate: '2026-03-01' }),
    unit({ id: 'repair-1', status: 'returned', returnType: 'repair', returnDate: '2026-03-02' }),
  ],
  aggregates: [
    agg({ id: 'agg-office', quantityText: '3', quantityNum: 3 }),
    agg({ id: 'agg-office-zero', quantityNum: 0 }),
    agg({ id: 'agg-shs', quantityText: 'SHS' }),
  ],
  sales: [sale('s1'), sale('s2')],
});

const idsFor = (plan: ReturnType<typeof buildWipePlan>, collection: string) =>
  plan.deletes.filter(d => d.collection === collection).map(d => d.id).sort();

describe('wipeScopes predicates', () => {
  it('classifies office stock, including units stuck on status=returned', () => {
    expect(isOfficeStockUnit(unit({ status: 'available' }))).toBe(true);
    expect(isOfficeStockUnit(unit({ status: 'returned', returnType: 'returned_to_inventory' }))).toBe(true);
    expect(isOfficeStockUnit(unit({ status: 'sold', returnType: 'returned_to_inventory' }))).toBe(false);
    expect(isOfficeStockUnit(unit({ status: 'incoming' }))).toBe(false);
  });

  it('classifies SHS by status, not by id prefix', () => {
    expect(isShsUnit(unit({ id: 'shs_x', status: 'incoming' }))).toBe(true);
    expect(isShsUnit(unit({ id: 'manual', status: 'incoming' }))).toBe(true);
    expect(isShsUnit(unit({ status: 'available' }))).toBe(false);
  });

  it('treats a sold unit as an in-app sale only when it carries sale data', () => {
    expect(isSoldUnit(unit({ status: 'sold', salePrice: 100 }))).toBe(true);
    expect(isSoldUnit(unit({ status: 'sold', saleDate: '2026-01-02' }))).toBe(true);
    expect(isSoldUnit(unit({ status: 'sold' }))).toBe(false);
  });

  it('counts a unit still in the CRM queue as a return', () => {
    expect(isReturnUnit(unit({ pendingCrmReview: true }))).toBe(true);
    expect(isReturnUnit(unit({ returnQcAt: '2026-01-01' }))).toBe(true);
    expect(isReturnUnit(unit({ status: 'available' }))).toBe(false);
  });
});

describe('buildWipePlan', () => {
  it('office scope deletes office units and non-SHS master rows only', () => {
    const plan = buildWipePlan('office', SOURCE());
    expect(idsFor(plan, 'inventoryUnits')).toEqual(['office-1', 'office-2']);
    expect(idsFor(plan, 'inventoryAggregates')).toEqual(['agg-office', 'agg-office-zero']);
    expect(plan.patches).toHaveLength(0);
  });

  it('shs scope deletes incoming units and SHS master rows only', () => {
    const plan = buildWipePlan('shs', SOURCE());
    expect(idsFor(plan, 'inventoryUnits')).toEqual(['shs-1', 'shs_placeholder']);
    expect(idsFor(plan, 'inventoryAggregates')).toEqual(['agg-shs']);
  });

  it('sales scope deletes sale docs plus in-app sold units', () => {
    const plan = buildWipePlan('sales', SOURCE());
    expect(idsFor(plan, 'sales')).toEqual(['s1', 's2']);
    expect(idsFor(plan, 'inventoryUnits')).toEqual(['sold-1']);
  });

  it('returns scope patches units instead of deleting them', () => {
    const plan = buildWipePlan('returns', SOURCE());
    expect(plan.deletes).toHaveLength(0);
    expect(plan.patches.map(p => p.id).sort()).toEqual(['office-2', 'repair-1']);
    const repair = plan.patches.find(p => p.id === 'repair-1')!;
    expect(repair.data.returnType).toBeNull();
    expect(repair.data.returnDate).toBeNull();
    // status='returned' would leave an invisible unit once the flags go
    expect(repair.data.status).toBe('available');
  });

  it('cascades inventoryEvents for units it deletes', () => {
    const events: InventoryEvent[] = [
      { id: 'e1', type: 'sold', message: '', unitId: 'sold-1', ownerId: 'shared', createdAt: '' },
      { id: 'e2', type: 'available', message: '', unitId: 'office-1', ownerId: 'shared', createdAt: '' },
      { id: 'e3', type: 'batch_created', message: '', ownerId: 'shared', createdAt: '' },
    ];
    const salesPlan = buildWipePlan('sales', { ...SOURCE(), events });
    expect(idsFor(salesPlan, 'inventoryEvents')).toEqual(['e1']);

    const officePlan = buildWipePlan('office', { ...SOURCE(), events });
    expect(idsFor(officePlan, 'inventoryEvents')).toEqual(['e2']);
  });

  it('office + shs together clear every master-file row', () => {
    const src = SOURCE();
    const all = [
      ...idsFor(buildWipePlan('office', src), 'inventoryAggregates'),
      ...idsFor(buildWipePlan('shs', src), 'inventoryAggregates'),
    ].sort();
    expect(all).toEqual(src.aggregates.map(a => a.id).sort());
  });

  it('an empty database produces an empty plan', () => {
    const plan = buildWipePlan('office', { units: [], aggregates: [], sales: [] });
    expect(plan.total).toBe(0);
  });

  it('only clears return fields that are actually present', () => {
    const patch = buildReturnResetPatch(unit({ status: 'available', returnType: 'repair' }));
    expect(patch).toEqual({ returnType: null });
  });
});
