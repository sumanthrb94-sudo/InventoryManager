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
import { MARKETPLACE_COLUMNS, LEADING_COLUMNS, QUANTITY_HEADER } from '../../lib/bulkSaleColumns';
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

describe('IMEI and quantity are separate columns, named as each sheet names them', () => {
  it('gives IMEI its own column, on every sheet and in the grid', () => {
    // They were once merged into one "IMEI / Qty" cell. Every sheet carries
    // IMEI separately, so a merged cell has no column to reconcile against.
    expect(LEADING_COLUMNS).toContain('IMEI');
    expect(LEADING_COLUMNS).not.toContain('IMEI / Qty');
    for (const m of MARKETPLACES) expect(headersFor(m)).toContain('IMEI');
  });

  it.each(MARKETPLACES)('%s calls its quantity column what its sheet calls it', (m: Marketplace) => {
    const header = QUANTITY_HEADER[m];
    if (header === null) {
      // OnBuy genuinely has none — its headers shift one left, which is why
      // its formulas reference different letters for the same value.
      expect(['Quantity', 'Units'].some(h => headersFor(m).includes(h))).toBe(false);
    } else {
      expect(headersFor(m)).toContain(header);
    }
  });

  it('is not just calling them all Quantity', () => {
    expect(QUANTITY_HEADER.EBAY).toBe('Units');
    expect(QUANTITY_HEADER.AMAZON).toBe('Quantity');
    expect(QUANTITY_HEADER.ONBUY).toBeNull();
  });

  it('the quantity column sits between IMEI/Supplier and BP, as on the sheets', () => {
    for (const m of MARKETPLACES) {
      const header = QUANTITY_HEADER[m];
      if (header === null) continue;
      const h = headersFor(m);
      expect(h.indexOf(header)).toBeGreaterThan(h.indexOf('IMEI'));
      expect(h.indexOf(header)).toBeLessThan(h.indexOf('BP'));
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
