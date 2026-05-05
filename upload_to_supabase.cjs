/**
 * upload_to_supabase.cjs  —  Production-grade Supabase upload tool
 *
 * Reads imported_inventory.json and uploads all suppliers and units
 * to Supabase in batches of 499. All config comes from client.config.cjs
 * and the .env file.
 *
 * Usage:
 *   node upload_to_supabase.cjs                          # uses imported_inventory.json
 *   node upload_to_supabase.cjs --input ./my_data.json   # custom input file
 *   node upload_to_supabase.cjs --dry-run                # validate without writing
 *   node upload_to_supabase.cjs --help
 */

'use strict';

const { createClient } = require('@supabase/supabase-js');
const fs               = require('fs');
const path             = require('path');
const dotenv           = require('dotenv');
const cfg              = require('./client.config.cjs');

dotenv.config();

// ── CLI Arg Parser ────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { input: null, dryRun: false, help: false, verbose: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help'    || a === '-h')              { args.help    = true;     continue; }
    if (a === '--dry-run')                             { args.dryRun  = true;     continue; }
    if (a === '--verbose' || a === '-v')               { args.verbose = true;     continue; }
    if ((a === '--input'  || a === '-i') && argv[i+1]){ args.input   = argv[++i]; continue; }
  }
  return args;
}

function printHelp() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║         MOBILEPHONEMARKET — Supabase Upload Tool v2.0               ║
╚══════════════════════════════════════════════════════════════════════╝

Usage:
  node upload_to_supabase.cjs [options]

Options:
  -i, --input <path>   Input JSON file (default: imported_inventory.json)
      --dry-run        Parse and validate without writing to Supabase
  -v, --verbose        Log each batch operation
  -h, --help           Show this help

Examples:
  node upload_to_supabase.cjs
  node upload_to_supabase.cjs --input og_inventory_import.json
  node upload_to_supabase.cjs --dry-run --verbose
`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv);
  if (args.help) { printHelp(); process.exit(0); }

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log(  '║         MOBILEPHONEMARKET — Supabase Upload Tool v2.0       ║');
  console.log(  '╚══════════════════════════════════════════════════════════════╝\n');

  // ── Load input JSON ───────────────────────────────────────────────────────
  const inputPath = args.input || cfg.output.importedInventoryJson;
  if (!fs.existsSync(inputPath)) {
    console.error(`❌ Input file not found: ${inputPath}`);
    console.error('   Run: node import_excel.cjs  (to generate it first)');
    process.exit(1);
  }

  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  } catch (err) {
    console.error('❌ Failed to parse input JSON:', err.message);
    process.exit(1);
  }

  const { suppliers = [], units = [] } = payload;
  console.log(`📂 Input : ${inputPath}`);
  console.log(`   Suppliers : ${suppliers.length}`);
  console.log(`   Units     : ${units.length}`);
  console.log(`   Available : ${units.filter(u => u.status === 'available').length}`);
  console.log(`   Sold      : ${units.filter(u => u.status === 'sold').length}`);

  if (args.dryRun) {
    console.log('\n✅ Dry run — Supabase write skipped.\n');
    return;
  }

  // ── Initialise Supabase ───────────────────────────────────────────────────
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env file');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  const BATCH_SIZE  = cfg.import.firestoreBatchSize;
  const OWNER_ID    = cfg.firebase.ownerIdCli;
  const now         = new Date().toISOString();

  // ── 1. Upload suppliers ───────────────────────────────────────────────────
  console.log('\n→ Uploading suppliers...');
  let supDone = 0;
  for (let i = 0; i < suppliers.length; i += BATCH_SIZE) {
    const chunk = suppliers.slice(i, i + BATCH_SIZE).map(s => ({
      id:            s.id,
      name:          s.name,
      portal:        s.portal || 'Direct',
      contact_name:  s.contactName || null,
      contact_email: s.contactEmail || null,
      phone:         s.phone || null,
      address:       s.address || null,
      payment_terms: s.paymentTerms || null,
      return_terms:  s.returnTerms || null,
      notes:         s.notes || null,
      website_url:   s.websiteUrl || null,
      owner_id:      OWNER_ID,
      created_at:    s.createdAt || now,
      updated_at:    now,
    }));
    
    const { error } = await supabase.from('suppliers').upsert(chunk);
    if (error) {
      console.error('❌ Failed to upload suppliers:', error.message);
      process.exit(1);
    }
    supDone += chunk.length;
    if (args.verbose) console.log(`  Uploaded ${supDone} suppliers...`);
  }
  console.log(`  ✓ ${supDone} suppliers uploaded`);

  // ── 2. Upload units in batches ────────────────────────────────────────────
  console.log('\n→ Uploading inventory units...');
  let uploaded   = 0;
  let batchCount = 0;

  for (let i = 0; i < units.length; i += BATCH_SIZE) {
    const chunk = units.slice(i, i + BATCH_SIZE).map(u => ({
      id:               u.id,
      imei:             u.imei || '',
      model:            u.model || '',
      brand:            u.brand || 'Other',
      category:         u.category || 'Other',
      colour:           u.colour || 'Unknown',
      storage:          u.storage || null,
      condition_grade:  u.conditionGrade || null,
      buy_price:        u.buyPrice || 0,
      date_in:          u.dateIn || '',
      supplier_id:      u.supplierId || '',
      status:           u.status || 'available',
      flags:            u.flags || [],
      notes:            u.notes || '',
      platform_listed:  Boolean(u.platformListed),
      listing_sites:    u.listingSites || [],
      sale_price:       u.salePrice || null,
      sale_date:        u.saleDate || null,
      sale_platform:    u.salePlatform || null,
      sale_order_id:    u.saleOrderId || null,
      customer_name:    u.customerName || null,
      return_type:      u.returnType || null,
      return_date:      u.returnDate || null,
      return_reason:    u.returnReason || null,
      owner_id:         OWNER_ID,
      created_at:       u.createdAt || now,
      updated_at:       now,
    }));

    const { error } = await supabase.from('inventory_units').upsert(chunk);
    if (error) {
      console.error(`❌ Batch ${batchCount+1} failed:`, error.message);
      process.exit(1);
    }

    uploaded   += chunk.length;
    batchCount++;
    const pct = Math.round((uploaded / units.length) * 100);
    process.stdout.write(`\r  Batch ${batchCount}: ${uploaded}/${units.length} units (${pct}%)   `);
  }
  console.log('');

  console.log(`\n✅ Upload complete!`);
  console.log(`   Suppliers : ${supDone}`);
  console.log(`   Units     : ${uploaded}\n`);

  process.exit(0);
}

main().catch(err => {
  console.error('\n❌ Upload failed:', err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
