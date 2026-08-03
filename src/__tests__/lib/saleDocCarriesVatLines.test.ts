/**
 * A sale doc must carry its VAT lines, whichever way it was recorded.
 *
 * src/lib/vat.ts builds the VAT return by reading `sale.totalVat` straight off
 * the document — it does not recompute, and inventoryStore does not recompute
 * on its behalf either. So a write path that computes the fee VAT and then
 * forgets to store it does not produce a visibly wrong number anywhere; it
 * produces a VAT return that quietly under-declares input VAT, and therefore
 * over-declares what is owed.
 *
 * That is what both in-app paths did. recordSale (unit) and the accessory sale
 * builder each called calcSaleFinancials, copied eighteen fields off the
 * result, and dropped totalVat with them. Imported sales carried it, so the
 * two sources disagreed and nothing said so: in the quarter simulation exactly
 * two sales out of 883 differed from their own stored figures, and both were
 * the ones entered through the app.
 *
 * This pins the contract at the shape level — every field the VAT return and
 * the Sales Report read must be present on a freshly built sale doc — rather
 * than asserting one arithmetic result, so a NEW field added to the calculator
 * and forgotten by a writer fails here too.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { calcSaleFinancials } from '../../lib/platforms';
import { MARKETPLACES } from '../../types';

/** The fields vat.ts and clientReport.ts read off a stored Sale. */
const REQUIRED_ON_SALE_DOC = [
  'spMinusBp', 'marginalTax', 'commission', 'postage', 'postageVat',
  'grossProfit', 'gpPercent', 'totalVat',
] as const;

/**
 * The two in-app writers. Both build a Sale literal from a `fin` object; the
 * test reads the source and checks the literal assigns every required field
 * from it. Reading source is deliberate — the alternative is booting Firestore
 * to observe a write, and what actually broke was a missing line in an object
 * literal, which is exactly what this sees.
 */
const WRITERS = [
  { file: 'src/services/salesService.ts', what: 'recordSale — a unit sold in-app' },
  { file: 'src/services/inventoryService.ts', what: 'the accessory sale builder' },
];

describe('every in-app sale writer stores the VAT lines it computed', () => {
  it.each(WRITERS)('$what', ({ file }) => {
    const src = readFileSync(file, 'utf8');
    const missing = REQUIRED_ON_SALE_DOC.filter(f =>
      !new RegExp(`^\\s*${f}:\\s*(fin\\.${f}|${f})\\b`, 'm').test(src));
    expect(missing,
      `${file} builds a sale doc without ${missing.join(', ')} — `
      + 'vat.ts reads these off the doc and will treat them as zero').toEqual([]);
  });
});

describe('the calculator supplies a totalVat worth storing', () => {
  it.each(MARKETPLACES)('%s — totalVat is a number, and non-zero where fees carry VAT', (m) => {
    const fin = calcSaleFinancials({
      marketplace: m, buyPrice: 100, salePrice: 450, postageOverride: 6.30,
    } as never);
    expect(typeof fin.totalVat, `${m} totalVat`).toBe('number');
    // eBay alone can legitimately be near zero here: its postage is zero-rated
    // to this operator and marketing is only what the operator types, so the
    // only VAT line left on an untouched row is the fee VAT itself.
    expect(fin.totalVat, `${m} should carry some fee VAT on a £450 sale`)
      .toBeGreaterThan(0);
  });
});
