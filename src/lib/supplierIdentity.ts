/**
 * supplierIdentity.ts — one supplier, one key, whichever side you came from.
 *
 * Units carry `supplierId`. Imported sales do not — `salesImport.ts` reads the
 * Supplier column into `supplierName` and never resolves it to a record. So
 * any screen that groups both by `supplierId` splits every supplier in two:
 * a units row with no sales, and a sales row with no units.
 *
 * On the live system that showed up as a supplier list where NIHAL appeared
 * twice — once with 354 sales, £56,910 revenue and a return rate of "—"
 * (because it had no units), and once with units and zero sales. Every other
 * supplier read £0. The first row was not NIHAL at all: it was the catch-all
 * `supplierId || 'unknown'` bucket holding EVERY imported sale, wearing the
 * name of whichever sale happened to sort first.
 *
 * The fix is to resolve identity the way a human would — by id when there is
 * one, otherwise by name against the supplier catalog — so both sides of the
 * join land on the same key.
 */
import type { Supplier } from '../types';

/** Anything carrying supplier attribution: a unit, a sale, an aggregate row. */
export interface SupplierAttributed {
  supplierId?: string;
  supplierName?: string;
}

export interface SupplierIndex {
  /** Supplier id → display name. */
  byId: Map<string, string>;
  /** Normalised name → supplier id. */
  idByName: Map<string, string>;
}

/** Letters and digits only, so spacing, punctuation and case collapse. */
export function normaliseSupplierName(name: string | undefined | null): string {
  return (name ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function buildSupplierIndex(suppliers: Supplier[]): SupplierIndex {
  const byId = new Map<string, string>();
  const idByName = new Map<string, string>();
  for (const s of suppliers) {
    if (!s?.id) continue;
    byId.set(s.id, s.name ?? '');
    const key = normaliseSupplierName(s.name);
    // First record wins, so a duplicated supplier name resolves consistently
    // rather than flip-flopping between two ids depending on iteration order.
    if (key && !idByName.has(key)) idByName.set(key, s.id);
  }
  return { byId, idByName };
}

export interface ResolvedSupplier {
  /** Stable grouping key — a supplier id where one exists, else `name:<norm>`. */
  key: string;
  /** Best display name available. */
  name: string;
  /** True when this resolved to a real supplier record. */
  known: boolean;
}

/**
 * Resolve a unit or sale to a single supplier identity.
 *
 * Order matters: an explicit id wins, then a name match against the catalog,
 * then the name on its own. The last case keeps a sale whose supplier was
 * never created from vanishing into a shared bucket with every other
 * unattributed sale — they stay separate rows under their own names, which is
 * both truer and visibly wrong in a useful way.
 */
export function resolveSupplier(
  entity: SupplierAttributed,
  index: SupplierIndex,
): ResolvedSupplier {
  const id = (entity.supplierId ?? '').trim();
  if (id && index.byId.has(id)) {
    return { key: id, name: index.byId.get(id) || entity.supplierName || 'Unknown', known: true };
  }

  const norm = normaliseSupplierName(entity.supplierName);
  if (norm && index.idByName.has(norm)) {
    const resolvedId = index.idByName.get(norm)!;
    return { key: resolvedId, name: index.byId.get(resolvedId) || entity.supplierName || 'Unknown', known: true };
  }

  // An id we don't recognise is still an identity — keep it distinct rather
  // than merging it with everything else unattributed.
  if (id) return { key: id, name: entity.supplierName || 'Unknown', known: false };
  if (norm) return { key: `name:${norm}`, name: (entity.supplierName ?? '').trim(), known: false };
  return { key: 'unattributed', name: 'Unattributed', known: false };
}

/**
 * Group anything supplier-attributed under one key per supplier.
 *
 * @param items    Units, sales, or any mix carrying supplierId / supplierName.
 * @param index    Built from the supplier catalog.
 * @param seed     Fresh accumulator per supplier.
 * @param accumulate  Folds one item into its supplier's accumulator.
 */
export function groupBySupplier<T extends SupplierAttributed, A>(
  items: T[],
  index: SupplierIndex,
  seed: (resolved: ResolvedSupplier) => A,
  accumulate: (acc: A, item: T) => void,
): Map<string, { supplier: ResolvedSupplier; value: A }> {
  const out = new Map<string, { supplier: ResolvedSupplier; value: A }>();
  for (const item of items) {
    const resolved = resolveSupplier(item, index);
    let entry = out.get(resolved.key);
    if (!entry) {
      entry = { supplier: resolved, value: seed(resolved) };
      out.set(resolved.key, entry);
    }
    accumulate(entry.value, item);
  }
  return out;
}
