import { InventoryUnit, ModelSummary } from '../types';

export function buildModelSummaries(units: InventoryUnit[]): ModelSummary[] {
  const map = new Map<string, ModelSummary>();

  for (const unit of units) {
    // Storage is part of the SKU identity — a 128GB and a 256GB iPhone 15 are
    // different products and must not collapse into the same model row.
    // Legacy units often carry the storage as part of `model` already (e.g.
    // "iPhone 15 Pro Max 256GB") which means `unit.storage` is undefined; in
    // that case the model string itself differentiates groups, so the empty
    // storage segment is safe. New imports set `unit.storage` explicitly.
    const storage = unit.storage || '';
    const key = `${unit.brand}||${unit.model}||${storage}`;

    if (!map.has(key)) {
      map.set(key, {
        model: unit.model,
        brand: unit.brand,
        category: unit.category,
        storage: unit.storage,
        variants: [],
        totalAvailable: 0,
        totalValue: 0,
        flags: [],
        latestDateIn: unit.dateIn,
        listingSites: [],
      });
    }

    const summary = map.get(key)!;
    let variant = summary.variants.find(v => v.colour === unit.colour);

    if (!variant) {
      variant = {
        colour: unit.colour,
        availableCount: 0,
        units: [],
        lowestBuyPrice: unit.buyPrice,
        listingSites: [],
      };
      summary.variants.push(variant);
    }

    variant.units.push(unit);

    // Collect listing sites
    const unitSites = getUnitListingSites(unit);
    for (const site of unitSites) {
      if (site !== 'Listed' && !variant.listingSites.includes(site as any)) {
        variant.listingSites.push(site as any);
      }
      if (site !== 'Listed' && !summary.listingSites.includes(site as any)) {
        summary.listingSites.push(site as any);
      }
    }

    if (unit.status === 'available') {
      variant.availableCount += 1;
      summary.totalAvailable += 1;
    }

    if (unit.buyPrice < variant.lowestBuyPrice) {
      variant.lowestBuyPrice = unit.buyPrice;
    }

    if (unit.status !== 'sold') {
      summary.totalValue += unit.buyPrice;
    }

    for (const flag of unit.flags) {
      if (!summary.flags.includes(flag)) {
        summary.flags.push(flag);
      }
    }

    if (unit.dateIn > summary.latestDateIn) {
      summary.latestDateIn = unit.dateIn;
    }
  }

  // Sort each variant's units latest-first so expanded model rows show the
  // most recent intake at the top everywhere they're rendered.
  for (const summary of map.values()) {
    for (const variant of summary.variants) {
      variant.units.sort((a, b) => {
        const ad = a.dateIn || '';
        const bd = b.dateIn || '';
        if (ad !== bd) return bd.localeCompare(ad);
        const ac = (a as any).createdAt || '';
        const bc = (b as any).createdAt || '';
        return bc.localeCompare(ac);
      });
    }
  }

  return Array.from(map.values());
}

export function getUnitListingSites(unit: InventoryUnit) {
  if (unit.listingSites?.length) {
    return unit.listingSites;
  }
  return unit.platformListed ? ['Listed'] : [];
}
