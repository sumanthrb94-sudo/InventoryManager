/**
 * Pinned against the client's REAL catalog contents (2026-07-31 screenshots
 * of Admin → Configuration → Models). Nearly every row had a blank Brand
 * column with the brand word fused into an ALL-CAPS model string, because
 * the "+ Add" pill in Add Stock / Bulk Order wrote `brand: ''` verbatim.
 * The single correct row, SAMSUNG / GALAXY S21 5G, was the one added
 * through the Configuration form, which requires a brand.
 */
import { describe, it, expect } from 'vitest';
import {
  normaliseCatalogEntry,
  properCaseModel,
  findModelCatalogDrift,
  fixModelCatalog,
} from '../../lib/migrations/normaliseModelCatalog';

const row = (id: string, model: string, brand = '') => ({ id, brand, model });

describe('normaliseCatalogEntry — real rows from the client catalog', () => {
  it.each([
    ['APPLE IPHONE 12',            'Apple',   'iPhone 12',              'iPhone'],
    ['APPLE IPHONE 13 PRO',        'Apple',   'iPhone 13 Pro',          'iPhone'],
    ['APPLE IPHONE SE2',           'Apple',   'iPhone SE2',             'iPhone'],
    ['APPLE AIRPODS 3RD GENERATION','Apple',  'AirPods 3rd Generation', undefined],
    ['APPLE WATCH SE3',            'Apple',   'Watch SE3',              'Apple Watch'],
    ['SAMSUNG GALAXY A05 4G',      'Samsung', 'Galaxy A05 4G',          'Galaxy A'],
    ['SAMSUNG GALAXY XCOVER 5 4G', 'Samsung', 'Galaxy XCover 5 4G',     'Galaxy XCover'],
  ])('%s → brand + clean model + series', (model, brand, expectModel, expectSeries) => {
    const out = normaliseCatalogEntry({ brand: '', model });
    expect(out.brand).toBe(brand);
    expect(out.model).toBe(expectModel);
    expect(out.series).toBe(expectSeries);
  });

  it('keeps a connectivity tag on the name — WiFi vs Cellular is a real product difference', () => {
    expect(normaliseCatalogEntry({ model: 'APPLE IPAD 11TH GEN WIFI' }).model).toBe('iPad 11th Gen WiFi');
    expect(normaliseCatalogEntry({ model: 'SAMSUNG GALAXY TAB A9 WIFI' }).model).toBe('Galaxy Tab A9 WiFi');
  });

  it('keeps 5G on the name rather than silently shortening it', () => {
    expect(normaliseCatalogEntry({ brand: 'SAMSUNG', model: 'GALAXY S21 5G' }))
      .toEqual({ brand: 'Samsung', model: 'Galaxy S21 5G', series: 'Galaxy S' });
  });

  it('drops storage fused into the model — storage belongs on the unit', () => {
    expect(normaliseCatalogEntry({ model: 'GALAXY A36 256GB' }).model).toBe('Galaxy A36');
    expect(normaliseCatalogEntry({ model: 'GALAXY TAB A T580 16GB' }).model).toBe('Galaxy Tab A T580');
  });

  it('never invents a brand from an unrecognised first word', () => {
    // The parser will happily call "SIM" a brand. It is not one.
    const out = normaliseCatalogEntry({ model: 'SIM PINS' });
    expect(out.brand).toBe('');
    expect(normaliseCatalogEntry({ model: 'generic' }).brand).toBe('');
    expect(normaliseCatalogEntry({ model: 'pins' }).brand).toBe('');
  });

  it('never overwrites a brand that is already correct', () => {
    expect(normaliseCatalogEntry({ brand: 'Apple', model: 'iPhone 15' }).brand).toBe('Apple');
  });

  it('an already-clean row is returned unchanged (idempotent)', () => {
    const clean = { brand: 'Apple', model: 'iPhone 12', series: 'iPhone' };
    expect(normaliseCatalogEntry(clean)).toEqual(clean);
    expect(normaliseCatalogEntry(normaliseCatalogEntry(clean))).toEqual(clean);
  });

  it('an empty model is left alone', () => {
    expect(normaliseCatalogEntry({ brand: '', model: '   ' }).model).toBe('');
  });
});

describe('properCaseModel', () => {
  it('applies house spellings rather than naive Title Case', () => {
    expect(properCaseModel('IPHONE 13 PRO MAX')).toBe('iPhone 13 Pro Max');
    expect(properCaseModel('IPAD 11TH GEN')).toBe('iPad 11th Gen');
    expect(properCaseModel('GALAXY XCOVER 5')).toBe('Galaxy XCover 5');
  });

  it('keeps model/spec codes shouty and case sizes lowercase', () => {
    expect(properCaseModel('GALAXY A05 4G')).toBe('Galaxy A05 4G');
    expect(properCaseModel('WATCH SE3 40MM')).toBe('Watch SE3 40mm');
  });

  it('cases each side of a plus-joined token', () => {
    expect(properCaseModel('IWATCH SE3 GPS+CELLULAR')).toBe('iWatch SE3 GPS+Cellular');
  });

  it('preserves a trailing plus in a model code', () => {
    expect(properCaseModel('GALAXY TAB A11+')).toBe('Galaxy Tab A11+');
  });
});

describe('findModelCatalogDrift', () => {
  it('merges rows that become identical once the brand is split out', () => {
    // Both of these were live in the catalog at once, which is why the
    // displayed name for an iPhone 14 was effectively arbitrary.
    const drift = findModelCatalogDrift([
      row('a', 'APPLE IPHONE 14'),
      row('b', 'IPHONE 14'),
    ]);
    expect(drift.duplicates).toHaveLength(1);
    expect(drift.duplicates[0]).toMatchObject({ keepId: 'a', dropIds: ['b'], label: 'Apple iPhone 14' });
    // The row being deleted isn't also patched.
    expect(drift.patches.map(p => p.id)).toEqual(['a']);
  });

  it('leaves genuinely different models as separate rows', () => {
    const drift = findModelCatalogDrift([
      row('a', 'SAMSUNG GALAXY TAB A11 WIFI'),
      row('b', 'GALAXY TAB A11+ WIFI'),
    ]);
    expect(drift.duplicates).toHaveLength(0);
    expect(drift.patches).toHaveLength(2);
  });

  it('reports unbranded rows without deleting them', () => {
    const drift = findModelCatalogDrift([row('a', 'generic'), row('b', 'pins')]);
    expect(drift.unbranded.map(u => u.model).sort()).toEqual(['Generic', 'Pins']);
    expect(drift.duplicates).toHaveLength(0);
  });

  it('an already-clean catalog produces no work at all', () => {
    const drift = findModelCatalogDrift([
      { id: 'a', brand: 'Apple', model: 'iPhone 12', series: 'iPhone' },
      { id: 'b', brand: 'Samsung', model: 'Galaxy A05 4G', series: 'Galaxy A' },
    ]);
    expect(drift.patches).toHaveLength(0);
    expect(drift.duplicates).toHaveLength(0);
  });

  it('skips rows with no model', () => {
    expect(findModelCatalogDrift([{ id: 'a', brand: '', model: '' }]).patches).toHaveLength(0);
  });
});

describe('fixModelCatalog', () => {
  it('writes the repairs and deletes only the redundant duplicates', async () => {
    const written: any[] = [];
    const deleted: string[] = [];
    const db = {
      bulkCreate: async (entries: any[]) => { written.push(...entries); },
      delete: async (_c: string, id: string) => { deleted.push(id); },
    };
    const drift = findModelCatalogDrift([
      row('a', 'APPLE IPHONE 14'),
      row('b', 'IPHONE 14'),
      row('c', 'SAMSUNG GALAXY A05 4G'),
    ]);
    const res = await fixModelCatalog(drift, db);

    expect(res).toEqual({ updated: 2, removed: 1 });
    expect(deleted).toEqual(['b']);
    expect(written.every(w => w.collection === 'models')).toBe(true);
    expect(written.find(w => w.id === 'a').data)
      .toEqual({ brand: 'Apple', model: 'iPhone 14', series: 'iPhone' });
  });

  it('omits series entirely when none could be derived, rather than writing undefined', async () => {
    const written: any[] = [];
    const db = {
      bulkCreate: async (entries: any[]) => { written.push(...entries); },
      delete: async () => {},
    };
    await fixModelCatalog(findModelCatalogDrift([row('a', 'APPLE AIRPODS 3RD GENERATION')]), db);
    expect(written[0].data).toEqual({ brand: 'Apple', model: 'AirPods 3rd Generation' });
    expect('series' in written[0].data).toBe(false);
  });

  it('no drift means no writes and no deletes', async () => {
    let touched = false;
    const db = {
      bulkCreate: async () => { touched = true; },
      delete: async () => { touched = true; },
    };
    const res = await fixModelCatalog({ patches: [], duplicates: [] }, db);
    expect(res).toEqual({ updated: 0, removed: 0 });
    expect(touched).toBe(false);
  });
});
