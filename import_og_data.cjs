/**
 * Import OG STOCK DATA from Excel into Nexus localStorage JSON
 * Run: node import_og_data.cjs
 */
const XLSX   = require('xlsx');
const crypto = require('crypto');
const fs     = require('fs');

function excelDateToISO(serial) {
  if (!serial || typeof serial !== 'number') return null;
  const date = new Date(Math.round((serial - 25569) * 86400 * 1000));
  return date.toISOString().split('T')[0];
}

const SUPPLIER_MAP = {
  'NIHAL':'Nihal','ABC':'ABC','RR STOCK':'RR Stock','NANAK':'Nanak',
  'MHL':'MHL','IMAX':'IMAX','BUNTY':'Bunty','MOBILE KIT':'Mobile Kit',
  'MHL-RR':'MHL-RR','UNKNOWN':'Unknown',
};
function normaliseSupplier(raw) {
  const key = (raw||'').toString().trim().toUpperCase();
  return SUPPLIER_MAP[key] || key || 'Unknown';
}
function isValidSupplier(raw) {
  // Skip if the "supplier" column contains a number (price bleed from other columns)
  if (!raw) return false;
  if (!isNaN(Number(raw.toString().trim()))) return false;
  return raw.toString().trim().length > 0;
}

function normalisePlatform(raw) {
  if (!raw) return null;
  const s = raw.toString().trim().toLowerCase();
  if (s.includes('back market') || s === 'backmarket') return 'Backmarket';
  if (s.includes('ebay')) return 'eBay';
  if (s.includes('amazon')) return 'Amazon';
  if (s.includes('onbuy')) return 'OnBuy';
  return raw.toString().trim() || null;
}

function normaliseModel(raw) {
  if (!raw) return null;
  let m = raw.toString().trim();
  m = m.replace(/^IPHONE/i,'iPhone').replace(/^IPAD/i,'iPad')
       .replace(/^APPLE WATCH/i,'Apple Watch').replace(/^SAMSUNG /i,'Samsung ');
  return m;
}

function guessCategory(model) {
  const m = (model||'').toUpperCase();
  if (m.includes('IPHONE'))       return 'iPhone';
  if (m.includes('IPAD'))         return 'iPad';
  if (m.includes('APPLE WATCH'))  return 'Apple Watch';
  if (m.match(/SAMSUNG.*S\d\d|S20|S21|S22|S23|S24/)) return 'Samsung S Series';
  if (m.match(/SAMSUNG.*A\d|GALAXY A/))               return 'Samsung A Series';
  if (m.includes('TAB'))          return 'Tablet';
  return 'Other';
}
function guessBrand(model) {
  const m = (model||'').toUpperCase();
  if (m.includes('IPHONE')||m.includes('IPAD')||m.includes('APPLE')) return 'Apple';
  if (m.includes('SAMSUNG')||m.includes('GALAXY')) return 'Samsung';
  return 'Other';
}
function extractColour(model) {
  const COLOURS = ['BLACK','WHITE','GOLD','SILVER','RED','BLUE','GREEN','PURPLE','MIDNIGHT',
    'STARLIGHT','YELLOW','CORAL','PINK','GRAPHITE','PACIFIC BLUE','SIERRA BLUE',
    'ALPINE GREEN','SPACE GREY','SPACE GRAY','NATURAL TITANIUM','BLACK TITANIUM',
    'WHITE TITANIUM','BLUE TITANIUM','DESERT TITANIUM','ROSE','ULTRA MARINE'];
  const upper = (model||'').toUpperCase();
  for (const c of COLOURS) {
    if (upper.includes(c)) return c.charAt(0) + c.slice(1).toLowerCase();
  }
  return 'Unknown';
}
function uid(...parts) {
  return crypto.createHash('md5').update(parts.join('|')).digest('hex').slice(0,16);
}

// ── Parse OG STOCK DATA ───────────────────────────────────────────────────
const FILE = 'C:/Users/Manikanta Sridhar M/Downloads/INVENTORY REPORT 2026.xlsx';
const wb   = XLSX.readFile(FILE);
const ws   = wb.Sheets['OG STOCK DATA'];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

const suppliersMap = {};
const units        = [];
let   skipped      = 0;

for (let i = 2; i < rows.length; i++) {
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

  const imei = rawImei ? rawImei.toString().replace(/\D/g,'') : '';
  if (!imei && !model) { skipped++; continue; }

  const supplierName = isValidSupplier(rawSupplier) ? normaliseSupplier(rawSupplier) : 'Unknown';
  const buyPrice     = parseFloat(rawCost) || 0;
  const isSold       = (rawStatus||'').toString().toUpperCase().trim() === 'SOLD';
  const platform     = normalisePlatform(rawMarket);
  const salePrice    = parseFloat(rawSalePrice) || undefined;
  const dateIn       = excelDateToISO(rawDate) || '2025-01-01';

  // Build supplier record
  const supKey = supplierName.toUpperCase();
  if (!suppliersMap[supKey]) {
    suppliersMap[supKey] = {
      id: 'sup_' + uid(supKey),
      name: supplierName,
      portal: 'Direct',
      ownerId: 'local',
      createdAt: new Date().toISOString(),
    };
  }
  const supplierId = suppliersMap[supKey].id;

  const colour   = extractColour(model);
  const category = guessCategory(model);
  const brand    = guessBrand(model);
  const unitId   = 'u_' + uid(imei || (model + i), dateIn, supplierName);

  units.push({
    id: unitId,
    imei,
    model,
    brand,
    category,
    colour,
    buyPrice,
    dateIn,
    supplierId,
    status:        isSold ? 'sold' : 'available',
    flags:         [],
    notes:         '',
    platformListed: !isSold,
    ownerId:       'local',
    ...(isSold && platform  ? { salePlatform: platform }  : {}),
    ...(isSold && salePrice ? { salePrice }               : {}),
    ...(isSold              ? { saleDate: dateIn }        : {}),
  });
}

const suppliers = Object.values(suppliersMap);

console.log(`✓ ${units.length} units | ${skipped} skipped | ${suppliers.length} suppliers`);
console.log(`  Suppliers: ${suppliers.map(s=>s.name).join(', ')}`);
console.log(`  Sold: ${units.filter(u=>u.status==='sold').length} | Available: ${units.filter(u=>u.status==='available').length}`);

const out = { suppliers, units };
fs.writeFileSync('og_inventory_import.json', JSON.stringify(out));
const kb = (JSON.stringify(out).length/1024).toFixed(0);
console.log(`✓ Written og_inventory_import.json (${kb} KB)`);
