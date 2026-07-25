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
 * Single-variant clusters are dropped from the output — UNLESS the one
 * variant disagrees with the admin catalog, which is still a fix.
 *
 * Canonical pick (deterministic):
 *   0. The ADMIN CATALOG spelling, when the cluster matches an entry in
 *      the `models` collection. This is the permanent fix: an admin who
 *      creates "Galaxy S23" in Configuration decides the name for good.
 *      Majority vote used to win, so 10 units spelling it "GALAXY S23"
 *      overruled the catalog and the tool proposed undoing the admin's
 *      own decision — every import re-opened the same cluster.
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

/** An entry from the admin-curated `models` collection. Only the two
 *  fields the canonical decision needs. */
export interface CatalogModel {
  brand?: string;
  model?: string;
}

/** Bucket key shared by the cluster builder and the catalog index, so a
 *  catalog entry lands on the same key as the units it governs. */
function bucketKey(brand: string, model: string): string {
  return `${(brand || '').toLowerCase()}||${normalizeBucketModel(model)}`;
}

/**
 * Index the admin catalog by bucket key → the spelling the admin chose.
 * Later entries lose to earlier ones so the result is stable regardless
 * of document order.
 */
export function buildCatalogIndex(catalog: CatalogModel[] = []): Map<string, string> {
  const index = new Map<string, string>();
  for (const c of catalog) {
    const model = String(c?.model || '').trim();
    if (!model) continue;
    const brand = String(c?.brand || '').trim();
    const key = bucketKey(brand, model);
    if (!index.has(key)) index.set(key, model);
    // Also index brand-less, so a unit whose brand never got parsed still
    // finds its catalog entry.
    const looseKey = bucketKey('', model);
    if (!index.has(looseKey)) index.set(looseKey, model);
  }
  return index;
}

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
  /** Operator-chosen canonical raw string. Default = the admin catalog
   *  spelling when one exists, else the most-frequent variant (longest
   *  on tie, alpha on second tie). The admin can override this in the
   *  UI before pressing Apply. */
  canonical: string;
  /** True when `canonical` came from the admin catalog rather than a
   *  vote. The UI badges these so the operator knows the name is
   *  already decided and Apply is just enforcing it. */
  canonicalFromCatalog: boolean;
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
  sales: Sale[] = [],
  catalog: CatalogModel[] = [],
): ModelCluster[] {
  const catalogIndex = buildCatalogIndex(catalog);
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
    const catalogName = catalogIndex.get(b.key) ?? catalogIndex.get(bucketKey('', firstVariantOf(b.variants)));
    // A single variant is only a no-op when it already matches the
    // catalog. One variant spelled differently from the admin's chosen
    // name is still a cluster worth fixing.
    if (b.variants.size < 2 && (!catalogName || b.variants.has(catalogName))) continue;
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
      // Catalog wins outright — including when no unit uses that
      // spelling yet, which is exactly the "admin decided the name in
      // Configuration" case.
      canonical: catalogName || variants[0].rawModel,
      canonicalFromCatalog: !!catalogName,
      variants,
      totalUnits,
    });
  }

  // Catalog-backed clusters first (the name is already decided, so these
  // are pure enforcement), then largest — biggest impact first.
  out.sort((a, b) =>
    Number(b.canonicalFromCatalog) - Number(a.canonicalFromCatalog)
    || b.totalUnits - a.totalUnits
    || a.brand.localeCompare(b.brand));
  return out;
}

/** First raw variant of a bucket — used only to probe the catalog with a
 *  brand-less key when the brand never parsed. */
function firstVariantOf(variants: Map<string, unknown>): string {
  for (const k of variants.keys()) return k;
  return '';
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
