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
}

function normaliseModelKey(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function sortByFrequency(map: Map<string, number>): string[] {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k);
}

export function buildDeviceCatalog(units: InventoryUnit[]): DeviceCatalogEntry[] {
  type Bucket = {
    brand: string;
    model: string;
    count: number;
    latestDateIn: string;
    storages: Map<string, number>;
    colours: Map<string, number>;
    grades: Map<string, number>;
    buyPrices: number[];
  };
  const buckets = new Map<string, Bucket>();

  for (const u of units) {
    const brand = (u.brand || '').trim();
    const model = (u.model || '').trim();
    if (!brand && !model) continue;
    const key = `${brand}||${normaliseModelKey(model)}`;
    let b = buckets.get(key);
    if (!b) {
      b = {
        brand,
        model,
        count: 0,
        latestDateIn: u.dateIn || '',
        storages: new Map(),
        colours: new Map(),
        grades: new Map(),
        buyPrices: [],
      };
      buckets.set(key, b);
    }
    b.count++;
    if ((u.dateIn || '') > b.latestDateIn) b.latestDateIn = u.dateIn || '';
    if (u.storage) b.storages.set(u.storage, (b.storages.get(u.storage) ?? 0) + 1);
    if (u.colour) b.colours.set(u.colour, (b.colours.get(u.colour) ?? 0) + 1);
    if (u.grade) b.grades.set(u.grade, (b.grades.get(u.grade) ?? 0) + 1);
    if (typeof u.buyPrice === 'number' && Number.isFinite(u.buyPrice)) {
      b.buyPrices.push(u.buyPrice);
    }
  }

  const out: DeviceCatalogEntry[] = [];
  for (const b of buckets.values()) {
    const sortedPrices = [...b.buyPrices].sort((x, y) => x - y);
    const median = sortedPrices.length
      ? sortedPrices[Math.floor(sortedPrices.length / 2)]
      : undefined;
    out.push({
      brand: b.brand,
      model: b.model,
      count: b.count,
      latestDateIn: b.latestDateIn,
      storages: sortByFrequency(b.storages),
      colours: sortByFrequency(b.colours),
      topGrade: sortByFrequency(b.grades)[0],
      medianBuyPrice: median,
    });
  }
  // Default ordering: most-stocked first, then most-recent for ties.
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
  const b = (brand || '').trim();
  const m = normaliseModelKey(model);
  return catalog.find(
    e => e.brand === b && normaliseModelKey(e.model) === m,
  );
}
