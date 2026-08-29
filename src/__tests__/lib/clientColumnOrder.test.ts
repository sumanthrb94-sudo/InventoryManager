/**
 * The client's column order IS the schema.
 *
 * On 2026-08-14 he sent his live workbook (14TH_AUGUST_SALES_REPORT_2026.xlsx)
 * and asked for the report to match it. CLIENT_ORDER below is that file's
 * header row, tab by tab, transcribed verbatim in his sequence — the only
 * thing normalised is presentation:
 *
 *   - CASE. His tabs disagree with each other: `DATE` on eBay/OnBuy/Temu,
 *     `Date` on BM, and Amazon's A1 is empty although the column holds dates.
 *     We write one consistent casing rather than reproducing the drift.
 *   - `Order No` (BM) / `ORDER NUMBER` (eBay) → `Order Number`.
 *   - `IMEI NUMBER` (eBay) → `IMEI`; `UNITS` (eBay) → `Units`.
 *   - `GP%` (eBay, OnBuy) → `GP %`, and the trailing space on eBay's and
 *     OnBuy's `Total VAT ` is dropped.
 *   - `RETURN`, the banner cell sitting past the last money column on Amazon
 *     and Temu, is not a column — our return block takes that position.
 *
 * Everything else is his: `Acc` rather than `Accessories`, `Payment Mode`
 * between Quantity and BP on BM, `PSF` after Customer Care Fees,
 * `Commission+VAT` after Commission VAT.
 *
 * OUR_ADDITIONS is what the application adds on top. Strip those from
 * SALES_HEADERS and what is left must be his order exactly — which is a
 * stronger statement than "contains the same names": it fails if a column
 * moves, not only if one goes missing.
 */
import { describe, it, expect } from 'vitest';
import { SALES_HEADERS } from '../../lib/platforms';
import { MARKETPLACES } from '../../types';
import type { Marketplace } from '../../types';

/**
 * Columns the app adds that his file has no equivalent of.
 *
 * Model / Colour / Storage — he identifies a handset by SKU and IMEI alone.
 * The return block — his sheets carry a `RETURN` banner and nothing under it.
 * Comments — BM has one, in this same final position; the other four do not.
 */
const OUR_ADDITIONS = [
  'Model', 'Colour', 'Storage',
  // The return block, grown 2026-08-29 at the operator's request to carry
  // the WHOLE return economics per row: Fees Kept (what the channel did not
  // give back on a refund), Repair Cost and Supplier Credit (unit-side),
  // and Return Cost — the live formula Net GP £ subtracts.
  'Postage Loss', 'Fees Kept', 'Repair Cost', 'Supplier Credit', 'Return Cost',
  'Net GP £', 'Return Date', 'Outcome', 'Shipping Legs',
  'Return Reason', 'Comments',
];

const CLIENT_ORDER: Record<Marketplace, string[]> = {
  AMAZON: [
    'Date', 'Order Number', 'SKU', 'IMEI', 'Supplier', 'Quantity', 'BP', 'SP',
    'SP-BP', 'Marginal Tax', 'Commission', 'C. VAT', 'DSF', 'DSF. VAT',
    'Postage', 'P. VAT', 'Acc', 'Total VAT', 'GP', 'GP %', 'Total VAT NTP',
  ],
  BM: [
    'Date', 'Order Number', 'SKU', 'IMEI', 'Supplier', 'Quantity',
    'Payment Mode', 'BP', 'SP', 'SP-BP', 'Marginal Tax', 'Commission',
    'Customer Care Fees', 'PSF', 'Postage', 'P. VAT', 'Acc', 'GP', 'GP %',
    'Total VAT NTP',
  ],
  EBAY: [
    'Date', 'Order Number', 'SKU', 'IMEI', 'Supplier', 'Units', 'BP', 'SP',
    'SP-BP', 'Marginal Tax', 'Commission', 'ROF', 'FVF', 'VAT', 'T.COM',
    'Postage', 'P. VAT', 'Marketing', 'M. VAT', 'Acc', 'Total VAT', 'GP',
    'GP %', 'Total VAT NTP',
  ],
  ONBUY: [
    'Date', 'Order Number', 'SKU', 'IMEI', 'Supplier', 'BP', 'SP', 'SP-BP',
    'Marginal Tax', 'Commission', 'VAT 20%', 'Postage', 'P. VAT', 'Acc',
    'Total VAT', 'GP', 'GP %', 'Total VAT NTP',
  ],
  TEMU: [
    'Date', 'Order Number', 'SKU', 'IMEI', 'Supplier', 'Quantity', 'BP', 'SP',
    'SP-BP', 'Marginal Tax', 'Commission', 'Commission VAT', 'Commission+VAT',
    'Postage', 'P. VAT', 'Acc', 'Total VAT', 'GP', 'GP %', 'Total VAT NTP',
  ],
};

describe('the Sales Report keeps the client\'s own column order', () => {
  it.each(MARKETPLACES)('%s — his order survives, ours only inserts into it', (m) => {
    const ours = (SALES_HEADERS[m] as readonly string[])
      .filter(h => !OUR_ADDITIONS.includes(h));
    expect(ours).toEqual(CLIENT_ORDER[m]);
  });

  it.each(MARKETPLACES)('%s — every addition is accounted for, none invented', (m) => {
    // The other half of the same contract: nothing on the tab is outside
    // {his columns} ∪ {our declared additions}. Without this, a new column
    // could be dropped in anywhere and the test above would still pass as
    // long as it happened to be filtered out — it would not be.
    const unexplained = (SALES_HEADERS[m] as readonly string[])
      .filter(h => !OUR_ADDITIONS.includes(h) && !CLIENT_ORDER[m].includes(h));
    expect(unexplained).toEqual([]);
  });

  it('Model, Colour and Storage sit with the identity block, not bolted on the end', () => {
    // They describe the handset, so they belong beside SKU and IMEI. They
    // used to be appended after Comments because the arithmetic addressed
    // cells by hard letter and inserting mid-sheet silently repointed it.
    for (const m of MARKETPLACES) {
      const h = SALES_HEADERS[m] as readonly string[];
      expect(h.indexOf('Model'), `${m} Model follows IMEI`).toBe(h.indexOf('IMEI') + 1);
      expect(h.indexOf('Storage'), `${m} Storage precedes Supplier`)
        .toBe(h.indexOf('Supplier') - 1);
    }
  });

  it('every tab still ends on Comments', () => {
    // Block 3 of §2.2: the operator's note about the return is the last
    // thing read. BM's own sheet ends there too.
    for (const m of MARKETPLACES) {
      const h = SALES_HEADERS[m] as readonly string[];
      expect(h[h.length - 1], `${m} ends on Comments`).toBe('Comments');
    }
  });

  it('the two new fee columns landed where he put them', () => {
    const bm = SALES_HEADERS.BM as readonly string[];
    expect(bm.indexOf('PSF'), 'PSF follows Customer Care Fees')
      .toBe(bm.indexOf('Customer Care Fees') + 1);
    expect(bm.indexOf('Postage'), 'Postage follows PSF').toBe(bm.indexOf('PSF') + 1);
    expect(bm.indexOf('Payment Mode'), 'Payment Mode precedes BP')
      .toBe(bm.indexOf('BP') - 1);

    const temu = SALES_HEADERS.TEMU as readonly string[];
    expect(temu.indexOf('Commission+VAT'), 'Commission+VAT follows Commission VAT')
      .toBe(temu.indexOf('Commission VAT') + 1);
  });

  it('Payment Mode is BM\'s alone', () => {
    // His other four tabs have no such column, and Amazon/eBay/OnBuy/Temu
    // do not report one.
    for (const m of MARKETPLACES) {
      const has = (SALES_HEADERS[m] as readonly string[]).includes('Payment Mode');
      expect(has, `${m} Payment Mode`).toBe(m === 'BM');
    }
  });
});
