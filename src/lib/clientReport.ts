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
    // ── Return-linkage block ────────────────────────────────────────────
    // Auditor needs to see WHY a row is red without reverse-engineering
    // the Postage Loss multiplier. Each block is populated only when the
    // sale is voided (refund / replacement); active sales leave the
    // cells blank so column SUM / COUNTIF over the period works cleanly.
    'Return Date', 'Outcome', 'Return Reason', 'Shipping Legs',
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
    'GP', 'GP %', 'Total VAT NTP', 'Comments',
    'Return Date', 'Outcome', 'Return Reason', 'Shipping Legs',
    'Postage Loss',
  ],
  EBAY: [
    'Date', 'Order Number', 'SKU', 'IMEI', 'Supplier', 'Units',
    'BP', 'SP', 'SP-BP', 'Marginal Tax', 'Commission', 'ROF', 'FVF', 'VAT',
    'T.COM', 'Postage', 'P. VAT', 'Marketing', 'M. VAT', 'Accessories',
    'Total VAT', 'GP', 'GP %', 'Total VAT NTP', 'Comments',
    'Return Date', 'Outcome', 'Return Reason', 'Shipping Legs',
    'Postage Loss',
  ],
  ONBUY: [
    'Date', 'Order Number', 'SKU', 'IMEI', 'Supplier',
    'BP', 'SP', 'SP-BP', 'Marginal Tax', 'Commission', 'VAT 20%',
    'Postage', 'P. VAT', 'Accessories',
    'Total VAT', 'GP', 'GP %', 'Total VAT NTP', 'Comments',
    'Return Date', 'Outcome', 'Return Reason', 'Shipping Legs',
    'Postage Loss',
  ],
};

const DATE_FMT = '[$-409]d\\-mmm\\-yyyy';
const MONEY_FMT = '0.00';
const IMEI_FMT = '0';

/** Per-sale postage loss (£). 0 for active sales AND for repair-route
 *  it's (postage + P.VAT) × shipping legs. Refund = 2 legs (outbound +
 *  inbound), replacement = 3 (plus the replacement outbound), repair = 2
 *  (outbound to the customer + the faulty unit shipped back to us — the
 *  unit then goes back to stock, but both carriage legs are a real loss).
 *  Used as the trailing Postage Loss column on every marketplace sheet so
 *  the CA can tally the period's exposure. */
export function postageLossFor(sale: Sale): number {
  if (!sale.voidedAt) return 0;
  const postage = Number(sale.postage) || 0;
  const pvat = sale.postageVatExempt ? 0 : (Number(sale.postageVat) || postage * 0.2);
  const legs = sale.voidOutcome === 'replacement' ? 3 : 2;  // refund + repair both eat 2
  return (postage + pvat) * legs;
}

/** Number of shipping legs eaten by a void. Refund = 2 (outbound +
 *  inbound), replacement = 3 (plus the replacement outbound), repair = 2
 *  (outbound + inbound — the unit comes back, but both legs were paid). */
export function shippingLegsFor(sale: Sale): number {
  if (!sale.voidedAt) return 0;
  return sale.voidOutcome === 'replacement' ? 3 : 2;
}

/** Convert a 1-indexed column number to an Excel letter (1=A, 26=Z, 27=AA, etc).
 *  The Sales Report's wider sheets (EBAY at 30 cols) cross the Z boundary, so
 *  the GP % formula needs this to reference the trailing Postage Loss cell. */
export function colLetter(n: number): string {
  let s = '';
  let x = n;
  while (x > 0) {
    const m = (x - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

/** Cap of the marketplace-specific return-info block (Return Date, Outcome,
 *  Return Reason, Shipping Legs) — the 4 columns sitting between Comments
 *  and the trailing Postage Loss cell. Letters land beyond Z on EBAY. */
function returnBlockOffsets(marketplace: Marketplace): {
  returnDateCol: number;
  outcomeCol: number;
  reasonCol: number;
  legsCol: number;
  postageLossCol: number;
} {
  const last = SALES_HEADERS[marketplace].length;
  return {
    returnDateCol: last - 4,
    outcomeCol:    last - 3,
    reasonCol:     last - 2,
    legsCol:       last - 1,
    postageLossCol: last,
  };
}

/** Title-case the void outcome for the auditor-facing Outcome cell.
 *  Empty for active sales (no void recorded). Reads the canonical
 *  Sale.voidOutcome — the legacy enrichment in build*WorkbookBuffer
 *  back-fills 'repair' on old voids whose linked unit shows repair
 *  markers, so this stays a pure Sale-side lookup. */
function outcomeLabel(sale: Sale): string {
  if (!sale.voidedAt) return '';
  switch (sale.voidOutcome) {
    case 'replacement': return 'Replacement';
    case 'repair':      return 'In Repair';
    default:            return 'Refund';
  }
}

/** Write the trailing return-linkage block (Return Date, Outcome, Reason,
 *  Shipping Legs) plus the Postage Loss cell. No-op for active sales so
 *  column SUM / COUNTIF over the period treats blanks as 0 / no-match.
 *
 *  Repair-route voids (Sale.voidOutcome === 'repair') keep their "In
 *  Repair" outcome label but DO carry 2 legs of postage loss (outbound +
 *  inbound) per the operator's accounting policy — the unit comes back to
 *  stock, but both carriage legs were paid. */
function writeReturnBlock(row: ExcelJS.Row, marketplace: Marketplace, sale: Sale): void {
  if (!sale.voidedAt) return;
  const o = returnBlockOffsets(marketplace);
  row.getCell(o.returnDateCol).value  = toDate(sale.voidedAt);
  row.getCell(o.returnDateCol).numFmt = DATE_FMT;
  row.getCell(o.outcomeCol).value     = outcomeLabel(sale);
  row.getCell(o.reasonCol).value      = sale.voidReason ?? '';
  row.getCell(o.legsCol).value        = shippingLegsFor(sale);
  const loss = postageLossFor(sale);
  if (loss > 0) {
    row.getCell(o.postageLossCol).value  = loss;
    row.getCell(o.postageLossCol).numFmt = MONEY_FMT;
  }
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
      writeReturnBlock(row, marketplace, sale);
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
      writeReturnBlock(row, marketplace, sale);
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
      writeReturnBlock(row, marketplace, sale);
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
      writeReturnBlock(row, marketplace, sale);
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

  // Heuristic: was THIS unit ever a repair-route return? Looks for the
  // current returnType OR ReadyToShipModal's post-completion markers
  // (repairedAt set, or the 'repaired_unit' flag). Used by the legacy
  // backfill below to recognise old voids that pre-date the canonical
  // Sale.voidOutcome='repair' stamp introduced in this round.
  const wasRepairRoute = (u: InventoryUnit | undefined): boolean => {
    if (!u) return false;
    if (u.returnType === 'repair') return true;
    if (u.repairedAt) return true;
    return Array.isArray(u.flags) && u.flags.includes('repaired_unit');
  };

  // Two enrichment paths, both in-memory only (don't touch Firestore):
  //
  // 1) Sales with voidedAt set but voidOutcome MISSING (pre-canonical voids):
  //    backfill voidOutcome to 'repair' when the linked unit shows repair
  //    markers. Catches voids written before this round started stamping
  //    'repair' on the Sale doc — without this they'd default to 'refund'
  //    in every renderer and inject phantom postage loss (QA round 3
  //    BUG-RP-002 reproduction).
  //
  // 2) Sales with no voidedAt at all but the linked unit IS marked
  //    returned (pre-2026-05 legacy where the void only landed on the unit):
  //    synthesise voidedAt + voidOutcome from the unit so the row paints
  //    red and the Postage Loss column populates. Same enrichment as
  //    before — repair-route still maps to voidOutcome='repair'.
  const enriched: Sale[] = sales.map(s => {
    const k = (s.imei || '').trim().toUpperCase();
    const u = (s.unitId && unitsById.get(s.unitId)) || (k && unitsByImei.get(k)) || undefined;

    if (s.voidedAt) {
      // Path 1 — already voided, but maybe missing the canonical outcome.
      if (s.voidOutcome) return s;
      if (wasRepairRoute(u)) return { ...s, voidOutcome: 'repair' } as Sale;
      return s;
    }

    if (!u) return s;
    const looksReturned = u.status === 'returned'
      || u.returnType === 'returned_to_supplier'
      || u.returnType === 'returned_to_inventory'
      || u.returnType === 'repair';
    if (!looksReturned || !u.returnDate) return s;
    // Path 2 — synthesise voidedAt + outcome from the unit.
    const isRepair = wasRepairRoute(u);
    const synthOutcome: 'refund' | 'replacement' | 'repair' = isRepair
      ? 'repair'
      : u.returnOutcome ?? 'refund';
    const fallbackReason = synthOutcome === 'replacement'
      ? 'Replacement'
      : synthOutcome === 'repair'
      ? 'In Repair'
      : 'Refund';
    return {
      ...s,
      voidedAt: u.returnDate,
      voidReason: s.voidReason || u.returnReason || fallbackReason,
      voidOutcome: synthOutcome,
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

  // Sheet 1: Summary — auditor-facing roll-up of the period (period label,
  // per-marketplace breakdown, refund vs replacement counts, gross + net GP
  // including postage-loss adjustment). Built before the marketplace sheets
  // so it lands as the leftmost tab.
  writeSalesSummarySheet(wb, byMarketplace, opts);

  // Sheet 2: Returns — single consolidated view of every voided sale in
  // the period, cross-marketplace, with the return-info columns up front
  // (Return Date / Outcome / Reason / Legs / Postage Loss) so the auditor
  // doesn't have to scroll past 20 sale columns on each marketplace tab to
  // find them. Filtered from the same date-scoped pool the marketplace
  // tabs draw from, so row counts reconcile with the Summary.
  writeSalesReturnsSheet(wb, byMarketplace);

  // Per-platform sheets — the client's master SALES_REPORT carries exactly
  // four tabs (AMAZON SALES, BM SALES, EBAY SALES, ONBUY SALES); PROJECT
  // excluded — we sell on 4 platforms only.
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
        || (sale.imei && unitsByImei.get((sale.imei || '').trim().toUpperCase())?.supplierName)
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

    // Totals row immediately below the data so the auditor can read the
    // sum without scrolling. SUM formulas only — Excel handles re-totalling
    // if the operator edits an individual cell.
    if (bucket.length > 0) {
      writeMarketplaceTotalsRow(sheet, m, bucket.length);
    }
  }

  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

/** Numeric columns to SUM per marketplace in the trailing TOTAL row. Stored
 *  as 1-indexed column numbers so the writer can read the matching value
 *  cell back for the cross-marketplace summary roll-up. */
const TOTAL_SUM_COLS: Record<Marketplace, { label: number; numericCols: number[]; gpCol: number; gpPctCol: number; postageLossCol: number; denominatorCol: number }> = {
  // AMAZON: 27 cols. BP=7(G), SP=8(H), GP=19(S), GP%=20(T), Postage Loss=27(AA).
  // SUM cols: quantity F=6, BP G=7, SP H=8, SP-BP I=9, MarTax J=10, Com K=11,
  //   C.VAT L=12, DSF M=13, DSF.VAT N=14, Postage O=15, P.VAT P=16, Acc Q=17,
  //   Total VAT R=18, GP S=19, Total VAT NTP U=21, Postage Loss AA=27.
  AMAZON: {
    label: 1,
    numericCols: [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 27],
    gpCol: 19, gpPctCol: 20, postageLossCol: 27, denominatorCol: 7,
  },
  // BM: 24 cols. GP=16(P), GP%=17(Q), Postage Loss=24(X), denominator=BP G=7.
  BM: {
    label: 1,
    numericCols: [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 24],
    gpCol: 16, gpPctCol: 17, postageLossCol: 24, denominatorCol: 7,
  },
  // EBAY: 30 cols. GP=22(V), GP%=23(W), Postage Loss=30(AD), denominator=SP H=8.
  EBAY: {
    label: 1,
    numericCols: [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 24, 30],
    gpCol: 22, gpPctCol: 23, postageLossCol: 30, denominatorCol: 8,
  },
  // ONBUY: 24 cols. GP=16(P), GP%=17(Q), Postage Loss=24(X), denominator=BP F=6.
  ONBUY: {
    label: 1,
    numericCols: [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 24],
    gpCol: 16, gpPctCol: 17, postageLossCol: 24, denominatorCol: 6,
  },
};

/** Append a bold "TOTAL" row with SUM(...) formulas across the numeric
 *  columns. The GP % cell uses the same net-of-postage-loss math as the
 *  per-row formula so the column reconciles top-to-bottom. */
function writeMarketplaceTotalsRow(
  sheet: ExcelJS.Worksheet,
  marketplace: Marketplace,
  dataRowCount: number,
): void {
  const cfg = TOTAL_SUM_COLS[marketplace];
  const firstDataRow = 2;
  const lastDataRow = firstDataRow + dataRowCount - 1;
  const totalRow = lastDataRow + 1;
  const blankRow: Array<string | number | null> = Array(SALES_HEADERS[marketplace].length).fill(null);
  blankRow[cfg.label - 1] = 'TOTAL';
  const row = sheet.addRow(blankRow);
  for (const col of cfg.numericCols) {
    const letter = colLetter(col);
    row.getCell(col).value  = { formula: `SUM(${letter}${firstDataRow}:${letter}${lastDataRow})` };
    row.getCell(col).numFmt = MONEY_FMT;
  }
  // Net GP % across the totalled rows = (Total GP − Total Postage Loss) / Total Denominator × 100.
  const gpL    = colLetter(cfg.gpCol);
  const lossL  = colLetter(cfg.postageLossCol);
  const denomL = colLetter(cfg.denominatorCol);
  row.getCell(cfg.gpPctCol).value  = {
    formula: `IFERROR((${gpL}${totalRow}-${lossL}${totalRow})/${denomL}${totalRow}*100,0)`,
  };
  row.getCell(cfg.gpPctCol).numFmt = MONEY_FMT;
  // Bold the TOTAL label + the SUM cells so the row reads as a footer.
  row.font = { bold: true };
  row.getCell(cfg.label).fill = {
    type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' },  // slate-100
  };
}

/** Per-marketplace cell positions used by the Summary roll-up. Mirrors
 *  TOTAL_SUM_COLS but adds a few extras the writer needs to display: the
 *  shipping-legs column (so we can COUNT refunds vs replacements) and the
 *  outcome column (text matched by COUNTIF). */
interface SummaryColRefs {
  bp: string; sp: string; gp: string; loss: string; outcome: string;
}
function summaryColRefs(m: Marketplace): SummaryColRefs {
  const offsets = returnBlockOffsets(m);
  const cfg = TOTAL_SUM_COLS[m];
  return {
    bp:      colLetter(m === 'ONBUY' ? 6 : 7),    // ONBUY: BP=F, others: BP=G
    sp:      colLetter(m === 'ONBUY' ? 7 : 8),    // ONBUY: SP=G, others: SP=H
    gp:      colLetter(cfg.gpCol),
    loss:    colLetter(cfg.postageLossCol),
    outcome: colLetter(offsets.outcomeCol),
  };
}

/** Sheet 1: cross-marketplace summary roll-up. Period label + a 6-column
 *  breakdown table (Marketplace / Sales / Refunds / Replacements / Gross
 *  GP / Postage Loss / Net GP / Net GP %) followed by a grand-total row.
 *  Numbers are SUM-formula references back to the per-marketplace sheets
 *  so any later edit in a sale row cascades into the Summary without a
 *  manual refresh. */
function writeSalesSummarySheet(
  wb: ExcelJS.Workbook,
  byMarketplace: Map<Marketplace, Sale[]>,
  opts?: ClientReportOptions,
): void {
  const sheet = wb.addWorksheet('Summary');
  sheet.columns = [
    { width: 18 }, { width: 10 }, { width: 11 }, { width: 14 },
    { width: 13 }, { width: 14 }, { width: 13 }, { width: 11 },
  ];

  // Title block.
  const title = sheet.addRow(['Sales Report — Audit Summary', '', '', '', '', '', '', '']);
  title.getCell(1).font = { bold: true, size: 13 };
  sheet.addRow([`Period: ${periodLabel(opts)}`]);
  sheet.addRow([]);

  // Header row for the breakdown table. Money cols are 6-9.
  const header = sheet.addRow([
    'Marketplace', 'Sales', 'Refunds', 'Replacements', 'Repairs',
    'Gross GP £', 'Postage Loss £', 'Net GP £', 'Net GP %',
  ]);
  header.font = { bold: true };
  header.fill = {
    type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' },  // slate-100
  };
  const moneyCols = [6, 7, 8, 9];

  // One row per marketplace.
  const grand = { sales: 0, refunds: 0, replacements: 0, repairs: 0, gp: 0, loss: 0, netGp: 0, bp: 0 };
  for (const m of MARKETPLACES) {
    const bucket = byMarketplace.get(m) ?? [];
    if (bucket.length === 0) {
      const row = sheet.addRow([m, 0, 0, 0, 0, 0, 0, 0, 0]);
      for (const c of moneyCols) row.getCell(c).numFmt = MONEY_FMT;
      continue;
    }
    // Compute raw figures in JS (rather than cross-sheet formulas) so the
    // Summary tab reads correctly even before the operator clicks into a
    // marketplace tab to trigger ExcelJS lazy evaluation.
    let salesCount = 0, refundCount = 0, replaceCount = 0, repairCount = 0;
    let gp = 0, loss = 0, bp = 0;
    for (const s of bucket) {
      salesCount++;
      const sale = recomputeSale(s);
      gp += sale.grossProfit ?? 0;
      bp += s.buyPrice ?? 0;
      if (s.voidedAt) {
        // All three outcomes carry postage loss now (repair = 2 legs per
        // the operator's policy — outbound + faulty unit shipped back).
        // Repair keeps its own count so it's not conflated with customer
        // refunds. The build-time enrichment backfills voidOutcome='repair'
        // on legacy repair voids before this runs.
        loss += postageLossFor(s);
        if (s.voidOutcome === 'repair')             repairCount++;
        else if (s.voidOutcome === 'replacement')   replaceCount++;
        else                                        refundCount++;
      }
    }
    const netGp = gp - loss;
    const netGpPct = bp > 0 ? netGp / bp * 100 : 0;
    const row = sheet.addRow([m, salesCount, refundCount, replaceCount, repairCount,
      Number(gp.toFixed(2)), Number(loss.toFixed(2)),
      Number(netGp.toFixed(2)), Number(netGpPct.toFixed(2))]);
    for (const c of moneyCols) row.getCell(c).numFmt = MONEY_FMT;

    grand.sales        += salesCount;
    grand.refunds      += refundCount;
    grand.replacements += replaceCount;
    grand.repairs      += repairCount;
    grand.gp           += gp;
    grand.loss         += loss;
    grand.netGp        += netGp;
    grand.bp           += bp;
  }

  // Grand total.
  const grandNetGpPct = grand.bp > 0 ? grand.netGp / grand.bp * 100 : 0;
  const totalRow = sheet.addRow([
    'TOTAL', grand.sales, grand.refunds, grand.replacements, grand.repairs,
    Number(grand.gp.toFixed(2)), Number(grand.loss.toFixed(2)),
    Number(grand.netGp.toFixed(2)), Number(grandNetGpPct.toFixed(2)),
  ]);
  totalRow.font = { bold: true };
  totalRow.fill = {
    type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' },  // slate-200
  };
  for (const c of moneyCols) totalRow.getCell(c).numFmt = MONEY_FMT;

  // Notes block — explains the leg model + why GP % differs from Gross GP / BP.
  sheet.addRow([]);
  const notesHeader = sheet.addRow(['Notes']);
  notesHeader.font = { bold: true };
  sheet.addRow(['• Refunds + Repairs + Return-to-Supplier each eat 2 shipping legs (outbound + inbound). Replacements eat 3 (plus the replacement outbound).']);
  sheet.addRow(['• Repair: the unit comes back to stock, but both carriage legs were still paid — so it carries the same 2-leg loss as a refund.']);
  sheet.addRow(['• Postage Loss = (postage + P.VAT) × legs, snapshotted at Process Return time.']);
  sheet.addRow(['• Net GP = Gross GP − Postage Loss. Net GP % = Net GP ÷ BP (× 100). eBay rows divide by SP per platform convention.']);
  sheet.addRow(['• Per-marketplace sheets carry a TOTAL row at the bottom with the same maths reconciled via SUM formulas.']);
}

/** Schema for the consolidated Returns tab on the Sales Report. The
 *  return-info columns come BEFORE GP so the auditor doesn't have to
 *  hunt past 20 sale columns to find Outcome / Legs / Postage Loss —
 *  the QA complaint that opened round 5 was exactly "the sales report
 *  doesn't have the returns info here", because the per-marketplace
 *  tabs bury those columns at positions 23-30. */
const RETURNS_TAB_HEADERS: Array<string> = [
  'Sale Date', 'Return Date',
  'Marketplace', 'Order Number', 'SKU', 'IMEI', 'Supplier',
  'Outcome', 'Return Reason', 'Shipping Legs', 'Postage Loss £',
  'BP', 'SP', 'SP-BP', 'Postage', 'Comments',
];

/** Sheet 2 of the Sales Report — every voided sale in the date-scoped
 *  pool the marketplace tabs draw from, one row each, with return-info
 *  columns up front. Row count and Postage Loss total reconcile with
 *  the Sales Summary. Active sales are excluded.
 *
 *  Filter alignment: same date scope as the marketplace tabs (saleDate
 *  range), so a sale returned in the period but made earlier still won't
 *  appear here — matches the Summary Refunds/Replacements counters by
 *  construction. That keeps the workbook internally consistent. The
 *  Returns Report workbook (different file) is the surface for
 *  "returns processed in this period regardless of when the sale was
 *  made". */
function writeSalesReturnsSheet(
  wb: ExcelJS.Workbook,
  byMarketplace: Map<Marketplace, Sale[]>,
): void {
  const sheet = wb.addWorksheet('Returns');
  sheet.columns = [
    { width: 12 }, { width: 12 },                              // dates
    { width: 11 }, { width: 18 }, { width: 16 }, { width: 17 }, { width: 18 },
    { width: 13 }, { width: 30 }, { width: 9 }, { width: 13 },
    { width: 8 }, { width: 8 }, { width: 9 }, { width: 9 }, { width: 24 },
  ];
  const header = sheet.addRow(RETURNS_TAB_HEADERS);
  header.font = { bold: true };
  header.fill = {
    type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' },  // slate-100
  };

  // Collect every voided sale across all four marketplaces. Stable order:
  // by voidedAt desc (newest first) — matches the in-app default and the
  // operator's typical "what just got returned?" question.
  const voided: Sale[] = [];
  for (const m of MARKETPLACES) {
    for (const s of byMarketplace.get(m) ?? []) {
      if (s.voidedAt) voided.push(s);
    }
  }
  voided.sort((a, b) => (b.voidedAt || '').localeCompare(a.voidedAt || ''));

  let totalLoss = 0;
  for (const s of voided) {
    const loss = postageLossFor(s);
    totalLoss += loss;
    const row = sheet.addRow([
      toDate(s.saleDate),
      toDate(s.voidedAt),
      s.marketplace,
      s.orderNumber || '',
      s.sku ?? '',
      s.imei ?? '',
      s.supplierName || '',
      outcomeLabel(s),
      s.voidReason ?? '',
      shippingLegsFor(s) || null,        // blank for repair (0 legs)
      loss > 0 ? loss : null,            // blank for repair / £0
      s.buyPrice ?? null,
      s.salePrice ?? null,
      typeof s.buyPrice === 'number' && typeof s.salePrice === 'number'
        ? Number((s.salePrice - s.buyPrice).toFixed(2))
        : null,
      s.postage ?? null,
      s.comments ?? '',
    ]);
    row.getCell(1).numFmt = DATE_FMT;
    row.getCell(2).numFmt = DATE_FMT;
    row.getCell(6).numFmt = IMEI_FMT;
    row.getCell(11).numFmt = MONEY_FMT;
    row.getCell(12).numFmt = MONEY_FMT;
    row.getCell(13).numFmt = MONEY_FMT;
    row.getCell(14).numFmt = MONEY_FMT;
    row.getCell(15).numFmt = MONEY_FMT;
    // Every row is a return — paint the same rose-100 fill the
    // marketplace tabs use on voided rows so the visual stays consistent.
    for (let c = 1; c <= RETURNS_TAB_HEADERS.length; c++) {
      row.getCell(c).fill = RETURNED_FILL;
    }
  }

  // TOTAL row — sums Postage Loss so the auditor reads the period's
  // exposure without scrolling.
  if (voided.length > 0) {
    const totalRow = sheet.addRow([
      'TOTAL', '', '', '', '', '', '', '', '', '',
      Number(totalLoss.toFixed(2)),
      '', '', '', '', '',
    ]);
    totalRow.font = { bold: true };
    totalRow.fill = {
      type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' },  // slate-200
    };
    totalRow.getCell(11).numFmt = MONEY_FMT;
  } else {
    // Empty-state hint so an auditor opening a no-returns period knows
    // the tab is intentionally empty (vs a missing/broken sheet).
    const row = sheet.addRow(['No returns recorded for this period.']);
    row.getCell(1).font = { italic: true, color: { argb: 'FF64748B' } };  // slate-500
  }
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

/** Customer outcome for a returned unit. Priority:
 *   1. returnType === 'repair' (mid-cycle, before ReadyToShipModal flips it)
 *   2. Explicit returnOutcome from the current cycle (refund / replacement)
 *   3. Post-completion repair markers: repairedAt set, or 'repaired_unit'
 *      flag. After ReadyToShipModal flips returnType to 'returned_to_inventory'
 *      this is the only way to tell it WAS a repair — without it the unit
 *      reads as 'refund' and the report double-counts the cycle (QA round 3
 *      BUG-RP-002 reproduction).
 *   4. Default to 'refund' for legacy rows processed before outcome tracking. */
function outcomeFor(u: InventoryUnit): 'refund' | 'replacement' | 'repair' {
  if (u.returnType === 'repair') return 'repair';
  if (u.returnOutcome) return u.returnOutcome;
  if (u.repairedAt) return 'repair';
  if (Array.isArray(u.flags) && u.flags.includes('repaired_unit')) return 'repair';
  return 'refund';
}

/** Title-case the outcome for the auditor-facing Outcome cell. */
function outcomeText(outcome: 'refund' | 'replacement' | 'repair'): string {
  switch (outcome) {
    case 'replacement': return 'Replacement';
    case 'repair':      return 'In Repair';
    default:            return 'Refund';
  }
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
 *  (refund = 2, replacement = 3, repair = 2). Mirrors `postageLossFor` for
 *  sales but reads off the unit-side fields with the voided-sale fallback
 *  baked in.
 *
 *  Prefers the canonical Sale.voidOutcome over the unit-side outcomeFor —
 *  the Sale doc is immutable after voiding, whereas the unit's returnType
 *  is overwritten by ReadyToShipModal at repair completion. Repair carries
 *  2 legs (outbound + the faulty unit shipped back), same as a refund. */
function unitPostageLoss(u: InventoryUnit, linkedVoidedSale: Sale | undefined): number {
  const outcome = linkedVoidedSale?.voidOutcome ?? outcomeFor(u);
  const leg = legCostFor(u, linkedVoidedSale);
  if (leg <= 0) return 0;
  const legs = outcome === 'replacement' ? 3 : 2;  // refund + repair both = 2
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

  // Symmetric unit index — used by the per-event Summary to detect
  // repair-route voids (no customer outcome → not a refund / replacement).
  const unitsByIdRet = new Map<string, InventoryUnit>();
  const unitsByImeiRet = new Map<string, InventoryUnit>();
  for (const u of units) {
    if (u.id) unitsByIdRet.set(u.id, u);
    const k = (u.imei || '').trim().toUpperCase();
    if (k && !unitsByImeiRet.has(k)) unitsByImeiRet.set(k, u);
  }
  // A repair-route void either carries the canonical Sale.voidOutcome
  // ('repair') OR — for pre-canonical legacy data — the linked unit
  // still shows repair markers (returnType==='repair', repairedAt set,
  // or the 'repaired_unit' flag). After ReadyToShipModal flips returnType
  // to 'returned_to_inventory' at completion, the Sale-side signal is the
  // only one that stays accurate, which is why we prefer it.
  const isRepairLinkedSale = (s: Sale): boolean => {
    if (s.voidOutcome === 'repair') return true;
    if (s.voidOutcome) return false;
    const u = (s.unitId && unitsByIdRet.get(s.unitId))
      || (s.imei && unitsByImeiRet.get((s.imei || '').trim().toUpperCase()))
      || undefined;
    if (!u) return false;
    if (u.returnType === 'repair') return true;
    if (u.repairedAt) return true;
    return Array.isArray(u.flags) && u.flags.includes('repaired_unit');
  };

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
   *  "Original Sale Date / Sale Price / Marketplace" columns.
   *
   *  voidedAt is set from a date-only `YYYY-MM-DD` input (see ReturnsPage
   *  ProcessReturnModal), so for a unit cycled sold → returned → re-sold
   *  → re-returned on the same day, every voidedAt string compares equal
   *  and a naive `s.voidedAt > best.voidedAt` picks the first match
   *  (typically the EARLIEST cycle) instead of the one that triggered the
   *  CURRENT return. Compose a sort key with saleDate then the ISO
   *  createdAt / updatedAt timestamps as tiebreakers — recordSale writes
   *  these as full ISO strings (`nowIso`), so they resolve to ms precision. */
  const latestVoidedSale = (u: InventoryUnit): Sale | undefined => {
    const tsString = (v: unknown): string => {
      if (typeof v === 'string') return v;
      if (v && typeof (v as { toDate?: () => Date }).toDate === 'function') {
        try { return (v as { toDate: () => Date }).toDate().toISOString(); } catch { return ''; }
      }
      return '';
    };
    const sortKey = (s: Sale): string =>
      `${s.voidedAt || ''}__${s.saleDate || ''}__${tsString(s.updatedAt)}__${tsString(s.createdAt)}`;
    let best: Sale | undefined;
    let bestKey = '';
    for (const s of salesForUnit(u)) {
      if (!s.voidedAt) continue;
      const key = sortKey(s);
      if (!best || key > bestKey) { best = s; bestKey = key; }
    }
    return best;
  };

  const resolveSupplier = (u: InventoryUnit): string =>
    (u.supplierId && supplierMap?.[u.supplierId])
    || u.supplierName
    || '';

  const wb = new ExcelJS.Workbook();

  // -------- Sheet 1: Summary --------
  // Per-EVENT counts and loss across the period — iterate the voided sales
  // rather than unique units, so a unit cycled sold → returned 10 times
  // contributes 10 refund events at the per-cycle leg cost (matching the
  // Sales Report Summary's Postage Loss figure and the Unit Histories tab).
  // The pre-2026-05 path counted unique units which under-reported by a
  // factor of N for a repeat-cycled IMEI.
  const from = opts?.from ?? '0000-01-01';
  const to   = opts?.to   ?? '9999-12-31';

  // Index voided sales by unit so the per-unit Detail sheet (Sheet 2) and
  // the per-event Summary (Sheet 1) read from the same source.
  const voidedSalesInRange = sales.filter(s =>
    s.voidedAt && s.voidedAt >= from && s.voidedAt <= to,
  );
  // Track which units already got an event from a linked voided Sale so the
  // legacy fallback below doesn't double-count them.
  const seenUnitIds = new Set<string>();
  let refundsCount = 0;
  let replacementsCount = 0;
  let repairsCount = 0;
  let totalLoss = 0;
  const lossByMarketplace = new Map<string, { count: number; loss: number }>();
  const bump = (mp: string, loss: number) => {
    const cur = lossByMarketplace.get(mp) ?? { count: 0, loss: 0 };
    cur.count++;
    cur.loss += loss;
    lossByMarketplace.set(mp, cur);
  };

  // Cutoff disclosure: return carriage is only costed from the point the
  // operator started snapshotting leg cost. Returns before that show £0
  // (no postage data was captured). Track how many returns are uncosted
  // and the earliest date a real cost appears so the Summary can state
  // "lifetime loss is fully costed from {date}; {n} earlier returns are
  // uncosted (pre-tracking)".
  let uncostedCount = 0;
  let earliestCostedDate: string | null = null;
  const noteCosted = (loss: number, date: string | undefined) => {
    if (loss > 0) {
      if (date && (!earliestCostedDate || date < earliestCostedDate)) earliestCostedDate = date;
    } else {
      uncostedCount++;
    }
  };

  for (const s of voidedSalesInRange) {
    if (s.unitId) seenUnitIds.add(s.unitId);
    // All three outcomes carry postage loss now (repair = 2 legs per the
    // operator's policy — outbound + the faulty unit shipped back). Repair
    // keeps its own category so it's not conflated with customer refunds.
    const loss = postageLossFor(s);
    totalLoss += loss;
    if (isRepairLinkedSale(s))                 repairsCount++;
    else if (s.voidOutcome === 'replacement')  replacementsCount++;
    else                                       refundsCount++;
    bump(s.marketplace || '—', loss);
    noteCosted(loss, s.voidedAt);
  }

  // Legacy fallback: pre-void-fix returns wrote returnType/returnDate on the
  // unit only, with no linked voided Sale. Count those units once each at
  // the unit-side leg cost so the period total isn't silently missing them.
  const legacyReturnedUnits = units.filter(u =>
    !!u.returnType && !!u.returnDate
      && u.returnDate >= from && u.returnDate <= to
      && !seenUnitIds.has(u.id),
  );
  for (const u of legacyReturnedUnits) {
    const voided = latestVoidedSale(u);
    if (voided && voided.voidedAt && voided.voidedAt >= from && voided.voidedAt <= to) continue;
    const outcome = outcomeFor(u);
    const loss = unitPostageLoss(u, voided);
    totalLoss += loss;
    if (outcome === 'repair')            repairsCount++;
    else if (outcome === 'replacement')  replacementsCount++;
    else                                 refundsCount++;
    bump(voided?.marketplace || '—', loss);
    noteCosted(loss, u.returnDate);
  }

  const totalReturns = refundsCount + replacementsCount + repairsCount;
  const avgLoss = totalReturns > 0 ? totalLoss / totalReturns : 0;

  // Sheet 2 keeps the per-unit lifetime view (one row per IMEI showing the
  // latest cycle), so the summary period filter still needs the unique-unit
  // set the old code computed. Kept separate from the per-event Summary
  // numbers above so the two sheets answer different audit questions:
  //   Sheet 1 → "how many return events / how much loss this period?"
  //   Sheet 2 → "which units have a return on file this period?"
  const returnedInRange = units.filter(u =>
    !!u.returnType && !!u.returnDate && u.returnDate >= from && u.returnDate <= to,
  );

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
  writeSummaryRow('Repairs', repairsCount);
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

  // -------- Carriage cost policy + pre-tracking cutoff disclosure --------
  // Auditor-facing notes: (1) how each return type is costed, and (2) the
  // hard truth that lifetime loss is only complete from the date carriage
  // tracking began — earlier returns are uncosted (£0) and the lifetime
  // total understates them.
  summary.addRow([]);
  const policyHeader = summary.addRow(['Carriage cost policy', '']);
  policyHeader.getCell(1).font = { bold: true };
  summary.addRow(['Refund / Repair / To-Supplier', '2 legs (outbound + inbound)']);
  summary.addRow(['Replacement', '3 legs (+ replacement outbound)']);
  summary.addRow(['Leg cost', 'postage + P.VAT, snapshotted at return time']);

  summary.addRow([]);
  const cutoffHeader = summary.addRow(['Pre-tracking cutoff', '']);
  cutoffHeader.getCell(1).font = { bold: true };
  if (earliestCostedDate) {
    summary.addRow(['Carriage costed from', earliestCostedDate]);
  } else {
    summary.addRow(['Carriage costed from', 'no costed returns in this period']);
  }
  const uncostedRow = summary.addRow(['Uncosted (pre-tracking) returns', uncostedCount]);
  if (uncostedCount > 0) {
    uncostedRow.getCell(2).font = { bold: true, color: { argb: 'FFB45309' } };  // amber-700
    summary.addRow([
      'Note',
      `${uncostedCount} return${uncostedCount === 1 ? '' : 's'} predate carriage tracking and contribute £0 — lifetime loss understates these.`,
    ]);
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
    // Sale.voidOutcome is the canonical signal (survives ReadyToShipModal
    // mutating the unit at repair completion); fall back to unit-side
    // detection for legacy rows with no linked voided Sale.
    const outcome = voided?.voidOutcome ?? outcomeFor(u);
    // refund + repair = 2 legs, replacement = 3. Repair carries carriage
    // loss now (outbound + faulty unit shipped back) — same as a refund.
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
      outcomeText(outcome),
      u.returnReason || '',
      u.returnComments || '',
      leg > 0 ? leg : null,
      leg > 0 ? legs : null,
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
        // Canonical: Sale.voidOutcome. Fall back to outcomeFor(u) only for
        // legacy voids that pre-date the 'repair' stamp (the workbook-build
        // enrichment above backfills those at read time, so this fallback
        // is just belt-and-braces).
        const out: 'refund' | 'replacement' | 'repair' =
          s.voidOutcome ?? outcomeFor(u);
        const postage = Number(s.postage) || 0;
        const pVat = s.postageVatExempt ? 0 : (Number(s.postageVat) || postage * 0.2);
        const legs = out === 'replacement' ? 3 : 2;  // refund + repair both = 2
        const loss = legs > 0 ? (postage + pVat) * legs : 0;
        const reason = s.voidReason || u.returnReason || '';
        const detailParts = [outcomeText(out), reason].filter(Boolean);
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
      const legs = out === 'replacement' ? 3 : 2;  // refund + repair both = 2
      const loss = legs > 0 && leg > 0 ? leg * legs : 0;
      const reason = u.returnReason || '';
      const detailParts = [outcomeText(out), reason].filter(Boolean);
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
