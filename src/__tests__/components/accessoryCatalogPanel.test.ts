/**
 * The accessory catalog is the admin's "what accessories exist" list — the
 * counterpart to the device Models catalog, but with only a SKU and a name
 * (Brand / Model / Series is device vocabulary, and forcing accessories
 * into it is what put "generic" / "pins" / "SIM PINS" in the device list).
 *
 * Registering here creates the pool at quantity 0 so it is pickable in Add
 * Stock before any stock exists — the accessory equivalent of seeding a
 * device model.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { findAccessoryConflict } from '../../components/AccessoryCatalogPanel';

const collections: Record<string, Map<string, any>> = {};
function col(name: string): Map<string, any> {
  return (collections[name] ??= new Map());
}

vi.mock('../../lib/dbService', () => ({
  dbService: {
    async create(c: string, id: string, data: any) { col(c).set(id, { ...data, id }); },
    async update(c: string, id: string, data: any) { col(c).set(id, { ...(col(c).get(id) ?? {}), ...data, id }); },
    async delete(c: string, id: string) { col(c).delete(id); },
    async readAll(c: string) { return Array.from(col(c).values()); },
    applyCacheItem() {},
  },
}));

import { registerAccessorySku } from '../../services/inventoryService';

beforeEach(() => { for (const k of Object.keys(collections)) collections[k].clear(); });

const stock = (id: string, sku: string, name: string) => ({ id, sku, name });

describe('findAccessoryConflict — blocks a duplicate the picker would treat as the same thing', () => {
  const existing = [stock('usb_c_20w', 'USB-C-20W', 'USB-C 20W Charger')];

  it('catches a reordered name — the operator-reported failure mode', () => {
    expect(findAccessoryConflict(existing, '20W USB-C Charger')?.sku).toBe('USB-C-20W');
  });

  it('catches a punctuation variant of the SKU', () => {
    expect(findAccessoryConflict(existing, 'usb c 20w')?.sku).toBe('USB-C-20W');
  });

  it('allows a genuinely different accessory', () => {
    expect(findAccessoryConflict(existing, 'SIM Eject Pin')).toBeNull();
  });

  it('ignoreId lets a rename keep its own row without colliding with itself', () => {
    expect(findAccessoryConflict(existing, 'USB-C 20W Charger', 'usb_c_20w')).toBeNull();
  });

  it('empty text never conflicts', () => {
    expect(findAccessoryConflict(existing, '   ')).toBeNull();
  });
});

describe('registerAccessorySku — pre-register with no stock', () => {
  it('creates a pool at quantity 0 so it is immediately pickable', async () => {
    const res = await registerAccessorySku({ sku: 'WIRELESS-PAD', name: 'Wireless Charging Pad' });
    expect(res).toMatchObject({ ok: true, id: 'wireless_pad' });

    const doc = col('accessoryStock').get('wireless_pad');
    expect(doc).toMatchObject({
      sku: 'WIRELESS-PAD', name: 'Wireless Charging Pad', quantity: 0, totalReceived: 0, buyPrice: 0,
    });
  });

  it('refuses a SKU that already exists rather than clobbering its stock', async () => {
    col('accessoryStock').set('usb_c_20w', { id: 'usb_c_20w', sku: 'USB-C-20W', quantity: 40 });
    const res = await registerAccessorySku({ sku: 'USB-C 20W', name: 'Dupe attempt' });
    expect(res).toEqual({ ok: false, error: 'already_exists' });
    expect(col('accessoryStock').get('usb_c_20w').quantity).toBe(40);
  });

  it('rejects an empty SKU', async () => {
    expect(await registerAccessorySku({ sku: '  ', name: 'x' })).toEqual({ ok: false, error: 'missing_sku' });
  });

  it('falls back to the SKU when no name is given', async () => {
    await registerAccessorySku({ sku: 'BARE', name: '' });
    expect(col('accessoryStock').get('bare').name).toBe('BARE');
  });
});
