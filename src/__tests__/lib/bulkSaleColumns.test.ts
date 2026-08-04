/**
 * The Mark Multiple Sold grid claims to be the Sales Report's own sheet for
 * each marketplace. This is what makes that claim checkable.
 *
 * The failure it prevents is quiet and expensive: someone renames a column on
 * a report tab, or inserts one, and the entry grid goes on showing the old
 * name. The operator then reconciles a grid column against a statement line
 * that no longer corresponds to it, and nothing anywhere errors.
 *
 * So: every grid column must exist on that marketplace's sheet, spelled the
 * same, and appear in the same relative order. And every computed column must
 * name a field the calculator actually returns — a typo in `field` would
 * render an empty cell forever without any other test noticing.
 */
import { describe, it, expect } from 'vitest';
import { MARKETPLACE_COLUMNS } from '../../lib/bulkSaleColumns';
import { SALES_HEADERS } from '../../lib/clientReport';
import { calcSaleFinancials } from '../../lib/platforms';
import { MARKETPLACES } from '../../types';
import type { Marketplace } from '../../types';

const headersFor = (m: Marketplace) => SALES_HEADERS[m] as readonly string[];

describe.each(MARKETPLACES)('%s', (m: Marketplace) => {
  const cols = MARKETPLACE_COLUMNS[m];

  it('shows only columns this marketplace\'s sheet actually has', () => {
    const missing = cols.map(c => c.header).filter(h => !headersFor(m).includes(h));
    expect(missing, `not on the ${m} sheet`).toEqual([]);
  });

  it('shows them in the sheet\'s own order', () => {
    const positions = cols.map(c => headersFor(m).indexOf(c.header));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('starts where the sheet\'s computed columns start, right after SP', () => {
    // If this drifts, the grid has either grown a leading column the sheet
    // puts elsewhere, or lost the first fee column.
    expect(cols[0].header).toBe('SP-BP');
    expect(headersFor(m).indexOf('SP-BP')).toBe(headersFor(m).indexOf('SP') + 1);
  });

  it('every computed column names a field the calculator returns', () => {
    const fin = calcSaleFinancials({
      marketplace: m, buyPrice: 200, salePrice: 400,
      postageOverride: 6.3, marketing: 5,
    });
    for (const c of cols) {
      if (!c.field) continue;
      expect(typeof fin[c.field], `${m}.${c.header} → ${String(c.field)}`).toBe('number');
    }
  });

  it('carries Postage as something the operator types, not a derivation', () => {
    // Postage is overridden per sale on every marketplace — free shipping, an
    // eBay tier, a heavier parcel. A computed-only Postage column would make
    // the whole row wrong for any sale that wasn't the default.
    const postage = cols.find(c => c.header === 'Postage');
    expect(postage?.input).toBe('postage');
  });

  it('never offers to type a column the sheet derives', () => {
    // The inverse of the above: an entry column whose value the report writes
    // as a formula would let the operator enter a number Excel then overwrites.
    for (const c of cols) {
      if (!c.input) continue;
      expect(['Postage', 'Marketing'], `${m}: ${c.header} is not operator-entered`)
        .toContain(c.header);
    }
  });
});

describe('the differences between marketplaces are the real ones', () => {
  const headersOf = (m: Marketplace) => MARKETPLACE_COLUMNS[m].map(c => c.header);

  it('gives Amazon its DSF lines, which no other marketplace charges', () => {
    expect(headersOf('AMAZON')).toEqual(expect.arrayContaining(['DSF', 'DSF. VAT', 'C. VAT']));
    for (const m of ['BM', 'EBAY', 'ONBUY', 'TEMU'] as Marketplace[]) {
      expect(headersOf(m)).not.toContain('DSF');
    }
  });

  it('gives eBay its fee breakdown and its per-line marketing spend', () => {
    expect(headersOf('EBAY')).toEqual(
      expect.arrayContaining(['ROF', 'FVF', 'VAT', 'T.COM', 'Marketing', 'M. VAT']));
    // Marketing is eBay's alone — it is the only marketplace whose sheet has
    // the column at all.
    for (const m of ['AMAZON', 'BM', 'ONBUY', 'TEMU'] as Marketplace[]) {
      expect(headersOf(m)).not.toContain('Marketing');
    }
  });

  it('gives Back Market its flat customer-care fee, and no Total VAT line', () => {
    expect(headersOf('BM')).toContain('Customer Care Fees');
    // Back Market's sheet genuinely has no Total VAT column — the grid must
    // not invent one, or the tab stops matching the report.
    expect(headersFor('BM')).not.toContain('Total VAT');
    expect(headersOf('BM')).not.toContain('Total VAT');
  });

  it('gives OnBuy its single VAT 20% and Temu its own Commission VAT', () => {
    expect(headersOf('ONBUY')).toContain('VAT 20%');
    expect(headersOf('TEMU')).toContain('Commission VAT');
    expect(headersOf('ONBUY')).not.toContain('Commission VAT');
  });

  it('agrees with nobody by accident — no two marketplaces share a layout', () => {
    const seen = new Map<string, Marketplace>();
    for (const m of MARKETPLACES) {
      const key = headersOf(m).join('|');
      expect(seen.has(key), `${m} has the same layout as ${seen.get(key)}`).toBe(false);
      seen.set(key, m);
    }
  });
});
