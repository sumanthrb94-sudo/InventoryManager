/**
 * One-shot repair for `models` catalog rows saved with a blank brand and
 * the brand word fused into an ALL-CAPS model string.
 *
 * How the drift happened: the "+ Add to the model catalog" pill in Add
 * Stock and Bulk Order rendered its picker with a hardcoded `brand=""`,
 * and wrote that straight through to the new doc. Every catalog row created
 * that way got `brand: ''`, so operators compensated by typing the brand
 * into the Model box — producing rows like:
 *
 *     { brand: '',  model: 'APPLE IPHONE 12' }
 *     { brand: '',  model: 'SAMSUNG GALAXY A05 4G' }
 *     { brand: '',  model: 'GALAXY A36 256GB' }      ← storage fused in too
 *
 * instead of `{ brand: 'Apple', model: 'iPhone 12', series: 'iPhone' }`.
 * Only rows added through Admin → Configuration (which refuses to save
 * without a brand) came out correct.
 *
 * That matters beyond cosmetics: the catalog is meant to be the authority
 * on how a model name is displayed, so these rows push shouty brand-fused
 * names onto the Dashboard and periodic table. Where the same model landed
 * in the catalog twice ("IPHONE 14" and "APPLE IPHONE 14"), whichever
 * Firestore returned first won, making the displayed name arbitrary.
 *
 * SAFE BY CONSTRUCTION:
 *   - The brand is only ever set to a value in the canonical `Brand` enum
 *     (Apple / Samsung / Google / Xiaomi / OnePlus). The parser's fallback
 *     habit of treating an unknown first word as a brand — which turns
 *     "SIM PINS" into brand "SIM" — is rejected, leaving those rows' brand
 *     blank rather than inventing one.
 *   - An existing non-empty, canonical brand is never overwritten.
 *   - Deleting a duplicate catalog row does not touch inventory: catalog
 *     entries only feed the Add Stock / Bulk Order pickers (same as the
 *     panel's own delete action says).
 *
 * Usage — review before writing, same as the other migration here:
 *   const drift = findModelCatalogDrift(models);
 *   await fixModelCatalog(drift, dbService);
 */
import { parseBrandModelStorage, normalizeBucketModel, type Brand } from '../modelStorage';

/** Brands the parser may legitimately assign. Anything outside this set is
 *  the parser guessing off an unrecognised first word, not a real brand. */
const KNOWN_BRANDS: ReadonlySet<string> = new Set<Brand>([
  'Apple', 'Samsung', 'Google', 'Xiaomi', 'OnePlus',
]);

/** Tokens with a fixed house spelling that Title Case would get wrong. */
const SPECIAL_TOKENS: Readonly<Record<string, string>> = {
  iphone: 'iPhone', ipad: 'iPad', ipod: 'iPod', imac: 'iMac',
  macbook: 'MacBook', airpods: 'AirPods', airpod: 'AirPod',
  iwatch: 'iWatch', watch: 'Watch', galaxy: 'Galaxy', tab: 'Tab',
  xcover: 'XCover', wifi: 'WiFi', gps: 'GPS', lte: 'LTE', nfc: 'NFC',
  gen: 'Gen', generation: 'Generation', cellular: 'Cellular',
  se: 'SE', fe: 'FE', plus: 'Plus', pro: 'Pro', max: 'Max',
  mini: 'Mini', ultra: 'Ultra', lite: 'Lite',
  pixel: 'Pixel', oneplus: 'OnePlus', redmi: 'Redmi', poco: 'POCO',
};

function caseToken(tok: string): string {
  if (!tok) return tok;
  const lower = tok.toLowerCase();
  if (SPECIAL_TOKENS[lower]) return SPECIAL_TOKENS[lower];
  // Ordinals read better lowercase: "11TH" → "11th".
  if (/^\d+(st|nd|rd|th)$/i.test(tok)) return lower;
  // Case sizes stay lowercase: "40MM" → "40mm".
  if (/^\d+mm$/i.test(tok)) return lower;
  // Anything carrying a digit is a model/spec code — keep it shouty:
  // "A05", "S21", "T580", "SE3", "4G", "256GB", "12".
  if (/\d/.test(tok)) return tok.toUpperCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** Re-case a model name that arrived in ALL CAPS, without changing wording.
 *  Splits on "+" as well as whitespace so "GPS+CELLULAR" → "GPS+Cellular". */
export function properCaseModel(model: string): string {
  return (model ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(word => word.split('+').map(caseToken).join('+'))
    .join(' ');
}

export interface CatalogRowInput {
  id: string;
  brand?: string;
  model?: string;
  series?: string;
}

export interface NormalisedCatalogEntry {
  brand: string;
  model: string;
  series?: string;
}

/**
 * Split brand out of the model text, re-case the model, and derive the
 * series — the shape a catalog row should have had all along. Exported on
 * its own so the "+ Add" pill can normalise at write time too, keeping new
 * rows consistent with repaired ones.
 */
export function normaliseCatalogEntry(row: {
  brand?: string; model?: string; series?: string;
}): NormalisedCatalogEntry {
  const rawModel = (row.model ?? '').trim();
  if (!rawModel) {
    return { brand: (row.brand ?? '').trim(), model: '', series: row.series || undefined };
  }

  const parsed = parseBrandModelStorage(rawModel);

  // An existing canonical brand wins; otherwise take the parser's, but only
  // if it's a real brand — never its unknown-first-word guess.
  const existingBrand = (row.brand ?? '').trim();
  const brand = KNOWN_BRANDS.has(existingBrand)
    ? existingBrand
    : (KNOWN_BRANDS.has(String(parsed.brand)) ? String(parsed.brand) : '');

  // parsed.model has the brand prefix and any fused storage stripped
  // ("GALAXY A36 256GB" → "GALAXY A36"). Dropping storage is intended —
  // it belongs on the unit, not the catalog entry.
  //
  // It ALSO splits off a connectivity tag ("...TAB A9 WIFI" → model
  // "GALAXY TAB A9" + tag "WiFi"; "GALAXY S21 5G" → tag "5G"). Unlike
  // storage, that tag is part of the product's identity here — WiFi vs
  // Cellular is a different iPad — so put it back on the name rather than
  // silently shortening what the operator typed.
  const tag = parsed.tag;
  let modelText = parsed.model || rawModel;
  if (tag && !modelText.toLowerCase().includes(tag.toLowerCase())) {
    modelText = `${modelText} ${tag}`;
  }
  const model = properCaseModel(modelText);

  const parsedSeries = parsed.series && parsed.series !== 'Other' ? String(parsed.series) : undefined;
  const series = (row.series ?? '').trim() || parsedSeries;

  return { brand, model, series };
}

export interface ModelCatalogPatch {
  id: string;
  data: NormalisedCatalogEntry;
  before: { brand: string; model: string; series?: string };
}

export interface ModelCatalogDuplicate {
  /** Row kept — the first occurrence of this bucket. */
  keepId: string;
  /** Rows deleted as redundant once normalisation made them identical. */
  dropIds: string[];
  /** "Apple iPhone 14", for the operator-facing summary. */
  label: string;
}

export interface ModelCatalogDrift {
  patches: ModelCatalogPatch[];
  duplicates: ModelCatalogDuplicate[];
  /** Rows left with no brand because none could be determined safely —
   *  typically accessories that were added to the device catalog by
   *  mistake ("generic", "pins", "SIM PINS"). Surfaced so the operator can
   *  deal with them deliberately; this migration never deletes them. */
  unbranded: Array<{ id: string; model: string }>;
}

/**
 * Work out every catalog row that needs repairing. Pure — writes nothing.
 */
export function findModelCatalogDrift(rows: CatalogRowInput[] = []): ModelCatalogDrift {
  const patches: ModelCatalogPatch[] = [];
  const unbranded: ModelCatalogDrift['unbranded'] = [];

  // bucket key → the row we keep, plus everything that collapsed onto it.
  const buckets = new Map<string, { keepId: string; label: string; dropIds: string[] }>();

  for (const row of rows) {
    const before = {
      brand: (row.brand ?? '').trim(),
      model: (row.model ?? '').trim(),
      series: (row.series ?? '').trim() || undefined,
    };
    if (!before.model) continue;

    const next = normaliseCatalogEntry(row);
    if (!next.model) continue;

    if (!next.brand) unbranded.push({ id: row.id, model: next.model });

    if (next.brand !== before.brand || next.model !== before.model || next.series !== before.series) {
      patches.push({ id: row.id, data: next, before });
    }

    // Dedupe on the normalised values, using the same bucket key the rest
    // of the app uses to decide "these are the same model".
    const key = `${next.brand.toLowerCase()}||${normalizeBucketModel(next.model)}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.dropIds.push(row.id);
    else buckets.set(key, {
      keepId: row.id,
      label: [next.brand, next.model].filter(Boolean).join(' '),
      dropIds: [],
    });
  }

  const duplicates = [...buckets.values()]
    .filter(b => b.dropIds.length > 0)
    .map(b => ({ keepId: b.keepId, dropIds: b.dropIds, label: b.label }));

  // A row that's about to be deleted as a duplicate doesn't need patching.
  const dropped = new Set(duplicates.flatMap(d => d.dropIds));
  return {
    patches: patches.filter(p => !dropped.has(p.id)),
    duplicates,
    unbranded: unbranded.filter(u => !dropped.has(u.id)),
  };
}

/**
 * Apply the repair. Takes dbService by parameter so this module stays
 * testable and free of Firebase imports, matching normaliseGradeCasing.
 */
export async function fixModelCatalog(
  drift: Pick<ModelCatalogDrift, 'patches' | 'duplicates'>,
  db: {
    bulkCreate: (entries: Array<{ collection: string; id: string; data: any }>) => Promise<any>;
    delete: (collection: string, id: string) => Promise<any>;
  },
): Promise<{ updated: number; removed: number }> {
  if (drift.patches.length > 0) {
    await db.bulkCreate(drift.patches.map(p => ({
      collection: 'models',
      id: p.id,
      // `series` is optional — only write it when we actually derived one,
      // so we never overwrite a set value with undefined.
      data: p.data.series
        ? { brand: p.data.brand, model: p.data.model, series: p.data.series }
        : { brand: p.data.brand, model: p.data.model },
    })));
  }
  const dropIds = drift.duplicates.flatMap(d => d.dropIds);
  for (const id of dropIds) {
    await db.delete('models', id);
  }
  return { updated: drift.patches.length, removed: dropIds.length };
}
