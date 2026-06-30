/**
 * modelReconciliation — pure helper feeding the admin Reconciliation tool.
 *
 * Groups inventory units whose `model` field collapses to the SAME
 * normalised key (per `normalizeBucketModel` — see modelStorage.ts) but
 * whose raw strings differ. Each multi-variant cluster is a candidate
 * for cleanup: pick a canonical raw string, bulk-update every unit's
 * `model` field to that string, the periodic table merges its tiles,
 * the device catalog collapses its entries, the operator stops seeing
 * "GALAXY S23" + "S23" as two products.
 *
 * Single-variant clusters are dropped from the output — nothing to fix.
 *
 * Canonical pick (deterministic):
 *   1. Most-frequent raw variant in the cluster (by unit count).
 *   2. Tie-break: longest string (more info — "Galaxy S23" beats "S23").
 *   3. Final tie-break: alpha for stability.
 *
 * This module owns NO React, NO Firestore — it's a pure function over
 * the units array. The admin component reads its output and dispatches
 * a single dbService.bulkCreate (which does `{ merge: true }` writes,
 * so passing only `{ model }` patches every existing field intact).
 */
import type { InventoryUnit, InventoryAggregate, Sale } from '../types';
import { normalizeBucketModel, parseBrandModelStorage } from './modelStorage';

export interface ModelClusterVariant {
  /** Raw model string verbatim — exactly what the unit doc carries. */
  rawModel: string;
  /** Number of items currently using this raw string. */
  count: number;
  /** Doc ids of those units — bulk-update targets. */
  unitIds: string[];
  aggregateIds: string[];
  saleIds: string[];
}

export interface ModelCluster {
  /** Bucket key: lowercase brand + '||' + normalizeBucketModel(model). */
  key: string;
  /** Brand shown in the row (first non-empty seen in the cluster). */
  brand: string;
  /** Operator-chosen canonical raw string. Default = most-frequent
   *  variant (longest on tie, alpha on second tie). The admin can
   *  override this in the UI before pressing Apply. */
  canonical: string;
  /** Every distinct raw `unit.model` value in this cluster, with its
   *  doc-id list. Ordered by count desc, then by length desc, then
   *  alpha asc — matches the canonical-pick ordering so the default
   *  canonical is always the first row. */
  variants: ModelClusterVariant[];
  /** Σ counts across variants — the total number of units affected
   *  when the operator presses Apply (minus the ones already matching
   *  the canonical, which become no-op patches). */
  totalUnits: number;
}

export function buildReconciliationClusters(
  units: InventoryUnit[] = [],
  aggregates: InventoryAggregate[] = [],
  sales: Sale[] = []
): ModelCluster[] {
  type Bucket = {
    key: string;
    brand: string;
    /** rawModel → { count, unitIds, aggregateIds, saleIds } */
    variants: Map<string, { count: number; unitIds: string[]; aggregateIds: string[]; saleIds: string[] }>;
  };
  const map = new Map<string, Bucket>();

  const processItem = (
    id: string,
    brand: any,
    rawModel: any,
    type: 'unit' | 'aggregate' | 'sale'
  ) => {
    const safeBrand = String(brand || '').trim();
    const safeRawModel = String(rawModel || '').trim();
    if (!safeBrand && !safeRawModel) return;
    
    let resolvedBrand = safeBrand;
    let baseModelForBucket = safeRawModel;

    // For sales without a model (where we pass SKU as rawModel), we must parse 
    // the SKU to get a clean model for bucketing, so it groups with inventory units.
    if (type === 'sale' && !brand) {
      const parsed = parseBrandModelStorage(safeRawModel);
      resolvedBrand = parsed.brand !== 'Other' ? parsed.brand : '';
      if (parsed.model) baseModelForBucket = parsed.model;
    }

    if (!resolvedBrand) {
      resolvedBrand = parseBrandModelStorage(safeRawModel).brand || '';
    }
    const key = `${resolvedBrand.toLowerCase()}||${normalizeBucketModel(baseModelForBucket)}`;
    let b = map.get(key);
    if (!b) {
      b = { key, brand: resolvedBrand, variants: new Map() };
      map.set(key, b);
    }
    if (!b.brand && resolvedBrand) b.brand = resolvedBrand;
    let v = b.variants.get(safeRawModel);
    if (!v) {
      v = { count: 0, unitIds: [], aggregateIds: [], saleIds: [] };
      b.variants.set(safeRawModel, v);
    }
    v.count++;
    if (id) {
      if (type === 'unit') v.unitIds.push(id);
      else if (type === 'aggregate') v.aggregateIds.push(id);
      else if (type === 'sale') v.saleIds.push(id);
    }
  };

  for (const u of units) {
    processItem(u.id, u.brand || '', u.model || '', 'unit');
  }
  for (const a of aggregates) {
    processItem(a.id, '', a.model || '', 'aggregate');
  }
  for (const s of sales) {
    // Only reconcile unlinked sales
    if (s.unitId) continue;
    const raw = s.model || s.sku || '';
    if (raw) processItem(s.id, '', raw, 'sale');
  }

  const out: ModelCluster[] = [];
  for (const b of map.values()) {
    if (b.variants.size < 2) continue;
    const variants: ModelClusterVariant[] = Array.from(b.variants.entries())
      .map(([rawModel, v]) => ({ 
        rawModel, 
        count: v.count, 
        unitIds: [...v.unitIds],
        aggregateIds: [...v.aggregateIds],
        saleIds: [...v.saleIds]
      }))
      .sort((a, c) =>
        c.count - a.count
        || c.rawModel.length - a.rawModel.length
        || a.rawModel.localeCompare(c.rawModel),
      );
    const totalUnits = variants.reduce((n, v) => n + v.count, 0);
    out.push({
      key: b.key,
      brand: b.brand,
      canonical: variants[0].rawModel,
      variants,
      totalUnits,
    });
  }

  // Largest clusters first — operator triages biggest impact first.
  out.sort((a, b) => b.totalUnits - a.totalUnits || a.brand.localeCompare(b.brand));
  return out;
}

export type PatchTarget = { collection: 'inventoryUnits' | 'inventoryAggregates' | 'sales'; id: string; model: string };

export function buildReconciliationPatches(cluster: ModelCluster): PatchTarget[] {
  const out: PatchTarget[] = [];
  for (const v of cluster.variants) {
    if (v.rawModel === cluster.canonical) continue;
    for (const id of (v.unitIds || [])) out.push({ collection: 'inventoryUnits', id, model: cluster.canonical });
    for (const id of (v.aggregateIds || [])) out.push({ collection: 'inventoryAggregates', id, model: cluster.canonical });
    for (const id of (v.saleIds || [])) out.push({ collection: 'sales', id, model: cluster.canonical });
  }
  return out;
}
