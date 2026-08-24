/**
 * The Sales Report import rejects models and suppliers it has never seen.
 *
 * WHY
 *
 * Every other route into inventory is gated to the admin catalog — Add Stock
 * uses a strict picker that will not accept a name the admin has not added.
 * Import was the exception, and it is the one route where data arrives a
 * thousand rows at a time.
 *
 * The old gate asked whether a model was PRESENT. "iPhoen 13" is present. It
 * passed, minted a unit under a model nobody stocks, and that unit then sat
 * outside every model-grouped report — invisible rather than wrong, which is
 * the harder kind to notice. A supplier invented at the keyboard did the same
 * to the supplier reports.
 *
 * THE TWO ESCAPE HATCHES, both tested below
 *
 * A gate with no way through is worse than no gate. Neither check fires when
 * the caller cannot judge:
 *   - no catalog loaded  -> models are not rejected
 *   - no suppliers on file -> suppliers are not rejected
 * That matters on a freshly wiped database, where every row would otherwise
 * be unsatisfiable and the operator would simply be stuck.
 */
import { describe, it, expect } from 'vitest';
import {
  auditRowMissing, suggestRowFixes, buildPreview, inventoryModelIndex,
} from '../../components/SalesReportImport';
import { buildCatalogIndex } from '../../lib/modelReconciliation';

const CATALOG = buildCatalogIndex([
  { brand: 'Apple', model: 'iPhone 13' },
  { brand: 'Samsung', model: 'Galaxy A32' },
] as any);

const SUPPLIERS = new Set(['imax', 'mobile wholesale ltd']);
const KNOWN = { catalogIndex: CATALOG, supplierNames: SUPPLIERS };

const row = (over: Partial<Record<string, any>> = {}) => ({
  imei: '350111000000011',
  model: 'iPhone 13',
  supplierName: 'IMAX',
  buyPrice: 300,
  salePrice: 400,
  saleDate: '2026-08-01',
  marketplace: 'AMAZON',
  orderNumber: 'A1',
  ...over,
});

describe('a row whose model is not in the catalog', () => {
  it('is rejected', () => {
    expect(auditRowMissing(row({ model: 'Nokia Fictional 9000' }), KNOWN))
      .toContain('model not in catalog');
  });

  /** The case the presence check could never catch, and the reason this
   *  exists: a typo is present, well-formed, and completely wrong. */
  it('is rejected when it is a typo of a real one', () => {
    expect(auditRowMissing(row({ model: 'iPhoen 13' }), KNOWN))
      .toContain('model not in catalog');
  });

  it('is accepted when it IS in the catalog', () => {
    expect(auditRowMissing(row({ model: 'iPhone 13' }), KNOWN)).toEqual([]);
    expect(auditRowMissing(row({ model: 'Galaxy A32' }), KNOWN)).toEqual([]);
  });

  /** The catalog indexes a brand-less key precisely so a row carrying only a
   *  model name still resolves. Casing and spacing must not matter either —
   *  an operator typing into the panel should not be defeated by a capital. */
  it('matches regardless of case or surrounding space', () => {
    expect(auditRowMissing(row({ model: '  iphone 13  ' }), KNOWN)).toEqual([]);
  });
});

describe('a row whose supplier is not on file', () => {
  it('is rejected', () => {
    expect(auditRowMissing(row({ supplierName: 'Totally Made Up Ltd' }), KNOWN))
      .toContain('supplier not on file');
  });

  it('is accepted when it is one of ours, whatever the casing', () => {
    expect(auditRowMissing(row({ supplierName: 'imax' }), KNOWN)).toEqual([]);
    expect(auditRowMissing(row({ supplierName: 'Mobile Wholesale Ltd' }), KNOWN)).toEqual([]);
  });

  /** A one-character supplier was already rejected as incomplete. It should
   *  report that, not the not-on-file message, or the operator is told to pick
   *  an existing supplier when what they actually did was stop typing. */
  it('still reports a half-typed name as missing, not as unknown', () => {
    const missing = auditRowMissing(row({ supplierName: 'M' }), KNOWN);
    expect(missing).toContain('supplier');
    expect(missing).not.toContain('supplier not on file');
  });
});

describe('a matched unit\'s own names are not free text', () => {
  // THE FAILURE THIS PINS
  //
  // On the operator\'s first live upload, 131 of 132 rows blocked. Most were
  // units ALREADY IN STOCK whose model came straight back out of the database
  // — legacy spellings like "IPAD 11TG GEN" that predate the catalog. The gate
  // treated them like a name typed into a spreadsheet and held every one, and
  // the only way through would have been to add every legacy spelling to the
  // catalog: the exact duplication the gate exists to prevent.
  //
  // The distinction is what the value can DO. A name on a matched unit cannot
  // create anything — the unit is already there. A name on an orphan creates
  // both a unit and, if it were allowed, a catalog entry.

  it('does not hold a matched unit whose stored model predates the catalog', () => {
    const r = row({
      imei: '350111000000099',
      model: 'IPAD 11TG GEN',            // what the unit carries
      unitModel: 'IPAD 11TG GEN',        // ...read back out of the database
    });
    expect(auditRowMissing(r, SUGGESTABLE)).toEqual([]);
  });

  it('does not hold a matched unit whose stored supplier is not on the list', () => {
    const r = row({
      supplierName: 'LEGACY SUPPLIER LTD',
      unitSupplierName: 'LEGACY SUPPLIER LTD',
    });
    expect(auditRowMissing(r, SUGGESTABLE)).toEqual([]);
  });

  it('holds it again the moment the operator types something else', () => {
    // The exemption is for the value the database already holds, not for the
    // row. Edit the field and it is free text again.
    const r = row({ model: 'Nokia Fictional 9000', unitModel: 'IPAD 11TG GEN' });
    expect(auditRowMissing(r, SUGGESTABLE)).toContain('model not in catalog');

    const s = row({ supplierName: 'Totally Made Up Ltd', unitSupplierName: 'IMAX' });
    expect(auditRowMissing(s, SUGGESTABLE)).toContain('supplier not on file');
  });

  it('still holds an ORPHAN — it has no unit, so nothing exempts it', () => {
    const r = row({ model: 'IPAD 11TG GEN' });   // no unitModel
    expect(auditRowMissing(r, SUGGESTABLE)).toContain('model not in catalog');
  });

  it('offers no correction for a stored model, but still one for a typed supplier', () => {
    // Per FIELD, not per row: the legacy model is fine and needs no rename,
    // while the supplier really was mistyped over the top.
    const s = suggestRowFixes(
      { model: 'IPAD 11TG GEN', unitModel: 'IPAD 11TG GEN', supplierName: 'IMAZ' },
      SUGGESTABLE);
    expect(s.model).toBeNull();
    expect(s.supplier?.match).toBe('IMAX');
  });
});

describe('the escape hatches — a gate with no way through is worse than none', () => {
  it('does not reject models when no catalog was supplied', () => {
    expect(auditRowMissing(row({ model: 'Nokia Fictional 9000' }), {})).toEqual([]);
  });

  it('does not reject models when the catalog is empty (a wiped database)', () => {
    const empty = buildCatalogIndex([]);
    expect(auditRowMissing(row({ model: 'Nokia Fictional 9000' }), { catalogIndex: empty }))
      .toEqual([]);
  });

  it('does not reject suppliers when none are on file yet', () => {
    expect(auditRowMissing(row({ supplierName: 'Brand New Supplier' }),
      { catalogIndex: CATALOG })).toEqual([]);
  });

  /** The whole gate degrades to its old behaviour for a caller that holds no
   *  reference data, so nothing that used to import stops importing purely
   *  because it went through a different code path. */
  it('falls back to the presence-only checks with no references at all', () => {
    expect(auditRowMissing(row(), {})).toEqual([]);
    expect(auditRowMissing(row({ model: '' }), {})).toContain('model');
    expect(auditRowMissing(row({ buyPrice: 0 }), {})).toContain('buy price');
  });
});

describe('the existing checks still apply alongside the new ones', () => {
  it('reports a bad IMEI and an unknown model together, not one at a time', () => {
    const missing = auditRowMissing(
      row({ imei: 'GENERIC', model: 'Nokia Fictional 9000' }), KNOWN);
    expect(missing).toContain('IMEI (invalid format)');
    expect(missing).toContain('model not in catalog');
  });

  it('says nothing about an unknown model when the model is simply blank', () => {
    const missing = auditRowMissing(row({ model: '' }), KNOWN);
    expect(missing).toContain('model');
    expect(missing).not.toContain('model not in catalog');
  });
});

// ── The way out of a held row ────────────────────────────────────────────────

/**
 * A rejection with no way forward invites the worst available fix: adding
 * "iPhoen 13" to the catalog so the row goes through — which recreates exactly
 * the split-ledger mess the gate exists to prevent. So a held name is matched
 * against the ones on file and the close call is offered back.
 *
 * The names are supplied SEPARATELY from the gate's own reference data, in
 * their real spelling: catalogIndex is normalised and cannot say what to type,
 * and supplierNames is lower-cased. A suggestion has to be the actual name.
 */
const SUGGESTABLE = {
  ...KNOWN,
  catalogModelNames: ['iPhone 13', 'Galaxy A32'],
  supplierDisplayNames: ['IMAX', 'Mobile Wholesale Ltd'],
};

describe('a held row is told what it probably meant', () => {
  it('recommends the catalog model a typo resembles', () => {
    const s = suggestRowFixes(row({ model: 'iPhoen 13' }), SUGGESTABLE);
    expect(s.model).toMatchObject({ match: 'iPhone 13', kind: 'typo' });
  });

  /** The case that made modelRaw necessary. parseBrandModelStorage runs over
   *  the seed before the row is built; on a name it recognises that is right
   *  ("Samsung Galaxy A32" → brand Samsung + model "Galaxy A32"), and on a
   *  MISSPELT one it is destructive: "iPhoen 13" matches no brand rule, so the
   *  generic fallback takes the first token as a brand label and the row's
   *  model arrives as "13". A near-miss run on "13" has nothing to work with,
   *  and the operator gets a held row with no way forward — on exactly the
   *  input this feature exists for. */
  it('recommends from the name the FILE gave, not the brand-split remains', () => {
    const s = suggestRowFixes(
      { model: '13', modelRaw: 'iPhoen 13', supplierName: 'IMAX' }, SUGGESTABLE);
    expect(s.model?.match).toBe('iPhone 13');
  });

  it('recommends the supplier on file a typo resembles', () => {
    const s = suggestRowFixes(row({ supplierName: 'IMAZ' }), SUGGESTABLE);
    expect(s.supplier).toMatchObject({ match: 'IMAX' });
  });

  it('recommends both at once when both are wrong', () => {
    const s = suggestRowFixes(
      row({ model: 'iPhoen 13', supplierName: 'IMAZ' }), SUGGESTABLE);
    expect(s.model?.match).toBe('iPhone 13');
    expect(s.supplier?.match).toBe('IMAX');
  });

  it('recommends the catalog spelling when only the spacing differs', () => {
    const s = suggestRowFixes(row({ model: 'iPhone13' }), SUGGESTABLE);
    expect(s.model).toMatchObject({ match: 'iPhone 13', kind: 'punctuation' });
  });

  /** Taking the suggestion has to actually clear the block, or the operator is
   *  being sent in a circle. Asserted through the real gate, not by eye. */
  it('taking the recommendation clears the rejection', () => {
    const held = row({ model: 'iPhoen 13', supplierName: 'IMAZ' });
    expect(auditRowMissing(held, SUGGESTABLE).length).toBeGreaterThan(0);

    const s = suggestRowFixes(held, SUGGESTABLE);
    const fixed = { ...held, model: s.model!.match, supplierName: s.supplier!.match };
    expect(auditRowMissing(fixed, SUGGESTABLE)).toEqual([]);
  });
});

describe('the recommendation stays quiet when it would be noise', () => {
  it('says nothing about a row the gate is happy with', () => {
    const s = suggestRowFixes(row(), SUGGESTABLE);
    expect(s.model).toBeNull();
    expect(s.supplier).toBeNull();
  });

  it('says nothing about a name that resembles nothing', () => {
    const s = suggestRowFixes(
      row({ model: 'Nokia Fictional 9000', supplierName: 'Totally Made Up Ltd' }),
      SUGGESTABLE);
    expect(s.model).toBeNull();
    expect(s.supplier).toBeNull();
  });

  /** The model catalog is full of names one character apart ON PURPOSE. If the
   *  suggestion pointed at the adjacent generation it would be wrong on
   *  correct-looking data, and an operator who takes it would file the sale of
   *  an S24 against the S23. */
  it('never points a model at an adjacent generation', () => {
    const catalog = {
      catalogIndex: buildCatalogIndex([{ brand: 'Samsung', model: 'Galaxy S23 Ultra' }] as any),
      supplierNames: SUPPLIERS,
      catalogModelNames: ['Galaxy S23 Ultra'],
      supplierDisplayNames: ['IMAX'],
    };
    expect(suggestRowFixes(row({ model: 'Galaxy S24 Ultra' }), catalog).model).toBeNull();
  });

  it('says nothing when the caller supplied no names to suggest from', () => {
    // KNOWN has the gate's reference data but no display names — the gate
    // still rejects, there is simply nothing to recommend.
    expect(auditRowMissing(row({ model: 'iPhoen 13' }), KNOWN))
      .toContain('model not in catalog');
    expect(suggestRowFixes(row({ model: 'iPhoen 13' }), KNOWN).model).toBeNull();
  });
});


// ── The same bug, at the level it actually lived ────────────────────────────

/**
 * THE SECOND HALF, AND WHY IT NEEDS buildPreview AND NOT auditRowMissing.
 *
 * The first fix passed the unit's RAW stored model as `unitModel`. That still
 * held rows on the next live upload, because buildPreview does not hand
 * auditRowMissing the raw string — it hands it the model AFTER
 * parseBrandModelStorage and canonicaliseModel. A great deal of legacy stock
 * carries its storage inside the model ("SAMSUNG GALAXY A32 64GB"); step 1
 * lifts it into its own field, the row becomes "GALAXY A32", and comparing
 * that against the raw string reads as an operator edit when nothing was
 * edited.
 *
 * A test written against auditRowMissing cannot see any of that — it would
 * pass whichever value buildPreview chose, which is exactly how the first fix
 * shipped half-done. So this drives buildPreview and asserts on the row it
 * produces.
 */
const unit = (imei: string, model: string) => ({
  id: `u-${imei}`, imei, model, storage: '', colour: 'Black',
  status: 'available', buyPrice: 200, dateIn: '2026-07-01',
  supplierName: 'IMAX', flags: [], platformListed: false,
  ownerId: 'shared', createdAt: '2026-07-01',
}) as any;

const sale = (imei: string) => ({
  id: `AMAZON__A1__${imei}`, marketplace: 'AMAZON', orderNumber: 'A1',
  imei, sku: '', supplierName: 'IMAX', saleDate: '2026-08-18',
  buyPrice: 200, salePrice: 300, quantity: 1,
}) as any;

/** Real shapes, taken off the operator's live upload. */
const LEGACY_STOCK = [
  'SAMSUNG GALAXY A32 64GB',
  'GALAXY A32 5G 64GB',
  'SAMSUNG GALAXY TAB A11 32GB',
  'GALAXY TAB A11',
  'IPAD 11TG GEN',
  'GALAXY XCOVER5',
  'SG-A32-5G-64GB-DS-BK-EX',
];

describe('buildPreview does not hold stock it already owns', () => {
  // A catalogue that covers NONE of the legacy spellings — the operator's
  // real situation. It must be non-empty, or the no-catalogue escape hatch
  // would carry the test rather than the fix.
  const catalogue = [{ brand: 'Apple', model: 'iPhone 13' }] as any;

  for (const stored of LEGACY_STOCK) {
    it(`"${stored}" reconciles instead of blocking`, () => {
      const imei = '350111000000077';
      const p = buildPreview(
        { sales: [sale(imei)], perSheetCounts: {} as any, errors: [] },
        [], [unit(imei, stored)], catalogue,
      );
      const held = p.recordsToComplete
        .flatMap(r => auditRowMissing(r, {
          catalogIndex: buildCatalogIndex(catalogue),
          supplierNames: new Set(['imax']),
        }));
      expect(held).toEqual([]);
    });
  }

  it('still holds an orphan carrying one of those same names', () => {
    // Nothing about the NAME is being excused — only the fact that a unit
    // already exists under it. With no unit, the identical string blocks.
    const p = buildPreview(
      { sales: [sale('350111000000078')], perSheetCounts: {} as any, errors: [] },
      [], [unit('350111000000079', 'iPhone 13')], catalogue,
    );
    const row = p.recordsToComplete.find(r => r.imei === '350111000000078');
    expect(row).toBeTruthy();
    // The orphan has no model at all here (no SKU to derive one from), which
    // is its own blocker — the point is that it is NOT waved through.
    expect(auditRowMissing(row!, {
      catalogIndex: buildCatalogIndex(catalogue),
      supplierNames: new Set(['imax']),
    }).length).toBeGreaterThan(0);
  });
});


// ── "An existing model in inventory", which is the rule as stated ───────────

/**
 * THE CONTRADICTION THIS REMOVES
 *
 * The operator's rule is "we won't take any unit that doesn't have an existing
 * model in inventory or an existing supplier". Gating on the admin CATALOG
 * alone is a narrower rule, and it produced a dead end they hit at once: each
 * row's model picker searches the models on units in stock, so it offered a
 * model, they selected it, and the gate went on rejecting the row.
 *
 * Accepting inventory does not reopen the hole. The hole was a name typed into
 * a spreadsheet minting a model nobody stocks. A name that matches stock on
 * hand is, by definition, one the business stocks.
 */
describe('a model already in inventory is accepted, not just a catalogued one', () => {
  const catalogue = [{ brand: 'Apple', model: 'iPhone 13' }] as any;
  const stock = [unit('350111000000201', 'SAMSUNG GALAXY A32 64GB')];
  const known = () => {
    const inv = inventoryModelIndex(stock);
    return {
      catalogIndex: buildCatalogIndex(catalogue),
      inventoryModelKeys: inv.keys,
      inventoryModelNames: inv.names,
      catalogModelNames: catalogue.map((c: any) => c.model),
      supplierNames: new Set(['imax']),
      supplierDisplayNames: ['IMAX'],
    };
  };

  it('accepts the parsed spelling the picker would hand back', () => {
    // What the picker offers for that unit is "GALAXY A32" — storage lifted
    // into its own field. Before, the gate compared that against a catalog
    // that has no A32 at all and rejected it.
    expect(auditRowMissing(row({ model: 'GALAXY A32' }), known())).toEqual([]);
  });

  it('accepts the raw stored spelling too', () => {
    expect(auditRowMissing(row({ model: 'SAMSUNG GALAXY A32 64GB' }), known())).toEqual([]);
  });

  it('still rejects a model that is in neither', () => {
    expect(auditRowMissing(row({ model: 'Nokia Fictional 9000' }), known()))
      .toContain('model not in catalog');
  });

  it('still rejects a typo of one that IS in inventory', () => {
    // The whole point: close-but-wrong must not slip through just because the
    // real thing is in stock.
    expect(auditRowMissing(row({ model: 'GALXY A32' }), known()))
      .toContain('model not in catalog');
  });

  it('suggests the inventory spelling for that typo, so the row can proceed', () => {
    const s = suggestRowFixes({ model: 'GALXY A32', supplierName: 'IMAX' }, known());
    expect(s.model?.match).toBe('GALAXY A32');
    // And taking it clears the block — a suggestion the gate then refuses
    // would be the same dead end in a friendlier font.
    expect(auditRowMissing(row({ model: s.model!.match }), known())).toEqual([]);
  });

  it('collapses the many spellings of one phone to a single suggestion', () => {
    const messy = [
      unit('1', 'SAMSUNG GALAXY A32 64GB'),
      unit('2', 'GALAXY A32 5G 64GB'),
      unit('3', 'Galaxy A32'),
      unit('4', 'GALAXY A32 128GB'),
    ];
    const { names } = inventoryModelIndex(messy);
    expect(names).toEqual(['GALAXY A32']);
  });
});
