import { describe, it, expect } from 'vitest';
import type { InventoryUnit } from '../types';

// Minimal InventoryUnit factory
function makeUnit(overrides: Partial<InventoryUnit> = {}): InventoryUnit {
  return {
    id:             overrides.id      || 'unit-1',
    imei:           overrides.imei    || '353209102768686',
    model:          overrides.model   || 'iPhone 15 Pro Max 256GB',
    brand:          overrides.brand   || 'Apple',
    category:       overrides.category || 'iPhone',
    colour:         overrides.colour  || 'Natural Titanium',
    storage:        overrides.storage || '256GB',
    buyPrice:       overrides.buyPrice ?? 800,
    dateIn:         overrides.dateIn  || '2024-01-15',
    supplierId:     overrides.supplierId || 'sup-1',
    status:         overrides.status  || 'available',
    flags:          overrides.flags   || [],
    notes:          overrides.notes   || '',
    platformListed: overrides.platformListed ?? false,
    ownerId:        overrides.ownerId || 'shared',
    createdAt:      overrides.createdAt || '2024-01-15T00:00:00.000Z',
    ...overrides,
  };
}

describe('inventory unit factory', () => {
  it('creates a valid unit with defaults', () => {
    const u = makeUnit();
    expect(u.status).toBe('available');
    expect(u.flags).toEqual([]);
    expect(u.buyPrice).toBe(800);
  });

  it('overrides work correctly', () => {
    const u = makeUnit({ status: 'sold', buyPrice: 600, colour: 'Black' });
    expect(u.status).toBe('sold');
    expect(u.buyPrice).toBe(600);
    expect(u.colour).toBe('Black');
  });

  it('SHS unit has incoming status and null imei', () => {
    const u = makeUnit({ status: 'incoming', imei: '', buyPrice: 0 });
    expect(u.status).toBe('incoming');
    expect(u.imei).toBe('');
  });
});

describe('inventory aggregations', () => {
  const units = [
    makeUnit({ id: '1', status: 'available', buyPrice: 500, model: 'iPhone 14', colour: 'Black' }),
    makeUnit({ id: '2', status: 'available', buyPrice: 600, model: 'iPhone 14', colour: 'White' }),
    makeUnit({ id: '3', status: 'available', buyPrice: 700, model: 'iPhone 15', colour: 'Black' }),
    makeUnit({ id: '4', status: 'sold',      buyPrice: 500, salePrice: 650, model: 'iPhone 14', colour: 'Black' }),
    makeUnit({ id: '5', status: 'incoming',  buyPrice: 0,   model: 'iPhone 15', colour: 'Natural Titanium' }),
  ];

  it('filters available units correctly', () => {
    const available = units.filter(u => u.status === 'available');
    expect(available).toHaveLength(3);
  });

  it('filters sold units correctly', () => {
    const sold = units.filter(u => u.status === 'sold');
    expect(sold).toHaveLength(1);
  });

  it('filters SHS (incoming) units correctly', () => {
    const shs = units.filter(u => u.status === 'incoming');
    expect(shs).toHaveLength(1);
  });

  it('calculates total stock value', () => {
    const available = units.filter(u => u.status === 'available');
    const value = available.reduce((s, u) => s + u.buyPrice, 0);
    expect(value).toBe(1800);
  });

  it('groups by model correctly', () => {
    const available = units.filter(u => u.status === 'available');
    const byModel: Record<string, number> = {};
    available.forEach(u => { byModel[u.model] = (byModel[u.model] || 0) + 1; });
    expect(byModel['iPhone 14']).toBe(2);
    expect(byModel['iPhone 15']).toBe(1);
  });

  it('calculates gross profit for sold units', () => {
    const sold = units.filter(u => u.status === 'sold');
    const revenue = sold.reduce((s, u) => s + (u.salePrice || 0), 0);
    const cost    = sold.reduce((s, u) => s + u.buyPrice, 0);
    const profit  = revenue - cost - 8; // £8 default postage
    expect(revenue).toBe(650);
    expect(cost).toBe(500);
    expect(profit).toBe(142);
  });
});

describe('SHS concept invariants', () => {
  it('SHS units must have status incoming', () => {
    const shs = makeUnit({ status: 'incoming' });
    expect(shs.status).toBe('incoming');
  });

  it('SHS units may have null/empty IMEI (supplier holds, no serial yet)', () => {
    const shs = makeUnit({ status: 'incoming', imei: '' });
    expect(!shs.imei || shs.imei.length === 0).toBe(true);
  });

  it('receiving SHS unit changes status to available and adds IMEI', () => {
    const shs = makeUnit({ status: 'incoming', imei: '' });
    const received = { ...shs, status: 'available' as const, imei: '353209102768686' };
    expect(received.status).toBe('available');
    expect(received.imei).toBe('353209102768686');
  });
});
