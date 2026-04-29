import { InventoryUnit, ModelSummary } from '../types';

export function buildModelSummaries(units: InventoryUnit[]): ModelSummary[] {
  const map = new Map<string, ModelSummary>();

  for (const unit of units) {
    const key = `${unit.brand}||${unit.model}`;

    if (!map.has(key)) {
      map.set(key, {
        model: unit.model,
        brand: unit.brand,
        category: unit.category,
        variants: [],
        totalAvailable: 0,
        totalValue: 0,
        flags: [],
        latestDateIn: unit.dateIn,
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
      };
      summary.variants.push(variant);
    }

    variant.units.push(unit);

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

  return Array.from(map.values());
}

export function getUnitListingSites(unit: InventoryUnit) {
  if (unit.listingSites?.length) {
    return unit.listingSites;
  }
  return unit.platformListed ? ['Listed'] : [];
}
