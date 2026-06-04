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
import { parseSaleDate } from './userLocale';

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
  /** Sales rows — used to build the per-unit "UNIT HISTORY" sheet (every
   *  resale + return cycle of an IMEI, with dates, reasons and postage loss).
   *  Optional so existing callers keep working; omit → sheet shows header only. */
  sales?: Sale[];
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

/** Parse an ISO date string into a Date suitable for ExcelJS. Returns null on
 *  missing/invalid.
 *
 *  Builds the date at UTC NOON from the yyyy-mm-dd parts rather than
 *  `new Date(iso)` (which parses a date-only string as UTC midnight, and is then
 *  serialised by ExcelJS so that a viewer behind UTC — or any value carrying a
 *  local-midnight time — renders the PREVIOUS day). Noon is far from both
 *  midnight boundaries, so the calendar day survives in every timezone:
 *  1-Apr in → 1-Apr out, with no day drift. */
function toDate(iso: string | undefined | null): Date | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12, 0, 0));
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

/**
 * Derive a per-model INVENTORY summary from raw units when the caller has no
 * pre-computed `aggregates`. This is the common case: units imported/added
 * IMEI-by-IMEI never create `inventoryAggregates` docs, so without this
 * fallback the INVENTORY sheet would export with only its header row (the bug
 * found in E2E: "No aggregates" → empty summary tab while the IMEI NUMBERS
 * sheet was fully populated).
 *
 * Grouping rule: one row per distinct `model`, counting only office stock
 * (`status === 'available'` and not soft-deleted) so the totals match the
 * "All Office Stock" tile. Buy price is the most-recently-stocked unit's BP
 * ("latest BP"); colours and suppliers are aggregated across the group.
 */
export function deriveInventoryAggregates(units: InventoryUnit[]): InventoryAggregate[] {
  const groups = new Map<string, InventoryUnit[]>();
  for (const u of units) {
    if (u.status !== 'available') continue;
    if ((u as { deletedAt?: unknown }).deletedAt) continue;   // skip tombstones
    const key = (u.model ?? '').trim();
    const bucket = groups.get(key);
    if (bucket) bucket.push(u); else groups.set(key, [u]);
  }

  const aggregates: InventoryAggregate[] = [];
  for (const [model, groupUnits] of groups) {
    // Latest BP = buyPrice of the unit with the most recent dateIn.
    const latest = groupUnits
      .slice()
      .sort((a, b) => (b.dateIn || '').localeCompare(a.dateIn || ''))[0];

    // Colour counts, preserving first-seen order.
    const coloursMap: { [colour: string]: number } = {};
    for (const u of groupUnits) {
      const c = (u.colour ?? '').trim() || '—';
      coloursMap[c] = (coloursMap[c] ?? 0) + 1;
    }

    // Unique supplier ids and unique notes (both order-preserving).
    const supplierIds: string[] = [];
    const seenSup = new Set<string>();
    const notesParts: string[] = [];
    const seenNote = new Set<string>();
    for (const u of groupUnits) {
      const sid = u.supplierId;
      if (sid && !seenSup.has(sid)) { seenSup.add(sid); supplierIds.push(sid); }
      const note = (u.notes ?? '').trim();
      if (note && !seenNote.has(note)) { seenNote.add(note); notesParts.push(note); }
    }

    aggregates.push({
      id: `agg-derived-${model || 'unknown'}`,
      model,
      storage: latest?.storage,
      buyPrice: latest?.buyPrice,
      quantityNum: groupUnits.length,
      coloursMap,
      coloursRaw: buildColourString(coloursMap),
      supplierIds,
      notes: notesParts.length ? notesParts.join('; ') : undefined,
      ownerId: 'shared',
      createdAt: null,
      updatedAt: null,
    });
  }

  // Stable, human-friendly order: model A→Z.
  aggregates.sort((a, b) => a.model.localeCompare(b.model));
  return aggregates;
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

// ---------------------------------------------------------------------------
// UNIT HISTORY — per-IMEI life story across every resale + return cycle.
// ---------------------------------------------------------------------------

export const UNIT_HISTORY_HEADERS = [
  'IMEI', 'MODEL', 'EVENT', 'DATE', 'SALE PRICE', 'POSTAGE', 'ORDER #',
  'MARKETPLACE', 'REASON / COMMENT', 'BUY PRICE', 'TIMES SOLD',
  'TIMES RETURNED', 'POSTAGE LOST', 'STATUS',
] as const;

export interface UnitHistoryRow {
  IMEI: string;
  MODEL: string;
  EVENT: 'STOCK IN' | 'SOLD' | 'RETURNED' | 'SUMMARY';
  DATE: string;                 // ISO yyyy-mm-dd (or '')
  'SALE PRICE': number | '';
  POSTAGE: number | '';
  'ORDER #': string;
  MARKETPLACE: string;
  'REASON / COMMENT': string;
  'BUY PRICE': number | '';
  'TIMES SOLD': number;
  'TIMES RETURNED': number;
  'POSTAGE LOST': number;
  STATUS: string;
}

const normImei = (s: string | null | undefined) => (s ?? '').trim().toUpperCase();
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Build the per-unit resale/return history. One IMEI can be sold and returned
 * many times; each resale is a Sale row and each return voids that row with
 * `voidedAt` (return date) + `voidReason` (comment). We reconstruct the full
 * chronological story per IMEI so the operator can SEE every cycle and total
 * the loss (postage on returned sales is the recurring sunk cost).
 *
 * Only IMEIs that have at least one sale appear (units never sold have no
 * cycle history). Units are ordered most-returned-first so the biggest
 * loss-makers surface at the top. Returns a flat, denormalised row list
 * (unit-level totals repeat on every row) suitable for an Excel sheet or CSV.
 */
export function buildUnitHistoryRows(units: InventoryUnit[], sales: Sale[]): UnitHistoryRow[] {
  const unitByImei = new Map<string, InventoryUnit>();
  for (const u of units) {
    const k = normImei(u.imei);
    if (k && !unitByImei.has(k)) unitByImei.set(k, u);
  }

  const salesByImei = new Map<string, Sale[]>();
  for (const s of sales) {
    const k = normImei(s.imei);
    if (!k) continue;
    (salesByImei.get(k) ?? salesByImei.set(k, []).get(k)!).push(s);
  }

  const summaries = [...salesByImei.entries()].map(([imei, imeiSales]) => {
    const unit = unitByImei.get(imei);
    const sorted = imeiSales.slice().sort((a, b) =>
      (a.saleDate || '').localeCompare(b.saleDate || '') || (a.voidedAt || '').localeCompare(b.voidedAt || ''));
    const timesSold = sorted.length;
    const returnedSales = sorted.filter(s => s.voidedAt);
    const timesReturned = returnedSales.length;
    const postageLost = round2(returnedSales.reduce((t, s) => t + (s.postage || 0), 0));
    const status = unit?.status
      ?? (sorted.some(s => !s.voidedAt) ? 'sold' : 'returned');
    const model = unit?.model || sorted[0]?.sku || '—';
    return { imei, unit, sorted, timesSold, timesReturned, postageLost, status, model };
  });

  // Most-returned (biggest loss) first; tie-break by IMEI for stable output.
  summaries.sort((a, b) => b.timesReturned - a.timesReturned || a.imei.localeCompare(b.imei));

  const rows: UnitHistoryRow[] = [];
  for (const s of summaries) {
    const base = {
      IMEI: s.imei, MODEL: s.model,
      'BUY PRICE': s.unit?.buyPrice ?? '' as number | '',
      'TIMES SOLD': s.timesSold, 'TIMES RETURNED': s.timesReturned,
      'POSTAGE LOST': s.postageLost, STATUS: s.status,
    };
    const blank = { 'SALE PRICE': '' as const, POSTAGE: '' as const, 'ORDER #': '', MARKETPLACE: '', 'REASON / COMMENT': '' };

    // 1) Stock-in
    rows.push({ ...base, ...blank, EVENT: 'STOCK IN', DATE: s.unit?.dateIn ?? '',
      'REASON / COMMENT': s.unit?.supplierName ? `Supplier: ${s.unit.supplierName}` : '' });

    // 2) Each sell → (optional) return cycle, in order
    for (const sale of s.sorted) {
      rows.push({ ...base, ...blank, EVENT: 'SOLD', DATE: sale.saleDate || '',
        'SALE PRICE': sale.salePrice ?? '', POSTAGE: sale.postage ?? '',
        'ORDER #': sale.orderNumber || '', MARKETPLACE: sale.marketplace || '' });
      if (sale.voidedAt) {
        rows.push({ ...base, ...blank, EVENT: 'RETURNED', DATE: sale.voidedAt,
          POSTAGE: sale.postage ?? '',                       // postage lost this cycle
          'ORDER #': sale.orderNumber || '', MARKETPLACE: sale.marketplace || '',
          'REASON / COMMENT': sale.voidReason || '(no reason recorded)' });
      }
    }

    // 3) Per-unit summary line
    rows.push({ ...base, ...blank, EVENT: 'SUMMARY', DATE: '',
      'POSTAGE LOST': s.postageLost,
      'REASON / COMMENT': `Sold ${s.timesSold}× · Returned ${s.timesReturned}× · Postage lost £${s.postageLost.toFixed(2)} · now ${s.status}` });
  }
  return rows;
}

export async function buildInventoryWorkbookBuffer(input: BuildInventoryWorkbookInput): Promise<ArrayBuffer> {
  const { units, aggregates, suppliers, whatsappFeed, sales } = input;
  const wb = new ExcelJS.Workbook();

  // ---------------- Sheet 1: INVENTORY ----------------
  const invSheet = wb.addWorksheet('INVENTORY');
  invSheet.columns = INVENTORY_COLUMN_WIDTHS.map(w => ({ width: w }));
  // Use addRow so we keep literal nulls (header row D is intentionally empty).
  invSheet.addRow(INVENTORY_HEADERS);

  // Fall back to a per-model summary derived from units when no aggregate
  // docs exist — otherwise this sheet exports header-only (E2E finding #1).
  const effectiveAggregates = aggregates.length > 0
    ? aggregates
    : deriveInventoryAggregates(units);

  for (let i = 0; i < effectiveAggregates.length; i++) {
    const agg = effectiveAggregates[i];
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

    // IMEI written as an exact string so a 15-digit value is preserved
    // verbatim (no float rounding / scientific notation) and Apple serials
    // survive untouched. numFmt '0' below only affects numeric cells.
    const imeiExact = unit.imei != null ? String(unit.imei) : '';

    const row = imeiSheet.addRow([
      stockInDate,
      unit.model ?? '',
      imeiExact,
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

  // ---------------- Sheet 4: UNIT HISTORY ----------------
  // Per-IMEI life story: stock-in → each sale → each return (with reason) →
  // a summary line (times sold/returned + postage lost). Lets the operator
  // total the loss when a single unit is resold/returned multiple times.
  const histSheet = wb.addWorksheet('UNIT HISTORY');
  histSheet.columns = [18, 26, 11, 12, 10, 9, 16, 14, 42, 9, 11, 14, 12, 12]
    .map(w => ({ width: w }));
  histSheet.addRow([...UNIT_HISTORY_HEADERS]);
  for (const r of buildUnitHistoryRows(units, sales ?? [])) {
    const row = histSheet.addRow(UNIT_HISTORY_HEADERS.map(h => {
      const v = (r as Record<string, unknown>)[h];
      if (h === 'DATE') return toDate(v as string) ?? '';
      return v === '' ? null : v;
    }));
    row.getCell(4).numFmt = 'mm/dd/yyyy';   // DATE
    row.getCell(5).numFmt = '0.00';          // SALE PRICE
    row.getCell(6).numFmt = '0.00';          // POSTAGE
    row.getCell(10).numFmt = '0.00';         // BUY PRICE
    row.getCell(13).numFmt = '0.00';         // POSTAGE LOST
    if (r.EVENT === 'SUMMARY') row.font = { bold: true };
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
    'Comments', 'RETURNED', 'RETURN REASON',
  ],
  BM: [
    // Live BM sheet (20 cols): Payment Mode sits between Quantity (F) and
    // BP (H). This shifts every monetary column letter by +1 vs the legacy
    // 19-col schema — Excel formulas in excelFormulaFor('BM') reflect the
    // new positions.
    'Date', 'Order No', 'SKU', 'IMEI', 'Supplier', 'Quantity',
    'Payment Mode', 'BP', 'SP',
    'SP-BP', 'Marginal Tax', 'Commission',
    'Customer Care Fees', 'Postage', 'P. VAT', 'Acc',
    'GP', 'GP %', 'Total VAT NTP', 'Comments', 'RETURNED', 'RETURN REASON',
  ],
  EBAY: [
    // Live EBAY sheet — 24 cols, no Comments. Headers reproduced verbatim
    // including the operator's literal text: 'IMEI NUMBER' (not 'IMEI'),
    // 'UNITS' (not 'Quantity'), 'Total VAT ' (trailing space), 'GP%' (no
    // space). Excel formulas in excelFormulaFor('EBAY') reference the
    // same column letters regardless.
    'DATE', 'ORDER NUMBER', 'SKU', 'IMEI NUMBER', 'SUPPLIER', 'UNITS',
    'BP', 'SP', 'SP-BP', 'Marginal Tax', 'Commission', 'ROF', 'FVF', 'VAT',
    'T.COM', 'Postage', 'P. VAT', 'Marketing', 'M. VAT', 'Acc',
    'Total VAT ', 'GP', 'GP%', 'Total VAT NTP', 'RETURNED', 'RETURN REASON',
  ],
  ONBUY: [
    // Live ONBUY sheet — 18 cols, no Comments, no Quantity (no UNITS).
    'DATE', 'Order Number', 'SKU', 'IMEI', 'Supplier',
    'BP', 'SP', 'SP-BP', 'Marginal Tax', 'Commission', 'VAT 20%',
    'Postage', 'P. VAT', 'Acc',
    'Total VAT ', 'GP', 'GP%', 'Total VAT NTP', 'RETURNED', 'RETURN REASON',
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
  // Return status + reason, appended as the last two columns on every sheet so
  // a returned sale shows WHY it came back (voidReason set at return time), not
  // just a red highlight. Falls back to the import comment when no reason given.
  const returnedCells: SalesHeaderRow = [
    sale.voidedAt ? 'Yes' : 'No',
    (sale as any).voidReason ?? sale.comments ?? '',
  ];

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
        ...returnedCells,
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
      // Live BM sheet — 20 cols. Payment Mode sits between Quantity (F) and
      // BP (H), so every monetary column slides +1 vs the prior layout.
      //   A=Date,B=OrderNo,C=SKU,D=IMEI,E=Supplier,F=Quantity,
      //   G=PaymentMode,H=BP,I=SP,J=SP-BP,K=MarTax,L=Com,
      //   M=CustomerCareFees,N=Postage,O=P.VAT,P=Acc,
      //   Q=GP,R=GP%,S=TotVAT NTP,T=Comments
      const row = sheet.addRow([
        date, sale.orderNumber, sale.sku ?? '', sale.imei ?? '',
        sale.supplierName ?? '', qty,
        sale.paymentMode ?? '',                        // Payment Mode (literal)
        sale.buyPrice, sale.salePrice,
        null, null, null,                              // SP-BP, MarTax, Com
        sale.customerCareFees ?? Number(f.customerCareFees ?? 9.99),  // Customer Care Fees (literal)
        sale.postage ?? null,                          // Postage (literal)
        null,                                          // P. VAT (formula)
        sale.accessoryFee ?? Number(f.accessoryFee ?? 1),  // Acc (literal)
        null, null, null,                              // GP, GP%, Total VAT NTP
        sale.comments ?? '',
        ...returnedCells,
      ]);
      row.getCell(1).numFmt = DATE_FMT;
      row.getCell(4).numFmt = IMEI_FMT;
      row.getCell(8).numFmt = MONEY_FMT;       // BP
      row.getCell(9).numFmt = MONEY_FMT;       // SP
      row.getCell(10).value = { formula: f.spMinusBp! };    row.getCell(10).numFmt = MONEY_FMT;
      row.getCell(11).value = { formula: f.marginalTax! };  row.getCell(11).numFmt = MONEY_FMT;
      row.getCell(12).value = { formula: f.commission! };   row.getCell(12).numFmt = MONEY_FMT;
      row.getCell(13).numFmt = MONEY_FMT;                   // Customer Care Fees (literal above)
      row.getCell(14).numFmt = MONEY_FMT;                   // Postage (literal above)
      if (sale.postageVatExempt) {
        row.getCell(15).value = 0;
      } else {
        row.getCell(15).value = { formula: f.postageVat! };
      }
      row.getCell(15).numFmt = MONEY_FMT;
      row.getCell(16).numFmt = MONEY_FMT;                   // Acc (literal above)
      row.getCell(17).value = { formula: f.grossProfit! };  row.getCell(17).numFmt = MONEY_FMT;
      row.getCell(18).value = { formula: f.gpPercent! };    row.getCell(18).numFmt = MONEY_FMT;
      row.getCell(19).value = { formula: f.totalVatNtp! };  row.getCell(19).numFmt = MONEY_FMT;
      return;
    }

    case 'EBAY': {
      // Live EBAY sheet — 24 cols, NO Comments column. Same column letter
      // layout as before except the trailing Comments cell is dropped.
      //   A=Date,B=OrderNo,C=SKU,D=IMEI,E=Supplier,F=Units,
      //   G=BP,H=SP,I=SP-BP,J=MarTax,K=Com,L=ROF,M=FVF,N=VAT,O=T.COM,
      //   P=Postage,Q=P.VAT,R=Marketing,S=M.VAT,T=Acc,U=TotVAT,V=GP,
      //   W=GP%,X=TotVAT NTP
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
        sale.accessoryFee ?? Number(f.accessoryFee ?? 1),  // Acc
        null, null, null, null,                      // Total VAT, GP, GP%, Total VAT NTP
        ...returnedCells,
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
      // Live ONBUY sheet — 18 cols. No Quantity, no Comments.
      //   A=Date,B=OrderNo,C=SKU,D=IMEI,E=Supplier,
      //   F=BP,G=SP,H=SP-BP,I=MarTax,J=Com,K=VAT20%,
      //   L=Postage,M=P.VAT,N=Acc,O=TotVAT,P=GP,Q=GP%,R=TotVAT NTP
      const row = sheet.addRow([
        date, sale.orderNumber, sale.sku ?? '', sale.imei ?? '',
        sale.supplierName ?? '',
        sale.buyPrice, sale.salePrice,
        null, null, null, null,                       // SP-BP, MarTax, Com, VAT20%
        sale.postage ?? null,                         // Postage (literal)
        null,                                         // P. VAT (formula)
        sale.accessoryFee ?? Number(f.accessoryFee ?? 1),  // Acc (literal)
        null, null, null, null,                       // Total VAT, GP, GP%, Total VAT NTP
        ...returnedCells,
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

    // Sort each sheet newest-first by saleDate so the operator opens the
    // workbook to today's sales at the top — same chronological compare
    // (via parseSaleDate) the on-screen Sales grid uses, so the export
    // order matches the UI exactly. Tombstoned / voided rows stay in
    // place chronologically rather than clustering — they keep their red
    // fill so the operator can still spot them at a glance.
    const bucket = (byMarketplace.get(m) ?? [])
      .slice()
      .sort((a, b) => parseSaleDate(b.saleDate) - parseSaleDate(a.saleDate));
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
      sales: input.sales,   // powers the per-unit UNIT HISTORY sheet
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
