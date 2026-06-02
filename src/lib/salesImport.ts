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
 *   - Iterate `['AMAZON','BM','EBAY','ONBUY','PROJECT']` in order; a missing
 *     sheet records an error and continues (the file might be partial).
 *   - Per-sheet column maps live in `SHEET_LAYOUTS` below — header-matched
 *     case-insensitive with whitespace collapsed. eBay's literal numeric `0.2`
 *     header is matched as the string "0.2".
 *
 * IMPORTANT: this module never writes to Firestore. The caller
 * (ImportModal → dbService.bulkUpsertSales) handles persistence.
 */

import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
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

  // SheetJS strips font colours, so do a parallel ExcelJS pass on the same
  // bytes to harvest red-row markers. The operator paints whole rows red on
  // their Sales Report sheet to flag returns / refunds / chargebacks — we
  // preserve that signal end-to-end so the import surfaces the same red rows
  // in every downstream view.
  const flaggedRowsBySheet = await detectFlaggedRows(buf);

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

    // Operator-facing diagnostic — every re-import logs which header text
    // each logical key resolved to (or '⚠ fallback' if positional). Lets
    // the operator catch a header rename / column shift the moment they
    // re-upload, instead of finding it later through silent empty cells.
    try {
      if (typeof console !== 'undefined' && console.info) {
        const summary: string[] = [];
        for (const [key, idx] of Object.entries(colIdx)) {
          if (idx == null) continue;
          const headerText = String(headerRow[idx] ?? '').trim() || '(blank)';
          summary.push(`${key}→[${idx}] "${headerText}"`);
        }
        console.info(`[salesImport][${sheetName}] columns: ${summary.join(', ')}`);
      }
    } catch { /* non-critical */ }

    const flaggedRows = flaggedRowsBySheet.get(sheetName.toLowerCase()) ?? new Set<number>();

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      // sourceRow is 1-based and accounts for the header row (matches xlsx UX)
      const sourceRow = r + 1;
      const parsed = parseRow(marketplace, row, colIdx, sheetName, sourceRow, sourceFile, errors);
      if (parsed) {
        if (flaggedRows.has(sourceRow)) parsed.flagged = true;
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
  | 'paymentMode' | 'shipping' | 'netProfit'
  | 'postage' | 'pVat' | 'acc' | 'customerCareFees' | 'marketing' | 'comments';

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
 * Header aliases match the live AMAZON/BM/EBAY/ONBUY/PROJECT sheets verbatim
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
  // AMAZON cols (15):  nw | Order Number | SKU | IMEI | Supplier | Quantity |
  //                    BP | SP | SP-BP | Marginal Tax | Commission | Postage |
  //                    GP | GP % | Comments
  // AMAZON has two schemas in the wild:
  //   - Legacy 15-col: Date|OrderNo|SKU|IMEI|Supplier|Qty|BP|SP|SP-BP|MarTax|
  //                    Commission|Postage|GP|GP%|Comments     (Postage = idx 11)
  //   - 2026-05 22-col: Date|OrderNo|SKU|IMEI|Supplier|Qty|BP|SP|SP-BP|MarTax|
  //                    Commission|C.VAT|DSF|DSF.VAT|Postage|P.VAT|Acc|TotVAT|
  //                    GP|GP%|TotVATNtp|Comments                (Postage = idx 14)
  // Both layouts share the same Date..SP columns, so identifiers + money
  // come through regardless. Postage is what shifts. The parser relies on
  // header match first (which always wins when the file has a `Postage`
  // header text) and only falls back to a positional index when the header
  // is missing. The fallback below targets the legacy schema; the 2026-05
  // schema gets resolved by header.
  AMAZON: {
    columns: {
      date:        ['nw', 'date'],
      orderNumber: ['order number', 'order no'],
      sku:         ['sku'],
      imei:        ['imei', 'imei number', 'serial', 'serial number', 'sn'],
      supplier:    ['supplier', 'suppliers', 'supp.', 'vendor'],
      quantity:    ['quantity', 'units', 'quant', 'qty'],
      buyPrice:    ['bp', 'buy price', 'buyprice'],
      salePrice:   ['sp', 'sale price', 'saleprice'],
      postage:     ['postage', 'ship', 'shipping', 'postage £', 'p.'],
      pVat:        ['p. vat', 'p.vat', 'postage vat'],
      acc:         ['acc', 'accessories', 'accessory', 'acc.'],
      // The live AMAZON sheet has the trailing column literally titled
      // 'RETURN' (the operator puts return-reason text in it). Treat as
      // free-form notes — same downstream handling as Comments.
      comments:    ['comments', 'comment', 'notes', 'return'],
    },
    fallback: {
      date: 0, orderNumber: 1, sku: 2, imei: 3, supplier: 4,
      quantity: 5, buyPrice: 6, salePrice: 7,
    },
    required: ['date', 'orderNumber', 'buyPrice', 'salePrice'],
  },
  // BM cols (17): Date | Order No | SKU | IMEI | Supplier | Quantity | BP | SP |
  //               Payment Mode | SP-BP | Marginal Tax | PayPal/Klarna Com |
  //               Commission | Postage | GP | GP % | Comments
  BM: {
    columns: {
      date:        ['date'],
      orderNumber: ['order no', 'order number'],
      sku:         ['sku'],
      imei:        ['imei', 'imei number', 'serial', 'serial number', 'sn'],
      supplier:    ['supplier', 'suppliers', 'supp.', 'vendor'],
      quantity:    ['quantity', 'units', 'quant', 'qty'],
      paymentMode: ['payment mode', 'payment', 'paymentmode'],
      buyPrice:    ['bp', 'buy price', 'buyprice'],
      salePrice:   ['sp', 'sale price', 'saleprice'],
      customerCareFees: ['customer care fees', 'customer care', 'ccf', 'cc fees'],
      postage:     ['postage', 'ship', 'shipping', 'postage £'],
      pVat:        ['p. vat', 'p.vat', 'postage vat'],
      acc:         ['acc', 'accessories', 'accessory', 'acc.'],
      comments:    ['comments', 'comment', 'notes'],
    },
    fallback: {
      // Live BM sheet (20 cols): Date, Order No, SKU, IMEI, Supplier,
      // Quantity, Payment Mode, BP, SP, ...
      date: 0, orderNumber: 1, sku: 2, imei: 3, supplier: 4,
      quantity: 5, paymentMode: 6, buyPrice: 7, salePrice: 8,
    },
    required: ['date', 'orderNumber', 'buyPrice', 'salePrice'],
  },
  // EBAY cols (19): DATE | ORDER NUMBER | SKU | IMEI NUMBER | SUPPLIER | UNITS |
  //                 BP | SP | SP-BP | MAR TAX | COM | ROF | FVF | 0.2 | T.COM |
  //                 SHIPPING | GP | GP% | NP(incl. PROMOTION)
  EBAY: {
    columns: {
      date:        ['date'],
      orderNumber: ['order number', 'order no'],
      sku:         ['sku'],
      imei:        ['imei number', 'imei', 'serial', 'serial number', 'sn'],
      supplier:    ['supplier', 'suppliers', 'supp.', 'vendor'],
      quantity:    ['units', 'quantity', 'quant', 'qty'],
      buyPrice:    ['bp', 'buy price', 'buyprice'],
      salePrice:   ['sp', 'sale price', 'saleprice'],
      // eBay's Shipping IS the Postage fee — same field, two header names
      // depending on which sheet version the operator exported.
      shipping:    ['shipping', 'postage'],
      pVat:        ['p. vat', 'p.vat', 'postage vat'],
      acc:         ['acc', 'accessories', 'accessory', 'acc.'],
      // 2026-05 schema introduced an operator-entered Marketing line that
      // replaced the implicit 5%-of-SP convention. Read it when present so
      // the recompute uses the file's actual marketing spend.
      marketing:   ['marketing', 'marketing £'],
      netProfit:   ['np(incl. promotion)', 'np incl. promotion', 'np'],
      comments:    ['comments', 'comment', 'notes'],
    },
    fallback: {
      date: 0, orderNumber: 1, sku: 2, imei: 3, supplier: 4,
      quantity: 5, buyPrice: 6, salePrice: 7,
    },
    required: ['date', 'orderNumber', 'buyPrice', 'salePrice'],
  },
  // ONBUY cols (15): DATE | Order Number | SKU | IMEI | Supplier | BP | SP |
  //                  SP-BP | MAR VAT | COM 7% | VAT 20% | SHIP |
  //                  GP=SP-BP-COM-SHIP-MARVAT | GP% | Comments
  // OnBuy has NO QUANT column — BP/SP shift LEFT by one vs other sheets.
  ONBUY: {
    columns: {
      date:        ['date'],
      orderNumber: ['order number', 'order no'],
      sku:         ['sku'],
      imei:        ['imei', 'imei number', 'serial', 'serial number', 'sn'],
      supplier:    ['supplier', 'suppliers', 'supp.', 'vendor'],
      buyPrice:    ['bp', 'buy price', 'buyprice'],
      salePrice:   ['sp', 'sale price', 'saleprice'],
      postage:     ['ship', 'postage', 'shipping', 'postage £'],
      pVat:        ['p. vat', 'p.vat', 'postage vat'],
      acc:         ['acc', 'accessories', 'accessory', 'acc.'],
      comments:    ['comments', 'comment', 'notes'],
    },
    fallback: {
      date: 0, orderNumber: 1, sku: 2, imei: 3, supplier: 4,
      // NB: BP at 5, SP at 6 — one less than the other marketplaces because
      // OnBuy has no Quantity column.
      buyPrice: 5, salePrice: 6,
    },
    required: ['date', 'orderNumber', 'buyPrice', 'salePrice'],
  },
};

// ---------------------------------------------------------------------------
// Red-row detection (operator's flagged sales)
// ---------------------------------------------------------------------------

/**
 * Walk every sheet via ExcelJS and return a map of sheetName(lowercase) → set
 * of 1-based row numbers whose DATE / ORDER NUMBER / SKU cell carries a red
 * font (or red solid fill).
 *
 * The operator's convention on the live Sales Report sheet is to paint a row
 * red when the order needs attention (return / refund / chargeback / dispute).
 * SheetJS doesn't surface font colour, so we run a parallel ExcelJS load over
 * the same bytes to harvest the signal.
 *
 * Failure tolerant: if ExcelJS throws (corrupt styles, exotic theme colour)
 * we return an empty map — the import still completes, just without the red
 * highlight on the resulting Sales rows.
 */
async function detectFlaggedRows(buf: ArrayBuffer): Promise<Map<string, Set<number>>> {
  const result = new Map<string, Set<number>>();
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    for (const ws of wb.worksheets) {
      const key = ws.name.trim().toLowerCase();
      const flagged = new Set<number>();
      // Probe the first few columns — operators tend to paint the whole row
      // red, but in practice the DATE/ORDER NUMBER columns are the most
      // consistent carriers of the colour. Three columns is enough to catch
      // partial paint-outs without false-positiving on a stray red comment.
      ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
        if (rowNum === 1) return; // header
        for (let c = 1; c <= 3; c++) {
          const cell = row.getCell(c);
          if (isRedishCell(cell)) {
            flagged.add(rowNum);
            return;
          }
        }
      });
      if (flagged.size > 0) result.set(key, flagged);
    }
  } catch (err) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[salesImport] red-row detection skipped:', (err as Error)?.message || err);
    }
  }
  return result;
}

/** Heuristic: detect a "red" font or solid red fill on an ExcelJS cell. */
function isRedishCell(cell: ExcelJS.Cell): boolean {
  const fontArgb = (cell.font as any)?.color?.argb as string | undefined;
  if (isRedishArgb(fontArgb)) return true;
  const fill = cell.fill as any;
  if (fill?.type === 'pattern' && fill.pattern === 'solid') {
    const fgArgb = fill.fgColor?.argb as string | undefined;
    if (isRedishArgb(fgArgb)) return true;
  }
  return false;
}

/** ARGB hex → is this clearly a red? Accepts 6-char (RRGGBB) or 8-char (AARRGGBB). */
function isRedishArgb(argb: string | undefined): boolean {
  if (!argb) return false;
  const hex = argb.length === 8 ? argb.slice(2) : argb.length === 6 ? argb : '';
  if (hex.length !== 6) return false;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return false;
  // Dominant red: R clearly above G and B, and R itself isn't a dark grey.
  return r >= 0xA0 && r >= g + 0x30 && r >= b + 0x30;
}

// ---------------------------------------------------------------------------
// Sheet / header resolution
// ---------------------------------------------------------------------------

/** Resolve a sheet name case-insensitively (workbook may have "Amazon", "AMAZON", "amazon"). */
/**
 * Resolve a sheet name to a Marketplace. Matches:
 *   - exact name (case-insensitive): "AMAZON" / "amazon"
 *   - "<marketplace> SALES" suffix: "AMAZON SALES" / "Bm Sales"  ← live file
 *   - any sheet whose first whitespace-delimited token equals the marketplace
 * Returns the first sheet whose first token matches `marketplace`.
 */
function findSheetName(wb: XLSX.WorkBook, marketplace: Marketplace): string | undefined {
  const want = marketplace.toLowerCase();
  return wb.SheetNames.find((n: string) => {
    const norm = n.trim().toLowerCase().replace(/\s+/g, ' ');
    if (norm === want) return true;
    const firstToken = norm.split(' ')[0];
    return firstToken === want;
  });
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
  // Comments-specific final fallback: the client's sheets routinely leave
  // the Comments header blank in the last column (the operator types
  // free-form notes into that column without a header). If `comments` is
  // still unresolved AND the last column's header is empty AND that index
  // isn't already claimed, treat it as Comments.
  if (out.comments === undefined && headerRow.length > 0) {
    const lastIdx = headerRow.length - 1;
    const lastHeader = normalised[lastIdx];
    const alreadyTaken = Object.values(out).includes(lastIdx);
    if (!lastHeader && !alreadyTaken) {
      out.comments = lastIdx;
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
    // A row missing both identifiers is only a TRUE error when it carries
    // real operator-entered data — BP, SP, supplier, or sku with a
    // non-zero / non-blank value. Pure-zero / phantom-formula rows are
    // SheetJS noise: when the operator's xlsx has shared formulas with a
    // limited range (e.g. I2:I157), SheetJS extrapolates them BEYOND the
    // ref and returns synthetic numbers (often zeros) for blank rows past
    // the data section. Those rows are visually empty in Excel but the
    // parser would otherwise flag them. `hasFinancialValue` ignores them
    // by requiring meaningful identifier or money content.
    if (hasFinancialValue(row, cols)) {
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
  // Quantity defaults to 1 (mandatory for ONBUY which has no QUANT column,
  // and for AMAZON/BM/EBAY/PROJECT rows where the cell is blank).
  const quantity = toNumber(get('quantity')) ?? 1;

  // ---- marketplace-specific extras --------------------------------------
  const paymentMode = marketplace === 'BM' ? toNonEmptyString(get('paymentMode')) : undefined;
  const hasPayPalKlarna = marketplace === 'BM' && paymentMode
    ? /paypal|klarna|clearpay|clear pay|applepay/i.test(paymentMode)
    : false;

  // Read postage from every marketplace's sheet — the file's value wins
  // over the marketplace default. eBay's legacy £1/£2/£8 tier model still
  // routes through `eBayShippingTier`; any other numeric value (including
  // the 2026-05 schema's free-form Postage column) is treated as a generic
  // `postageOverride` for calcSaleFinancials.
  const rawPostage = toNumber(get('postage')) ?? toNumber(get('shipping'));
  let eBayShippingTier: 1 | 2 | 8 | undefined;
  let postageOverride: number | undefined;
  if (marketplace === 'EBAY' && (rawPostage === 1 || rawPostage === 2 || rawPostage === 8)) {
    eBayShippingTier = rawPostage as 1 | 2 | 8;
  } else if (rawPostage != null && rawPostage >= 0) {
    postageOverride = rawPostage;
  }

  // Marketing — eBay 2026-05 schema only. Pass the file's value when
  // present so the recompute matches the operator's sheet penny-for-penny.
  const marketingFromFile = marketplace === 'EBAY' ? toNumber(get('marketing')) : undefined;

  // Operator-overridden Acc cell (e.g. £0 for a generic accessory SKU
  // that doesn't carry the £1 bundle). When present, trumps the per-
  // marketplace `fee.accessoryFee` default in calcSaleFinancials.
  const accFromFile = toNumber(get('acc'));

  // BM-only: Customer Care Fees is operator-entered per line (live file
  // shows £8.99 on some rows where the legacy default was £9.99). Read
  // and override so the recompute matches the file penny-for-penny.
  const ccfFromFile = marketplace === 'BM' ? toNumber(get('customerCareFees')) : undefined;

  // Operator-zero-rated P. VAT — when the file's P. VAT cell is 0 but
  // postage is > 0, the operator is explicitly zero-rating VAT on this
  // line (VAT-exempt shipment / non-VATable accessory SKU). We translate
  // that into the `postageVatExempt` flag so the recompute reproduces
  // the operator's intent byte-for-byte.
  const pVatFromFile = toNumber(get('pVat'));
  const explicitVatExempt =
    pVatFromFile === 0 && rawPostage != null && rawPostage > 0;

  // ---- recompute every derived field ------------------------------------
  const fin = calcSaleFinancials({
    marketplace, buyPrice, salePrice,
    postageOverride, eBayShippingTier, hasPayPalKlarna,
    marketing: marketingFromFile,
    accessoryFeeOverride: accFromFile,
    customerCareFeesOverride: ccfFromFile,
    postageVatExempt: explicitVatExempt || undefined,
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
    // Persist the operator's P. VAT zero-rate signal on the Sale doc so
    // the exporter can write P. VAT as a literal 0 (not the postage×20%
    // formula) and a re-import round-trips correctly. Without this, the
    // exported P. VAT cell always reapplies 20% of postage, losing the
    // operator's per-row VAT-exempt decision.
    postageVatExempt: explicitVatExempt || undefined,
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

/**
 * Stricter check used when deciding whether to emit a "missing both
 * orderNumber AND imei" error. A row is considered to carry MEANINGFUL
 * data only when an IDENTIFIER STRING (sku or supplier) is present.
 *
 * Money columns (BP / SP / commission / etc.) are deliberately NOT
 * checked, because SheetJS fabricates phantom numeric values for
 * cells past the operator's data section when the workbook defines
 * shared formulas (e.g. K2:K157 = (H*6.9%)−(H*6.9%)*10%). For rows
 * outside that range, the worksheet has zero real cell objects but
 * `sheet_to_json` still synthesises BP, SP, computed columns, etc.
 * Filtering on identifier strings ignores those phantom rows and only
 * flags rows where the operator typed real text without an ID.
 */
function hasFinancialValue(row: any[], cols: Partial<Record<ColKey, number>>): boolean {
  for (const k of ['sku', 'supplier'] as const) {
    const i = cols[k];
    if (i === undefined) continue;
    const v = row[i];
    if (typeof v === 'string' && v.trim() !== '') return true;
  }
  return false;
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
      // Synthesize a 5-sheet workbook in memory with one row per marketplace.
      const make = (rows: any[][]) => XLSX.utils.aoa_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, make([
        ['nw', 'Order Number', 'SKU', 'IMEI', 'Supplier', 'Quantity', 'BP', 'SP'],
        [new Date('2026-05-12T00:00:00Z'), 'AMZ-1', 'SKU1', '353209102768686', 'NIHAL', 1, 200, 300],
      ]), 'AMAZON');
      XLSX.utils.book_append_sheet(wb, make([
        ['Date', 'Order No', 'SKU', 'IMEI', 'Supplier', 'Quantity', 'BP', 'SP', 'Payment Mode'],
        [new Date('2026-05-12T00:00:00Z'), 'BM-1', 'SKU2', 'NL6CMQCYTD', 'MHL', 1, 150, 250, 'PayPal'],
      ]), 'BM');
      XLSX.utils.book_append_sheet(wb, make([
        ['DATE', 'ORDER NUMBER', 'SKU', 'IMEI NUMBER', 'SUPPLIER', 'UNITS', 'BP', 'SP', 'SHIPPING'],
        [new Date('2026-05-12T00:00:00Z'), 'EB-1', 'SKU3', 'SKC9P3QVP6F', 'IMAX', 1, 100, 200, 2],
      ]), 'EBAY');
      XLSX.utils.book_append_sheet(wb, make([
        ['DATE', 'Order Number', 'SKU', 'IMEI', 'Supplier', 'BP', 'SP'],
        [new Date('2026-05-12T00:00:00Z'), 'OB-1', 'SKU4', '111222333444555', 'ABC', 90, 180],
      ]), 'ONBUY');
      const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
      const out = await parseSalesWorkbook(buf, 'fixture.xlsx');

      expect(out.errors).toEqual([]);
      expect(out.perSheetCounts).toEqual({ AMAZON: 1, BM: 1, EBAY: 1, ONBUY: 1 });
      expect(out.sales).toHaveLength(4);
      // BM PayPal path applied → payPalKlarnaCom must be populated.
      const bm = out.sales.find((s) => s.marketplace === 'BM')!;
      expect(bm.paymentMode).toBe('PayPal');
      expect(bm.payPalKlarnaCom).toBeGreaterThan(0);
      // ONBUY defaulted quantity to 1 even with no QUANT column.
      const ob = out.sales.find((s) => s.marketplace === 'ONBUY')!;
      expect(ob.quantity).toBe(1);
      // OnBuy IMEI preserved as the full 15-digit string (no scientific form).
      expect(ob.imei).toBe('111222333444555');
      // Doc id follows the natural-dedupe convention.
      expect(bm.id).toBe('BM__BM-1');
    });
  });
}
