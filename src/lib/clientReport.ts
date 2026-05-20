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

/** Map the unit's ReturnCategory to a human-readable status label. The unit's
 *  `returnType` is the source of truth — when it's set, the unit has been
 *  through the Returns flow even if the sale doc lookup failed to stamp
 *  `voidedAt` (legacy data / orphan void / no matching sale). Falls back to a
 *  generic "Returned" when only `voidedAt` is present (deleted unit). */
function statusForSale(sale: Sale, unit?: InventoryUnit): string {
  switch (unit?.returnType) {
    case 'returned_to_inventory': return 'Returned to Inventory';
    case 'repair':                return 'Return to Repair';
    case 'returned_to_supplier':  return 'Returned to Supplier';
  }
  if (sale.voidedAt) return 'Returned';
  return 'Sold';
}

/** True when this sale row should be painted red across every Sales-Report
 *  sheet. Either the sale doc was voided OR the linked unit carries a
 *  returnType — we don't trust one half of the join alone. */
function isReturnedRow(sale: Sale, unit?: InventoryUnit): boolean {
  return !!sale.voidedAt || !!unit?.returnType;
}

/** Build the trailing comments string for a row. When the row is a return,
 *  prepend the status + reason so the operator sees WHY the unit came back
 *  without having to cross-reference another tab. */
function buildCommentsCell(sale: Sale, unit?: InventoryUnit): string {
  const baseComment = sale.comments || unit?.notes || '';
  if (!isReturnedRow(sale, unit)) return baseComment;
  const status = statusForSale(sale, unit);
  const reason = sale.voidReason || unit?.returnReason || '';
  const date   = sale.voidedAt || unit?.returnDate || '';
  const parts  = [`[${status.toUpperCase()}${date ? ` ${date}` : ''}]`];
  if (reason) parts.push(reason);
  if (baseComment) parts.push(`| ${baseComment}`);
  return parts.join(' ');
}

/** Per-return-type cell fills used across every sheet of the Sales Report.
 *  Distinct colours so the operator can scan the workbook and read the
 *  outcome of each return at a glance — same convention as the in-app
 *  Returns / Sell / Daily-Update grids:
 *    - Back to Inventory → green (win)
 *    - In Repair         → blue  (in progress)
 *    - To Supplier       → red   (loss)
 *    - Generic Returned  → red   (orphan void fallback) */
type FillPattern = import('exceljs').FillPattern;
const makeFill = (argb: string): FillPattern => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const RETURN_FILL_BY_TYPE: Record<'inventory' | 'repair' | 'supplier' | 'generic', FillPattern> = {
  inventory: makeFill('FFD1FAE5'),   // tailwind emerald-100
  repair:    makeFill('FFDBEAFE'),   // tailwind blue-100
  supplier:  makeFill('FFFEE2E2'),   // tailwind rose-100
  generic:   makeFill('FFFEE2E2'),   // tailwind rose-100
};
function fillForReturn(sale: Sale, unit?: InventoryUnit): FillPattern | undefined {
  switch (unit?.returnType) {
    case 'returned_to_inventory': return RETURN_FILL_BY_TYPE.inventory;
    case 'repair':                return RETURN_FILL_BY_TYPE.repair;
    case 'returned_to_supplier':  return RETURN_FILL_BY_TYPE.supplier;
  }
  if (sale.voidedAt) return RETURN_FILL_BY_TYPE.generic;
  return undefined;
}

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
};

const DATE_FMT = '[$-409]d\\-mmm\\-yyyy';
const MONEY_FMT = '0.00';
const IMEI_FMT = '0';

/**
 * Write one sale row into the given sheet with the correct base values,
 * formulas (sourced from `excelFormulaFor`) and per-cell number formats.
 *
 * When `unit` is provided we enrich the trailing Comments cell with the
 * return status + reason so the per-platform sheets carry the same
 * "why was this voided" detail the ALL sheet shows in its Status column.
 */
function writeSaleRow(
  sheet: ExcelJS.Worksheet,
  marketplace: Marketplace,
  sale: Sale,
  rowNumber: number,
  unit?: InventoryUnit,
): void {
  const f = excelFormulaFor(marketplace, rowNumber);
  const date = toDate(sale.saleDate);
  const qty = sale.quantity ?? 1;
  const comments = buildCommentsCell(sale, unit);

  switch (marketplace) {
    case 'AMAZON': {
      const row = sheet.addRow([
        date, sale.orderNumber, sale.sku ?? '', sale.imei ?? '',
        sale.supplierName ?? '', qty,
        sale.buyPrice, sale.salePrice,
        null, null, null, null, null, null, comments,
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
        null, null, null, null, null, null, null, comments,
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
        null, null, null, null, null, null, null, comments,
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
  const allUnits = units ?? [];
  const unitsById = new Map<string, InventoryUnit>();
  for (const u of allUnits) unitsById.set(u.id, u);
  const lookupUnit = (sale: Sale): InventoryUnit | undefined =>
    sale.unitId ? unitsById.get(sale.unitId) : undefined;

  // Synthesize Sale-shaped rows for returned units that have NO linked sale
  // doc (legacy data / hard-deleted sale / import never matched). Without
  // this they'd vanish from the report entirely and the operator's
  // "we returned 7 today" would never reconcile against what's on screen.
  const returnedUnitsWithoutSale = synthesizeReturnSales(allUnits, sales);
  const allSales = [...sales, ...returnedUnitsWithoutSale];
  const filtered = filterSalesByDate(allSales, opts);

  // ALL sheet excludes back-to-inventory rows — the unit is restored to
  // sellable stock, so it doesn't belong in a "what we sold" view. Repair
  // and supplier returns stay on ALL because they represent units that are
  // no longer on the shelf (lost revenue). Every returned row also lives
  // on the dedicated Returns sheet below with the full detail.
  const filteredForAll = filtered.filter(s => {
    const u = lookupUnit(s);
    return u?.returnType !== 'returned_to_inventory';
  });

  const byMarketplace = new Map<Marketplace, Sale[]>();
  for (const m of MARKETPLACES) byMarketplace.set(m, []);
  for (const sale of filtered) {
    const bucket = byMarketplace.get(sale.marketplace);
    if (bucket) bucket.push(sale);
  }

  const wb = new ExcelJS.Workbook();

  // Sheet 1: ALL — every active sale + lost-revenue returns (supplier /
  // repair / generic void). Filterable in Excel by Marketplace column.
  writeAllSheet(wb.addWorksheet('ALL'), filteredForAll, allUnits, supplierMap ?? {});

  // Sheet 2: Returns — every reversal (back-to-inventory / repair /
  // supplier / generic) with the full return-side detail next to the
  // original sale data. Coloured per return type so the outcome of each
  // reversal is legible at a glance.
  writeReturnsSheet(wb.addWorksheet('Returns'), allSales, allUnits, supplierMap ?? {}, opts);

  // Sheets 3-6: per-platform, mirroring the operator's master SALES_REPORT
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
      const unit = lookupUnit(sale);
      writeSaleRow(sheet, m, sale, rowNumber, unit);
      // Fill triggers on EITHER signal — sale doc voided OR linked unit
      // carries a returnType. Belt-and-braces because the two halves of the
      // join can drift (legacy returns, race conditions, hard-deleted sale).
      // Colour varies by return type (green / blue / red) so the operator
      // can scan the tab and read the outcome of each reversal at a glance.
      const fill = fillForReturn(sale, unit);
      if (fill) {
        const row = sheet.getRow(rowNumber);
        for (let col = 1; col <= headerLen; col++) {
          row.getCell(col).fill = fill;
        }
      }
    }
  }

  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

// ---------------------------------------------------------------------------
// Returns sheet — every reversal with full detail
// ---------------------------------------------------------------------------

const RETURNS_HEADERS = [
  'Return Date', 'Return Type', 'Return Reason',
  'Sold Date', 'Marketplace', 'Order Number', 'IMEI', 'SKU',
  'Model', 'Storage', 'Colour', 'Grade', 'Supplier',
  'BP', 'SP', 'GP', 'Notes',
];

/** Friendly label for the Returns sheet's Return Type column. Matches the
 *  in-app convention so the workbook reads the same as every other surface. */
function returnTypeLabel(unit?: InventoryUnit, sale?: Sale): string {
  switch (unit?.returnType) {
    case 'returned_to_inventory': return 'Returned to Inventory';
    case 'repair':                return 'Return to Repair';
    case 'returned_to_supplier':  return 'Returned to Supplier';
  }
  return sale?.voidedAt ? 'Returned' : '';
}

/** Write the Returns sheet — one row per reversal, sourced from any sale
 *  that's voided OR any unit that carries a returnType. Rows are coloured
 *  per return type and sorted newest-first by the return event date. */
function writeReturnsSheet(
  sheet: ExcelJS.Worksheet,
  sales: Sale[],
  units: InventoryUnit[],
  supplierMap: Record<string, string>,
  opts?: ClientReportOptions,
): void {
  sheet.addRow(RETURNS_HEADERS);

  const unitsById = new Map<string, InventoryUnit>();
  for (const u of units) unitsById.set(u.id, u);

  // Source: every sale that's been returned (voided OR linked to a unit
  // with returnType). One row per unique unit so a returned-resold-returned
  // cycle doesn't double up — same dedupe rule the Returns page uses.
  const seenUnitIds = new Set<string>();
  const rows: Array<{ sale: Sale; unit?: InventoryUnit; eventDate: string }> = [];
  for (const s of sales) {
    const u = s.unitId ? unitsById.get(s.unitId) : undefined;
    if (!isReturnedRow(s, u)) continue;
    if (s.unitId && seenUnitIds.has(s.unitId)) continue;
    if (s.unitId) seenUnitIds.add(s.unitId);
    const eventDate = (s.voidedAt || u?.returnDate || s.saleDate || '').split('T')[0];
    rows.push({ sale: s, unit: u, eventDate });
  }

  // Apply the date window to the return event itself (not the original
  // sale date) so "this month's returns" reflects when reversals happened.
  const from = opts?.from;
  const to   = opts?.to;
  const inWindow = (d: string) => (!from || d >= from) && (!to || d <= to);
  const filteredRows = (from || to) ? rows.filter(r => inWindow(r.eventDate)) : rows;

  // Newest first.
  filteredRows.sort((a, b) => b.eventDate.localeCompare(a.eventDate));

  for (const { sale: s, unit: u } of filteredRows) {
    const r = recomputeSale(s);
    const returnDateIso = s.voidedAt || u?.returnDate || '';
    const returnReason  = s.voidReason || u?.returnReason || '';

    const row = sheet.addRow([
      toDate(returnDateIso),
      returnTypeLabel(u, s),
      returnReason,
      toDate(s.saleDate),
      s.marketplace,
      s.orderNumber || '',
      s.imei || u?.imei || '',
      s.sku || '',
      u?.model || '',
      u?.storage || '',
      u?.colour || '',
      u?.grade || '',
      supplierMap[s.supplierId || ''] || s.supplierName || u?.supplierName || '',
      s.buyPrice,
      s.salePrice,
      r.grossProfit,
      u?.notes || '',
    ]);

    // Number formats — return date (1), sold date (4), IMEI (7), money cols.
    row.getCell(1).numFmt = DATE_FMT;
    row.getCell(4).numFmt = DATE_FMT;
    row.getCell(7).numFmt = IMEI_FMT;
    for (const col of [14, 15, 16]) row.getCell(col).numFmt = MONEY_FMT;

    // Colour the whole row by return outcome (green / blue / red).
    const fill = fillForReturn(s, u);
    if (fill) {
      for (let col = 1; col <= RETURNS_HEADERS.length; col++) {
        row.getCell(col).fill = fill;
      }
    }
  }

  // Bold the header row + reasonable column widths so the sheet opens
  // legibly in Excel / Google Sheets without manual resizing.
  sheet.getRow(1).font = { bold: true };
  const widths = [12, 22, 32, 12, 12, 18, 18, 16, 28, 10, 14, 8, 18, 8, 8, 10, 36];
  widths.forEach((w, i) => { sheet.getColumn(i + 1).width = w; });
}

/** Build Sale-shaped rows for any unit that has a returnType set but no
 *  linked sale in the `sales` collection. Keeps returned units visible on
 *  the report so the operator's return counter matches what's on screen. */
function synthesizeReturnSales(units: InventoryUnit[], sales: Sale[]): Sale[] {
  const salesByUnitId = new Set<string>();
  for (const s of sales) if (s.unitId) salesByUnitId.add(s.unitId);

  const out: Sale[] = [];
  for (const u of units) {
    if (!u.returnType) continue;
    if (salesByUnitId.has(u.id)) continue;
    // Only synthesize if we have at least a sale-side payload — otherwise
    // there's nothing meaningful to display in a "sales" report row.
    const hasSaleData = u.salePrice != null || u.saleDate || u.saleOrderId;
    if (!hasSaleData) continue;
    out.push({
      id: `synth_${u.id}`,
      marketplace: (typeof u.marketplace === 'string' && (MARKETPLACES as readonly string[]).includes(u.marketplace as Marketplace)
        ? (u.marketplace as Marketplace)
        : 'EBAY') as Marketplace,
      orderNumber: u.saleOrderId || '',
      sku: u.sku,
      imei: u.imei,
      unitId: u.id,
      supplierId: u.supplierId,
      supplierName: u.supplierName,
      saleDate: u.saleDate || u.returnDate || '',
      quantity: 1,
      buyPrice: u.buyPrice ?? 0,
      salePrice: u.salePrice ?? 0,
      spMinusBp: 0, marginalTax: 0, commission: 0,
      postage: u.postageCost ?? 0,
      grossProfit: 0, gpPercent: 0,
      comments: u.notes,
      voidedAt: u.returnDate,
      voidReason: u.returnReason,
      importBatchId: 'synth-return',
      sourceFile: 'synth-from-unit',
      sourceRow: 0,
      importedAt: u.updatedAt ?? u.createdAt,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
      ownerId: u.ownerId,
    });
  }
  return out;
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
      // Buy block (cols 1-9). Notes carries the return reason inline when
      // applicable so the operator sees "WHY was this voided" without
      // scrolling to the per-platform tab.
      u?.dateIn ? toDate(u.dateIn) : null,
      u?.model || '',
      s.imei || u?.imei || '',
      u?.grade || '',
      u?.storage || '',
      u?.colour || '',
      supplierMap[s.supplierId || ''] || s.supplierName || u?.supplierName || '',
      s.buyPrice,
      buildCommentsCell(s, u),
      // Status (col 10) — Sold / Returned to Inventory / Return to Repair /
      // Returned to Supplier / Returned (orphan void fallback)
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
    // to unused columns on the right edge. Colour varies per return type
    // (green / blue / red) so the outcome is legible without reading the
    // Status column.
    const fill = fillForReturn(s, u);
    if (fill) {
      for (let col = 1; col <= ALL_HEADERS.length; col++) {
        row.getCell(col).fill = fill;
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
