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

const SALES_HEADERS: Record<Marketplace, SalesHeaderRow> = {
  AMAZON: [
    'nw', 'Order Number', 'SKU', 'IMEI', 'Supplier', 'Quantity',
    'BP', 'SP', 'SP-BP', 'Marginal Tax', 'Commission', 'Postage',
    'GP = SP-BP-TAX-COM-AMZTAX-POS-P COM', 'GP %', 'Comments',
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
  PROJECT: [
    'Date', 'Order Number', 'SKU', 'IMEI', 'Supplier', 'QUANT',
    'BP', 'SP', 'SP-BP', 'MAR TAX', 'COMM', 'POST',
    'GP = SP-BP-TAX-COM-AMZTAX-POS-P COM', 'GP %', 'Comments',
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
      const row = sheet.addRow([
        date, sale.orderNumber, sale.sku ?? '', sale.imei ?? '',
        sale.supplierName ?? '', qty,
        sale.buyPrice, sale.salePrice,
        null, null, null, null, null, null, sale.comments ?? '',
      ]);
      row.getCell(1).numFmt = DATE_FMT;
      row.getCell(4).numFmt = IMEI_FMT;
      row.getCell(7).numFmt = MONEY_FMT;   // BP
      row.getCell(8).numFmt = MONEY_FMT;   // SP
      row.getCell(9).value  = { formula: f.spMinusBp! };    row.getCell(9).numFmt  = MONEY_FMT;
      row.getCell(10).value = { formula: f.marginalTax! };  row.getCell(10).numFmt = MONEY_FMT;
      row.getCell(11).value = { formula: f.commission! };   row.getCell(11).numFmt = MONEY_FMT;
      row.getCell(12).value = Number(f.postage);            row.getCell(12).numFmt = MONEY_FMT;
      row.getCell(13).value = { formula: f.grossProfit! };  row.getCell(13).numFmt = MONEY_FMT;
      row.getCell(14).value = { formula: f.gpPercent! };    row.getCell(14).numFmt = MONEY_FMT;
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

    case 'PROJECT': {
      // Same layout as AMAZON.
      const row = sheet.addRow([
        date, sale.orderNumber, sale.sku ?? '', sale.imei ?? '',
        sale.supplierName ?? '', qty,
        sale.buyPrice, sale.salePrice,
        null, null, null, null, null, null, sale.comments ?? '',
      ]);
      row.getCell(1).numFmt = DATE_FMT;
      row.getCell(4).numFmt = IMEI_FMT;
      row.getCell(7).numFmt = MONEY_FMT;
      row.getCell(8).numFmt = MONEY_FMT;
      row.getCell(9).value  = { formula: f.spMinusBp! };    row.getCell(9).numFmt  = MONEY_FMT;
      row.getCell(10).value = { formula: f.marginalTax! };  row.getCell(10).numFmt = MONEY_FMT;
      row.getCell(11).value = { formula: f.commission! };   row.getCell(11).numFmt = MONEY_FMT;
      row.getCell(12).value = Number(f.postage);            row.getCell(12).numFmt = MONEY_FMT;
      row.getCell(13).value = { formula: f.grossProfit! };  row.getCell(13).numFmt = MONEY_FMT;
      row.getCell(14).value = { formula: f.gpPercent! };    row.getCell(14).numFmt = MONEY_FMT;
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
    const sheet = wb.addWorksheet(m);
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
    buildSalesWorkbookBuffer({ sales: input.sales, opts: input.opts }),
  ]);
  triggerBrowserDownload(invBuf, inventoryReportFilename(today));
  triggerBrowserDownload(salesBuf, salesReportFilename(today));
}
