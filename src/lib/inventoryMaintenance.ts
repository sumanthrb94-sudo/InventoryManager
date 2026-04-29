import { InventoryUnit } from '../types';
import { dbService } from './dbService';

function normalizeImei(imei: string | undefined) {
  return (imei || '').replace(/\D/g, '');
}

function scoreUnit(unit: InventoryUnit) {
  const created = unit.createdAt ? new Date(unit.createdAt).getTime() : 0;
  const updated = unit.updatedAt ? new Date(unit.updatedAt).getTime() : 0;
  return Math.max(created, updated);
}

export function buildStableUnitId(input: {
  imei?: string;
  model?: string;
  dateIn?: string;
  supplierId?: string;
  buyPrice?: number;
  status?: string;
}) {
  const imei = normalizeImei(input.imei);
  if (imei.length >= 8) {
    return `unit_${imei}`;
  }

  const slug = [input.model, input.dateIn, input.supplierId, input.buyPrice, input.status]
    .map(part => String(part ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_'))
    .filter(Boolean)
    .join('_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');

  return `unit_${slug || 'imported'}`;
}

export async function dedupeInventoryUnitsByImei() {
  const units = (await dbService.readAll('inventoryUnits')) as InventoryUnit[];
  const groups = new Map<string, InventoryUnit[]>();

  for (const unit of units) {
    const imei = normalizeImei(unit.imei);
    if (imei.length < 8) continue;
    if (!groups.has(imei)) groups.set(imei, []);
    groups.get(imei)!.push(unit);
  }

  const duplicates = Array.from(groups.entries()).filter(([, list]) => list.length > 1);
  if (duplicates.length === 0) return { removed: 0 };

  const removals: string[] = [];
  for (const [, list] of duplicates) {
    const ordered = [...list].sort((a, b) => scoreUnit(b) - scoreUnit(a));
    removals.push(...ordered.slice(1).map(unit => unit.id));
  }

  for (const id of removals) {
    await dbService.delete('inventoryUnits', id);
  }

  return { removed: removals.length };
}
