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
  // Export-only column. The import parser keys off HEADER_ALIASES in
  // InventoryReportImport.tsx and silently drops unknown headers, so
  // adding "AGE (DAYS)" here does not affect re-import — the round-trip
  // (download → edit → upload) still reads back the same shape it
  // always did. Don't add an alias to the parser for this header.
  'AGE (DAYS)',
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

  const MS_PER_DAY = 86_400_000;
  const nowMs = Date.now();
  for (const unit of units) {
    const stockInDate = toDate(unit.dateIn);
    const stockOutDate = toDate(unit.stockOutDate ?? unit.saleDate);
    const supplierName = unit.supplierName
      ?? joinSupplierNames(unit.supplierIds, suppliers)
      ?? '';

    // Days since the unit arrived in the office. For sold units that's
    // a useful "did this take long to move?" read; for available stock
    // it's the live office-age. Operator wanted Age as a downloadable
    // signal — computed at export time, not stored, so it's always
    // current as of the moment the workbook was generated.
    const ageDays = stockInDate
      ? Math.max(0, Math.floor((nowMs - stockInDate.getTime()) / MS_PER_DAY))
      : null;

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
      ageDays,
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
    // K: AGE (DAYS) — integer
    row.getCell(11).numFmt = '0';
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
    // Return-loss column — voided sales carry (postage + P.VAT) × legs
    // (2 for a refund, 3 for a replacement). Empty for active sales.
    // Lets the CA total the column for the period's postage exposure.
    // Also subtracted from GP inside the GP % cell so the per-row %
    // shows the true net margin after the return hit.
    'Postage Loss',
  ],
  BM: [
    'Date', 'Order Number', 'SKU', 'IMEI', 'Supplier', 'Quantity',
    'BP', 'SP', 'SP-BP', 'Marginal Tax', 'Commission',
    'Customer Care Fees', 'Postage', 'P. VAT', 'Accessories',
    'GP', 'GP %', 'Total VAT NTP', 'Comments', 'Postage Loss',
  ],
  EBAY: [
    'Date', 'Order Number', 'SKU', 'IMEI', 'Supplier', 'Units',
    'BP', 'SP', 'SP-BP', 'Marginal Tax', 'Commission', 'ROF', 'FVF', 'VAT',
    'T.COM', 'Postage', 'P. VAT', 'Marketing', 'M. VAT', 'Accessories',
    'Total VAT', 'GP', 'GP %', 'Total VAT NTP', 'Comments', 'Postage Loss',
  ],
  ONBUY: [
    'Date', 'Order Number', 'SKU', 'IMEI', 'Supplier',
    'BP', 'SP', 'SP-BP', 'Marginal Tax', 'Commission', 'VAT 20%',
    'Postage', 'P. VAT', 'Accessories',
    'Total VAT', 'GP', 'GP %', 'Total VAT NTP', 'Comments', 'Postage Loss',
  ],
};

const DATE_FMT = '[$-409]d\\-mmm\\-yyyy';
const MONEY_FMT = '0.00';
const IMEI_FMT = '0';

/** Per-sale postage loss (£). 0 for active sales; for voided sales
 *  it's (postage + P.VAT) × shipping legs, where refund = 2 legs and
 *  replacement = 3. Used as the trailing Postage Loss column on every
 *  marketplace sheet so the CA can tally the period's exposure. */
function postageLossFor(sale: Sale): number {
  if (!sale.voidedAt) return 0;
  const postage = Number(sale.postage) || 0;
  const pvat = sale.postageVatExempt ? 0 : (Number(sale.postageVat) || postage * 0.2);
  const legs = sale.voidOutcome === 'replacement' ? 3 : 2;
  return (postage + pvat) * legs;
}

/** Write the Postage Loss cell on the trailing column of the current
 *  marketplace's row. No-op when the sale isn't voided so active rows
 *  stay clean (Excel filters / sums on the column treat blanks as 0). */
function writePostageLoss(row: ExcelJS.Row, marketplace: Marketplace, sale: Sale): void {
  const loss = postageLossFor(sale);
  if (loss <= 0) return;
  const col = SALES_HEADERS[marketplace].length;
  row.getCell(col).value = loss;
  row.getCell(col).numFmt = MONEY_FMT;
}

/**
 * Write one sale row into the given sheet with the correct base values,
 * formulas (sourced from `excelFormulaFor`) and per-cell number formats.
 */
function writeSaleRow(
  sheet: ExcelJS.Worksheet,
  marketplace: Marketplace,
  sale: Sale,
  rowNumber: number,
  /** Pre-resolved supplier display name from the caller. Threads the
   *  supplierMap + unitsById lookup that lives at the workbook level
   *  through so each per-marketplace row writes the canonical
   *  supplier instead of an empty cell when `sale.supplierName` is
   *  itself missing. */
  resolvedSupplier: string = '',
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
        resolvedSupplier, qty,
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
      writePostageLoss(row, marketplace, sale);
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
        resolvedSupplier, qty,
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
      row.getCell(14).value = { formula: f.postageVat! };   row.getCell(14).numFmt = MONEY_FMT;
      row.getCell(15).numFmt = MONEY_FMT;                   // Accessories (literal above)
      row.getCell(16).value = { formula: f.grossProfit! };  row.getCell(16).numFmt = MONEY_FMT;
      row.getCell(17).value = { formula: f.gpPercent! };    row.getCell(17).numFmt = MONEY_FMT;
      row.getCell(18).value = { formula: f.totalVatNtp! };  row.getCell(18).numFmt = MONEY_FMT;
      writePostageLoss(row, marketplace, sale);
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
        resolvedSupplier, qty,
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
      row.getCell(17).value = { formula: f.postageVat! };   row.getCell(17).numFmt = MONEY_FMT;
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
      writePostageLoss(row, marketplace, sale);
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
        resolvedSupplier,
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
      row.getCell(13).value = { formula: f.postageVat! };   row.getCell(13).numFmt = MONEY_FMT;
      row.getCell(14).numFmt = MONEY_FMT;                   // Accessories (literal above)
      row.getCell(15).value = { formula: f.totalVat! };     row.getCell(15).numFmt = MONEY_FMT;
      row.getCell(16).value = { formula: f.grossProfit! };  row.getCell(16).numFmt = MONEY_FMT;
      row.getCell(17).value = { formula: f.gpPercent! };    row.getCell(17).numFmt = MONEY_FMT;
      row.getCell(18).value = { formula: f.totalVatNtp! };  row.getCell(18).numFmt = MONEY_FMT;
      writePostageLoss(row, marketplace, sale);
      return;
    }

  }
}

export async function buildSalesWorkbookBuffer(input: BuildSalesWorkbookInput): Promise<ArrayBuffer> {
  const { sales, units, supplierMap, opts } = input;

  // Pre-index units twice for the buy-side join + the legacy-return
  // enrichment below. unitsByImei catches sales that import never
  // back-linked (unitId still empty).
  const unitsById = new Map<string, InventoryUnit>();
  const unitsByImei = new Map<string, InventoryUnit>();
  for (const u of units ?? []) {
    if (u.id) unitsById.set(u.id, u);
    const k = (u.imei || '').trim().toUpperCase();
    if (k && !unitsByImei.has(k)) unitsByImei.set(k, u);
  }

  // Legacy-return enrichment: returns processed before the Sale-doc
  // void-fix landed only wrote returnType/returnDate on the unit
  // doc — the linked Sale stayed active, so its row in the report
  // came out white instead of red and the Postage Loss column stayed
  // blank. Synthesise voidedAt + voidOutcome at workbook-build time
  // from the linked unit when its status indicates a return AND the
  // Sale doc itself hasn't been voided. Doesn't touch Firestore;
  // the synthetic copy lives only inside this in-memory `enriched`
  // array for the current download.
  const enriched: Sale[] = sales.map(s => {
    if (s.voidedAt) return s;
    const k = (s.imei || '').trim().toUpperCase();
    const u = (s.unitId && unitsById.get(s.unitId)) || (k && unitsByImei.get(k)) || undefined;
    if (!u) return s;
    const looksReturned = u.status === 'returned'
      || u.returnType === 'returned_to_supplier'
      || u.returnType === 'returned_to_inventory'
      || u.returnType === 'repair';
    if (!looksReturned || !u.returnDate) return s;
    return {
      ...s,
      voidedAt: u.returnDate,
      voidReason: s.voidReason || u.returnReason
        || `${u.returnOutcome === 'replacement' ? 'Replacement' : 'Refund'}`,
      voidOutcome: s.voidOutcome || u.returnOutcome || 'refund',
    } as Sale;
  });

  const filtered = filterSalesByDate(enriched, opts);
  const byMarketplace = new Map<Marketplace, Sale[]>();
  for (const m of MARKETPLACES) byMarketplace.set(m, []);
  for (const sale of filtered) {
    const bucket = byMarketplace.get(sale.marketplace);
    if (bucket) bucket.push(sale);
  }

  const wb = new ExcelJS.Workbook();

  // Per-platform sheets only — the client's master SALES_REPORT carries
  // exactly four tabs (AMAZON SALES, BM SALES, EBAY SALES, ONBUY SALES);
  // the earlier ALL sheet was a Mobile Inventory invention the operator
  // never wanted. PROJECT excluded — we sell on 4 platforms only.
  for (const m of MARKETPLACES) {
    const sheet = wb.addWorksheet(m);
    sheet.addRow(SALES_HEADERS[m]);

    const bucket = byMarketplace.get(m) ?? [];
    const headerLen = (SALES_HEADERS[m] as unknown as unknown[]).length;
    for (let i = 0; i < bucket.length; i++) {
      const rowNumber = i + 2; // skip header
      const sale = bucket[i];
      // Resolve supplier name through the full fallback chain. The
      // sale doc's own supplierName is the first choice (operator
      // entered it on the spreadsheet); supplierMap is the canonical
      // suppliers collection (catches sale docs that only carry
      // supplierId); the linked unit is the last resort for in-app
      // sales that lost the supplier field for whatever reason.
      const resolvedSupplier =
        (sale.supplierName && sale.supplierName.trim())
        || (sale.supplierId && supplierMap?.[sale.supplierId])
        || (sale.unitId && unitsById.get(sale.unitId)?.supplierName)
        || '';
      writeSaleRow(sheet, m, sale, rowNumber, resolvedSupplier);
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

// ---------------------------------------------------------------------------
// RETURNS workbook
// ---------------------------------------------------------------------------

export interface BuildReturnsWorkbookInput {
  /** Every returned unit (and currently-in-stock units that have a sales
   *  history). The caller filters down to what's relevant — typically
   *  every unit with `returnType` set plus anything that's been sold. */
  units: InventoryUnit[];
  /** ALL sales — needed to reconstruct each unit's sale cycles for the
   *  Unit Histories sheet. We index by unitId and IMEI. */
  sales: Sale[];
  /** Resolves supplierId → supplier name. Falls back to the unit's
   *  stored supplierName when no map entry matches. */
  supplierMap?: Record<string, string>;
  /** from/to filter applied to RETURN dates on Sheet 2 + drives the
   *  period label on Sheet 1. Sheet 3 (unit histories) always shows
   *  the full timeline for whichever units land in the report. */
  opts?: ClientReportOptions;
}

/** Human-readable label for the unit's return type — same wording the
 *  Returns page uses on the KPI tiles and overlay headers. */
function returnTypeLabel(rt: InventoryUnit['returnType']): string {
  switch (rt) {
    case 'returned_to_inventory': return 'Back to Inventory';
    case 'repair':                return 'In Repair';
    case 'returned_to_supplier':  return 'To Supplier';
    default:                      return '';
  }
}

/** Default outcome when the unit doc doesn't carry one (legacy rows
 *  processed before outcome tracking landed). Conservative floor:
 *  refund = 2 shipping legs. */
function outcomeFor(u: InventoryUnit): 'refund' | 'replacement' {
  return u.returnOutcome ?? 'refund';
}

/** Postage-leg cost in £ for a return: the operator's snapshot first,
 *  otherwise derived from the linked voided Sale's (postage + P.VAT).
 *  Returns 0 when neither source is available. */
function legCostFor(u: InventoryUnit, linkedVoidedSale: Sale | undefined): number {
  if (typeof u.returnLegCost === 'number' && u.returnLegCost > 0) return u.returnLegCost;
  if (linkedVoidedSale) {
    const postage = Number(linkedVoidedSale.postage) || 0;
    const pVat = linkedVoidedSale.postageVatExempt
      ? 0
      : (Number(linkedVoidedSale.postageVat) || postage * 0.2);
    return postage + pVat;
  }
  return 0;
}

/** Total postage loss in £ for a unit: leg cost × number of shipping legs
 *  (refund = 2, replacement = 3). Mirrors `postageLossFor` for sales but
 *  reads off the unit-side fields with the voided-sale fallback baked in. */
function unitPostageLoss(u: InventoryUnit, linkedVoidedSale: Sale | undefined): number {
  const leg = legCostFor(u, linkedVoidedSale);
  if (leg <= 0) return 0;
  const legs = outcomeFor(u) === 'replacement' ? 3 : 2;
  return leg * legs;
}

/** Period label for the Summary sheet — matches the ReportRangeMenu
 *  conventions ("All Time", "Day · 2026-01-15", "Custom · 2026-01-01 → 2026-01-31"). */
function periodLabel(opts?: ClientReportOptions): string {
  if (!opts || (!opts.from && !opts.to)) return 'All Time';
  if (opts.from && opts.to && opts.from === opts.to) return `Day · ${opts.from}`;
  if (opts.from && opts.to) return `${opts.from} → ${opts.to}`;
  if (opts.from) return `From ${opts.from}`;
  if (opts.to) return `Through ${opts.to}`;
  return 'All Time';
}

export async function buildReturnsWorkbookBuffer(input: BuildReturnsWorkbookInput): Promise<ArrayBuffer> {
  const { units, sales, supplierMap, opts } = input;

  // Index sales for the unit ↔ sale match — unitId first, then IMEI
  // (uppercased + trimmed) so legacy imports that never back-linked the
  // sale doc still match. Mirrors the lookup convention used in
  // buildSalesWorkbookBuffer above.
  const salesByUnitId = new Map<string, Sale[]>();
  const salesByImei = new Map<string, Sale[]>();
  for (const s of sales) {
    if (s.unitId) {
      const arr = salesByUnitId.get(s.unitId) ?? [];
      arr.push(s);
      salesByUnitId.set(s.unitId, arr);
    }
    const k = (s.imei || '').trim().toUpperCase();
    if (k) {
      const arr = salesByImei.get(k) ?? [];
      arr.push(s);
      salesByImei.set(k, arr);
    }
  }

  /** All sales linked to a given unit — dedup'd across both indexes. */
  const salesForUnit = (u: InventoryUnit): Sale[] => {
    const byId = salesByUnitId.get(u.id) ?? [];
    const k = (u.imei || '').trim().toUpperCase();
    const byImei = k ? (salesByImei.get(k) ?? []) : [];
    if (byId.length === 0) return byImei;
    if (byImei.length === 0) return byId;
    const seen = new Set<string>();
    const merged: Sale[] = [];
    for (const s of [...byId, ...byImei]) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      merged.push(s);
    }
    return merged;
  };

  /** Most recent voided sale linked to this unit. Used for Sheet 2's
   *  "Original Sale Date / Sale Price / Marketplace" columns. */
  const latestVoidedSale = (u: InventoryUnit): Sale | undefined => {
    let best: Sale | undefined;
    for (const s of salesForUnit(u)) {
      if (!s.voidedAt) continue;
      if (!best || (s.voidedAt > (best.voidedAt || ''))) best = s;
    }
    return best;
  };

  const resolveSupplier = (u: InventoryUnit): string =>
    (u.supplierId && supplierMap?.[u.supplierId])
    || u.supplierName
    || '';

  const wb = new ExcelJS.Workbook();

  // -------- Sheet 1: Summary --------
  // Units with a return on file (returnDate set) that fall in the range.
  // The Summary headline figures come from this same subset so Sheet 1
  // and Sheet 2 stay in lock-step.
  const from = opts?.from ?? '0000-01-01';
  const to   = opts?.to   ?? '9999-12-31';
  const returnedInRange = units.filter(u =>
    u.returnType && u.returnDate && u.returnDate >= from && u.returnDate <= to,
  );

  let refundsCount = 0;
  let replacementsCount = 0;
  let totalLoss = 0;
  const lossByMarketplace = new Map<string, { count: number; loss: number }>();
  for (const u of returnedInRange) {
    const voided = latestVoidedSale(u);
    const loss = unitPostageLoss(u, voided);
    totalLoss += loss;
    if (outcomeFor(u) === 'replacement') replacementsCount++;
    else refundsCount++;
    const mp = voided?.marketplace || '—';
    const cur = lossByMarketplace.get(mp) ?? { count: 0, loss: 0 };
    cur.count++;
    cur.loss += loss;
    lossByMarketplace.set(mp, cur);
  }
  const totalReturns = returnedInRange.length;
  const avgLoss = totalReturns > 0 ? totalLoss / totalReturns : 0;

  const summary = wb.addWorksheet('Summary');
  summary.columns = [{ width: 28 }, { width: 24 }];
  const writeSummaryRow = (label: string, value: string | number, isMoney = false): void => {
    const row = summary.addRow([label, value]);
    row.getCell(1).font = { bold: true };
    if (isMoney && typeof value === 'number') row.getCell(2).numFmt = MONEY_FMT;
  };
  writeSummaryRow('Period', periodLabel(opts));
  writeSummaryRow('Total Returns', totalReturns);
  writeSummaryRow('Refunds', refundsCount);
  writeSummaryRow('Replacements', replacementsCount);
  writeSummaryRow('Total Postage Loss £', Number(totalLoss.toFixed(2)), true);
  writeSummaryRow('Avg Loss per Return £', Number(avgLoss.toFixed(2)), true);
  // Marketplace breakdown — section header + one row per marketplace.
  // Sorted by loss desc so the most expensive surface floats to the top.
  if (lossByMarketplace.size > 0) {
    summary.addRow([]);
    const header = summary.addRow(['By Marketplace', 'Returns · Loss £']);
    header.getCell(1).font = { bold: true };
    header.getCell(2).font = { bold: true };
    const sortedMp = Array.from(lossByMarketplace.entries())
      .sort((a, b) => b[1].loss - a[1].loss);
    for (const [mp, agg] of sortedMp) {
      const row = summary.addRow([mp, `${agg.count} · £${agg.loss.toFixed(2)}`]);
      row.getCell(1).font = { bold: true };
    }
  }

  // -------- Sheet 2: Returns Detail --------
  const detail = wb.addWorksheet('Returns Detail');
  const DETAIL_HEADERS = [
    'Return Date', 'Unit IMEI', 'Model', 'Storage', 'Colour', 'Supplier',
    'Original Sale Date', 'Original Sale Price', 'Marketplace',
    'Return Type', 'Outcome', 'Reason', 'Comments',
    'Leg Cost £', 'Shipping Legs', 'Postage Loss £',
  ];
  detail.addRow(DETAIL_HEADERS);

  // Sort by Return Date desc — newest first, matches the in-app default.
  const detailSorted = [...returnedInRange].sort(
    (a, b) => (b.returnDate || '').localeCompare(a.returnDate || ''),
  );

  for (const u of detailSorted) {
    const voided = latestVoidedSale(u);
    const outcome = outcomeFor(u);
    const legs = outcome === 'replacement' ? 3 : 2;
    const leg = legCostFor(u, voided);
    const loss = leg > 0 ? leg * legs : 0;

    const row = detail.addRow([
      toDate(u.returnDate),
      u.imei || '',
      u.model || '',
      u.storage || '',
      u.colour || '',
      resolveSupplier(u),
      voided?.saleDate ? toDate(voided.saleDate) : null,
      voided?.salePrice ?? null,
      voided?.marketplace ?? '',
      returnTypeLabel(u.returnType),
      outcome === 'replacement' ? 'Replacement' : 'Refund',
      u.returnReason || '',
      u.returnComments || '',
      leg > 0 ? leg : null,
      legs,
      loss > 0 ? loss : null,
    ]);
    row.getCell(1).numFmt = DATE_FMT;     // Return Date
    row.getCell(2).numFmt = IMEI_FMT;     // IMEI
    row.getCell(7).numFmt = DATE_FMT;     // Original Sale Date
    row.getCell(8).numFmt = MONEY_FMT;    // Sale Price
    row.getCell(14).numFmt = MONEY_FMT;   // Leg Cost £
    row.getCell(16).numFmt = MONEY_FMT;   // Postage Loss £

    // Voided / returned rows get the same rose fill the Sales workbook
    // uses on every voided line — operator's eye picks them out at a
    // glance. Applied across every cell so the fill covers the row.
    for (let col = 1; col <= DETAIL_HEADERS.length; col++) {
      row.getCell(col).fill = RETURNED_FILL;
    }
  }

  // -------- Sheet 3: Unit Histories --------
  // One row per lifecycle event, grouped visually by sorting on Unit
  // IMEI then event date. Range filter does NOT apply here — once a
  // unit's in the report, its complete timeline ships.
  const histories = wb.addWorksheet('Unit Histories');
  const HISTORY_HEADERS = [
    'Unit IMEI', 'Model', 'Event Date', 'Event', 'Detail', 'Amount £', 'Comments',
  ];
  histories.addRow(HISTORY_HEADERS);

  type HistRow = {
    imei: string;
    model: string;
    eventDate: string;
    event: 'STOCK IN' | 'SOLD' | 'RETURNED' | 'STATUS';
    detail: string;
    amount: number | null;
    comments: string;
  };

  // Same universe as Sheet 2 — only units with a return on file. The
  // sales-cycle history we emit below covers all linked sales, even
  // ones that fell outside the range filter.
  const historyUnits = units.filter(u => u.returnType && u.returnDate);

  const allEvents: HistRow[] = [];
  for (const u of historyUnits) {
    const imei = u.imei || '';
    const model = u.model || '';
    const supplier = resolveSupplier(u);

    // STOCK IN — anchored to dateIn.
    allEvents.push({
      imei, model,
      eventDate: u.dateIn || '',
      event: 'STOCK IN',
      detail: supplier,
      amount: typeof u.buyPrice === 'number' ? u.buyPrice : null,
      comments: '',
    });

    // Per-sale events. Sort linked sales by date asc so a unit's
    // sell→return→re-sell cycles read top-to-bottom in chronological
    // order under each IMEI group.
    const linked = salesForUnit(u)
      .slice()
      .sort((a, b) => (a.saleDate || '').localeCompare(b.saleDate || ''));

    // Latest voided sale id — used to scope the unit-level
    // returnComments to one row (the most-recent return) so we don't
    // smear the same comment across older cycles.
    const latestVoid = latestVoidedSale(u);
    const latestVoidId = latestVoid?.id;

    let matchedLatestReturnFromSale = false;
    for (const s of linked) {
      allEvents.push({
        imei, model,
        eventDate: s.saleDate || '',
        event: 'SOLD',
        detail: `${s.marketplace} · ${s.orderNumber || ''}`.replace(/ · $/, ''),
        amount: typeof s.salePrice === 'number' ? s.salePrice : null,
        comments: s.comments || '',
      });
      if (s.voidedAt) {
        const out = (s.voidOutcome ?? outcomeFor(u));
        const postage = Number(s.postage) || 0;
        const pVat = s.postageVatExempt ? 0 : (Number(s.postageVat) || postage * 0.2);
        const legs = out === 'replacement' ? 3 : 2;
        const loss = (postage + pVat) * legs;
        const reason = s.voidReason || u.returnReason || '';
        const detailParts = [out === 'replacement' ? 'Replacement' : 'Refund', reason].filter(Boolean);
        allEvents.push({
          imei, model,
          eventDate: s.voidedAt,
          event: 'RETURNED',
          detail: detailParts.join(' · '),
          amount: loss > 0 ? -loss : null,
          // Only the most-recent return row carries the unit-level
          // returnComments (avoids duplicating the same comment across
          // every cycle in this unit's history).
          comments: s.id === latestVoidId ? (u.returnComments || '') : '',
        });
        if (s.id === latestVoidId) matchedLatestReturnFromSale = true;
      }
    }

    // Legacy fallback — return on the unit doc but no matching voided
    // Sale surfaced above for the latest cycle. Surface a RETURNED row
    // from the unit-side fields so legacy returns still appear.
    if (u.returnType && !matchedLatestReturnFromSale) {
      const out = outcomeFor(u);
      const leg = legCostFor(u, undefined);
      const legs = out === 'replacement' ? 3 : 2;
      const loss = leg > 0 ? leg * legs : 0;
      const reason = u.returnReason || '';
      const detailParts = [out === 'replacement' ? 'Replacement' : 'Refund', reason].filter(Boolean);
      allEvents.push({
        imei, model,
        eventDate: u.returnDate || '',
        event: 'RETURNED',
        detail: detailParts.join(' · '),
        amount: loss > 0 ? -loss : null,
        comments: u.returnComments || '',
      });
    }

    // STATUS — only emitted while the unit is still in the returns flow
    // (i.e. status === 'returned'). Acts as a "current state" anchor at
    // the tail of the unit's timeline.
    if (u.status === 'returned') {
      allEvents.push({
        imei, model,
        eventDate: u.returnDate || '',
        event: 'STATUS',
        detail: returnTypeLabel(u.returnType),
        amount: null,
        comments: '',
      });
    }
  }

  // Group visually by IMEI, then chronological within each unit's block.
  // STATUS rows always sit at the tail of their unit's block.
  const eventOrder: Record<HistRow['event'], number> = {
    'STOCK IN': 0,
    'SOLD':     1,
    'RETURNED': 2,
    'STATUS':   3,
  };
  allEvents.sort((a, b) => {
    if (a.imei !== b.imei) return a.imei.localeCompare(b.imei);
    if (a.eventDate !== b.eventDate) return a.eventDate.localeCompare(b.eventDate);
    return eventOrder[a.event] - eventOrder[b.event];
  });

  for (const e of allEvents) {
    const row = histories.addRow([
      e.imei,
      e.model,
      e.eventDate ? toDate(e.eventDate) : null,
      e.event,
      e.detail,
      e.amount,
      e.comments,
    ]);
    row.getCell(1).numFmt = IMEI_FMT;
    row.getCell(3).numFmt = DATE_FMT;
    row.getCell(6).numFmt = MONEY_FMT;
    if (e.event === 'RETURNED') {
      for (let col = 1; col <= HISTORY_HEADERS.length; col++) {
        row.getCell(col).fill = RETURNED_FILL;
      }
    }
  }

  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

/**
 * Download the RETURNS report workbook (Summary + Returns Detail +
 * Unit Histories). Used by the Returns-screen "Returns Report" button.
 * Filename carries YYYY-MM-DD_HHMM so multiple pulls per day sort
 * chronologically — matches downloadSalesWorkbook's convention.
 */
export async function downloadReturnsWorkbook(input: BuildReturnsWorkbookInput): Promise<void> {
  const buf = await buildReturnsWorkbookBuffer(input);
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  triggerBrowserDownload(buf, `returns-report-${stamp}.xlsx`);
}
