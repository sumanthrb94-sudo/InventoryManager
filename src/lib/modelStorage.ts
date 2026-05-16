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
}
