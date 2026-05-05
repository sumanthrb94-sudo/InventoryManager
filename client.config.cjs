/**
 * client.config.js  —  Master client configuration for the Inventory Manager
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  ONBOARDING: Edit this file once per client deployment.                 │
 * │  All import scripts, CLI tools, and seeding utilities read from here.   │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Usage in Node scripts:
 *   const cfg = require('./client.config.js');
 *   console.log(cfg.masterExcel.filePath);
 */

'use strict';

const path = require('path');

// ── 1. Business Identity ─────────────────────────────────────────────────────
const BUSINESS = {
  /** Display name shown in app header, reports, PDFs */
  name:         'MOBILEPHONEMARKET',
  /** Short tagline beneath name */
  tagline:      'Inventory Manager',
  /** Default currency symbol */
  currency:     '£',
  /** Default outbound postage cost (deducted from margin calculations) */
  postageCost:  8,
  /** Stock location label */
  stockLocation: 'office',
};

// ── 2. Master Excel Configuration ────────────────────────────────────────────
// Point this to the master inventory Excel workbook.
// Supports absolute paths, relative paths (resolved from project root), or
// a filename if the file is placed in the project root directory.
const MASTER_EXCEL = {
  /**
   * Path to the master Excel file.
   * Priority order (first found wins):
   *   1. CLI --file argument
   *   2. MASTER_EXCEL_PATH environment variable
   *   3. This config value
   *   4. Auto-discovery: looks for *.xlsx in project root matching nameHints
   */
  filePath: path.resolve(__dirname, 'SAMPLE_INVENTORY_REPORT_2026.xlsx'),

  /**
   * Filename patterns to try when auto-discovering the master file.
   * Listed in priority order.
   */
  nameHints: [
    'SAMPLE_INVENTORY_REPORT_2026.xlsx',
    'INVENTORY REPORT 2026.xlsx',
    'INVENTORY_QA_TEST_5000.xlsx',
    'inventory_10k_qa.xlsx',
  ],

  /**
   * Name of the worksheet to read.
   * If null/empty, the importer will try these sheets in order:
   *   'OG STOCK DATA' → Sheet1 → first sheet
   */
  sheetName: null, // null = auto-detect

  /** Fallback sheets to try in order if sheetName is not found */
  sheetFallbacks: ['OG STOCK DATA', 'Sheet1', 'Data', 'Inventory'],

  /**
   * Column header mappings — keys are internal field names,
   * values are arrays of possible Excel column header names (case-insensitive).
   * Add your client's actual header names to any array as needed.
   */
  columnMap: {
    dateIn:    ['Date In', 'Date Added', 'Stock In', 'Received Date', 'Date'],
    model:     ['Model', 'Device', 'Description', 'Product'],
    imei:      ['IMEI', 'IMEI/Serial', 'Serial', 'S/N', 'Serial Number'],
    supplier:  ['Supplier', 'Source', 'From', 'Vendor'],
    buyPrice:  ['Buy Price', 'BP', 'Cost', 'Purchase Price', 'Cost Price'],
    status:    ['Status', 'Available', 'State', 'Stock Status'],
    platform:  ['Platform', 'Sale Platform', 'Listed On', 'Marketplace'],
    salePrice: ['Sale Price', 'SP', 'Price Sold', 'Sold For'],
    saleDate:  ['Sale Date', 'Date Sold', 'Sold Date'],
    colour:    ['Colour', 'Color', 'Colour/Color'],
    storage:   ['Storage', 'Capacity', 'GB'],
    condition: ['Condition', 'Grade', 'Condition Grade'],
    notes:     ['Notes', 'Note', 'Comments', 'Remarks'],
    orderNum:  ['Order Number', 'Order No', 'Order #', 'Order ID'],
    customer:  ['Customer Name', 'Customer', 'Buyer'],
  },

  /**
   * Row index (0-based) where data starts.
   * 0 = first row is header, data starts at row 1.
   * 1 = first two rows are headers/metadata, data starts at row 2.
   */
  headerRow: 0,

  /**
   * Status values that mark a unit as sold (case-insensitive).
   */
  soldStatusValues: ['SOLD', 'SALE', 'COMPLETED'],

  /**
   * Status values that mark a unit as returned (case-insensitive).
   */
  returnedStatusValues: ['RETURNED', 'RETURN'],
};

// ── 3. Supplier Aliases ───────────────────────────────────────────────────────
// Map raw Excel supplier names → canonical supplier names.
// Add client-specific aliases here.
const SUPPLIER_ALIASES = {
  'NIHAL':      'Nihal',
  'ABC':        'ABC Trading',
  'RR STOCK':   'RR Stock',
  'RR':         'RR Stock',
  'NANAK':      'Nanak',
  'MHL':        'MHL',
  'IMAX':       'IMAX',
  'BUNTY':      'Bunty',
  'MOBILE KIT': 'Mobile Kit',
  'MHL-RR':     'MHL-RR',
  'UNKNOWN':    'Unknown',
};

// ── 4. Platform Aliases ───────────────────────────────────────────────────────
// Map raw Excel platform names → canonical listing site names.
const PLATFORM_ALIASES = {
  'EBAY':            'eBay',
  'E-BAY':           'eBay',
  'AMAZON':          'Amazon',
  'BACK MARKET':     'Backmarket',
  'BACKMARKET':      'Backmarket',
  'BACK-MARKET':     'Backmarket',
  'ONBUY':           'OnBuy',
  'ON BUY':          'OnBuy',
};

// ── 5. Firebase / Firestore ───────────────────────────────────────────────────
// These are read from firebase-applet-config.json at runtime.
// Override here only if running standalone CLI scripts without the config file.
const FIREBASE = {
  /** Path to firebase config JSON (relative to project root) */
  configPath:   path.resolve(__dirname, 'firebase-applet-config.json'),
  /** Owner ID stamped on all records created by CLI import scripts */
  ownerIdCli:   'shared',
};

// ── 6. Output Paths ───────────────────────────────────────────────────────────
const OUTPUT = {
  /** Where import_excel.cjs writes the parsed JSON */
  importedInventoryJson: path.resolve(__dirname, 'imported_inventory.json'),
  /** Where og-data importer writes its JSON */
  ogInventoryJson:       path.resolve(__dirname, 'og_inventory_import.json'),
  /** Where the public seed JSON is placed (served by Vite) */
  publicSeedJson:        path.resolve(__dirname, 'public', 'imported_inventory.json'),
  /** Where inject_to_localstorage writes the browser console script */
  injectConsoleJs:       path.resolve(__dirname, 'inject_console.js'),
};

// ── 7. Import Behaviour ───────────────────────────────────────────────────────
const IMPORT = {
  /** Batch size for Firestore writes */
  firestoreBatchSize: 499,
  /** Skip duplicate IMEIs within the same file */
  deduplicateImei: true,
  /** Update existing records on re-import (vs. skip them) */
  upsertOnConflict: true,
  /** Auto-set platformListed=true for available units that have a platform */
  autoSetPlatformListed: true,
};

// ── Export ────────────────────────────────────────────────────────────────────
module.exports = {
  business:        BUSINESS,
  masterExcel:     MASTER_EXCEL,
  supplierAliases: SUPPLIER_ALIASES,
  platformAliases: PLATFORM_ALIASES,
  firebase:        FIREBASE,
  output:          OUTPUT,
  import:          IMPORT,
};
