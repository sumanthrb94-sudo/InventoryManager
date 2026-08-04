/**
 * bulkSoldImport.ts — read a filled BULK SOLD sheet and turn it into bulk-sale
 * lines, or into reasons why a row cannot be used.
 *
 * WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT
 *
 * The operator sells a lot of handsets in one go and wants to record them from
 * a spreadsheet rather than tapping through Mark Multiple Sold. This reads that
 * spreadsheet. It is a narrow door on purpose, and the narrowness is the whole
 * design:
 *
 *   - It can ONLY mark stock that already exists as sold. It never creates a
 *     unit, never restores a return, never back-fills history.
 *   - Every row must name a unit that is currently sellable. An IMEI that is
 *     not in stock, or is already sold, is rejected with that reason rather
 *     than silently creating something.
 *   - It is not the Sales Report import. That path — which does create units,
 *     complete orphans and restore returns — was taken out of the interface
 *     after the migration precisely so it could not run by accident, and it
 *     stays out. Nothing here re-opens it.
 *
 * Selling is done by recordBulkSales in services/salesService.ts, the same
 * function Mark Multiple Sold already uses. This module only decides which
 * rows are fit to hand it, so a sale recorded from a sheet and a sale recorded
 * by tapping are the same write, with the same VAT lines and the same audit
 * trail.
 */
import ExcelJS from 'exceljs';
import { MARKETPLACES } from '../types';
import type { InventoryUnit, Marketplace } from '../types';
import type { BulkSaleLine } from '../services/salesService';

/**
 * The sheet's columns, in order. This IS the contract — the template writer
 * and the parser both read it, so a column cannot move in one and not the
 * other. The first four are required; the rest are optional overrides.
 */
export const BULK_SOLD_HEADERS = [
  'IMEI',
  'Marketplace',
  'Order Number',
  'Sale Price',
  'Sale Date',
  'Postage',
  'Payment Mode',
  'Comments',
] as const;

/** A row exactly as it was typed, before any judgement about it. */
export interface BulkSoldRow {
  /** 1-based row number in the sheet, so a rejection can point at it. */
  sourceRow: number;
  imei: string;
  marketplace: string;
  orderNumber: string;
  salePrice?: number;
  saleDate?: string;
  postage?: number;
  paymentMode?: string;
  comments?: string;
}

/** A row that cannot be used, and the reason an operator can act on. */
export interface BulkSoldRejection {
  sourceRow: number;
  imei: string;
  reason: string;
}

export interface BulkSoldPreview {
  /** Ready to hand to recordBulkSales, in sheet order. */
  lines: BulkSaleLine[];
  rejected: BulkSoldRejection[];
  /** Rows that carried nothing at all — not an error, just untouched. */
  blankRows: number;
}

const text = (v: unknown): string => {
  if (v == null) return '';
  if (typeof v === 'object') {
    // ExcelJS hands back {text, hyperlink} / {richText:[…]} / {result} shapes.
    const o = v as { text?: unknown; result?: unknown; richText?: Array<{ text?: string }> };
    if (Array.isArray(o.richText)) return o.richText.map(r => r.text ?? '').join('').trim();
    if (o.text != null) return String(o.text).trim();
    if (o.result != null) return String(o.result).trim();
    return '';
  }
  return String(v).trim();
};

const money = (v: unknown): number | undefined => {
  const s = text(v).replace(/[£,\s]/g, '');
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};

/** ISO date from a cell that may be a Date, an ISO string, or empty. */
const isoDate = (v: unknown): string | undefined => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = text(v);
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
};

/**
 * Read every row of the first sheet that carries the expected header.
 *
 * Header positions are read from the file rather than assumed, so a client who
 * inserts a column of their own notes does not silently shift every field by
 * one — which is the failure mode that makes a spreadsheet importer dangerous.
 */
export async function parseBulkSoldWorkbook(buffer: ArrayBuffer): Promise<BulkSoldRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  for (const ws of wb.worksheets) {
    const headers = ((ws.getRow(1).values ?? []) as unknown[])
      .slice(1).map(v => text(v).toUpperCase());
    const at = (name: string) => headers.indexOf(name.toUpperCase()) + 1;
    if (at('IMEI') === 0 || at('Sale Price') === 0) continue;   // not the sheet

    const cols = {
      imei: at('IMEI'), marketplace: at('Marketplace'), orderNumber: at('Order Number'),
      salePrice: at('Sale Price'), saleDate: at('Sale Date'), postage: at('Postage'),
      paymentMode: at('Payment Mode'), comments: at('Comments'),
    };

    const rows: BulkSoldRow[] = [];
    ws.eachRow((row, n) => {
      if (n === 1) return;
      const cell = (c: number) => (c > 0 ? row.getCell(c).value : null);
      rows.push({
        sourceRow: n,
        imei: text(cell(cols.imei)).toUpperCase(),
        marketplace: text(cell(cols.marketplace)).toUpperCase(),
        orderNumber: text(cell(cols.orderNumber)),
        salePrice: money(cell(cols.salePrice)),
        saleDate: isoDate(cell(cols.saleDate)),
        postage: money(cell(cols.postage)),
        paymentMode: text(cell(cols.paymentMode)) || undefined,
        comments: text(cell(cols.comments)) || undefined,
      });
    });
    return rows;
  }
  throw new Error('No sheet with IMEI and Sale Price columns — is this the BULK SOLD template?');
}

/** True when the row is entirely untouched, so it is skipped rather than failed. */
const isBlank = (r: BulkSoldRow): boolean =>
  !r.imei && !r.marketplace && !r.orderNumber && r.salePrice === undefined;

/**
 * Decide which rows can be sold, against the stock as it stands right now.
 *
 * `units` is the live inventory. Sellability matches SellSheet exactly — an
 * office unit is available (or came back into stock from a return and has not
 * been re-sold), an SHS unit is incoming — because a sheet must not be able to
 * sell something the app itself would refuse to sell.
 */
export function buildBulkSoldPreview(
  rows: BulkSoldRow[],
  units: InventoryUnit[],
): BulkSoldPreview {
  const byImei = new Map<string, InventoryUnit>();
  for (const u of units) {
    const k = (u.imei || '').trim().toUpperCase();
    if (k && !byImei.has(k)) byImei.set(k, u);
  }

  const lines: BulkSaleLine[] = [];
  const rejected: BulkSoldRejection[] = [];
  const seen = new Map<string, number>();      // IMEI → the row that claimed it
  let blankRows = 0;

  for (const r of rows) {
    if (isBlank(r)) { blankRows++; continue; }
    const reject = (reason: string) => rejected.push({ sourceRow: r.sourceRow, imei: r.imei, reason });

    if (!r.imei) { reject('no IMEI — the sheet cannot tell which unit sold'); continue; }

    if (!MARKETPLACES.includes(r.marketplace as Marketplace)) {
      reject(r.marketplace
        ? `"${r.marketplace}" is not a marketplace — use one of ${MARKETPLACES.join(', ')}`
        : `no marketplace — use one of ${MARKETPLACES.join(', ')}`);
      continue;
    }
    if (!r.orderNumber) { reject('no order number'); continue; }
    if (r.salePrice === undefined) { reject('no sale price'); continue; }
    if (r.salePrice <= 0) { reject(`sale price ${r.salePrice} is not a sale`); continue; }

    const unit = byImei.get(r.imei);
    if (!unit) { reject('no unit in stock with this IMEI'); continue; }
    if (unit.status === 'sold') { reject('already marked sold'); continue; }

    // The duplicate check comes LAST, after the row has proved it could
    // otherwise be sold. Two reasons, and the second is the important one:
    // the reason reported is the most actionable — a row with a mistyped
    // marketplace is told about the marketplace, not about a duplicate it also
    // happens to be — and a row that was never going to sell does not CLAIM
    // its IMEI, so it cannot make a later, valid row for the same handset look
    // like the duplicate.
    const claimedBy = seen.get(r.imei);
    if (claimedBy) { reject(`the same IMEI is already on row ${claimedBy}`); continue; }
    seen.set(r.imei, r.sourceRow);

    // Sellability matches SellSheet's own `inStock` / `sellableShs` lists, so
    // a sheet can never sell something the app itself would not offer. The
    // already-sold case is handled above, which is why it is absent here.
    const isSHS = unit.status === 'incoming';
    const sellable = isSHS
      || unit.status === 'available'
      || unit.returnType === 'returned_to_inventory';
    if (!sellable) { reject(`unit is ${unit.status}, not sellable`); continue; }

    lines.push({
      kind: 'unit',
      unit,
      isSHS,
      marketplace: r.marketplace as Marketplace,
      orderNumber: r.orderNumber,
      salePrice: r.salePrice,
      saleDate: r.saleDate,
      sku: unit.sku,
      paymentMode: r.paymentMode,
      postageOverride: r.postage,
      comments: r.comments,
    });
  }

  return { lines, rejected, blankRows };
}
