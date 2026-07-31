/**
 * Configuration → Models Catalog is one of only two write paths to the
 * `models` collection (the other is DeviceComboBox's inline "+Add" pill,
 * see DeviceComboBox.test.tsx). This panel previously had two
 * inconsistencies with the rest of the app's catalog handling:
 *   1. isDuplicate() did a raw exact-string compare instead of the same
 *      bucket-key normalisation the picker uses — "Galaxy S23" /
 *      "GALAXY S23" / "S23" all passed as distinct rows here.
 *   2. No SKU-shape cleanup on manual entry — an admin could paste a raw
 *      operator SKU code straight into the Model field.
 * Both are now pure, exported functions (`isDuplicateModel`,
 * `cleanCatalogModelInput`) so they're directly testable without mounting
 * the full component (which pulls in Suppliers/DataHealthPanel/
 * AccessoryStockPanel and a live-auth admin check).
 */
import { describe, it, expect } from 'vitest';
import { isDuplicateModel, cleanCatalogModelInput, modelBucketKey } from '../../components/ConfigurationPanel';

const doc = (id: string, brand: string, model: string) => ({ id, brand, model });

describe('isDuplicateModel — bucket-key comparison', () => {
  it('catches case-only variants that an exact-string compare would miss', () => {
    const models = [doc('m1', 'Samsung', 'Galaxy S23')];
    expect(isDuplicateModel(models, 'Samsung', 'GALAXY S23')).toBe(true);
  });

  it('catches a bare-series variant against the same bucket ("S23" vs "Galaxy S23")', () => {
    const models = [doc('m1', 'Samsung', 'Galaxy S23')];
    expect(isDuplicateModel(models, 'Samsung', 'S23')).toBe(true);
  });

  it('a genuinely different model is not flagged as a duplicate', () => {
    const models = [doc('m1', 'Samsung', 'Galaxy S23')];
    expect(isDuplicateModel(models, 'Samsung', 'Galaxy S24')).toBe(false);
  });

  it('ignoreId lets an edit keep its own row without colliding with itself', () => {
    const models = [doc('m1', 'Samsung', 'Galaxy S23')];
    expect(isDuplicateModel(models, 'Samsung', 'GALAXY S23', 'm1')).toBe(false);
  });

  it('an empty catalog never flags a duplicate', () => {
    expect(isDuplicateModel([], 'Samsung', 'Galaxy S23')).toBe(false);
  });
});

describe('cleanCatalogModelInput — SKU-shape guard on manual entry', () => {
  it('cleans up a recognised raw SKU code before it can be saved', () => {
    expect(cleanCatalogModelInput('IPAD-11-128-BL')).toBe('Apple iPad 11 128GB');
  });

  it('leaves a genuine clean model name untouched', () => {
    expect(cleanCatalogModelInput('iPhone 13 Pro Max')).toBe('iPhone 13 Pro Max');
  });

  it('passes an unrecognised SKU-shaped string through verbatim (can\'t safely guess)', () => {
    // Deliberately a code no rule claims. AT580-16-GY used to sit here, but
    // it is now recognised as a Galaxy Tab A T580, so it no longer tests
    // the "can't guess" path.
    expect(cleanCatalogModelInput('WX440-12-PK')).toBe('WX440-12-PK');
  });

  it('cleans a recognised tablet code rather than saving the raw SKU', () => {
    expect(cleanCatalogModelInput('AT580-16-GY')).toBe('Samsung Galaxy Tab A T580 16GB');
  });

  it('trims surrounding whitespace', () => {
    expect(cleanCatalogModelInput('  iPhone 13  ')).toBe('iPhone 13');
  });
});

describe('modelBucketKey', () => {
  it('is brand-cased-insensitive and model-prefix-insensitive', () => {
    expect(modelBucketKey('samsung', 'GALAXY S23')).toBe(modelBucketKey('Samsung', 'S23'));
  });
});
