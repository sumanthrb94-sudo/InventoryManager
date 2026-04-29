import { InventoryUnit } from '../types';

export function getOnHandValue(units: InventoryUnit[]) {
  return units
    .filter(u => u.status !== 'sold')
    .reduce((sum, unit) => sum + unit.buyPrice, 0);
}
