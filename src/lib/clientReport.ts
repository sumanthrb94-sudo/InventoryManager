/**
 * clientReport.ts — daily Excel report writer for the client master files.
 *
 * Produces two workbooks that are byte-for-byte compatible (in sheet names,
 * headers, column widths, cell formats and formula strings) with the client's
 * INVENTORY_REPORT_${YYYY}_${M}.xlsx and SALES_REPORT_${YYYY}.xlsx artefacts.
 *
 * IMPORTANT: this file uses `exceljs` (NOT the `xlsx` / SheetJS-CE package),
 * because we need to write Excel formulas and per-cell number formats together
 * and SheetJS-CE cannot do that reliably.
 *
 * Spec: see MASTER_FILES_SPEC.md. Per-marketplace formulas come from
 * `excelFormulaFor()` in ./platforms.ts so the runtime calculator and the
 * exported workbook stay in lock-step.
 */

import ExcelJS from 'exceljs';
import type {
  InventoryUnit,
  Sale,
  InventoryAggregate,
  SupplierWhatsappUpdate,
  Supplier,
  Marketplace,
} from '../types';
import { MARKETPLACES } from '../types';
import { excelFormulaFor } from './platforms';
import { recomputeSale } from './recomputeSale';

/** Unified flat schema for the ALL sheet. 22 columns: buy schema (9)
 *  first, then sale fields (13). Marketplace is a column, not a tab. */
const ALL_HEADERS = [
  // Buy side (9)
  'Stock In Date', 'Model', 'IMEI', 'Grade', 'Storage', 'Colour',
  'Supplier', 'BP', 'Notes',
  // STATUS sits right after the buy block so the operator sees it
  // immediately on scroll — "Sold" / "Back to Stock" / "Repair" / "RTS"
  // (return to supplier). Voided rows also fill red across the row.
  'Status',
  // Sale side (13)
  'Sale Date', 'Marketplace', 'Order Number', 'SKU', 'SP',
  'Payment Mode', 'Postage', 'SP - BP', 'Tax', 'Commission',
  'GP', 'GP %', 'NP',
];

/** Map the unit's ReturnCategory to a short status label. Falls back to a
 *  generic "Returned" when the sale is voided but the linked unit doesn't
 *  carry a returnType (legacy data / orphan void). */
function statusForSale(sale: Sale, unit?: InventoryUnit): string {
  if (!sale.voidedAt) return 'Sold';
  switch (unit?.returnType) {
    case 'returned_to_inventory': return 'Back to Stock';
    case 'repair':                return 'Repair';
    case 'returned_to_supplier':  return 'RTS';
    default:                      return 'Returned';
  }
}

/** Light-red fill used on voided (returned) rows across every sheet of
 *  the Sales Report. Same colour everywhere so the operator's eye picks
 *  out reversals at a glance, whether they're scanning the ALL sheet or
 *  a per-marketplace tab. */
const RETURNED_FILL: import('exceljs').FillPattern = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFFEE2E2' },   // tailwind rose-100
};

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export interface ClientReportOptions {
  /** ISO date (yyyy-mm-dd) — lower bound filter for sales (inclusive). */
  from?: string;
  /** ISO date (yyyy-mm-dd) — upper bound filter for sales (inclusive). */
  to?: string;
  /** Override "today" — drives the filename (year/month). Defaults to new Date(). */
  today?: Date;
}

export interface BuildInventoryWorkbookInput {
  units: InventoryUnit[];
  aggregates: InventoryAggregate[];
  suppliers: Supplier[];
  whatsappFeed: SupplierWhatsappUpdate[];
}

export interface BuildSalesWorkbookInput {
  sales: Sale[];
  /** Inventory units used by the ALL sheet to join in buy-side columns
   *  (Stock In Date, Model, Grade, Storage, Colour, Supplier, Notes). When
   *  omitted those columns render blank but the ALL sheet still ships. */
  units?: InventoryUnit[];
  /** Resolves supplierId → supplier name on the ALL sheet. Falls back to
   *  the Sale's stored supplierName when no map entry matches. */
  supplierMap?: Record<string, string>;
  opts?: ClientReportOptions;
}

export interface DownloadClientWorkbooksInput {
  units: InventoryUnit[];
  aggregates: InventoryAggregate[];
  suppliers: Supplier[];
  whatsappFeed: SupplierWhatsappUpdate[];
  sales: Sale[];
  opts?: ClientReportOptions;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Render a parsed coloursMap back to the client's compact "GREY 2 SILVER 0"
 * format. Preserves insertion order of the map.
 */
export function buildColourString(coloursMap?: { [colour: string]: number }): string {
  if (!coloursMap) return '';
  return Object.entries(coloursMap)
    .map(([colour, qty]) => `${colour} ${qty}`)
    .join(' ');
}

/**
 * Look up supplier names by id and join with " / " (matches the master file's
 * "MHL / ABC / NIHAL" convention). Unknown ids fall back to the raw id so we
 * never silently drop a supplier.
 */
function joinSupplierNames(supplierIds: string[] | undefined, suppliers: Supplier[]): string {
  if (!supplierIds || supplierIds.length === 0) return '';
  const byId = new Map(suppliers.map(s => [s.id, s.name]));
  return supplierIds.map(id => byId.get(id) ?? id).join(' / ');
}

/** Parse an ISO date string into a Date suitable for ExcelJS. Returns null on missing/invalid. */
function toDate(iso: string | undefined | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Quantity cell value: prefer the numeric, fall back to the text variant (so "SHS"/"NO STOCK" survive). */
function quantityValue(agg: InventoryAggregate): number | string {
  if (agg.quantityNum != null) return agg.quantityNum;
  if (agg.quantityText != null) return agg.quantityText;
  return '';
}

/** Filter a sale array by the from/to ISO date window (inclusive). */
function filterSalesByDate(sales: Sale[], opts?: ClientReportOptions): Sale[] {
  if (!opts || (!opts.from && !opts.to)) return sales;
  const from = opts.from ?? '0000-01-01';
  const to   = opts.to   ?? '9999-12-31';
  return sales.filter(s => s.saleDate >= from && s.saleDate <= to);
}

// ---------------------------------------------------------------------------
// INVENTORY workbook
// ---------------------------------------------------------------------------

const INVENTORY_HEADERS: Array<string | null> = [
  'MODEL ', 'BP', 'QUANTITY ', null, 'VALUE', 'COLOURS', 'SUPPLIER', 'NOTES',
];
const INVENTORY_COLUMN_WIDTHS = [50, 6, 12, 30, 10, 40, 20, 30];

const IMEI_HEADERS = [
  'STOCK IN DATE', 'MODEL', 'IMEI NUMBER', 'BP', 'COLOURS',
  'SUPPLIER', 'NOTES', 'STATUS', 'MARKETPLACE', 'STOCK OUT DATE',
];

const WHATSAPP_HEADERS: Array<string | null> = ['MOBILE KIT SUPPLIER', null];

export async function buildInventoryWorkbookBuffer(input: BuildInventoryWorkbookInput): Promise<ArrayBuffer> {
  const { units, aggregates, suppliers, whatsappFeed } = input;
  const wb = new ExcelJS.Workbook();

  // ---------------- Sheet 1: INVENTORY ----------------
  const invSheet = wb.addWorksheet('INVENTORY');
  invSheet.columns = INVENTORY_COLUMN_WIDTHS.map(w => ({ width: w }));
  // Use addRow so we keep literal nulls (header row D is intentionally empty).
  invSheet.addRow(INVENTORY_HEADERS);

  for (let i = 0; i < aggregates.length; i++) {
    const agg = aggregates[i];
    const r = i + 2; // 1-based, +1 for header

    const row = invSheet.addRow([
      agg.model ?? '',
      agg.buyPrice ?? null,
      quantityValue(agg),
      agg.notesFlag ?? null,
      null,                 // E populated below as a formula
      buildColourString(agg.coloursMap),
      joinSupplierNames(agg.supplierIds, suppliers),
      agg.notes ?? null,
    ]);

    // E: VALUE = BP * QUANTITY
    row.getCell(5).value = { formula: `B${r}*C${r}` };
  }

  // ---------------- Sheet 2: IMEI NUMBERS ----------------
  const imeiSheet = wb.addWorksheet('IMEI NUMBERS');
  imeiSheet.addRow(IMEI_HEADERS);

  for (const unit of units) {
    const stockInDate = toDate(unit.dateIn);
    const stockOutDate = toDate(unit.stockOutDate ?? unit.saleDate);
    const supplierName = unit.supplierName
      ?? joinSupplierNames(unit.supplierIds, suppliers)
      ?? '';

    const row = imeiSheet.addRow([
      stockInDate,
      unit.model ?? '',
      unit.imei ?? '',
      unit.buyPrice ?? null,
      unit.colour ?? '',
      supplierName,
      unit.notes ?? null,
      unit.statusRaw ?? unit.status ?? '',
      unit.marketplace ?? unit.salePlatform ?? '',
      stockOutDate,
    ]);

    // A: STOCK IN DATE — mm/dd/yyyy
    row.getCell(1).numFmt = 'mm/dd/yyyy';
    // C: IMEI NUMBER — render as plain integer when numeric so 15-digit IMEIs
    // don't render as scientific notation. Alphanumeric serials stay strings.
    row.getCell(3).numFmt = '0';
    // D: BP — money
    row.getCell(4).numFmt = '0.00';
    // J: STOCK OUT DATE — mm/dd/yyyy
    row.getCell(10).numFmt = 'mm/dd/yyyy';
  }

  // ---------------- Sheet 3: SUPPLIER WHATSAPP UPDATES ----------------
  const waSheet = wb.addWorksheet('SUPPLIER WHATSAPP UPDATES');
  waSheet.addRow(WHATSAPP_HEADERS);
  for (const u of whatsappFeed) {
    waSheet.addRow([u.rawText ?? '', u.priceText ?? null]);
  }

  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

// ---------------------------------------------------------------------------
// SALES workbook
// ---------------------------------------------------------------------------

type SalesHeaderRow = Array<string | number>;

const SALES_HEADERS: Record<Marketplace, SalesHeaderRow> = {
  AMAZON: [
    'Date', 'Order Number', 'SKU', 'IMEI', 'Supplier', 'Quantity',
    'BP', 'SP', 'SP-BP', 'Marginal Tax', 'Commission',
    'C. VAT', 'DSF', 'DSF. VAT',
    'Postage', 'P. VAT', 'Accessories',
    'Total VAT', 'GP', 'GP %', 'Total VAT NTP',
    'Comments',
  ],
  BM: [
    'Date', 'Order No', 'SKU', 'IMEI', 'Supplier', 'Quantity',
    'BP', 'SP', 'Payment Mode', 'SP-BP', 'Marginal Tax',
    'PayPal/Klarna Com', 'Commission', 'Postage',
    'GP = SP-BP-TAX-COM-POS-P COM', 'GP %', 'Comments',
  ],
  EBAY: [
    'DATE', 'ORDER NUMBER', 'SKU', 'IMEI NUMBER', 'SUPPLIER', 'UNITS',
    'BP', 'SP', 'SP-BP', 'MAR TAX', 'COM', 'ROF', 'FVF', 0.2,
    'T.COM', 'SHIPPING', 'GP', 'GP%', 'NP(incl. PROMOTION)',
  ],
  ONBUY: [
    'DATE', 'Order Number', 'SKU', 'IMEI', 'Supplier',
    'BP', 'SP', 'SP-BP', 'MAR VAT', 'COM 7%', 'VAT 20%', 'SHIP',
    'GP=SP-BP-COM-SHIP-MARVAT', 'GP%', 'Comments',
  ],
};

const DATE_FMT = '[$-409]d\\-mmm\\-yyyy';
const MONEY_FMT = '0.00';
const IMEI_FMT = '0';

/**
 * Write one sale row into the given sheet with the correct base values,
 * formulas (sourced from `excelFormulaFor`) and per-cell number formats.
 */
function writeSaleRow(
  sheet: ExcelJS.Worksheet,
  marketplace: Marketplace,
  sale: Sale,
  rowNumber: number,
): void {
  const f = excelFormulaFor(marketplace, rowNumber);
  const date = toDate(sale.saleDate);
  const qty = sale.quantity ?? 1;

  switch (marketplace) {
    case 'AMAZON': {
      // 2026-05 schema. 22 columns — Date through Comments. Postage and
      // Accessories carry literal values (operator may have overridden
      // postage per sale, accessories is a flat default); every other
      // computed cell is a formula so the operator can audit / re-derive
      // in Excel without trusting our runtime output.
      const row = sheet.addRow([
        date, sale.orderNumber, sale.sku ?? '', sale.imei ?? '',
        sale.supplierName ?? '', qty,
        sale.buyPrice, sale.salePrice,
        // Formula-driven cells filled below: SP-BP, MarTax, Com, C.VAT,
        // DSF, DSF.VAT, Postage (literal), P.VAT, Accessories (literal),
        // Total VAT, GP, GP%, Total VAT NTP.
        null, null, null, null, null, null,
        sale.postage ?? null,
        null,
        sale.accessoryFee ?? Number(f.accessoryFee ?? 1),
        null, null, null, null,
        sale.comments ?? '',
      ]);
      row.getCell(1).numFmt = DATE_FMT;
      row.getCell(4).numFmt = IMEI_FMT;
      row.getCell(7).numFmt = MONEY_FMT;   // BP
      row.getCell(8).numFmt = MONEY_FMT;   // SP
      row.getCell(9).value  = { formula: f.spMinusBp! };     row.getCell(9).numFmt  = MONEY_FMT;
      row.getCell(10).value = { formula: f.marginalTax! };   row.getCell(10).numFmt = MONEY_FMT;
      row.getCell(11).value = { formula: f.commission! };    row.getCell(11).numFmt = MONEY_FMT;
      row.getCell(12).value = { formula: f.commissionVat! }; row.getCell(12).numFmt = MONEY_FMT;
      row.getCell(13).value = { formula: f.dsf! };           row.getCell(13).numFmt = MONEY_FMT;
      row.getCell(14).value = { formula: f.dsfVat! };        row.getCell(14).numFmt = MONEY_FMT;
      row.getCell(15).numFmt = MONEY_FMT; // Postage (literal value above)
      row.getCell(16).value = { formula: f.postageVat! };    row.getCell(16).numFmt = MONEY_FMT;
      row.getCell(17).numFmt = MONEY_FMT; // Accessories (literal value above)
      row.getCell(18).value = { formula: f.totalVat! };      row.getCell(18).numFmt = MONEY_FMT;
      row.getCell(19).value = { formula: f.grossProfit! };   row.getCell(19).numFmt = MONEY_FMT;
      row.getCell(20).value = { formula: f.gpPercent! };     row.getCell(20).numFmt = MONEY_FMT;
      row.getCell(21).value = { formula: f.totalVatNtp! };   row.getCell(21).numFmt = MONEY_FMT;
      return;
    }

    case 'BM': {
      const row = sheet.addRow([
        date, sale.orderNumber, sale.sku ?? '', sale.imei ?? '',
        sale.supplierName ?? '', qty,
        sale.buyPrice, sale.salePrice,
        sale.paymentMode ?? '',
        null, null, null, null, null, null, null, sale.comments ?? '',
      ]);
      row.getCell(1).numFmt = DATE_FMT;
      row.getCell(4).numFmt = IMEI_FMT;
      row.getCell(7).numFmt = MONEY_FMT;
      row.getCell(8).numFmt = MONEY_FMT;
      row.getCell(10).value = { formula: f.spMinusBp! };       row.getCell(10).numFmt = MONEY_FMT;
      row.getCell(11).value = { formula: f.marginalTax! };     row.getCell(11).numFmt = MONEY_FMT;
      row.getCell(12).value = { formula: f.payPalKlarnaCom! }; row.getCell(12).numFmt = MONEY_FMT;
      row.getCell(13).value = { formula: f.commission! };      row.getCell(13).numFmt = MONEY_FMT;
      row.getCell(14).value = Number(f.postage);               row.getCell(14).numFmt = MONEY_FMT;
      row.getCell(15).value = { formula: f.grossProfit! };     row.getCell(15).numFmt = MONEY_FMT;
      row.getCell(16).value = { formula: f.gpPercent! };       row.getCell(16).numFmt = MONEY_FMT;
      return;
    }

    case 'EBAY': {
      // SHIPPING column is base value (1, 2 or 8). Default to fee.postage (8).
      const shipping = sale.postage ?? 8;
      const row = sheet.addRow([
        date, sale.orderNumber, sale.sku ?? '', sale.imei ?? '',
        sale.supplierName ?? '', qty,
        sale.buyPrice, sale.salePrice,
        null, null, null, null, null, null, null,
        shipping,
        null, null, null,
      ]);
      row.getCell(1).numFmt = DATE_FMT;
      row.getCell(4).numFmt = IMEI_FMT;
      row.getCell(7).numFmt = MONEY_FMT;
      row.getCell(8).numFmt = MONEY_FMT;
      row.getCell(9).value  = { formula: f.spMinusBp! };     row.getCell(9).numFmt  = MONEY_FMT;
      row.getCell(10).value = { formula: f.marTax! };        row.getCell(10).numFmt = MONEY_FMT;
      row.getCell(11).value = { formula: f.commission! };    row.getCell(11).numFmt = MONEY_FMT;
      row.getCell(12).value = { formula: f.rof! };           row.getCell(12).numFmt = MONEY_FMT;
      row.getCell(13).value = Number(f.fvf);                 row.getCell(13).numFmt = MONEY_FMT;
      row.getCell(14).value = { formula: f.twentyPercent! }; row.getCell(14).numFmt = MONEY_FMT;
      row.getCell(15).value = { formula: f.totalCom! };      row.getCell(15).numFmt = MONEY_FMT;
      row.getCell(16).numFmt = MONEY_FMT;                    // SHIPPING base value
      row.getCell(17).value = { formula: f.grossProfit! };   row.getCell(17).numFmt = MONEY_FMT;
      row.getCell(18).value = { formula: f.gpPercent! };     row.getCell(18).numFmt = MONEY_FMT;
      row.getCell(19).value = { formula: f.netProfit! };     row.getCell(19).numFmt = MONEY_FMT;
      return;
    }

    case 'ONBUY': {
      // ONBUY layout has no quantity column. Columns:
      // A=Date B=Order# C=SKU D=IMEI E=Supplier F=BP G=SP H=SP-BP I=MAR VAT
      // J=COM 7% K=VAT 20% L=SHIP M=GP N=GP% O=Comments
      const row = sheet.addRow([
        date, sale.orderNumber, sale.sku ?? '', sale.imei ?? '',
        sale.supplierName ?? '',
        sale.buyPrice, sale.salePrice,
        null, null, null, null, null, null, null, sale.comments ?? '',
      ]);
      row.getCell(1).numFmt = DATE_FMT;
      row.getCell(4).numFmt = IMEI_FMT;
      row.getCell(6).numFmt = MONEY_FMT;   // BP (F)
      row.getCell(7).numFmt = MONEY_FMT;   // SP (G)
      row.getCell(8).value  = { formula: f.spMinusBp! };    row.getCell(8).numFmt  = MONEY_FMT;
      row.getCell(9).value  = { formula: f.marVat! };       row.getCell(9).numFmt  = MONEY_FMT;
      row.getCell(10).value = { formula: f.commission! };   row.getCell(10).numFmt = MONEY_FMT;
      row.getCell(11).value = { formula: f.vat20! };        row.getCell(11).numFmt = MONEY_FMT;
      row.getCell(12).value = Number(f.postage);            row.getCell(12).numFmt = MONEY_FMT;
      row.getCell(13).value = { formula: f.grossProfit! };  row.getCell(13).numFmt = MONEY_FMT;
      row.getCell(14).value = { formula: f.gpPercent! };    row.getCell(14).numFmt = MONEY_FMT;
      return;
    }

  }
}

export async function buildSalesWorkbookBuffer(input: BuildSalesWorkbookInput): Promise<ArrayBuffer> {
  const { sales, units, supplierMap, opts } = input;
  const filtered = filterSalesByDate(sales, opts);
  const byMarketplace = new Map<Marketplace, Sale[]>();
  for (const m of MARKETPLACES) byMarketplace.set(m, []);
  for (const sale of filtered) {
    const bucket = byMarketplace.get(sale.marketplace);
    if (bucket) bucket.push(sale);
  }

  const wb = new ExcelJS.Workbook();

  // Sheet 1: ALL — every (non-PROJECT-or-not) sale in one flat 22-col table,
  // buy + sale data joined, computed values via recomputeSale. Filterable in
  // Excel by Marketplace column.
  writeAllSheet(wb.addWorksheet('ALL'), filtered, units ?? [], supplierMap ?? {});

  // Sheets 2-5: per-platform, mirroring the operator's master SALES_REPORT
  // shape exactly (headers + formulas via excelFormulaFor). PROJECT excluded
  // — we sell on 4 platforms only.
  for (const m of MARKETPLACES) {
    const sheet = wb.addWorksheet(m);
    sheet.addRow(SALES_HEADERS[m]);

    const bucket = byMarketplace.get(m) ?? [];
    const headerLen = (SALES_HEADERS[m] as unknown as unknown[]).length;
    for (let i = 0; i < bucket.length; i++) {
      const rowNumber = i + 2; // skip header
      const sale = bucket[i];
      writeSaleRow(sheet, m, sale, rowNumber);
      // Same red-fill visual signal as the ALL sheet — applied across
      // every cell in the row so the highlight covers the full width
      // even when the master schema includes blank/formula-only cells.
      if (sale.voidedAt) {
        const row = sheet.getRow(rowNumber);
        for (let col = 1; col <= headerLen; col++) {
          row.getCell(col).fill = RETURNED_FILL;
        }
      }
    }
  }

  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

/** Write the ALL sheet — one row per sale, buy fields pulled from the
 *  matched unit (by sale.unitId), financial fields recomputed live. */
function writeAllSheet(
  sheet: ExcelJS.Worksheet,
  sales: Sale[],
  units: InventoryUnit[],
  supplierMap: Record<string, string>,
): void {
  sheet.addRow(ALL_HEADERS);
  // Index units by id once so the per-sale lookup is O(1).
  const unitsById = new Map<string, InventoryUnit>();
  for (const u of units) unitsById.set(u.id, u);

  // Newest sales first — matches the in-app default and means most-recent
  // activity sits at the top of the sheet when the operator opens it.
  const sorted = [...sales].sort((a, b) => (b.saleDate || '').localeCompare(a.saleDate || ''));

  for (const s of sorted) {
    const u = s.unitId ? unitsById.get(s.unitId) : undefined;
    const r = recomputeSale(s);
    // Per-marketplace commission flatten: eBay rolls ROF+FVF+VAT into T.COM;
    // BM adds PayPal/Klarna on top. Unified column reads as "total fee
    // paid to the platform" regardless of marketplace.
    const commission =
      s.marketplace === 'EBAY' ? (r.totalCom ?? r.commission)
      : s.marketplace === 'BM' ? (r.commission + (r.payPalKlarnaCom ?? 0))
      : r.commission;
    const tax = r.marVat ?? r.marginalTax;

    const row = sheet.addRow([
      // Buy block (cols 1-9)
      u?.dateIn ? toDate(u.dateIn) : null,
      u?.model || '',
      s.imei || u?.imei || '',
      u?.grade || '',
      u?.storage || '',
      u?.colour || '',
      supplierMap[s.supplierId || ''] || s.supplierName || u?.supplierName || '',
      s.buyPrice,
      u?.notes || '',
      // Status (col 10) — Sold / Back to Stock / Repair / RTS / Returned
      statusForSale(s, u),
      // Sale block (cols 11-23)
      toDate(s.saleDate),
      s.marketplace,
      s.orderNumber || '',
      s.sku || '',
      s.salePrice,
      s.paymentMode || '',
      r.postage,
      r.spMinusBp,
      tax,
      commission,
      r.grossProfit,
      r.gpPercent,
      // NP = GP minus marketplace-specific promo. eBay deducts 5%; the
      // other three platforms have no promo concept, so NP equals GP
      // (calcSaleFinancials returns undefined for those — fallback here
      // keeps the unified column populated end-to-end).
      r.netProfit ?? r.grossProfit,
    ]);

    // Number formats — buy date (1), IMEI (3), BP (8); Status is col 10,
    // sale date moves to col 11, and the £ columns slide one right.
    row.getCell(1).numFmt = DATE_FMT;
    row.getCell(3).numFmt = IMEI_FMT;
    row.getCell(8).numFmt = MONEY_FMT;
    row.getCell(11).numFmt = DATE_FMT;
    for (const col of [15, 17, 18, 19, 20, 21, 22, 23]) {
      row.getCell(col).numFmt = MONEY_FMT;
    }
    row.getCell(10).numFmt = DATE_FMT;

    // Highlight returned rows across the entire 23-col span. Applied to
    // every cell (not the row) so Excel doesn't try to extend the fill
    // to unused columns on the right edge.
    if (s.voidedAt) {
      for (let col = 1; col <= ALL_HEADERS.length; col++) {
        row.getCell(col).fill = RETURNED_FILL;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Filenames + browser-side download
// ---------------------------------------------------------------------------

export function inventoryReportFilename(today: Date = new Date()): string {
  const y = today.getFullYear();
  const m = today.getMonth() + 1; // 1-12, no leading zero
  return `INVENTORY_REPORT_${y}_${m}.xlsx`;
}

export function salesReportFilename(today: Date = new Date()): string {
  return `SALES_REPORT_${today.getFullYear()}.xlsx`;
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function triggerBrowserDownload(buffer: ArrayBuffer, filename: string): void {
  const blob = new Blob([buffer], { type: XLSX_MIME });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/**
 * Build both client workbooks (INVENTORY_REPORT + SALES_REPORT) and trigger
 * a browser download for each. Throws if invoked outside a browser context.
 */
export async function downloadClientWorkbooks(input: DownloadClientWorkbooksInput): Promise<void> {
  const today = input.opts?.today ?? new Date();
  const [invBuf, salesBuf] = await Promise.all([
    buildInventoryWorkbookBuffer({
      units: input.units,
      aggregates: input.aggregates,
      suppliers: input.suppliers,
      whatsappFeed: input.whatsappFeed,
    }),
    buildSalesWorkbookBuffer({
      sales: input.sales,
      units: input.units,
      supplierMap: Object.fromEntries(input.suppliers.map(s => [s.id, s.name])),
      opts: input.opts,
    }),
  ]);
  triggerBrowserDownload(invBuf, inventoryReportFilename(today));
  triggerBrowserDownload(salesBuf, salesReportFilename(today));
}

/**
 * Download just the SALES_REPORT workbook (ALL + per-platform sheets).
 * Used by the Sell-screen "Sales Report" button — single-click download
 * with the same per-marketplace formulas the master file uses.
 * Filename carries YYYY-MM-DD_HHMM so multiple pulls per day sort
 * chronologically in a folder.
 */
export async function downloadSalesWorkbook(input: BuildSalesWorkbookInput): Promise<void> {
  const buf = await buildSalesWorkbookBuffer(input);
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  triggerBrowserDownload(buf, `sales-report-${stamp}.xlsx`);
}
