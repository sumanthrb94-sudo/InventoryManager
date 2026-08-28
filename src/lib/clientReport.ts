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
  AccessoryStock,
} from '../types';
import { MARKETPLACES } from '../types';
import { excelFormulaFor, isAccessorySale, SALES_HEADERS, salesCol, salesColLetter } from './platforms';
import { returnCostFor, saleKeptItsRevenue, feeLossOnRefund } from './returnLoss';
import { recomputeSale } from './recomputeSale';
import { normalizeOperatorSku } from './modelStorage';

/** Best-effort clean model name for a sale row, for the exported "Model"
 *  column. `sale.model` is the audit-completed clean name and wins when
 *  present; otherwise fall back to normalising the preserved raw SKU
 *  (same parser the import path uses) so older/legacy sales without a
 *  completed model still show something readable rather than a blank
 *  cell or a raw operator code. */
function resolvedSaleModel(sale: Sale): string {
  return sale.model || normalizeOperatorSku(sale.sku ?? '') || sale.sku || '';
}

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

/** Amber fill for sales rows whose IMEI has no matching inventory unit.
 *  Distinct from the rose return fill so an auditor can tell a genuine
 *  reversal apart from a "sold a phone that was never in stock" row. */
const NO_INVENTORY_FILL: import('exceljs').FillPattern = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFFEF3C7' },   // tailwind amber-100
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
  /** Accessory SKU pools — see BuildReturnsWorkbookInput.accessoryStock;
   *  threaded through to the embedded Returns Detail sheet below. */
  accessoryStock?: AccessoryStock[];
}

export interface DownloadClientWorkbooksInput {
  units: InventoryUnit[];
  aggregates: InventoryAggregate[];
  suppliers: Supplier[];
  whatsappFeed: SupplierWhatsappUpdate[];
  sales: Sale[];
  opts?: ClientReportOptions;
  accessoryStock?: AccessoryStock[];
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

// ---------------------------------------------------------------------------
// INVENTORY workbook
// ---------------------------------------------------------------------------

const INVENTORY_HEADERS: Array<string | null> = [
  'MODEL ', 'BP', 'QUANTITY ', null, 'VALUE', 'COLOURS', 'SUPPLIER', 'NOTES',
];
const INVENTORY_COLUMN_WIDTHS = [50, 6, 12, 30, 10, 40, 20, 30];

const IMEI_HEADERS = [
  'STOCK IN DATE', 'MODEL', 'IMEI NUMBER', 'BP', 'COLOURS', 'SIM TYPE',
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
      unit.simType ?? '',
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

// SALES_HEADERS now lives in ./platforms alongside excelFormulaFor, because
// the formulas have to resolve their column letters FROM the header order.
// Keeping them apart is what forced the order to be append-only. Re-exported
// here so every existing importer (bulkSaleColumns, tests, the importer)
// keeps working unchanged.
export { SALES_HEADERS, salesCol, salesColLetter } from './platforms';
export type { SalesHeaderRow } from './platforms';

/** The box-and-charger fee for one row of a marketplace tab.
 *
 *  The GP formula on every tab subtracts this CELL, so putting the right
 *  number here is all that is needed for the profit to follow — there is no
 *  second place to change.
 *
 *  Zero on a standalone accessory line. The fee is the box and charger that
 *  ships with a handset, and a charger sold on its own is not shipped with a
 *  charger. Both office and SHS phones keep it. */
function accessoryFeeOf(
  sale: Sale,
  fee: { accessoryFee?: number },
  knownAccessorySkus?: ReadonlySet<string>,
): number {
  if (isAccessorySale(sale, knownAccessorySkus)) return 0;
  return sale.accessoryFee ?? Number(fee.accessoryFee ?? 1);
}

const DATE_FMT = '[$-409]d\\-mmm\\-yyyy';
const MONEY_FMT = '0.00';
const IMEI_FMT = '0';

/** How many times the parcel physically MOVED because of this return.
 *
 *    refund                    2   out to the customer, back to us
 *    repair, customer refunded 2   out, back — the unit stays with us
 *    repair, no refund         3   out, back, and out again once mended
 *    replacement               3   out, the faulty one back, the new one out
 *
 *  This is a count of journeys, NOT a charge. `postageLossFor` bills fewer
 *  legs than this on any sale that kept its revenue — see there for why. */
export function shippingLegsFor(sale: Sale): number {
  if (!sale.voidedAt) return 0;
  if (sale.voidOutcome === 'replacement') return 3;
  // A repair the customer was not refunded for goes back to them mended,
  // which is a third journey. An in-warranty repair is a refund in all but
  // name — the money went back and the unit stayed here.
  if (sale.voidOutcome === 'repair' && saleKeptItsRevenue(sale)) return 3;
  return 2;
}

/** Per-sale postage loss (£): the carriage this return costs that is not
 *  already charged somewhere else. 0 for a sale that was never voided.
 *
 *  WHY THIS IS NOT SIMPLY (postage + P.VAT) × shippingLegsFor
 *
 *  The FIRST journey — out to the customer — was paid at sale time and is
 *  recorded as that sale's own Postage, which its gross profit subtracts. So
 *  whether it needs charging here depends entirely on whether that gross
 *  profit still stands:
 *
 *    - Refunded (and every accessory return, which voids the revenue
 *      outright): the sale contributes nothing, so its postage is charged
 *      nowhere. All of its journeys are billed here.
 *    - Replacement, or a repair after the warranty window: the customer kept
 *      paying, the GP stands, and the outbound leg is already inside it.
 *      Billing it again here charged FOUR legs for three journeys.
 *
 *  Hence: legs billed = journeys − (1 if the sale kept its revenue). That
 *  lands on two legs for every unit return and three for an accessory
 *  replacement, and the two halves cannot double-count because
 *  saleKeptItsRevenue decides which one pays.
 *
 *  `returnCostFor` in returnLoss.ts applies the identical rule — the Returns
 *  & Profit sheet is built on that one and this column on this one, so they
 *  have to agree.
 *
 *  Used as the trailing Postage Loss column on every marketplace sheet so
 *  the CA can tally the period's exposure. */
export function postageLossFor(sale: Sale): number {
  if (!sale.voidedAt) return 0;
  const postage = Number(sale.postage) || 0;
  const pvat = sale.postageVatExempt ? 0 : (Number(sale.postageVat) || postage * 0.2);
  const legs = shippingLegsFor(sale) - (saleKeptItsRevenue(sale) ? 1 : 0);
  return (postage + pvat) * legs;
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
  netGpCol: number;
  gpCol: number;
} {
  // Anchor on the header NAMES, not on distance from the end of the row.
  //
  // This used to read `last - 5` … `last`, which silently assumed the return
  // block was always the final six columns. Appending Storage / Colour in
  // 2026-08 shifted every one of them by two: the return block wrote into
  // the new columns instead, and voided rows exported with a blank Outcome,
  // blank Shipping Legs and no Postage Loss — so Net GP £ quietly equalled
  // Gross GP on exactly the rows where the loss matters. Looking the columns
  // up by name means the next column added can't reintroduce that.
  const headers = SALES_HEADERS[marketplace] as readonly string[];
  const col = (name: string): number => {
    const i = headers.indexOf(name);
    if (i < 0) throw new Error(`SALES_HEADERS[${marketplace}] is missing the "${name}" column`);
    return i + 1;                                    // ExcelJS cells are 1-based
  };
  return {
    returnDateCol:  col('Return Date'),
    outcomeCol:     col('Outcome'),
    reasonCol:      col('Return Reason'),
    legsCol:        col('Shipping Legs'),
    postageLossCol: col('Postage Loss'),
    netGpCol:       col('Net GP £'),
    gpCol:          col('GP'),
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
function writeReturnBlock(row: ExcelJS.Row, marketplace: Marketplace, sale: Sale, rowNumber: number): void {
  const o = returnBlockOffsets(marketplace);
  // Net GP £ is written on EVERY row (active + voided) as a formula
  // referencing this row's GP cell and Postage Loss cell. Active rows
  // leave Postage Loss blank → Excel treats blank as 0 → Net GP = Gross
  // GP for them, which is the correct semantics. Voided rows subtract
  // the real loss → Net GP = bottom-line margin in £.
  const cfg = TOTAL_SUM_COLS[marketplace];
  const gpL   = colLetter(cfg.gpCol);
  const lossL = colLetter(o.postageLossCol);
  row.getCell(o.netGpCol).value  = { formula: `${gpL}${rowNumber}-${lossL}${rowNumber}` };
  row.getCell(o.netGpCol).numFmt = MONEY_FMT;

  // Return-info block + Postage Loss only on voided rows.
  if (!sale.voidedAt) return;
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

  // ── The refunded row keeps no profit ──────────────────────────────────────
  //
  // Until now a returned row carried the SAME GP formula as a clean sale, so
  // a refunded handset showed the full profit the sale would have made, with
  // only the postage taken off. On a typical unit that read as +£22 when the
  // truth was −£19.20 — and because the TOTAL row is SUM(GP:GP), every return
  // pushed its phantom profit into the marketplace total too. That is the
  // positive GP % the operator kept seeing on returned units.
  //
  // Zeroing this one cell corrects all three at once: the row's own GP, the
  // GP % (already (GP − Postage Loss) / SP), and the TOTAL that sums it.
  //
  // Only when the money actually went back. A replacement, and a repair after
  // the warranty refund window, both leave the customer's payment with us —
  // those rows keep their profit and just carry the return's costs.
  //
  // Gated on gpBasis so returns already in the database are untouched: the
  // operator chose to apply this from today onward, and stamping the basis on
  // the return makes that a property of the data rather than of a deploy date.
  if (sale.gpBasis === 'returns_v2' && sale.customerRefunded) {
    row.getCell(o.gpCol).value  = 0;
    row.getCell(o.gpCol).numFmt = MONEY_FMT;
  }
}

/**
 * Write one sale row into the given sheet with the correct base values,
 * formulas (sourced from `excelFormulaFor`) and per-cell number formats.
 */
/** Add a sale row with its values placed by header NAME.
 *
 *  This used to be `sheet.addRow([date, order, sku, ...])` — a positional
 *  array per marketplace. Reordering the columns left those arrays pointing
 *  at their old slots, so SP landed in the Marginal Tax column and GP came
 *  out at -1.48 instead of 56.51. The formulas had already been made
 *  name-based; the VALUES had not, and nothing failed loudly. */
function addSaleRow(
  sheet: ExcelJS.Worksheet,
  marketplace: Marketplace,
  values: Record<string, any>,
): ExcelJS.Row {
  const cols = SALES_HEADERS[marketplace] as readonly (string | number)[];
  for (const k of Object.keys(values)) {
    if (!cols.includes(k)) throw new Error(`${marketplace}: no column "${k}"`);
  }
  return sheet.addRow(cols.map(c => (c in values ? values[c as string] : null)));
}

/**
 * What goes in the IMEI cell.
 *
 * A two-stage sale is recorded by the sales team before anyone has been to the
 * shelf, so it genuinely has no IMEI yet — and an empty cell would read as
 * "this sale is missing data" rather than "this sale is waiting on you". The
 * cell says what to do instead, because the IMEI column is exactly where the
 * warehouse looks and exactly what is absent.
 *
 * The row is otherwise complete: fees, VAT and a provisional profit are all
 * present, so the day's figures are not held up waiting for the handset.
 * See services/pendingSaleService.ts for the two stages.
 */
export const AWAITING_IMEI_CELL = 'UPDATE IMEI & MARK SOLD';

function imeiCellFor(sale: Sale): string {
  if (sale.awaitingImei && !(sale.imei || '').trim()) return AWAITING_IMEI_CELL;
  return sale.imei ?? '';
}

function writeSaleRow(
  sheet: ExcelJS.Worksheet,
  marketplace: Marketplace,
  sale: Sale,
  rowNumber: number,
  /** SKUs stocked as quantity-pool accessories, upper-cased. Decides which
   *  rows are exempt from the £1 box-and-charger fee; see `isAccessorySale`
   *  for why a blank IMEI alone cannot decide it. */
  knownAccessorySkus: ReadonlySet<string> | undefined,
  /** Pre-resolved supplier display name from the caller. Threads the
   *  supplierMap + unitsById lookup that lives at the workbook level
   *  through so each per-marketplace row writes the canonical
   *  supplier instead of an empty cell when `sale.supplierName` is
   *  itself missing. */
  resolvedSupplier: string = '',
): void {
  // The sale's OWN date picks the fee schedule, so a row from before the
  // 2026-08-14 change exports with the rates that applied to it. Without
  // this the report restates history every time it is downloaded, because
  // its money columns are formulas regenerated from the live schedule.
  const f = excelFormulaFor(marketplace, rowNumber, sale.saleDate);
  const date = toDate(sale.saleDate);
  const qty = sale.quantity ?? 1;

  // Cells are addressed by header NAME. They used to be numeric indices
  // (`row.getCell(19)`), which meant a column moving by one wrote the GP into
  // whatever now sat at 19 — silently, and identically formatted.
  const col = (name: string) => salesCol(marketplace, name);

  switch (marketplace) {
    case 'AMAZON': {
      // 2026-05 schema. 22 columns — Date through Comments. Postage and
      // Accessories carry literal values (operator may have overridden
      // postage per sale, accessories is a flat default); every other
      // computed cell is a formula so the operator can audit / re-derive
      // in Excel without trusting our runtime output.
      const row = addSaleRow(sheet, marketplace, {
        Date: date,
        "Order Number": sale.orderNumber,
        SKU: sale.sku ?? '',
        IMEI: imeiCellFor(sale),
        Supplier: resolvedSupplier,
        Quantity: qty,
        BP: sale.buyPrice,
        SP: sale.salePrice,
        Postage: sale.postage ?? null,
        Acc: accessoryFeeOf(sale, f, knownAccessorySkus),
        Comments: sale.comments ?? '',
        Model: resolvedSaleModel(sale),
      });
      row.getCell(col('Date')).numFmt = DATE_FMT;
      row.getCell(col('IMEI')).numFmt = IMEI_FMT;
      row.getCell(col('BP')).numFmt = MONEY_FMT;   // BP
      row.getCell(col('SP')).numFmt = MONEY_FMT;   // SP
      row.getCell(col('SP-BP')).value  = { formula: f.spMinusBp! };     row.getCell(col('SP-BP')).numFmt  = MONEY_FMT;
      row.getCell(col('Marginal Tax')).value = { formula: f.marginalTax! };   row.getCell(col('Marginal Tax')).numFmt = MONEY_FMT;
      row.getCell(col('Commission')).value = { formula: f.commission! };    row.getCell(col('Commission')).numFmt = MONEY_FMT;
      row.getCell(col('C. VAT')).value = { formula: f.commissionVat! }; row.getCell(col('C. VAT')).numFmt = MONEY_FMT;
      row.getCell(col('DSF')).value = { formula: f.dsf! };           row.getCell(col('DSF')).numFmt = MONEY_FMT;
      row.getCell(col('DSF. VAT')).value = { formula: f.dsfVat! };        row.getCell(col('DSF. VAT')).numFmt = MONEY_FMT;
      row.getCell(col('Postage')).numFmt = MONEY_FMT; // Postage (literal value above)
      row.getCell(col('P. VAT')).value = { formula: f.postageVat! };    row.getCell(col('P. VAT')).numFmt = MONEY_FMT;
      row.getCell(col('Acc')).numFmt = MONEY_FMT; // Accessories (literal value above)
      row.getCell(col('Total VAT')).value = { formula: f.totalVat! };      row.getCell(col('Total VAT')).numFmt = MONEY_FMT;
      row.getCell(col('GP')).value = { formula: f.grossProfit! };   row.getCell(col('GP')).numFmt = MONEY_FMT;
      row.getCell(col('GP %')).value = { formula: f.gpPercent! };     row.getCell(col('GP %')).numFmt = MONEY_FMT;
      row.getCell(col('Total VAT NTP')).value = { formula: f.totalVatNtp! };   row.getCell(col('Total VAT NTP')).numFmt = MONEY_FMT;
      writeReturnBlock(row, marketplace, sale, rowNumber);
      return;
    }

    case 'TEMU': {
      // 2026-07, corrected against the client's final Temu export
      // (TEMU_FORMULA.csv) — own 20-column layout, not Amazon's. Commission
      // is a LITERAL per-row value: Temu's real per-order commission varies
      // by category and the export reports the actual figure charged, not a
      // flat rate. Commission VAT is a FORMULA off that cell (K×20%) — the
      // operator's master writes `=K2+20%` there, which Excel reads as
      // K + 0.2 rather than K × 20%, so we emit the correct one instead of
      // carrying the typo forward. Everything else is a formula so the
      // operator can audit in Excel. No DSF / DSF VAT columns — Temu
      // doesn't charge one.
      //   A=Date,B=OrderNo,C=SKU,D=IMEI,E=Supplier,F=Quantity,G=BP,H=SP,
      //   I=SP-BP,J=MarTax,K=Commission,L=Commission VAT,M=Postage,
      //   N=P.VAT,O=Accessories,P=Total VAT,Q=GP,R=GP%,S=Total VAT NTP,T=Comments
      const row = addSaleRow(sheet, marketplace, {
        Date: date,
        "Order Number": sale.orderNumber,
        SKU: sale.sku ?? '',
        IMEI: imeiCellFor(sale),
        Supplier: resolvedSupplier,
        Quantity: qty,
        BP: sale.buyPrice,
        SP: sale.salePrice,
        Postage: sale.postage ?? null,
        Acc: accessoryFeeOf(sale, f, knownAccessorySkus),
        Comments: sale.comments ?? '',
        Model: resolvedSaleModel(sale),
      });
      row.getCell(col('Date')).numFmt = DATE_FMT;
      row.getCell(col('IMEI')).numFmt = IMEI_FMT;
      row.getCell(col('BP')).numFmt = MONEY_FMT;   // BP
      row.getCell(col('SP')).numFmt = MONEY_FMT;   // SP
      row.getCell(col('SP-BP')).value  = { formula: f.spMinusBp! };   row.getCell(col('SP-BP')).numFmt  = MONEY_FMT;
      row.getCell(col('Marginal Tax')).value = { formula: f.marginalTax! }; row.getCell(col('Marginal Tax')).numFmt = MONEY_FMT;
      row.getCell(col('Commission')).value = { formula: f.commission! }; row.getCell(col('Commission')).numFmt = MONEY_FMT;
      row.getCell(col('Commission VAT')).value = { formula: f.commissionVat! }; row.getCell(col('Commission VAT')).numFmt = MONEY_FMT;
      row.getCell(col('Commission+VAT')).value = { formula: f.commissionPlusVat! }; row.getCell(col('Commission+VAT')).numFmt = MONEY_FMT;
      row.getCell(col('Postage')).numFmt = MONEY_FMT; // Postage (literal above)
      row.getCell(col('P. VAT')).value = { formula: f.postageVat! };  row.getCell(col('P. VAT')).numFmt = MONEY_FMT;
      row.getCell(col('Acc')).numFmt = MONEY_FMT; // Accessories (literal above)
      row.getCell(col('Total VAT')).value = { formula: f.totalVat! };    row.getCell(col('Total VAT')).numFmt = MONEY_FMT;
      row.getCell(col('GP')).value = { formula: f.grossProfit! }; row.getCell(col('GP')).numFmt = MONEY_FMT;
      row.getCell(col('GP %')).value = { formula: f.gpPercent! };   row.getCell(col('GP %')).numFmt = MONEY_FMT;
      row.getCell(col('Total VAT NTP')).value = { formula: f.totalVatNtp! }; row.getCell(col('Total VAT NTP')).numFmt = MONEY_FMT;
      writeReturnBlock(row, marketplace, sale, rowNumber);
      return;
    }

    case 'BM': {
      // 2026-05 schema. 19 cols. Customer Care Fees + Accessories are
      // flat literals; Postage is operator-entered. Everything else is a
      // formula so the operator can audit in Excel.
      //   A=Date,B=OrderNo,C=SKU,D=IMEI,E=Supplier,F=Quantity,
      //   G=BP,H=SP,I=SP-BP,J=MarTax,K=Com,L=CustomerCareFees,
      //   M=Postage,N=P.VAT,O=Accessories,P=GP,Q=GP%,R=TotVAT NTP,S=Comments
      const row = addSaleRow(sheet, marketplace, {
        Date: date,
        "Order Number": sale.orderNumber,
        SKU: sale.sku ?? '',
        IMEI: imeiCellFor(sale),
        Supplier: resolvedSupplier,
        Quantity: qty,
        BP: sale.buyPrice,
        SP: sale.salePrice,
        // The client's own column, and it has been on his sheet all along —
        // "Google Pay", "Klarna", or blank. The app has captured it on every
        // BM sale since the sell modal shipped and never written it out.
        "Payment Mode": sale.paymentMode ?? '',
        "Customer Care Fees": sale.customerCareFees ?? Number(f.customerCareFees ?? 9.99),
        Postage: sale.postage ?? null,
        Acc: accessoryFeeOf(sale, f, knownAccessorySkus),
        Comments: sale.comments ?? '',
        Model: resolvedSaleModel(sale),
      });
      row.getCell(col('Date')).numFmt = DATE_FMT;
      row.getCell(col('IMEI')).numFmt = IMEI_FMT;
      row.getCell(col('BP')).numFmt = MONEY_FMT;       // BP
      row.getCell(col('SP')).numFmt = MONEY_FMT;       // SP
      row.getCell(col('SP-BP')).value  = { formula: f.spMinusBp! };    row.getCell(col('SP-BP')).numFmt  = MONEY_FMT;
      row.getCell(col('Marginal Tax')).value = { formula: f.marginalTax! };  row.getCell(col('Marginal Tax')).numFmt = MONEY_FMT;
      row.getCell(col('Commission')).value = { formula: f.commission! };   row.getCell(col('Commission')).numFmt = MONEY_FMT;
      row.getCell(col('Customer Care Fees')).numFmt = MONEY_FMT;                   // Customer Care Fees (literal above)
      // A pre-change sale has no PSF formula (see excelFormulaFor); it gets a
      // plain 0 so the GP chain still has a number to subtract.
      row.getCell(col('PSF')).value = f.psf ? { formula: f.psf } : 0;
      row.getCell(col('PSF')).numFmt = MONEY_FMT;
      row.getCell(col('Postage')).numFmt = MONEY_FMT;                   // Postage (literal above)
      row.getCell(col('P. VAT')).value = { formula: f.postageVat! };   row.getCell(col('P. VAT')).numFmt = MONEY_FMT;
      row.getCell(col('Acc')).numFmt = MONEY_FMT;                   // Accessories (literal above)
      row.getCell(col('GP')).value = { formula: f.grossProfit! };  row.getCell(col('GP')).numFmt = MONEY_FMT;
      row.getCell(col('GP %')).value = { formula: f.gpPercent! };    row.getCell(col('GP %')).numFmt = MONEY_FMT;
      row.getCell(col('Total VAT NTP')).value = { formula: f.totalVatNtp! };  row.getCell(col('Total VAT NTP')).numFmt = MONEY_FMT;
      writeReturnBlock(row, marketplace, sale, rowNumber);
      return;
    }

    case 'EBAY': {
      // 2026-05 schema, 25 cols. Postage, P. VAT, Marketing and Accessories
      // carry literal values — the operator's master has no formula in any
      // of them, they are typed per row. Everything else computes via
      // formulas so the operator can audit in Excel.
      //   A=Date,B=OrderNo,C=SKU,D=IMEI,E=Supplier,F=Units,
      //   G=BP,H=SP,I=SP-BP,J=MarTax,K=Com,L=ROF,M=FVF,N=VAT,O=T.COM,
      //   P=Postage,Q=P.VAT,R=Marketing,S=M.VAT,T=Acc,U=TotVAT,V=GP,
      //   W=GP%,X=TotVAT NTP,Y=Comments
      const row = addSaleRow(sheet, marketplace, {
        Date: date,
        "Order Number": sale.orderNumber,
        SKU: sale.sku ?? '',
        IMEI: imeiCellFor(sale),
        Supplier: resolvedSupplier,
        Units: qty,
        BP: sale.buyPrice,
        SP: sale.salePrice,
        Postage: sale.postage ?? null,
        "P. VAT": sale.postageVat ?? 0,
        Marketing: sale.marketing ?? 0,
        Acc: accessoryFeeOf(sale, f, knownAccessorySkus),
        Comments: sale.comments ?? '',
        Model: resolvedSaleModel(sale),
      });
      row.getCell(col('Date')).numFmt = DATE_FMT;
      row.getCell(col('IMEI')).numFmt = IMEI_FMT;
      row.getCell(col('BP')).numFmt = MONEY_FMT;            // BP
      row.getCell(col('SP')).numFmt = MONEY_FMT;            // SP
      row.getCell(col('SP-BP')).value  = { formula: f.spMinusBp! };    row.getCell(col('SP-BP')).numFmt  = MONEY_FMT;
      row.getCell(col('Marginal Tax')).value = { formula: f.marginalTax! };  row.getCell(col('Marginal Tax')).numFmt = MONEY_FMT;
      row.getCell(col('Commission')).value = { formula: f.commission! };   row.getCell(col('Commission')).numFmt = MONEY_FMT;
      row.getCell(col('ROF')).value = { formula: f.rof! };          row.getCell(col('ROF')).numFmt = MONEY_FMT;
      row.getCell(col('FVF')).value = Number(f.fvf);                row.getCell(col('FVF')).numFmt = MONEY_FMT;
      row.getCell(col('VAT')).value = { formula: f.vat20! };        row.getCell(col('VAT')).numFmt = MONEY_FMT;
      row.getCell(col('T.COM')).value = { formula: f.totalCom! };     row.getCell(col('T.COM')).numFmt = MONEY_FMT;
      row.getCell(col('Postage')).numFmt = MONEY_FMT;                   // Postage (literal above)
      row.getCell(col('P. VAT')).numFmt = MONEY_FMT;                   // P. VAT (literal above)
      row.getCell(col('Marketing')).numFmt = MONEY_FMT;                   // Marketing (literal above)
      row.getCell(col('M. VAT')).value = { formula: f.marketingVat! }; row.getCell(col('M. VAT')).numFmt = MONEY_FMT;
      row.getCell(col('Acc')).numFmt = MONEY_FMT;                   // Accessories (literal above)
      row.getCell(col('Total VAT')).value = { formula: f.totalVat! };     row.getCell(col('Total VAT')).numFmt = MONEY_FMT;
      row.getCell(col('GP')).value = { formula: f.grossProfit! };  row.getCell(col('GP')).numFmt = MONEY_FMT;
      row.getCell(col('GP %')).value = { formula: f.gpPercent! };    row.getCell(col('GP %')).numFmt = MONEY_FMT;
      row.getCell(col('Total VAT NTP')).value = { formula: f.totalVatNtp! };  row.getCell(col('Total VAT NTP')).numFmt = MONEY_FMT;
      writeReturnBlock(row, marketplace, sale, rowNumber);
      return;
    }

    case 'ONBUY': {
      // 2026-05 schema. 19 cols. No quantity column (OnBuy convention).
      //   A=Date,B=OrderNo,C=SKU,D=IMEI,E=Supplier,
      //   F=BP,G=SP,H=SP-BP,I=MarTax,J=Com,K=VAT20%,
      //   L=Postage,M=P.VAT,N=Acc,O=TotVAT,P=GP,
      //   Q=GP%,R=TotVAT NTP,S=Comments
      const row = addSaleRow(sheet, marketplace, {
        Date: date,
        "Order Number": sale.orderNumber,
        SKU: sale.sku ?? '',
        IMEI: imeiCellFor(sale),
        Supplier: resolvedSupplier,
        BP: sale.buyPrice,
        SP: sale.salePrice,
        Postage: sale.postage ?? null,
        Acc: accessoryFeeOf(sale, f, knownAccessorySkus),
        Comments: sale.comments ?? '',
        Model: resolvedSaleModel(sale),
      });
      row.getCell(col('Date')).numFmt = DATE_FMT;
      row.getCell(col('IMEI')).numFmt = IMEI_FMT;
      row.getCell(col('BP')).numFmt = MONEY_FMT;   // BP (F)
      row.getCell(col('SP')).numFmt = MONEY_FMT;   // SP (G)
      row.getCell(col('SP-BP')).value  = { formula: f.spMinusBp! };    row.getCell(col('SP-BP')).numFmt  = MONEY_FMT;
      row.getCell(col('Marginal Tax')).value  = { formula: f.marginalTax! };  row.getCell(col('Marginal Tax')).numFmt  = MONEY_FMT;
      row.getCell(col('Commission')).value = { formula: f.commission! };   row.getCell(col('Commission')).numFmt = MONEY_FMT;
      row.getCell(col('VAT 20%')).value = { formula: f.vat20! };        row.getCell(col('VAT 20%')).numFmt = MONEY_FMT;
      row.getCell(col('Postage')).numFmt = MONEY_FMT;                   // Postage (literal above)
      row.getCell(col('P. VAT')).value = { formula: f.postageVat! };   row.getCell(col('P. VAT')).numFmt = MONEY_FMT;
      row.getCell(col('Acc')).numFmt = MONEY_FMT;                   // Accessories (literal above)
      row.getCell(col('Total VAT')).value = { formula: f.totalVat! };     row.getCell(col('Total VAT')).numFmt = MONEY_FMT;
      row.getCell(col('GP')).value = { formula: f.grossProfit! };  row.getCell(col('GP')).numFmt = MONEY_FMT;
      row.getCell(col('GP %')).value = { formula: f.gpPercent! };    row.getCell(col('GP %')).numFmt = MONEY_FMT;
      row.getCell(col('Total VAT NTP')).value = { formula: f.totalVatNtp! };  row.getCell(col('Total VAT NTP')).numFmt = MONEY_FMT;
      writeReturnBlock(row, marketplace, sale, rowNumber);
      return;
    }

  }
}

/**
 * How many blank-but-live rows to leave under the data on each marketplace tab.
 *
 * The Sales Report is a record AND a working sheet: the operator opens it,
 * types the next sale onto the end, and the money columns compute in Excel.
 * Without these rows the TOTAL row sits immediately under the last sale, so
 * typing into the next row overwrites the totals and gets no formulas.
 */
export const PRIMED_SALE_ROWS = 200;

/**
 * Money columns the report writes as LITERAL values rather than formulas,
 * because they come off the fee schedule and not off the row. They have to
 * survive priming: a blank row that lost them would compute a GP missing the
 * accessory pound (and, on BM, the £8.99 care fee), so the operator's own
 * arithmetic would quietly disagree with the application's.
 */
const CONSTANT_HEADERS = new Set(['Acc', 'FVF', 'Customer Care Fees']);

/** Column letter for a 1-based index. */
function letterFor(n: number): string {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; }
  return s;
}

/**
 * Append `count` blank rows that are already wired up: every formula the report
 * writes on a real row is present, wrapped in a guard on that row's SP cell.
 *
 *     =IF($H5="","", <the report's formula, unchanged>)
 *
 * so an untouched row renders empty instead of `0` or `#DIV/0!`, and wakes up
 * the moment the row has a sale price. The expression inside the guard is
 * byte-identical to what a real row carries — the tests strip the guard and
 * compare, which is the only thing keeping the two from drifting.
 *
 * Rows are produced by calling `writeSaleRow` with an empty sale, so the number
 * formats, the column positions and the formulas all come from the one code
 * path that writes a live report. There is no second layout to keep in step.
 *
 * `scripts/generateSalesTemplates.ts` uses this too — the blank templates and
 * the primed tail of a real report are the same thing, and used to be two
 * separate implementations of it.
 */
export function primeBlankSaleRows(
  sheet: ExcelJS.Worksheet,
  marketplace: Marketplace,
  firstRow: number,
  count: number,
): void {
  const headers = SALES_HEADERS[marketplace] as readonly string[];
  const spCol = headers.indexOf('SP') + 1;
  if (spCol === 0) throw new Error(`${marketplace}: no SP column to guard blank rows on`);
  const spLetter = letterFor(spCol);

  // `unitId` is a marker, not data: it never reaches the sheet, because the
  // loop below blanks every literal cell that is not a CONSTANT_HEADER. It is
  // here so `isAccessorySale` does not read an empty row as a standalone
  // accessory line and drop the £1 box-and-charger constant. These rows exist
  // for the operator to type HANDSET sales into, so they must carry a
  // handset's constants.
  const blank = {
    marketplace, orderNumber: '', quantity: null, unitId: '__primed_blank_row__',
  } as unknown as Sale;

  for (let i = 0; i < count; i++) {
    const rowNumber = firstRow + i;
    writeSaleRow(sheet, marketplace, blank, rowNumber, undefined, '');
    const row = sheet.getRow(rowNumber);
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      const v = cell.value as { formula?: string } | null;
      if (v && typeof v === 'object' && 'formula' in v && v.formula) {
        cell.value = { formula: `IF($${spLetter}${rowNumber}="","",${v.formula})` };
        return;
      }
      // Everything else is the operator's to type — except the flat
      // fee-schedule charges, which stay.
      if (!CONSTANT_HEADERS.has(headers[col - 1])) cell.value = null;
    });
  }
}

export async function buildSalesWorkbookBuffer(input: BuildSalesWorkbookInput): Promise<ArrayBuffer> {
  const { sales, units, supplierMap, opts, accessoryStock } = input;

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

    // The unit's return markers are the CURRENT state of the unit, not a fact
    // about this sale. A unit that was returned, put back on the shelf and
    // sold again still carries them — so synthesising here stamped a closed
    // return onto the NEW sale.
    //
    // Seen live on the BM tab: a sale dated 12-Aug carrying Return Date
    // 11-Aug, i.e. returned the day BEFORE it was sold. It painted the row
    // red, charged £15.12 of phantom postage loss and reported a profitable
    // sale as Net GP -£15.12 — and would do so again on every future resale
    // of that handset.
    //
    // Same rule the returns ledger already applies (isOpenReturnUnit in
    // lib/returnsLedger.ts): a return is closed once the unit has been sold
    // after it. That is why the Returns page correctly showed nothing while
    // the report showed a refund. Skipping here makes the two agree.
    const saleDay = (s.saleDate || '').split('T')[0];
    const returnDay = (u.returnDate || '').split('T')[0];
    if (saleDay && returnDay && saleDay > returnDay) return s;

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
  // Sort each marketplace tab by saleDate desc — same convention as the
  // Returns tab + ALL sheet writers. Important when one IMEI has been
  // cycled (sold → returned → re-sold) multiple times: the operator sees
  // the cycles in chronological order interleaved with other sales,
  // rather than whatever order Firestore happened to return.
  // Composite createdAt is the tie-breaker so two same-day cycles on the
  // same IMEI still resolve deterministically (latest cycle on top).
  const cycleSortKey = (s: Sale): string => {
    const ts = typeof s.createdAt === 'string'
      ? s.createdAt
      : (s.createdAt && typeof (s.createdAt as { toDate?: () => Date }).toDate === 'function'
          ? (s.createdAt as { toDate: () => Date }).toDate().toISOString()
          : '');
    return `${s.saleDate || ''}__${ts}`;
  };
  for (const m of MARKETPLACES) {
    const bucket = byMarketplace.get(m);
    if (bucket) bucket.sort((a, b) => cycleSortKey(b).localeCompare(cycleSortKey(a)));
  }

  const wb = new ExcelJS.Workbook();

  // Sheet 1: Summary — auditor-facing roll-up of the period (period label,
  // per-marketplace breakdown, refund vs replacement counts, gross + net GP
  // including postage-loss adjustment). Built before the marketplace sheets
  // so it lands as the leftmost tab.
  writeSalesSummarySheet(wb, byMarketplace, opts, unitsById, unitsByImei);

  // Which SKUs are quantity-pool accessories. Needed to decide, per row,
  // whether the £1 box-and-charger fee applies: only a handset gets one, and a
  // blank IMEI cannot stand in for the test because an SHS handset is sold
  // BEFORE it is collected from the supplier and so has no IMEI yet. See
  // isAccessorySale.
  // undefined, NOT an empty Set, when there is no catalogue to consult. An
  // empty Set is a positive claim that nothing is an accessory, which would
  // put the £1 back on every charger the moment a caller omitted the stock
  // list; undefined means "cannot tell", and isAccessorySale then falls back
  // to the two-identifier test.
  const accessorySkuList = (accessoryStock ?? [])
    .map(a => (a.sku || '').trim().toUpperCase())
    .filter(Boolean);
  const knownAccessorySkus = accessorySkuList.length
    ? new Set(accessorySkuList)
    : undefined;

  // Per-platform sheets — one tab per entry in MARKETPLACES (AMAZON, BM,
  // EBAY, ONBUY, TEMU as of 2026-07); PROJECT excluded — that was never a
  // real sales channel.
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
      writeSaleRow(sheet, m, sale, rowNumber, knownAccessorySkus, resolvedSupplier);

      // Storage + Colour — buy-side identity carried onto the sale row so a
      // re-import can restore it. Written here rather than inside
      // writeSaleRow because they are appended AFTER every formula column:
      // setting them by header index keeps the five per-marketplace branches
      // in writeSaleRow (and their hard-coded cell numbers) untouched.
      //
      // The point: a sale for an IMEI that was never in stock has nowhere
      // else to get these from — the marketplace tabs historically carried
      // neither, so every such unit landed on the Orphans list. Exporting
      // them makes the round trip self-healing.
      {
        const headerList = SALES_HEADERS[m] as readonly string[];
        const unitForAttrs =
          (sale.unitId && unitsById.get(sale.unitId))
          || (sale.imei && unitsByImei.get((sale.imei || '').trim().toUpperCase()))
          || undefined;
        const storageIdx = headerList.indexOf('Storage') + 1;
        const colourIdx = headerList.indexOf('Colour') + 1;
        if (storageIdx > 0) sheet.getRow(rowNumber).getCell(storageIdx).value = unitForAttrs?.storage ?? '';
        if (colourIdx > 0) sheet.getRow(rowNumber).getCell(colourIdx).value = unitForAttrs?.colour ?? '';

        // Model, same fallback chain as Supplier above. resolvedSaleModel()
        // is pure — it only sees `sale.model || sale.sku` — and an IN-APP
        // sale has neither: recordSale copies the SKU off the unit, and a
        // hand-added unit never gets one. So the Model column came out blank
        // for every sale booked through the app, which is precisely the
        // column an auditor reads to see WHAT sold. The linked unit knows,
        // so ask it.
        const modelIdx = headerList.indexOf('Model') + 1;
        if (modelIdx > 0) {
          const cellNow = sheet.getRow(rowNumber).getCell(modelIdx);
          const current = String(cellNow.value ?? '').trim();
          if (!current && unitForAttrs?.model) cellNow.value = unitForAttrs.model;
        }
      }
      // Same red-fill visual signal as the ALL sheet — applied across
      // every cell in the row so the highlight covers the full width
      // even when the master schema includes blank/formula-only cells.
      if (sale.voidedAt) {
        const row = sheet.getRow(rowNumber);
        for (let col = 1; col <= headerLen; col++) {
          row.getCell(col).fill = RETURNED_FILL;
        }
      }
      // Replacement-swap audit marker. When a sale was voided with
      // outcome='replacement', the linked unit (the customer-side unit
      // that came back) carries replacedByUnitId pointing to the stock
      // unit shipped out in its place. The replacement unit itself has
      // NO Sale doc — ReturnsPage only flips the unit (the original
      // Sale doc stays canonical for revenue), so the only place we can
      // surface the swap on a marketplace tab is the original row.
      // Prefix the Comments column with "[REPLACED BY IMEI <X>]" so the
      // auditor sees which unit fulfilled the order without having to
      // pivot to the Returns sheet. No cell fill — the row already
      // carries the rose voided fill which would mask any violet tint.
      const linkedUnit =
        (sale.unitId && unitsById.get(sale.unitId))
        || (sale.imei && unitsByImei.get((sale.imei || '').trim().toUpperCase()))
        || undefined;
      if (linkedUnit?.replacedByUnitId) {
        const replacementUnit = unitsById.get(linkedUnit.replacedByUnitId);
        const replacementImei = (replacementUnit?.imei || '').trim() || linkedUnit.replacedByUnitId;
        const row = sheet.getRow(rowNumber);
        const commentsIdx = (SALES_HEADERS[m] as readonly string[]).indexOf('Comments') + 1;
        if (commentsIdx > 0) {
          const commentsCell = row.getCell(commentsIdx);
          const existing = typeof commentsCell.value === 'string' ? commentsCell.value : '';
          const tag = `[REPLACED BY IMEI ${replacementImei}]`;
          commentsCell.value = existing ? `${tag} ${existing}` : tag;
        }
      }
      // No-inventory-match audit marker. The sale carries an IMEI but no
      // inventory unit exists for it (neither by unitId nor by IMEI). This
      // means the sold phone was never in stock — typically a bulk order
      // whose IMEIs were combined in one cell, or a serial that isn't a
      // real IMEI (tablet/accessory). Flag the Comments column + tint the
      // row amber so the operator can add the unit as fresh stock (the
      // import sync will then link + mark it sold). Skip voided rows —
      // they're already rose-filled and a missing unit there is expected
      // (the unit may have been returned out of inventory).
      const hasUnitData = unitsById.size > 0 || unitsByImei.size > 0;
      const saleImei = (sale.imei || '').trim();
      if (hasUnitData && saleImei && !linkedUnit && !sale.voidedAt) {
        const row = sheet.getRow(rowNumber);
        const commentsIdx = (SALES_HEADERS[m] as readonly string[]).indexOf('Comments') + 1;
        if (commentsIdx > 0) {
          const commentsCell = row.getCell(commentsIdx);
          const existing = typeof commentsCell.value === 'string' ? commentsCell.value : '';
          const tag = '[NO INVENTORY IMEI]';
          commentsCell.value = existing ? `${tag} ${existing}` : tag;
        }
        for (let col = 1; col <= headerLen; col++) {
          row.getCell(col).fill = NO_INVENTORY_FILL;
        }
      }
    }

    // Blank-but-live rows under the data, then the totals row under those.
    //
    // The tail is what makes this file a working sheet rather than only a
    // record: type a sale into the first empty row and SP-BP, Marginal Tax,
    // Commission, the VAT lines, GP, GP % and Total VAT NTP all fill in, in
    // Excel, with no round trip through the application.
    //
    // The TOTAL row's SUM spans the primed rows as well as the real ones. That
    // is safe because an unfilled guarded formula evaluates to "" and SUM
    // ignores text — so the totals read correctly while the rows are empty and
    // pick up a new sale the moment one is typed.
    //
    // Written even for a marketplace with no sales in the period: an empty
    // channel is exactly the one an operator is most likely to want to type
    // into, and the Summary tab points at this row on every tab.
    primeBlankSaleRows(sheet, m, bucket.length + 2, PRIMED_SALE_ROWS);
    writeMarketplaceTotalsRow(sheet, m, bucket.length + PRIMED_SALE_ROWS);
  }

  // Accessories sheet — every accessory sale (no-IMEI, sku-based) already
  // appears on its own marketplace tab above, interleaved with unit sales;
  // this tab pulls the SAME rows into one place across every marketplace,
  // the same relationship the Inventory Report has between its per-source
  // Office/SHS sheets and its own dedicated Accessories sheet.
  // Returns & Profit by marketplace — one row per channel carrying the
  // corrected return economics (repair invoices, supplier credits, and a
  // replacement costing carriage only). The top-level Summary sheet has an
  // older, narrower version that predates those corrections; rather than
  // quietly change what that sheet has always meant, this is its own sheet.
  // `enriched`, not `filtered`: this sheet needs the sales whose RETURN
  // falls in the period as well as the ones whose SALE does, and those are
  // not the same set. It does its own two-part filter — see the docblock.
  writeReturnsProfitSheet(wb, enriched, units ?? [], opts);

  writeAccessoriesSalesSheet(wb, filtered, accessoryStock ?? []);

  // Sheets after TEMU: Returns Summary / Returns Detail / Unit Histories —
  // the SAME structure as the standalone Returns Report
  // (buildReturnsWorkbookBuffer), embedded here so return data and history
  // live in the Sales Report itself rather than a separate download.
  // 'Returns Summary' (not 'Summary') avoids colliding with this
  // workbook's own top-level Summary sheet above. Filters by voidedAt —
  // not saleDate — so a sale made last month and returned this week shows
  // up under "This Week". That matches the standalone Returns Report's
  // behaviour and answers the operator's question "what got returned this
  // period?" rather than "which of THIS period's sales were voided?". The
  // marketplace tabs keep their saleDate filter so the Summary's revenue /
  // GP numbers stay self-consistent with the rows that produced them.
  writeReturnsSheets(wb, { units: units ?? [], sales: enriched, supplierMap, opts, accessoryStock }, 'Returns Summary');

  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

const ACCESSORIES_SALES_HEADERS = [
  'Date', 'Marketplace', 'Order Number', 'SKU', 'Name', 'Supplier',
  'Quantity', 'BP', 'SP', 'GP', 'GP %', 'Comments',
] as const;

/** Every accessory sale (no-IMEI, sku-based) pulled into one sheet across
 *  all marketplaces — same relationship the Inventory Report has between
 *  its Office/SHS sheets and its own dedicated Accessories sheet. Each row
 *  already appears on its own marketplace tab; this is a cross-marketplace
 *  view, not a second source of truth. */
function writeAccessoriesSalesSheet(
  wb: ExcelJS.Workbook,
  sales: Sale[],
  accessoryStock: AccessoryStock[],
): void {
  const nameBySku = new Map<string, string>();
  for (const a of accessoryStock) nameBySku.set(a.sku, a.name || a.sku);

  const rows = sales
    .filter(s => !(s.imei || '').trim() && (s.sku || '').trim())
    .map(s => recomputeSale(s))
    .sort((a, b) => (b.saleDate || '').localeCompare(a.saleDate || ''));

  const sheet = wb.addWorksheet('Accessories');
  sheet.addRow([...ACCESSORIES_SALES_HEADERS]);
  sheet.getRow(1).font = { bold: true };

  for (let i = 0; i < rows.length; i++) {
    const sale = rows[i];
    const row = sheet.addRow([
      toDate(sale.saleDate), sale.marketplace, sale.orderNumber,
      sale.sku ?? '', sale.model || nameBySku.get(sale.sku ?? '') || sale.sku || '',
      sale.supplierName ?? '',
      sale.quantity ?? 1, sale.buyPrice, sale.salePrice,
      sale.grossProfit, sale.gpPercent,
      sale.comments ?? '',
    ]);
    row.getCell(1).numFmt = DATE_FMT;
    row.getCell(8).numFmt = MONEY_FMT;  // BP
    row.getCell(9).numFmt = MONEY_FMT;  // SP
    row.getCell(10).numFmt = MONEY_FMT; // GP
    row.getCell(11).numFmt = '0.0"%"';  // GP %
    if (sale.voidedAt) {
      for (let col = 1; col <= ACCESSORIES_SALES_HEADERS.length; col++) {
        row.getCell(col).fill = RETURNED_FILL;
      }
    }
  }

  if (rows.length > 0) {
    const totalRow = sheet.addRow(['TOTAL', '', '', '', '', '',
      { formula: `SUM(G2:G${rows.length + 1})` },
      { formula: `SUM(H2:H${rows.length + 1})` },
      { formula: `SUM(I2:I${rows.length + 1})` },
      { formula: `SUM(J2:J${rows.length + 1})` },
      '', '',
    ]);
    totalRow.font = { bold: true };
    totalRow.getCell(8).numFmt = MONEY_FMT;
    totalRow.getCell(9).numFmt = MONEY_FMT;
    totalRow.getCell(10).numFmt = MONEY_FMT;
  }

  sheet.columns.forEach((col, i) => {
    col.width = ACCESSORIES_SALES_HEADERS[i] === 'Name' ? 26 : ACCESSORIES_SALES_HEADERS[i] === 'Comments' ? 28 : 14;
  });
}

/** Which columns the trailing TOTAL row sums, and which one the GP % divides
 *  by — held as header NAMES, not indices.
 *
 *  This used to be a table of hard numbers with a comment on each line
 *  reminding the reader which letter each one was. Reordering a column meant
 *  editing five such tables by hand and hoping; getting one wrong summed the
 *  wrong column into a bold TOTAL that still looked like a total. */
const TOTAL_SUM_NAMES: Record<Marketplace, { numericCols: string[]; denominator: string }> = {
  AMAZON: {
    numericCols: ["Quantity", "BP", "SP", "SP-BP", "Marginal Tax", "Commission", "C. VAT", "DSF", "DSF. VAT", "Postage", "P. VAT", "Acc", "Total VAT", "GP", "Total VAT NTP", "Postage Loss", "Net GP £"].map(s => s),
    denominator: "BP",
  },
  BM: {
    numericCols: ["Quantity", "BP", "SP", "SP-BP", "Marginal Tax", "Commission", "Customer Care Fees", "PSF", "Postage", "P. VAT", "Acc", "GP", "Total VAT NTP", "Postage Loss", "Net GP £"].map(s => s),
    denominator: "BP",
  },
  EBAY: {
    numericCols: ["Units", "BP", "SP", "SP-BP", "Marginal Tax", "Commission", "ROF", "FVF", "VAT", "T.COM", "Postage", "P. VAT", "Marketing", "M. VAT", "Acc", "Total VAT", "GP", "Total VAT NTP", "Postage Loss", "Net GP £"].map(s => s),
    denominator: "SP",
  },
  ONBUY: {
    numericCols: ["BP", "SP", "SP-BP", "Marginal Tax", "Commission", "VAT 20%", "Postage", "P. VAT", "Acc", "Total VAT", "GP", "Total VAT NTP", "Postage Loss", "Net GP £"].map(s => s),
    denominator: "BP",
  },
  TEMU: {
    numericCols: ["Quantity", "BP", "SP", "SP-BP", "Marginal Tax", "Commission", "Commission VAT", "Commission+VAT", "Postage", "P. VAT", "Acc", "Total VAT", "GP", "Total VAT NTP", "Postage Loss", "Net GP £"].map(s => s),
    denominator: "BP",
  },
};

/** Resolved 1-indexed positions for the current header order. */
const TOTAL_SUM_COLS: Record<Marketplace, {
  label: number; numericCols: number[]; gpCol: number; gpPctCol: number;
  postageLossCol: number; netGpCol: number; denominatorCol: number;
}> = Object.fromEntries(MARKETPLACES.map(m => [m, {
  label: 1,
  numericCols: TOTAL_SUM_NAMES[m].numericCols.map(n => salesCol(m, n)),
  gpCol: salesCol(m, 'GP'),
  gpPctCol: salesCol(m, 'GP %'),
  postageLossCol: salesCol(m, 'Postage Loss'),
  netGpCol: salesCol(m, 'Net GP £'),
  denominatorCol: salesCol(m, TOTAL_SUM_NAMES[m].denominator),
}])) as any;

/**
 * Returns & Profit by marketplace.
 *
 * Answers the two questions asked of a period per channel: what did it make,
 * and what did its returns cost? Built on returnCostFor — the same function
 * the Returns screen uses — so the workbook and the app cannot drift apart.
 *
 * Revenue and Gross GP count only sales that KEPT their money. A refunded
 * sale contributes nothing; a replacement or an out-of-warranty repair
 * contributes in full, because the customer's payment stayed with us.
 *
 * TWO PERIODS, DELIBERATELY. Revenue and Gross GP are filtered by SALE date —
 * they belong to the week the money came in. Returns and their costs are
 * filtered by RETURN date, because that is the week the money went out, and
 * because the Returns Summary and Returns Detail sheets in this same workbook
 * have always done it that way.
 *
 * This used to be one filter, on sale date, and it silently dropped returns.
 * A Samsung sold on 7 Aug and refunded on 14 Aug vanished from a 9-15 Aug
 * report: its sale was outside the window, so the return went with it. The
 * workbook then contradicted itself — Returns Summary said two returns and
 * GBP 30.24 of loss, Returns & Profit said one and GBP 15.12 — and the channel
 * that took the hit read a Net GP GBP 15.12 too high, with a Return Cost of
 * zero. The operator's own words: "why are they not showing in Amazon".
 *
 * The consequence to be aware of: a week can now carry a return cost for a
 * sale whose revenue it never counted. That is the honest presentation — the
 * cash left in that week — and it is why Return Cost is its own column rather
 * than being netted invisibly into Gross GP.
 */
function writeReturnsProfitSheet(
  wb: ExcelJS.Workbook,
  /** EVERY sale, unfiltered. The period is applied below, twice. */
  sales: Sale[],
  units: InventoryUnit[],
  opts?: ClientReportOptions,
): void {
  const sheet = wb.addWorksheet('Returns & Profit');

  const unitsById = new Map<string, InventoryUnit>();
  const unitsByImei = new Map<string, InventoryUnit>();
  for (const u of units) {
    if (u.id) unitsById.set(u.id, u);
    const k = (u.imei || '').trim().toUpperCase();
    if (k && !unitsByImei.has(k)) unitsByImei.set(k, u);
  }
  const unitFor = (s: Sale): InventoryUnit | undefined => {
    const byId = (s as any).unitId ? unitsById.get((s as any).unitId) : undefined;
    if (byId) return byId;
    const k = (s.imei || '').trim().toUpperCase();
    return k ? unitsByImei.get(k) : undefined;
  };

  const title = sheet.addRow(['RETURNS & PROFIT BY MARKETPLACE']);
  title.font = { bold: true, size: 13 };
  const note = sheet.addRow([
    'Revenue and Gross GP count only sales that kept their money \u2014 a refunded sale contributes '
    + 'nothing, while a replacement or an out-of-warranty repair counts in full because the customer '
    + 'kept paying. Return Cost = carriage + repair invoices + marketplace fees kept \u2212 supplier '
    + 'credits. Fees Kept is what the channel did NOT refund: Amazon keeps a capped admin fee, eBay its '
    + 'fixed \u00a30.40 order fee; BM, OnBuy and Temu keep everything. A replacement costs carriage only: '
    + 'the faulty unit comes back as the replacement ships, so net stock is unchanged.',
  ]);
  note.getCell(1).font = { size: 9, italic: true, color: { argb: 'FF64748B' } };
  note.getCell(1).alignment = { wrapText: true, vertical: 'top' };
  note.height = 46;
  sheet.addRow([]);

  const header = sheet.addRow([
    'Marketplace', 'Sales', 'Revenue \u00a3', 'Gross GP \u00a3',
    'Returns', 'Refunds', 'Replacements', 'Repairs', 'To Supplier',
    'Carriage \u00a3', 'Repair Invoices \u00a3', 'Supplier Credits \u00a3', 'Fees Kept \u00a3',
    'Return Cost \u00a3', 'Net GP \u00a3', 'Net GP %', 'Costs Outstanding',
  ]);
  header.font = { bold: true };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };

  interface Acc {
    sales: number; revenue: number; grossGp: number;
    returns: number; refunds: number; replacements: number; repairs: number; toSupplier: number;
    carriage: number; repairCost: number; credits: number; feeLoss: number; gaps: number;
  }
  const blank = (): Acc => ({
    sales: 0, revenue: 0, grossGp: 0,
    returns: 0, refunds: 0, replacements: 0, repairs: 0, toSupplier: 0,
    carriage: 0, repairCost: 0, credits: 0, feeLoss: 0, gaps: 0,
  });
  const acc = new Map<Marketplace, Acc>(MARKETPLACES.map(m => [m, blank()]));

  const from = opts?.from ?? '0000-01-01';
  const to   = opts?.to   ?? '9999-12-31';
  const within = (day: string | undefined) => {
    if (!opts?.from && !opts?.to) return true;      // all-time report
    const d = (day ?? '').slice(0, 10);
    return !!d && d >= from && d <= to;
  };

  /**
   * When the return happened. The unit's own returnDate is authoritative —
   * it is what the Returns sheets filter on — and voidedAt stands in when the
   * sale was reversed without a unit to hang it off.
   */
  const returnDayOf = (s: Sale, u?: InventoryUnit) =>
    (u?.returnDate || s.voidedAt || '').slice(0, 10);

  // ── Revenue side: filtered by SALE date ────────────────────────────────
  for (const s of sales) {
    if (!within(s.saleDate)) continue;
    const a = acc.get(s.marketplace as Marketplace);
    if (!a) continue;
    if (!saleKeptItsRevenue(s)) continue;
    a.sales += 1;
    a.revenue += Number(s.salePrice) || 0;
    a.grossGp += Number(s.grossProfit) || 0;
  }

  // ── Return side: filtered by RETURN date ───────────────────────────────
  // A separate pass, over the same sales, because a return in this period
  // may belong to a sale from an earlier one. Merging the two passes is what
  // used to drop it.
  for (const s of sales) {
    if (!s.voidedAt) continue;
    const a = acc.get(s.marketplace as Marketplace);
    if (!a) continue;
    const u = unitFor(s);
    if (!within(returnDayOf(s, u))) continue;

    a.returns += 1;
    if (s.voidOutcome === 'replacement') a.replacements += 1;
    else if (s.voidOutcome === 'repair') a.repairs += 1;
    else a.refunds += 1;

    if (u?.returnType === 'returned_to_supplier') a.toSupplier += 1;

    // The fee loss comes from the SALE — what the channel kept when the buyer
    // was refunded — so it does not depend on finding the unit and is added
    // outside that branch. returnCostFor computes the identical figure when a
    // unit exists; taking it from here in both cases keeps the two branches
    // agreeing by construction.
    a.feeLoss += feeLossOnRefund(s);

    // Costs live on the UNIT (the invoice and the credit are entered there).
    // With no matching unit only carriage is knowable, and postageLossFor
    // gives that from the sale alone — better than dropping the return.
    if (u) {
      const c = returnCostFor(u, s);
      a.carriage += c.postage;
      a.repairCost += c.repair;
      a.credits += c.supplierCredit;
      a.gaps += c.gaps.length;
    } else {
      a.carriage += postageLossFor(s);
    }
  }

  const moneyCols = [3, 4, 10, 11, 12, 13, 14, 15, 16];
  const total = blank();

  for (const m of MARKETPLACES) {
    const a = acc.get(m)!;
    if (!a.sales && !a.returns) continue;          // channel unused this period
    const returnCost = a.carriage + a.repairCost + a.feeLoss - a.credits;
    const netGp = a.grossGp - returnCost;
    const row = sheet.addRow([
      m, a.sales, a.revenue, a.grossGp,
      a.returns, a.refunds, a.replacements, a.repairs, a.toSupplier,
      a.carriage, a.repairCost, a.credits, a.feeLoss, returnCost,
      netGp, a.revenue > 0 ? (netGp / a.revenue) * 100 : 0,
      a.gaps || '',
    ]);
    for (const c of moneyCols) row.getCell(c).numFmt = MONEY_FMT;
    for (const k of Object.keys(total) as (keyof Acc)[]) total[k] += a[k];
  }

  const totalReturnCost = total.carriage + total.repairCost + total.feeLoss - total.credits;
  const totalNetGp = total.grossGp - totalReturnCost;
  const totalRow = sheet.addRow([
    'TOTAL', total.sales, total.revenue, total.grossGp,
    total.returns, total.refunds, total.replacements, total.repairs, total.toSupplier,
    total.carriage, total.repairCost, total.credits, total.feeLoss, totalReturnCost,
    totalNetGp, total.revenue > 0 ? (totalNetGp / total.revenue) * 100 : 0,
    total.gaps || '',
  ]);
  totalRow.font = { bold: true };
  totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
  for (const c of moneyCols) totalRow.getCell(c).numFmt = MONEY_FMT;

  if (total.gaps > 0) {
    sheet.addRow([]);
    const warn = sheet.addRow([
      `${total.gaps} return cost${total.gaps === 1 ? ' has' : 's have'} not been entered yet `
      + '(a repair invoice, or a supplier credit that has not landed). Return Cost is therefore a '
      + 'floor and Net GP an optimistic ceiling.',
    ]);
    warn.getCell(1).font = { size: 9, italic: true, color: { argb: 'FFB0500A' } };
    warn.getCell(1).alignment = { wrapText: true, vertical: 'top' };
    warn.height = 28;
  }

  sheet.columns.forEach((c, i) => { c.width = i === 0 ? 16 : (i === 15 ? 18 : 14); });
}

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
  unitsById?: Map<string, InventoryUnit>,
  unitsByImei?: Map<string, InventoryUnit>,
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
  // Say what this file is, on the sheet, where the person filling it in will
  // see it — not only in a document they may never open.
  const note = sheet.addRow([
    `This is a working sheet. Each marketplace tab has ${PRIMED_SALE_ROWS} blank rows under the data: `
    + 'type a Buy Price and a Sale Price and the whole row calculates in Excel, and the figures here '
    + 'follow. Leave the calculated columns alone — typing over one replaces live maths with a frozen '
    + 'number. Nothing reads this file back into the application; sales are recorded under Sell.',
  ]);
  note.getCell(1).font = { size: 9, italic: true, color: { argb: 'FF64748B' } };  // slate-500
  note.getCell(1).alignment = { wrapText: true, vertical: 'top' };
  note.height = 30;
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

  // Track sales whose IMEI has no matching inventory unit, per marketplace,
  // so the audit summary can call out "sold a phone that was never in stock".
  // Only meaningful when the builder was given inventory data — otherwise we
  // can't tell a missing unit from "no units loaded".
  const hasUnitData = (unitsById?.size ?? 0) > 0 || (unitsByImei?.size ?? 0) > 0;
  const noInvByMarket = new Map<Marketplace, Array<{ imei: string; order: string }>>();
  const hasUnitMatch = (s: Sale): boolean => {
    if (s.unitId && unitsById?.has(s.unitId)) return true;
    const k = (s.imei || '').trim().toUpperCase();
    return !!(k && unitsByImei?.has(k));
  };

  // One row per marketplace.
  const grand = { sales: 0, refunds: 0, replacements: 0, repairs: 0, gp: 0, loss: 0, netGp: 0, bp: 0 };
  const marketplaceRowNums: number[] = [];
  for (const m of MARKETPLACES) {
    const bucket = byMarketplace.get(m) ?? [];
    // Compute raw figures in JS (rather than cross-sheet formulas) so the
    // Summary tab reads correctly even before the operator clicks into a
    // marketplace tab to trigger ExcelJS lazy evaluation.
    let salesCount = 0, refundCount = 0, replaceCount = 0, repairCount = 0;
    let gp = 0, loss = 0, bp = 0;
    // Dedupe key for a return event so a single Process-Return click that
    // voided multiple linked Sale docs counts as ONE return event in this
    // marketplace's column, not N. Same logic as buildReturnsWorkbookBuffer's
    // Summary — keeps the Sales Report's marketplace tally consistent with
    // the Returns Report's headcount + Detail sheet's unique-unit rows.
    const seenVoidEvents = new Set<string>();
    const voidEventKey = (s: Sale): string => {
      const u = (s.unitId || '').trim() || (s.imei || '').trim().toUpperCase();
      return `${u}__${s.voidedAt || ''}`;
    };
    for (const s of bucket) {
      // "Sales" / Gross GP / BP are the active-sale figures — matching the
      // dashboard's ALL-TIME SOLD tile, which also excludes voided sales
      // (SellSheet.tsx). Voided sales fold their loss in via the separate
      // Refunds/Replacements/Repairs + Postage Loss columns instead of
      // being counted as a sale AND a return at once — before this fix
      // "Sales" silently included every voided row too (so a marketplace
      // with 20 sales and 2 refunds read "Sales: 20" instead of 18), and
      // Gross GP carried the voided rows' original margin, only partly
      // offset by Postage Loss rather than excluded outright.
      if (!s.voidedAt) {
        salesCount++;
        const sale = recomputeSale(s);
        gp += sale.grossProfit ?? 0;
        bp += s.buyPrice ?? 0;
      }
      // Flag active sales whose IMEI isn't in inventory (only when unit
      // data was actually supplied to the builder). Voided rows are skipped
      // — a missing unit there is expected (it may have been returned out).
      const saleImei = (s.imei || '').trim();
      if (saleImei && !s.voidedAt && hasUnitData && !hasUnitMatch(s)) {
        const list = noInvByMarket.get(m) ?? [];
        list.push({ imei: saleImei, order: s.orderNumber || '' });
        noInvByMarket.set(m, list);
      }
      if (s.voidedAt) {
        const key = voidEventKey(s);
        if (seenVoidEvents.has(key)) continue;  // sub-record of already-counted event
        seenVoidEvents.add(key);
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
    const row = sheet.addRow([m, null, null, null, null, null, null, null, null]);
    marketplaceRowNums.push(row.number);

    // Each cell is "what the application exported" plus "whatever the operator
    // has since typed into the blank rows on that tab".
    //
    // The baseline stays a JS-computed literal on purpose. These figures carry
    // semantics a spreadsheet formula cannot reproduce: Sales counts only
    // non-voided rows, and a return that voided several linked Sale docs at
    // once — one Process-Return click on a multi-handset order — counts as ONE
    // return event, not one per handset. Recomputing the whole column with
    // COUNTIF would quietly redefine both, and the Summary would stop agreeing
    // with the Returns Report and the dashboard. So the audited history is left
    // exactly as it was, and only the primed tail is added live.
    //
    // Consequence worth knowing: editing a row that was already in the file
    // moves that tab's TOTAL but not this figure. Adding a sale to the blank
    // rows — the thing this workbook is for — moves both.
    // Only three of these carry a live term, and that is not a shortcut.
    // A row typed into the blank tail is a NEW sale. It cannot have been
    // returned: refunds, replacements, repairs and the postage loss that comes
    // with them are produced by processing a return in the application, which
    // is also what writes those columns. So Refunds / Replacements / Repairs /
    // Postage Loss stay exactly what was exported, and Sales, Gross GP and the
    // BP denominator grow as rows get filled in.
    const r = summaryColRefs(m);
    const q = `'${m}'!`;
    const firstPrimed = bucket.length + 2;
    const lastPrimed = bucket.length + 1 + PRIMED_SALE_ROWS;
    const rng = (col: string) => `${q}$${col}$${firstPrimed}:$${col}$${lastPrimed}`;

    // COUNT counts numbers, so a guarded row that has not been touched — whose
    // cells evaluate to "" — is not a sale, and one with a price typed in is.
    row.getCell(2).value = { formula: `${salesCount}+COUNT(${rng(r.sp)})` };
    row.getCell(3).value = refundCount;
    row.getCell(4).value = replaceCount;
    row.getCell(5).value = repairCount;
    row.getCell(6).value = { formula: `${gp.toFixed(2)}+SUM(${rng(r.gp)})` };
    row.getCell(7).value = Number(loss.toFixed(2));
    // Net GP and Net GP % read this row's own cells, so they follow whichever
    // way the two above move.
    const gpCell = `F${row.number}`, lossCell = `G${row.number}`;
    row.getCell(8).value = { formula: `${gpCell}-${lossCell}` };
    row.getCell(9).value = {
      formula: `IFERROR((${gpCell}-${lossCell})/(${bp.toFixed(2)}+SUM(${rng(r.bp)}))*100,0)`,
    };
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

  // Grand total — sums the marketplace rows above rather than carrying its own
  // copy of the arithmetic, so it cannot disagree with them.
  const totalRow = sheet.addRow(['TOTAL', null, null, null, null, null, null, null, null]);
  const sumCol = (c: number) =>
    ({ formula: marketplaceRowNums.map(n => `${colLetter(c)}${n}`).join('+') });
  for (const c of [2, 3, 4, 5, 6, 7, 8]) totalRow.getCell(c).value = sumCol(c);
  totalRow.getCell(9).value = {
    formula: `IFERROR((F${totalRow.number}-G${totalRow.number})/(${grand.bp.toFixed(2)}`
      + `+${MARKETPLACES.map(m => {
        const bucket = byMarketplace.get(m) ?? [];
        const r = summaryColRefs(m);
        const f = bucket.length + 2, l = bucket.length + 1 + PRIMED_SALE_ROWS;
        return `SUM('${m}'!$${r.bp}$${f}:$${r.bp}$${l})`;
      }).join('+')})*100,0)`,
  };
  totalRow.font = { bold: true };
  totalRow.fill = {
    type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' },  // slate-200
  };
  for (const c of moneyCols) totalRow.getCell(c).numFmt = MONEY_FMT;

  // No-inventory-match callout — sales whose IMEI isn't in the inventory
  // collection. Surfaced prominently so the auditor/operator sees that some
  // sold units were never in stock (combined-IMEI bulk orders, tablet
  // serials, or units cleared in a wipe). Each is also amber-tinted +
  // tagged "[NO INVENTORY IMEI]" on its marketplace tab.
  const totalNoInv = [...noInvByMarket.values()].reduce((t, l) => t + l.length, 0);
  if (hasUnitData && totalNoInv > 0) {
    sheet.addRow([]);
    const calloutHeader = sheet.addRow([`⚠ Sales with no matching inventory IMEI: ${totalNoInv}`]);
    calloutHeader.font = { bold: true, color: { argb: 'FF92400E' } };  // amber-800
    calloutHeader.getCell(1).fill = {
      type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' },  // amber-100
    };
    sheet.addRow(['These IMEIs were sold but have no inventory unit. Add them as fresh stock — the import sync will then link + mark them sold. Rows are tagged "[NO INVENTORY IMEI]" and tinted amber on the marketplace tabs.']);
    const subHeader = sheet.addRow(['Marketplace', 'IMEI', 'Order Number']);
    subHeader.font = { bold: true };
    for (const m of MARKETPLACES) {
      const list = noInvByMarket.get(m) ?? [];
      for (const item of list) {
        sheet.addRow([m, item.imei, item.order]);
      }
    }
  }

  // Notes block — explains the leg model + why GP % differs from Gross GP / BP.
  sheet.addRow([]);
  const notesHeader = sheet.addRow(['Notes']);
  notesHeader.font = { bold: true };
  sheet.addRow(['• Refunds + Repairs + Return-to-Supplier each eat 2 shipping legs (outbound + inbound). Replacements eat 3 (plus the replacement outbound).']);
  sheet.addRow(['• Repair: the unit comes back to stock, but both carriage legs were still paid — so it carries the same 2-leg loss as a refund.']);
  sheet.addRow(['• Postage Loss = (postage + P.VAT) × legs, snapshotted at Process Return time.']);
  sheet.addRow(['• Net GP = Gross GP − Postage Loss. Net GP % = Net GP ÷ BP (× 100). eBay rows divide by SP per platform convention.']);
  sheet.addRow(['• Sales / Gross GP / BP above count ACTIVE sales only — matching the app\'s ALL-TIME SOLD figure. Refunds, Replacements and Repairs are tracked separately in the columns to the left; add them to Sales for this sheet\'s row count on each marketplace tab.']);
  sheet.addRow(['• Per-marketplace sheets carry a TOTAL row at the bottom summing every row shown there (active + returned) via SUM formulas — the Returns tab breaks the returned rows out on their own.']);
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
      accessoryStock: input.accessoryStock,
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
  /** Accessory SKU pools — lets Sheet 2's orphan fallback recognise a
   *  voided accessory sale (no unitId/IMEI by design) as a genuine
   *  "Accessory" return row instead of silently dropping it, and resolves
   *  the SKU to its friendly display name for the Model column. */
  accessoryStock?: AccessoryStock[];
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
  const wb = new ExcelJS.Workbook();
  writeReturnsSheets(wb, input);
  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

/**
 * Write the Summary / Returns Detail / Unit Histories sheets onto a
 * caller-supplied workbook. Shared by the standalone Returns Report
 * (buildReturnsWorkbookBuffer, above — Summary sheet named 'Summary') and
 * the Sales Report (buildSalesWorkbookBuffer, further above — 'Returns
 * Summary', since the Sales Report already has its own top-level 'Summary'
 * sheet and ExcelJS worksheet names must be unique per workbook).
 */
function writeReturnsSheets(
  wb: ExcelJS.Workbook,
  input: BuildReturnsWorkbookInput,
  summarySheetName: string = 'Summary',
): void {
  const { units, sales, supplierMap, opts, accessoryStock } = input;

  // sku (case/whitespace-normalised) → friendly display name, so an orphan
  // accessory-sale row shows "USB-C 20W Charger" rather than a raw SKU.
  const accessoryNameBySku = new Map<string, string>();
  for (const a of accessoryStock ?? []) {
    const k = (a.sku || '').trim().toUpperCase();
    if (k) accessoryNameBySku.set(k, a.name || a.sku);
  }

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

  // Dedupe key for a return EVENT — one Process-Return click is one event,
  // even when it voids multiple linked Sale docs. ProcessReturnModal voids
  // every active sale linked to the unit at the moment the operator confirms,
  // and replacement units inherit the original sale's financials which means
  // a single click frequently lands voidedAt on 2+ sales (the replacement
  // sub-record on Replacement, the imported + in-app duplicate on RTS, etc.).
  // Without dedupe the Summary headcount over-reports by the number of those
  // sub-records — Refunds/Replacements/Repairs each inflate while the Detail
  // sheet (one row per unit) stays correct. Key by unitId (preferred) or IMEI
  // fallback, plus voidedAt (day-granularity), so a true multi-cycle return
  // on DIFFERENT dates still counts as N events.
  const eventKey = (s: Sale): string => {
    const u = (s.unitId || '').trim() || (s.imei || '').trim().toUpperCase();
    return `${u}__${s.voidedAt || ''}`;
  };
  const seenEventKeys = new Set<string>();

  for (const s of voidedSalesInRange) {
    if (s.unitId) seenUnitIds.add(s.unitId);
    const key = eventKey(s);
    if (seenEventKeys.has(key)) continue;  // sub-record of an already-counted event
    seenEventKeys.add(key);
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

  const summary = wb.addWorksheet(summarySheetName);
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
    // Appended at the END, deliberately: parseReturnsTab reads this sheet by
    // header name with no positional fallback, and older files simply lack
    // the column — both stay true only if nothing before it moves.
    'Fee Loss £',
    // The other half of the unit's story: it came back on Return Date, but it
    // was bought on Stock In Date, and the operator asked for the pair to be
    // visible together wherever a returned unit is shown. Same append-only
    // rule as above.
    'Stock In Date',
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
    // What the channel kept. Sale-derived, so a legacy row with no linked
    // voided Sale shows blank rather than a guessed zero.
    const feeLoss = voided ? feeLossOnRefund(voided) : 0;

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
      feeLoss > 0 ? feeLoss : null,
      u.dateIn ? toDate(u.dateIn) : null,
    ]);
    row.getCell(1).numFmt = DATE_FMT;     // Return Date
    row.getCell(2).numFmt = IMEI_FMT;     // IMEI
    row.getCell(7).numFmt = DATE_FMT;     // Original Sale Date
    row.getCell(8).numFmt = MONEY_FMT;    // Sale Price
    row.getCell(14).numFmt = MONEY_FMT;   // Leg Cost £
    row.getCell(16).numFmt = MONEY_FMT;   // Postage Loss £
    row.getCell(17).numFmt = MONEY_FMT;   // Fee Loss £
    row.getCell(18).numFmt = DATE_FMT;    // Stock In Date

    // Voided / returned rows get the same rose fill the Sales workbook
    // uses on every voided line — operator's eye picks them out at a
    // glance. Applied across every cell so the fill covers the row.
    for (let col = 1; col <= DETAIL_HEADERS.length; col++) {
      row.getCell(col).fill = RETURNED_FILL;
    }
  }

  // Sales-driven fallback: a voided sale in range whose unit carries no
  // returnType on file — the unit was deleted (the incident this whole
  // restore feature exists for: staff using "Delete Unit" instead of
  // "Process Return" erases the return markers entirely) or was never
  // linked to begin with. Without this, the return silently disappears
  // from this sheet even though Sheet 1's event count still includes it,
  // and a re-upload of this exact workbook could never reconstruct it
  // (see restoreUnitReturnFromImport in inventoryService.ts). Return Type
  // is left BLANK here — never guessed, same caution as the rest of the
  // returns write surface — which doubles as the visible signal that this
  // row needs a manual Process Return once the unit is back on file.
  const representedUnitIds = new Set(returnedInRange.map(u => u.id));
  const orphanBySaleKey = new Map<string, Sale>();
  for (const s of voidedSalesInRange) {
    const u = (s.unitId && unitsByIdRet.get(s.unitId))
      || (s.imei && unitsByImeiRet.get((s.imei || '').trim().toUpperCase()))
      || undefined;
    if (u && representedUnitIds.has(u.id)) continue; // already covered above
    // Accessory sales carry neither unitId nor IMEI by design (no-serial
    // pooled stock) — fall back to the SKU, but only when it resolves to a
    // genuine accessory pool, so a malformed/unlinked UNIT sale (bad data,
    // not an accessory) doesn't get silently relabelled as one.
    const skuKey = (s.sku || '').trim().toUpperCase();
    // Narrower than the shared isAccessorySale(): that one asks only whether
    // the row lacks both identifiers, which is the right test for charging
    // the box-and-charger fee. Here we additionally require the SKU to
    // resolve to a real accessory pool, because keying an orphan row on a
    // SKU is only safe when the SKU is known to be one.
    const isKnownAccessorySale = isAccessorySale(s) && accessoryNameBySku.has(skuKey);
    const key = (s.unitId || '').trim() || (s.imei || '').trim().toUpperCase()
      || (isKnownAccessorySale ? `sku:${skuKey}` : '');
    if (!key) continue; // nothing stable to key an orphan row on
    const existing = orphanBySaleKey.get(key);
    if (!existing || (s.voidedAt || '') > (existing.voidedAt || '')) orphanBySaleKey.set(key, s);
  }
  const orphanSorted = Array.from(orphanBySaleKey.values()).sort(
    (a, b) => (b.voidedAt || '').localeCompare(a.voidedAt || ''),
  );
  for (const s of orphanSorted) {
    const outcome = s.voidOutcome ?? 'refund';
    const legs = shippingLegsFor(s);
    const loss = postageLossFor(s);
    const legCost = legs > 0 ? loss / legs : 0;
    const accessoryName = !s.unitId && !(s.imei || '').trim()
      ? accessoryNameBySku.get((s.sku || '').trim().toUpperCase())
      : undefined;
    const row = detail.addRow([
      s.voidedAt ? toDate(s.voidedAt) : null,
      s.imei || '',
      accessoryName || s.model || s.sku || '',
      '',
      '',
      s.supplierName || '',
      s.saleDate ? toDate(s.saleDate) : null,
      s.salePrice ?? null,
      s.marketplace ?? '',
      accessoryName ? 'Accessory' : '',   // Return Type — unknown for a true unit orphan, never guessed
      outcomeText(outcome),
      s.voidReason || '',
      s.comments || '',
      legCost > 0 ? legCost : null,
      legs > 0 ? legs : null,
      loss > 0 ? loss : null,
    ]);
    row.getCell(1).numFmt = DATE_FMT;
    row.getCell(2).numFmt = IMEI_FMT;
    row.getCell(7).numFmt = DATE_FMT;
    row.getCell(8).numFmt = MONEY_FMT;
    row.getCell(14).numFmt = MONEY_FMT;
    row.getCell(16).numFmt = MONEY_FMT;
    for (let col = 1; col <= DETAIL_HEADERS.length; col++) {
      row.getCell(col).fill = RETURNED_FILL;
    }
  }

  // Empty-state hint — a bare header row reads as "broken" to an operator
  // (is the sheet not loading, or is there genuinely nothing to show?).
  // Distinguishes the two real empty causes: no voided sales in range at
  // all, vs. returns exist but haven't been through Process Return / a
  // restoring re-import yet (so no InventoryUnit or Sale has fired the
  // rows above).
  if (detailSorted.length === 0 && orphanSorted.length === 0) {
    const row = detail.addRow([
      voidedSalesInRange.length > 0
        ? 'Returns are recorded on the Sales side, but no unit has a Return Type on file yet — process the return, or re-upload a Sales Report with its Returns Detail filled in, to populate this row.'
        : 'No returns recorded for this period.',
    ]);
    row.getCell(1).font = { italic: true, color: { argb: 'FF64748B' } };  // slate-500
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

  // Same empty-state reasoning as Returns Detail above — this sheet is
  // strictly unit-driven (historyUnits requires returnType + returnDate on
  // file), so it can legitimately show nothing even when Returns Detail
  // has rows via its sales-driven orphan fallback.
  if (allEvents.length === 0) {
    const row = histories.addRow([
      voidedSalesInRange.length > 0
        ? 'Returns are recorded on the Sales side, but no unit has a Return Type on file yet — process the return, or re-upload a Sales Report with its Returns Detail filled in, to populate a history here.'
        : 'No unit return history to show for this period.',
    ]);
    row.getCell(1).font = { italic: true, color: { argb: 'FF64748B' } };  // slate-500
  }
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
