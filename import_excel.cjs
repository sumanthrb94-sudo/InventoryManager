/**
 * import_excel.cjs  —  Production-grade Excel → Firestore import tool
 *
 * Reads the master inventory workbook and outputs clean JSON
 * ready for Firestore import. All parameters are taken from:
 *   1. CLI flags  (highest priority)
 *   2. Environment variables
 *   3. client.config.js  (default/fallback)
 *
 * Usage:
 *   node import_excel.cjs                               # uses client.config.js defaults
 *   node import_excel.cjs --file "path/to/file.xlsx"   # override file
 *   node import_excel.cjs --sheet "Sheet1"             # override sheet name
 *   node import_excel.cjs --output ./out.json          # override output path
 *   node import_excel.cjs --help                       # show help
 *
 * Environment overrides:
 *   MASTER_EXCEL_PATH  — absolute path to master Excel file
 *   IMPORT_SHEET_NAME  — sheet name override
 *   IMPORT_OUTPUT_PATH — output JSON path override
 */

'use strict';

const XLSX   = require('xlsx');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const cfg    = require('./client.config.cjs');

// ── CLI Argument Parser (no external deps) ────────────────────────────────────
function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') { args.help = true; continue; }
    if (arg === '--dry-run')              { args.dryRun = true; continue; }
    if (arg === '--verbose' || arg === '-v') { args.verbose = true; continue; }
    if ((arg === '--file'   || arg === '-f') && argv[i + 1]) { args.file   = argv[++i]; continue; }
    if ((arg === '--sheet'  || arg === '-s') && argv[i + 1]) { args.sheet  = argv[++i]; continue; }
    if ((arg === '--output' || arg === '-o') && argv[i + 1]) { args.output = argv[++i]; continue; }
    if (arg === '--public'  && argv[i + 1]) { args.public = argv[++i]; continue; }
  }
  return args;
}

function printHelp() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║           MOBILEPHONEMARKET — Excel Import Tool v2.0                 ║
╚══════════════════════════════════════════════════════════════════════╝

Usage:
  node import_excel.cjs [options]

Options:
  -f, --file    <path>   Path to Excel file (overrides client.config.js)
  -s, --sheet   <name>   Sheet name to import (overrides client.config.js)
  -o, --output  <path>   Output JSON path (default: imported_inventory.json)
      --public  <path>   Also write a copy to public/ for app seeding
      --dry-run          Parse only — do not write any files
  -v, --verbose          Show detailed per-row logging
  -h, --help             Show this help

Environment variables:
  MASTER_EXCEL_PATH      Override Excel file path
  IMPORT_SHEET_NAME      Override sheet name
  IMPORT_OUTPUT_PATH     Override output JSON path

Examples:
  # Use the master file defined in client.config.js
  node import_excel.cjs

  # Import a specific file and write to public/ for app seeding
  node import_excel.cjs --file "SAMPLE_INVENTORY_REPORT_2026.xlsx" --public public/imported_inventory.json

  # Dry run to validate a new file without writing
  node import_excel.cjs --file "new_stock.xlsx" --dry-run --verbose
`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveExcelFile(cliFile) {
  // Priority: CLI arg → env var → config value → auto-discover
  const candidates = [
    cliFile,
    process.env.MASTER_EXCEL_PATH,
    cfg.masterExcel.filePath,
    ...cfg.masterExcel.nameHints.map(n => path.resolve(__dirname, n)),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (fs.existsSync(resolved)) {
      return resolved;
    }
  }
  return null;
}

function resolveSheet(wb, cliSheet) {
  const sheetName = cliSheet || process.env.IMPORT_SHEET_NAME || cfg.masterExcel.sheetName;
  if (sheetName && wb.SheetNames.includes(sheetName)) return sheetName;

  // Try fallbacks
  for (const fallback of cfg.masterExcel.sheetFallbacks) {
    if (wb.SheetNames.includes(fallback)) return fallback;
  }
  return wb.SheetNames[0];
}

function excelDateToISO(serial) {
  if (!serial) return new Date().toISOString().split('T')[0];
  if (serial instanceof Date) return serial.toISOString().split('T')[0];
  if (typeof serial === 'number') {
    try {
      const parsed = XLSX.SSF.parse_date_code(serial);
      const d = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
      return d.toISOString().split('T')[0];
    } catch { /* fall through */ }
  }
  if (typeof serial === 'string') {
    const d = new Date(serial);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  }
  return new Date().toISOString().split('T')[0];
}

function findColIndex(header, keyAliases) {
  return header.findIndex(h =>
    keyAliases.some(alias =>
      h?.toString().toUpperCase().trim() === alias.toUpperCase().trim()
    )
  );
}

function resolveColIndices(header) {
  const colMap = cfg.masterExcel.columnMap;
  return {
    dateIn:    findColIndex(header, colMap.dateIn),
    model:     findColIndex(header, colMap.model),
    imei:      findColIndex(header, colMap.imei),
    supplier:  findColIndex(header, colMap.supplier),
    buyPrice:  findColIndex(header, colMap.buyPrice),
    status:    findColIndex(header, colMap.status),
    platform:  findColIndex(header, colMap.platform),
    salePrice: findColIndex(header, colMap.salePrice),
    saleDate:  findColIndex(header, colMap.saleDate),
    colour:    findColIndex(header, colMap.colour),
    storage:   findColIndex(header, colMap.storage),
    condition: findColIndex(header, colMap.condition),
    notes:     findColIndex(header, colMap.notes),
    orderNum:  findColIndex(header, colMap.orderNum),
    customer:  findColIndex(header, colMap.customer),
  };
}

function getCell(row, idx, fallback = '') {
  if (idx < 0) return fallback;
  return row[idx]?.toString().trim() || fallback;
}

// ── Storage extraction ───────────────────────────────────────────────────────
//
// Mirrors src/lib/modelStorage.ts (kept inline because this script is CJS and
// can't import the TS helper). Keep the regex + normalisation rules in sync.
//
//   "IPAD 7TH GEN 32GB W/C"                  → { model: "IPAD 7TH GEN W/C", storage: "32GB" }
//   "iPad 7 32GB Wifi 2019 10.2 - WIFI + 4G" → { model: "iPad 7 Wifi 2019 10.2 - WIFI + 4G", storage: "32GB" }
//   "iPhone 13 Pro Max"                      → { model: "iPhone 13 Pro Max", storage: undefined }
//   "Galaxy S22 Ultra 1TB"                   → { model: "Galaxy S22 Ultra", storage: "1TB" }
const STORAGE_REGEX = /\b(\d+\s?(?:GB|TB))\b/i;

function collapseWhitespace(s) {
  return String(s).replace(/\s+/g, ' ').trim();
}

function extractStorage(raw) {
  const input = (raw == null ? '' : String(raw));
  if (!input.trim()) return { model: input.trim(), storage: undefined };

  const match = input.match(STORAGE_REGEX);
  if (!match) return { model: collapseWhitespace(input), storage: undefined };

  const storage = match[1].replace(/\s+/g, '').toUpperCase();
  const start = match.index || 0;
  const end = start + match[0].length;
  const before = input.slice(0, start);
  const after = input.slice(end);
  const stitched = (before + ' ' + after)
    .replace(/\s+,/g, ',')
    .replace(/,\s*,/g, ',')
    .replace(/^\s*,\s*|\s*,\s*$/g, '');
  return { model: collapseWhitespace(stitched), storage };
}

// ── parseBrandModelStorage — CJS port of src/lib/modelStorage.ts ───────────
// Keep these rules in sync with the TS version. See that file for full docs.
//
// Brand detection (case-insensitive substring, first match wins):
//   apple/iphone/ipad/macbook/apple watch → Apple
//   samsung/galaxy                         → Samsung
//   google/pixel                           → Google
//   xiaomi/redmi/poco                      → Xiaomi
//   oneplus                                → OnePlus
//   anything else                          → Other
//
// After brand detection the FIRST token is stripped from the model only if it
// is the literal brand name itself (so "Apple iPhone" loses "Apple" but
// "iPhone" keeps "iPhone"). Then storage is extracted via extractStorage.
const BRAND_RULES_CJS = [
  { brand: 'Apple',   keywords: ['apple', 'iphone', 'ipad', 'macbook', 'apple watch'] },
  { brand: 'Samsung', keywords: ['samsung', 'galaxy'] },
  { brand: 'Google',  keywords: ['google', 'pixel'] },
  { brand: 'Xiaomi',  keywords: ['xiaomi', 'redmi', 'poco'] },
  { brand: 'OnePlus', keywords: ['oneplus'] },
];
const LEADING_BRAND_TOKENS_CJS = new Set(['apple', 'samsung', 'google', 'xiaomi', 'oneplus']);

function detectBrandCjs(lower) {
  for (const rule of BRAND_RULES_CJS) {
    if (rule.keywords.some(k => lower.includes(k))) return rule.brand;
  }
  return 'Other';
}

function detectSeriesCjs(brand, lower) {
  if (!lower) return undefined;
  if (brand === 'Apple') {
    if (lower.includes('iphone')) return 'iPhone';
    if (lower.includes('ipad')) return 'iPad';
    if (lower.includes('apple watch') || lower.includes('watch ultra') || lower.includes('watch se')) return 'Apple Watch';
    if (lower.includes('macbook')) return 'MacBook';
    return 'Other';
  }
  if (brand === 'Samsung') {
    if (lower.includes('galaxy tab') || /\btab [as]\d/.test(lower)) return 'Galaxy Tab';
    if (lower.includes('galaxy note') || /\bnote\s?\d/.test(lower)) return 'Galaxy Note';
    // Trailing `(fe|ultra|plus|+)?` catches "S20FE", "S22Ultra", "S21+", etc.
    if (/\bgalaxy s\d/.test(lower) || /\bs\d{1,2}(fe|ultra|plus|\+)?\b/.test(lower)) return 'Galaxy S';
    // Trailing `s?` catches "A21S" / "A52S".
    if (/\bgalaxy a\d/.test(lower) || /\ba\d{1,3}s?\b/.test(lower)) return 'Galaxy A';
    return 'Other';
  }
  if (brand === 'Google') {
    if (lower.includes('pixel')) return 'Pixel';
    return 'Other';
  }
  return 'Other';
}

function parseBrandModelStorage(raw) {
  const input = (raw == null ? '' : String(raw));
  const trimmed = input.trim();
  if (!trimmed) return { brand: 'Other', model: '', storage: undefined, series: undefined };

  const lower = trimmed.toLowerCase();
  const brand = detectBrandCjs(lower);

  let working = trimmed;
  const firstToken = working.split(/\s+/, 1)[0];
  if (firstToken && LEADING_BRAND_TOKENS_CJS.has(firstToken.toLowerCase())) {
    working = working.slice(firstToken.length).replace(/^\s+/, '');
  }

  const { model: modelWithoutStorage, storage } = extractStorage(working);
  const model = collapseWhitespace(modelWithoutStorage);
  const series = detectSeriesCjs(brand, lower);
  return { brand, model, storage, series };
}

// Preserve IMEIs verbatim: client data includes alphanumeric Apple serials
// (e.g. "NL6CMQCYTD", "SKC9P3QVP6F"), so we MUST NOT strip non-digits.
function normalizeImei(raw) {
  if (raw === undefined || raw === null) return '';
  // If openpyxl/SheetJS handed us a number (15-digit IMEI), render as integer.
  if (typeof raw === 'number') {
    if (Number.isInteger(raw)) return raw.toFixed(0);
    return String(raw);
  }
  return String(raw).trim().replace(/^["'\s]+|["'\s]+$/g, '');
}

function normaliseSupplier(raw) {
  if (!raw) return 'Unknown';
  const key = raw.toUpperCase().trim();
  return cfg.supplierAliases[key] || (raw.trim() || 'Unknown');
}

/**
 * parseQuantityCell — INVENTORY-sheet QUANTITY column is mixed-type:
 * numeric values, "SHS" placeholders, "NO STOCK" tags, blanks, etc.
 *
 * Returns either:
 *   - `{ qty: <number> }`                            when numeric
 *   - `{ qty: undefined, flag, raw }`                when non-numeric
 *     where flag ∈ 'SHS' | 'NO_STOCK' | 'OTHER'
 *
 * Callers must keep the row in either case (B8 fix — non-numeric QUANTITY
 * rows used to be silently dropped at the BP guard).
 */
function parseQuantityCell(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return { qty: v };

  const raw   = (v === undefined || v === null) ? '' : String(v).trim();
  const upper = raw.toUpperCase();

  if (upper === 'SHS')                              return { qty: undefined, flag: 'SHS',      raw };
  if (upper === 'NO STOCK' || upper === 'NOSTOCK')  return { qty: undefined, flag: 'NO_STOCK', raw };

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
function parseSupplierCell(v) {
  const raw = (v === undefined || v === null) ? '' : String(v).trim();
  if (!raw) return { primaryName: '', allNames: [] };
  const allNames = raw
    .split('/')
    .map(s => s.trim())
    .filter(s => s.length > 0);
  return { primaryName: allNames[0] || '', allNames };
}

function normalisePlatform(raw) {
  if (!raw) return '';
  const key = raw.toUpperCase().trim();
  return cfg.platformAliases[key] || raw.trim();
}

const COLOUR_LIST = [
  'NATURAL TITANIUM', 'BLACK TITANIUM', 'WHITE TITANIUM', 'BLUE TITANIUM',
  'DESERT TITANIUM', 'PACIFIC BLUE', 'SIERRA BLUE', 'ALPINE GREEN',
  'STARLIGHT', 'MIDNIGHT', 'SPACE GREY', 'SPACE GRAY', 'GRAPHITE',
  'PHANTOM BLACK', 'PHANTOM WHITE', 'PHANTOM SILVER',
  'ROSE GOLD', 'PRODUCT RED', 'SILVER', 'GOLD', 'BLACK', 'WHITE',
  'BLUE', 'GREEN', 'YELLOW', 'PURPLE', 'CORAL', 'MINT', 'PINK',
  'TEAL', 'ORANGE', 'RED', 'CREAM', 'LAVENDER',
];

function parseColour(model, rawColour) {
  if (rawColour && rawColour.toLowerCase() !== 'unknown' && rawColour.toLowerCase() !== 'nan') {
    return rawColour.trim();
  }
  const m = model.toUpperCase();
  for (const c of COLOUR_LIST) {
    if (m.includes(c)) {
      if (c === 'SPACE GREY' || c === 'SPACE GRAY') return 'Space Grey';
      return c.charAt(0) + c.slice(1).toLowerCase();
    }
  }
  return 'Unknown';
}

function parseCategory(model) {
  const m = model.toUpperCase();
  if (m.includes('IPAD PRO') || m.includes('IPAD AIR') || m.includes('IPAD MINI')) return 'iPad';
  if (m.includes('IPAD'))          return 'iPad';
  if (m.includes('APPLE WATCH') || m.includes('WATCH ULTRA') || m.includes('WATCH SE')) return 'Apple Watch';
  if (m.includes('IPHONE'))        return 'iPhone';
  if (m.includes('GALAXY TAB') || m.includes('TAB A') || m.includes('TAB S')) return 'Tablet';
  if (m.match(/GALAXY S\d|S20|S21|S22|S23|S24|S25/)) return 'Samsung S Series';
  if (m.match(/GALAXY A\d|A\d{2}/))                   return 'Samsung A Series';
  if (m.includes('SAMSUNG') || m.includes('GALAXY'))  return 'Samsung A Series';
  return 'Other';
}

function parseBrand(category) {
  if (['iPhone', 'iPad', 'Apple Watch'].includes(category)) return 'Apple';
  if (category.startsWith('Samsung')) return 'Samsung';
  return 'Other';
}

function buildUnitId(imei, model, dateIn, supplierId, buyPrice, status) {
  const key = [imei || model, dateIn, supplierId, buyPrice, status].join('|');
  return 'u_' + crypto.createHash('md5').update(key).digest('hex').slice(0, 16);
}

function isValidRow(model) {
  if (!model || !model.trim()) return false;
  // Skip obvious header/separator rows
  if (model.toUpperCase().includes('MODEL') && model.length < 10) return false;
  return true;
}

function isSoldStatus(raw) {
  const upper = (raw || '').toUpperCase().trim();
  return cfg.masterExcel.soldStatusValues.some(v => upper === v.toUpperCase());
}

// ── Main Parse ────────────────────────────────────────────────────────────────

function parseWorksheet(ws, verbose) {
  const rows  = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const startRow = cfg.masterExcel.headerRow;
  const header   = rows[startRow] || [];

  const cols = resolveColIndices(header);

  if (verbose) {
    console.log('\n  Detected column indices:');
    for (const [k, v] of Object.entries(cols)) {
      const headerLabel = v >= 0 ? `"${header[v]}" (col ${v})` : '— not found';
      console.log(`    ${k.padEnd(12)} → ${headerLabel}`);
    }
  }

  const supplierMap = new Map();
  const unitMap     = new Map();
  let skipped       = 0;
  let duplicates    = 0;

  for (let i = startRow + 1; i < rows.length; i++) {
    const r = rows[i];

    // Skip fully empty rows
    if (r.every(cell => !cell || cell.toString().trim() === '')) continue;

    const rawModel = getCell(r, cols.model);
    if (!isValidRow(rawModel)) { skipped++; continue; }
    // Split brand / model / storage / series so the doc carries first-class
    // fields (drives Inventory list filters + periodic-table grouping in the
    // UI without re-parsing at read time).
    const parsedBMS = parseBrandModelStorage(rawModel);
    const { brand: parsedBrand, model, storage: modelStorage, series: parsedSeries } = parsedBMS;

    const rawImei      = getCell(r, cols.imei);
    // Preserve IMEIs verbatim: alphanumeric Apple serials (e.g. "NL6CMQCYTD") must not be stripped.
    const imei         = normalizeImei(rawImei);
    const rawSupplier  = getCell(r, cols.supplier, 'Unknown');
    // B7 fix: a single cell may carry multiple suppliers ("MHL / ABC / NIHAL").
    // primaryName drives the legacy supplierId; the full list is preserved on the unit.
    const supParsed    = parseSupplierCell(rawSupplier);
    const supplierName = normaliseSupplier(supParsed.primaryName || rawSupplier);
    const supplierNamesAll = supParsed.allNames.length > 0
      ? supParsed.allNames.map(n => normaliseSupplier(n))
      : [supplierName];
    const buyPrice     = parseFloat(getCell(r, cols.buyPrice, '0')) || 0;
    const rawStatus    = getCell(r, cols.status);
    const isSold       = isSoldStatus(rawStatus);
    const rawPlatform  = getCell(r, cols.platform);
    const platform     = normalisePlatform(rawPlatform);
    const salePrice    = parseFloat(getCell(r, cols.salePrice, '0')) || 0;
    const dateIn       = excelDateToISO(r[cols.dateIn >= 0 ? cols.dateIn : 0]);
    const rawSaleDate  = cols.saleDate >= 0 ? r[cols.saleDate] : null;
    const saleDate     = rawSaleDate ? excelDateToISO(rawSaleDate) : dateIn;
    const rawColour    = getCell(r, cols.colour);
    const rawStorage   = getCell(r, cols.storage);
    const rawCondition = getCell(r, cols.condition);
    const rawNotes     = getCell(r, cols.notes);
    const rawOrderNum  = getCell(r, cols.orderNum);
    const rawCustomer  = getCell(r, cols.customer);

    // Build supplier(s). One synthetic id per supplier name; the first is primary.
    const supplierIdFor = (name) => {
      const id = `sup_${name.replace(/\s+/g, '_').toLowerCase()}`;
      if (!supplierMap.has(id)) {
        supplierMap.set(id, {
          id,
          name,
          portal:    'Direct',
          ownerId:   cfg.firebase.ownerIdCli,
          createdAt: new Date().toISOString(),
        });
      }
      return id;
    };
    const supplierId  = supplierIdFor(supplierName);
    const supplierIds = supplierNamesAll.map(supplierIdFor);

    const category  = parseCategory(model);
    // Prefer parseBrandModelStorage's brand (covers Google/Xiaomi/OnePlus +
    // recognises bare "S21"/"A32" forms); fall back to the legacy
    // category-derived brand only when the new detector says 'Other'.
    const brand     = parsedBrand !== 'Other' ? parsedBrand : parseBrand(category);
    const colour    = parseColour(model, rawColour);
    const unitId    = buildUnitId(imei, model, dateIn, supplierId, buyPrice, rawStatus);
    const dedupeKey = imei || unitId;

    if (unitMap.has(dedupeKey)) {
      if (verbose) console.log(`  [DUPE] Row ${i + 1}: ${model} (${imei || 'no IMEI'})`);
      duplicates++;
      if (!cfg.import.upsertOnConflict) continue;
    }

    const status = isSold ? 'sold' : 'available';
    const listingSites = (!isSold && platform) ? [platform] : [];

    // Prefer the dedicated Storage column when present, fall back to the value
    // we extracted out of the MODEL string above.
    const storage = rawStorage || modelStorage || undefined;

    const unit = {
      id:             unitId,
      imei,
      model:          model.trim(),
      brand,
      ...(parsedSeries ? { series: parsedSeries } : {}),
      category,
      colour,
      storage,
      conditionGrade: rawCondition || undefined,
      buyPrice,
      dateIn,
      supplierId,
      ...(supplierIds.length > 1 ? { supplierIds } : {}),
      status,
      flags:          [],
      notes:          rawNotes || '',
      platformListed: !isSold && listingSites.length > 0,
      listingSites,
      ownerId:        cfg.firebase.ownerIdCli,
      createdAt:      new Date().toISOString(),
      updatedAt:      new Date().toISOString(),
      ...(isSold && platform  ? { salePlatform: platform }  : {}),
      ...(isSold && salePrice ? { salePrice }                : {}),
      ...(isSold              ? { saleDate }                 : {}),
      ...(rawOrderNum         ? { saleOrderId: rawOrderNum } : {}),
      ...(rawCustomer         ? { customerName: rawCustomer }: {}),
    };

    unitMap.set(dedupeKey, unit);

    if (verbose && i <= startRow + 6) {
      console.log(`  [Row ${i + 1}] ${status.toUpperCase()} | ${model} | ${colour} | £${buyPrice}`);
    }
  }

  const units     = Array.from(unitMap.values());
  const suppliers = Array.from(supplierMap.values());

  return {
    suppliers,
    units,
    stats: {
      total:      units.length,
      available:  units.filter(u => u.status === 'available').length,
      sold:       units.filter(u => u.status === 'sold').length,
      skipped,
      duplicates,
    },
  };
}

// ── Entry Point ───────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv);

  if (args.help) { printHelp(); process.exit(0); }

  const verbose = Boolean(args.verbose);

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log(  '║         MOBILEPHONEMARKET — Excel Import Tool v2.0          ║');
  console.log(  '╚══════════════════════════════════════════════════════════════╝\n');

  // ── Resolve file ──────────────────────────────────────────────────────────
  const filePath = resolveExcelFile(args.file);
  if (!filePath) {
    console.error('❌ Could not locate master Excel file.');
    console.error('   Tried paths from client.config.js masterExcel.nameHints');
    console.error('   Use: node import_excel.cjs --file "path/to/file.xlsx"');
    process.exit(1);
  }
  console.log(`📂 File: ${filePath}`);
  console.log(`   Size: ${(fs.statSync(filePath).size / 1024).toFixed(0)} KB`);

  // ── Read workbook ─────────────────────────────────────────────────────────
  let wb;
  try {
    // raw + cellDates: keep 15-digit IMEIs as strings, avoid 1.23e+14 coercion; preserve dates as Date objects.
    wb = XLSX.read(fs.readFileSync(filePath), { type: 'buffer', cellDates: true, raw: true });
  } catch (err) {
    console.error('❌ Failed to read Excel file:', err.message);
    process.exit(1);
  }

  const sheetName = resolveSheet(wb, args.sheet);
  console.log(`📋 Sheet: "${sheetName}" (available: ${wb.SheetNames.join(', ')})`);

  const ws = wb.Sheets[sheetName];
  if (!ws) {
    console.error(`❌ Sheet "${sheetName}" not found in workbook.`);
    process.exit(1);
  }

  // ── Parse ─────────────────────────────────────────────────────────────────
  console.log('\n⏳ Parsing rows...\n');
  const result = parseWorksheet(ws, verbose);

  // ── Stats ─────────────────────────────────────────────────────────────────
  const { stats } = result;
  console.log('┌─────────────────────────────────────────────────────┐');
  console.log(`│  Total units parsed : ${String(stats.total).padEnd(28)} │`);
  console.log(`│  Available          : ${String(stats.available).padEnd(28)} │`);
  console.log(`│  Sold (historical)  : ${String(stats.sold).padEnd(28)} │`);
  console.log(`│  Suppliers detected : ${String(result.suppliers.length).padEnd(28)} │`);
  console.log(`│  Skipped rows       : ${String(stats.skipped).padEnd(28)} │`);
  console.log(`│  Duplicate IMEIs    : ${String(stats.duplicates).padEnd(28)} │`);
  console.log('└─────────────────────────────────────────────────────┘');

  if (result.suppliers.length > 0) {
    console.log(`\n  Suppliers: ${result.suppliers.map(s => s.name).join(' · ')}`);
  }

  if (args.dryRun) {
    console.log('\n✅ Dry run complete — no files written.\n');
    return;
  }

  // ── Write primary output ──────────────────────────────────────────────────
  const outputPath = args.output
    || process.env.IMPORT_OUTPUT_PATH
    || cfg.output.importedInventoryJson;

  const payload = { suppliers: result.suppliers, units: result.units };
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));
  const sizeKb = (fs.statSync(outputPath).size / 1024).toFixed(0);
  console.log(`\n✅ Written: ${outputPath}  (${sizeKb} KB)`);

  // ── Optional: write to public/ for in-app seeding ─────────────────────────
  const publicPath = args.public || null;
  if (publicPath) {
    const resolved = path.resolve(publicPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, JSON.stringify(payload, null, 2));
    console.log(`✅ Written: ${resolved}  (public seed)`);
  }

  console.log('\n  Next steps:');
  console.log('  1. Run: node upload_to_firestore.cjs   (push to Firestore)');
  console.log('  2. Or add --public public/imported_inventory.json to seed the app bundle');
  console.log('  3. Or run the app and use the Import Excel button in the UI\n');
}

main();
