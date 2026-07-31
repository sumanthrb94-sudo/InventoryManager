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
import type { Marketplace, Sale, ReturnCategory } from '../types';
import { MARKETPLACES } from '../types';
import { calcSaleFinancials } from './platforms';
import { isPlaceholderImeiText } from './imeiValidation';

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/** One row of the Sales Report's "Returns Detail" tab (clientReport.ts's
 *  writeReturnsSheets — the same Summary/Returns Detail/Unit Histories
 *  structure the standalone Returns Report uses, embedded here), keyed by
 *  marketplace + IMEI (the sheet is one row per UNIT's latest return
 *  cycle — it carries no Order Number) so the confirm step can join it
 *  back to the sale it describes. This is the ONE piece of return state
 *  that lives on the InventoryUnit, not the Sale — see
 *  restoreUnitReturnFromImport in inventoryService.ts. */
export interface ParsedReturnRow {
  marketplace: Marketplace;
  imei: string;
  returnType?: ReturnCategory;
}

/** Parsed payload returned by `parseSalesWorkbook`. Caller adds provenance fields. */
export interface ParsedSales {
  sales: Omit<Sale, 'importBatchId' | 'importedAt' | 'createdAt' | 'updatedAt' | 'ownerId'>[];
  perSheetCounts: Record<Marketplace, number>;
  errors: { sheet: string; row: number; message: string }[];
  /** Rows from the workbook's 'Returns' tab, when present — empty array for
   *  a file that predates this sheet (e.g. a per-marketplace channel export
   *  that never had one) or one uploaded via onlyMarketplace mode. Optional
   *  so a hand-built ParsedSales fixture (tests predating this field) still
   *  type-checks; every real parseSalesWorkbook call always sets it. */
  returnRows?: ParsedReturnRow[];
}

/**
 * Parse a SALES_REPORT workbook into canonical `Sale` rows.
 *
 * @param file        Either a browser `File` (drag-drop) or an `ArrayBuffer`
 *                    (Node fixture / tests).
 * @param sourceFile  Logical name of the source file, stored on every parsed
 *                    sale for provenance (e.g. "SALES_REPORT_2026.xlsx").
 */
export interface ParseSalesOptions {
  /**
   * Parse the workbook as a SINGLE marketplace.
   *
   * Marketplaces send their reports separately, so an operator usually
   * has one file per channel rather than one workbook with four sheets.
   * With this set we look for that marketplace's sheet by name and, if
   * the workbook doesn't have one, fall back to its FIRST sheet — an
   * Amazon export named "Sheet1" is still an Amazon report. The other
   * three marketplaces are not looked for at all, so a single-channel
   * upload no longer reports three "sheet missing" errors.
   */
  onlyMarketplace?: Marketplace;
}

export async function parseSalesWorkbook(
  file: File | ArrayBuffer,
  sourceFile: string,
  options: ParseSalesOptions = {},
): Promise<ParsedSales> {
  const buf: ArrayBuffer = file instanceof ArrayBuffer ? file : await file.arrayBuffer();
  // NOTE: no `cellDates` — we want date cells as raw Excel SERIALS (numbers), so
  // toIsoDate() resolves the calendar day via XLSX.SSF (timezone-independent).
  // With cellDates SheetJS hands back a Date pinned to LOCAL midnight, which in
  // an ahead-of-UTC zone (e.g. IST) falls on the PREVIOUS UTC day — that was the
  // off-by-one that turned 1-Apr into 31-Mar (and cascaded to 29-Mar on re-import).
  const wb = XLSX.read(buf, { type: 'array', raw: true, cellText: true });

  // SheetJS strips font colours, so do a parallel ExcelJS pass on the same
  // bytes to harvest red-row markers. The operator paints whole rows red on
  // their Sales Report sheet to flag returns / refunds / chargebacks — we
  // preserve that signal end-to-end so the import surfaces the same red rows
  // in every downstream view.
  const { flagged: flaggedRowsBySheet, annotations: annotationsBySheet } = await detectFlaggedRows(buf);

  const sales: ParsedSales['sales'] = [];
  const errors: ParsedSales['errors'] = [];
  const perSheetCounts: Record<Marketplace, number> = {
    AMAZON: 0, BM: 0, EBAY: 0, ONBUY: 0, TEMU: 0,
  };

  // Track mean SP per marketplace — surfaces the SP=£0 column-detection bug
  // immediately at parse time instead of leaking into Firestore unnoticed.
  const spSum: Record<Marketplace, number> = { AMAZON: 0, BM: 0, EBAY: 0, ONBUY: 0, TEMU: 0 };

  const targets: readonly Marketplace[] = options.onlyMarketplace
    ? [options.onlyMarketplace]
    : MARKETPLACES;

  for (const marketplace of targets) {
    // Single-marketplace mode: a named sheet still wins, but a one-sheet
    // export straight from the channel rarely has one, so fall back to the
    // first sheet rather than rejecting a perfectly good file.
    const sheetName = findSheetName(wb, marketplace)
      ?? (options.onlyMarketplace ? wb.SheetNames[0] : undefined);
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

    const flaggedRows = flaggedRowsBySheet.get(sheetName.toLowerCase()) ?? new Set<number>();
    const annotations = annotationsBySheet.get(sheetName.toLowerCase()) ?? new Map<number, string>();

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      // sourceRow is 1-based and accounts for the header row (matches xlsx UX)
      const sourceRow = r + 1;
      const parsed = parseRow(marketplace, row, colIdx, sheetName, sourceRow, sourceFile, errors);
      if (parsed) {
        if (flaggedRows.has(sourceRow)) {
          parsed.flagged = true;
          // Per operator: red highlighting is a VISUAL SIGNAL ONLY —
          // the row stays in revenue / GP rollups. Don't flip voidedAt
          // or assume it's a refund. We DO capture any free-text
          // annotation the operator typed ("Refund Done",
          // "RETURN FOR REFUND", etc.) into the comments field so the
          // note is preserved alongside the sale — but only when the
          // row didn't already carry a comment from the schema.
          const annotation = annotations.get(sourceRow);
          if (annotation && !parsed.comments) {
            parsed.comments = annotation;
          }
        }
        // Expand multi-IMEI cells (e.g. "351554748581221 / 351554746670497")
        // into individual Sale rows, one per IMEI, with proportionally split
        // BP and SP. This covers bulk Amazon orders where the operator puts
        // all IMEIs for a multi-unit shipment into a single cell.
        const expandedRows = expandMultiImei(parsed);
        for (const expanded of expandedRows) {
          sales.push(expanded);
          perSheetCounts[marketplace]++;
          spSum[marketplace] += expanded.salePrice ?? 0;
        }
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

  const returnRows = parseReturnsTab(wb);

  return { sales, perSheetCounts, errors, returnRows };
}

/** Header → label reverse-lookup for the Returns tab's Return Type column
 *  (clientReport.ts returnTypeLabel, inverted). Unrecognised / blank text
 *  (a file from before this column existed, or a row the operator never
 *  filled in) yields undefined — restoration then simply skips the unit
 *  side for that row rather than guessing. */
function parseReturnTypeLabel(label: unknown): ReturnCategory | undefined {
  const s = String(label ?? '').trim().toLowerCase();
  if (s === 'back to inventory') return 'returned_to_inventory';
  if (s === 'in repair') return 'repair';
  if (s === 'to supplier') return 'returned_to_supplier';
  return undefined;
}

/** Read the workbook's "Returns Detail" tab (clientReport.ts's
 *  writeReturnsSheets — the same Summary/Returns Detail/Unit Histories
 *  structure as the standalone Returns Report) by header name — a single
 *  fixed schema, unlike the per-marketplace tabs, so no
 *  SHEET_LAYOUTS/positional-fallback machinery is needed here. Absent
 *  sheet (older export, or a single-marketplace channel file that never
 *  had one) is not an error — just an empty result. One row per UNIT's
 *  latest return cycle, keyed by marketplace + Unit IMEI (no Order Number
 *  column — this sheet is unit-scoped, not order-scoped). */
function parseReturnsTab(wb: XLSX.WorkBook): ParsedReturnRow[] {
  const sheetName = wb.SheetNames.find((n) => n.trim().toLowerCase() === 'returns detail');
  if (!sheetName) return [];
  const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[sheetName], {
    header: 1, raw: true, defval: null, blankrows: false,
  });
  if (rows.length < 2) return [];

  const header = rows[0].map((h: unknown) => normHeader(h));
  const idx = (name: string) => header.indexOf(normHeader(name));
  const marketplaceCol = idx('marketplace');
  const imeiCol = idx('unit imei');
  const returnTypeCol = idx('return type');
  if (marketplaceCol < 0 || imeiCol < 0) return [];

  const out: ParsedReturnRow[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const marketplace = toNonEmptyString(row[marketplaceCol]);
    const imei = toNonEmptyString(row[imeiCol]);
    if (!marketplace || !MARKETPLACES.includes(marketplace as Marketplace)) continue;
    if (!imei) continue; // legacy return with no linked voided sale to source a marketplace/IMEI from
    out.push({
      marketplace: marketplace as Marketplace,
      imei,
      returnType: returnTypeCol >= 0 ? parseReturnTypeLabel(row[returnTypeCol]) : undefined,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Per-sheet column layouts (logical name → list of accepted header aliases)
// ---------------------------------------------------------------------------

type ColKey =
  | 'date' | 'orderNumber' | 'sku' | 'imei' | 'supplier'
  | 'quantity' | 'buyPrice' | 'salePrice'
  | 'paymentMode' | 'shipping' | 'netProfit'
  | 'postage' | 'comments'
  // Temu only — its export reports the real per-order commission (and the
  // VAT Temu charged on that commission) directly, since Temu's referral
  // rate varies by category and can't be modelled as one flat percentage
  // the way Amazon's can. See calcSaleFinancials' TEMU branch.
  | 'commission' | 'commissionVat'
  // The return-linkage block every marketplace tab already writes for a
  // voided row (clientReport.ts writeReturnBlock) but which no importer
  // has ever read back — see restoreVoidedSaleFromRow below. Header-match
  // only, deliberately no positional fallback: a miss here just means "no
  // restoration for this row", never a silently wrong column read.
  | 'returnDate' | 'voidOutcome' | 'voidReason';

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
// Exported so src/__tests__/lib/schemaAlignment.test.ts can check every
// fallback index against the real template headers. A wrong index is
// invisible until a file with a renamed header shows up, at which point it
// reads the wrong column silently — so it needs pinning at the source, not
// in a copy of the table.
export const SHEET_LAYOUTS: Record<Marketplace, SheetLayout> = {
  // AMAZON cols (15):  Date | Order Number | SKU | IMEI | Supplier | Quantity |
  //                    BP | SP | SP-BP | Marginal Tax | Commission | Postage |
  //                    GP | GP % | Comments
  //
  // The date header was `nw` — a typo in the original operator workbook that
  // became the schema by accident, and the only column in any marketplace
  // whose name didn't say what it held. Templates now emit `Date`, matching
  // the other three sheets AND what this app's own Sales Report exports.
  // `nw` stays an accepted alias forever: operators have years of files
  // carrying it, and dropping it would reject them at the door.
  AMAZON: {
    columns: {
      date:        ['date', 'nw'],
      orderNumber: ['order number', 'order no'],
      sku:         ['sku'],
      imei:        ['imei', 'imei number'],
      supplier:    ['supplier'],
      quantity:    ['quantity', 'units', 'quant'],
      buyPrice:    ['bp'],
      salePrice:   ['sp'],
      postage:     ['postage'],
      comments:    ['comments'],
      returnDate:  ['return date'],
      voidOutcome: ['outcome'],
      voidReason:  ['return reason'],
    },
    fallback: {
      date: 0, orderNumber: 1, sku: 2, imei: 3, supplier: 4,
      // Postage is col 11 (0-indexed) in the 15-col AMAZON layout; Comments
      // is the last column, 14. This read `postage: 14` — the same index as
      // comments — so a file whose Postage header failed to match had its
      // free-text Comments cell parsed as the postage cost, which
      // parseNumber turns into 0. Silent, and it overstates GP by exactly
      // the postage. Only ever fired on the positional path, which is why
      // it survived: every well-formed file matches by header first.
      quantity: 5, buyPrice: 6, salePrice: 7, postage: 11, comments: 14,
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
      imei:        ['imei', 'imei number'],
      supplier:    ['supplier'],
      quantity:    ['quantity', 'units', 'quant'],
      buyPrice:    ['bp'],
      salePrice:   ['sp'],
      paymentMode: ['payment mode'],
      postage:     ['postage'],
      comments:    ['comments'],
      returnDate:  ['return date'],
      voidOutcome: ['outcome'],
      voidReason:  ['return reason'],
    },
    fallback: {
      date: 0, orderNumber: 1, sku: 2, imei: 3, supplier: 4,
      quantity: 5, buyPrice: 6, salePrice: 7, paymentMode: 8, postage: 13, comments: 16,
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
      imei:        ['imei number', 'imei'],
      supplier:    ['supplier'],
      quantity:    ['units', 'quantity', 'quant'],
      buyPrice:    ['bp'],
      salePrice:   ['sp'],
      // eBay's Shipping IS the Postage fee — same field, two header names
      // depending on which sheet version the operator exported.
      shipping:    ['shipping', 'postage'],
      netProfit:   ['np(incl. promotion)', 'np incl. promotion', 'np'],
      comments:    ['comments'],
      returnDate:  ['return date'],
      voidOutcome: ['outcome'],
      voidReason:  ['return reason'],
    },
    fallback: {
      date: 0, orderNumber: 1, sku: 2, imei: 3, supplier: 4,
      quantity: 5, buyPrice: 6, salePrice: 7, shipping: 15, netProfit: 18,
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
      imei:        ['imei', 'imei number'],
      supplier:    ['supplier'],
      buyPrice:    ['bp'],
      salePrice:   ['sp'],
      postage:     ['postage'],
      comments:    ['comments'],
      returnDate:  ['return date'],
      voidOutcome: ['outcome'],
      voidReason:  ['return reason'],
    },
    fallback: {
      date: 0, orderNumber: 1, sku: 2, imei: 3, supplier: 4,
      // NB: BP at 5, SP at 6 — one less than the other marketplaces because
      // OnBuy has no Quantity column.
      buyPrice: 5, salePrice: 6, postage: 11, comments: 14,
    },
    required: ['date', 'orderNumber', 'buyPrice', 'salePrice'],
  },
  // TEMU cols (19), from the client's final Temu formula export
  // (TEMU_FORMULA.csv) — its OWN layout, not Amazon's 15-col one:
  //   Date | Order Number | SKU | IMEI | Supplier | Quantity | BP | SP |
  //   SP-BP | Marginal Tax | Commission | Commission VAT | Postage |
  //   P. VAT | Acc | Total VAT | GP | GP % | Total VAT NTP
  // SP-BP / Marginal Tax / P. VAT / Acc / Total VAT / GP / GP% / Total VAT
  // NTP are all recomputed (never trust the sheet's cached formula text —
  // see calcSaleFinancials). Commission and Commission VAT are the two
  // exceptions: Temu's referral rate varies by category, so the export
  // reports what it actually charged per order rather than a flat rate the
  // operator could compute themselves; those two columns ARE read as given.
  // No Comments column in this schema.
  TEMU: {
    columns: {
      date:         ['date'],
      orderNumber:  ['order number', 'order no'],
      sku:          ['sku'],
      imei:         ['imei', 'imei number'],
      supplier:     ['supplier'],
      quantity:     ['quantity', 'units', 'quant'],
      buyPrice:     ['bp'],
      salePrice:    ['sp'],
      commission:   ['commission'],
      commissionVat: ['commission vat', 'commissionvat', 'c. vat'],
      postage:      ['postage'],
      comments:     ['comments'],
      returnDate:   ['return date'],
      voidOutcome:  ['outcome'],
      voidReason:   ['return reason'],
    },
    fallback: {
      date: 0, orderNumber: 1, sku: 2, imei: 3, supplier: 4,
      quantity: 5, buyPrice: 6, salePrice: 7,
      commission: 10, commissionVat: 11, postage: 12,
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
async function detectFlaggedRows(buf: ArrayBuffer): Promise<{
  flagged: Map<string, Set<number>>;
  annotations: Map<string, Map<number, string>>;
}> {
  const flaggedResult = new Map<string, Set<number>>();
  const annotResult = new Map<string, Map<number, string>>();
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    for (const ws of wb.worksheets) {
      const key = ws.name.trim().toLowerCase();
      const flagged = new Set<number>();
      const annot = new Map<number, string>();
      ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
        if (rowNum === 1) return; // header
        const colCount = (row as any).cellCount || 30;
        // Scan EVERY cell in the row. Operators paint the row red in
        // different places depending on the marketplace sheet — some
        // colour the DATE/ORDER cells, others highlight just the
        // GP/GP%/Total VAT NTP cells (cols V/W/X). Earlier 3-column
        // probe missed the GP-only paint pattern in the operator's
        // live workbook. Performance-wise this is still ~30 cell
        // reads per row, dwarfed by the parse work downstream.
        for (let c = 1; c <= colCount; c++) {
          const cell = row.getCell(c);
          if (isRedishCell(cell)) flagged.add(rowNum);
          // Capture any free-text refund annotation the operator typed
          // in a column past the documented schema ("Refund Done",
          // "RETURN FOR REFUND", "Chargeback", etc.). Used as the
          // Sale.voidReason so the in-app Returns trail surfaces the
          // operator's note instead of a generic "voided" label.
          const v = (cell.value as any);
          if (typeof v === 'string') {
            const lo = v.trim().toLowerCase();
            if (lo && (lo.includes('refund') || lo.includes('return') || lo.includes('chargeback') || lo.includes('dispute'))) {
              if (!annot.has(rowNum)) annot.set(rowNum, v.trim());
              flagged.add(rowNum);
            }
          }
        }
      });
      if (flagged.size > 0) flaggedResult.set(key, flagged);
      if (annot.size > 0) annotResult.set(key, annot);
    }
  } catch (err) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[salesImport] red-row detection skipped:', (err as Error)?.message || err);
    }
  }
  return { flagged: flaggedResult, annotations: annotResult };
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
/** Resolve the workbook tab that holds rows for `marketplace`.
 *  The client's working files name the tabs in two styles:
 *    1. Strict canonical — "AMAZON", "BM", "EBAY", "ONBUY".
 *    2. Suffixed         — "AMAZON SALES", "BM SALES", etc.
 *  Older operator copies use style 1; the live tracker now uses
 *  style 2. We accept either: try exact (case-insensitive, trimmed)
 *  first, then fall back to a token-match that treats the sheet
 *  name as words split on non-letters. "AMAZON SALES" tokenises to
 *  ["AMAZON","SALES"] which includes "AMAZON" → match. "AMAZONIA"
 *  tokenises to ["AMAZONIA"] which doesn't include "AMAZON" → no
 *  false positive. */
function findSheetName(wb: XLSX.WorkBook, marketplace: Marketplace): string | undefined {
  const want = marketplace.toUpperCase();
  const exact = wb.SheetNames.find((n: string) => n.trim().toUpperCase() === want);
  if (exact) return exact;
  return wb.SheetNames.find((n: string) => {
    const tokens = n.toUpperCase().split(/[^A-Z]+/).filter(Boolean);
    return tokens.includes(want);
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
      // Skip when there's clearly a *different* labelled column at the
      // fallback position — the operator's workbook genuinely doesn't
      // have this field, and the slot now holds someone else's data
      // (e.g. AMAZON_LAYOUT's fallback for `comments` is index 14, but
      // the live SALES_REPORT now has `Postage` at index 14, so taking
      // the fallback would import postage values into the Sale.comments
      // string field). The fallback is meant for header-less / corrupted
      // header rows, not for legitimately-renamed-or-removed columns.
      const positionalHeader = normalised[fallbackIdx];
      const headerMatchesAlias = aliases.includes(positionalHeader);
      const headerEmpty = !positionalHeader;
      if (!alreadyTaken && (headerEmpty || headerMatchesAlias)) {
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

  // ---- empty / template-residue gate -----------------------------------
  // Operator working sheets often have formulas (=H180-G180, =I180*16.67%,
  // etc.) dragged down past the last real sale. The formulas evaluate
  // against blank inputs and produce non-null numeric results — so the
  // row has values in BP/SP/SP-BP/Commission columns but null in
  // date/orderNumber/imei/sku. Without this gate hasAnyValue() returned
  // true on those rows and the parser surfaced "missing both
  // orderNumber AND imei" as a hard error, even though there's no
  // actual sale there. The new rule: a row is only a real attempt at
  // a sale when at least one of the three identifying columns
  // (date / orderNumber / imei) has a value. Otherwise silently skip.
  const orderNumber = toNonEmptyString(get('orderNumber'));
  let imei = toNonEmptyString(get('imei'));
  const dateRaw = get('date');
  // The client's own Sales Report export appends a bold "TOTAL" footer row
  // to every marketplace sheet (clientReport.ts writeMarketplaceTotalsRow),
  // with the literal string "TOTAL" sitting in the Date column and every
  // other identifying column blank. That string alone satisfied the
  // "has a date" check below, so the footer survived the empty-row gate and
  // fell straight into "missing both orderNumber AND imei" — a hard error on
  // every re-upload of the app's own export. A footer row is never a sale;
  // skip it silently, the same as a genuinely blank row.
  if (typeof dateRaw === 'string' && dateRaw.trim().toUpperCase() === 'TOTAL') {
    return null;
  }
  const hasDate =
    dateRaw instanceof Date
    || (typeof dateRaw === 'number' && Number.isFinite(dateRaw) && dateRaw > 0)
    || (typeof dateRaw === 'string' && dateRaw.trim() !== '');
  if (!orderNumber && !imei && !hasDate) {
    return null;
  }

  // ---- identifiers ------------------------------------------------------
  if (!orderNumber && !imei) {
    // Row has a date but neither an orderNumber nor an IMEI — a real
    // data entry mistake, surface to the operator.
    errors.push({ sheet: sheetName, row: sourceRow, message: 'missing both orderNumber AND imei' });
    return null;
  }
  if (!orderNumber) {
    errors.push({ sheet: sheetName, row: sourceRow, message: 'missing orderNumber' });
    return null;
  }

  // A no-IMEI item (charger, SIM pins, cables) sometimes gets entered on a
  // marketplace's phone/tablet sheet instead of the app's own no-IMEI
  // accessory flow, with a plain-English "there's no IMEI" placeholder in
  // the IMEI cell (e.g. "GENERIC", "not mentioned in App"). Left as-is,
  // that non-blank cell forces the sale through the device audit-
  // completion gate demanding a fake Model/IMEI for something that was
  // never a device. Blank it here so the row flows through exactly like
  // any other accessory sale (SKU-matched stock decrement, no device
  // audit) — same as if the cell had simply been empty to begin with.
  if (isPlaceholderImeiText(imei)) imei = '';

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

  let eBayShippingTier: 1 | 2 | 8 | undefined;
  if (marketplace === 'EBAY') {
    const ship = toNumber(get('shipping'));
    if (ship === 1 || ship === 2 || ship === 8) eBayShippingTier = ship;
  }

  // Postage from the workbook — operator-entered per row. Used as the
  // postageOverride into calcSaleFinancials so the import preserves
  // whatever the operator typed instead of falling back to the
  // marketplace's 0 default. For eBay we already prefer
  // eBayShippingTier (when the row's shipping value is one of the
  // documented tiers 1/2/8), but anything else (e.g. £6.30) still
  // flows through postageOverride.
  const postageFromSheet = toNumber(
    marketplace === 'EBAY' ? get('shipping') : get('postage'),
  );
  const postageOverride: number | undefined =
    postageFromSheet > 0 && postageFromSheet !== eBayShippingTier
      ? postageFromSheet
      : undefined;

  // Temu only — 'commission'/'commissionVat' aren't in any other
  // marketplace's column map, so get() returns undefined for them there
  // and this is a no-op everywhere except TEMU.
  const commissionOverride = toNumber(get('commission'));
  const commissionVatOverride = toNumber(get('commissionVat'));

  // ---- recompute every derived field ------------------------------------
  const fin = calcSaleFinancials({
    marketplace, buyPrice, salePrice,
    postageOverride, eBayShippingTier, hasPayPalKlarna,
    commissionOverride, commissionVatOverride,
  });

  const supplierName = toNonEmptyString(get('supplier'));
  const sku = toNonEmptyString(get('sku'));
  const comments = toNonEmptyString(get('comments'));

  // Doc id = marketplace__orderNumber__discriminator. The discriminator
  // is the IMEI when present, else the SKU, else the sheet row index.
  // Rationale: one customer / wholesale order can legitimately ship
  // multiple phones (e.g. an Amazon order with 3 line items, one per
  // IMEI). The previous `marketplace__orderNumber` format collided
  // those rows and dbService.bulkUpsertSales then overwrote N-1 of
  // them on the way to Firestore, silently dropping real sales. The
  // composite below stays deterministic across re-imports of the same
  // file (so dedupe still works) while distinguishing per-phone rows
  // sharing a single order number.
  //
  // Backwards compat: any historical sale docs written under the old
  // shorter ID format become orphans. Wipe + re-import the Sales
  // collection to reconcile, or leave the orphans — they don't break
  // any read path, just slightly inflate the "All Sales" count until
  // cleaned up.
  // Firestore doc ids can't contain forward slashes (`/` is the
  // path-segment separator), and operator IMEI cells in the live
  // workbook sometimes hold two IMEIs separated by " / " for the
  // same order. Sanitise both the order number and the
  // discriminator so the composite stays a single valid segment.
  // Backslashes are also illegal; control characters are scrubbed
  // defensively. Trailing/leading whitespace removed.
  const idDiscriminator = sanitiseFsIdSegment(imei || sku || `r${sourceRow}`);
  const id = `${marketplace}__${sanitiseFsIdSegment(orderNumber)}__${idDiscriminator}`;

  // ---- void/return restoration --------------------------------------------
  // The trailing Return Date / Outcome / Return Reason block is written on
  // EVERY export (clientReport.ts writeReturnBlock) but, until this round,
  // no importer read it back — so re-uploading a Sales Report after a wipe
  // silently dropped every return to a plain active sale. Only set these
  // when Return Date is actually filled in; a blank cell is an active sale,
  // exactly as before. See restoreUnitReturnFromImport (inventoryService.ts)
  // for the unit-side half of this restoration.
  const restoredVoidedAt = toIsoDate(get('returnDate'));
  let restoredVoidOutcome: 'refund' | 'replacement' | 'repair' | undefined;
  let restoredVoidReason: string | undefined;
  if (restoredVoidedAt) {
    const outcomeRaw = (toNonEmptyString(get('voidOutcome')) || '').trim().toLowerCase();
    restoredVoidOutcome =
      outcomeRaw === 'replacement' ? 'replacement' :
      outcomeRaw === 'in repair' || outcomeRaw === 'repair' ? 'repair' :
      'refund';
    restoredVoidReason = toNonEmptyString(get('voidReason'));
  }

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
    ...(restoredVoidedAt ? {
      voidedAt: restoredVoidedAt,
      voidOutcome: restoredVoidOutcome,
      voidReason: restoredVoidReason,
    } : {}),
  };
}

// ---------------------------------------------------------------------------
// Cell coercion helpers
// ---------------------------------------------------------------------------

function hasAnyValue(row: any[]): boolean {
  return row.some((v) => v !== null && v !== undefined && String(v).trim() !== '');
}

/**
 * Expand a parsed row whose `imei` field contains multiple IMEIs separated
 * by " / " (e.g. "351554748581221 / 351554746670497") into individual rows,
 * one per IMEI. BP and SP are divided evenly across the split rows so the
 * total revenue stays the same. Rows without a multi-IMEI value are returned
 * as-is in a single-element array.
 *
 * Also covers combined tablet/Apple-serial orders (e.g.
 * "R52H70ZDQAX / R52HA12QETX" — two tablets sold under one order row) —
 * each part just needs to look like a real identifier, numeric IMEI or
 * 10-12 char alphanumeric serial, not specifically 15 digits.
 */
function expandMultiImei(
  parsed: ParsedSales['sales'][number],
): ParsedSales['sales'][number][] {
  if (!parsed.imei) return [parsed];

  // Split on " / " or "/" with optional surrounding whitespace.
  const parts = parsed.imei.split(/\s*\/\s*/).map((s) => s.trim()).filter(Boolean);
  // Only expand when every part looks like a valid identifier: a 14-15
  // digit numeric IMEI, or a 10-12 char alphanumeric serial.
  const looksLikeIdentifier = (p: string) => /^\d{14,15}$/.test(p) || /^[A-Z0-9]{10,12}$/i.test(p);
  const allValid = parts.every(looksLikeIdentifier);
  if (parts.length <= 1 || !allValid) return [parsed];

  const n = parts.length;
  return parts.map((singleImei) => {
    const idDisc = sanitiseFsIdSegment(singleImei);
    const id = `${parsed.marketplace}__${sanitiseFsIdSegment(parsed.orderNumber ?? '')}__${idDisc}`;
    return {
      ...parsed,
      id,
      imei: singleImei,
      quantity: 1,
      buyPrice: parsed.buyPrice != null ? Math.round((parsed.buyPrice / n) * 100) / 100 : parsed.buyPrice,
      salePrice: parsed.salePrice != null ? Math.round((parsed.salePrice / n) * 100) / 100 : parsed.salePrice,
    };
  });
}

/** Sanitise a string for use as a Firestore document-id segment.
 *  Forward slashes turn into underscores (Firestore treats `/` as a
 *  path separator, so leaving it in would split one id into multiple
 *  segments and trigger "Invalid document reference. Document
 *  references must have an even number of segments"). Backslashes
 *  and ASCII control chars are also scrubbed for parity. Used by
 *  both `parseRow` in this file and `recordSale` in
 *  src/services/salesService.ts so the in-app + import write paths
 *  produce identical composite ids for the same sale. */
export function sanitiseFsIdSegment(s: string): string {
  // Replace forbidden chars with `_`. Forward slash is the path
  // separator in Firestore; backslash + ASCII control chars (0x00-0x1F
  // and 0x7F DEL) are scrubbed defensively. Hyphens / dots / colons
  // stay intact so hyphenated order numbers (`206-5248339-8852336`)
  // survive.
  return String(s ?? '').replace(/[/\\\u0000-\u001f\u007f]/g, '_').trim();
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
  // Already ISO yyyy-mm-dd → take it verbatim (no Date round-trip = no tz shift).
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) return formatIsoDate(parsed);
  return undefined;
}

function formatIsoDate(d: Date): string {
  // LOCAL accessors: a date STRING like "1-Apr-2026" is parsed by JS as local
  // midnight, so local getters read back the same calendar day. (Real Excel date
  // cells never reach here — they arrive as numeric serials and resolve via
  // XLSX.SSF above, which is timezone-independent.)
  return `${pad4(d.getFullYear())}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
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
