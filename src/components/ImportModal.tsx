import React, { useState, useRef, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { X, Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, Loader2, ArrowRight, Download } from 'lucide-react';
import { motion } from 'motion/react';
import { dbService } from '../lib/dbService';
import { DeviceCategory, InventoryAggregate, InventoryUnit, Supplier } from '../types';
import { buildStableUnitId } from '../lib/inventoryMaintenance';
import { uploadSourceAttachment } from '../lib/fileAttachments';
import { logInventoryEvent } from '../lib/inventoryEvents';

interface ImportModalProps { onClose: () => void; }

// ── Shared helpers ────────────────────────────────────────────────────────────

function excelSerialToISO(serial: any): string {
  if (!serial) return new Date().toISOString().split('T')[0];
  if (serial instanceof Date) return serial.toISOString().split('T')[0];
  if (typeof serial === 'number') {
    try {
      const date = XLSX.SSF.parse_date_code(serial);
      return new Date(Date.UTC(date.y, date.m - 1, date.d)).toISOString().split('T')[0];
    } catch { /* fall through */ }
  }
  if (typeof serial === 'string') {
    const d = new Date(serial);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  }
  return new Date().toISOString().split('T')[0];
}

/**
 * parseQuantityCell — INVENTORY-sheet QUANTITY column is mixed-type:
 * numeric values, "SHS" placeholders, "NO STOCK" tags, blanks, etc.
 *
 * Returns either:
 *   - `{ qty: number }`                                              when numeric
 *   - `{ qty: undefined; flag: 'SHS'|'NO_STOCK'|'OTHER'; raw }`      when non-numeric
 *
 * Callers should keep the row in either case (B8 fix — non-numeric
 * QUANTITY rows used to be silently dropped at the BP guard).
 */
export function parseQuantityCell(
  v: unknown,
):
  | { qty: number; flag?: undefined }
  | { qty: undefined; flag: 'SHS' | 'NO_STOCK' | 'OTHER'; raw: string } {
  // Native numbers (incl. 0) come through unchanged.
  if (typeof v === 'number' && Number.isFinite(v)) return { qty: v };

  const raw = (v == null ? '' : String(v)).trim();
  const upper = raw.toUpperCase();

  if (upper === 'SHS')                              return { qty: undefined, flag: 'SHS',      raw };
  if (upper === 'NO STOCK' || upper === 'NOSTOCK')  return { qty: undefined, flag: 'NO_STOCK', raw };

  // Numeric-string path — but only if the entire string parses as a number,
  // so "12 SOLD" doesn't sneak through as `12`.
  if (raw !== '' && /^-?\d+(\.\d+)?$/.test(raw)) {
    const n = parseFloat(raw);
    if (Number.isFinite(n)) return { qty: n };
  }

  return { qty: undefined, flag: 'OTHER', raw };
}

/**
 * parseSupplierCell — INVENTORY-sheet SUPPLIER column may list multiple
 * suppliers separated by " / " (e.g. "MHL / ABC / NIHAL"). Returns the
 * primary (first) name and the full list with empties dropped.
 *
 * B7 fix — caller previously did `.split('/')[0]` and dropped the rest.
 */
export function parseSupplierCell(
  v: unknown,
): { primaryName: string; allNames: string[] } {
  const raw = (v == null ? '' : String(v)).trim();
  if (!raw) return { primaryName: '', allNames: [] };
  const allNames = raw
    .split('/')
    .map(s => s.trim())
    .filter(s => s.length > 0);
  return { primaryName: allNames[0] || '', allNames };
}

function parseCategory(model: string): DeviceCategory {
  const m = model.toUpperCase();
  if (m.includes('IPAD')) return 'iPad';
  if (m.includes('APPLE WATCH') || m.includes('WATCH ULTRA') || m.includes('WATCH SE')) return 'Apple Watch';
  if (m.includes('IPHONE')) return 'iPhone';
  if (/GALAXY TAB|TAB A\d|TAB S\d/.test(m)) return 'Tablet';
  if (m.includes('SAMSUNG') || m.includes('GALAXY'))
    return /\bA\d{2,3}\b|GALAXY A/.test(m) ? 'Samsung A Series' : 'Samsung S Series';
  return 'Other';
}

function parseBrand(category: DeviceCategory): string {
  if (['iPhone', 'iPad', 'Apple Watch'].includes(category)) return 'Apple';
  if (['Samsung S Series', 'Samsung A Series', 'Tablet'].includes(category)) return 'Samsung';
  return 'Other';
}

// Preserve IMEIs verbatim: client data includes alphanumeric Apple serials
// (e.g. "NL6CMQCYTD", "SKC9P3QVP6F"), so we MUST NOT strip non-digits.
function normalizeImei(imei: string) {
  return String(imei ?? '').trim().replace(/^["'\s]+|["'\s]+$/g, '');
}

// Parse "BLACK 3 GREY 1" → [{colour:'Black', qty:3}, {colour:'Grey', qty:1}]
function parseColourStr(s: string): Array<{ colour: string; qty: number }> {
  if (!s) return [];
  const cleaned = String(s).replace(/(\d+)B\b/gi, '$1');
  const matches = [...cleaned.matchAll(/([A-Za-z][A-Za-z\s]*?)(\d+)/g)];
  return matches
    .map(m => ({ colour: m[1].trim(), qty: parseInt(m[2]) }))
    .filter(c => c.colour && c.qty > 0);
}

/**
 * `InventoryAggregate` row as emitted by the parser — `supplierIds` here is
 * the parser's best guess (one synthetic id per supplier name); the bulk-write
 * step is responsible for re-mapping these to the real `suppliers` doc ids.
 * `supplierNames` is the original list, preserved so the upsert step can match.
 */
export type ParsedAggregate = Omit<InventoryAggregate, 'createdAt' | 'updatedAt'> & {
  supplierNames: string[];
};

interface ParsedData {
  suppliers: Omit<Supplier, 'createdAt'>[];
  units: Omit<InventoryUnit, 'createdAt'>[];
  /** INVENTORY-sheet roll-up rows (one per Model+Supplier) — populated by
   *  parseClientBulkSheet; empty for IMEI-per-row imports. */
  aggregates?: ParsedAggregate[];
  /** Sales rows parsed from the SALES_REPORT sheet, if present. Wired through
   *  to `dbService.bulkUpsertSales` by handleImport — see B9 follow-up. */
  sales?: Array<Record<string, any> & { marketplace: string; orderNumber: string }>;
  stats: { total: number; available: number; sold: number; incoming: number; skipped: number; duplicateRows: number };
  format: 'client-bulk' | 'imei-per-row';
  /** Stamped by processFile (not by the parsers themselves) so the importBatch
   *  audit row carries the workbook's actual sheet name. */
  sheetName?: string;
  /** Best-effort supplier id when the workbook is single-supplier (e.g. the
   *  SUPPLIER WHATSAPP UPDATES sheets); undefined for mixed-supplier imports. */
  detectedSupplierId?: string;
  /** Short human-readable summary used as the importBatch.notes field. */
  summary?: string;
}

// ── Format detection ──────────────────────────────────────────────────────────

function detectFormat(headers: string[]): 'client-bulk' | 'imei-per-row' {
  const h = headers.map(x => String(x || '').toUpperCase()).join(' ');
  if ((h.includes('QUANTITY') || h.includes('QTY')) && h.includes('COLOUR')) return 'client-bulk';
  return 'imei-per-row';
}

// ── Parser A: Client bulk format (MODEL · BP · QTY · COLOURS · SUPPLIER · NOTES) ──

function parseClientBulkSheet(rows: any[][]): ParsedData {
  const header = (rows[0] || []).map((h: any) => String(h || '').trim().toUpperCase());
  const col = (names: string[]) =>
    header.findIndex((h: string) => names.some(n => h.includes(n.toUpperCase())));

  const modelIdx    = col(['MODEL', 'DESCRIPTION', 'DEVICE']);
  const bpIdx       = col(['BP', 'BUY PRICE', 'PRICE', 'COST']);
  const qtyIdx      = col(['QUANTITY', 'QTY']);
  const colourIdx   = col(['COLOUR', 'COLOR']);
  const supplierIdx = col(['SUPPLIER', 'SOURCE']);
  const notesIdx    = col(['NOTES', 'NOTE', 'REMARK']);

  const dateIn = new Date().toISOString().split('T')[0];
  const supplierMap = new Map<string, Omit<Supplier, 'createdAt'>>();
  const units: Omit<InventoryUnit, 'createdAt'>[] = [];
  const aggregates: ParsedAggregate[] = [];
  let skipped = 0;
  let uid = 1;
  let aggUid = 1;

  // Map supplier display-name → synthetic id (kept stable across the sheet).
  const supplierIdFor = (name: string): string => {
    const key = (name || 'UNKNOWN').toUpperCase();
    const id  = `sup_${key.replace(/\s+/g, '_').toLowerCase()}`;
    if (!supplierMap.has(id))
      supplierMap.set(id, { id, name: name || 'Unknown', portal: 'Wholesale', ownerId: 'shared' });
    return id;
  };

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const model      = modelIdx >= 0 ? String(r[modelIdx] || '').trim() : '';
    const bpRaw      = bpIdx >= 0 ? r[bpIdx] : 0;
    const qtyRawCell = qtyIdx >= 0 ? r[qtyIdx] : '';
    const qtyParsed  = parseQuantityCell(qtyRawCell);
    const colours    = colourIdx >= 0 ? String(r[colourIdx] || '').trim() : '';
    const supplierCell = supplierIdx >= 0 ? r[supplierIdx] : '';
    const supParsed  = parseSupplierCell(supplierCell);
    const notes      = notesIdx >= 0 ? String(r[notesIdx] || '').trim() : '';

    if (!model || /^(model|total|#)/i.test(model)) { skipped++; continue; }
    const bp = parseFloat(String(bpRaw)) || 0;

    // B8 fix: do NOT drop rows with non-numeric QUANTITY. The row still has
    // useful provenance (model/supplier/notes flag) — emit an aggregate row
    // and skip unit synthesis. Numeric rows with no BP are still data errors.
    const isSHS      = qtyParsed.qty === undefined && qtyParsed.flag === 'SHS';
    const isNumeric  = qtyParsed.qty !== undefined;

    if (!isNumeric && !isSHS) {
      // Non-numeric, non-SHS (e.g. "NO STOCK", blank, "OTHER"): capture as
      // an InventoryAggregate so downstream can decide what to do with it.
      aggregates.push({
        id: `agg_${aggUid++}`,
        model,
        ...(bp ? { buyPrice: bp } : {}),
        quantityText: qtyParsed.raw,
        ...(colours ? { coloursRaw: colours } : {}),
        supplierIds: supParsed.allNames.map(supplierIdFor),
        supplierNames: supParsed.allNames,
        ...(notes ? { notes } : {}),
        sourceRow: i,
        ownerId: 'shared',
      });
      continue;
    }

    if (!bp && !isSHS) { skipped++; continue; }

    const category = parseCategory(model);
    const brand    = parseBrand(category);

    // B7 fix: support "MHL / ABC / NIHAL" — primary supplier drives the legacy
    // supplierId field; the full list is preserved in supplierIds.
    const primaryName = supParsed.primaryName;
    const supplierId  = supplierIdFor(primaryName);
    const supplierIds = supParsed.allNames.length > 0
      ? supParsed.allNames.map(supplierIdFor)
      : [supplierId];

    // Also emit an aggregate roll-up so the INVENTORY-sheet shape is preserved.
    const coloursMap: { [c: string]: number } = {};
    for (const c of parseColourStr(colours)) coloursMap[c.colour] = c.qty;
    aggregates.push({
      id: `agg_${aggUid++}`,
      model,
      ...(bp ? { buyPrice: bp } : {}),
      ...(isNumeric ? { quantityNum: qtyParsed.qty as number } : {}),
      ...(isSHS ? { quantityText: 'SHS' } : {}),
      ...(Object.keys(coloursMap).length ? { coloursMap } : {}),
      ...(colours ? { coloursRaw: colours } : {}),
      supplierIds,
      supplierNames: supParsed.allNames,
      ...(notes ? { notes } : {}),
      sourceRow: i,
      ownerId: 'shared',
    });

    if (isSHS) {
      const parsed = parseColourStr(colours);
      const colourList = parsed.length ? parsed.map(c => c.colour) : ['Unknown'];
      for (const colour of colourList) {
        units.push({
          id: `import_shs_${uid++}`, imei: `SHS_import_${uid}`,
          model, brand, category, colour, buyPrice: bp,
          dateIn, supplierId, supplierIds, supplierName: primaryName, status: 'incoming',
          flags: [], notes: `SHS — Expected${notes ? ' · ' + notes : ''}`,
          platformListed: false, listingSites: [], ownerId: 'shared',
        });
      }
    } else {
      const parsed = parseColourStr(colours);
      const colourList: string[] = parsed.length
        ? parsed.flatMap(c => Array(c.qty).fill(c.colour))
        : [colours || 'Unknown'];

      for (const colour of colourList) {
        units.push({
          id: `import_${uid++}`, imei: `PENDING_import_${uid}`,
          model, brand, category, colour, buyPrice: bp,
          dateIn, supplierId, supplierIds, supplierName: primaryName, status: 'available',
          flags: [], notes: notes || '',
          platformListed: false, listingSites: [], ownerId: 'shared',
        });
      }
    }
  }

  const available = units.filter(u => u.status === 'available').length;
  const incoming  = units.filter(u => u.status === 'incoming').length;

  return {
    suppliers: Array.from(supplierMap.values()),
    units,
    aggregates,
    stats: { total: units.length, available, sold: 0, incoming, skipped, duplicateRows: 0 },
    format: 'client-bulk',
  };
}

// ── Parser B: Master sheet / IMEI-per-row format ─────────────────────────────
// Canonical 14-column format:
//   Date In · Model · IMEI · Supplier · Buy Price · Colour · Storage ·
//   Status · Sale Platform · Sale Price · Sale Date · Sale Order ID ·
//   Postage Cost · Notes

function parseOGStockSheet(rows: any[][]): ParsedData {
  const header = rows[0] || [];
  const findCol = (names: string[]) =>
    header.findIndex((h: any) => names.some(n => h?.toString().toUpperCase().includes(n.toUpperCase())));

  // Required columns — fall back to positional index for legacy headerless sheets
  const dateInIdx    = Math.max(findCol(['Date In', 'Stock In', 'Received']), 0);
  const modelIdx     = Math.max(findCol(['Model', 'Device', 'Description']), 1);
  const imeiIdx      = Math.max(findCol(['IMEI', 'Serial', 'S/N']), 2);
  const supplierIdx  = Math.max(findCol(['Supplier', 'Source', 'From']), 3);
  const buyPriceIdx  = Math.max(findCol(['Buy Price', 'BP', 'Cost']), 4);
  const statusIdx    = Math.max(findCol(['Status', 'State']), 5);
  // Optional columns — -1 if absent
  const colourIdx      = findCol(['Colour', 'Color']);
  const storageIdx     = findCol(['Storage', 'Capacity']);
  const platformIdx    = findCol(['Sale Platform', 'Platform', 'Listed']);
  const salePriceIdx   = findCol(['Sale Price', 'Price Sold', 'SP']);
  const saleDateIdx    = findCol(['Sale Date', 'Date Sold', 'Sold Date']);
  const saleOrderIdx   = findCol(['Sale Order ID', 'Order ID', 'Order Number', 'Order No']);
  const postageCostIdx = findCol(['Postage Cost', 'Postage', 'Shipping']);
  const notesIdx       = findCol(['Notes', 'Note', 'Remark']);

  const supplierMap = new Map<string, Omit<Supplier, 'createdAt'>>();
  const unitMap     = new Map<string, Omit<InventoryUnit, 'createdAt'>>();
  const seenImeis   = new Set<string>();
  let skipped = 0, duplicateRows = 0;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const model = r[modelIdx]?.toString().trim();
    if (!model || /^(model|total|#)/i.test(model)) { skipped++; continue; }

    // Cast IMEI cell to string explicitly so a 15-digit number doesn't become "1.23e+14"
    const imei         = r[imeiIdx] === undefined || r[imeiIdx] === null
      ? ''
      : (typeof r[imeiIdx] === 'number'
          ? Number.isInteger(r[imeiIdx]) ? r[imeiIdx].toFixed(0) : String(r[imeiIdx])
          : String(r[imeiIdx])).trim();
    const supplierName = r[supplierIdx]?.toString().trim() || 'Unknown';
    const buyPrice     = parseFloat(r[buyPriceIdx]) || 0;
    const colour       = colourIdx >= 0 && r[colourIdx] ? r[colourIdx].toString().trim() : 'Unknown';
    const storage      = storageIdx >= 0 && r[storageIdx] ? r[storageIdx].toString().trim() : undefined;
    const notes        = notesIdx >= 0 && r[notesIdx] ? r[notesIdx].toString().trim() : '';

    const statusRaw = r[statusIdx]?.toString().trim().toUpperCase();
    const status: InventoryUnit['status'] =
      statusRaw === 'SOLD'                          ? 'sold' :
      statusRaw === 'INCOMING' || statusRaw === 'SHS' ? 'incoming' :
      'available';

    const salePlatform  = platformIdx  >= 0 ? r[platformIdx]?.toString().trim()  || '' : '';
    const salePrice     = salePriceIdx >= 0 ? parseFloat(r[salePriceIdx])        || 0  : 0;
    const saleOrderId   = saleOrderIdx >= 0 ? r[saleOrderIdx]?.toString().trim() || '' : '';
    const postageCost   = postageCostIdx >= 0 && r[postageCostIdx]
      ? parseFloat(r[postageCostIdx]) : undefined;

    const dateIn  = excelSerialToISO(r[dateInIdx]);
    const saleDate = status === 'sold' && saleDateIdx >= 0 && r[saleDateIdx]
      ? excelSerialToISO(r[saleDateIdx]) : dateIn;

    const supplierId = `sup_${supplierName.replace(/\s+/g, '_').toLowerCase()}`;
    if (!supplierMap.has(supplierId))
      supplierMap.set(supplierId, { id: supplierId, name: supplierName, portal: 'Direct', ownerId: 'shared' });

    const category    = parseCategory(model);
    const brand       = parseBrand(category);
    const cleanedImei = normalizeImei(imei);
    // Non-SHS with any non-empty IMEI/serial → use it as ID (alphanumeric Apple serials accepted)
    const unitId    = cleanedImei ? cleanedImei : buildStableUnitId({ imei, model, dateIn, supplierId, buyPrice, status });
    const dedupeKey = cleanedImei || unitId;

    if (seenImeis.has(dedupeKey)) { duplicateRows++; }
    seenImeis.add(dedupeKey);

    unitMap.set(dedupeKey, {
      id: unitId, imei, model, brand, category,
      colour, buyPrice, dateIn, supplierId, status,
      flags: [], notes,
      ...(storage      ? { storage }      : {}),
      ...(postageCost  !== undefined ? { postageCost } : {}),
      platformListed: status === 'available' && !!salePlatform,
      listingSites:   salePlatform ? [salePlatform as any] : [],
      ownerId: 'shared',
      ...(status === 'sold' ? {
        saleDate,
        ...(salePlatform ? { salePlatform }   : {}),
        ...(salePrice    ? { salePrice }       : {}),
        ...(saleOrderId  ? { saleOrderId }     : {}),
      } : {}),
    });
  }

  const units    = Array.from(unitMap.values());
  const available = units.filter(u => u.status === 'available').length;
  const sold      = units.filter(u => u.status === 'sold').length;
  const incoming  = units.filter(u => u.status === 'incoming').length;

  return {
    suppliers: Array.from(supplierMap.values()),
    units,
    stats: { total: units.length, available, sold, incoming, skipped, duplicateRows },
    format: 'imei-per-row',
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

type Stage = 'upload' | 'preview' | 'importing' | 'done';
type DuplicateStrategy = 'skip' | 'overwrite';

interface ImportResult {
  imported: number;
  skipped: number;
  duplicates: number;
  failed: number;
}

export default function ImportModal({ onClose }: ImportModalProps) {
  const [stage,          setStage]          = useState<Stage>('upload');
  const [isDragging,     setIsDragging]     = useState(false);
  const [parsed,         setParsed]         = useState<ParsedData | null>(null);
  const [fileName,       setFileName]       = useState('');
  const [progress,       setProgress]       = useState({ done: 0, total: 0 });
  const [error,          setError]          = useState('');
  const [existingMatches,setExistingMatches]= useState(0);
  // Default 'skip' — overwrite is destructive and should be a deliberate choice.
  const [duplicateStrategy, setDuplicateStrategy] = useState<DuplicateStrategy>('skip');
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [existingImeiSet, setExistingImeiSet] = useState<Set<string>>(new Set());
  const [sourceFile,     setSourceFile]     = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback((file: File) => {
    setSourceFile(file);
    setFileName(file.name);
    setError('');
    const isCsv = /\.csv$/i.test(file.name) || file.type === 'text/csv';
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        // xlsx auto-detects CSV vs binary, but CSVs need to be read as text
        // (or as binary string) to avoid byte-order mark corruption. Branch
        // on extension/MIME so we hand xlsx the right input every time.
        // raw + cellText: keep 15-digit IMEIs as strings, avoid 1.23e+14 coercion
        const wb = isCsv
          ? XLSX.read(e.target!.result as string, { type: 'string', raw: true, cellText: true })
          : XLSX.read(new Uint8Array(e.target!.result as ArrayBuffer), { type: 'array', raw: true, cellText: true });

        // Detect a SALES_REPORT-style workbook by sheet names. If any of the
        // five marketplace sheets are present, dispatch to the dedicated sales
        // parser instead of the inventory parsers.
        const salesSheets = wb.SheetNames.filter(n =>
          ['AMAZON', 'BM', 'EBAY', 'ONBUY', 'PROJECT'].includes(n.toUpperCase())
        );
        if (salesSheets.length > 0 && !isCsv) {
          const { parseSalesWorkbook } = await import('../lib/salesImport');
          const parsedSales = await parseSalesWorkbook(
            e.target!.result as ArrayBuffer,
            file.name,
          );
          if (!parsedSales.sales.length) {
            setError(
              'Sales workbook detected but no valid rows were parsed. ' +
              `Errors: ${parsedSales.errors.slice(0, 3).map(x => `${x.sheet}#${x.row}: ${x.message}`).join('; ')}`,
            );
            return;
          }
          const result: ParsedData = {
            units: [],
            suppliers: [],
            aggregates: [],
            sales: parsedSales.sales as ParsedData['sales'],
            stats: { total: 0, available: 0, sold: 0, incoming: 0, skipped: 0, duplicateRows: 0 },
            format: 'client-bulk',
            sheetName: salesSheets.join(', '),
            summary: `sales · ${parsedSales.sales.length} rows across ${salesSheets.length} marketplaces` +
              (parsedSales.errors.length ? ` · ${parsedSales.errors.length} skipped` : ''),
          };
          setParsed(result);
          setStage('preview');
          return;
        }

        const sheetName = wb.SheetNames.includes('OG STOCK DATA') ? 'OG STOCK DATA' : wb.SheetNames[0];
        const ws   = wb.Sheets[sheetName];
        const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as any[][];

        const format = detectFormat(rows[0] || []);
        const result = format === 'client-bulk' ? parseClientBulkSheet(rows) : parseOGStockSheet(rows);
        if (!result.units.length) {
          setError('No valid rows found. Check the file has a header row and at least one data row matching the expected columns.');
          return;
        }
        // Stamp workbook/sheet metadata + a short summary onto the parsed
        // payload so handleImport can record them on the importBatches row
        // without the parsers having to know about them.
        result.sheetName = sheetName;
        result.summary = `${result.format} · ${result.stats.total} units` +
          (result.aggregates?.length ? ` · ${result.aggregates.length} aggregates` : '') +
          (result.suppliers.length ? ` · ${result.suppliers.length} suppliers` : '');
        setParsed(result);
        setStage('preview');
      } catch (err: any) {
        setError('Failed to parse file: ' + err.message);
      }
    };
    if (isCsv) reader.readAsText(file);
    else reader.readAsArrayBuffer(file);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [processFile]);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (stage !== 'preview' || !parsed || parsed.format === 'client-bulk') {
        setExistingMatches(0);
        setExistingImeiSet(new Set());
        return;
      }
      const inventory = await dbService.readAll('inventoryUnits');
      const existingImeis = new Set(
        inventory.map((unit: InventoryUnit) => normalizeImei(unit.imei)).filter(Boolean) as string[],
      );
      const matches = parsed.units.filter(u => existingImeis.has(normalizeImei(u.imei))).length;
      if (!cancelled) {
        setExistingMatches(matches);
        setExistingImeiSet(existingImeis);
      }
    })().catch(() => { if (!cancelled) { setExistingMatches(0); setExistingImeiSet(new Set()); } });
    return () => { cancelled = true; };
  }, [parsed, stage]);

  const handleImport = async () => {
    if (!parsed || !sourceFile) return;
    setStage('importing');
    setError('');

    // Apply the duplicate-handling strategy. We only filter unit docs;
    // suppliers always get upserted (low cardinality, low risk).
    const filteredUnits = duplicateStrategy === 'skip' && existingImeiSet.size > 0
      ? parsed.units.filter(u => {
          const key = normalizeImei(u.imei);
          // Keep rows where the IMEI doesn't look real (PENDING_/SHS_) or
          // isn't already in inventory.
          return !key || !existingImeiSet.has(key);
        })
      : parsed.units;

    const skippedAsDuplicate = parsed.units.length - filteredUnits.length;
    const file = sourceFile;
    const aggregates = parsed.aggregates ?? [];
    const sales = parsed.sales ?? [];

    try {
      // ── B9 step 1 ── Create the importBatches row up-front so every
      // downstream doc can carry its id. rowCount covers both unit + aggregate
      // writes (suppliers and the event are bookkeeping, not data rows).
      const importBatchId = await dbService.createImportBatch({
        sourceFile: file.name,
        sourceSheet: parsed.sheetName,
        rowCount: filteredUnits.length + aggregates.length,
        supplierId: parsed.detectedSupplierId,
        notes: parsed.summary,
      });
      const importedAt = new Date().toISOString();

      // ── B7 follow-up ── Resolve synthetic `sup_<slug>` ids to real
      // `suppliers` collection docs. Match case-insensitive trim against
      // existing `name`; otherwise create on the fly with a stable slug id.
      const existingSuppliers = await dbService.readAll('suppliers');
      const byNormName = new Map<string, any>();
      for (const sup of existingSuppliers) {
        const n = String(sup?.name || '').trim().toLowerCase();
        if (n) byNormName.set(n, sup);
      }

      const slugify = (name: string) =>
        `sup_${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown'}`;

      // syntheticId → realId for rewriting unit/aggregate references.
      const idRemap = new Map<string, string>();
      // realId → supplier doc to upsert (covers brand-new suppliers only).
      const suppliersToCreate = new Map<string, Omit<Supplier, 'createdAt'>>();

      for (const parsedSup of parsed.suppliers) {
        const name = (parsedSup.name || '').trim();
        const norm = name.toLowerCase();
        const existing = norm ? byNormName.get(norm) : undefined;
        if (existing?.id) {
          idRemap.set(parsedSup.id, existing.id);
        } else {
          // Brand new supplier — mint a stable slug id and queue it for write.
          const realId = slugify(name || 'Unknown');
          idRemap.set(parsedSup.id, realId);
          if (!suppliersToCreate.has(realId)) {
            suppliersToCreate.set(realId, {
              id: realId,
              name: name || 'Unknown',
              portal: parsedSup.portal || 'Wholesale',
              ownerId: 'shared',
            });
            // Cache locally so subsequent rows in this batch resolve to the same id.
            byNormName.set(name.toLowerCase(), { id: realId, name });
          }
        }
      }

      const resolveId = (synthetic: string | undefined): string | undefined =>
        synthetic ? (idRemap.get(synthetic) ?? synthetic) : synthetic;
      const resolveIds = (ids: string[] | undefined): string[] | undefined =>
        ids ? ids.map(id => idRemap.get(id) ?? id) : ids;

      // ── B9 step 2 ── Stamp every unit with batch/source provenance and
      // rewrite supplier ids to point at the real collection docs.
      const stampedUnits = filteredUnits.map((u, idx) => ({
        ...u,
        supplierId:  resolveId(u.supplierId)!,
        supplierIds: resolveIds(u.supplierIds),
        importBatchId,
        sourceFile:  file.name,
        // Parser doesn't currently emit `_sourceRow` on units; derive from
        // the array position so the audit field is always populated.
        sourceRow:   (u as any)._sourceRow ?? (idx + 1),
        importedAt,
        ownerId:     'shared',
      }));

      // ── B8 step ── Persist aggregates (the INVENTORY-sheet roll-up rows
      // that B8 stopped dropping silently). Same provenance fields as units.
      const stampedAggregates = aggregates.map(a => ({
        ...a,
        supplierIds: resolveIds(a.supplierIds) ?? [],
        importBatchId,
        sourceFile:  file.name,
        sourceRow:   a.sourceRow,
        importedAt,
        ownerId:     'shared',
      }));

      // Assemble the single bulk-create payload (suppliers → units → aggregates).
      const allDocs: { collection: string; id: string; data: any }[] = [];
      for (const s of suppliersToCreate.values())
        allDocs.push({ collection: 'suppliers', id: s.id, data: s });
      for (const u of stampedUnits)
        allDocs.push({ collection: 'inventoryUnits', id: u.id, data: u });
      for (const a of stampedAggregates)
        allDocs.push({ collection: 'inventoryAggregates', id: a.id, data: a });

      const uniqueDocsMap = new Map<string, { collection: string; id: string; data: any }>();
      for (const d of allDocs) uniqueDocsMap.set(`${d.collection}_${d.id}`, d);
      const finalDocs = Array.from(uniqueDocsMap.values());

      setProgress({ done: 0, total: finalDocs.length });
      await dbService.bulkCreate(finalDocs, (done, total) => setProgress({ done, total }));

      // Sales are owned by a sibling agent's workstream; only wire through
      // if the parser emits them. Same provenance fields go on each row.
      if (sales.length > 0) {
        await dbService.bulkUpsertSales(
          sales.map(s => ({ ...s, importBatchId, importedAt })),
        );
      }

      // ── B9 step 5 ── Single audit event summarising the whole import.
      await logInventoryEvent({
        type: 'batch_created',
        message:
          `Imported ${stampedUnits.length} units, ${stampedAggregates.length} aggregates, ` +
          `${sales.length} sales from ${file.name} (batch ${importBatchId})`,
        batchId: importBatchId,
        supplierId: parsed.detectedSupplierId,
      });

      setImportResult({
        imported: filteredUnits.length,
        skipped: parsed.stats.skipped || 0,
        duplicates: skippedAsDuplicate,
        failed: 0,
      });
      setStage('done');

      // Upload source file in background (non-blocking). Use the real
      // importBatchId so sourceDocuments link back to the audit row.
      (async () => {
        try {
          const source = await uploadSourceAttachment(file, 'import', importBatchId);
          await dbService.create('sourceDocuments', `doc_${importBatchId}`, {
            ...source, linkedId: importBatchId, ownerId: 'shared',
          });
          await logInventoryEvent({
            type: 'file_attached',
            message: `Import: ${file.name}`,
            batchId: importBatchId,
          });
        } catch { /* non-critical */ }
      })();

      setTimeout(onClose, 2000);
    } catch (err: any) {
      setError('Import failed: ' + err.message);
      setStage('preview');
    }
  };

  const pct         = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const isClientFmt = parsed?.format === 'client-bulk';

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/30 backdrop-blur-md"
    >
      <motion.div
        initial={{ y: 12, opacity: 0, scale: 0.98 }} animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 12, opacity: 0, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 280, damping: 26 }}
        className="bg-white rounded-3xl overflow-hidden shadow-xl shadow-slate-900/10 ring-1 ring-slate-200/70 w-full max-w-2xl overflow-hidden text-slate-700 flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-slate-50 ring-1 ring-slate-200/80 rounded-xl flex items-center justify-center text-slate-500">
              <FileSpreadsheet size={16} strokeWidth={1.75} />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-800 tracking-tight">Import Stock</h2>
              <p className="text-[10px] text-slate-400 mt-0.5 tracking-wide">
                {isClientFmt
                  ? 'Bulk format · model · BP · qty · colours · supplier'
                  : 'Master sheet · date · model · IMEI · colour · status'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-300 hover:text-slate-600 hover:bg-slate-50 transition-all">
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>

        <div className="border-t border-slate-100" />

        {/* Body */}
        <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">

          {/* ── Upload ── */}
          {stage === 'upload' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2.5">
                {[
                  {
                    title: 'Stock Report',
                    desc:  'MODEL · BP · QTY · COLOURS · SUPPLIER',
                    eg:    'Galaxy A32, 60, 122, 7320, BLACK 122, IMAX',
                    tag:   'Auto-detected',
                  },
                  {
                    title: 'Master Sheet',
                    desc:  'Date · Model · IMEI · Supplier · BP · Colour · Status',
                    eg:    '2026-04-01, iPhone 15 Pro Max, 35320…, TechSource, 800',
                    tag:   'Recommended',
                  },
                ].map(f => (
                  <div key={f.title} className="bg-slate-50/70 rounded-xl p-3.5 ring-1 ring-slate-100 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-semibold text-slate-700 tracking-tight">{f.title}</p>
                      <span className="text-[8px] tracking-wider uppercase text-slate-500 bg-white px-2 py-0.5 rounded-full ring-1 ring-slate-200/80">
                        {f.tag}
                      </span>
                    </div>
                    <p className="text-[9px] text-slate-400 leading-relaxed">{f.desc}</p>
                    <p className="text-[9px] bg-white px-2 py-1 font-mono text-slate-500 rounded-md truncate ring-1 ring-slate-200/60">{f.eg}</p>
                  </div>
                ))}
              </div>

              {/* Sample file download */}
              <a
                href="/sample-100-units.xlsx"
                download="sample-100-units.xlsx"
                className="flex items-center justify-between w-full px-4 py-3 border border-dashed border-slate-200 rounded-xl hover:border-slate-300 hover:bg-slate-50/50 transition-all group"
              >
                <div className="flex items-center gap-3">
                  <FileSpreadsheet size={15} className="text-slate-400 flex-shrink-0" strokeWidth={1.75} />
                  <div>
                    <p className="text-[11px] font-medium text-slate-700">Download sample file</p>
                    <p className="text-[9px] text-slate-400 mt-0.5">100 mock units · correct column format</p>
                  </div>
                </div>
                <Download size={13} className="text-slate-300 group-hover:text-slate-500 transition-colors flex-shrink-0" strokeWidth={1.75} />
              </a>

              <div
                onDrop={handleDrop}
                onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onClick={() => fileRef.current?.click()}
                className={`border-2 border-dashed rounded-3xl p-10 text-center cursor-pointer transition-all ${
                  isDragging
                    ? 'border-slate-400 bg-slate-50'
                    : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/50'
                }`}
              >
                <div className={`mx-auto mb-3 w-11 h-11 rounded-3xl flex items-center justify-center transition-all ${
                  isDragging ? 'bg-slate-200 text-slate-600' : 'bg-slate-100 text-slate-400'
                }`}>
                  <Upload size={18} strokeWidth={1.75} />
                </div>
                <p className="text-sm font-medium text-slate-700">Drop Excel or CSV here</p>
                <p className="text-[11px] text-slate-400 mt-1">or click to browse</p>
                <p className="text-[9px] text-slate-300 mt-3 tracking-wider uppercase">.xlsx · .xls · .csv</p>
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileInput} />
              </div>

              {error && (
                <div className="flex items-center gap-2.5 px-4 py-3 bg-rose-50/70 ring-1 ring-rose-100 rounded-xl">
                  <AlertTriangle size={13} className="text-rose-500 flex-shrink-0" strokeWidth={1.75} />
                  <p className="text-[11px] text-rose-600">{error}</p>
                </div>
              )}
            </div>
          )}

          {/* ── Preview ── */}
          {stage === 'preview' && parsed && (
            <div className="space-y-5">
              <div className="flex items-center gap-3 px-4 py-3 bg-emerald-50/60 ring-1 ring-emerald-100/80 rounded-xl">
                <CheckCircle2 size={15} className="text-emerald-500 flex-shrink-0" strokeWidth={1.75} />
                <div className="min-w-0">
                  <p className="text-[12px] font-medium text-slate-800 truncate">{fileName}</p>
                  <p className="text-[10px] text-emerald-700/70 mt-0.5">
                    {isClientFmt ? 'Bulk stock format detected' : 'IMEI-per-row format detected'} · ready to import
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2">
                <PreviewStat label="Total"     value={parsed.stats.total}     tone="primary" />
                <PreviewStat label="Available" value={parsed.stats.available} tone="muted" />
                {parsed.stats.incoming > 0
                  ? <PreviewStat label="SHS"  value={parsed.stats.incoming} tone="muted" />
                  : <PreviewStat label="Sold" value={parsed.stats.sold}     tone="muted" />}
                <PreviewStat label="Suppliers" value={parsed.suppliers.length} tone="muted" />
              </div>

              {existingMatches > 0 && (
                <div className="px-4 py-3 ring-1 ring-amber-100 bg-amber-50/60 rounded-xl space-y-2.5">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle size={14} className="mt-0.5 flex-shrink-0 text-amber-500" strokeWidth={1.75} />
                    <p className="text-[11px] text-amber-800/90 leading-relaxed">
                      <span className="font-semibold">{existingMatches}</span> unit{existingMatches !== 1 ? 's' : ''} already in inventory.
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 pl-6">
                    {([
                      { id: 'skip',      label: 'Skip duplicates',    desc: 'Recommended · safe' },
                      { id: 'overwrite', label: 'Overwrite existing', desc: 'Replaces fields' },
                    ] as const).map(opt => {
                      const active = duplicateStrategy === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setDuplicateStrategy(opt.id)}
                          className={`text-left px-3 py-2 rounded-lg ring-1 transition-all ${
                            active
                              ? 'bg-white ring-amber-300 shadow-sm'
                              : 'bg-amber-50/40 ring-amber-100/80 hover:bg-white/60'
                          }`}
                        >
                          <p className={`text-[11px] font-semibold ${active ? 'text-amber-900' : 'text-amber-800/80'}`}>
                            {opt.label}
                          </p>
                          <p className="text-[9px] text-amber-700/70 mt-0.5">{opt.desc}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {parsed.stats.skipped > 0 && (
                <div className="px-4 py-3 ring-1 ring-slate-200 bg-slate-50/60 rounded-xl flex items-start gap-2.5">
                  <AlertTriangle size={14} className="mt-0.5 flex-shrink-0 text-slate-400" strokeWidth={1.75} />
                  <p className="text-[11px] text-slate-600 leading-relaxed">
                    <span className="font-semibold">{parsed.stats.skipped}</span> row{parsed.stats.skipped !== 1 ? 's' : ''} couldn't be parsed (missing model, no buy price, or header repeated). They'll be skipped.
                  </p>
                </div>
              )}

              <div>
                <p className="text-[9px] font-medium text-slate-400 uppercase tracking-wider mb-2">Suppliers detected</p>
                <div className="flex flex-wrap gap-1.5">
                  {parsed.suppliers.map(s => (
                    <span key={s.id} className="text-[10px] bg-slate-50 ring-1 ring-slate-100 px-2 py-1 text-slate-600 rounded-lg">
                      {s.name}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-[9px] font-medium text-slate-400 uppercase tracking-wider mb-2">Sample rows</p>
                <div className="rounded-xl ring-1 ring-slate-100 divide-y divide-slate-100 overflow-hidden">
                  {parsed.units.slice(0, 5).map((u, i) => (
                    <div key={i} className="px-4 py-2.5 flex items-center gap-3 text-xs bg-white">
                      <StatusPill status={u.status} />
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-medium text-slate-700 truncate">{u.model}</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">{u.colour} · £{u.buyPrice}</p>
                      </div>
                      <span className="text-[10px] text-slate-400 flex-shrink-0">{u.supplierName || '—'}</span>
                    </div>
                  ))}
                </div>
              </div>

              {error && (
                <div className="flex items-center gap-2.5 px-4 py-3 bg-rose-50/70 ring-1 ring-rose-100 rounded-xl">
                  <AlertTriangle size={13} className="text-rose-500 flex-shrink-0" strokeWidth={1.75} />
                  <p className="text-[11px] text-rose-600">{error}</p>
                </div>
              )}
            </div>
          )}

          {/* ── Importing ── */}
          {stage === 'importing' && (
            <div className="py-12 space-y-6 text-center">
              <div className="mx-auto w-12 h-12 rounded-3xl bg-slate-50 ring-1 ring-slate-100 flex items-center justify-center">
                <Loader2 className="animate-spin text-slate-400" size={20} strokeWidth={1.75} />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-700">Saving to Firestore</p>
                <p className="text-[11px] text-slate-400 mt-1 font-mono">{progress.done} of {progress.total} records</p>
              </div>
              <div className="max-w-xs mx-auto">
                <div className="w-full h-1 bg-slate-100 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-slate-700 rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ ease: 'linear' }}
                  />
                </div>
              </div>
              <p className="text-2xl font-semibold text-slate-800 tracking-tight tabular-nums">{pct}%</p>
            </div>
          )}

          {/* ── Done ── */}
          {stage === 'done' && parsed && importResult && (
            <div className="py-6 space-y-6 text-center">
              <div className="mx-auto w-12 h-12 bg-emerald-50 ring-1 ring-emerald-100 rounded-3xl flex items-center justify-center">
                <CheckCircle2 className="text-emerald-500" size={22} strokeWidth={1.75} />
              </div>
              <div>
                <p className="text-base font-semibold text-slate-800 tracking-tight">Import complete</p>
                <p className="text-[12px] text-slate-500 mt-1.5">
                  {importResult.imported} unit{importResult.imported !== 1 ? 's' : ''}{' '}
                  {duplicateStrategy === 'overwrite' && existingMatches > 0
                    ? `· ${existingMatches} updated`
                    : ''}{' '}
                  · {parsed.suppliers.length} supplier{parsed.suppliers.length !== 1 ? 's' : ''}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 max-w-md mx-auto">
                <SummaryTile value={importResult.imported}  label="Imported" />
                <SummaryTile value={importResult.duplicates} label={duplicateStrategy === 'skip' ? 'Skipped (duplicate)' : 'Overwritten'} />
                <SummaryTile value={importResult.skipped}    label="Skipped (invalid)" />
                <SummaryTile value={importResult.failed}     label="Failed" />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-100 px-6 py-4 flex justify-between items-center">
          <button
            onClick={onClose}
            className="px-4 py-2 text-[11px] font-medium text-slate-500 hover:text-slate-800 hover:bg-slate-50 rounded-lg transition-all"
          >
            {stage === 'done' ? 'Close' : 'Cancel'}
          </button>
          {stage === 'upload' && (
            <button
              onClick={() => fileRef.current?.click()}
              className="px-5 py-2 bg-slate-800 text-white text-[11px] font-medium rounded-lg hover:bg-slate-900 transition-all flex items-center gap-2"
            >
              Select file <Upload size={12} strokeWidth={2} />
            </button>
          )}
          {stage === 'preview' && (() => {
            const willImport = duplicateStrategy === 'skip'
              ? parsed!.units.length - existingMatches
              : parsed!.units.length;
            return (
              <button
                onClick={handleImport}
                disabled={willImport <= 0}
                className="px-5 py-2 bg-slate-800 text-white text-[11px] font-medium rounded-lg hover:bg-slate-900 transition-all flex items-center gap-2 disabled:bg-slate-300 disabled:cursor-not-allowed"
              >
                {willImport <= 0
                  ? 'Nothing to import'
                  : <>Import {willImport} unit{willImport !== 1 ? 's' : ''} <ArrowRight size={12} strokeWidth={2} /></>}
              </button>
            );
          })()}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function PreviewStat({ value, label, tone }: { value: number; label: string; tone: 'primary' | 'muted' }) {
  const isPrimary = tone === 'primary';
  return (
    <div className={`rounded-xl px-3 py-3 text-center ${
      isPrimary
        ? 'bg-slate-800 text-white'
        : 'bg-slate-50 ring-1 ring-slate-100'
    }`}>
      <p className={`text-xl font-semibold tabular-nums ${isPrimary ? '' : 'text-slate-700'}`}>
        {value}
      </p>
      <p className={`text-[9px] mt-0.5 tracking-wider uppercase ${
        isPrimary ? 'text-slate-300' : 'text-slate-400'
      }`}>
        {label}
      </p>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === 'available'
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-100'
      : status === 'incoming'
      ? 'bg-sky-50 text-sky-700 ring-sky-100'
      : 'bg-slate-50 text-slate-500 ring-slate-100';
  return (
    <span className={`text-[9px] font-medium px-2 py-0.5 rounded-md ring-1 ${tone} flex-shrink-0`}>
      {status}
    </span>
  );
}

function SummaryTile({ value, label }: { value: number; label: string }) {
  return (
    <div className="bg-slate-50 ring-1 ring-slate-100 rounded-xl px-4 py-3 text-left">
      <p className="text-2xl font-semibold text-slate-800 tabular-nums">{value}</p>
      <p className="text-[9px] text-slate-400 uppercase tracking-wider mt-1">{label}</p>
    </div>
  );
}
