/**
 * inventoryImportParse.ts — the stock-report parser, on its own.
 *
 * Lifted out of InventoryReportImport so the parsing contract can be tested
 * without mounting the modal (which drags in Firestore, the live store and
 * React). The component keeps the preview/write logic; everything from
 * "here is a workbook" to "here are typed rows" lives here.
 *
 * Schema (header names are matched by alias, not position):
 *
 *   Stock In Date · Model · IMEI · Grade · Storage · SIM Type · Colour ·
 *   Supplier · BP · Stock Type · Notes
 *
 * Stock Type is how supplier-held (SHS) stock arrives by report. 'SHS' /
 * 'INCOMING' / 'SUPPLIER' mean the supplier still holds the unit; anything
 * else, including a blank, is office stock, so files predating the column
 * keep importing unchanged.
 */
import * as XLSX from 'xlsx';
import { isAppleDevice, isValidImei } from './imeiValidation';

export interface ParsedRow {
  rowNum: number;          // 1-indexed row in the file (header is 0)
  dateIn: string;          // ISO YYYY-MM-DD; empty if missing
  model: string;
  imei: string;            // trimmed, uppercased
  grade: string;
  storage: string;
  simType: string;         // Physical SIM / eSIM / Dual SIM / Not Applicable
  colour: string;
  supplier: string;        // raw supplier name string
  buyPrice: number;        // parsed numeric; 0 if missing
  stockType: 'office' | 'shs';   // 'shs' = supplier-held, lands as incoming
  notes: string;
  errors: string[];        // per-row validation messages
}

type ParsedField = keyof Omit<ParsedRow, 'rowNum' | 'errors'>;

// ── Header alias table — case-insensitive, whitespace-tolerant ──────────────
// Maps every reasonable column-name variant the operator might paste into the
// canonical field name. Anything not in this map gets ignored on import.
export const HEADER_ALIASES: Record<string, ParsedField> = {
  'stock in date': 'dateIn',
  'stockindate':   'dateIn',
  'stock in':      'dateIn',
  'date in':       'dateIn',
  'datein':        'dateIn',
  'date':          'dateIn',
  'model':         'model',
  'imei':          'imei',
  'serial':        'imei',
  'imei/serial':   'imei',
  'imei / serial': 'imei',
  'grade':         'grade',
  'storage':       'storage',
  'sim type':      'simType',
  'simtype':       'simType',
  'sim':           'simType',
  'colour':        'colour',
  'color':         'colour',
  'supplier':      'supplier',
  'stock type':    'stockType',
  'stocktype':     'stockType',
  'stock status':  'stockType',
  'shs':           'stockType',
  'holding':       'stockType',
  'bp':            'buyPrice',
  'bp (£)':        'buyPrice',
  'buy price':     'buyPrice',
  'buying price':  'buyPrice',
  'notes':         'notes',
  'note':          'notes',
};

export function normalizeHeader(h: string): string {
  return String(h ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function excelSerialToISO(v: any): string {
  if (!v) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') {
    try {
      const d = XLSX.SSF.parse_date_code(v);
      return new Date(Date.UTC(d.y, d.m - 1, d.d)).toISOString().slice(0, 10);
    } catch { /* fall through */ }
  }
  const s = String(v).trim();
  if (!s) return '';
  // ISO-ish — accept as-is
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return '';
}

export function parseNumber(v: any): number {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const cleaned = String(v).replace(/[£,\s]/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/** True when a sheet's header row names both columns every stock row needs.
 *  Lets a multi-sheet workbook carry Summary / Notes tabs without every one
 *  of their rows landing in the invalid bucket. */
export function looksLikeStockSheet(rows: any[][]): boolean {
  if (!rows.length) return false;
  const headers = (rows[0] ?? []).map(normalizeHeader);
  return headers.some(h => HEADER_ALIASES[h] === 'imei')
      && headers.some(h => HEADER_ALIASES[h] === 'model');
}

export function parseSheet(rows: any[][], rowNumOffset = 0): ParsedRow[] {
  if (rows.length < 2) return [];
  const headerRow = rows[0].map(normalizeHeader);
  const colIndex: Partial<Record<ParsedField, number>> = {};
  headerRow.forEach((h: string, i: number) => {
    const field = HEADER_ALIASES[h];
    if (field && colIndex[field] === undefined) colIndex[field] = i;
  });

  const result: ParsedRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.every(c => c == null || String(c).trim() === '')) continue; // skip blank
    const get = (k: ParsedField) => {
      const idx = colIndex[k];
      return idx === undefined ? '' : r[idx];
    };
    const dateIn   = excelSerialToISO(get('dateIn'));
    const model    = String(get('model') ?? '').trim();
    const imei     = String(get('imei') ?? '').trim().toUpperCase();
    const grade    = String(get('grade') ?? '').trim();
    const storage  = String(get('storage') ?? '').trim();
    const simType  = String(get('simType') ?? '').trim();
    const colour   = String(get('colour') ?? '').trim();
    const supplier = String(get('supplier') ?? '').trim();
    const buyPrice = parseNumber(get('buyPrice'));
    const notes    = String(get('notes') ?? '').trim();
    // Supplier-held stock. Accept the words operators actually type, plus
    // a bare Y/YES under an "SHS" header. Anything else is office stock.
    const stockTypeRaw = String(get('stockType') ?? '').trim().toUpperCase();
    const stockType: 'office' | 'shs' =
      /^(SHS|INCOMING|SUPPLIER|SUPPLIER HELD|SUPPLIER-HELD|Y|YES|TRUE|1)$/.test(stockTypeRaw)
        ? 'shs' : 'office';

    const errors: string[] = [];
    if (!model)     errors.push('Model is required');
    if (!imei)      errors.push('IMEI is required');
    else {
      const apple = isAppleDevice(model);
      if (!isValidImei(imei, { isAppleSerial: apple })) errors.push('IMEI not valid (15 digits, or 10-12 char alphanumeric serial)');
    }
    if (!supplier)  errors.push('Supplier is required');
    if (buyPrice <= 0) errors.push('BP must be greater than 0');

    result.push({ rowNum: rowNumOffset + i + 1, dateIn, model, imei, grade, storage, simType, colour, supplier, buyPrice, stockType, notes, errors });
  }
  return result;
}

export interface ParsedWorkbook {
  rows: ParsedRow[];
  /** Sheets whose header row named no stock columns — reported, not parsed. */
  skippedSheets: string[];
}

/**
 * Read EVERY stock sheet in a workbook, not just the first.
 *
 * The Inventory Report this importer is the counterpart to downloads as TWO
 * sheets — Office Stock and SHS Stock — so reading only `SheetNames[0]`
 * silently dropped every supplier-held row on the way back in, breaking the
 * export → edit → re-import loop the templates README promises.
 */
export function parseStockWorkbook(wb: XLSX.WorkBook): ParsedWorkbook {
  const rows: ParsedRow[] = [];
  const skippedSheets: string[] = [];
  for (const sheetName of wb.SheetNames) {
    const sheetRows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[sheetName], {
      header: 1, raw: true, defval: '',
    });
    if (!looksLikeStockSheet(sheetRows)) { skippedSheets.push(sheetName); continue; }
    rows.push(...parseSheet(sheetRows, rows.length));
  }
  return { rows, skippedSheets };
}
