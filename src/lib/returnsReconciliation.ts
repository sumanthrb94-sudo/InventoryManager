/**
 * returnsReconciliation — why the Sell chip and the Returns page disagree.
 *
 * The two surfaces count different things and both are correct:
 *
 *   Sell page  "N returns processed"  → voided SALE DOCS (events)
 *   Returns    "ALL RETURNS"          → UNITS in an open return cycle
 *
 * Five voided sales over four units is legitimate — but "legitimate" and
 * "what the operator expected" aren't the same thing, so this module
 * names the gap row by row instead of leaving it to be re-derived from
 * two screens on a phone.
 *
 * Both predicates below are the SINGLE SOURCE for their surface —
 * ReturnsPage and SellSheet import them rather than re-implementing, so
 * the reconciliation can never drift from the numbers it explains.
 */
import type { InventoryUnit, Sale } from '../types';

/**
 * A unit in an OPEN return cycle — the Returns ledger's membership rule.
 *
 * Multi-cycle guard: a unit returned-to-inventory and then RE-SOLD still
 * carries returnType (recordSale doesn't clear it). Without the date
 * comparison the same unit double-appears in Returns and on the Sell
 * sheet, and an operator can re-process a closed return.
 */
export function isOpenReturnUnit(u: InventoryUnit): boolean {
  if (!u.returnType) return false;
  if (u.status === 'sold' && u.saleDate && u.returnDate && u.saleDate > u.returnDate) return false;
  return true;
}

export interface VoidedSaleEvent {
  voidedAt: string;
  sale: Sale;
}

/**
 * Every return EVENT visible to the Sell page: sale docs explicitly
 * voided by processReturn, plus a legacy fallback for units whose
 * returnType was set before the sale-patch existed.
 */
export function buildVoidedSaleEvents(units: InventoryUnit[], sales: Sale[]): VoidedSaleEvent[] {
  const out: VoidedSaleEvent[] = [];
  for (const s of sales) {
    if (s.voidedAt) out.push({ voidedAt: s.voidedAt, sale: s });
  }
  const seen = new Set<string>(out.map(x => x.sale.id));
  for (const u of units) {
    if (!u.returnType || !u.returnDate) continue;
    const match = sales.find(s => s.unitId === u.id);
    if (match && !seen.has(match.id)) {
      out.push({ voidedAt: u.returnDate, sale: match });
      seen.add(match.id);
    }
  }
  return out;
}

export type VoidedSaleReason =
  /** Matches a unit sitting in the Returns ledger — the two screens agree. */
  | 'open_return'
  /** A second (or third) voided sale doc for a unit already counted.
   *  processReturn voids EVERY sale linked by unitId OR imei
   *  (returnsService.findLinkedSales), so one return click voids two docs
   *  when the same IMEI was both imported and sold in-app. */
  | 'duplicate_sale'
  /** Unit was re-sold after the return — closed cycle, dropped from the
   *  Returns ledger by the multi-cycle guard, sale doc stays voided. */
  | 'cycle_closed'
  /** Sale is voided but the unit no longer carries any return flag —
   *  a Wipe Returns, a manual edit, or a half-applied write. */
  | 'flags_cleared'
  /** No unit doc matches by unitId or IMEI — the unit was deleted, or the
   *  sale was imported without a link. */
  | 'orphan';

export const REASON_LABELS: Record<VoidedSaleReason, string> = {
  open_return:    'Counted on both screens',
  duplicate_sale: 'Second sale doc for the same unit',
  cycle_closed:   'Unit re-sold — return cycle closed',
  flags_cleared:  'Unit has no return flag any more',
  orphan:         'No matching unit',
};

export const REASON_DETAIL: Record<VoidedSaleReason, string> = {
  open_return:    'This return appears in the Returns ledger.',
  duplicate_sale: 'One return click voided every sale linked to this IMEI. The Sell chip counts sale docs, so it counts this twice; Returns counts the unit once.',
  cycle_closed:   'The unit was sold again after the return, so the Returns ledger drops it as a closed cycle. The voided sale stays in the audit trail.',
  flags_cleared:  'The sale is voided but the unit carries no returnType — check whether the return was reversed or the flags were wiped.',
  orphan:         'The voided sale points at no unit — deleted unit, or an imported sale with no IMEI/unitId link.',
};

export interface VoidedSaleRow {
  saleId: string;
  orderNumber: string;
  marketplace: string;
  imei: string;
  model: string;
  voidedAt: string;
  unitId?: string;
  reason: VoidedSaleReason;
}

export interface ReturnsReconciliation {
  /** What the Sell page chip shows. */
  voidedSaleCount: number;
  /** What the Returns page ALL RETURNS tile shows. */
  openReturnCount: number;
  /** voidedSaleCount − openReturnCount, explained row by row below. */
  gap: number;
  rows: VoidedSaleRow[];
  /** Rows that account for the gap — everything except 'open_return'. */
  unexplained: VoidedSaleRow[];
  /** The other direction: units in the ledger with no voided sale doc
   *  (in-app returns of units that were never sold through a Sale doc). */
  returnsWithoutVoidedSale: Array<{ unitId: string; imei: string; model: string; returnDate: string }>;
}

const norm = (s?: string) => (s || '').trim().toUpperCase();

/**
 * Diff the two counts and label every voided sale with the reason it does
 * or doesn't show up on the Returns page.
 */
export function reconcileReturns(units: InventoryUnit[], sales: Sale[]): ReturnsReconciliation {
  const byId = new Map(units.map(u => [u.id, u]));
  const byImei = new Map<string, InventoryUnit>();
  for (const u of units) {
    const k = norm(u.imei);
    if (k && !byImei.has(k)) byImei.set(k, u);
  }

  const events = buildVoidedSaleEvents(units, sales)
    .sort((a, b) => (a.voidedAt || '').localeCompare(b.voidedAt || ''));

  // Units already accounted for by an earlier event — the second sale doc
  // for the same unit is what inflates the Sell chip.
  const countedUnits = new Set<string>();
  const rows: VoidedSaleRow[] = [];

  for (const ev of events) {
    const s = ev.sale;
    const unit = (s.unitId ? byId.get(s.unitId) : undefined)
      ?? (norm(s.imei) ? byImei.get(norm(s.imei)) : undefined);

    let reason: VoidedSaleReason;
    if (!unit) {
      reason = 'orphan';
    } else if (countedUnits.has(unit.id)) {
      reason = 'duplicate_sale';
    } else if (isOpenReturnUnit(unit)) {
      reason = 'open_return';
      countedUnits.add(unit.id);
    } else if (unit.returnType) {
      reason = 'cycle_closed';
      countedUnits.add(unit.id);
    } else {
      reason = 'flags_cleared';
      countedUnits.add(unit.id);
    }

    rows.push({
      saleId: s.id,
      orderNumber: s.orderNumber || '—',
      marketplace: s.marketplace || '—',
      imei: s.imei || unit?.imei || '—',
      model: s.model || unit?.model || '—',
      voidedAt: ev.voidedAt,
      unitId: unit?.id,
      reason,
    });
  }

  const openReturns = units.filter(isOpenReturnUnit);
  const withVoidedSale = new Set(rows.filter(r => r.unitId).map(r => r.unitId as string));

  return {
    voidedSaleCount: rows.length,
    openReturnCount: openReturns.length,
    gap: rows.length - openReturns.length,
    rows,
    unexplained: rows.filter(r => r.reason !== 'open_return'),
    returnsWithoutVoidedSale: openReturns
      .filter(u => !withVoidedSale.has(u.id))
      .map(u => ({
        unitId: u.id,
        imei: u.imei || '—',
        model: u.model || '—',
        returnDate: u.returnDate || '—',
      })),
  };
}
