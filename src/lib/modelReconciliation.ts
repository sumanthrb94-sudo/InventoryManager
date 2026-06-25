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
import type { InventoryUnit } from '../types';
import { normalizeBucketModel } from './modelStorage';

export interface ModelClusterVariant {
  /** Raw model string verbatim — exactly what the unit doc carries. */
  rawModel: string;
  /** Number of units currently using this raw string. */
  count: number;
  /** Doc ids of those units — bulk-update targets. */
  unitIds: string[];
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

export function buildReconciliationClusters(units: InventoryUnit[]): ModelCluster[] {
  type Bucket = {
    key: string;
    brand: string;
    /** rawModel → { count, unitIds } */
    variants: Map<string, { count: number; unitIds: string[] }>;
  };
  const map = new Map<string, Bucket>();

  for (const u of units) {
    const brand = (u.brand || '').trim();
    const raw = (u.model || '').trim();
    if (!brand && !raw) continue;
    const key = `${brand.toLowerCase()}||${normalizeBucketModel(raw)}`;
    let b = map.get(key);
    if (!b) {
      b = { key, brand, variants: new Map() };
      map.set(key, b);
    }
    if (!b.brand && brand) b.brand = brand;
    let v = b.variants.get(raw);
    if (!v) {
      v = { count: 0, unitIds: [] };
      b.variants.set(raw, v);
    }
    v.count++;
    if (u.id) v.unitIds.push(u.id);
  }

  const out: ModelCluster[] = [];
  for (const b of map.values()) {
    if (b.variants.size < 2) continue;
    const variants: ModelClusterVariant[] = Array.from(b.variants.entries())
      .map(([rawModel, v]) => ({ rawModel, count: v.count, unitIds: [...v.unitIds] }))
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

/** Build the list of per-unit patches the admin Apply button will dispatch.
 *  Skips units already at the canonical value so the write batch only
 *  carries real updates (no-op writes still bump updatedAt — wasteful). */
export function buildReconciliationPatches(cluster: ModelCluster): Array<{ id: string; model: string }> {
  const out: Array<{ id: string; model: string }> = [];
  for (const v of cluster.variants) {
    if (v.rawModel === cluster.canonical) continue;
    for (const id of v.unitIds) {
      out.push({ id, model: cluster.canonical });
    }
  }
  return out;
}
