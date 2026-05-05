/**
 * inject_to_localstorage.cjs  —  Generate browser localStorage injection script
 *
 * Reads an inventory JSON file and produces a browser console script
 * that injects the data into localStorage for offline/dev use.
 *
 * Usage:
 *   node inject_to_localstorage.cjs                            # uses og_inventory_import.json
 *   node inject_to_localstorage.cjs --input imported_inventory.json
 *   node inject_to_localstorage.cjs --output my_inject.js
 *   node inject_to_localstorage.cjs --help
 */

'use strict';

const fs  = require('fs');
const path = require('path');
const cfg = require('./client.config.cjs');

// ── CLI ───────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help'    || a === '-h')              { args.help   = true;     continue; }
    if ((a === '--input'  || a === '-i') && argv[i+1]){ args.input  = argv[++i]; continue; }
    if ((a === '--output' || a === '-o') && argv[i+1]){ args.output = argv[++i]; continue; }
  }
  return args;
}

function printHelp() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║       MOBILEPHONEMARKET — localStorage Injection Generator v2.0     ║
╚══════════════════════════════════════════════════════════════════════╝

Usage:
  node inject_to_localstorage.cjs [options]

Options:
  -i, --input  <path>  Input JSON file (default: og_inventory_import.json)
  -o, --output <path>  Output JS file  (default: inject_console.js)
  -h, --help           Show this help

Steps after generating:
  1. Open the app in Chrome (localhost or Vercel)
  2. Log in
  3. Open DevTools → Console (F12)
  4. Paste the contents of inject_console.js
  5. Press Enter — page reloads with all data loaded
`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
function main() {
  const args = parseArgs(process.argv);
  if (args.help) { printHelp(); process.exit(0); }

  const inputPath  = args.input  || cfg.output.ogInventoryJson;
  const outputPath = args.output || cfg.output.injectConsoleJs;

  if (!fs.existsSync(inputPath)) {
    console.error(`❌ Input file not found: ${inputPath}`);
    console.error('   Run first: node import_og_data.cjs  OR  node import_excel.cjs');
    process.exit(1);
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  } catch (err) {
    console.error('❌ Failed to parse input JSON:', err.message);
    process.exit(1);
  }

  const { suppliers = [], units = [] } = data;

  // JSON-encode and escape single quotes for safe embedding inside a JS string literal
  const suppliersJson = JSON.stringify(suppliers).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const unitsJson     = JSON.stringify(units).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  const script = `// ${cfg.business.name} ${cfg.business.tagline}
// Auto-generated localStorage injection script
// Generated: ${new Date().toISOString()}
// Source:    ${inputPath}
//
// INSTRUCTIONS:
//   1. Open the app in Chrome (localhost or Vercel)
//   2. Log in with your Google account
//   3. Open DevTools → Console (F12)
//   4. Paste this entire block and press Enter
//   5. The page will reload with ${units.length} units and ${suppliers.length} suppliers loaded
//
(function(){
  'use strict';
  try {
    localStorage.setItem('nexus_db_suppliers', '${suppliersJson}');
    localStorage.setItem('nexus_db_inventoryUnits', '${unitsJson}');
    console.log('%c✓ ${cfg.business.name} Inventory loaded!', 'color: #10b981; font-weight: bold; font-size: 14px;');
    console.log('  Suppliers: ${suppliers.length}');
    console.log('  Units:     ${units.length} (Available: ${units.filter(u => u.status === 'available').length}  ·  Sold: ${units.filter(u => u.status === 'sold').length})');
    window.location.reload();
  } catch(e) {
    console.error('❌ Injection failed:', e.message);
    console.warn('Possible cause: localStorage quota exceeded. Try clearing storage first:');
    console.warn('  Object.keys(localStorage).filter(k=>k.startsWith("nexus_db_")).forEach(k=>localStorage.removeItem(k))');
  }
})();
`;

  fs.writeFileSync(outputPath, script);

  console.log(`\n✅ Generated: ${outputPath}`);
  console.log(`   Suppliers: ${suppliers.length}`);
  console.log(`   Units:     ${units.length}`);
  console.log(`   Available: ${units.filter(u => u.status === 'available').length}`);
  console.log(`   Sold:      ${units.filter(u => u.status === 'sold').length}`);
  console.log('\n  Steps:');
  console.log('  1. Open your app in Chrome (localhost or Vercel)');
  console.log('  2. Log in with Google');
  console.log('  3. Open DevTools → Console (F12)');
  console.log('  4. Paste the contents of', outputPath);
  console.log('  5. Press Enter — page reloads with all data loaded\n');
}

main();
