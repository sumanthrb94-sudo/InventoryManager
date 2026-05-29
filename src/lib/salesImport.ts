/**
 * salesImport.ts — sheet-aware sales workbook parser.
 *
 * Resolves audit blockers B2 + B3 (MASTER_FILES_AUDIT.md §2):
 *   B2 — needs a `Sale` entity (defined in types.ts) populated from the live
 *        client SALES_REPORT_2026.xlsx workbook.
 *   B3 — needs a sheet-aware importer that loops every marketplace tab instead
 *        of picking a single sheet like the legacy ImportModal reader.
 *
 * Strategy:
 *   - Read the workbook with SheetJS in `{ raw: true, cellText: true, cellDates: true }`
 *     so 15-digit IMEIs arrive as preserved strings (no scientific notation),
 *     dates arrive as JS `Date` objects, and we never have to parse the
 *     marketplace's cached formula text — we recompute every derived field via
 *     `calcSaleFinancials()` so the numbers always match `platforms.ts`.
 *   - Iterate `['AMAZON','BM','EBAY','ONBUY']` in order; a missing
 *     sheet records an error and continues (the file might be partial).
 *   - Per-sheet column maps live in `SHEET_LAYOUTS` below — header-matched
 *     case-insensitive with whitespace collapsed. eBay's literal numeric `0.2`
 *     header is matched as the string "0.2".
 *
 * IMPORTANT: this module never writes to Firestore. The caller
 * (ImportModal → dbService.bulkUpsertSales) handles persistence.
 */

import * as XLSX from 'xlsx';
import type { Marketplace, Sale } from '../types';
import { MARKETPLACES } from '../types';
import { calcSaleFinancials } from './platforms';

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/** Parsed payload returned by `parseSalesWorkbook`. Caller adds provenance fields. */
export interface ParsedSales {
  sales: Omit<Sale, 'importBatchId' | 'importedAt' | 'createdAt' | 'updatedAt' | 'ownerId'>[];
  perSheetCounts: Record<Marketplace, number>;
  errors: { sheet: string; row: number; message: string }[];
}

/**
 * Parse a SALES_REPORT workbook into canonical `Sale` rows.
 *
 * @param file        Either a browser `File` (drag-drop) or an `ArrayBuffer`
 *                    (Node fixture / tests).
 * @param sourceFile  Logical name of the source file, stored on every parsed
 *                    sale for provenance (e.g. "SALES_REPORT_2026.xlsx").
 */
export async function parseSalesWorkbook(
  file: File | ArrayBuffer,
  sourceFile: string,
): Promise<ParsedSales> {
  const buf: ArrayBuffer = file instanceof ArrayBuffer ? file : await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', raw: true, cellText: true, cellDates: true });

  const sales: ParsedSales['sales'] = [];
  const errors: ParsedSales['errors'] = [];
  const perSheetCounts: Record<Marketplace, number> = {
    AMAZON: 0, BM: 0, EBAY: 0, ONBUY: 0,
  };

  // Track mean SP per marketplace — surfaces the SP=£0 column-detection bug
  // immediately at parse time instead of leaking into Firestore unnoticed.
  const spSum: Record<Marketplace, number> = { AMAZON: 0, BM: 0, EBAY: 0, ONBUY: 0 };

  for (const marketplace of MARKETPLACES) {
    const sheetName = findSheetName(wb, marketplace);
    if (!sheetName) {
      errors.push({ sheet: marketplace, row: 0, message: `sheet "${marketplace}" missing from workbook` });
      continue;
    }
    const ws = wb.Sheets[sheetName];
    // header: 1 returns rows as arrays; raw: true keeps the typed cell values
    // (Date, number, string) we asked for at workbook load time.
    const rows = XLSX.utils.sheet_to_json<any[]>(ws, {
      header: 1, raw: true, defval: null, blankrows: false,
    });
    if (rows.length === 0) {
      errors.push({ sheet: sheetName, row: 0, message: 'sheet is empty' });
      continue;
    }

    const headerRow = rows[0];
    const layout = SHEET_LAYOUTS[marketplace];
    const colIdx = resolveColumns(headerRow, layout, sheetName, errors);

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      // sourceRow is 1-based and accounts for the header row (matches xlsx UX)
      const sourceRow = r + 1;
      const parsed = parseRow(marketplace, row, colIdx, sheetName, sourceRow, sourceFile, errors);
      if (parsed) {
        sales.push(parsed);
        perSheetCounts[marketplace]++;
        spSum[marketplace] += parsed.salePrice ?? 0;
      }
    }
  }

  // Parse-time canary: mean SP per marketplace must land in £100–£200 for the
  // live workbook. A mean of 0 means SP isn't being read (column-detection
  // regression) — log loudly so an importer can see it before pushing to
  // Firestore. Wrapped in try/catch so a console-less environment never throws.
  try {
    if (typeof console !== 'undefined' && console.info) {
      const summary = MARKETPLACES.map((m) => {
        const n = perSheetCounts[m];
        const mean = n > 0 ? (spSum[m] / n).toFixed(2) : '—';
        return `${m}=£${mean}(n=${n})`;
      }).join(' ');
      console.info(`[salesImport] mean SP per marketplace: ${summary}`);
    }
  } catch { /* non-critical diagnostic */ }

  return { sales, perSheetCounts, errors };
}

// ---------------------------------------------------------------------------
// Per-sheet column layouts (logical name → list of accepted header aliases)
// ---------------------------------------------------------------------------

type ColKey =
  | 'date' | 'orderNumber' | 'sku' | 'imei' | 'supplier'
  | 'quantity' | 'buyPrice' | 'salePrice'
  | 'paymentMode' | 'postage' | 'accountingFee' | 'comments';

interface SheetLayout {
  /** Header aliases per logical column (case-insensitive, whitespace-collapsed).
   *  Each value is the list of accepted header strings; the FIRST entry can be
   *  used as the canonical name when emitting diagnostics. */
  columns: Partial<Record<ColKey, string[]>>;
  /**
   * Positional fallback indices used ONLY when the header alias match fails
   * (mirrors `pickCol(aliases, fallback)` from ImportModal.parseOGStockSheet).
   * Indices come straight from MASTER_FILES_SPEC.md §File 2 — verified against
   * the live SALES_REPORT_2026.xlsx via scripts/_headerdump.mts.
   *
   * Critical: ONBUY has NO Quantity column, so BP/SP indices shift LEFT by one
   * vs the other marketplaces. BM inserts Payment Mode at col 8, which shifts
   * SP-BP/MAR TAX/... to the right but DOES NOT affect BP/SP (cols 6/7) — they
   * sit before the Payment Mode column.
   */
  fallback: Partial<Record<ColKey, number>>;
  /** Columns required for parseRow to consider the row valid. */
  required: ColKey[];
}

/**
 * Header aliases match the live AMAZON/BM/EBAY/ONBUY sheets verbatim
 * (see MASTER_FILES_SPEC.md §File 2). The matcher trims, lowercases and
 * collapses whitespace, so trailing spaces / case variations are tolerated.
 *
 * Each layout also carries `fallback` positional indices. If a header alias
 * cannot be matched (e.g. a corrupted header row, an export with the header
 * stripped, or a future column rename), the parser uses the documented
 * positional index instead of dropping the column. That guarantees BP / SP
 * keep flowing as REAL numbers — never silently defaulting to whatever happens
 * to sit at column 0 (which historically caused every row to come through with
 * SP=£0 + POSTAGE=£0 + COMMISSION=£0 and `GP = 0 - buyPrice`).
 */
const SHEET_LAYOUTS: Record<Marketplace, SheetLayout> = {
  // AMAZON SALES cols (21): Date | Order Number | SKU | IMEI | Supplier |
  //   Quantity | BP | SP | SP-BP | Marginal Tax | Commission | C. VAT | DSF |
  //   DSF. VAT | Postage | P. VAT | Acc | Total VAT | GP | GP % | Total VAT NTP
  AMAZON: {
    columns: {
      date:          ['date', 'nw'],
      orderNumber:   ['order number', 'order no'],
      sku:           ['sku'],
      imei:          ['imei', 'imei number'],
      supplier:      ['supplier'],
      quantity:      ['quantity', 'units', 'quant'],
      buyPrice:      ['bp'],
      salePrice:     ['sp'],
      postage:       ['postage'],
      accountingFee: ['acc'],
    },
    fallback: {
      date: 0, orderNumber: 1, sku: 2, imei: 3, supplier: 4,
      quantity: 5, buyPrice: 6, salePrice: 7,
      postage: 14, accountingFee: 16,
    },
    required: ['date', 'orderNumber', 'buyPrice', 'salePrice'],
  },
  // BM SALES cols (20): Date | Order No | SKU | IMEI | Supplier | Quantity |
  //   Payment Mode | BP | SP | SP-BP | Marginal Tax | Commission |
  //   Customer Care Fees | Postage | P. VAT | Acc | GP | GP % |
  //   Total VAT NTP | Comments
  BM: {
    columns: {
      date:          ['date'],
      orderNumber:   ['order no', 'order number'],
      sku:           ['sku'],
      imei:          ['imei', 'imei number'],
      supplier:      ['supplier'],
      quantity:      ['quantity', 'units', 'quant'],
      paymentMode:   ['payment mode'],
      buyPrice:      ['bp'],
      salePrice:     ['sp'],
      postage:       ['postage'],
      accountingFee: ['acc'],
      comments:      ['comments'],
    },
    fallback: {
      date: 0, orderNumber: 1, sku: 2, imei: 3, supplier: 4,
      quantity: 5, paymentMode: 6, buyPrice: 7, salePrice: 8,
      postage: 13, accountingFee: 15, comments: 19,
    },
    required: ['date', 'orderNumber', 'buyPrice', 'salePrice'],
  },
  // EBAY SALES cols (24): DATE | ORDER NUMBER | SKU | IMEI NUMBER | SUPPLIER |
  //   UNITS | BP | SP | SP-BP | Marginal Tax | Commission | ROF | FVF | VAT |
  //   T.COM | Postage | P. VAT | Marketing | M. VAT | Acc | Total VAT | GP |
  //   GP% | Total VAT NTP
  EBAY: {
    columns: {
      date:          ['date'],
      orderNumber:   ['order number', 'order no'],
      sku:           ['sku'],
      imei:          ['imei number', 'imei'],
      supplier:      ['supplier'],
      quantity:      ['units', 'quantity', 'quant'],
      buyPrice:      ['bp'],
      salePrice:     ['sp'],
      postage:       ['postage', 'shipping'],
      accountingFee: ['acc'],
    },
    fallback: {
      date: 0, orderNumber: 1, sku: 2, imei: 3, supplier: 4,
      quantity: 5, buyPrice: 6, salePrice: 7,
      postage: 15, accountingFee: 19,
    },
    required: ['date', 'orderNumber', 'buyPrice', 'salePrice'],
  },
  // ONBUY SALES cols (18): DATE | Order Number | SKU | IMEI | Supplier | BP |
  //   SP | SP-BP | Marginal Tax | Commission | VAT 20% | Postage | P. VAT |
  //   Acc | Total VAT | GP | GP% | Total VAT NTP
  // No Quantity column — BP/SP shift LEFT by one vs other sheets.
  ONBUY: {
    columns: {
      date:          ['date'],
      orderNumber:   ['order number', 'order no'],
      sku:           ['sku'],
      imei:          ['imei', 'imei number'],
      supplier:      ['supplier'],
      buyPrice:      ['bp'],
      salePrice:     ['sp'],
      postage:       ['postage'],
      accountingFee: ['acc'],
    },
    fallback: {
      date: 0, orderNumber: 1, sku: 2, imei: 3, supplier: 4,
      buyPrice: 5, salePrice: 6,
      postage: 11, accountingFee: 13,
    },
    required: ['date', 'orderNumber', 'buyPrice', 'salePrice'],
  },
};

// ---------------------------------------------------------------------------
// Sheet / header resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a sheet name case-insensitively. Accepts both the canonical
 * "AMAZON SALES"/"BM SALES"/... names from the client master and the bare
 * "AMAZON"/"BM"/... names emitted by older app exports.
 */
function findSheetName(wb: XLSX.WorkBook, marketplace: Marketplace): string | undefined {
  const candidates = [`${marketplace} sales`, marketplace.toLowerCase()];
  return wb.SheetNames.find((n: string) =>
    candidates.includes(n.trim().toLowerCase())
  );
}

/** Normalise a header cell for comparison: cast → trim → lowercase → collapse spaces. */
function normHeader(v: unknown): string {
  if (v == null) return '';
  // The literal numeric `0.2` header in EBAY must match its string form.
  return String(v).trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Build a column-key → column-index lookup for one sheet.
 *
 * Strategy mirrors `pickCol(aliases, fallback)` from
 * ImportModal.parseOGStockSheet: header alias wins when found, else fall back
 * to the documented positional index from `layout.fallback`. We only emit a
 * "required column not found" error when BOTH the header and the positional
 * fallback are missing — that way SP and BP keep arriving as REAL numbers
 * even on a workbook whose header row got nuked / renamed downstream.
 *
 * Without this fallback, a single missing/renamed header used to silently
 * fail-open: every row got SP=undefined → coerced to 0 → COMMISSION=0 →
 * POSTAGE=0 → `GP = 0 - buyPrice` (the bug shape the user reported).
 */
function resolveColumns(
  headerRow: any[],
  layout: SheetLayout,
  sheetName: string,
  errors: ParsedSales['errors'],
): Partial<Record<ColKey, number>> {
  const normalised = headerRow.map(normHeader);
  const out: Partial<Record<ColKey, number>> = {};
  for (const [key, aliases] of Object.entries(layout.columns) as [ColKey, string[]][]) {
    const headerIdx = normalised.findIndex((h) => aliases.includes(h));
    if (headerIdx >= 0) {
      out[key] = headerIdx;
      continue;
    }
    // Header miss — fall back to the documented positional index, but only if
    // that slot actually exists in the row and isn't already claimed by a
    // different logical key (defensive — keeps the fallback from clobbering a
    // header-matched neighbour on shuffled sheets).
    const fallbackIdx = layout.fallback[key];
    if (fallbackIdx !== undefined && fallbackIdx < headerRow.length) {
      const alreadyTaken = Object.values(out).includes(fallbackIdx);
      if (!alreadyTaken) {
        out[key] = fallbackIdx;
      }
    }
  }
  for (const req of layout.required) {
    if (out[req] === undefined) {
      errors.push({
        sheet: sheetName,
        row: 1,
        message: `required column "${req}" not found (aliases: ${layout.columns[req]?.join('|')}, fallback idx ${layout.fallback[req] ?? '—'})`,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Row parsing
// ---------------------------------------------------------------------------

function parseRow(
  marketplace: Marketplace,
  row: any[],
  cols: Partial<Record<ColKey, number>>,
  sheetName: string,
  sourceRow: number,
  sourceFile: string,
  errors: ParsedSales['errors'],
): ParsedSales['sales'][number] | null {
  const get = (k: ColKey): unknown => {
    const i = cols[k];
    return i === undefined ? undefined : row[i];
  };

  // ---- identifiers ------------------------------------------------------
  const orderNumber = toNonEmptyString(get('orderNumber'));
  const imei = toNonEmptyString(get('imei'));
  if (!orderNumber && !imei) {
    // A completely blank row is silently skipped (xlsx already strips most),
    // but a row that has financials but no identifiers is a true error.
    if (hasAnyValue(row)) {
      errors.push({ sheet: sheetName, row: sourceRow, message: 'missing both orderNumber AND imei' });
    }
    return null;
  }
  if (!orderNumber) {
    errors.push({ sheet: sheetName, row: sourceRow, message: 'missing orderNumber' });
    return null;
  }

  // ---- date -------------------------------------------------------------
  const saleDate = toIsoDate(get('date'));
  if (!saleDate) {
    errors.push({ sheet: sheetName, row: sourceRow, message: 'invalid or missing date' });
    return null;
  }

  // ---- money / qty ------------------------------------------------------
  const buyPrice = toNumber(get('buyPrice'));
  const salePrice = toNumber(get('salePrice'));
  if (buyPrice === undefined || salePrice === undefined) {
    errors.push({ sheet: sheetName, row: sourceRow, message: 'missing BP or SP' });
    return null;
  }
  // Quantity defaults to 1 (mandatory for ONBUY which has no Quantity column,
  // and for AMAZON/BM/EBAY rows where the cell is blank).
  const quantity = toNumber(get('quantity')) ?? 1;

  // ---- marketplace-specific extras --------------------------------------
  const paymentMode = marketplace === 'BM' ? toNonEmptyString(get('paymentMode')) : undefined;

  // Per-row overrides for the literal Postage / Acc cells (AMAZON varies 5/6.3;
  // EBAY varies 0/1.9/4.65/6.3; AMAZON Acc varies 0/1). Fall back to the
  // marketplace defaults when the cell is blank.
  const postage = toNumber(get('postage'));
  const accountingFee = toNumber(get('accountingFee'));

  // ---- recompute every derived field ------------------------------------
  const fin = calcSaleFinancials({
    marketplace, buyPrice, salePrice, postage, accountingFee,
  });

  const supplierName = toNonEmptyString(get('supplier'));
  const sku = toNonEmptyString(get('sku'));
  const comments = toNonEmptyString(get('comments'));

  // doc id convention from MASTER_FILES_AUDIT.md §5 — natural dedupe on
  // (marketplace, orderNumber). dbService.bulkUpsertSales relies on this.
  const id = `${marketplace}__${orderNumber}`;

  return {
    id,
    marketplace,
    orderNumber,
    sku,
    imei,
    supplierName,
    saleDate,
    quantity,
    buyPrice,
    salePrice,
    paymentMode,
    ...fin,
    comments,
    sourceFile,
    sourceRow,
  };
}

// ---------------------------------------------------------------------------
// Cell coercion helpers
// ---------------------------------------------------------------------------

function hasAnyValue(row: any[]): boolean {
  return row.some((v) => v !== null && v !== undefined && String(v).trim() !== '');
}

/** Stringify a cell, return undefined when blank. Numbers are preserved as
 *  full integer strings (avoiding scientific notation for 15-digit IMEIs). */
function toNonEmptyString(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') {
    // Big integers (IMEIs) — emit with no decimal / no exponent.
    if (Number.isInteger(v)) return v.toFixed(0);
    return String(v);
  }
  const s = String(v).trim();
  return s.length ? s : undefined;
}

function toNumber(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  const n = Number(String(v).replace(/[£$, ]/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

/** Convert any reasonable date representation to "YYYY-MM-DD". */
function toIsoDate(v: unknown): string | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return formatIsoDate(v);
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    // Excel serial date — convert via xlsx (1900-based by default).
    const d = (XLSX as any).SSF?.parse_date_code?.(v);
    if (d && d.y) {
      return `${pad4(d.y)}-${pad2(d.m)}-${pad2(d.d)}`;
    }
  }
  const s = String(v).trim();
  if (!s) return undefined;
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) return formatIsoDate(parsed);
  return undefined;
}

function formatIsoDate(d: Date): string {
  // Use UTC accessors so a Date created from "2026-05-12" in any tz still
  // renders as 2026-05-12 (xlsx with cellDates: true produces UTC midnight).
  return `${pad4(d.getUTCFullYear())}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function pad2(n: number): string { return n < 10 ? `0${n}` : String(n); }
function pad4(n: number): string { return n.toString().padStart(4, '0'); }

// ---------------------------------------------------------------------------
// Inline vitest smoke test (skipped when import.meta.vitest is unavailable).
// `vite.config.ts` does not currently enable `test.includeSource`, so this
// block is dead-stripped from the prod bundle and only runs when a future
// vitest config opts in.
// ---------------------------------------------------------------------------

// @ts-expect-error import.meta.vitest is provided only when test.includeSource is enabled
if (import.meta.vitest) {
  // @ts-expect-error vitest globals are injected when running under vitest
  const { describe, it, expect } = import.meta.vitest;

  describe('salesImport helpers', () => {
    it('toIsoDate handles Date, string and Excel serials', () => {
      expect(toIsoDate(new Date('2026-05-12T00:00:00Z'))).toBe('2026-05-12');
      expect(toIsoDate('2026-05-12')).toBe('2026-05-12');
      expect(toIsoDate('')).toBeUndefined();
    });

    it('toNonEmptyString preserves 15-digit IMEIs as strings', () => {
      expect(toNonEmptyString(353209102768686)).toBe('353209102768686');
      expect(toNonEmptyString('NL6CMQCYTD')).toBe('NL6CMQCYTD');
      expect(toNonEmptyString('   ')).toBeUndefined();
      expect(toNonEmptyString(null)).toBeUndefined();
    });

    it('toNumber strips currency formatting', () => {
      expect(toNumber('£75.00')).toBe(75);
      expect(toNumber('1,250')).toBe(1250);
      expect(toNumber('')).toBeUndefined();
      expect(toNumber(null)).toBeUndefined();
    });

    it('parseSalesWorkbook builds canonical Sale rows for every marketplace', async () => {
      const make = (rows: any[][]) => XLSX.utils.aoa_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, make([
        ['Date', 'Order Number', 'SKU', 'IMEI', 'Supplier', 'Quantity', 'BP', 'SP'],
        [new Date('2026-05-12T00:00:00Z'), 'AMZ-1', 'SKU1', '353209102768686', 'NIHAL', 1, 200, 300],
      ]), 'AMAZON SALES');
      XLSX.utils.book_append_sheet(wb, make([
        ['Date', 'Order No', 'SKU', 'IMEI', 'Supplier', 'Quantity', 'Payment Mode', 'BP', 'SP'],
        [new Date('2026-05-12T00:00:00Z'), 'BM-1', 'SKU2', 'NL6CMQCYTD', 'MHL', 1, 'PayPal', 150, 250],
      ]), 'BM SALES');
      XLSX.utils.book_append_sheet(wb, make([
        ['DATE', 'ORDER NUMBER', 'SKU', 'IMEI NUMBER', 'SUPPLIER', 'UNITS', 'BP', 'SP'],
        [new Date('2026-05-12T00:00:00Z'), 'EB-1', 'SKU3', 'SKC9P3QVP6F', 'IMAX', 1, 100, 200],
      ]), 'EBAY SALES');
      XLSX.utils.book_append_sheet(wb, make([
        ['DATE', 'Order Number', 'SKU', 'IMEI', 'Supplier', 'BP', 'SP'],
        [new Date('2026-05-12T00:00:00Z'), 'OB-1', 'SKU4', '111222333444555', 'ABC', 90, 180],
      ]), 'ONBUY SALES');

      const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
      const out = await parseSalesWorkbook(buf, 'fixture.xlsx');

      expect(out.errors).toEqual([]);
      expect(out.perSheetCounts).toEqual({ AMAZON: 1, BM: 1, EBAY: 1, ONBUY: 1 });
      expect(out.sales).toHaveLength(4);
      const bm = out.sales.find((s) => s.marketplace === 'BM')!;
      expect(bm.paymentMode).toBe('PayPal');
      expect(bm.customerCareFees).toBeCloseTo(8.99, 9);
      const ob = out.sales.find((s) => s.marketplace === 'ONBUY')!;
      expect(ob.quantity).toBe(1);
      expect(ob.imei).toBe('111222333444555');
      expect(bm.id).toBe('BM__BM-1');
    });
  });
}
