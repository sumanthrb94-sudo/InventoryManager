/**
 * Regression suite covering recent fixes to the data + UI behaviour:
 *
 *  - marketplaceFromListingSite accepts canonical enums (the cause of the
 *    sell-screen double-count bug)
 *  - parseBrandModelStorage applies first-word-as-brand uniformly
 *  - manualShsUnitsFrom + classifier rules with the 'manual_shs_' prefix
 *  - fingerprintModel collapses generation / cellular / storage variants
 *  - mapUnit honours operator orphan / manual overrides
 *
 * These are pure-function tests — they don't touch Firestore. The service
 * layer (recordSale / receiveShsAggregate / etc.) is covered separately in
 * src/__tests__/services/inventoryService.test.ts.
 */
import { describe, it, expect } from 'vitest';
import {
  marketplaceFromListingSite,
  listingSiteFromMarketplace,
  MARKETPLACES,
} from '../lib/platforms';
import { parseBrandModelStorage } from '../lib/modelStorage';
import {
  isManualShsUnit,
  isShsPlaceholder,
  manualShsUnitsFrom,
  shsAggregatesFrom,
  totalShsRecords,
} from '../lib/shsCount';
import {
  fingerprintModel,
  buildAggregateIndex,
  mapUnit,
  ORPHAN_MARKER,
} from '../lib/inventoryMapping';
import type { InventoryUnit, InventoryAggregate } from '../types';

// ── Helpers ──────────────────────────────────────────────────────────────────

const u = (over: Partial<InventoryUnit>): InventoryUnit => ({
  id: 'u_' + Math.random().toString(36).slice(2, 8),
  imei: '',
  model: '',
  brand: 'Other',
  category: 'Other',
  colour: '',
  buyPrice: 100,
  dateIn: '2026-05-17',
  supplierId: 'sup_test',
  status: 'available',
  flags: [],
  notes: '',
  platformListed: false,
  ownerId: 'shared',
  createdAt: '2026-05-17T00:00:00Z',
  ...over,
});

const agg = (over: Partial<InventoryAggregate>): InventoryAggregate => ({
  id: 'agg_' + Math.random().toString(36).slice(2, 8),
  model: '',
  buyPrice: 100,
  quantityNum: 1,
  supplierIds: ['sup_test'],
  ownerId: 'shared',
  createdAt: '2026-05-17',
  updatedAt: '2026-05-17',
  ...over,
});

// ── marketplaceFromListingSite (sell-screen double-count regression) ─────────

describe('marketplaceFromListingSite', () => {
  it('maps pretty marketplace names to canonical enums', () => {
    expect(marketplaceFromListingSite('eBay')).toBe('EBAY');
    expect(marketplaceFromListingSite('Amazon')).toBe('AMAZON');
    expect(marketplaceFromListingSite('OnBuy')).toBe('ONBUY');
    expect(marketplaceFromListingSite('Back Market')).toBe('BM');
    expect(marketplaceFromListingSite('Backmarket')).toBe('BM'); // legacy
    expect(marketplaceFromListingSite('Temu')).toBe('TEMU');
  });

  it('ALSO accepts canonical enums (the bug-fix path)', () => {
    // recordSale writes salePlatform: 'EBAY' / 'AMAZON' (enum values) on
    // the unit. Without this, inventoryUnitToSale fell back to 'EBAY' and
    // dedupe missed → sales appeared twice on the Sell screen.
    expect(marketplaceFromListingSite('EBAY')).toBe('EBAY');
    expect(marketplaceFromListingSite('AMAZON')).toBe('AMAZON');
    expect(marketplaceFromListingSite('BM')).toBe('BM');
    expect(marketplaceFromListingSite('ONBUY')).toBe('ONBUY');
    expect(marketplaceFromListingSite('TEMU')).toBe('TEMU');
  });

  it('round-trips through listingSiteFromMarketplace for every Marketplace', () => {
    for (const m of MARKETPLACES) {
      const pretty = listingSiteFromMarketplace(m);
      expect(marketplaceFromListingSite(pretty)).toBe(m);
    }
  });

  it('returns undefined for unknown inputs', () => {
    expect(marketplaceFromListingSite('Vinted')).toBeUndefined();
    expect(marketplaceFromListingSite('')).toBeUndefined();
  });

  // UnitDetailDrawer's "Mark as Sold" dropdown is built from
  // MARKETPLACES.map(listingSiteFromMarketplace) and the save handler routes
  // through recordSale, which needs a real Marketplace. Lock the invariant
  // that every offered option maps back to a defined marketplace — otherwise
  // a future LISTING_SITES edit could reintroduce a dead option (FBA / R T S /
  // Other) that recordSale rejects.
  it('every "Mark as Sold" dropdown option maps back to a marketplace', () => {
    const dropdownOptions = MARKETPLACES.map(listingSiteFromMarketplace);
    for (const opt of dropdownOptions) {
      expect(marketplaceFromListingSite(opt)).toBeDefined();
    }
    // And the default the drawer falls back to ('eBay') is sellable.
    expect(marketplaceFromListingSite('eBay')).toBe('EBAY');
  });
});

// ── parseBrandModelStorage (first-word-as-brand rule) ────────────────────────

describe('parseBrandModelStorage', () => {
  it('uses the first word as brand for known names (Apple)', () => {
    const r = parseBrandModelStorage('Apple iPhone XS 64GB');
    expect(r.brand).toBe('Apple');
    expect(r.model).toBe('iPhone XS');
    expect(r.storage).toBe('64GB');
  });

  it('uses the first word as brand for SAMSUNG (case-insensitive)', () => {
    const r = parseBrandModelStorage('SAMSUNG Galaxy S22 128GB');
    expect(r.brand).toBe('Samsung');
    expect(r.model).toBe('Galaxy S22');
    expect(r.storage).toBe('128GB');
  });

  it('takes unknown first-word as the brand verbatim (capitalised)', () => {
    const r = parseBrandModelStorage('Acme PhoneX 256GB');
    expect(r.brand).toBe('Acme');
    expect(r.model).toBe('PhoneX');
    expect(r.storage).toBe('256GB');
  });

  it('infers brand from device-series keywords when no explicit brand prefix', () => {
    // 'iPhone' / 'Galaxy' are device-series words — detectBrand still
    // resolves them to the parent brand (Apple / Samsung) so the periodic
    // table groups them correctly, but the series word stays in `model`
    // (it's not a brand label so it doesn't get stripped).
    const a = parseBrandModelStorage('iPhone 14 Pro 256GB');
    expect(a.brand).toBe('Apple');
    expect(a.model).toBe('iPhone 14 Pro');
    expect(a.storage).toBe('256GB');

    const b = parseBrandModelStorage('Galaxy Tab A8 64GB');
    expect(b.brand).toBe('Samsung');
    expect(b.model).toBe('Galaxy Tab A8');
    expect(b.storage).toBe('64GB');
  });

  it('parses storage from the trailing GB / TB token', () => {
    expect(parseBrandModelStorage('Apple iPhone 17 Pro Max 1TB').storage).toBe('1TB');
    expect(parseBrandModelStorage('Apple iPhone 11 128 gb').storage).toBe('128GB');
  });

  it('returns Other / empty for blank input', () => {
    const r = parseBrandModelStorage('');
    expect(r.brand).toBe('Other');
    expect(r.model).toBe('');
    expect(r.storage).toBeUndefined();
  });
});

// ── shsCount classifier (the manual_shs_ id prefix bug-fix) ──────────────────

describe('shsCount classifiers', () => {
  it('isShsPlaceholder catches ids starting with "shs_" (parser-synthesised)', () => {
    expect(isShsPlaceholder(u({ id: 'shs_ipad_mhl_42', status: 'incoming' }))).toBe(true);
  });

  it('isManualShsUnit catches ids NOT starting with "shs_" (manual add)', () => {
    // The new AddStockManualModal uses 'manual_shs_<ts>_<i>' so the unit
    // is correctly classified as manual instead of placeholder.
    expect(isManualShsUnit(u({ id: 'manual_shs_1700_0', status: 'incoming' }))).toBe(true);
    expect(isManualShsUnit(u({ id: 'imei_355254192804932', status: 'incoming' }))).toBe(true);
  });

  it('neither classifier matches available / sold units', () => {
    const av = u({ id: 'whatever', status: 'available' });
    expect(isShsPlaceholder(av)).toBe(false);
    expect(isManualShsUnit(av)).toBe(false);
  });

  it('manualShsUnitsFrom returns only manual SHS, newest first', () => {
    const list: InventoryUnit[] = [
      u({ id: 'manual_shs_old',  status: 'incoming', dateIn: '2026-05-10' }),
      u({ id: 'manual_shs_new',  status: 'incoming', dateIn: '2026-05-17' }),
      u({ id: 'shs_placeholder', status: 'incoming', dateIn: '2026-05-17' }), // skipped
      u({ id: 'av',              status: 'available' }),                       // skipped
    ];
    const out = manualShsUnitsFrom(list);
    expect(out.map(x => x.id)).toEqual(['manual_shs_new', 'manual_shs_old']);
  });

  it('shsAggregatesFrom keeps only SHS-tagged aggregates', () => {
    const list = [
      agg({ id: 'a', quantityText: 'SHS' }),
      agg({ id: 'b', quantityText: 'NO STOCK' }),
      agg({ id: 'c', quantityNum: 5 }),
    ];
    expect(shsAggregatesFrom(list).map(a => a.id)).toEqual(['a']);
  });

  it('totalShsRecords sums aggregates + manual units', () => {
    const aggs = [agg({ quantityText: 'SHS' }), agg({ quantityText: 'SHS' })];
    const units = [
      u({ id: 'manual_shs_1', status: 'incoming' }),
      u({ id: 'shs_placeholder', status: 'incoming' }), // not counted
      u({ id: 'available_x',    status: 'available' }),  // not counted
    ];
    expect(totalShsRecords(units, aggs)).toBe(3); // 2 aggs + 1 manual
  });
});

// ── Inventory mapping fingerprint + match ────────────────────────────────────

describe('fingerprintModel', () => {
  it('collapses 9th gen / 9 GEN / 9TH GEN to "9"', () => {
    const a = fingerprintModel('iPad 9th gen 64GB');
    const b = fingerprintModel('IPAD 9TH GEN 64GB');
    const c = fingerprintModel('iPad 9 gen 64GB');
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('collapses cellular synonyms (W/C, WiFi+4G, 5G, LTE) to "cell"', () => {
    const wc       = fingerprintModel('IPAD 9TH GEN 64GB W/C');
    const wifiPlus = fingerprintModel('iPad 9th gen 64GB - WiFi + 4G');
    const fiveG    = fingerprintModel('Galaxy A32 5G 64GB');
    expect(wc).toContain('cell');
    expect(wifiPlus).toContain('cell');
    expect(fiveG).toContain('cell');
  });

  it('treats wifi-only and cellular variants as different', () => {
    const wifi = fingerprintModel('iPad Pro 64GB WiFi');
    const cell = fingerprintModel('iPad Pro 64GB W/C');
    expect(wifi).not.toBe(cell);
    expect(wifi).toContain('wifi');
    expect(cell).toContain('cell');
  });

  it('normalises storage so "64 GB" / "64GB" / "64 gb" all match', () => {
    const a = fingerprintModel('iPad 9 64 GB W/C');
    const b = fingerprintModel('iPad 9 64GB W/C');
    const c = fingerprintModel('iPad 9 64 gb W/C');
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('strips parenthetical asides like "(2021)"', () => {
    const a = fingerprintModel('iPad 10.2 (2021) 9 64GB W/C');
    expect(a).not.toMatch(/2021|\(/);
  });
});

describe('mapUnit', () => {
  const aggregates: InventoryAggregate[] = [
    agg({ id: 'a_iphone13_128', brand: 'Apple', model: 'iPhone 13', storage: '128GB', quantityNum: 5 } as any),
    agg({ id: 'a_ipad9_64',     brand: 'Apple', model: 'iPad 9th gen WiFi + 4G', storage: '64GB', quantityNum: 10 } as any),
  ];
  const index = buildAggregateIndex(aggregates);

  it('auto-matches a known-good unit to its aggregate', () => {
    const unit = u({ brand: 'Apple', model: 'IPHONE 13', storage: '128GB' });
    const r = mapUnit(unit, index);
    expect(r.status).toBe('mapped');
    expect(r.aggregate?.id).toBe('a_iphone13_128');
  });

  it('matches the cellular-vs-wifi mismatch correctly', () => {
    // The 64GB aggregate is cellular. A wifi-only unit should NOT match.
    const unit = u({ brand: 'Apple', model: 'iPad 9 WiFi', storage: '64GB' });
    const r = mapUnit(unit, index);
    expect(r.status).not.toBe('mapped');
  });

  it('returns "manual" when inventoryAggregateId override is set', () => {
    const unit = u({ brand: 'Apple', model: 'something weird', storage: '128GB', inventoryAggregateId: 'a_iphone13_128' } as any);
    const r = mapUnit(unit, index);
    expect(r.status).toBe('manual');
    expect(r.aggregate?.id).toBe('a_iphone13_128');
  });

  it('returns "orphan" when the orphan sentinel is set', () => {
    const unit = u({ brand: 'Apple', model: 'iPhone 13', storage: '128GB', inventoryAggregateId: ORPHAN_MARKER } as any);
    const r = mapUnit(unit, index);
    expect(r.status).toBe('orphan');
  });

  it('returns "shs" without scoring for incoming units', () => {
    const unit = u({ status: 'incoming', model: 'iPhone 13', brand: 'Apple', storage: '128GB' });
    const r = mapUnit(unit, index);
    expect(r.status).toBe('shs');
    expect(r.aggregate).toBeUndefined();
  });

  it('returns suggestions when unmapped, sorted by score desc', () => {
    const unit = u({ brand: 'Apple', model: 'iPhone 13 Pro Max', storage: '128GB' });
    const r = mapUnit(unit, index);
    expect(r.status === 'mapped' || r.status === 'unmapped').toBe(true);
    if (r.status === 'unmapped') {
      expect(r.suggestions).toBeDefined();
      // Top suggestion should be the closest aggregate (iPhone 13 / 128GB).
      expect(r.suggestions![0]?.id).toBe('a_iphone13_128');
    }
  });
});
