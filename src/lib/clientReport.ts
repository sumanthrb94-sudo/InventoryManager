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

/** Tab names match the client master ("AMAZON SALES" etc.). */
const SHEET_NAMES: Record<Marketplace, string> = {
  AMAZON: 'AMAZON SALES',
  BM:     'BM SALES',
  EBAY:   'EBAY SALES',
  ONBUY:  'ONBUY SALES',
};

/** Headers are verbatim from SALES_REPORT_2026_1.xlsx (including trailing space on "Total VAT " in EBAY/ONBUY). */
const SALES_HEADERS: Record<Marketplace, SalesHeaderRow> = {
  AMAZON: [
    'Date', 'Order Number', 'SKU', 'IMEI', 'Supplier', 'Quantity',
    'BP', 'SP', 'SP-BP', 'Marginal Tax', 'Commission',
    'C. VAT', 'DSF', 'DSF. VAT', 'Postage', 'P. VAT', 'Acc',
    'Total VAT', 'GP', 'GP %', 'Total VAT NTP',
  ],
  BM: [
    'Date', 'Order No', 'SKU', 'IMEI', 'Supplier', 'Quantity', 'Payment Mode',
    'BP', 'SP', 'SP-BP', 'Marginal Tax', 'Commission',
    'Customer Care Fees', 'Postage', 'P. VAT', 'Acc',
    'GP', 'GP %', 'Total VAT NTP', 'Comments',
  ],
  EBAY: [
    'DATE', 'ORDER NUMBER', 'SKU', 'IMEI NUMBER', 'SUPPLIER', 'UNITS',
    'BP', 'SP', 'SP-BP', 'Marginal Tax', 'Commission',
    'ROF', 'FVF', 'VAT', 'T.COM',
    'Postage', 'P. VAT', 'Marketing', 'M. VAT', 'Acc',
    'Total VAT ', 'GP', 'GP%', 'Total VAT NTP',
  ],
  ONBUY: [
    'DATE', 'Order Number', 'SKU', 'IMEI', 'Supplier',
    'BP', 'SP', 'SP-BP', 'Marginal Tax', 'Commission', 'VAT 20%',
    'Postage', 'P. VAT', 'Acc',
    'Total VAT ', 'GP', 'GP%', 'Total VAT NTP',
  ],
};

const DATE_FMT_409 = '[$-409]d\\-mmm\\-yyyy';   // AMAZON / BM
const DATE_FMT_BARE = 'd\\-mmm\\-yyyy';         // EBAY / ONBUY
const MONEY_FMT = '0.00';
const IMEI_FMT = '0';

/** Literal Customer Care Fees written into every BM row (mirrors the client cells). */
const BM_CUSTOMER_CARE_FEES_LITERAL = 8.99;
/** Literal FVF written into every EBAY row. */
const EBAY_FVF_LITERAL = 0.40;

/**
 * Write one sale row matching the client SALES_REPORT_2026_1.xlsx layout
 * verbatim — sheet-specific column order, header text, literal values,
 * formulas (from `excelFormulaFor`) and per-cell number formats.
 *
 * Base inputs (BP, SP, postage, acc, payment mode, comments) become literal
 * cells; every derived column is an Excel formula so the spreadsheet stays
 * recalculable when the operator edits BP/SP downstream.
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
  const postage = sale.postage ?? 6.30;
  const acc = sale.accessories ?? 1;
  // When postage VAT is exempt for this row, write P.VAT as literal 0 instead
  // of the `=Postage*20%` formula. Total VAT / Total VAT NTP / GP formulas all
  // reference the P.VAT cell so they auto-update from the literal.
  const pVatCell: number | { formula: string } = sale.postageVatExempt
    ? 0
    : { formula: f.pVat! };

  switch (marketplace) {
    case 'AMAZON': {
      // A Date | B Order# | C SKU | D IMEI | E Supplier | F Qty | G BP | H SP
      // I SP-BP | J MarTax | K Comm | L C.VAT | M DSF | N DSF.VAT | O Postage
      // P P.VAT | Q Acc | R Total VAT | S GP | T GP% | U Total VAT NTP
      const row = sheet.addRow([
        date, sale.orderNumber, sale.sku ?? '', sale.imei ?? '',
        sale.supplierName ?? '', qty,
        sale.buyPrice, sale.salePrice,
      ]);
      row.getCell(1).numFmt = DATE_FMT_409;
      row.getCell(4).numFmt = IMEI_FMT;
      row.getCell(9).value  = { formula: f.spMinusBp! };
      row.getCell(10).value = { formula: f.marginalTax! }; row.getCell(10).numFmt = MONEY_FMT;
      row.getCell(11).value = { formula: f.commission! };  row.getCell(11).numFmt = MONEY_FMT;
      row.getCell(12).value = { formula: f.cVat! };        row.getCell(12).numFmt = MONEY_FMT;
      row.getCell(13).value = { formula: f.dsf! };         row.getCell(13).numFmt = MONEY_FMT;
      row.getCell(14).value = { formula: f.dsfVat! };      row.getCell(14).numFmt = MONEY_FMT;
      row.getCell(15).value = postage;
      row.getCell(16).value = pVatCell;        row.getCell(16).numFmt = MONEY_FMT;
      row.getCell(17).value = acc;
      row.getCell(18).value = { formula: f.totalVat! };    row.getCell(18).numFmt = MONEY_FMT;
      row.getCell(19).value = { formula: f.grossProfit! }; row.getCell(19).numFmt = MONEY_FMT;
      row.getCell(20).value = { formula: f.gpPercent! };   row.getCell(20).numFmt = MONEY_FMT;
      row.getCell(21).value = { formula: f.totalVatNtp! }; row.getCell(21).numFmt = MONEY_FMT;
      return;
    }

    case 'BM': {
      // A Date | B Order No | C SKU | D IMEI | E Supplier | F Qty
      // G Payment Mode | H BP | I SP | J SP-BP | K MarTax | L Comm
      // M Customer Care Fees | N Postage | O P.VAT | P Acc
      // Q GP | R GP% | S Total VAT NTP | T Comments
      const row = sheet.addRow([
        date, sale.orderNumber, sale.sku ?? '', sale.imei ?? '',
        sale.supplierName ?? '', qty,
        sale.paymentMode ?? null,
        sale.buyPrice, sale.salePrice,
      ]);
      row.getCell(1).numFmt = DATE_FMT_409;
      row.getCell(4).numFmt = IMEI_FMT;
      row.getCell(10).value = { formula: f.spMinusBp! };   row.getCell(10).numFmt = MONEY_FMT;
      row.getCell(11).value = { formula: f.marginalTax! }; row.getCell(11).numFmt = MONEY_FMT;
      row.getCell(12).value = { formula: f.commission! };  row.getCell(12).numFmt = MONEY_FMT;
      row.getCell(13).value = BM_CUSTOMER_CARE_FEES_LITERAL;
      row.getCell(14).value = postage;
      row.getCell(15).value = pVatCell;        row.getCell(15).numFmt = MONEY_FMT;
      row.getCell(16).value = acc;
      row.getCell(17).value = { formula: f.grossProfit! }; row.getCell(17).numFmt = MONEY_FMT;
      row.getCell(18).value = { formula: f.gpPercent! };   row.getCell(18).numFmt = MONEY_FMT;
      row.getCell(19).value = { formula: f.totalVatNtp! }; row.getCell(19).numFmt = MONEY_FMT;
      row.getCell(20).value = sale.comments ?? null;
      return;
    }

    case 'EBAY': {
      // A Date | B Order# | C SKU | D IMEI | E Supplier | F Units | G BP | H SP
      // I SP-BP | J MarTax | K Comm | L ROF | M FVF | N VAT | O T.COM
      // P Postage | Q P.VAT | R Marketing | S M.VAT | T Acc
      // U Total VAT | V GP | W GP% | X Total VAT NTP
      const row = sheet.addRow([
        date, sale.orderNumber, sale.sku ?? '', sale.imei ?? '',
        sale.supplierName ?? '', qty,
        sale.buyPrice, sale.salePrice,
      ]);
      row.getCell(1).numFmt = DATE_FMT_BARE;
      row.getCell(4).numFmt = IMEI_FMT;
      row.getCell(9).value  = { formula: f.spMinusBp! };
      row.getCell(10).value = { formula: f.marginalTax! }; row.getCell(10).numFmt = MONEY_FMT;
      row.getCell(11).value = { formula: f.commission! }; row.getCell(11).numFmt = '0.0';
      row.getCell(12).value = { formula: f.rof! };
      row.getCell(13).value = EBAY_FVF_LITERAL;
      row.getCell(14).value = { formula: f.vat! };         row.getCell(14).numFmt = '0.0';
      row.getCell(15).value = { formula: f.totalCom! };
      row.getCell(16).value = postage;
      row.getCell(17).value = pVatCell;        row.getCell(17).numFmt = MONEY_FMT;
      row.getCell(18).value = { formula: f.marketing! };   row.getCell(18).numFmt = MONEY_FMT;
      row.getCell(19).value = { formula: f.mVat! };        row.getCell(19).numFmt = MONEY_FMT;
      row.getCell(20).value = acc;
      row.getCell(21).value = { formula: f.totalVat! };    row.getCell(21).numFmt = MONEY_FMT;
      row.getCell(22).value = { formula: f.grossProfit! }; row.getCell(22).numFmt = MONEY_FMT;
      row.getCell(23).value = { formula: f.gpPercent! };   row.getCell(23).numFmt = MONEY_FMT;
      row.getCell(24).value = { formula: f.totalVatNtp! }; row.getCell(24).numFmt = MONEY_FMT;
      return;
    }

    case 'ONBUY': {
      // A Date | B Order# | C SKU | D IMEI | E Supplier | F BP | G SP
      // H SP-BP | I MarTax | J Comm | K VAT 20% | L Postage | M P.VAT | N Acc
      // O Total VAT | P GP | Q GP% | R Total VAT NTP
      const row = sheet.addRow([
        date, sale.orderNumber, sale.sku ?? '', sale.imei ?? '',
        sale.supplierName ?? '',
        sale.buyPrice, sale.salePrice,
      ]);
      row.getCell(1).numFmt = DATE_FMT_BARE;
      row.getCell(4).numFmt = IMEI_FMT;
      row.getCell(8).value  = { formula: f.spMinusBp! };
      row.getCell(9).value  = { formula: f.marginalTax! }; row.getCell(9).numFmt  = MONEY_FMT;
      row.getCell(10).value = { formula: f.commission! };  row.getCell(10).numFmt = MONEY_FMT;
      row.getCell(11).value = { formula: f.vat20! };       row.getCell(11).numFmt = MONEY_FMT;
      row.getCell(12).value = postage;
      row.getCell(13).value = pVatCell;        row.getCell(13).numFmt = MONEY_FMT;
      row.getCell(14).value = acc;
      row.getCell(15).value = { formula: f.totalVat! };    row.getCell(15).numFmt = MONEY_FMT;
      row.getCell(16).value = { formula: f.grossProfit! }; row.getCell(16).numFmt = MONEY_FMT;
      row.getCell(17).value = { formula: f.gpPercent! };   row.getCell(17).numFmt = MONEY_FMT;
      row.getCell(18).value = { formula: f.totalVatNtp! }; row.getCell(18).numFmt = MONEY_FMT;
      return;
    }
  }
}

export async function buildSalesWorkbookBuffer(input: BuildSalesWorkbookInput): Promise<ArrayBuffer> {
  const { sales, opts } = input;
  const filtered = filterSalesByDate(sales, opts);
  const byMarketplace = new Map<Marketplace, Sale[]>();
  for (const m of MARKETPLACES) byMarketplace.set(m, []);
  for (const sale of filtered) {
    const bucket = byMarketplace.get(sale.marketplace);
    if (bucket) bucket.push(sale);
  }

  const wb = new ExcelJS.Workbook();
  for (const m of MARKETPLACES) {
    const sheet = wb.addWorksheet(SHEET_NAMES[m]);
    sheet.addRow(SALES_HEADERS[m]);

    const bucket = byMarketplace.get(m) ?? [];
    for (let i = 0; i < bucket.length; i++) {
      const rowNumber = i + 2; // skip header
      writeSaleRow(sheet, m, bucket[i], rowNumber);
    }
  }

  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

// ---------------------------------------------------------------------------
// Filenames + browser-side download
// ---------------------------------------------------------------------------

export function inventoryReportFilename(today: Date = new Date()): string {
  const y = today.getFullYear();
  const m = today.getMonth() + 1; // 1-12, no leading zero
  return `INVENTORY_REPORT_${y}_${m}.xlsx`;
}

/**
 * Filename matches the client master convention: SALES_REPORT_${FY}_${FYMonth}.
 * FY runs April→March (1=April, 12=March). e.g. April-2026 → SALES_REPORT_2026_1.xlsx.
 */
export function salesReportFilename(today: Date = new Date()): string {
  const m = today.getMonth() + 1; // 1-12
  // FY month: April(4)→1, May(5)→2 … March(3)→12
  const fyMonth = ((m + 8) % 12) + 1;
  // FY year is the calendar year unless we're in Jan/Feb/Mar (still last FY).
  const fyYear = m >= 4 ? today.getFullYear() : today.getFullYear() - 1;
  return `SALES_REPORT_${fyYear}_${fyMonth}.xlsx`;
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
    buildSalesWorkbookBuffer({ sales: input.sales, opts: input.opts }),
  ]);
  triggerBrowserDownload(invBuf, inventoryReportFilename(today));
  triggerBrowserDownload(salesBuf, salesReportFilename(today));
}
