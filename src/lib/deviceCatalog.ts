// Device catalog built from the live inventory.
//
// What it's for: the OCR pipeline auto-fills brand+model from a photo, but
// users frequently key in a unit by hand. Surfacing the (brand, model) pairs
// that already exist in stock — plus the storages / colours / grades they
// usually come in — turns manual entry into a one-tap pick and keeps naming
// consistent across the catalog (no more "S21 FE 5G" vs "S 21 FE" vs
// "Galaxy S21FE" duplicates that destroy our model summaries).
//
// We expose:
//   - buildDeviceCatalog(units): full deduped list with frequency + metadata
//   - searchDeviceCatalog(catalog, query, max): filter for combobox suggestions
//   - catalogEntryFor(catalog, brand, model): exact lookup for cross-reference

import type { InventoryUnit } from '../types';
import { normalizeBucketModel } from './modelStorage';

export interface DeviceCatalogEntry {
  brand: string;
  model: string;
  // How many units of this exact (brand, model) exist in the store.
  count: number;
  // Most recent dateIn across those units — drives "newest first" ordering.
  latestDateIn: string;
  // Common storage values for this device, ordered by frequency.
  storages: string[];
  // Common colours for this device, ordered by frequency.
  colours: string[];
  // The grade we've seen most often (helpful for defaulting).
  topGrade?: string;
  // Median buy price across stocked units — useful as a starting suggestion.
  medianBuyPrice?: number;
  /** Origin of this entry — 'inventory' = at least one matching unit
   *  exists in stock; 'seed' = admin-added via the models collection
   *  but no stock yet. Lets the picker tag seed-only entries with a
   *  visual hint and lets reconciliation skip them. */
  source: 'inventory' | 'seed';
}

/** Admin-curated catalog seed — one doc per row in the `models` Firestore
 *  collection. Lets the admin onboard a new SKU before any stock exists,
 *  so the picker can offer it to employees on the first add. */
export interface ModelSeed {
  id: string;
  brand: string;
  model: string;
  series?: string;
}

function sortByFrequency(map: Map<string, number>): string[] {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k);
}

export function buildDeviceCatalog(
  units: InventoryUnit[],
  seeds: ModelSeed[] = [],
): DeviceCatalogEntry[] {
  type Bucket = {
    /** Per-raw-variant tally so we can pick the canonical display label
     *  per bucket — most-frequent variant wins. Without this the very
     *  first unit's raw string would dictate the label, which produces
     *  "GALAXY S23" tiles when the majority of units carry the cleaner
     *  "Galaxy S23". */
    variants: Map<string, number>;
    brand: string;
    count: number;
    latestDateIn: string;
    storages: Map<string, number>;
    colours: Map<string, number>;
    grades: Map<string, number>;
    buyPrices: number[];
    fromInventory: boolean;
  };
  const buckets = new Map<string, Bucket>();

  /** Bucket key spans both inventory units and admin-curated seeds so a
   *  newly-seeded model collapses into the matching inventory cluster
   *  the moment stock arrives — no duplicate "seed-only" pill next to
   *  the real entry. Normalised model is the deduping field;
   *  normaliseBucketModel strips Samsung/Galaxy/Apple prefix + lowercases
   *  so "GALAXY S23" / "S23" / "Galaxy S23" all hit the same key. */
  const keyOf = (brand: string, model: string) =>
    `${(brand || '').toLowerCase().trim()}||${normalizeBucketModel(model)}`;

  const ensureBucket = (brand: string, model: string, dateIn = ''): Bucket | null => {
    if (!brand && !model) return null;
    const key = keyOf(brand, model);
    let b = buckets.get(key);
    if (!b) {
      b = {
        variants: new Map(),
        brand,
        count: 0,
        latestDateIn: dateIn,
        storages: new Map(),
        colours: new Map(),
        grades: new Map(),
        buyPrices: [],
        fromInventory: false,
      };
      buckets.set(key, b);
    }
    // Brand stays the FIRST non-empty we see — keeps consistent display
    // regardless of merge order. The variants map captures every raw
    // model string we've encountered so canonical selection runs over
    // the full set at the end.
    if (!b.brand && brand) b.brand = brand;
    const m = (model || '').trim();
    if (m) b.variants.set(m, (b.variants.get(m) ?? 0) + 1);
    return b;
  };

  for (const u of units) {
    const brand = (u.brand || '').trim();
    const model = (u.model || '').trim();
    const b = ensureBucket(brand, model, u.dateIn || '');
    if (!b) continue;
    b.fromInventory = true;
    b.count++;
    if ((u.dateIn || '') > b.latestDateIn) b.latestDateIn = u.dateIn || '';
    if (u.storage) b.storages.set(u.storage, (b.storages.get(u.storage) ?? 0) + 1);
    if (u.colour) b.colours.set(u.colour, (b.colours.get(u.colour) ?? 0) + 1);
    if (u.grade) b.grades.set(u.grade, (b.grades.get(u.grade) ?? 0) + 1);
    if (typeof u.buyPrice === 'number' && Number.isFinite(u.buyPrice)) {
      b.buyPrices.push(u.buyPrice);
    }
  }

  // Seed-only entries — admin-curated models that have no stock yet.
  // ensureBucket merges with the inventory bucket if one exists for the
  // same (brand, normalised model), so an admin seeding "Galaxy S26"
  // before any stock lands and then the first unit being added later
  // both end up in one tile.
  for (const s of seeds) {
    ensureBucket((s.brand || '').trim(), (s.model || '').trim());
  }

  const out: DeviceCatalogEntry[] = [];
  for (const b of buckets.values()) {
    const sortedPrices = [...b.buyPrices].sort((x, y) => x - y);
    const median = sortedPrices.length
      ? sortedPrices[Math.floor(sortedPrices.length / 2)]
      : undefined;
    // Canonical display label = most-frequent raw variant in the bucket;
    // tie-breakers: longest string (more info), then alpha for stability.
    const canonical = Array.from(b.variants.entries())
      .sort((a, c) => c[1] - a[1] || c[0].length - a[0].length || a[0].localeCompare(c[0]))[0]?.[0]
      ?? '';
    out.push({
      brand: b.brand,
      model: canonical,
      count: b.count,
      latestDateIn: b.latestDateIn,
      storages: sortByFrequency(b.storages),
      colours: sortByFrequency(b.colours),
      topGrade: sortByFrequency(b.grades)[0],
      medianBuyPrice: median,
      source: b.fromInventory ? 'inventory' : 'seed',
    });
  }
  // Default ordering: most-stocked first, then most-recent for ties.
  // Seed-only entries sink to the bottom (count=0) so they don't crowd
  // out real catalog hits when the operator's typing matches both.
  out.sort((a, b) =>
    b.count - a.count ||
    (b.latestDateIn || '').localeCompare(a.latestDateIn || ''),
  );
  return out;
}

export function searchDeviceCatalog(
  catalog: DeviceCatalogEntry[],
  query: string,
  max = 8,
): DeviceCatalogEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return catalog.slice(0, max);
  // Match on either brand or model, case-insensitive, in any order.
  const tokens = q.split(/\s+/).filter(Boolean);
  const scored = catalog
    .map(entry => {
      const haystack = `${entry.brand} ${entry.model}`.toLowerCase();
      const allMatch = tokens.every(t => haystack.includes(t));
      if (!allMatch) return null;
      // Prefer matches where the first token is at the start of brand or model.
      const startsWithBrand = entry.brand.toLowerCase().startsWith(tokens[0]);
      const startsWithModel = entry.model.toLowerCase().startsWith(tokens[0]);
      const startBonus = startsWithBrand || startsWithModel ? 1000 : 0;
      return { entry, score: startBonus + entry.count };
    })
    .filter(Boolean) as { entry: DeviceCatalogEntry; score: number }[];
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, max).map(s => s.entry);
}

export function catalogEntryFor(
  catalog: DeviceCatalogEntry[],
  brand: string,
  model: string,
): DeviceCatalogEntry | undefined {
  const b = (brand || '').toLowerCase().trim();
  const m = normalizeBucketModel(model);
  // When the caller doesn't track brand (brand=""), match on model alone
  // so strict-mode onBlur doesn't falsely revert a just-picked entry.
  return catalog.find(e =>
    normalizeBucketModel(e.model) === m &&
    (!b || (e.brand || '').toLowerCase().trim() === b),
  );
}
