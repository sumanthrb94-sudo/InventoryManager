import type { Sale } from '../types';
import { calcSaleFinancials } from './platforms';

/**
 * Excel-style live recompute of every derived financial on a sale, matching
 * the client SALES_REPORT_2026_1.xlsx formulas exactly (see calcSaleFinancials
 * for the per-marketplace spec). Stored grossProfit / commission / VAT
 * components are ignored — this helper always returns fresh values.
 *
 * Returns a `Sale` with the same id / provenance / metadata but freshly
 * computed financial fields. Treat as the source of truth for UI display;
 * the persisted values are a denormalised cache.
 */
export function recomputeSale(s: Sale): Sale {
  const fresh = calcSaleFinancials({
    marketplace: s.marketplace,
    buyPrice: s.buyPrice,
    salePrice: s.salePrice,
    postage: s.postage,
    postageVatExempt: s.postageVatExempt,
    accessories: s.accessories,
  });
  return { ...s, ...fresh };
}

/** Bulk variant. */
export function recomputeSales(list: Sale[]): Sale[] {
  return list.map(recomputeSale);
}
