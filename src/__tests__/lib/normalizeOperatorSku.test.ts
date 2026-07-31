/**
 * Locks the operator-SKU → clean-model normaliser. Units auto-created from
 * orphan-IMEI sales stored the raw SKU as their model (e.g.
 * "ASI-SG-S20-128-CN-EX"), which rendered as a truncated "ASI-SG-S" tile on
 * the periodic table and bucketed separately from real "Galaxy S20" units.
 * Normalising up-front in parseBrandModelStorage fixes display AND merges the
 * buckets — but it must NEVER mangle a real (spaced) model name.
 */
import { describe, it, expect } from 'vitest';
import { normalizeOperatorSku, parseBrandModelStorage, looksLikeSku, stripKnownBrandPrefix, splitFusedQualifier } from '../../lib/modelStorage';

describe('normalizeOperatorSku', () => {
  it('normalises Samsung Galaxy SKUs to clean model strings', () => {
    expect(normalizeOperatorSku('ASI-SG-S20-128-CN-EX')).toBe('Samsung Galaxy S20 128GB');
    expect(normalizeOperatorSku('SG-A14-128-VT')).toBe('Samsung Galaxy A14 128GB');
    expect(normalizeOperatorSku('ASI-SG-A30S-64-DS-BK-EX')).toBe('Samsung Galaxy A30S 64GB');
  });

  it('captures the 5G radio flag', () => {
    expect(normalizeOperatorSku('ASI-SG-A32-5G-64-BK-EX')).toBe('Samsung Galaxy A32 5G 64GB');
    expect(normalizeOperatorSku('ASI-SG-S23-5G-128GB-PBK-DS-E-SIM-EX')).toBe('Samsung Galaxy S23 5G 128GB');
  });

  it('splits a fused FE suffix (S21FE → S21 FE)', () => {
    expect(normalizeOperatorSku('SG-S21FE-128-GR-EX')).toBe('Samsung Galaxy S21 FE 128GB');
  });

  it('expands Samsung tablet codes (TABA8 → Tab A8)', () => {
    expect(normalizeOperatorSku('ASI-SG-TABA8-32GB-BK-EX')).toBe('Samsung Galaxy Tab A8 32GB');
  });

  it('handles Apple iPhone codes', () => {
    expect(normalizeOperatorSku('ASI-IP-SE3-128-MN-GD')).toBe('Apple iPhone SE3 128GB');
  });

  it('NEVER touches a real (spaced) model name', () => {
    expect(normalizeOperatorSku('Samsung Galaxy S20 128GB')).toBeNull();
    expect(normalizeOperatorSku('Galaxy S22')).toBeNull();
    expect(normalizeOperatorSku('iPhone 13 Pro Max')).toBeNull();
  });

  it('NEVER touches a real name that happens to contain a dash too', () => {
    // A stray whitespace-only SEGMENT between two dashes ("128- -BL") is a
    // spreadsheet artifact and must be tolerated (see the IPAD test below),
    // but a genuine word carrying its own internal space ("Samsung Galaxy
    // Note 9") must still bail, dash or no dash.
    expect(normalizeOperatorSku('Samsung Galaxy Note 9 - Pre-owned')).toBeNull();
  });

  it('returns null for non-SKU shapes (no dash, unknown brand code)', () => {
    expect(normalizeOperatorSku('S20')).toBeNull();          // no dash
    expect(normalizeOperatorSku('A-GRADE-REFURB')).toBeNull(); // unknown brand code 'A'
    expect(normalizeOperatorSku('')).toBeNull();
    expect(normalizeOperatorSku(null)).toBeNull();
  });

  it('does NOT misread a numeric model token as storage', () => {
    // iPhone "13" model must not be consumed as "13GB" storage.
    const n = normalizeOperatorSku('ASI-IP-13-128-MN-GD');
    expect(n).toBe('Apple iPhone 13 128GB');
  });

  it('handles a fused brand+model shorthand with no separating dash (IP12-BK-64)', () => {
    // A distinct marketplace SKU convention seen in real EBAY exports:
    // brand code + model number fused ("IP12"), followed by colour then
    // storage — as opposed to the ASI-style BRAND-MODEL-STORAGE layout.
    expect(normalizeOperatorSku('IP12-BK-64')).toBe('Apple iPhone 12 64GB');
    expect(normalizeOperatorSku('IP12-BK-128')).toBe('Apple iPhone 12 128GB');
    expect(normalizeOperatorSku('IP12-BL-128')).toBe('Apple iPhone 12 128GB');
    expect(normalizeOperatorSku('IP12-BL-256')).toBe('Apple iPhone 12 256GB');
  });

  it('still rejects an unknown fused prefix (no known brand code substring)', () => {
    expect(normalizeOperatorSku('ZZ99-BK-64')).toBeNull();
  });

  it('handles the real "IPAD-" brand code (distinct from the existing "IPD" alias)', () => {
    // Found in real client data: raw SKUs saved verbatim as a unit's model
    // because normalizeOperatorSku only recognised "IPD", not "IPAD".
    expect(normalizeOperatorSku('IPAD-11-128-BL')).toBe('Apple iPad 11 128GB');
    // Real value carries a blank segment from a double dash ("128- -BL") —
    // the empty-string filter must swallow it, not choke on it.
    expect(normalizeOperatorSku('IPAD-11THGEN-128- -BL')).toBe('Apple iPad 11THGEN 128GB');
    expect(normalizeOperatorSku('ASI-IPAD-7THGEN-32- -CELL-GD-EX')).toBe('Apple iPad 7THGEN 32GB');
  });

  it('strips the "VIN-" vendor prefix same as "ASI-"', () => {
    expect(normalizeOperatorSku('VIN-SG-A25-128-DBL-LN')).toBe('Samsung Galaxy A25 128GB');
  });
});

describe('parseBrandModelStorage — SKU integration', () => {
  it('buckets a SKU-coded unit the same as its clean-model twin', () => {
    const fromSku = parseBrandModelStorage('ASI-SG-S20-128-CN-EX');
    const fromClean = parseBrandModelStorage('Samsung Galaxy S20 128GB');
    expect(fromSku.model).toBe(fromClean.model);     // "Galaxy S20"
    expect(fromSku.storage).toBe(fromClean.storage); // "128GB"
    expect(fromSku.series).toBe(fromClean.series);   // "Galaxy S"
  });

  it('classifies SKU series correctly', () => {
    expect(parseBrandModelStorage('ASI-SG-A32-5G-64-BK-EX').series).toBe('Galaxy A');
    expect(parseBrandModelStorage('ASI-SG-TABA8-32GB-BK-EX').series).toBe('Galaxy Tab');
    expect(parseBrandModelStorage('ASI-IP-SE3-128-MN-GD').series).toBe('iPhone');
  });

  it('normalises brand-prefixed SKUs so they bucket with clean models', () => {
    // Sale imports sometimes prepend the brand word to the SKU.
    // Without this path the raw SKU code leaks into stock-alert labels.
    const prefixed = parseBrandModelStorage('Samsung ASI-SG-A32--64-BK-EX');
    const clean    = parseBrandModelStorage('Samsung Galaxy A32 64GB');
    expect(prefixed.brand).toBe(clean.brand);
    expect(prefixed.model).toBe(clean.model);
    expect(prefixed.storage).toBe(clean.storage);
    expect(prefixed.series).toBe(clean.series);

    expect(parseBrandModelStorage('Apple ASI-IP-SE3-128-MN-GD').model).toBe('iPhone SE3');
  });
});

describe('looksLikeSku / stripKnownBrandPrefix', () => {
  // Shared, exported "is this raw text still a SKU code" gate — used by both
  // inventoryStore (to decide whether a model is safe to leave untouched) and
  // the admin SkuReconciliation tool. Both must agree on the same definition.
  it('flags dash-delimited, space-free codes as SKU-like', () => {
    expect(looksLikeSku('ASI-SG-A32--64-BK-EX')).toBe(true);
    expect(looksLikeSku('IPAD-11-128-BL')).toBe(true);
    expect(looksLikeSku('VIN-SG-A25-128-DBL-LN')).toBe(true);
  });

  it('flags a brand-prefixed SKU code', () => {
    expect(looksLikeSku('Samsung ASI-SG-A32--64-BK-EX')).toBe(true);
    expect(looksLikeSku('Apple ASI-IP-SE3-128-MN-GD')).toBe(true);
  });

  it('does NOT flag a real, clean model name', () => {
    expect(looksLikeSku('Galaxy S22 Ultra')).toBe(false);
    expect(looksLikeSku('Samsung Galaxy A32 64GB')).toBe(false);
    expect(looksLikeSku('iPhone 13 Pro Max')).toBe(false);
    expect(looksLikeSku('')).toBe(false);
    expect(looksLikeSku(undefined)).toBe(false);
    expect(looksLikeSku(null)).toBe(false);
  });

  it('does NOT flag a real name that happens to contain a dash', () => {
    expect(looksLikeSku('Samsung Galaxy Note 9 - Pre-owned')).toBe(false);
  });

  it('stripKnownBrandPrefix removes a known leading brand word only', () => {
    expect(stripKnownBrandPrefix('Samsung ASI-SG-A32--64-BK-EX')).toBe('ASI-SG-A32--64-BK-EX');
    expect(stripKnownBrandPrefix('Apple ASI-IP-SE3-128-MN-GD')).toBe('ASI-IP-SE3-128-MN-GD');
    expect(stripKnownBrandPrefix('ASI-SG-A32--64-BK-EX')).toBe('ASI-SG-A32--64-BK-EX');
    expect(stripKnownBrandPrefix('Galaxy S22 Ultra')).toBe('Galaxy S22 Ultra');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Marketplace exports sometimes strip the space out of the model cell, so a
// qualifier fuses onto the model number: the operator saw "S205G" and
// "iPhone 12MINI" on the Sell Intelligence panel. These are NOT dash-delimited
// SKU codes, so normalizeOperatorSku never sees them — they arrive looking
// like model names and bucket separately from the correctly-spaced phone.
// ─────────────────────────────────────────────────────────────────────────────
describe('splitFusedQualifier', () => {
  it('re-separates the shapes seen in the client data', () => {
    expect(splitFusedQualifier('Galaxy S205G')).toBe('Galaxy S20 5G');
    expect(splitFusedQualifier('iPhone 12MINI')).toBe('iPhone 12 Mini');
  });

  it('handles a fused Pro Max without splitting it as Pro + stray Max', () => {
    expect(splitFusedQualifier('iPhone 14PROMAX')).toBe('iPhone 14 Pro Max');
  });

  it('covers the other qualifiers that fuse the same way', () => {
    expect(splitFusedQualifier('Galaxy A145G')).toBe('Galaxy A14 5G');
    expect(splitFusedQualifier('Galaxy S21ULTRA')).toBe('Galaxy S21 Ultra');
    expect(splitFusedQualifier('Galaxy A54LITE')).toBe('Galaxy A54 Lite');
  });

  it('NEVER splits a storage size — "64GB" contains "4G" but must survive', () => {
    // The trailing \b is what protects this: in "64GB" the "4G" is followed
    // by a word character, so no boundary exists and no split fires.
    expect(splitFusedQualifier('Galaxy A32 64GB')).toBe('Galaxy A32 64GB');
    expect(splitFusedQualifier('iPhone 12 128GB')).toBe('iPhone 12 128GB');
    expect(splitFusedQualifier('Galaxy Tab 256GB')).toBe('Galaxy Tab 256GB');
  });

  it('leaves an already-correct name untouched, and is idempotent', () => {
    expect(splitFusedQualifier('Galaxy S23 Ultra')).toBe('Galaxy S23 Ultra');
    expect(splitFusedQualifier('iPhone 13 Pro Max')).toBe('iPhone 13 Pro Max');
    expect(splitFusedQualifier(splitFusedQualifier('Galaxy S205G'))).toBe('Galaxy S20 5G');
  });

  it('does not invent a split where no digit precedes the qualifier', () => {
    expect(splitFusedQualifier('Galaxy Note Ultra')).toBe('Galaxy Note Ultra');
    expect(splitFusedQualifier('MiniPC')).toBe('MiniPC');
  });

  it('feeds through parseBrandModelStorage so the fused form parses correctly', () => {
    expect(parseBrandModelStorage('iPhone 12MINI').model).toBe('iPhone 12 Mini');
    // 5G is carried as a tag by this parser, same as the already-spaced form.
    expect(parseBrandModelStorage('Galaxy S205G').model)
      .toBe(parseBrandModelStorage('Galaxy S20 5G').model);
  });
});
