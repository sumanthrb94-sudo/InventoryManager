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

/** Light-red fill used on voided (returned) rows across every sheet of
 *  the Sales Report. Same colour everywhere so the operator's eye picks
 *  out reversals at a glance across the four per-marketplace tabs. */
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
  /** Optional inventory units. Reserved for callers that want to surface
   *  buy-side context in a future enhancement — the four per-marketplace
   *  sheets don't need them today, so omitting is fine. */
  units?: InventoryUnit[];
  /** Resolves supplierId → supplier name when sales rows carry only an id.
   *  Falls back to the Sale's stored supplierName when no map entry matches. */
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
    'Postage', 'P. VAT', 'Acc',
    'Total VAT', 'GP', 'GP %', 'Total VAT NTP',
    'Comments',
  ],
  BM: [
    'Date', 'Order Number', 'SKU', 'IMEI', 'Supplier', 'Quantity',
    'BP', 'SP', 'SP-BP', 'Marginal Tax', 'Commission',
    'Customer Care Fees', 'Postage', 'P. VAT', 'Accessories',
    'GP', 'GP %', 'Total VAT NTP', 'Comments',
  ],
  EBAY: [
    'Date', 'Order Number', 'SKU', 'IMEI', 'Supplier', 'Units',
    'BP', 'SP', 'SP-BP', 'Marginal Tax', 'Commission', 'ROF', 'FVF', 'VAT',
    'T.COM', 'Postage', 'P. VAT', 'Marketing', 'M. VAT', 'Accessories',
    'Total VAT', 'GP', 'GP %', 'Total VAT NTP', 'Comments',
  ],
  ONBUY: [
    'Date', 'Order Number', 'SKU', 'IMEI', 'Supplier',
    'BP', 'SP', 'SP-BP', 'Marginal Tax', 'Commission', 'VAT 20%',
    'Postage', 'P. VAT', 'Accessories',
    'Total VAT', 'GP', 'GP %', 'Total VAT NTP', 'Comments',
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
      // P. VAT: literal 0 when operator zero-rated the line; otherwise
      // formula. Preserves the per-row VAT-exempt decision across export
      // → re-import (the formula would always re-apply 20% × postage).
      if (sale.postageVatExempt) {
        row.getCell(16).value = 0;
      } else {
        row.getCell(16).value = { formula: f.postageVat! };
      }
      row.getCell(16).numFmt = MONEY_FMT;
      row.getCell(17).numFmt = MONEY_FMT; // Accessories (literal value above)
      row.getCell(18).value = { formula: f.totalVat! };      row.getCell(18).numFmt = MONEY_FMT;
      row.getCell(19).value = { formula: f.grossProfit! };   row.getCell(19).numFmt = MONEY_FMT;
      row.getCell(20).value = { formula: f.gpPercent! };     row.getCell(20).numFmt = MONEY_FMT;
      row.getCell(21).value = { formula: f.totalVatNtp! };   row.getCell(21).numFmt = MONEY_FMT;
      return;
    }

    case 'BM': {
      // 2026-05 schema. 19 cols. Customer Care Fees + Accessories are
      // flat literals; Postage is operator-entered. Everything else is a
      // formula so the operator can audit in Excel.
      //   A=Date,B=OrderNo,C=SKU,D=IMEI,E=Supplier,F=Quantity,
      //   G=BP,H=SP,I=SP-BP,J=MarTax,K=Com,L=CustomerCareFees,
      //   M=Postage,N=P.VAT,O=Accessories,P=GP,Q=GP%,R=TotVAT NTP,S=Comments
      const row = sheet.addRow([
        date, sale.orderNumber, sale.sku ?? '', sale.imei ?? '',
        sale.supplierName ?? '', qty,
        sale.buyPrice, sale.salePrice,
        null, null, null,                              // SP-BP, MarTax, Com
        sale.customerCareFees ?? Number(f.customerCareFees ?? 9.99),  // Customer Care Fees (literal)
        sale.postage ?? null,                          // Postage (literal)
        null,                                          // P. VAT (formula)
        sale.accessoryFee ?? Number(f.accessoryFee ?? 1),  // Accessories (literal)
        null, null, null,                              // GP, GP%, Total VAT NTP
        sale.comments ?? '',
      ]);
      row.getCell(1).numFmt = DATE_FMT;
      row.getCell(4).numFmt = IMEI_FMT;
      row.getCell(7).numFmt = MONEY_FMT;       // BP
      row.getCell(8).numFmt = MONEY_FMT;       // SP
      row.getCell(9).value  = { formula: f.spMinusBp! };    row.getCell(9).numFmt  = MONEY_FMT;
      row.getCell(10).value = { formula: f.marginalTax! };  row.getCell(10).numFmt = MONEY_FMT;
      row.getCell(11).value = { formula: f.commission! };   row.getCell(11).numFmt = MONEY_FMT;
      row.getCell(12).numFmt = MONEY_FMT;                   // Customer Care Fees (literal above)
      row.getCell(13).numFmt = MONEY_FMT;                   // Postage (literal above)
      if (sale.postageVatExempt) {
        row.getCell(14).value = 0;
      } else {
        row.getCell(14).value = { formula: f.postageVat! };
      }
      row.getCell(14).numFmt = MONEY_FMT;
      row.getCell(15).numFmt = MONEY_FMT;                   // Accessories (literal above)
      row.getCell(16).value = { formula: f.grossProfit! };  row.getCell(16).numFmt = MONEY_FMT;
      row.getCell(17).value = { formula: f.gpPercent! };    row.getCell(17).numFmt = MONEY_FMT;
      row.getCell(18).value = { formula: f.totalVatNtp! };  row.getCell(18).numFmt = MONEY_FMT;
      return;
    }

    case 'EBAY': {
      // 2026-05 schema, 25 cols. Postage + Accessories carry literal values;
      // Marketing defaults to a formula (operator's =B3*5% convention) so
      // edits to SP cascade into Marketing without operator intervention,
      // but if a caller passed an explicit `sale.marketing` we honour the
      // literal value instead. Everything else computes via formulas so
      // the operator can audit in Excel.
      //   A=Date,B=OrderNo,C=SKU,D=IMEI,E=Supplier,F=Units,
      //   G=BP,H=SP,I=SP-BP,J=MarTax,K=Com,L=ROF,M=FVF,N=VAT,O=T.COM,
      //   P=Postage,Q=P.VAT,R=Marketing,S=M.VAT,T=Acc,U=TotVAT,V=GP,
      //   W=GP%,X=TotVAT NTP,Y=Comments
      const hasExplicitMarketing = typeof sale.marketing === 'number';
      const row = sheet.addRow([
        date, sale.orderNumber, sale.sku ?? '', sale.imei ?? '',
        sale.supplierName ?? '', qty,
        sale.buyPrice, sale.salePrice,
        null, null, null, null, null, null, null,    // SP-BP, MarTax, Com, ROF, FVF, VAT, T.COM
        sale.postage ?? null,                        // Postage
        null,                                        // P. VAT (formula)
        hasExplicitMarketing ? sale.marketing : null, // Marketing — literal or formula
        null,                                        // M. VAT (formula)
        sale.accessoryFee ?? Number(f.accessoryFee ?? 1),  // Accessories
        null, null, null, null,                      // Total VAT, GP, GP%, Total VAT NTP
        sale.comments ?? '',
      ]);
      row.getCell(1).numFmt = DATE_FMT;
      row.getCell(4).numFmt = IMEI_FMT;
      row.getCell(7).numFmt = MONEY_FMT;            // BP
      row.getCell(8).numFmt = MONEY_FMT;            // SP
      row.getCell(9).value  = { formula: f.spMinusBp! };    row.getCell(9).numFmt  = MONEY_FMT;
      row.getCell(10).value = { formula: f.marginalTax! };  row.getCell(10).numFmt = MONEY_FMT;
      row.getCell(11).value = { formula: f.commission! };   row.getCell(11).numFmt = MONEY_FMT;
      row.getCell(12).value = { formula: f.rof! };          row.getCell(12).numFmt = MONEY_FMT;
      row.getCell(13).value = Number(f.fvf);                row.getCell(13).numFmt = MONEY_FMT;
      row.getCell(14).value = { formula: f.vat20! };        row.getCell(14).numFmt = MONEY_FMT;
      row.getCell(15).value = { formula: f.totalCom! };     row.getCell(15).numFmt = MONEY_FMT;
      row.getCell(16).numFmt = MONEY_FMT;                   // Postage (literal above)
      if (sale.postageVatExempt) {
        row.getCell(17).value = 0;
      } else {
        row.getCell(17).value = { formula: f.postageVat! };
      }
      row.getCell(17).numFmt = MONEY_FMT;
      if (!hasExplicitMarketing) {
        row.getCell(18).value = { formula: f.marketing! };
      }
      row.getCell(18).numFmt = MONEY_FMT;                   // Marketing
      row.getCell(19).value = { formula: f.marketingVat! }; row.getCell(19).numFmt = MONEY_FMT;
      row.getCell(20).numFmt = MONEY_FMT;                   // Accessories (literal above)
      row.getCell(21).value = { formula: f.totalVat! };     row.getCell(21).numFmt = MONEY_FMT;
      row.getCell(22).value = { formula: f.grossProfit! };  row.getCell(22).numFmt = MONEY_FMT;
      row.getCell(23).value = { formula: f.gpPercent! };    row.getCell(23).numFmt = MONEY_FMT;
      row.getCell(24).value = { formula: f.totalVatNtp! };  row.getCell(24).numFmt = MONEY_FMT;
      return;
    }

    case 'ONBUY': {
      // 2026-05 schema. 19 cols. No quantity column (OnBuy convention).
      //   A=Date,B=OrderNo,C=SKU,D=IMEI,E=Supplier,
      //   F=BP,G=SP,H=SP-BP,I=MarTax,J=Com,K=VAT20%,
      //   L=Postage,M=P.VAT,N=Acc,O=TotVAT,P=GP,
      //   Q=GP%,R=TotVAT NTP,S=Comments
      const row = sheet.addRow([
        date, sale.orderNumber, sale.sku ?? '', sale.imei ?? '',
        sale.supplierName ?? '',
        sale.buyPrice, sale.salePrice,
        null, null, null, null,                       // SP-BP, MarTax, Com, VAT20%
        sale.postage ?? null,                         // Postage (literal)
        null,                                         // P. VAT (formula)
        sale.accessoryFee ?? Number(f.accessoryFee ?? 1),  // Accessories (literal)
        null, null, null, null,                       // Total VAT, GP, GP%, Total VAT NTP
        sale.comments ?? '',
      ]);
      row.getCell(1).numFmt = DATE_FMT;
      row.getCell(4).numFmt = IMEI_FMT;
      row.getCell(6).numFmt = MONEY_FMT;   // BP (F)
      row.getCell(7).numFmt = MONEY_FMT;   // SP (G)
      row.getCell(8).value  = { formula: f.spMinusBp! };    row.getCell(8).numFmt  = MONEY_FMT;
      row.getCell(9).value  = { formula: f.marginalTax! };  row.getCell(9).numFmt  = MONEY_FMT;
      row.getCell(10).value = { formula: f.commission! };   row.getCell(10).numFmt = MONEY_FMT;
      row.getCell(11).value = { formula: f.vat20! };        row.getCell(11).numFmt = MONEY_FMT;
      row.getCell(12).numFmt = MONEY_FMT;                   // Postage (literal above)
      if (sale.postageVatExempt) {
        row.getCell(13).value = 0;
      } else {
        row.getCell(13).value = { formula: f.postageVat! };
      }
      row.getCell(13).numFmt = MONEY_FMT;
      row.getCell(14).numFmt = MONEY_FMT;                   // Accessories (literal above)
      row.getCell(15).value = { formula: f.totalVat! };     row.getCell(15).numFmt = MONEY_FMT;
      row.getCell(16).value = { formula: f.grossProfit! };  row.getCell(16).numFmt = MONEY_FMT;
      row.getCell(17).value = { formula: f.gpPercent! };    row.getCell(17).numFmt = MONEY_FMT;
      row.getCell(18).value = { formula: f.totalVatNtp! };  row.getCell(18).numFmt = MONEY_FMT;
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

  // Per-marketplace sheets ONLY — the client's Sales Report has exactly four
  // tabs (AMAZON / BM / EBAY / ONBUY). No combined 'ALL' sheet; the operator
  // doesn't generate or hand over an all-in-one view, only the four
  // marketplace-shaped sheets. PROJECT excluded — we sell on 4 platforms.
  for (const m of MARKETPLACES) {
    const sheet = wb.addWorksheet(m);
    sheet.addRow(SALES_HEADERS[m]);

    const bucket = byMarketplace.get(m) ?? [];
    const headerLen = (SALES_HEADERS[m] as unknown as unknown[]).length;
    for (let i = 0; i < bucket.length; i++) {
      const rowNumber = i + 2; // skip header
      const sale = bucket[i];
      writeSaleRow(sheet, m, sale, rowNumber);
      // Red fill applied across every cell of any row the operator has
      // marked as needing attention — either a soft-deleted void (voidedAt)
      // or a red-row import flag carried from the source workbook. Same
      // visual signal in both cases so the export looks identical to the
      // operator's hand-painted Sales Report sheet.
      if (sale.voidedAt || sale.flagged) {
        const row = sheet.getRow(rowNumber);
        for (let col = 1; col <= headerLen; col++) {
          row.getCell(col).fill = RETURNED_FILL;
        }
      }
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
 * Download just the SALES_REPORT workbook — exactly four per-marketplace
 * sheets (AMAZON / BM / EBAY / ONBUY) mirroring the client's source format.
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
