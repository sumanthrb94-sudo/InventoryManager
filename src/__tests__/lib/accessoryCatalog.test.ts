/**
 * Accessory intake used to be free text with no gate, which let the same
 * physical product enter as several separate stock pools under reordered
 * names. The operator reported exactly this: "type c usb" and "c type usb"
 * both being added. These lock the order-insensitive matching that makes
 * the existing pool findable whichever way round it's typed — without it,
 * the strict picker would show "no matches" and push the operator straight
 * into creating the duplicate it's meant to prevent.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeAccessoryKey,
  buildAccessoryCatalog,
  accessoryEntryFor,
  searchAccessoryCatalog,
} from '../../lib/accessoryCatalog';
import type { AccessoryStock } from '../../types';

const acc = (sku: string, name: string, quantity = 10): AccessoryStock => ({
  id: sku.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
  sku, name, quantity, buyPrice: 5, ownerId: 'shared', createdAt: '2026-07-01',
} as AccessoryStock);

describe('normalizeAccessoryKey — word order and punctuation stop mattering', () => {
  it('the operator-reported duplicate pair collapses to one key', () => {
    expect(normalizeAccessoryKey('type c usb')).toBe(normalizeAccessoryKey('c type usb'));
  });

  it('punctuation variants of the same words collapse', () => {
    const k = normalizeAccessoryKey('USB-C 20W');
    expect(normalizeAccessoryKey('usb c 20w')).toBe(k);
    expect(normalizeAccessoryKey('USB_C  20W')).toBe(k);
  });

  it('word order collapses', () => {
    expect(normalizeAccessoryKey('20W USB-C')).toBe(normalizeAccessoryKey('USB-C 20W'));
  });

  it('a genuinely different product keeps a different key (extra token)', () => {
    expect(normalizeAccessoryKey('USB-C 20W Charger')).not.toBe(normalizeAccessoryKey('USB-C 20W'));
  });

  it('empty / junk input yields an empty key', () => {
    expect(normalizeAccessoryKey('')).toBe('');
    expect(normalizeAccessoryKey('   ---  ')).toBe('');
    expect(normalizeAccessoryKey(null)).toBe('');
  });
});

describe('accessoryEntryFor — the strict picker\'s "does this already exist" gate', () => {
  const catalog = buildAccessoryCatalog([
    acc('USB-C-20W', 'USB-C 20W Charger'),
    acc('SIM-PIN', 'SIM Eject Pin'),
  ]);

  it('finds the pool by its exact SKU', () => {
    expect(accessoryEntryFor(catalog, 'USB-C-20W')?.sku).toBe('USB-C-20W');
  });

  it('finds the pool by its display name', () => {
    expect(accessoryEntryFor(catalog, 'USB-C 20W Charger')?.sku).toBe('USB-C-20W');
  });

  it('finds the pool when the operator reorders the words', () => {
    expect(accessoryEntryFor(catalog, '20W USB-C')?.sku).toBe('USB-C-20W');
    expect(accessoryEntryFor(catalog, 'Charger 20W USB-C')?.sku).toBe('USB-C-20W');
  });

  it('returns null for a genuinely unknown accessory — this is what blocks an employee', () => {
    expect(accessoryEntryFor(catalog, 'Wireless Charging Pad')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(accessoryEntryFor(catalog, '')).toBeNull();
  });
});

describe('searchAccessoryCatalog — surfaces the existing pool before a dupe can be created', () => {
  const catalog = buildAccessoryCatalog([
    acc('USB-C-20W', 'USB-C 20W Charger', 40),
    acc('USB-A-CABLE', 'USB-A to C Cable', 5),
    acc('SIM-PIN', 'SIM Eject Pin', 100),
  ]);

  it('typing the words in the wrong order still finds it', () => {
    const hits = searchAccessoryCatalog(catalog, '20W USB');
    expect(hits[0].sku).toBe('USB-C-20W');
  });

  it('partial typing matches on token prefixes', () => {
    const hits = searchAccessoryCatalog(catalog, 'sim');
    expect(hits.map(h => h.sku)).toContain('SIM-PIN');
  });

  it('an unrelated word disqualifies the entry — no false "close enough" match', () => {
    expect(searchAccessoryCatalog(catalog, 'wireless pad')).toHaveLength(0);
  });

  it('an empty query lists the catalog, busiest pools first', () => {
    const hits = searchAccessoryCatalog(catalog, '');
    expect(hits).toHaveLength(3);
    expect(hits[0].sku).toBe('SIM-PIN'); // quantity 100
  });

  it('respects the result limit', () => {
    expect(searchAccessoryCatalog(catalog, '', 2)).toHaveLength(2);
  });
});

describe('buildAccessoryCatalog', () => {
  it('skips pools with no SKU and falls back to the SKU when a name is missing', () => {
    const catalog = buildAccessoryCatalog([
      acc('', 'Nameless'),
      { ...acc('BARE-SKU', ''), name: '' } as AccessoryStock,
    ]);
    expect(catalog).toHaveLength(1);
    expect(catalog[0].name).toBe('BARE-SKU');
  });
});
