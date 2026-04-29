/**
 * import_excel.js
 * 
 * Reads the INVENTORY REPORT xlsx and outputs clean JSON
 * ready for Firestore import.
 * 
 * OG STOCK DATA sheet columns:
 *   [0] Date Added   (Excel serial number or blank)
 *   [1] Model        (e.g. "IPHONE 15 PRO MAX 256 BLACK TITANIUM")
 *   [2] IMEI/Serial  (15-digit number or string)
 *   [3] Supplier     (e.g. "NIHAL", "RR STOCK")
 *   [4] Cost / BP    (number)
 *   [5] Status       ("SOLD" or blank = available)
 *   [6] Marketplace  (e.g. "Amazon", "eBay", blank)
 *   [7] Sale Price   (number or blank)
 */

const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const FILE_PATH = 'C:/Users/Manikanta Sridhar M/Downloads/INVENTORY REPORT 2026.xlsx';
const OUTPUT_PATH = path.join(__dirname, 'imported_inventory.json');

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Convert Excel serial date to ISO string */
function excelDateToISO(serial) {
  if (!serial || typeof serial !== 'number') return new Date().toISOString().split('T')[0];
  const date = XLSX.SSF.parse_date_code(serial);
  const d = new Date(Date.UTC(date.y, date.m - 1, date.d));
  return d.toISOString().split('T')[0];
}

/** Parse colour from model string */
function parseColour(model) {
  const m = model.toUpperCase();
  const colours = [
    'NATURAL TITANIUM', 'BLACK TITANIUM', 'WHITE TITANIUM', 'BLUE TITANIUM',
    'DESERT TITANIUM', 'STARLIGHT', 'MIDNIGHT', 'SPACE GREY', 'SPACE GRAY',
    'GRAPHITE', 'SILVER', 'GOLD', 'ROSE GOLD', 'PRODUCT RED', 'RED',
    'PHANTOM BLACK', 'PHANTOM WHITE', 'PHANTOM SILVER',
    'CREAM', 'LAVENDER', 'GREEN', 'YELLOW', 'PURPLE', 'CORAL',
    'BLACK', 'WHITE', 'BLUE', 'MINT', 'PINK', 'TEAL', 'ORANGE',
  ];
  for (const c of colours) {
    if (m.includes(c)) return c.charAt(0) + c.slice(1).toLowerCase();
  }
  return 'Unknown';
}

/** Detect category from model string */
function parseCategory(model) {
  const m = model.toUpperCase();
  if (m.includes('IPAD') || m.includes('IPAD PRO') || m.includes('IPAD AIR') || m.includes('IPAD MINI')) return 'iPad';
  if (m.includes('APPLE WATCH') || m.includes('WATCH ULTRA') || m.includes('WATCH SE') || m.includes('WATCH S')) return 'Apple Watch';
  if (m.includes('IPHONE')) return 'iPhone';
  if (m.includes('GALAXY TAB') || m.includes('TAB A') || m.includes('TAB S')) return 'Tablet';
  if (m.includes('GALAXY S') || m.includes('S20') || m.includes('S21') || m.includes('S22') || m.includes('S23') || m.includes('S24') || m.includes('S25')) return 'Samsung S Series';
  if (m.includes('GALAXY A') || m.includes('A12') || m.includes('A13') || m.includes('A14') || m.includes('A15') || m.includes('A32') || m.includes('A52') || m.includes('A54')) return 'Samsung A Series';
  if (m.includes('SAMSUNG') || m.includes('GALAXY')) return 'Samsung A Series';
  return 'Other';
}

/** Detect brand from category/model */
function parseBrand(model, category) {
  if (['iPhone', 'iPad', 'Apple Watch'].includes(category)) return 'Apple';
  if (['Samsung S Series', 'Samsung A Series', 'Tablet'].includes(category)) {
    if (model.toUpperCase().includes('SAMSUNG') || model.toUpperCase().includes('GALAXY')) return 'Samsung';
  }
  return 'Other';
}

// ── Main ──────────────────────────────────────────────────────────────────────

const wb = XLSX.readFile(FILE_PATH);
const ws = wb.Sheets['OG STOCK DATA'];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

// Collect unique suppliers to create supplier records
const supplierNames = new Set();
const units = [];
let skipped = 0;

for (let i = 1; i < rows.length; i++) {
  const r = rows[i];
  const model = r[1]?.toString().trim();
  if (!model) { skipped++; continue; }

  const imei = r[2]?.toString().trim() || '';
  const supplierName = r[3]?.toString().trim() || 'UNKNOWN';
  const buyPrice = parseFloat(r[4]) || 0;
  const statusRaw = r[5]?.toString().trim().toUpperCase();
  const status = statusRaw === 'SOLD' ? 'sold' : 'available';
  const salePlatform = r[6]?.toString().trim() || '';
  const salePrice = parseFloat(r[7]) || 0;
  const dateIn = excelDateToISO(r[0]);

  if (supplierName) supplierNames.add(supplierName);

  const category = parseCategory(model);
  const brand = parseBrand(model, category);
  const colour = parseColour(model);

  const unit = {
    id: `unit_import_${i}`,
    imei,
    model: model.trim(),
    brand,
    category,
    colour,
    buyPrice,
    dateIn,
    supplierId: `sup_${supplierName.replace(/\s+/g, '_').toLowerCase()}`,
    supplierName, // for reference
    status,
    flags: [],
    notes: '',
    platformListed: status === 'available',
    ownerId: 'anonymous',
    createdAt: new Date().toISOString(),
    ...(status === 'sold' ? {
      salePlatform,
      salePrice: salePrice || undefined,
    } : {}),
  };

  units.push(unit);
}

// Build supplier records
const suppliers = [...supplierNames].map(name => ({
  id: `sup_${name.replace(/\s+/g, '_').toLowerCase()}`,
  name,
  portal: 'Direct',
  ownerId: 'anonymous',
  createdAt: new Date().toISOString(),
}));

const available = units.filter(u => u.status === 'available').length;
const sold = units.filter(u => u.status === 'sold').length;

const output = { suppliers, units };
fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));

console.log('✅ Import complete!');
console.log(`   Total units: ${units.length}`);
console.log(`   Available:   ${available}`);
console.log(`   Sold:        ${sold}`);
console.log(`   Skipped:     ${skipped}`);
console.log(`   Suppliers:   ${suppliers.length}`);
console.log(`   Output:      ${OUTPUT_PATH}`);
