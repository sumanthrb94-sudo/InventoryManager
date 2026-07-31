/**
 * Locks the operator-SKU → clean-model normaliser. Units auto-created from
 * orphan-IMEI sales stored the raw SKU as their model (e.g.
 * "ASI-SG-S20-128-CN-EX"), which rendered as a truncated "ASI-SG-S" tile on
 * the periodic table and bucketed separately from real "Galaxy S20" units.
 * Normalising up-front in parseBrandModelStorage fixes display AND merges the
 * buckets — but it must NEVER mangle a real (spaced) model name.
 */
import { describe, it, expect } from 'vitest';
import { normalizeOperatorSku, parseBrandModelStorage } from '../../lib/modelStorage';

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
