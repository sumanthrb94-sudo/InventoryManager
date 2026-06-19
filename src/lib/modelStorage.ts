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

// ---------------------------------------------------------------------------
// Samsung bare-model regexes — exported so series detection AND brand
// inference (when the "Samsung" prefix has been stripped at import time and
// the runtime UI re-parses the cleaned model string) share one source of
// truth. Order in detectSeries matters: longer / more specific first.
// ---------------------------------------------------------------------------
/** Galaxy Tab — "Galaxy Tab", or "Tab A9" / "Tab S8" bare form. */
const RE_GALAXY_TAB = /\bgalaxy\s*tab|\btab\s*[as]\d/i;
/** Galaxy Note — "Galaxy Note", or bare "Note 20". */
const RE_GALAXY_NOTE = /\bgalaxy\s*note|\bnote\s?\d/i;
/** Galaxy Z (foldables) — "Galaxy Z", or "Z Fold 5" / "Z Flip 4". */
const RE_GALAXY_Z = /\bgalaxy\s*z|\bz\s*(fold|flip)/i;
/** Galaxy M (budget) — "Galaxy M", or bare "M53". */
const RE_GALAXY_M = /\bgalaxy\s*m\b|\bgalaxy\s*m\d|\bm\d{2}\b/i;
/** Galaxy XCover (rugged) — "X COVER 5" with optional space, or "XCover Pro". */
const RE_GALAXY_XCOVER = /\b(x\s*cover|xcover)\b/i;
/** Galaxy S — "Galaxy S21" (any spacing), bare "S22", "S21FE", "S22 Ultra", "S9+". */
const RE_GALAXY_S = /\bgalaxy\s*s\s*\d+|\bs\d{1,2}(fe|ultra|plus|\+)?\b|\bs\d{1,2}\s*(fe|ultra|plus)\b/i;
/** Galaxy A — "Galaxy A32", bare "A12" / "A32 5G" / "A21S". */
const RE_GALAXY_A = /\bgalaxy\s*a\s*\d+|\ba\d{1,3}s?(\s*5g|\s*4g)?\b/i;
/** Pixel — "Pixel 8 Pro". */
const RE_PIXEL = /\bpixel\s*\d/i;

/** True if the cleaned string looks like a Samsung product (bare or prefixed). */
function looksLikeSamsung(lower: string): boolean {
  return (
    RE_GALAXY_TAB.test(lower) ||
    RE_GALAXY_NOTE.test(lower) ||
    RE_GALAXY_Z.test(lower) ||
    RE_GALAXY_XCOVER.test(lower) ||
    RE_GALAXY_S.test(lower) ||
    RE_GALAXY_A.test(lower) ||
    RE_GALAXY_M.test(lower)
  );
}

export interface ParsedModel {
  /** Brand label. One of the known {@link Brand} enum values when the first
   *  word matches a recognised brand (Apple/Samsung/Google/Xiaomi/OnePlus),
   *  otherwise the literal first word of the input (e.g. "Acme" from "Acme
   *  PhoneX 64GB"). Per ops rule: the FIRST WORD of any model string is
   *  always the brand. */
  brand: Brand | string;
  /** Brand-prefix stripped, storage stripped, TAG stripped, whitespace-collapsed. */
  model: string;
  /** Normalised storage capacity ("32GB" / "1TB"); `undefined` if none found. */
  storage?: string;
  /** Short bucket used for periodic-table grouping; `undefined` for empty input. */
  series?: Series;
  /** Tag metadata pulled off the model string (radio / sim / connectivity).
   *  Multiple tags joined by ", " (e.g. "WiFi+Cellular, 5G"). `undefined`
   *  when none present. Per ops convention "wifi/cellular is a tag for the
   *  model" — these are display-only refinements on top of the canonical
   *  brand+model+storage triple. Round-trip: tags stay glued to the stored
   *  model string; the parser splits them for in-app display/grouping. */
  tag?: string;
}

/** Tag patterns evaluated in order — earlier entries win, so the
 *  combined "WiFi+Cellular" pattern matches before the bare "WiFi" form
 *  and they don't both fire on the same input. Patterns are global so
 *  every occurrence in the input gets stripped on replace. */
const TAG_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  {
    name: 'WiFi+Cellular',
    re: /\bw\s*[\/+]\s*c\b|\bwi-?fi\s*[\/+]\s*cell(?:ular)?\b|\bwifi\s+(?:and|&|\+)\s*cell(?:ular)?\b/gi,
  },
  {
    name: 'WiFi',
    re: /\bwi-?fi(?:\s*[-‐-―]?\s*only)?\b/gi,
  },
  {
    name: '5G',
    re: /\b5g\b/gi,
  },
  {
    name: 'Dual SIM',
    re: /\bdual[\s-]?sim\b/gi,
  },
  {
    name: 'Single SIM',
    re: /\bsingle[\s-]?sim\b/gi,
  },
];

/** Pull tag metadata off a model string. Returns the tag-stripped string
 *  plus the list of normalized tag names found. The strip uses a space
 *  replacement (not empty) so adjacent tokens don't fuse together. */
function extractTags(input: string): { stripped: string; tags: string[] } {
  let working = input;
  const tags: string[] = [];
  for (const { name, re } of TAG_PATTERNS) {
    // Reset lastIndex since we declared the regex /g.
    re.lastIndex = 0;
    if (re.test(working)) {
      tags.push(name);
      re.lastIndex = 0;
      working = working.replace(re, ' ');
    }
  }
  // Tidy up any orphan dash/colon/comma left behind by the strip, plus any
  // dangling separator at either end of the string.
  working = working.replace(/\s+[-:·,]\s+/g, ' ').replace(/^[\s\-:·,]+|[\s\-:·,]+$/g, '');
  return { stripped: collapseWhitespace(working), tags };
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
  // Fall back to Samsung-shape inference for legacy docs whose model string
  // has already had the "Samsung" prefix stripped at import time. Without this
  // the runtime UI re-parses "S21" and gets brand=Other / series=Other,
  // dumping every Galaxy unit into the "Other" section.
  if (looksLikeSamsung(lower)) return 'Samsung';
  if (RE_PIXEL.test(lower)) return 'Google';
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
    // Order matters: longer / more specific patterns first so "Galaxy Tab"
    // wins over the generic "A9" Tab-A bucket, "Z Fold" wins over generic
    // S/A digits, and "X COVER" wins before the bare-A regex could match
    // "cover" via no-op.
    if (RE_GALAXY_TAB.test(lower)) return 'Galaxy Tab';
    if (RE_GALAXY_NOTE.test(lower)) return 'Galaxy Note';
    if (RE_GALAXY_Z.test(lower)) return 'Galaxy Z';
    if (RE_GALAXY_XCOVER.test(lower)) return 'Galaxy XCover';
    if (RE_GALAXY_S.test(lower)) return 'Galaxy S';
    if (RE_GALAXY_A.test(lower)) return 'Galaxy A';
    if (RE_GALAXY_M.test(lower)) return 'Galaxy M';
    return 'Other';
  }
  if (brand === 'Google') {
    if (RE_PIXEL.test(lower) || lower.includes('pixel')) return 'Pixel';
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
/** Operator SKU brand-code → canonical brand + product line. The operator's
 *  SKU convention is "[ASI-]<BRAND>-<MODEL>-<STORAGE>-<COLOUR>-<SUFFIX>".
 *  Only these known codes are normalised; anything else is left untouched. */
const SKU_BRAND_CODE: Record<string, { brand: string; line: string }> = {
  SG:  { brand: 'Samsung', line: 'Galaxy' },
  SS:  { brand: 'Samsung', line: 'Galaxy' },
  IP:  { brand: 'Apple',   line: 'iPhone' },
  IPH: { brand: 'Apple',   line: 'iPhone' },
  IPD: { brand: 'Apple',   line: 'iPad' },
  GP:  { brand: 'Google',  line: 'Pixel' },
  OP:  { brand: 'OnePlus', line: '' },
  XI:  { brand: 'Xiaomi',  line: '' },
};

/**
 * Convert an operator SKU code into a clean "<Brand> <Line> <Model> [5G]
 * <Storage>" string, or return null when the input isn't a recognised SKU.
 *
 * Tightly guarded so it never mangles a real model name:
 *   - rejects anything containing whitespace (real names have spaces;
 *     SKU codes don't),
 *   - rejects anything without a dash,
 *   - rejects unless the first segment (after an optional "ASI-" vendor
 *     prefix) is a known brand code.
 *
 * Examples:
 *   ASI-SG-S20-128-CN-EX        → "Samsung Galaxy S20 128GB"
 *   ASI-SG-A32-5G-64-BK-EX      → "Samsung Galaxy A32 5G 64GB"
 *   SG-A14-128-VT               → "Samsung Galaxy A14 128GB"
 *   SG-S21FE-128-GR-EX          → "Samsung Galaxy S21 FE 128GB"
 *   ASI-SG-TABA8-32GB-BK-EX     → "Samsung Galaxy Tab A8 32GB"
 *   ASI-IP-SE3-128-MN-GD        → "Apple iPhone SE3 128GB"
 */
export function normalizeOperatorSku(raw: string | undefined | null): string | null {
  const s0 = (raw ?? '').trim();
  if (!s0 || /\s/.test(s0)) return null;          // real names carry spaces
  const U = s0.toUpperCase();
  if (!U.includes('-')) return null;              // SKUs are dash-delimited
  const body = U.replace(/^ASI-/, '');            // drop vendor prefix
  const segs = body.split('-').filter(Boolean);
  if (segs.length < 2) return null;
  const code = SKU_BRAND_CODE[segs[0]];
  if (!code) return null;                         // unknown brand code → leave as-is

  let line = code.line;
  let modelTok = segs[1];

  // Samsung tablet codes: TABA8 → Tab A8, TABS9 → Tab S9.
  const tabM = modelTok.match(/^TAB([A-Z]?\d+\+?)$/);
  if (tabM && code.brand === 'Samsung') {
    line = 'Galaxy Tab';
    modelTok = tabM[1];
  }

  // Split a fused suffix off the model token: S21FE → "S21 FE".
  modelTok = modelTok.replace(/^([A-Z]?\d+)(FE|PLUS|ULTRA|PRO)$/, '$1 $2');

  // Storage + 5G scan across the segments AFTER the model token (start at
  // index 2). Starting at the model token would let a numeric model like
  // iPhone "13" be misread as "13GB" of storage.
  let storage: string | undefined;
  let has5g = false;
  for (let i = 2; i < segs.length; i++) {
    if (segs[i] === '5G') { has5g = true; continue; }
    if (storage === undefined) {
      const sm = segs[i].match(/^(\d{2,4})(GB|TB)?$/);
      if (sm) storage = sm[1] + (sm[2] || 'GB');
    }
  }

  return [code.brand, line, modelTok, has5g ? '5G' : '', storage]
    .filter(Boolean)
    .join(' ');
}

export function parseBrandModelStorage(raw: string | undefined | null): ParsedModel {
  const input = (raw ?? '').toString();
  const rawTrimmed = input.trim();

  // Empty input short-circuits — preserve current `extractStorage` contract.
  if (!rawTrimmed) {
    return { brand: 'Other', model: '', storage: undefined, series: undefined };
  }

  // Operator SKU codes (e.g. "ASI-SG-S20-128-CN-EX", "SG-A14-128-VT") arrive
  // as the model on units auto-created from sales whose IMEI had no inventory
  // match. Left raw, they render as truncated SKU symbols ("ASI-SG-S") on the
  // periodic table and bucket separately from clean "Galaxy S20" units.
  // Normalise them up-front into a clean "<Brand> <Line> <Model> [5G]
  // <Storage>" string so every downstream surface (periodic table, reports,
  // sell sheet) shows a real model name and buckets consistently. Only fires
  // on the unmistakable code shape (no spaces, known brand-code prefix); real
  // model names like "Samsung Galaxy S20 128GB" carry spaces and pass through.
  const trimmed = normalizeOperatorSku(rawTrimmed) ?? rawTrimmed;

  const lower = trimmed.toLowerCase();
  const detected = detectBrand(lower);

  // Per ops rule: the FIRST WORD of the input is the brand.
  //   - For the 5 known brands (Apple/Samsung/Google/Xiaomi/OnePlus) the
  //     first word matches LEADING_BRAND_TOKENS exactly → strip + use the
  //     canonical Brand enum value.
  //   - For unknown brands but with 2+ words AND the first word looking
  //     like a brand label (alphabetic, 2+ chars, not starting with a
  //     digit, not a known device-series prefix like "iPhone"/"Galaxy"
  //     where the user dropped the brand prefix), strip it and use it
  //     literally as the brand.
  //   - Otherwise keep the detected brand (often 'Other') and don't strip.
  const words = trimmed.split(/\s+/);
  const firstToken = words[0] || '';
  const firstLower = firstToken.toLowerCase();
  const isKnownLeading = LEADING_BRAND_TOKENS.has(firstLower);
  const looksLikeSeriesPrefix = /^(iphone|ipad|galaxy|pixel|macbook)$/i.test(firstToken);
  const looksLikeBrandLabel =
    words.length >= 2 &&
    /^[A-Za-z][A-Za-z'&-]+$/.test(firstToken) &&
    !looksLikeSeriesPrefix;

  let brand: Brand | string = detected;
  let working = trimmed;
  if (isKnownLeading) {
    // Known-brand prefix — strip + use canonical Brand enum value.
    working = working.slice(firstToken.length).trimStart();
  } else if (detected === 'Other' && looksLikeBrandLabel) {
    // Unknown brand label — use the first word verbatim (capitalised).
    brand = firstToken.charAt(0).toUpperCase() + firstToken.slice(1);
    working = working.slice(firstToken.length).trimStart();
  }

  // Pull KNOWN tags out first (5G, Dual SIM, Wi-Fi+Cellular, etc.) — these
  // can appear anywhere in the string, even mid-model. The closed set
  // covers the common radio / sim / connectivity metadata so it gets
  // normalised consistently.
  const { stripped: workingNoKnownTags, tags } = extractTags(working);

  // Split storage out manually so we can also capture whatever the operator
  // typed AFTER the storage as a freeform tag. Per ops convention the model
  // string reads "<brand> <model> <storage> <tag>"; anything past the
  // storage token is operator metadata (refurb grade, battery %, region —
  // anything they want). When there's no storage we just collapse the
  // remaining string into the model.
  const m = workingNoKnownTags.match(STORAGE_REGEX);
  let model: string;
  let storage: string | undefined;
  if (m) {
    storage = m[1].replace(/\s+/g, '').toUpperCase();
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const before = stripOrphanSeparators(workingNoKnownTags.slice(0, start));
    const after  = stripOrphanSeparators(workingNoKnownTags.slice(end));
    model = collapseWhitespace(before);
    const trailing = collapseWhitespace(after);
    if (trailing) tags.push(trailing);
  } else {
    model = collapseWhitespace(workingNoKnownTags);
    storage = undefined;
  }

  // Series uses the ORIGINAL lower-cased string (so we still see "iPhone"
  // even if the leading brand word was stripped). detectSeries takes a
  // Brand enum value, so anything we treat as an unknown-string brand
  // (the fallback path above) falls through to series='Other' which is
  // the correct grouping for the periodic table.
  const series = detectSeries(
    typeof brand === 'string' && !(['Apple','Samsung','Google','Xiaomi','OnePlus','Other'] as const).includes(brand as any)
      ? 'Other' : (brand as Brand),
    lower,
  );

  return {
    brand,
    model,
    storage,
    series,
    ...(tags.length > 0 ? { tag: tags.join(', ') } : {}),
  };
}

/** Strip leading and trailing separator runs (dash, bullet, comma, plus)
 *  and collapse internal whitespace. Used to clean up the model + tag
 *  pieces after splicing storage out of the middle of a string. */
function stripOrphanSeparators(s: string): string {
  return s.replace(/^[\s\-:·,+]+|[\s\-:·,+]+$/g, '');
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
      // W/C is normalised to WiFi+Cellular and lifted out of the model.
      expect(parseBrandModelStorage('IPAD 7TH GEN 32GB W/C')).toEqual({
        brand: 'Apple', model: 'IPAD 7TH GEN', storage: '32GB', series: 'iPad', tag: 'WiFi+Cellular',
      });
    });
    it('handles Galaxy A32 5G + 64GB', () => {
      // 5G is a radio tag — series detection still sees "a32" in the
      // lower-cased original so the bucket stays Galaxy A.
      expect(parseBrandModelStorage('Galaxy A32 5G 64GB')).toEqual({
        brand: 'Samsung', model: 'Galaxy A32', storage: '64GB', series: 'Galaxy A', tag: '5G',
      });
    });
    it('splits Apple iPhone 19 Pro Max with storage + Wifi/Cellular tag', () => {
      expect(parseBrandModelStorage('Apple iPhone 19 Pro Max 128GB Wifi/Cellular')).toEqual({
        brand: 'Apple', model: 'iPhone 19 Pro Max', storage: '128GB', series: 'iPhone', tag: 'WiFi+Cellular',
      });
    });
    it('extracts dual sim tag from a phone model', () => {
      expect(parseBrandModelStorage('Samsung Galaxy S22 Ultra 256GB Dual SIM 5G')).toEqual({
        brand: 'Samsung', model: 'Galaxy S22 Ultra', storage: '256GB', series: 'Galaxy S', tag: '5G, Dual SIM',
      });
    });
    it('emits no tag when nothing tag-shaped is present', () => {
      const out = parseBrandModelStorage('Apple iPhone 13 128GB');
      expect(out.tag).toBeUndefined();
    });
    it('captures freeform trailing text after storage as a tag', () => {
      // Tags can be anything — operator-defined. The text after the storage
      // token is captured verbatim (separators trimmed) so "Refurb Grade A"
      // round-trips even though it's not in the closed pattern set.
      expect(parseBrandModelStorage('iPhone 13 128GB - Refurb Grade A')).toEqual({
        brand: 'Apple', model: 'iPhone 13', storage: '128GB', series: 'iPhone', tag: 'Refurb Grade A',
      });
    });
    it('merges closed-set tags with freeform trailing text', () => {
      expect(parseBrandModelStorage('Galaxy S22 5G 256GB Dual SIM Korean ROM')).toEqual({
        brand: 'Samsung', model: 'Galaxy S22', storage: '256GB', series: 'Galaxy S', tag: '5G, Dual SIM, Korean ROM',
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

    // --- New buckets + bare-model inference (the runtime-derivation fix). The
    // 354 Firestore docs were imported with `series='Other'` because their
    // model strings ("S21", "A32 5G", "X COVER 5") were not matched by the
    // old regexes after the "SAMSUNG" prefix was stripped. The bare cases
    // below must round-trip without re-import.
    it('parses bare-model Galaxy S codes (no Samsung prefix)', () => {
      expect(parseBrandModelStorage('S21FE 128GB').series).toBe('Galaxy S');
      expect(parseBrandModelStorage('S9+ 64GB').series).toBe('Galaxy S');
      expect(parseBrandModelStorage('S22 Ultra 256GB').series).toBe('Galaxy S');
      expect(parseBrandModelStorage('S21FE 128GB').brand).toBe('Samsung');
    });
    it('parses bare-model Galaxy A codes (no Samsung prefix)', () => {
      expect(parseBrandModelStorage('A21S 32GB').series).toBe('Galaxy A');
      expect(parseBrandModelStorage('A32 5G 64GB').series).toBe('Galaxy A');
      expect(parseBrandModelStorage('A05 64GB').series).toBe('Galaxy A');
      expect(parseBrandModelStorage('A32 5G 64GB').brand).toBe('Samsung');
    });
    it('parses Galaxy XCover (rugged) — new bucket', () => {
      expect(parseBrandModelStorage('X COVER 5 64GB').series).toBe('Galaxy XCover');
      expect(parseBrandModelStorage('XCover Pro 64GB').series).toBe('Galaxy XCover');
      expect(parseBrandModelStorage('X COVER 5 64GB').brand).toBe('Samsung');
    });
    it('parses Galaxy Note bare model — new bucket coverage', () => {
      expect(parseBrandModelStorage('Note 20 Ultra 256GB').series).toBe('Galaxy Note');
    });
    it('parses Galaxy Z foldables — new bucket', () => {
      expect(parseBrandModelStorage('Z Fold 5 512GB').series).toBe('Galaxy Z');
      expect(parseBrandModelStorage('Z Flip 4 256GB').series).toBe('Galaxy Z');
    });
    it('parses Galaxy M budget line — new bucket', () => {
      expect(parseBrandModelStorage('M53 128GB').series).toBe('Galaxy M');
    });
  });
}
