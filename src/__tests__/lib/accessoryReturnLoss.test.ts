/**
 * What a returned accessory actually costs — worked through the operator's
 * own case: three tempered glasses sold on one eBay order, broken in transit,
 * returned as a refund.
 *
 * The question was "how is the loss calculated here", and the answer has three
 * separate parts that are easy to conflate:
 *
 *   1. The REVENUE. Voiding the sale removes it outright — it stops counting
 *      as a sale and its whole margin leaves the books. It is not "margin
 *      minus something".
 *   2. The POSTAGE LOSS. Carriage was paid on a parcel that earned nothing:
 *      (postage + postage VAT) × shipping legs. This is the only figure that
 *      survives the void, and it is a real out-of-pocket cost.
 *   3. The STOCK. The sale's own quantity goes back into the pool.
 *
 * The postage loss is charged PER PARCEL, not per item, which is why three
 * glasses and one charger both cost £6.00. That is not a rounding artefact —
 * carriage is priced per parcel, and three items in one box is one outbound
 * and one inbound leg however many are inside.
 */
import { describe, it, expect } from 'vitest';
import { postageLossFor, shippingLegsFor } from '../../lib/clientReport';
import type { Sale } from '../../types';

/** The operator's eBay order: 3 × TEMPERED-GLASS-IP13, £2.50 carriage. */
const glassSale = (over: Partial<Sale> = {}): Sale => ({
  id: 'EBAY__EB-ACC-1__TEMPERED-GLASS-IP13',
  marketplace: 'EBAY', orderNumber: 'EB-ACC-1',
  sku: 'TEMPERED-GLASS-IP13', quantity: 3,
  buyPrice: 3.3, salePrice: 17.97, postage: 2.5,
  saleDate: '2026-07-20', grossProfit: 6.1,
  ...over,
} as Sale);

describe('a broken-in-transit accessory return', () => {
  it('costs nothing until it is actually returned', () => {
    expect(postageLossFor(glassSale())).toBe(0);
    expect(shippingLegsFor(glassSale())).toBe(0);
  });

  it('costs both carriage legs on a refund — out and back', () => {
    const returned = glassSale({
      voidedAt: '2026-08-05', voidOutcome: 'refund', voidReason: 'Broken in transit',
    });
    // (2.50 postage + 0.50 VAT) x 2 legs
    expect(shippingLegsFor(returned)).toBe(2);
    expect(postageLossFor(returned)).toBeCloseTo(6.00, 2);
  });

  it('charges per PARCEL, not per item — three glasses cost the same as one', () => {
    // The operator's screenshot shows qty 3 and qty 1 both at £6.00 and asked
    // why. Because carriage is priced per parcel: three in one box is still
    // one journey out and one back.
    const three = glassSale({ quantity: 3, voidedAt: '2026-08-05', voidOutcome: 'refund' });
    const one   = glassSale({ quantity: 1, voidedAt: '2026-08-05', voidOutcome: 'refund' });
    expect(postageLossFor(three)).toBe(postageLossFor(one));
    expect(postageLossFor(three), 'not 3 x 6.00').not.toBeCloseTo(18, 2);
  });

  it('costs a third leg on a replacement, because something goes back out', () => {
    const replaced = glassSale({ voidedAt: '2026-08-05', voidOutcome: 'replacement' });
    expect(shippingLegsFor(replaced)).toBe(3);
    expect(postageLossFor(replaced)).toBeCloseTo(9.00, 2);
  });

  it('uses the postage VAT actually recorded, not always a flat 20%', () => {
    // The 20% is a fallback for rows that predate the VAT lines being stored.
    const stored = glassSale({
      postage: 2.5, postageVat: 0.30,
      voidedAt: '2026-08-05', voidOutcome: 'refund',
    });
    expect(postageLossFor(stored), '(2.50 + 0.30) x 2').toBeCloseTo(5.60, 2);
  });

  it('drops the VAT half when the carriage was zero-rated', () => {
    const exempt = glassSale({
      postage: 2.5, postageVatExempt: true,
      voidedAt: '2026-08-05', voidOutcome: 'refund',
    });
    expect(postageLossFor(exempt), 'carriage only, no VAT').toBeCloseTo(5.00, 2);
  });

  it('costs nothing extra when the order shipped free', () => {
    const free = glassSale({ postage: 0, voidedAt: '2026-08-05', voidOutcome: 'refund' });
    expect(postageLossFor(free)).toBe(0);
  });

  it('is the SAME rule a phone return uses — accessories are not a special case', () => {
    // returnAccessoryStock voids the real Sale doc rather than just bumping
    // the pool, which is what makes the report treat both identically.
    const phone = {
      id: 'AMAZON__AMZ-1__350000000000001', marketplace: 'AMAZON',
      orderNumber: 'AMZ-1', imei: '350000000000001', quantity: 1,
      buyPrice: 200, salePrice: 320, postage: 2.5,
      voidedAt: '2026-08-05', voidOutcome: 'refund',
    } as Sale;
    const accessory = glassSale({ voidedAt: '2026-08-05', voidOutcome: 'refund' });
    expect(postageLossFor(accessory)).toBe(postageLossFor(phone));
  });
});
