/**
 * scripts/smokeMasterFiles.mts
 *
 * End-to-end smoke test for the master-files audit work:
 *   1. Parses INVENTORY_REPORT_2026_1.xlsx (3 sheets) into the new
 *      InventoryUnit / InventoryAggregate / SupplierWhatsappUpdate shapes.
 *   2. Parses SALES_REPORT_2026.xlsx (5 sheets) into Sale[] via the new
 *      parseSalesWorkbook() pipeline.
 *   3. Runs the parsed data back through clientReport.ts to emit two new
 *      .xlsx files that should be visually identical to the originals.
 *   4. Writes the outputs to /tmp/round_trip/ for inspection.
 *
 * This bypasses Firestore and the browser entirely so the parsers + writer
 * can be validated in CI / locally without credentials.
 *
 * Run with: npx tsx scripts/smokeMasterFiles.mts
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import * as XLSX from 'xlsx';

import { parseSalesWorkbook } from '../src/lib/salesImport.ts';
import {
  buildInventoryWorkbookBuffer,
  buildSalesWorkbookBuffer,
} from '../src/lib/clientReport.ts';
import { extractStorage } from '../src/lib/modelStorage.ts';
import type {
  InventoryUnit,
  InventoryAggregate,
  SupplierWhatsappUpdate,
  Supplier,
} from '../src/types.ts';

const INV_PATH   = process.env.INV_PATH   ?? '/tmp/INVENTORY_REPORT_2026.xlsx';
const SALES_PATH = process.env.SALES_PATH ?? '/tmp/SALES_REPORT_2026.xlsx';
const OUT_DIR    = '/tmp/round_trip';

mkdirSync(OUT_DIR, { recursive: true });

// ── Helpers replicated from ImportModal (parsers are tied to a React module
//   so we re-implement the pure logic here to keep the smoke test standalone).

function trimOrUndef(v: any): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s ? s : undefined;
}

function parseColoursAndQty(s: string | undefined): { coloursMap: Record<string, number>; coloursRaw: string } {
  const raw = s?.trim() ?? '';
  const map: Record<string, number> = {};
  if (!raw) return { coloursMap: map, coloursRaw: raw };
  // "GREY 2 SILVER 0 LAVENDER 1" → token pairs (word, number)
  const tokens = raw.split(/\s+/);
  let i = 0;
  while (i < tokens.length) {
    let colourParts: string[] = [];
    while (i < tokens.length && !/^-?\d+$/.test(tokens[i])) {
      colourParts.push(tokens[i]);
      i++;
    }
    if (colourParts.length && i < tokens.length) {
      map[colourParts.join(' ')] = parseInt(tokens[i], 10);
      i++;
    } else if (colourParts.length) {
      // trailing colour without quantity → treat as 1
      map[colourParts.join(' ')] = 1;
    }
  }
  return { coloursMap: map, coloursRaw: raw };
}

function parseQuantityCell(v: any): { qty: number } | { qty: undefined; flag: 'SHS' | 'NO_STOCK' | 'OTHER'; raw: string } {
  if (typeof v === 'number' && !Number.isNaN(v)) return { qty: v };
  const s = String(v ?? '').trim();
  if (!s) return { qty: undefined, flag: 'OTHER', raw: '' };
  const n = parseFloat(s);
  if (!Number.isNaN(n) && /^\-?\d+(\.\d+)?$/.test(s)) return { qty: n };
  const upper = s.toUpperCase();
  if (upper === 'SHS') return { qty: undefined, flag: 'SHS', raw: s };
  if (upper === 'NO STOCK') return { qty: undefined, flag: 'NO_STOCK', raw: s };
  return { qty: undefined, flag: 'OTHER', raw: s };
}

function parseSupplierCell(v: any): { primaryName: string; allNames: string[] } {
  const s = String(v ?? '').trim();
  if (!s) return { primaryName: '', allNames: [] };
  const names = s.split('/').map(p => p.trim()).filter(Boolean);
  return { primaryName: names[0] ?? '', allNames: names };
}

function normaliseImei(v: any): string {
  if (v == null) return '';
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return v.toFixed(0);
    return String(v);
  }
  return String(v).trim().replace(/^["']|["']$/g, '');
}

function slugify(name: string): string {
  return `sup_${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown'}`;
}

function excelDateToIso(v: any): string | undefined {
  if (!v) return undefined;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') {
    // openpyxl/xlsx Excel serial date → JS Date
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return undefined;
    return `${d.y.toString().padStart(4, '0')}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  const s = String(v).trim();
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
}

// ── Parse INVENTORY sheet (286 rows, model+supplier roll-up rows) ──────────

export interface ParseResult {
  units: InventoryUnit[];
  aggregates: InventoryAggregate[];
  whatsapp: SupplierWhatsappUpdate[];
  suppliers: Supplier[];
}

export function parseInventoryWorkbook(buf: Buffer): ParseResult {
  const wb = XLSX.read(buf, { type: 'buffer', raw: true, cellText: true, cellDates: true });
  const supplierMap = new Map<string, Supplier>();
  function supplierIdFor(name: string): string {
    const key = name.trim().toLowerCase();
    if (!key) return '';
    for (const [, sup] of supplierMap) {
      if (sup.name.trim().toLowerCase() === key) return sup.id;
    }
    const id = slugify(name);
    supplierMap.set(id, { id, name: name.trim(), portal: 'Wholesale', ownerId: 'shared', createdAt: new Date().toISOString() });
    return id;
  }

  // --- Sheet: INVENTORY (aggregate roll-ups)
  const aggregates: InventoryAggregate[] = [];
  // SHS rows additionally emit synthetic InventoryUnit placeholders (status:
  // 'incoming') so the legacy StockInPage "Pending SHS" list lights up.
  const shsUnits: InventoryUnit[] = [];
  const todayIso = new Date().toISOString().slice(0, 10);
  const invSheet = wb.Sheets['INVENTORY'];
  if (invSheet) {
    const rows = XLSX.utils.sheet_to_json<any[]>(invSheet, { header: 1, defval: '' });
    // Header row at index 0: MODEL | BP | QUANTITY | (D notes) | VALUE | COLOURS | SUPPLIER | NOTES
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r] ?? [];
      const rawModel = trimOrUndef(row[0]);
      if (!rawModel) continue;
      // Strip embedded storage out of the MODEL string and persist it on the
      // aggregate so downstream consumers can filter / display capacity.
      const { model, storage } = extractStorage(rawModel);
      const bp = typeof row[1] === 'number' ? row[1] : parseFloat(String(row[1] ?? '')) || undefined;
      const qty = parseQuantityCell(row[2]);
      const notesFlag = trimOrUndef(row[3]);
      const { coloursMap, coloursRaw } = parseColoursAndQty(trimOrUndef(row[5]));
      const supplierParsed = parseSupplierCell(row[6]);
      const supplierIds = supplierParsed.allNames.map(supplierIdFor).filter(Boolean);
      const supplierId  = supplierParsed.primaryName ? supplierIdFor(supplierParsed.primaryName) : '';
      const notes = trimOrUndef(row[7]);
      aggregates.push({
        id: `agg_${r}_${slugify(model)}`,
        model,
        ...(storage ? { storage } : {}),
        buyPrice: bp,
        quantityNum: 'qty' in qty && qty.qty !== undefined ? qty.qty : undefined,
        quantityText: 'flag' in qty ? qty.raw : undefined,
        notesFlag,
        coloursMap,
        coloursRaw,
        supplierIds,
        notes,
        sourceRow: r + 1,
        ownerId: 'shared',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // SHS placeholder unit — mirrors ImportModal::parseClientBulkSheet so the
      // legacy StockInPage "Pending SHS" list (filters status === 'incoming')
      // lights up. The aggregate above is the canonical SHS record; this unit
      // is purely a UI bridge for legacy consumers.
      const isShs = 'flag' in qty && qty.flag === 'SHS';
      if (isShs) {
        const primaryColour = Object.keys(coloursMap)[0] || (coloursRaw || 'Unknown');
        const upperModel = model.toUpperCase();
        const brand = (upperModel.includes('IPHONE') || upperModel.includes('IPAD') || upperModel.includes('MACBOOK'))
          ? 'Apple' : 'Other';
        shsUnits.push({
          id: `shs_${slugify(model)}_${slugify(supplierParsed.primaryName || 'unknown')}_${r}`,
          imei: '',
          model,
          ...(storage ? { storage } : {}),
          brand,
          category: 'Other' as any,
          colour: primaryColour,
          buyPrice: bp ?? 0,
          dateIn: todayIso,
          supplierId,
          supplierIds: supplierIds.length > 0 ? supplierIds : (supplierId ? [supplierId] : []),
          supplierName: supplierParsed.primaryName || '',
          status: 'incoming' as any,
          statusRaw: 'SHS',
          flags: [],
          notes: `SHS — Expected${notes ? ' · ' + notes : ''}`,
          platformListed: false,
          ownerId: 'shared',
          sourceRow: r + 1,
          createdAt: new Date().toISOString(),
          // Sentinel + supplier-held quantity (free-form fields — InventoryUnit
          // permits extra keys, so no type change required).
          _isShsPlaceholder: true,
          _shsQuantity: 'qty' in qty && qty.qty !== undefined ? qty.qty : 1,
        } as any);
      }
    }
  }

  // --- Sheet: IMEI NUMBERS (855 rows, per-unit)
  const units: InventoryUnit[] = [...shsUnits];
  const imeiSheet = wb.Sheets['IMEI NUMBERS'];
  if (imeiSheet) {
    const rows = XLSX.utils.sheet_to_json<any[]>(imeiSheet, { header: 1, defval: '' });
    // Headers: STOCK IN DATE | MODEL | IMEI NUMBER | BP | COLOURS | SUPPLIER | NOTES | STATUS | MARKETPLACE | STOCK OUT DATE
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r] ?? [];
      const imei = normaliseImei(row[2]);
      const rawModel = trimOrUndef(row[1]);
      if (!imei && !rawModel) continue;
      // Strip embedded storage out of the MODEL string and propagate it as a
      // first-class field on the unit (`InventoryUnit.storage`).
      const { model, storage } = rawModel
        ? extractStorage(rawModel)
        : { model: '', storage: undefined as string | undefined };
      const supplierParsed = parseSupplierCell(row[5]);
      const supplierId = supplierParsed.primaryName ? supplierIdFor(supplierParsed.primaryName) : '';
      const supplierIds = supplierParsed.allNames.map(supplierIdFor).filter(Boolean);
      const statusRaw = trimOrUndef(row[7]);
      const marketplace = trimOrUndef(row[8]);
      const dateIn = excelDateToIso(row[0]) ?? '';
      const stockOutDate = excelDateToIso(row[9]);
      const upperModel = (model || '').toUpperCase();
      units.push({
        id: imei || `unit_${r}`,
        imei,
        model: model ?? '',
        ...(storage ? { storage } : {}),
        brand: upperModel.includes('IPHONE') || upperModel.includes('IPAD') || upperModel.includes('MACBOOK') ? 'Apple' : 'Other',
        category: 'Other' as any,
        colour: trimOrUndef(row[4]) ?? '',
        buyPrice: typeof row[3] === 'number' ? row[3] : parseFloat(String(row[3] ?? '')) || 0,
        dateIn,
        supplierId,
        supplierIds: supplierIds.length > 1 ? supplierIds : undefined,
        supplierName: supplierParsed.primaryName,
        status: statusRaw?.toUpperCase() === 'SOLD' ? 'sold' as any
              : statusRaw?.toUpperCase() === 'FBA' ? 'fba' as any
              : statusRaw?.toUpperCase().replace(/\s+/g, '') === 'RTS' ? 'ready_to_ship' as any
              : 'available' as any,
        statusRaw,
        marketplace,
        stockOutDate,
        notes: trimOrUndef(row[6]) ?? '',
        flags: [],
        platformListed: false,
        ownerId: 'shared',
        sourceRow: r + 1,
        createdAt: new Date().toISOString(),
      });
    }
  }

  // --- Sheet: SUPPLIER WHATSAPP UPDATES
  const whatsapp: SupplierWhatsappUpdate[] = [];
  const waSheet = wb.Sheets['SUPPLIER WHATSAPP UPDATES'];
  if (waSheet) {
    const rows = XLSX.utils.sheet_to_json<any[]>(waSheet, { header: 1, defval: '' });
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r] ?? [];
      const rawText = trimOrUndef(row[0]);
      if (!rawText) continue;
      whatsapp.push({
        id: `wa_${r}`,
        rawText,
        priceText: trimOrUndef(row[1]),
        postedAt: new Date().toISOString(),
        ownerId: 'shared',
      });
    }
  }

  return { units, aggregates, whatsapp, suppliers: Array.from(supplierMap.values()) };
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('▸ Reading client master files…');
  const invBuf = readFileSync(INV_PATH);
  const salesBuf = readFileSync(SALES_PATH);

  console.log('▸ Parsing INVENTORY workbook…');
  const inv = parseInventoryWorkbook(invBuf);
  console.log(`  ↳ ${inv.units.length} units, ${inv.aggregates.length} aggregates, ${inv.whatsapp.length} whatsapp lines, ${inv.suppliers.length} suppliers`);

  console.log('▸ Parsing SALES workbook…');
  const ab = salesBuf.buffer.slice(salesBuf.byteOffset, salesBuf.byteOffset + salesBuf.byteLength);
  const parsedSales = await parseSalesWorkbook(ab as ArrayBuffer, 'SALES_REPORT_2026.xlsx');
  console.log(`  ↳ ${parsedSales.sales.length} sales rows across:`);
  for (const [m, c] of Object.entries(parsedSales.perSheetCounts)) {
    if (c > 0) console.log(`      ${m}: ${c}`);
  }
  if (parsedSales.errors.length) {
    console.log(`  ⚠ ${parsedSales.errors.length} parse errors (first 5):`);
    for (const e of parsedSales.errors.slice(0, 5)) {
      console.log(`      ${e.sheet}#${e.row}: ${e.message}`);
    }
  }

  // Stamp provenance fields the writer expects
  const importedAt = new Date().toISOString();
  const sales = parsedSales.sales.map(s => ({
    ...s,
    importBatchId: 'smoke_batch',
    sourceFile: 'SALES_REPORT_2026.xlsx',
    importedAt,
    createdAt: importedAt,
    updatedAt: importedAt,
    ownerId: 'shared',
  })) as any;

  console.log('▸ Building round-tripped INVENTORY workbook…');
  const invOutBuf = await buildInventoryWorkbookBuffer({
    units: inv.units,
    aggregates: inv.aggregates,
    suppliers: inv.suppliers,
    whatsappFeed: inv.whatsapp,
  });
  const invOutPath = resolve(OUT_DIR, 'INVENTORY_REPORT_2026_5.xlsx');
  writeFileSync(invOutPath, Buffer.from(invOutBuf));
  console.log(`  ↳ wrote ${invOutPath} (${invOutBuf.byteLength.toLocaleString()} bytes)`);

  console.log('▸ Building round-tripped SALES workbook…');
  const salesOutBuf = await buildSalesWorkbookBuffer({ sales });
  const salesOutPath = resolve(OUT_DIR, 'SALES_REPORT_2026.xlsx');
  writeFileSync(salesOutPath, Buffer.from(salesOutBuf));
  console.log(`  ↳ wrote ${salesOutPath} (${salesOutBuf.byteLength.toLocaleString()} bytes)`);

  console.log('\n✓ smoke test complete');
  console.log(`  Open both files in Excel and compare to the originals.`);
  console.log(`  Sheet names, headers (incl. trailing spaces / literal 0.2), formulas,`);
  console.log(`  date/IMEI/money formats and the per-marketplace fee math should match.`);
}

// Only auto-run when invoked directly (not when imported as a module).
const isDirectRun = import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  main().catch(err => {
    console.error('\n✗ smoke test FAILED');
    console.error(err);
    process.exit(1);
  });
}
