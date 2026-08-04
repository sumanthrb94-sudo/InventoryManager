/**
 * bulkSaleColumns.ts — what Mark Multiple Sold shows, column for column,
 * for each marketplace.
 *
 * WHY THIS EXISTS
 *
 * The Sales Report does not have one sales layout, it has five. Amazon
 * charges a DSF and reports its VAT; eBay reports ROF, FVF, a 20%-on-fees
 * bundle, a total-commission line and operator-entered marketing; OnBuy
 * reports a single VAT 20%; Temu reports commission VAT separately; Back
 * Market charges a flat customer-care fee and no total-VAT line at all.
 * Those differences are the marketplaces' own, and the client reconciles
 * each tab against that marketplace's own statement.
 *
 * So the entry grid mirrors the sheet the row will land on. The header
 * strings below are the SAME strings SALES_HEADERS uses — not lookalikes —
 * and a test asserts that every one of them exists on that marketplace's
 * sheet, in this order. If a report column is renamed or moved, that test
 * fails rather than the grid quietly showing a column the report no longer
 * has.
 *
 * Only the columns an operator can see or fill while recording a sale are
 * here. Date, Order Number, SKU, IMEI, Supplier, Quantity, BP and SP are
 * fixed leading columns on every tab and are handled by the grid itself;
 * the return-linkage block (Return Date, Outcome, Postage Loss, Net GP £)
 * belongs to a sale that has already happened and cannot be entered here.
 */
import type { Marketplace } from '../types';
import type { SaleFinancials } from './platforms';

/** Which of the row's own typed values an entry column writes. */
export type BulkSaleInput = 'postage' | 'marketing';

export interface BulkSaleColumn {
  /** Verbatim the header the Sales Report uses for this column. */
  header: string;
  /** Computed columns read this field off calcSaleFinancials. */
  field?: keyof SaleFinancials;
  /** Entry columns are typed by the operator. */
  input?: BulkSaleInput;
}

const computed = (header: string, field: keyof SaleFinancials): BulkSaleColumn =>
  ({ header, field });
const entry = (header: string, input: BulkSaleInput): BulkSaleColumn =>
  ({ header, input });

/**
 * The columns that follow SP on each marketplace's tab, in the report's own
 * order.
 *
 * Postage is an entry column everywhere — the operator overrides it per sale
 * (free shipping, an eBay tier, a heavier parcel). Marketing is an entry
 * column on eBay only, and only eBay: it is a per-line promo spend the
 * operator decides, which is why the report writes it as a literal rather
 * than a formula.
 */
export const MARKETPLACE_COLUMNS: Record<Marketplace, BulkSaleColumn[]> = {
  AMAZON: [
    computed('SP-BP', 'spMinusBp'),
    computed('Marginal Tax', 'marginalTax'),
    computed('Commission', 'commission'),
    computed('C. VAT', 'commissionVat'),
    computed('DSF', 'dsf'),
    computed('DSF. VAT', 'dsfVat'),
    entry('Postage', 'postage'),
    computed('P. VAT', 'postageVat'),
    computed('Accessories', 'accessoryFee'),
    computed('Total VAT', 'totalVat'),
    computed('GP', 'grossProfit'),
    computed('GP %', 'gpPercent'),
    computed('Total VAT NTP', 'totalVatNtp'),
  ],
  BM: [
    computed('SP-BP', 'spMinusBp'),
    computed('Marginal Tax', 'marginalTax'),
    computed('Commission', 'commission'),
    computed('Customer Care Fees', 'customerCareFees'),
    entry('Postage', 'postage'),
    computed('P. VAT', 'postageVat'),
    computed('Accessories', 'accessoryFee'),
    computed('GP', 'grossProfit'),
    computed('GP %', 'gpPercent'),
    computed('Total VAT NTP', 'totalVatNtp'),
  ],
  EBAY: [
    computed('SP-BP', 'spMinusBp'),
    computed('Marginal Tax', 'marginalTax'),
    computed('Commission', 'commission'),
    computed('ROF', 'rof'),
    computed('FVF', 'fvf'),
    // eBay's "VAT" column is the 20%-on-fees bundle, not postage VAT.
    computed('VAT', 'twentyPercent'),
    computed('T.COM', 'totalCom'),
    entry('Postage', 'postage'),
    computed('P. VAT', 'postageVat'),
    entry('Marketing', 'marketing'),
    computed('M. VAT', 'marketingVat'),
    computed('Accessories', 'accessoryFee'),
    computed('Total VAT', 'totalVat'),
    computed('GP', 'grossProfit'),
    computed('GP %', 'gpPercent'),
    computed('Total VAT NTP', 'totalVatNtp'),
  ],
  ONBUY: [
    computed('SP-BP', 'spMinusBp'),
    computed('Marginal Tax', 'marginalTax'),
    computed('Commission', 'commission'),
    computed('VAT 20%', 'vat20'),
    entry('Postage', 'postage'),
    computed('P. VAT', 'postageVat'),
    computed('Accessories', 'accessoryFee'),
    computed('Total VAT', 'totalVat'),
    computed('GP', 'grossProfit'),
    computed('GP %', 'gpPercent'),
    computed('Total VAT NTP', 'totalVatNtp'),
  ],
  TEMU: [
    computed('SP-BP', 'spMinusBp'),
    computed('Marginal Tax', 'marginalTax'),
    computed('Commission', 'commission'),
    computed('Commission VAT', 'commissionVat'),
    entry('Postage', 'postage'),
    computed('P. VAT', 'postageVat'),
    computed('Accessories', 'accessoryFee'),
    computed('Total VAT', 'totalVat'),
    computed('GP', 'grossProfit'),
    computed('GP %', 'gpPercent'),
    computed('Total VAT NTP', 'totalVatNtp'),
  ],
};

/**
 * The columns every tab shares, before the marketplace-specific ones. These
 * are the sale's identity — who, what, which order — and the two prices the
 * whole row is derived from.
 *
 * BP is deliberately NOT typed: it comes off the unit that was picked. A
 * hand-typed buy price would disagree with the buy record, and the report
 * reconciles against that record.
 */
export const LEADING_COLUMNS = [
  '#', 'Source', 'Model', 'IMEI / Qty', 'Supplier', 'Order Number', 'BP', 'SP',
] as const;
