/**
 * import_og_data.cjs  —  Production-grade OG STOCK DATA importer
 *
 * Reads the master Excel workbook's "OG STOCK DATA" sheet and writes
 * a localStorage-compatible JSON file for browser injection or Firestore upload.
 *
 * All parameters come from client.config.js (no hardcoded paths).
 *
 * Usage:
 *   node import_og_data.cjs                          # auto-discover master Excel
 *   node import_og_data.cjs --file path/to/file.xlsx
 *   node import_og_data.cjs --file data.xlsx --sheet "Sheet1"
 *   node import_og_data.cjs --dry-run --verbose
 *   node import_og_data.cjs --help
 */

'use strict';

const XLSX   = require('xlsx');
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const cfg    = require('./client.config.cjs');

// ── CLI ───────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help'    || a === '-h')              { args.help    = true;     continue; }
    if (a === '--dry-run')                             { args.dryRun  = true;     continue; }
    if (a === '--verbose' || a === '-v')               { args.verbose = true;     continue; }
    if ((a === '--file'   || a === '-f') && argv[i+1]){ args.file    = argv[++i]; continue; }
    if ((a === '--sheet'  || a === '-s') && argv[i+1]){ args.sheet   = argv[++i]; continue; }
    if ((a === '--output' || a === '-o') && argv[i+1]){ args.output  = argv[++i]; continue; }
  }
  return args;
}

function printHelp() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║         MOBILEPHONEMARKET — OG Data Importer v2.0                   ║
╚══════════════════════════════════════════════════════════════════════╝

Usage:
  node import_og_data.cjs [options]

Options:
  -f, --file   <path>   Excel file path (auto-discovered from client.config.js if omitted)
  -s, --sheet  <name>   Sheet name (default: auto-detect from client.config.js fallbacks)
  -o, --output <path>   Output JSON path (default: og_inventory_import.json)
      --dry-run         Parse only — no files written
  -v, --verbose         Show detailed row-level logging
  -h, --help            Show this help
`);
}

// ── Resolve file ──────────────────────────────────────────────────────────────
function resolveFile(cliFile) {
  const candidates = [
    cliFile,
    process.env.MASTER_EXCEL_PATH,
    cfg.masterExcel.filePath,
    ...cfg.masterExcel.nameHints.map(n => path.resolve(__dirname, n)),
  ].filter(Boolean);

  for (const c of candidates) {
    const p = path.resolve(c);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function resolveSheet(wb, cliSheet) {
  const name = cliSheet || process.env.IMPORT_SHEET_NAME || cfg.masterExcel.sheetName;
  if (name && wb.SheetNames.includes(name)) return name;
  for (const fb of cfg.masterExcel.sheetFallbacks) {
    if (wb.SheetNames.includes(fb)) return fb;
  }
  return wb.SheetNames[0];
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function excelDateToISO(serial) {
  if (!serial || typeof serial !== 'number') return null;
  const d = new Date(Math.round((serial - 25569) * 86400 * 1000));
  return d.toISOString().split('T')[0];
}

function normaliseSupplier(raw) {
  if (!raw) return 'Unknown';
  const key = raw.toString().trim().toUpperCase();
  return cfg.supplierAliases[key] || raw.toString().trim() || 'Unknown';
}

function isValidSupplier(raw) {
  if (!raw) return false;
  if (!isNaN(Number(raw.toString().trim()))) return false;
  return raw.toString().trim().length > 0;
}

function normalisePlatform(raw) {
  if (!raw) return null;
  const key = raw.toString().trim().toUpperCase();
  return cfg.platformAliases[key] || raw.toString().trim() || null;
}

function normaliseModel(raw) {
  if (!raw) return null;
  let m = raw.toString().trim();
  m = m.replace(/^IPHONE/i,      'iPhone')
       .replace(/^IPAD/i,        'iPad')
       .replace(/^APPLE WATCH/i, 'Apple Watch')
       .replace(/^SAMSUNG /i,    'Samsung ');
  return m;
}

function guessCategory(model) {
  const m = (model || '').toUpperCase();
  if (m.includes('IPHONE'))                          return 'iPhone';
  if (m.includes('IPAD'))                            return 'iPad';
  if (m.includes('APPLE WATCH'))                     return 'Apple Watch';
  if (m.match(/SAMSUNG.*S\d\d|S20|S21|S22|S23|S24|S25/)) return 'Samsung S Series';
  if (m.match(/SAMSUNG.*A\d|GALAXY A/))              return 'Samsung A Series';
  if (m.includes('TAB'))                             return 'Tablet';
  return 'Other';
}

function guessBrand(model) {
  const m = (model || '').toUpperCase();
  if (m.includes('IPHONE') || m.includes('IPAD') || m.includes('APPLE')) return 'Apple';
  if (m.includes('SAMSUNG') || m.includes('GALAXY'))                       return 'Samsung';
  return 'Other';
}

function extractColour(model) {
  const COLOURS = [
    'NATURAL TITANIUM', 'BLACK TITANIUM', 'WHITE TITANIUM', 'BLUE TITANIUM',
    'DESERT TITANIUM', 'PACIFIC BLUE', 'SIERRA BLUE', 'ALPINE GREEN',
    'SPACE GREY', 'SPACE GRAY', 'GRAPHITE', 'STARLIGHT', 'MIDNIGHT',
    'PHANTOM BLACK', 'PHANTOM WHITE', 'PHANTOM SILVER',
    'ROSE GOLD', 'PRODUCT RED', 'SILVER', 'GOLD',
    'BLACK', 'WHITE', 'BLUE', 'GREEN', 'YELLOW', 'PURPLE',
    'CORAL', 'MINT', 'PINK', 'TEAL', 'ORANGE', 'RED', 'CREAM', 'LAVENDER',
    'ULTRA MARINE',
  ];
  const upper = (model || '').toUpperCase();
  for (const c of COLOURS) {
    if (upper.includes(c)) {
      if (c === 'SPACE GREY' || c === 'SPACE GRAY') return 'Space Grey';
      return c.charAt(0) + c.slice(1).toLowerCase();
    }
  }
  return 'Unknown';
}

function uid(...parts) {
  return crypto.createHash('md5').update(parts.join('|')).digest('hex').slice(0, 16);
}

// ── Main ──────────────────────────────────────────────────────────────────────
function main() {
  const args = parseArgs(process.argv);
  if (args.help) { printHelp(); process.exit(0); }

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log(  '║         MOBILEPHONEMARKET — OG Data Importer v2.0           ║');
  console.log(  '╚══════════════════════════════════════════════════════════════╝\n');

  const filePath = resolveFile(args.file);
  if (!filePath) {
    console.error('❌ Cannot locate master Excel file.');
    console.error('   Use: node import_og_data.cjs --file "path/to/file.xlsx"');
    process.exit(1);
  }
  console.log(`📂 File: ${filePath}`);
  console.log(`   Size: ${(fs.statSync(filePath).size / 1024).toFixed(0)} KB`);

  const wb        = XLSX.readFile(filePath, { cellDates: false });
  const sheetName = resolveSheet(wb, args.sheet);
  console.log(`📋 Sheet: "${sheetName}"  (available: ${wb.SheetNames.join(', ')})\n`);

  const ws   = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  // ── Detect header row ───────────────────────────────────────────────────────
  // Supports files with a title row before the actual header
  let headerRowIdx = cfg.masterExcel.headerRow;

  const suppliersMap = {};
  const units        = [];
  let skipped        = 0;

  const dataStart = headerRowIdx + 1;

  for (let i = dataStart; i < rows.length; i++) {
    const r           = rows[i];
    const rawModel    = r[1];
    const rawImei     = r[2];
    const rawSupplier = r[3];
    const rawCost     = r[4];
    const rawStatus   = r[5];
    const rawMarket   = r[6];
    const rawSalePrice= r[7];
    const rawDate     = r[0];

    const model = normaliseModel(rawModel);
    if (!model) { skipped++; continue; }

    // Skip rows where the "model" column contains a number (data bleed)
    if (!isNaN(Number(model.trim()))) { skipped++; continue; }

    const imei         = rawImei ? rawImei.toString().replace(/\D/g, '') : '';
    const supplierName = isValidSupplier(rawSupplier) ? normaliseSupplier(rawSupplier) : 'Unknown';
    const buyPrice     = parseFloat(rawCost) || 0;
    const isSold       = (rawStatus || '').toString().toUpperCase().trim() === 'SOLD';
    const platform     = normalisePlatform(rawMarket);
    const salePrice    = parseFloat(rawSalePrice) || undefined;
    const dateIn       = excelDateToISO(rawDate) || '2025-01-01';

    const supKey = supplierName.toUpperCase();
    if (!suppliersMap[supKey]) {
      suppliersMap[supKey] = {
        id:        'sup_' + uid(supKey),
        name:      supplierName,
        portal:    'Direct',
        ownerId:   cfg.firebase.ownerIdCli,
        createdAt: new Date().toISOString(),
      };
    }
    const supplierId = suppliersMap[supKey].id;

    const colour   = extractColour(model);
    const category = guessCategory(model);
    const brand    = guessBrand(model);
    const unitId   = 'u_' + uid(imei || (model + i), dateIn, supplierName);

    const unit = {
      id:             unitId,
      imei,
      model,
      brand,
      category,
      colour,
      buyPrice,
      dateIn,
      supplierId,
      status:         isSold ? 'sold' : 'available',
      flags:          [],
      notes:          '',
      platformListed: !isSold,
      ownerId:        cfg.firebase.ownerIdCli,
      createdAt:      new Date().toISOString(),
      updatedAt:      new Date().toISOString(),
      ...(isSold && platform  ? { salePlatform: platform }  : {}),
      ...(isSold && salePrice ? { salePrice }                : {}),
      ...(isSold              ? { saleDate: dateIn }         : {}),
    };

    units.push(unit);

    if (args.verbose && i < dataStart + 5) {
      console.log(`  [Row ${i + 1}] ${isSold ? 'SOLD' : 'AVAIL'} | ${model.slice(0, 40)} | £${buyPrice}`);
    }
  }

  const suppliers = Object.values(suppliersMap);
  const available = units.filter(u => u.status === 'available').length;
  const sold      = units.filter(u => u.status === 'sold').length;

  console.log('┌─────────────────────────────────────────────────────┐');
  console.log(`│  Total units   : ${String(units.length).padEnd(34)} │`);
  console.log(`│  Available     : ${String(available).padEnd(34)} │`);
  console.log(`│  Sold          : ${String(sold).padEnd(34)} │`);
  console.log(`│  Suppliers     : ${String(suppliers.length).padEnd(34)} │`);
  console.log(`│  Skipped rows  : ${String(skipped).padEnd(34)} │`);
  console.log('└─────────────────────────────────────────────────────┘');

  if (suppliers.length) {
    console.log(`\n  Suppliers: ${suppliers.map(s => s.name).join(' · ')}`);
  }

  if (args.dryRun) {
    console.log('\n✅ Dry run — no files written.\n');
    return;
  }

  const outputPath = args.output || cfg.output.ogInventoryJson;
  const out = { suppliers, units };
  fs.writeFileSync(outputPath, JSON.stringify(out));
  const kb = (JSON.stringify(out).length / 1024).toFixed(0);
  console.log(`\n✅ Written: ${outputPath}  (${kb} KB)`);
  console.log('\n  Next steps:');
  console.log('  1. node inject_to_localstorage.cjs  → generate browser injection script');
  console.log('  2. node upload_to_firestore.cjs      → push directly to Firestore\n');
}

main();
