/**
 * wipeScopes — the write plan behind every *scoped* "Wipe DB" button.
 *
 * The original ResetDataModal nukes every collection at once. Operators
 * asked for finer scissors: clear just the office shelf, just the SHS
 * (supplier-held) book, just the sold history, or just the returns —
 * from the page that owns that data, without touching the other three.
 *
 * The membership rules below MUST stay in lockstep with the surfaces
 * that display each bucket, otherwise a wipe leaves rows behind:
 *   - office  → BuySheet `officeUnits` / `officeAggs`
 *   - shs     → BuySheet `shsUnits` / `shsAggs` (src/lib/shsCount.ts)
 *   - sales   → Sales.tsx `allSales` = `sales` docs + legacy sold units
 *   - returns → ReturnsPage `allReturns` (units carrying returnType)
 *
 * Returns are the one scope that patches instead of deletes: a return
 * is a set of flags on an inventory unit, not its own doc. Deleting the
 * unit would destroy stock that is physically back on the shelf, so the
 * wipe strips the return markers and leaves the unit in place.
 */
import type { InventoryUnit, InventoryAggregate, InventoryEvent, Sale, AccessoryStock } from '../types';

export type WipeScopeId = 'office' | 'shs' | 'sales' | 'returns';

export interface WipeDelete { collection: string; id: string }
/** `null` on a field means "clear it" — dbService.bulkUpdate turns that
 *  into a Firestore deleteField() and drops the key from the cache. */
export interface WipePatch { collection: string; id: string; data: Record<string, unknown> }

export interface WipePlan {
  deletes: WipeDelete[];
  patches: WipePatch[];
  /** Per-bucket counts for the modal's "what will happen" list. */
  breakdown: Array<{ label: string; count: number }>;
  total: number;
}

export interface WipeSource {
  units: InventoryUnit[];
  aggregates: InventoryAggregate[];
  sales: Sale[];
  /** No-IMEI accessory quantity pools — always office-side stock (there is
   *  no SHS-accessory concept), so the 'office' scope sweeps these too. */
  accessoryStock?: AccessoryStock[];
  /** Optional — when supplied, events belonging to deleted units are
   *  swept too so the audit trail doesn't outlive its unit. */
  events?: InventoryEvent[];
}

// ── Membership predicates ─────────────────────────────────────────────────────

/** Office shelf — mirrors BuySheet's `officeUnits`. A unit stuck on
 *  status='returned' but flagged returned_to_inventory is office stock
 *  too (see the defensive note in BuySheet). */
export function isOfficeStockUnit(u: InventoryUnit): boolean {
  return u.status === 'available'
    || (u.returnType === 'returned_to_inventory' && u.status !== 'sold');
}

/** Master-file rollup rows that belong to the office shelf — everything
 *  the import didn't tag as SHS, including zero-quantity rows (which the
 *  KPI hides but which are still office-side master data). */
export function isOfficeAggregate(a: InventoryAggregate): boolean {
  return (a.quantityText || '').toUpperCase() !== 'SHS';
}

/** SHS book — every unit awaiting delivery, both parser placeholders
 *  (`shs_*`) and manually-logged supplier orders. */
export function isShsUnit(u: InventoryUnit): boolean {
  return u.status === 'incoming';
}

export function isShsAggregate(a: InventoryAggregate): boolean {
  return (a.quantityText || '').toUpperCase() === 'SHS';
}

/** Legacy in-app sales — sold units the Sales grid merges in alongside
 *  the `sales` collection. Matches Sales.tsx `legacyInAppSales`. */
export function isSoldUnit(u: InventoryUnit): boolean {
  return u.status === 'sold' && (u.salePrice != null || !!u.saleDate);
}

/** Any unit carrying return history, including one still parked in the
 *  Tech-QC → CRM handoff queue (returnType isn't set until CRM finalises). */
export function isReturnUnit(u: InventoryUnit): boolean {
  return !!u.returnType || !!u.returnDate || !!u.pendingCrmReview || !!u.returnQcAt;
}

/** Every field the Returns flow writes onto an inventory unit. Cleared
 *  as a set so no half-return survives the wipe. */
export const RETURN_FIELDS = [
  'returnType',
  'returnDate',
  'returnReason',
  'returnOutcome',
  'returnComments',
  'returnLegCost',
  'repairedAt',
  'replacedByUnitId',
  'replacementForUnitId',
  'customerComments',
  'technicianComments',
  'returnQcAt',
  'pendingCrmReview',
] as const;

/**
 * Patch that un-marks a returned unit. A unit left on status='returned'
 * would become invisible to every surface once its returnType is gone,
 * so it goes back on the shelf as 'available'. Sold units keep their
 * status — that's the Sales scope's business, not this one.
 */
export function buildReturnResetPatch(u: InventoryUnit): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const f of RETURN_FIELDS) {
    if ((u as unknown as Record<string, unknown>)[f] !== undefined) data[f] = null;
  }
  if (u.status === 'returned') data.status = 'available';
  return data;
}

// ── Scope metadata (drives the modal chrome) ──────────────────────────────────

export interface WipeScopeMeta {
  id: WipeScopeId;
  /** Button + modal title, e.g. "Wipe Office Stock". */
  title: string;
  /** Short button caption. */
  buttonLabel: string;
  /** One-line "what this clears". */
  summary: string;
  /** Explicit statement of what survives — operators reach for the wrong
   *  button otherwise. */
  keeps: string;
  confirmLabel: string;
}

export const WIPE_SCOPES: Record<WipeScopeId, WipeScopeMeta> = {
  office: {
    id: 'office',
    title: 'Wipe In-Office Stock',
    buttonLabel: 'Wipe Office Stock',
    summary: 'Deletes every unit sitting on the office shelf plus the office master-file rollup rows.',
    keeps: 'SHS stock, sold history and returns are untouched.',
    confirmLabel: 'I understand this deletes all in-office stock',
  },
  shs: {
    id: 'shs',
    title: 'Wipe SHS Stock',
    buttonLabel: 'Wipe SHS',
    summary: 'Deletes every incoming supplier-held unit plus the SHS master-file rollup rows.',
    keeps: 'Office stock, sold history and returns are untouched.',
    confirmLabel: 'I understand this deletes all SHS stock',
  },
  sales: {
    id: 'sales',
    title: 'Wipe Sales',
    buttonLabel: 'Wipe Sales',
    summary: 'Deletes every sale record and every unit already marked sold in the app.',
    keeps: 'Office stock, SHS stock and return flags on unsold units are untouched.',
    confirmLabel: 'I understand this deletes all sales history',
  },
  returns: {
    id: 'returns',
    title: 'Wipe Returns',
    buttonLabel: 'Wipe Returns',
    summary: 'Clears the return markers on every unit — a return lives on the unit, so the unit itself is kept and any still marked "returned" goes back to available.',
    keeps: 'No units are deleted. Sale records keep their void markers.',
    confirmLabel: 'I understand this clears all return records',
  },
};

// ── Plan builder ──────────────────────────────────────────────────────────────

/**
 * Turn a scope + the current in-memory data into the exact list of
 * deletes/patches to execute. Pure — the modal renders the breakdown
 * before asking for confirmation, then hands the same plan to dbService.
 */
export function buildWipePlan(scope: WipeScopeId, src: WipeSource): WipePlan {
  const deletes: WipeDelete[] = [];
  const patches: WipePatch[] = [];
  const breakdown: Array<{ label: string; count: number }> = [];

  const pushUnits = (units: InventoryUnit[], label: string) => {
    for (const u of units) deletes.push({ collection: 'inventoryUnits', id: u.id });
    breakdown.push({ label, count: units.length });
  };

  if (scope === 'office' || scope === 'shs') {
    const isUnit = scope === 'office' ? isOfficeStockUnit : isShsUnit;
    const isAgg  = scope === 'office' ? isOfficeAggregate : isShsAggregate;
    const units = src.units.filter(isUnit);
    const aggs  = src.aggregates.filter(isAgg);
    pushUnits(units, scope === 'office' ? 'Office units' : 'SHS units');
    for (const a of aggs) deletes.push({ collection: 'inventoryAggregates', id: a.id });
    breakdown.push({ label: 'Master-file rows', count: aggs.length });
    pushEvents(deletes, breakdown, src.events, units);
    if (scope === 'office' && src.accessoryStock?.length) {
      for (const a of src.accessoryStock) deletes.push({ collection: 'accessoryStock', id: a.id });
      breakdown.push({ label: 'Accessory SKU pools', count: src.accessoryStock.length });
    }
  }

  if (scope === 'sales') {
    for (const s of src.sales) deletes.push({ collection: 'sales', id: s.id });
    breakdown.push({ label: 'Sale records', count: src.sales.length });
    const soldUnits = src.units.filter(isSoldUnit);
    pushUnits(soldUnits, 'Sold units (in-app sales)');
    pushEvents(deletes, breakdown, src.events, soldUnits);
  }

  if (scope === 'returns') {
    const returned = src.units.filter(isReturnUnit);
    for (const u of returned) {
      const data = buildReturnResetPatch(u);
      if (Object.keys(data).length > 0) {
        patches.push({ collection: 'inventoryUnits', id: u.id, data });
      }
    }
    breakdown.push({ label: 'Units with return flags cleared', count: patches.length });
  }

  return { deletes, patches, breakdown, total: deletes.length + patches.length };
}

/** Sweep inventoryEvents belonging to units the plan is deleting. */
function pushEvents(
  deletes: WipeDelete[],
  breakdown: Array<{ label: string; count: number }>,
  events: InventoryEvent[] | undefined,
  units: InventoryUnit[],
): void {
  if (!events || events.length === 0 || units.length === 0) return;
  const ids = new Set(units.map(u => u.id));
  const orphaned = events.filter(e => e.unitId && ids.has(e.unitId));
  for (const e of orphaned) deletes.push({ collection: 'inventoryEvents', id: e.id });
  if (orphaned.length > 0) breakdown.push({ label: 'Linked events', count: orphaned.length });
}
