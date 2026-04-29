import { InventoryUnit } from '../types';

export function calculateUnitGrossProfit(unit: InventoryUnit) {
  if (unit.status !== 'sold' || typeof unit.salePrice !== 'number') return 0;
  return unit.salePrice - unit.buyPrice;
}

export function calculateUnitNetProfit(unit: InventoryUnit) {
  if (unit.status !== 'sold' || typeof unit.salePrice !== 'number') return 0;
  return unit.salePrice - unit.buyPrice - (unit.saleFees || 0) - (unit.shippingCost || 0);
}

export function calculateInventoryNetProfit(units: InventoryUnit[]) {
  return units.reduce((sum, unit) => sum + calculateUnitNetProfit(unit), 0);
}
