import * as XLSX from 'xlsx';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Column Layout (must match ImportModal.tsx parseOGStockSheet) ─────────────
// Col 0: Date In       (Excel date serial or YYYY-MM-DD string)
// Col 1: Model         (auto-detects category, brand, colour from model name)
// Col 2: IMEI / Serial (numeric IMEI or alphanumeric serial)
// Col 3: Supplier Name (auto-creates supplier record)
// Col 4: Buy Price     (£ number)
// Col 5: Status        (AVAILABLE or SOLD)
// Col 6: Sale Platform (eBay / Amazon / OnBuy / Backmarket / Other)
// Col 7: Sale Price    (£ number, only needed if Status = SOLD)

const headers = [
  'Date In',
  'Model',
  'IMEI / Serial Number',
  'Supplier Name',
  'Buy Price (£)',
  'Status',
  'Sale Platform',
  'Sale Price (£)',
];

const sampleRows = [
  // --- iPhone rows ---
  ['2026-01-05', 'Apple iPhone 15 Pro Max 256GB Natural Titanium',   '352461234567890', 'Direct Supplies Ltd',     820, 'AVAILABLE', '',         ''],
  ['2026-01-05', 'Apple iPhone 15 Pro 128GB Black Titanium',          '358912345678901', 'Direct Supplies Ltd',     650, 'AVAILABLE', '',         ''],
  ['2026-01-12', 'Apple iPhone 14 Pro 256GB Space Black',             '357123456789012', 'Wholesale Corp UK',       480, 'AVAILABLE', '',         ''],
  ['2026-01-12', 'Apple iPhone 14 128GB Midnight',                    '359012345678903', 'Wholesale Corp UK',       360, 'AVAILABLE', '',         ''],
  ['2025-12-20', 'Apple iPhone 13 Pro Max 256GB Graphite',            '354321098765432', 'PhoneHub Auctions',       310, 'SOLD',      'eBay',      480],
  ['2025-12-22', 'Apple iPhone 13 128GB Starlight',                   '356789012345678', 'PhoneHub Auctions',       220, 'SOLD',      'Amazon',    340],
  ['2026-02-01', 'Apple iPhone 15 256GB Pink',                        '353456789012345', 'Direct Supplies Ltd',     600, 'AVAILABLE', '',         ''],

  // --- iPad rows ---
  ['2026-01-08', 'Apple iPad Air 5th Gen 64GB Space Grey',            'J33G51QXQL',      'Wholesale Corp UK',       320, 'AVAILABLE', '',         ''],
  ['2026-01-08', 'Apple iPad Mini 6th Gen 256GB Starlight',           'GYWPQ4HMKL',      'Wholesale Corp UK',       370, 'AVAILABLE', '',         ''],
  ['2025-11-15', 'Apple iPad Pro 12.9 256GB Space Grey WiFi',         'H71TKRMVNQ',      'Direct Supplies Ltd',     590, 'SOLD',      'Backmarket',730],

  // --- Apple Watch rows ---
  ['2026-01-20', 'Apple Watch Ultra 2 49mm Black Titanium',           'F3KPQM892JX',     'Direct Supplies Ltd',     580, 'AVAILABLE', '',         ''],
  ['2026-01-20', 'Apple Watch Series 9 45mm Midnight',                'D9VMQK17LRX',     'PhoneHub Auctions',       280, 'AVAILABLE', '',         ''],

  // --- Samsung rows ---
  ['2026-02-03', 'Samsung Galaxy S24 Ultra 256GB Titanium Black',     '357901234567890', 'Wholesale Corp UK',       730, 'AVAILABLE', '',         ''],
  ['2026-02-03', 'Samsung Galaxy S24 128GB Phantom Black',            '356543210987654', 'Wholesale Corp UK',       520, 'AVAILABLE', '',         ''],
  ['2025-12-30', 'Samsung Galaxy S23 FE 128GB Cream',                 '358234567890123', 'PhoneHub Auctions',       280, 'SOLD',      'OnBuy',     390],
  ['2026-01-25', 'Samsung Galaxy A54 5G 128GB Awesome Black',         '355678901234567', 'Direct Supplies Ltd',     200, 'AVAILABLE', '',         ''],
  ['2026-01-25', 'Samsung Galaxy A34 128GB Awesome Silver',           '352012345678901', 'Direct Supplies Ltd',     160, 'AVAILABLE', '',         ''],

  // --- Very old stock (will appear in Oldest Unsold dashboard) ---
  ['2024-08-10', 'Apple iPhone 12 Pro 128GB Pacific Blue',            '354987654321098', 'PhoneHub Auctions',       195, 'AVAILABLE', '',         ''],
  ['2024-09-01', 'Samsung Galaxy S22 Ultra 256GB Burgundy',           '359876543210987', 'Wholesale Corp UK',       260, 'AVAILABLE', '',         ''],
  ['2024-11-01', 'Apple iPhone 12 64GB Black',                        '353210987654321', 'PhoneHub Auctions',       150, 'AVAILABLE', '',         ''],
];

// ─── Build Workbook ──────────────────────────────────────────────────────────
const wb = XLSX.utils.book_new();

// Sheet 1: OG STOCK DATA (this is the sheet the app reads by default)
const wsData = [headers, ...sampleRows];
const ws = XLSX.utils.aoa_to_sheet(wsData);

// Style column widths
ws['!cols'] = [
  { wch: 14 },  // Date In
  { wch: 50 },  // Model
  { wch: 22 },  // IMEI
  { wch: 22 },  // Supplier
  { wch: 14 },  // Buy Price
  { wch: 12 },  // Status
  { wch: 14 },  // Sale Platform
  { wch: 14 },  // Sale Price
];

XLSX.utils.book_append_sheet(wb, ws, 'OG STOCK DATA');

// Sheet 2: INSTRUCTIONS — for the client
const instructions = [
  ['COLUMN',              'REQUIRED?', 'FORMAT',                              'NOTES'],
  ['Date In',             'Required',  'YYYY-MM-DD (e.g. 2026-01-05)',        'Date the device arrived in your office'],
  ['Model',               'Required',  'Full model name as text',             'App auto-detects: brand, category, colour from name'],
  ['IMEI / Serial Number','Required',  '15-digit IMEI or alphanumeric serial','Must be unique per device'],
  ['Supplier Name',       'Required',  'Plain text',                          'Auto-creates supplier record. Use consistent spelling.'],
  ['Buy Price (£)',        'Required',  'Number (e.g. 499.99)',                'The price you paid for the device'],
  ['Status',              'Required',  'AVAILABLE or SOLD',                   'Use AVAILABLE for stock on hand. SOLD for historical records.'],
  ['Sale Platform',       'Optional',  'eBay, Amazon, OnBuy, Backmarket, Other','Only needed if Status = SOLD'],
  ['Sale Price (£)',       'Optional',  'Number (e.g. 649.99)',                'Only needed if Status = SOLD'],
  [],
  ['TIPS'],
  ['- The sheet must be named "OG STOCK DATA". Any other sheet will also be accepted if that name is absent.'],
  ['- Colour is auto-detected from the model name. E.g. "iPhone 15 Black Titanium" → Colour: Black Titanium'],
  ['- Importing the same IMEI twice will UPDATE the existing record, not create a duplicate.'],
  ['- Rows with a blank Model column are skipped automatically.'],
];

const wsInstructions = XLSX.utils.aoa_to_sheet(instructions);
wsInstructions['!cols'] = [{ wch: 24 }, { wch: 12 }, { wch: 35 }, { wch: 65 }];
XLSX.utils.book_append_sheet(wb, wsInstructions, 'INSTRUCTIONS');

// ─── Save ────────────────────────────────────────────────────────────────────
const outputPath = path.join(__dirname, 'SAMPLE_INVENTORY_IMPORT.xlsx');
XLSX.writeFile(wb, outputPath);
console.log(`✅ Sample Excel generated: ${outputPath}`);
console.log(`   Rows: ${sampleRows.length} devices across ${new Set(sampleRows.map(r => r[3])).size} suppliers`);
