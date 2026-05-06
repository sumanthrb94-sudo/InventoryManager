import { describe, it, expect } from 'vitest';
import type { InventoryUnit, ReturnCategory } from '../types';

// ── Factory ───────────────────────────────────────────────────────────────────
function makeUnit(overrides: Partial<InventoryUnit & { imei: string | null }> = {}): InventoryUnit {
  const base: InventoryUnit = {
    id:             'unit-1',
    imei:           '353209102768686',
    model:          'iPhone 15 Pro Max 256GB',
    brand:          'Apple',
    category:       'iPhone',
    colour:         'Natural Titanium',
    storage:        '256GB',
    buyPrice:       800,
    dateIn:         '2024-01-15',
    supplierId:     'sup-1',
    status:         'available',
    flags:          [],
    notes:          '',
    platformListed: false,
    ownerId:        'shared',
    createdAt:      '2024-01-15T00:00:00.000Z',
  };
  return { ...base, ...overrides } as InventoryUnit;
}

// ── Unit factory ──────────────────────────────────────────────────────────────
describe('unit factory', () => {
  it('creates a valid unit with defaults', () => {
    const u = makeUnit();
    expect(u.status).toBe('available');
    expect(u.flags).toEqual([]);
    expect(u.buyPrice).toBe(800);
    expect(u.imei).toBe('353209102768686');
  });

  it('overrides work correctly', () => {
    const u = makeUnit({ status: 'sold', buyPrice: 600, colour: 'Black' });
    expect(u.status).toBe('sold');
    expect(u.buyPrice).toBe(600);
    expect(u.colour).toBe('Black');
  });

  it('SHS unit has incoming status with null imei', () => {
    const u = makeUnit({ status: 'incoming', imei: null as any });
    expect(u.status).toBe('incoming');
    expect(u.imei).toBeNull();
  });

  it('SHS unit has incoming status with empty imei string', () => {
    const u = makeUnit({ status: 'incoming', imei: '' });
    expect(u.status).toBe('incoming');
    expect(u.imei).toBe('');
  });
});

// ── Status filtering ──────────────────────────────────────────────────────────
describe('status filtering', () => {
  const units = [
    makeUnit({ id: '1', status: 'available' }),
    makeUnit({ id: '2', status: 'available' }),
    makeUnit({ id: '3', status: 'sold',     salePrice: 650, saleDate: '2024-06-01' }),
    makeUnit({ id: '4', status: 'incoming', imei: '', buyPrice: 0 }),
    makeUnit({ id: '5', status: 'returned', returnType: 'repair' }),
  ];

  it('filters available units', () => {
    expect(units.filter(u => u.status === 'available')).toHaveLength(2);
  });

  it('filters sold units', () => {
    expect(units.filter(u => u.status === 'sold')).toHaveLength(1);
  });

  it('filters SHS/incoming units', () => {
    expect(units.filter(u => u.status === 'incoming')).toHaveLength(1);
  });

  it('filters returned units', () => {
    expect(units.filter(u => u.status === 'returned')).toHaveLength(1);
  });

  it('supplier-returned units are absent from the list (they are deleted from stock)', () => {
    // returned_to_supplier triggers a delete — no record remains in the array
    expect(units.some(u => u.returnType === 'returned_to_supplier')).toBe(false);
  });
});

// ── Stock aggregations ────────────────────────────────────────────────────────
describe('inventory aggregations', () => {
  const units = [
    makeUnit({ id: '1', status: 'available', buyPrice: 500, model: 'iPhone 14', colour: 'Black' }),
    makeUnit({ id: '2', status: 'available', buyPrice: 600, model: 'iPhone 14', colour: 'White' }),
    makeUnit({ id: '3', status: 'available', buyPrice: 700, model: 'iPhone 15', colour: 'Black' }),
    makeUnit({ id: '4', status: 'sold',      buyPrice: 500, salePrice: 650, model: 'iPhone 14' }),
    makeUnit({ id: '5', status: 'incoming',  buyPrice: 0,   model: 'iPhone 15', imei: '' }),
  ];

  it('calculates total stock value from available units only', () => {
    const value = units
      .filter(u => u.status === 'available')
      .reduce((s, u) => s + u.buyPrice, 0);
    expect(value).toBe(1800);
  });

  it('groups available units by model', () => {
    const byModel: Record<string, number> = {};
    units.filter(u => u.status === 'available').forEach(u => {
      byModel[u.model] = (byModel[u.model] || 0) + 1;
    });
    expect(byModel['iPhone 14']).toBe(2);
    expect(byModel['iPhone 15']).toBe(1);
  });

  it('calculates gross profit (revenue - cost - postage)', () => {
    const sold    = units.filter(u => u.status === 'sold');
    const revenue = sold.reduce((s, u) => s + (u.salePrice || 0), 0);
    const cost    = sold.reduce((s, u) => s + u.buyPrice, 0);
    const profit  = revenue - cost - 8; // £8 default postage
    expect(revenue).toBe(650);
    expect(cost).toBe(500);
    expect(profit).toBe(142);
  });

  it('excludes incoming/SHS units from available stock value', () => {
    const available = units.filter(u => u.status === 'available');
    const shs       = units.filter(u => u.status === 'incoming');
    expect(shs.every(u => !available.includes(u))).toBe(true);
  });
});

// ── Null IMEI safety (the (u.imei || '') guard) ───────────────────────────────
describe('null IMEI safety', () => {
  const nullImeiUnit = makeUnit({ status: 'incoming', imei: null as any });
  const emptyImeiUnit = makeUnit({ status: 'incoming', imei: '' });
  const validUnit    = makeUnit({ status: 'available', imei: '353209102768686' });

  it('search with null imei does not crash', () => {
    const q = '353209';
    expect(() => (nullImeiUnit.imei || '').includes(q)).not.toThrow();
  });

  it('search with empty imei does not crash', () => {
    const q = '353209';
    expect(() => (emptyImeiUnit.imei || '').includes(q)).not.toThrow();
  });

  it('null imei does not match a real IMEI search query', () => {
    const q = '353209';
    expect((nullImeiUnit.imei || '').includes(q)).toBe(false);
  });

  it('valid imei matches correctly after guard', () => {
    const q = '353209';
    expect((validUnit.imei || '').includes(q)).toBe(true);
  });

  it('filter over mixed null and valid imeis does not crash', () => {
    const units = [nullImeiUnit, emptyImeiUnit, validUnit];
    const q = '353209';
    expect(() => units.filter(u => (u.imei || '').includes(q))).not.toThrow();
    expect(units.filter(u => (u.imei || '').includes(q))).toHaveLength(1);
  });

  it('slice on imei with guard does not crash for null', () => {
    expect(() => (nullImeiUnit.imei || '').slice(0, 10)).not.toThrow();
    expect((nullImeiUnit.imei || '').slice(0, 10)).toBe('');
  });
});

// ── SHS concept ───────────────────────────────────────────────────────────────
describe('SHS concept invariants', () => {
  it('SHS unit has status incoming', () => {
    const shs = makeUnit({ status: 'incoming' });
    expect(shs.status).toBe('incoming');
  });

  it('SHS unit may have null IMEI — supplier holds the unit, no serial yet', () => {
    const shs = makeUnit({ status: 'incoming', imei: null as any });
    expect(shs.imei == null || shs.imei === '').toBe(true);
  });

  it('receiving an SHS unit sets status to available and assigns IMEI', () => {
    const shs      = makeUnit({ status: 'incoming', imei: null as any });
    const received = { ...shs, status: 'available' as const, imei: '353209102768686' };
    expect(received.status).toBe('available');
    expect(received.imei).toBe('353209102768686');
  });

  it('SHS units are excluded from in-office stock value', () => {
    const units = [
      makeUnit({ id: '1', status: 'available', buyPrice: 800 }),
      makeUnit({ id: '2', status: 'incoming',  buyPrice: 700, imei: '' }),
    ];
    const officeValue = units
      .filter(u => u.status === 'available')
      .reduce((s, u) => s + u.buyPrice, 0);
    expect(officeValue).toBe(800);
  });
});

// ── Returns flow ──────────────────────────────────────────────────────────────
describe('returns flow business logic', () => {
  const soldUnit = makeUnit({
    id: 'sold-1',
    status: 'sold',
    salePrice: 650,
    saleDate: '2024-06-01',
    salePlatform: 'eBay',
    saleOrderId: 'ORD-001',
    postageCost: 8,
    platformListed: true,
  });

  it('returned_to_inventory: status restored to available, sale fields cleared', () => {
    const returned: Partial<InventoryUnit> = {
      status: 'available',
      returnType: 'returned_to_inventory',
      returnDate: '2024-06-10',
      returnReason: 'Customer changed mind',
      salePrice: null,
      saleDate: null,
      salePlatform: null,
      saleOrderId: null,
      postageCost: null,
      platformListed: false,
      listingSites: [],
    };
    const afterReturn = { ...soldUnit, ...returned };
    expect(afterReturn.status).toBe('available');
    expect(afterReturn.salePrice).toBeNull();
    expect(afterReturn.saleDate).toBeNull();
    expect(afterReturn.platformListed).toBe(false);
    expect(afterReturn.listingSites).toEqual([]);
  });

  it('repair: status set to returned, unit stays in the system', () => {
    const returned: Partial<InventoryUnit> = {
      status: 'returned',
      returnType: 'repair',
      returnDate: '2024-06-10',
      returnReason: 'Faulty screen',
      salePrice: null,
      saleDate: null,
    };
    const afterReturn = { ...soldUnit, ...returned };
    expect(afterReturn.status).toBe('returned');
    expect(afterReturn.returnType).toBe('repair');
    expect(afterReturn.id).toBe(soldUnit.id); // still exists in array
  });

  it('returned_to_supplier: unit is deleted from stock (not present in array)', () => {
    let stock = [soldUnit, makeUnit({ id: 'other-unit' })];
    // Simulate the delete behaviour
    const returnType: ReturnCategory = 'returned_to_supplier';
    if (returnType === 'returned_to_supplier') {
      stock = stock.filter(u => u.id !== soldUnit.id);
    }
    expect(stock.find(u => u.id === soldUnit.id)).toBeUndefined();
    expect(stock).toHaveLength(1); // other unit still there
  });

  it('returned_to_inventory unit appears in returns history filter', () => {
    const units = [
      makeUnit({ id: '1', status: 'available', returnType: 'returned_to_inventory', returnDate: '2024-06-10' }),
      makeUnit({ id: '2', status: 'available' }), // normal available, no return
    ];
    const returns = units.filter(u => u.returnType && u.status === 'available');
    expect(returns).toHaveLength(1);
    expect(returns[0].id).toBe('1');
  });

  it('repair unit appears in returns list (status=returned)', () => {
    const units = [
      makeUnit({ id: '1', status: 'returned', returnType: 'repair' }),
      makeUnit({ id: '2', status: 'available' }),
    ];
    const returns = units.filter(u => u.status === 'returned');
    expect(returns).toHaveLength(1);
    expect(returns[0].returnType).toBe('repair');
  });
});

// ── PeriodicInventory grouping logic ─────────────────────────────────────────
describe('periodic inventory element grouping', () => {
  const units = [
    makeUnit({ id: '1', status: 'available', model: 'iPhone 15 Pro Max 256GB', colour: 'Natural Titanium', buyPrice: 800 }),
    makeUnit({ id: '2', status: 'available', model: 'iPhone 15 Pro Max 256GB', colour: 'Black Titanium',   buyPrice: 820 }),
    makeUnit({ id: '3', status: 'available', model: 'iPhone 15 Pro Max 256GB', colour: 'Natural Titanium', buyPrice: 810 }),
    makeUnit({ id: '4', status: 'incoming',  model: 'iPhone 15 Pro Max 256GB', colour: 'White', imei: '', buyPrice: 0 }),
    makeUnit({ id: '5', status: 'sold',      model: 'iPhone 15 Pro Max 256GB', colour: 'Black', salePrice: 900 }),
  ];

  it('only available units contribute to in-office element count', () => {
    const inOffice = units.filter(u => u.status === 'available' && /iphone 15 pro max/i.test(u.model));
    expect(inOffice).toHaveLength(3);
  });

  it('only incoming units contribute to SHS/supplier element count', () => {
    const shs = units.filter(u => u.status === 'incoming' && /iphone 15 pro max/i.test(u.model));
    expect(shs).toHaveLength(1);
  });

  it('sold units do not appear in either count', () => {
    const sold = units.filter(u => u.status === 'sold');
    const countedStatuses = ['available', 'incoming'];
    expect(sold.every(u => !countedStatuses.includes(u.status))).toBe(true);
  });

  it('colour variants derived only from available units', () => {
    const available = units.filter(u => u.status === 'available' && /iphone 15 pro max/i.test(u.model));
    const variants: Record<string, number> = {};
    available.forEach(u => {
      const col = u.colour || 'Unknown';
      variants[col] = (variants[col] || 0) + 1;
    });
    expect(variants['Natural Titanium']).toBe(2);
    expect(variants['Black Titanium']).toBe(1);
    expect(variants['White']).toBeUndefined(); // incoming unit colour not counted
  });

  it('stock value calculated from available units buy prices', () => {
    const available = units.filter(u => u.status === 'available' && /iphone 15 pro max/i.test(u.model));
    const value = available.reduce((s, u) => s + u.buyPrice, 0);
    expect(value).toBe(2430);
  });

  it('price range from available units', () => {
    const prices = units
      .filter(u => u.status === 'available' && /iphone 15 pro max/i.test(u.model))
      .map(u => u.buyPrice);
    expect(Math.min(...prices)).toBe(800);
    expect(Math.max(...prices)).toBe(820);
  });

  it('colour variant percentage sums to 100% across all available units for the series', () => {
    const available = units.filter(u => u.status === 'available' && /iphone 15 pro max/i.test(u.model));
    const total = available.length;
    const variants: Record<string, number> = {};
    available.forEach(u => {
      const col = u.colour || 'Unknown';
      variants[col] = (variants[col] || 0) + 1;
    });
    const pctSum = Object.values(variants).reduce((s, c) => s + Math.round((c / total) * 100), 0);
    // Due to rounding may be 99–101
    expect(pctSum).toBeGreaterThanOrEqual(99);
    expect(pctSum).toBeLessThanOrEqual(101);
  });
});
