/**
 * vat.ts — the VAT position, as a number you can act on.
 *
 * The per-sale VAT figures already existed and were correct in shape: margin
 * VAT at 16.67% of (SP − BP), input VAT reclaimed on marketplace fees, and
 * `totalVatNtp` = margin VAT − input VAT as the net payable. What did not
 * exist was anything that ADDED THEM UP. To answer "what do I owe this
 * quarter?" you opened the exported workbook and summed a column by hand.
 *
 * That mattered more than it sounds, because of how the column sums.
 *
 * ── The loss-making-sale problem ───────────────────────────────────────────
 *
 * `marginalTax` is computed as (SP − BP) × 16.67% with no floor. Sell a phone
 * for less than you paid — clearing aged stock, a refund, a return to
 * supplier — and it produces NEGATIVE margin VAT. Sum the column and those
 * negatives cancel real VAT owed on profitable sales:
 *
 *     +120 margin →  +£20.00
 *     −120 margin →  −£20.00
 *                     £0.00   ← what the export's TOTAL row shows
 *
 * HMRC Notice 718 (VAT margin schemes) treats each sale separately: where an
 * item sells at a loss there is no VAT due on it, and that loss cannot be set
 * against the margin on other items. On that reading the figure above is
 * £20.00, and the export understates VAT by every loss in the period.
 *
 * ── Why this module reports BOTH ──────────────────────────────────────────
 *
 * We are not the client's tax adviser, and re-stating a filed VAT figure is
 * not a change to make on a code author's reading of a public notice. So
 * every period carries two numbers — `asComputed` (the historical
 * behaviour, negatives and all) and `marginScheme` (each sale floored at
 * zero) — plus the exact list of sales that differ. The accountant can see
 * the delta and the rows behind it, then rule.
 *
 * Nothing here mutates a Sale. It is a reporting lens over data that already
 * exists, which also means switching to the margin-scheme figure later is a
 * decision, not a migration.
 */
import type { Sale } from '../types';

/** UK VAT quarters are set per-business; calendar quarters are the default
 *  and the only stagger we can infer without asking. Labelled by the
 *  calendar year and quarter so a bookkeeper can map them to their own
 *  stagger without arithmetic. */
export interface VatPeriod {
  /** Sort key, e.g. '2026-Q3'. */
  key: string;
  /** Human label, e.g. 'Jul–Sep 2026'. */
  label: string;
  /** Inclusive ISO bounds. */
  from: string;
  to: string;
}

export interface VatLine {
  saleId: string;
  saleDate: string;
  marketplace: string;
  orderNumber: string;
  imei?: string;
  model?: string;
  supplierName?: string;
  buyPrice: number;
  salePrice: number;
  /** SP − BP. Negative on a loss-making sale. */
  margin: number;
  /** Margin VAT as the app has always computed it — may be negative. */
  vatAsComputed: number;
  /** Margin VAT with the per-sale zero floor applied. */
  vatMarginScheme: number;
  /** Input VAT on marketplace fees — reclaimable either way. */
  inputVat: number;
  /** True when the two margin-VAT figures disagree, i.e. the sale lost money. */
  differs: boolean;
}

export interface VatPeriodSummary {
  period: VatPeriod;
  lines: VatLine[];
  saleCount: number;
  lossMakingCount: number;
  /** Totals, both readings. */
  marginVatAsComputed: number;
  marginVatMarginScheme: number;
  /** marginScheme − asComputed. Always ≥ 0: flooring can only raise the total. */
  difference: number;
  /** Input VAT reclaimable on marketplace fees. */
  inputVat: number;
  /** Net payable under each reading: margin VAT − input VAT. */
  netPayableAsComputed: number;
  netPayableMarginScheme: number;
  /** Turnover context, so the VAT figure can be sanity-checked at a glance. */
  totalSales: number;
  totalCost: number;
  totalMargin: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** The calendar quarter an ISO date falls in. */
export function vatPeriodOf(isoDate: string): VatPeriod | null {
  const m = /^(\d{4})-(\d{2})/.exec(isoDate ?? '');
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  const q = Math.floor((month - 1) / 3) + 1;
  const startMonth = (q - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const lastDay = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
  return {
    key: `${year}-Q${q}`,
    label: `${MONTHS[startMonth - 1]}–${MONTHS[endMonth - 1]} ${year}`,
    from: `${year}-${String(startMonth).padStart(2, '0')}-01`,
    to: `${year}-${String(endMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
  };
}

/**
 * Should this sale appear in a VAT period at all?
 *
 * Voided sales are excluded. A refunded sale is money returned to the
 * customer — there is no supply to account for, so carrying its margin VAT
 * would overstate the liability. The sale doc is kept for audit, which is
 * exactly why it has to be filtered here rather than deleted upstream.
 */
export function isVatable(sale: Sale): boolean {
  return !sale.voidedAt;
}

/** One sale, both readings. */
export function vatLineOf(sale: Sale): VatLine {
  const margin = r2((sale.salePrice ?? 0) - (sale.buyPrice ?? 0));
  const asComputed = r2(sale.marginalTax ?? 0);
  // The floor is applied to the MARGIN, not to the stored tax figure, so a
  // sale whose stored marginalTax drifted from its own SP/BP still floors on
  // the fact that matters — did this item make money?
  const marginScheme = margin > 0 ? Math.max(0, asComputed) : 0;
  return {
    saleId: sale.id,
    saleDate: sale.saleDate,
    marketplace: sale.marketplace,
    orderNumber: sale.orderNumber,
    imei: sale.imei,
    model: sale.model,
    supplierName: sale.supplierName,
    buyPrice: r2(sale.buyPrice ?? 0),
    salePrice: r2(sale.salePrice ?? 0),
    margin,
    vatAsComputed: asComputed,
    vatMarginScheme: r2(marginScheme),
    inputVat: r2(sale.totalVat ?? 0),
    differs: r2(marginScheme) !== asComputed,
  };
}

/** Group vatable sales into calendar quarters, newest period first. */
export function buildVatPeriods(sales: Sale[]): VatPeriodSummary[] {
  const byPeriod = new Map<string, { period: VatPeriod; lines: VatLine[] }>();

  for (const sale of sales) {
    if (!isVatable(sale)) continue;
    const period = vatPeriodOf(sale.saleDate);
    if (!period) continue;
    const bucket = byPeriod.get(period.key) ?? { period, lines: [] };
    bucket.lines.push(vatLineOf(sale));
    byPeriod.set(period.key, bucket);
  }

  const summaries: VatPeriodSummary[] = [];
  for (const { period, lines } of byPeriod.values()) {
    const sum = (pick: (l: VatLine) => number) => r2(lines.reduce((a, l) => a + pick(l), 0));
    const marginVatAsComputed = sum(l => l.vatAsComputed);
    const marginVatMarginScheme = sum(l => l.vatMarginScheme);
    const inputVat = sum(l => l.inputVat);
    summaries.push({
      period,
      lines: lines.sort((a, b) => b.saleDate.localeCompare(a.saleDate)),
      saleCount: lines.length,
      lossMakingCount: lines.filter(l => l.differs).length,
      marginVatAsComputed,
      marginVatMarginScheme,
      difference: r2(marginVatMarginScheme - marginVatAsComputed),
      inputVat,
      netPayableAsComputed: r2(marginVatAsComputed - inputVat),
      netPayableMarginScheme: r2(marginVatMarginScheme - inputVat),
      totalSales: sum(l => l.salePrice),
      totalCost: sum(l => l.buyPrice),
      totalMargin: sum(l => l.margin),
    });
  }

  return summaries.sort((a, b) => b.period.key.localeCompare(a.period.key));
}

/**
 * Every sale where the two readings disagree — i.e. every item sold at a
 * loss. This is the list the accountant needs: it is both the evidence for
 * the difference and, on its own, a commercial red flag.
 */
export function lossMakingLines(summaries: VatPeriodSummary[]): VatLine[] {
  return summaries
    .flatMap(s => s.lines)
    .filter(l => l.differs)
    .sort((a, b) => a.margin - b.margin);
}

/**
 * The margin-scheme stock book, as HMRC expects it to be readable: what was
 * bought, what it sold for, the margin, and the VAT on that margin — one row
 * per item, in date order.
 */
export interface StockBookRow {
  saleDate: string;
  imei: string;
  model: string;
  supplier: string;
  purchasePrice: number;
  salePrice: number;
  margin: number;
  vatDue: number;
  marketplace: string;
  orderNumber: string;
}

export function buildStockBook(summaries: VatPeriodSummary[]): StockBookRow[] {
  return summaries
    .flatMap(s => s.lines)
    .map(l => ({
      saleDate: l.saleDate,
      imei: l.imei || '',
      model: l.model || '',
      supplier: l.supplierName || '',
      purchasePrice: l.buyPrice,
      salePrice: l.salePrice,
      margin: l.margin,
      vatDue: l.vatMarginScheme,
      marketplace: l.marketplace,
      orderNumber: l.orderNumber,
    }))
    .sort((a, b) => a.saleDate.localeCompare(b.saleDate));
}
