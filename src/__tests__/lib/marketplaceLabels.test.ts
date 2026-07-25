/**
 * Marketplace label resolution — the bug a live screenshot found.
 *
 * The Analytics Platform Scorecard compared `unit.salePlatform` directly
 * against `['eBay', 'Amazon', 'OnBuy', 'Backmarket']`. But `salePlatform` is
 * written as `sale.marketplace`, which holds the canonical codes — 'AMAZON',
 * 'BM', 'EBAY', 'ONBUY'. 'AMAZON' !== 'Amazon', and 'BM' is not 'Backmarket'
 * under any casing rule, so NOTHING ever matched.
 *
 * On a live system with 354 imported sales the scorecard read zero units on
 * all four platforms, and every marketplace looked equally dead. The figure
 * was not wrong by a little; it was structurally incapable of being right.
 *
 * The translation already existed, written by hand, in ReportingPage and in
 * Suppliers. Analytics had its own third version that omitted it. That is
 * the actual defect — one fact, three copies, one of them wrong — so it now
 * lives in exactly one module.
 */
import { describe, it, expect } from 'vitest';
import {
  MARKETPLACE_LABEL, MARKETPLACE_LABELS, marketplaceOf, isMarketplace, labelFor,
} from '../../lib/marketplaceLabels';
import { MARKETPLACES } from '../../types';

describe('the canonical codes an imported sale writes', () => {
  it.each([
    ['AMAZON', 'AMAZON'],
    ['BM', 'BM'],
    ['EBAY', 'EBAY'],
    ['ONBUY', 'ONBUY'],
  ])('%s resolves', (stored, expected) => {
    expect(marketplaceOf(stored)).toBe(expected);
  });

  it('resolves BM, which no casing rule could ever turn into Backmarket', () => {
    // The single value that made this a real bug rather than a casing slip.
    expect(marketplaceOf('BM')).toBe('BM');
    expect(MARKETPLACE_LABEL.BM).toBe('Backmarket');
  });
});

describe('the friendly labels the in-app sell flows write', () => {
  it.each([
    ['Amazon', 'AMAZON'],
    ['Backmarket', 'BM'],
    ['Back Market', 'BM'],
    ['eBay', 'EBAY'],
    ['OnBuy', 'ONBUY'],
  ])('%s resolves', (stored, expected) => {
    expect(marketplaceOf(stored)).toBe(expected);
  });

  it('is case- and space-insensitive, because both spellings are live data', () => {
    for (const v of ['amazon', 'AMAZON', '  Amazon  ', 'aMaZoN']) {
      expect(marketplaceOf(v)).toBe('AMAZON');
    }
  });
});

describe('values that are not a marketplace', () => {
  it.each(['', '   ', 'R T S', 'Other', 'FBA-UK', 'shopify', null, undefined])(
    '%s resolves to null rather than a wrong bucket', (v) => {
      expect(marketplaceOf(v as any)).toBeNull();
    },
  );

  it('does not silently fold an unknown platform into a real one', () => {
    // Returning a default here would be worse than returning null: the
    // numbers would look complete while quietly crediting the wrong channel.
    expect(marketplaceOf('Gumtree')).toBeNull();
  });
});

describe('isMarketplace — what the scorecard actually calls', () => {
  it('matches a code and its label to the same marketplace', () => {
    expect(isMarketplace('AMAZON', 'AMAZON')).toBe(true);
    expect(isMarketplace('Amazon', 'AMAZON')).toBe(true);
  });

  it('is the check that used to fail on every imported sale', () => {
    // Before: 'AMAZON' === 'Amazon' → false, for all 354 sales.
    expect('AMAZON' === MARKETPLACE_LABEL.AMAZON).toBe(false);
    expect(isMarketplace('AMAZON', 'AMAZON')).toBe(true);
  });

  it('keeps the marketplaces apart', () => {
    expect(isMarketplace('BM', 'AMAZON')).toBe(false);
    expect(isMarketplace('Backmarket', 'EBAY')).toBe(false);
  });
});

describe('labelFor', () => {
  it('turns a stored code into what an operator reads', () => {
    expect(labelFor('AMAZON')).toBe('Amazon');
    expect(labelFor('BM')).toBe('Backmarket');
  });

  it('passes an unrecognised value straight through rather than blanking it', () => {
    // A platform we don't know should be VISIBLE, not invisible — that is how
    // the scorecard hid 354 sales in the first place.
    expect(labelFor('Gumtree')).toBe('Gumtree');
  });
});

describe('the label set covers every marketplace', () => {
  it('has one label per marketplace, in canonical order', () => {
    expect(MARKETPLACE_LABELS).toHaveLength(MARKETPLACES.length);
    expect(MARKETPLACE_LABELS).toEqual(MARKETPLACES.map(m => MARKETPLACE_LABEL[m]));
  });

  it('every label round-trips back to its own marketplace', () => {
    for (const m of MARKETPLACES) {
      expect(marketplaceOf(MARKETPLACE_LABEL[m])).toBe(m);
    }
  });

  it('every marketplace code round-trips to itself', () => {
    for (const m of MARKETPLACES) {
      expect(marketplaceOf(m)).toBe(m);
    }
  });
});

describe('the scorecard, reconstructed', () => {
  it('counts imported sales that the old comparison missed entirely', () => {
    // The shape from the live screenshot: sales exist, all imported, all
    // stored under canonical codes.
    const sold = [
      { salePlatform: 'AMAZON' }, { salePlatform: 'AMAZON' },
      { salePlatform: 'BM' }, { salePlatform: 'EBAY' },
      { salePlatform: 'eBay' },            // in-app sale, friendly label
    ];

    const broken = MARKETPLACE_LABELS.map(label =>
      sold.filter(u => u.salePlatform === label).length);
    expect(broken).toEqual([0, 0, 1, 0]);   // only the in-app eBay row landed

    const fixed = MARKETPLACES.map(m =>
      sold.filter(u => marketplaceOf(u.salePlatform) === m).length);
    expect(fixed).toEqual([2, 1, 2, 0]);    // Amazon 2 · BM 1 · eBay 2 · OnBuy 0
    expect(fixed.reduce((a, b) => a + b, 0)).toBe(sold.length);
  });
});
