/**
 * What the marketplace keeps when a sale is refunded.
 *
 * Voiding a sale hides it from every revenue surface, which silently models
 * the refund as if the channel gave every fee back. The operator pulled the
 * real statements, and the two fixtures below ARE those statements — an
 * Amazon settlement and an eBay transaction page, figure for figure. If
 * either test drifts from the screenshots it is the model that is wrong,
 * not the test.
 */
import { describe, it, expect } from 'vitest';
import { feeLossOnRefund, returnCostFor } from '../../lib/returnLoss';
import { calcSaleFinancials } from '../../lib/platforms';
import type { InventoryUnit, Sale } from '../../types';

const refunded = (over: Partial<Sale>): Sale => ({
  id: 's1', marketplace: 'AMAZON', orderNumber: 'X', imei: '350000000000001',
  saleDate: '2026-08-01', salePrice: 0, buyPrice: 0, commission: 0,
  voidedAt: '2026-08-04T00:00:00Z', voidOutcome: 'refund',
  gpBasis: 'returns_v2', customerRefunded: true,
  ...over,
} as Sale);

describe('AMAZON — order 203-5323406-8518721, from the settlement page', () => {
  // SP £308. Commission £21.56 (7%), its VAT £4.32, DSF £0.43, DSF VAT £0.09
  // — £26.40 of fees on the sale. On refund Amazon credited them back minus
  // a refund administration fee: min(20% × £21.56, £5.00) = £4.31, +£0.86
  // VAT = £5.17. Sale netted +£281.60, refund netted −£286.77 — the £5.17
  // between them is exactly this fee.
  it('keeps £5.17 — the admin fee plus VAT, nothing else', () => {
    const s = refunded({ marketplace: 'AMAZON', salePrice: 308, commission: 21.56 });
    expect(feeLossOnRefund(s)).toBeCloseTo(5.17, 2);
  });

  it('caps the admin fee at £5.00 (+VAT) on a big-ticket order', () => {
    // 20% of the fees on a £900 handset would be £12.60; Amazon's cap says
    // £5.00, so the loss is £6.00 with VAT — not £15.12.
    const s = refunded({ marketplace: 'AMAZON', salePrice: 900, commission: 63.00 });
    expect(feeLossOnRefund(s)).toBeCloseTo(6.00, 2);
  });
});

describe('EBAY — order 11-14953-45167, from the transactions page', () => {
  // A32 sold £84.99. Fees on sale £7.18: variable FVF £5.28 (6.9% − 10%
  // top-rated), fixed per-order £0.40, ROF £0.30, +£1.20 VAT. On refund eBay
  // credited £6.70 — the variable FVF and ROF with their VAT — and kept the
  // fixed £0.40 and its £0.08. This settles the parked "£0.40 FVF" question.
  it('keeps £0.48 — the fixed order fee plus VAT', () => {
    const s = refunded({ marketplace: 'EBAY', salePrice: 84.99, commission: 5.28 });
    expect(feeLossOnRefund(s)).toBeCloseTo(0.48, 2);
    // Cross-check the credited side: fees paid minus kept must equal the
    // £6.70 eBay actually returned.
    expect(7.18 - feeLossOnRefund(s)).toBeCloseTo(6.70, 2);
  });

  it('is flat — the loss does not grow with the sale price', () => {
    const cheap = refunded({ marketplace: 'EBAY', salePrice: 30, commission: 1.86 });
    const dear = refunded({ marketplace: 'EBAY', salePrice: 600, commission: 37.26 });
    expect(feeLossOnRefund(cheap)).toBeCloseTo(feeLossOnRefund(dear), 10);
  });
});

describe('BM / ONBUY / TEMU — "DOES NOT REFUND"', () => {
  it('BM keeps everything: commission, customer care, PSF, payment fee', () => {
    const s = refunded({
      marketplace: 'BM', salePrice: 120,
      commission: 13.20, customerCareFees: 8.99, psf: 1.20, payPalKlarnaCom: 0.60,
    });
    expect(feeLossOnRefund(s)).toBeCloseTo(13.20 + 8.99 + 1.20 + 0.60, 2);
  });

  it('ONBUY keeps commission and its VAT', () => {
    const s = refunded({ marketplace: 'ONBUY', salePrice: 150, commission: 10.50, vat20: 2.10 });
    expect(feeLossOnRefund(s)).toBeCloseTo(12.60, 2);
  });

  it('TEMU keeps commission and its VAT', () => {
    // 3.96% — the corrected rate — with its 20% VAT.
    const s = refunded({ marketplace: 'TEMU', salePrice: 106.82, commission: 4.23, commissionVat: 0.85 });
    expect(feeLossOnRefund(s)).toBeCloseTo(5.08, 2);
  });

  /** The stored figure wins over today's schedule: a sale imported under the
   *  old 4.61% Temu rate loses what it was actually charged, not what the
   *  current 3.96% would have been. */
  it('loses what was CHARGED, not what today’s rate says', () => {
    const old = refunded({ marketplace: 'TEMU', saleDate: '2026-07-01', commission: 4.61, commissionVat: 0.92 });
    expect(feeLossOnRefund(old)).toBeCloseTo(5.53, 2);
  });
});

describe('when no refund happened, no fee is lost', () => {
  it('an active sale charges nothing', () => {
    expect(feeLossOnRefund(refunded({ voidedAt: undefined as any }))).toBe(0);
  });

  /** A replacement keeps the buyer's money — no refund transaction reaches
   *  the marketplace, so there is no fee credit and no admin fee. The fees
   *  stand against a sale whose GP also stands and already subtracts them;
   *  charging them here would count them twice. */
  it('a replacement charges nothing', () => {
    const s = refunded({
      marketplace: 'BM', commission: 13.20, customerCareFees: 8.99,
      voidOutcome: 'replacement', customerRefunded: false,
    });
    expect(feeLossOnRefund(s)).toBe(0);
  });

  it('an out-of-warranty repair (revenue kept) charges nothing', () => {
    const s = refunded({
      marketplace: 'AMAZON', commission: 21.56,
      voidOutcome: 'repair', customerRefunded: false,
    });
    expect(feeLossOnRefund(s)).toBe(0);
  });

  it('an in-warranty repair (customer refunded) charges like a refund', () => {
    const s = refunded({
      marketplace: 'AMAZON', commission: 21.56,
      voidOutcome: 'repair', customerRefunded: true,
    });
    expect(feeLossOnRefund(s)).toBeCloseTo(5.17, 2);
  });
});

describe('the fee loss flows into the return cost breakdown', () => {
  const unit = {
    id: 'u1', imei: '350000000000001', model: 'Galaxy S22 Ultra',
    status: 'returned', returnType: 'returned_to_inventory',
    returnDate: '2026-08-04', returnLegCost: 10,
  } as unknown as InventoryUnit;

  it('returnCostFor adds fees to the total', () => {
    const s = refunded({ marketplace: 'AMAZON', salePrice: 308, commission: 21.56 });
    const c = returnCostFor(unit, s);
    expect(c.fees).toBeCloseTo(5.17, 2);
    // refund = 2 legs × £10 snapshot + the fee.
    expect(c.total).toBeCloseTo(20 + 5.17, 2);
  });
});

describe('the model agrees with calcSaleFinancials about what was charged', () => {
  /** The fixtures above hand-feed the fee fields. These derive them the way
   *  the app does, so a drift between the two — a renamed output field, a
   *  changed rate — shows up here rather than in an operator's
   *  reconciliation. A rename would not error: the loss would silently
   *  shrink, which is exactly the failure this block exists to catch. */
  it('Amazon at 7%: a £308 sale computes the same £5.17', () => {
    const fin = calcSaleFinancials({ marketplace: 'AMAZON', buyPrice: 250, salePrice: 308 });
    expect(fin.commission).toBeCloseTo(21.56, 2);
    const s = refunded({ marketplace: 'AMAZON', salePrice: 308, commission: fin.commission });
    expect(feeLossOnRefund(s)).toBeCloseTo(5.17, 2);
  });

  /** The operator's rule for these three, verbatim: "they don't even refund a
   *  penny on the marketplace fees or the things that they collected". So on
   *  each, the loss must equal the SUM of every fee line the pipeline
   *  produced — not a subset, not a recomputation. */
  it('BM: every collected fee is lost — commission, customer care, PSF', () => {
    const fin = calcSaleFinancials({ marketplace: 'BM', buyPrice: 100, salePrice: 150 });
    // The current BM schema's full charge set. commission 11% = £16.50,
    // customer care £8.99 flat, PSF 1% = £1.50.
    const everything = (fin.commission ?? 0) + (fin.customerCareFees ?? 0) + (fin.psf ?? 0);
    expect(everything).toBeCloseTo(26.99, 2);
    const s = refunded({ marketplace: 'BM', salePrice: 150, ...fin });
    expect(feeLossOnRefund(s)).toBeCloseTo(everything, 2);
  });

  it('ONBUY: commission and its VAT are both lost', () => {
    const fin = calcSaleFinancials({ marketplace: 'ONBUY', buyPrice: 100, salePrice: 150 });
    const everything = (fin.commission ?? 0) + (fin.vat20 ?? 0);
    expect(everything).toBeCloseTo(12.60, 2);   // 7% + 20% VAT on it
    const s = refunded({ marketplace: 'ONBUY', salePrice: 150, ...fin });
    expect(feeLossOnRefund(s)).toBeCloseTo(everything, 2);
  });

  it('TEMU: commission and its VAT are both lost', () => {
    const fin = calcSaleFinancials({ marketplace: 'TEMU', buyPrice: 100, salePrice: 150 });
    const everything = (fin.commission ?? 0) + (fin.commissionVat ?? 0);
    expect(everything).toBeCloseTo(7.13, 2);    // 3.96% + 20% VAT on it
    const s = refunded({ marketplace: 'TEMU', salePrice: 150, ...fin });
    expect(feeLossOnRefund(s)).toBeCloseTo(everything, 2);
  });
});

describe('a replacement charges nothing WHATEVER its era', () => {
  /** saleKeptItsRevenue only recognises returns stamped gpBasis='returns_v2'
   *  — the operator's from-today-onward cutoff for the REVENUE treatment. A
   *  legacy replacement fell through it and was billed fees for a refund
   *  that never reached the marketplace. The outcome knows better than the
   *  stamp. Operator, 2026-08-29: "keep only return and refunds … not for
   *  any replacement". */
  it('a LEGACY replacement (no gpBasis stamp) still charges nothing', () => {
    const s = refunded({
      marketplace: 'EBAY', commission: 5.28,
      voidOutcome: 'replacement',
      gpBasis: undefined as any, customerRefunded: undefined as any,
    });
    expect(feeLossOnRefund(s)).toBe(0);
  });
});
