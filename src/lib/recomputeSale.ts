import type { Sale } from '../types';
import { calcSaleFinancials, getMarketplaceFee, isAccessorySale } from './platforms';

/**
 * Excel-style live recompute of every derived financial on a sale.
 * Sources: marketplace + buyPrice + salePrice + paymentMode + postage override.
 * Stored grossProfit / commission / marginalTax / etc. are ignored —
 * the helper always returns fresh values using current MARKETPLACE_FEES.
 *
 * Returns a `Sale` with the same id / provenance / metadata but freshly
 * computed financial fields. Callers should treat this as the source of
 * truth for UI display; the stored values are a denormalised cache only.
 */
export function recomputeSale(s: Sale): Sale {
  // BM PayPal/Klarna detection — case-insensitive, covers the four label
  // variants ops uses in the master sheet (Paypal / Klarna / Clear Pay / Apple Pay).
  const hasPayPalKlarna = /paypal|klarna|clearpay|clear pay|applepay/i.test(s.paymentMode || '');

  // Only pass postageOverride when the stored postage genuinely diverges from
  // the marketplace default (>1p). Otherwise let calcSaleFinancials fall back
  // to fee.postage so it stays in sync with future MARKETPLACE_FEES edits.
  const defaultPostage = getMarketplaceFee(s.marketplace).postage;
  const postageOverride =
    typeof s.postage === 'number' && Math.abs(s.postage - defaultPostage) > 0.01
      ? s.postage
      : undefined;

  // eBay shipping tiers: 1 / 2 / 8 are first-class tier inputs to the helper.
  // Anything else (e.g. £5.50 free-shipping override) falls through as
  // postageOverride above.
  let eBayShippingTier: 1 | 2 | 8 | undefined;
  if (s.marketplace === 'EBAY' && (s.postage === 1 || s.postage === 2 || s.postage === 8)) {
    eBayShippingTier = s.postage as 1 | 2 | 8;
  }

  const fresh = calcSaleFinancials({
    marketplace: s.marketplace,
    buyPrice: s.buyPrice,
    salePrice: s.salePrice,
    postageOverride,
    eBayShippingTier,
    hasPayPalKlarna,
    // Operator INPUTS, not derived money — a recompute must carry these
    // forward or it silently rewrites what the operator entered. Marketing
    // is the real eBay promo spend, postageVat the sheet's own P. VAT cell
    // (eBay never derives it), and postageVatExempt the zero-rated-shipping
    // flag, which until now was dropped on every recompute and quietly
    // put the VAT back on.
    marketing: s.marketing,
    postageVatOverride: s.postageVat,
    marketingVatOverride: s.marketingVat,
    postageVatExempt: s.postageVatExempt,
    // Temu reports its real per-order commission rather than a derivable
    // rate; the same reasoning applies. Commission VAT is not carried — it
    // is always 20% of commission, so it recomputes.
    commissionOverride: s.marketplace === 'TEMU' ? s.commission : undefined,
    // The £1 accessoryFee is the box and charger that ships WITH A PHONE, so
    // a standalone charger or screen protector must not be charged for one.
    isAccessory: isAccessorySale(s),
  });

  // Guard: calcSaleFinancials should always return a value now that a default
  // case exists, but keep this safety net for any edge case (e.g. a future
  // TypeScript narrowing change or a mocked environment in tests).
  if (!fresh) return s;

  // Replace all derived fields on the returned Sale with the freshly
  // computed ones. Identity / provenance / metadata are untouched.
  return {
    ...s,
    spMinusBp: fresh.spMinusBp,
    marginalTax: fresh.marginalTax,
    commission: fresh.commission,
    payPalKlarnaCom: fresh.payPalKlarnaCom,
    rof: fresh.rof,
    fvf: fresh.fvf,
    twentyPercent: fresh.twentyPercent,
    totalCom: fresh.totalCom,
    vat20: fresh.vat20,
    marVat: fresh.marVat,
    // The per-line VAT / fee breakdown used to be left at whatever was
    // stored, so a fee change moved grossProfit but not the columns it was
    // computed from — the workbook then showed a GP that its own fee lines
    // didn't add up to. Refresh the whole set.
    commissionVat: fresh.commissionVat,
    dsf: fresh.dsf,
    dsfVat: fresh.dsfVat,
    postageVat: fresh.postageVat,
    marketing: fresh.marketing,
    marketingVat: fresh.marketingVat,
    customerCareFees: fresh.customerCareFees,
    accessoryFee: fresh.accessoryFee,
    totalVat: fresh.totalVat,
    totalVatNtp: fresh.totalVatNtp,
    postage: fresh.postage,
    grossProfit: fresh.grossProfit,
    gpPercent: fresh.gpPercent,
    netProfit: fresh.netProfit,
  };
}

/**
 * Bulk variant — maps a list of sales through recomputeSale().
 */
export function recomputeSales(list: Sale[]): Sale[] {
  return list.map(recomputeSale);
}
