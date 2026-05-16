/**
 * modelStorage.ts — shared helper for extracting storage capacity from
 * MODEL strings.
 *
 * Why: the client's master Excel files embed storage capacity inside the
 * MODEL column (e.g. "IPAD 7TH GEN 32GB W/C" or "iPad 7 32GB Wifi 2019
 * 10.2 - WIFI + 4G"). `InventoryUnit.storage` is a first-class field on
 * the type but the parsers were never populating it. This helper does
 * the extraction in one place so all parsers (TS, CJS, Python) agree.
 *
 * Contract (see InventoryUnit / InventoryAggregate.storage):
 *   "IPAD 7TH GEN 32GB W/C"                        → { model: "IPAD 7TH GEN W/C",                        storage: "32GB" }
 *   "iPad 7 32GB Wifi 2019 10.2 - WIFI + 4G"       → { model: "iPad 7 Wifi 2019 10.2 - WIFI + 4G",       storage: "32GB" }
 *   "iPhone 13 Pro Max"                            → { model: "iPhone 13 Pro Max",                       storage: undefined }
 *   "Galaxy S22 Ultra 1TB"                         → { model: "Galaxy S22 Ultra",                        storage: "1TB" }
 *   "iPhone 11 128 gb Black"                       → { model: "iPhone 11 Black",                         storage: "128GB" }
 */

/** Single source of truth for the storage-matching pattern. */
export const STORAGE_REGEX = /\b(\d+\s?(?:GB|TB))\b/i;

export interface ExtractStorageResult {
  model: string;
  storage?: string;
}

/**
 * Extract a storage capacity (32GB, 1TB, etc.) from `raw`, return the
 * cleaned model (with the storage substring removed) and the normalised
 * storage string ("32GB" — uppercase, no internal whitespace).
 *
 * First match wins. If no storage is found, `model` is returned trimmed
 * (with internal whitespace collapsed) and `storage` is `undefined`.
 */
export function extractStorage(raw: string | undefined | null): ExtractStorageResult {
  const input = (raw ?? '').toString();
  if (!input.trim()) return { model: input.trim(), storage: undefined };

  const match = input.match(STORAGE_REGEX);
  if (!match) {
    return { model: collapseWhitespace(input), storage: undefined };
  }

  // Normalise: uppercase + drop the optional space between digits and unit.
  const storage = match[1].replace(/\s+/g, '').toUpperCase();

  // Strip the matched substring from the model. Splice instead of replace()
  // so we only touch the FIRST occurrence (matches the regex's "first
  // match wins" contract) and so we can also clean up the joining
  // whitespace / stray commas around the cut.
  const start = match.index ?? 0;
  const end = start + match[0].length;
  const before = input.slice(0, start);
  const after = input.slice(end);
  const stitched = (before + ' ' + after)
    // Remove stray commas/whitespace left adjacent to the cut.
    .replace(/\s+,/g, ',')
    .replace(/,\s*,/g, ',')
    .replace(/^\s*,\s*|\s*,\s*$/g, '');

  return { model: collapseWhitespace(stitched), storage };
}

/** Trim and collapse internal runs of whitespace down to one space. */
function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// parseBrandModelStorage — the canonical brand/model/storage splitter
// ---------------------------------------------------------------------------
//
// Why: legacy unit docs in Firestore still carry `model: "SAMSUNG S21 128GB"`
// (one string) but the UI now wants brand/model/storage/series split out for
// the periodic-table grouping + the per-card display. Rather than re-import
// everything, both the import-time parsers AND the runtime UI call this
// helper. New imports get `{brand, model, storage}` written to the doc;
// existing docs are normalised on-the-fly at read time.
//
// Detection rules (case-insensitive substring match, evaluated in this order
// so an ambiguous string like "Apple Galaxy Tab" still resolves to Apple):
//   apple / iphone / ipad / macbook / apple watch  → 'Apple'
//   samsung / galaxy                                → 'Samsung'
//   google / pixel                                  → 'Google'
//   xiaomi / redmi / poco                           → 'Xiaomi'
//   oneplus                                         → 'OnePlus'
//   anything else                                   → 'Other'
//
// After brand detection the FIRST token is stripped from the model only if it
// is the literal brand name itself (so "Apple iPhone 17" loses the leading
// "Apple", but "iPhone 17" keeps "iPhone"). Then storage is extracted via the
// existing `extractStorage` helper and whitespace collapsed.

export type Brand = 'Apple' | 'Samsung' | 'Google' | 'Xiaomi' | 'OnePlus' | 'Other';
export type Series =
  | 'iPhone' | 'iPad' | 'Apple Watch' | 'MacBook'
  | 'Galaxy S' | 'Galaxy A' | 'Galaxy Note' | 'Galaxy Z' | 'Galaxy M' | 'Galaxy XCover' | 'Galaxy Tab'
  | 'Pixel' | 'Other';

export interface ParsedModel {
  brand: Brand;
  /** Brand-prefix stripped, storage stripped, whitespace-collapsed. */
  model: string;
  /** Normalised storage capacity ("32GB" / "1TB"); `undefined` if none found. */
  storage?: string;
  /** Short bucket used for periodic-table grouping; `undefined` for empty input. */
  series?: Series;
}

/** Brand keyword → canonical Brand. Order matters (first match wins) so the
 *  Apple-flavoured Galaxy-Tab-style edge cases above resolve correctly. */
const BRAND_RULES: ReadonlyArray<{ brand: Brand; keywords: string[] }> = [
  { brand: 'Apple',   keywords: ['apple', 'iphone', 'ipad', 'macbook', 'apple watch'] },
  { brand: 'Samsung', keywords: ['samsung', 'galaxy'] },
  { brand: 'Google',  keywords: ['google', 'pixel'] },
  { brand: 'Xiaomi',  keywords: ['xiaomi', 'redmi', 'poco'] },
  { brand: 'OnePlus', keywords: ['oneplus'] },
];

/** Words that, when they appear as the very first token, should be dropped
 *  from the cleaned model string (so "Apple iPhone 17" → "iPhone 17"). */
const LEADING_BRAND_TOKENS = new Set(['apple', 'samsung', 'google', 'xiaomi', 'oneplus']);

function detectBrand(lower: string): Brand {
  for (const rule of BRAND_RULES) {
    if (rule.keywords.some(k => lower.includes(k))) return rule.brand;
  }
  return 'Other';
}

function detectSeries(brand: Brand, lower: string): Series | undefined {
  if (!lower) return undefined;
  if (brand === 'Apple') {
    if (lower.includes('iphone')) return 'iPhone';
    if (lower.includes('ipad')) return 'iPad';
    if (lower.includes('apple watch') || lower.includes('watch ultra') || lower.includes('watch se')) return 'Apple Watch';
    if (lower.includes('macbook')) return 'MacBook';
    return 'Other';
  }
  if (brand === 'Samsung') {
    if (lower.includes('galaxy tab') || /\btab [as]\d/.test(lower)) return 'Galaxy Tab';
    if (lower.includes('galaxy note') || /\bnote\s?\d/.test(lower)) return 'Galaxy Note';
    // Galaxy S / A: match the explicit "Galaxy S20" form AND the bare "S21"
    // form that appears in legacy strings like "SAMSUNG S21 128GB". The
    // trailing-letter clause (`s\d{1,2}(fe|ultra|plus)?`) catches "S20FE",
    // "S22Ultra", etc. where no space separates the suffix. Word-boundary on
    // the left so we don't catch "GalaxyS"/"Asia".
    if (/\bgalaxy s\d/.test(lower) || /\bs\d{1,2}(fe|ultra|plus|\+)?\b/.test(lower)) return 'Galaxy S';
    if (/\bgalaxy a\d/.test(lower) || /\ba\d{1,3}s?\b/.test(lower)) return 'Galaxy A';
    return 'Other';
  }
  if (brand === 'Google') {
    if (lower.includes('pixel')) return 'Pixel';
    return 'Other';
  }
  return 'Other';
}

/**
 * Parse a raw "brand model storage" string into structured fields.
 *
 * The single source of truth for brand/model/storage splitting. Used by:
 *   - the import parsers (ImportModal, smokeMasterFiles, import_excel.cjs,
 *     convert_excel.py) so new units get split fields saved on the doc
 *   - the runtime UI list/grid renderers so legacy single-string docs render
 *     correctly without a re-import.
 *
 * Examples:
 *   "Apple iPhone 17 Pro Max 128GB"  → { brand:'Apple',   model:'iPhone 17 Pro Max', storage:'128GB', series:'iPhone'   }
 *   "SAMSUNG S21 128GB"              → { brand:'Samsung', model:'S21',               storage:'128GB', series:'Galaxy S' }
 *   "IPAD 7TH GEN 32GB W/C"          → { brand:'Apple',   model:'IPAD 7TH GEN W/C',  storage:'32GB',  series:'iPad'     }
 *   "Galaxy A32 5G 64GB"             → { brand:'Samsung', model:'Galaxy A32 5G',     storage:'64GB',  series:'Galaxy A' }
 *   "Pixel 8 Pro 256GB"              → { brand:'Google',  model:'Pixel 8 Pro',       storage:'256GB', series:'Pixel'    }
 *   "iPhone 11"                      → { brand:'Apple',   model:'iPhone 11',         storage:undefined, series:'iPhone' }
 *   ""                               → { brand:'Other',   model:'',                  storage:undefined, series:undefined }
 *
 * Galaxy Tab note: the storage regex returns the FIRST GB token (per existing
 * `extractStorage` contract). For tablet strings carrying both a RAM and a
 * storage capacity (e.g. "Galaxy Tab A9+ 6GB 128GB - WiFi") this means the
 * smaller RAM number wins. Acceptable per spec; documented here so callers
 * aren't surprised.
 */
export function parseBrandModelStorage(raw: string | undefined | null): ParsedModel {
  const input = (raw ?? '').toString();
  const trimmed = input.trim();

  // Empty input short-circuits — preserve current `extractStorage` contract.
  if (!trimmed) {
    return { brand: 'Other', model: '', storage: undefined, series: undefined };
  }

  const lower = trimmed.toLowerCase();
  const brand = detectBrand(lower);

  // Strip a leading brand-name word ("Apple", "Samsung", …) — but ONLY the
  // brand label, not series words like "iPhone" or "Galaxy". Use word
  // boundaries so we don't eat the leading letters of a real model.
  let working = trimmed;
  const firstToken = working.split(/\s+/, 1)[0];
  if (firstToken && LEADING_BRAND_TOKENS.has(firstToken.toLowerCase())) {
    working = working.slice(firstToken.length).trimStart();
  }

  // Pull storage out and clean whitespace.
  const { model: modelWithoutStorage, storage } = extractStorage(working);
  const model = collapseWhitespace(modelWithoutStorage);

  // Series uses the ORIGINAL lower-cased string (so we still see "iPhone"
  // even if the leading brand word was stripped — both work because the
  // brand-strip only removes the brand label, but using the original keeps
  // the rule symmetric and obvious).
  const series = detectSeries(brand, lower);

  return { brand, model, storage, series };
}

// ---------------------------------------------------------------------------
// Inline vitest smoke test (skipped when import.meta.vitest is unavailable).
// `vite.config.ts` does not currently enable `test.includeSource`, so this
// block is dead-stripped from the prod bundle and only runs when a future
// vitest config opts in. The same cases are exercised standalone via
// `npx tsx -e` in the PR check.
// ---------------------------------------------------------------------------

// @ts-expect-error import.meta.vitest is provided only when test.includeSource is enabled
if (import.meta.vitest) {
  // @ts-expect-error vitest globals are injected when running under vitest
  const { describe, it, expect } = import.meta.vitest;

  describe('extractStorage', () => {
    it('extracts uppercase GB from a tail-positioned storage', () => {
      expect(extractStorage('IPAD 7TH GEN 32GB W/C')).toEqual({
        model: 'IPAD 7TH GEN W/C',
        storage: '32GB',
      });
    });
    it('extracts mid-string storage and collapses whitespace', () => {
      expect(extractStorage('iPad 7 32GB Wifi 2019 10.2 - WIFI + 4G')).toEqual({
        model: 'iPad 7 Wifi 2019 10.2 - WIFI + 4G',
        storage: '32GB',
      });
    });
    it('returns undefined storage when no capacity is present', () => {
      expect(extractStorage('iPhone 13 Pro Max')).toEqual({
        model: 'iPhone 13 Pro Max',
        storage: undefined,
      });
    });
    it('handles TB suffixes', () => {
      expect(extractStorage('Galaxy S22 Ultra 1TB')).toEqual({
        model: 'Galaxy S22 Ultra',
        storage: '1TB',
      });
    });
    it('handles lowercase + space variants', () => {
      expect(extractStorage('iPhone 11 128 gb Black')).toEqual({
        model: 'iPhone 11 Black',
        storage: '128GB',
      });
    });
  });

  describe('parseBrandModelStorage', () => {
    it('splits "Apple iPhone 17 Pro Max 128GB"', () => {
      expect(parseBrandModelStorage('Apple iPhone 17 Pro Max 128GB')).toEqual({
        brand: 'Apple', model: 'iPhone 17 Pro Max', storage: '128GB', series: 'iPhone',
      });
    });
    it('recognises all-caps SAMSUNG and bare S21 model', () => {
      expect(parseBrandModelStorage('SAMSUNG S21 128GB')).toEqual({
        brand: 'Samsung', model: 'S21', storage: '128GB', series: 'Galaxy S',
      });
    });
    it('handles IPAD with trailing W/C tag', () => {
      expect(parseBrandModelStorage('IPAD 7TH GEN 32GB W/C')).toEqual({
        brand: 'Apple', model: 'IPAD 7TH GEN W/C', storage: '32GB', series: 'iPad',
      });
    });
    it('handles Galaxy A32 5G + 64GB', () => {
      expect(parseBrandModelStorage('Galaxy A32 5G 64GB')).toEqual({
        brand: 'Samsung', model: 'Galaxy A32 5G', storage: '64GB', series: 'Galaxy A',
      });
    });
    it('handles Pixel 8 Pro', () => {
      expect(parseBrandModelStorage('Pixel 8 Pro 256GB')).toEqual({
        brand: 'Google', model: 'Pixel 8 Pro', storage: '256GB', series: 'Pixel',
      });
    });
    it('handles iPhone 11 with no storage', () => {
      expect(parseBrandModelStorage('iPhone 11')).toEqual({
        brand: 'Apple', model: 'iPhone 11', storage: undefined, series: 'iPhone',
      });
    });
    it('treats empty string as Other with no series', () => {
      expect(parseBrandModelStorage('')).toEqual({
        brand: 'Other', model: '', storage: undefined, series: undefined,
      });
    });
    it('extracts first GB token from "Galaxy Tab A9+ 6GB 128GB"', () => {
      // Documented: first GB token wins (RAM 6GB), per existing extractStorage contract.
      expect(parseBrandModelStorage('Galaxy Tab A9+ 6GB 128GB - WiFi + CELLULAR')).toEqual({
        brand: 'Samsung', model: 'Galaxy Tab A9+ 128GB - WiFi + CELLULAR', storage: '6GB', series: 'Galaxy Tab',
      });
    });
    it('does not re-extract storage if already extracted', () => {
      expect(parseBrandModelStorage('iPhone 17 Pro Max')).toEqual({
        brand: 'Apple', model: 'iPhone 17 Pro Max', storage: undefined, series: 'iPhone',
      });
    });
    it('detects Galaxy S for FE / + / Ultra suffixed bare models', () => {
      expect(parseBrandModelStorage('SAMSUNG S20FE 128GB').series).toBe('Galaxy S');
      expect(parseBrandModelStorage('SAMSUNG S21+ 128GB').series).toBe('Galaxy S');
      expect(parseBrandModelStorage('SAMSUNG S22 Ultra 256GB').series).toBe('Galaxy S');
    });
    it('detects Galaxy A for trailing-S bare models (A21S / A52S)', () => {
      expect(parseBrandModelStorage('SAMSUNG A21S 32GB').series).toBe('Galaxy A');
      expect(parseBrandModelStorage('SAMSUNG A52S 128GB').series).toBe('Galaxy A');
    });
  });
}
