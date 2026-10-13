/**
 * importStockGate.ts — "was this phone ever ours to sell?"
 *
 * Asked of every sold IMEI in a Sales Report upload, before anything is
 * written. Born of the 12-Oct upload: 85 sales, office stock fell by only 63,
 * because 22 sold IMEIs were not in stock. The importer quietly created each
 * one as an already-sold unit, so nothing came off the shelf count and nobody
 * was told. Of the 22, 20 had never been stocked in at all and 2 had been
 * deleted as "QC Fail - RTS (Return to Supplier)" days earlier — a phone the
 * business had sent back, appearing on a marketplace order.
 *
 * Three answers worth stopping for:
 *
 *   rts          — returned to supplier: either a stock record still carrying
 *                  returnType 'returned_to_supplier', or a deletion whose
 *                  reason says RTS / return to supplier. Selling it means the
 *                  wrong handset went back, or the wrong IMEI is on the order.
 *   deleted      — removed from inventory for any other reason (QC fail,
 *                  scrapped, duplicate). Same question, different paperwork.
 *   not_in_stock — the IMEI has never been in inventory. Sold without being
 *                  stocked in, so office stock never counted it.
 *
 * Pure: the caller supplies the archive lookups (deletedUnitLookup does the
 * point queries and caching) so this stays testable without Firestore.
 */
import type { DeletedUnitRecord, InventoryUnit, Marketplace } from '../types';
import { normaliseImeiKey } from './imeiValidation';
import { describeDeletion, formatDeletionDate } from './deletedUnitLookup';

export type StockGateKind = 'rts' | 'deleted' | 'not_in_stock';

export interface StockGateRow {
  saleId: string;
  imei: string;
  marketplace: Marketplace;
  orderNumber: string;
  saleDate: string;
  /** Best name available: the stock/archive record's model, else the sale's. */
  model: string;
  kind: StockGateKind;
  /** One line the operator can act on. */
  detail: string;
}

/** Shape of a parsed sale this module needs — a subset of ParsedSales rows. */
export interface StockGateSale {
  id: string;
  imei?: string;
  marketplace: Marketplace;
  orderNumber?: string;
  saleDate?: string;
  model?: string;
  sku?: string;
  voidedAt?: string;
}

/** Reasons are free text ("QC Fail - RTS (Return to Supplier)", "rts",
 *  "returned to supplier"), so match the meaning, not one spelling. */
export function isRtsReason(reason: string | undefined | null): boolean {
  const r = (reason || '').toLowerCase();
  return /\brts\b/.test(r) || /return(ed)?\s*(back\s*)?to\s*supplier/.test(r);
}

/** IMEIs in this upload that match no stock record — the only ones worth
 *  asking the deleted archive about. Saves a read per in-stock IMEI. */
export function imeisToLookUp(sales: StockGateSale[], units: InventoryUnit[]): string[] {
  const known = new Set(units.map(u => normaliseImeiKey(u.imei)).filter(Boolean));
  const out = new Set<string>();
  for (const s of sales) {
    if (s.voidedAt) continue;
    const k = normaliseImeiKey(s.imei);
    if (k && !known.has(k)) out.add(k);
  }
  return [...out];
}

/**
 * Every non-voided sold IMEI in the upload that was not sellable stock, worst
 * first (RTS, then deleted, then never stocked in). One row per IMEI.
 */
export function classifyStockGate(
  sales: StockGateSale[],
  units: InventoryUnit[],
  deletedByImei: Map<string, DeletedUnitRecord>,
): StockGateRow[] {
  const unitsByImei = new Map<string, InventoryUnit>();
  for (const u of units) {
    const k = normaliseImeiKey(u.imei);
    if (k && !unitsByImei.has(k)) unitsByImei.set(k, u);
  }

  const rows: StockGateRow[] = [];
  const seen = new Set<string>();
  for (const s of sales) {
    if (s.voidedAt) continue;
    const key = normaliseImeiKey(s.imei);
    if (!key || seen.has(key)) continue;
    seen.add(key);

    const base = {
      saleId: s.id,
      imei: key,
      marketplace: s.marketplace,
      orderNumber: s.orderNumber || '',
      saleDate: s.saleDate || '',
    };
    const unit = unitsByImei.get(key);

    if (unit) {
      // In the database. Only a live RTS record is a problem: the phone is
      // with the supplier, yet here it is being sold. A sale dated on or
      // before the return is the history that LED to the return (sold,
      // came back, sent to supplier) — re-importing it is not a new event.
      const rtsLive = unit.returnType === 'returned_to_supplier' && unit.status !== 'sold';
      const saleIsHistory = !!(unit.returnDate && s.saleDate && s.saleDate <= unit.returnDate);
      if (rtsLive && !saleIsHistory) {
        rows.push({
          ...base,
          model: unit.model || s.model || s.sku || '',
          kind: 'rts',
          detail: `Returned to supplier${unit.supplierName ? ` (${unit.supplierName})` : ''}`
            + `${unit.returnDate ? ` on ${formatDeletionDate(unit.returnDate)}` : ''} — still with the supplier`,
        });
      }
      continue;
    }

    const del = deletedByImei.get(key);
    if (del) {
      rows.push({
        ...base,
        model: del.model || s.model || s.sku || '',
        kind: isRtsReason(del.reason) ? 'rts' : 'deleted',
        detail: describeDeletion(del),
      });
      continue;
    }

    rows.push({
      ...base,
      model: s.model || s.sku || '',
      kind: 'not_in_stock',
      detail: 'Never stocked in — this IMEI has no inventory record',
    });
  }

  const order: Record<StockGateKind, number> = { rts: 0, deleted: 1, not_in_stock: 2 };
  return rows.sort((a, b) => order[a.kind] - order[b.kind]);
}
