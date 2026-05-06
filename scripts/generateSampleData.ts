/**
 * Generates sample-100-units.xlsx — 100 realistic mock units.
 * Run: npx tsx scripts/generateSampleData.ts
 */

import * as XLSX from 'xlsx';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const HEADERS = [
  'Date In', 'Model', 'IMEI', 'Supplier', 'Buy Price',
  'Colour', 'Storage', 'Status',
  'Sale Platform', 'Sale Price', 'Sale Date', 'Sale Order ID',
  'Postage Cost', 'Notes',
];

// ── Reference data ────────────────────────────────────────────────────────────

const SUPPLIERS = ['TechSource Ltd', 'MHL Direct', 'IMAX Wholesale', 'PhoneMart UK', 'MobileTrade Pro'];

const PLATFORMS = ['eBay', 'Amazon', 'OnBuy', 'Backmarket'];

const MODELS: { model: string; bp: number; colours: string[]; storage: string[] }[] = [
  { model: 'iPhone 16 Pro Max', bp: 900,  colours: ['Desert Titanium', 'Black Titanium', 'White Titanium', 'Natural Titanium'], storage: ['256GB', '512GB', '1TB']    },
  { model: 'iPhone 16 Pro',     bp: 780,  colours: ['Desert Titanium', 'Black Titanium', 'White Titanium', 'Natural Titanium'], storage: ['128GB', '256GB', '512GB']  },
  { model: 'iPhone 15 Pro Max', bp: 750,  colours: ['Natural Titanium', 'Black Titanium', 'White Titanium', 'Blue Titanium'],   storage: ['256GB', '512GB']           },
  { model: 'iPhone 15 Pro',     bp: 650,  colours: ['Natural Titanium', 'Black Titanium', 'Blue Titanium'],                    storage: ['128GB', '256GB']           },
  { model: 'iPhone 15',         bp: 530,  colours: ['Black', 'Yellow', 'Green', 'Pink', 'Blue'],                               storage: ['128GB', '256GB']           },
  { model: 'iPhone 15 Plus',    bp: 600,  colours: ['Black', 'Yellow', 'Green', 'Pink'],                                       storage: ['128GB', '256GB']           },
  { model: 'iPhone 14 Pro Max', bp: 570,  colours: ['Space Black', 'Gold', 'Silver', 'Deep Purple'],                           storage: ['128GB', '256GB', '512GB']  },
  { model: 'iPhone 14 Pro',     bp: 490,  colours: ['Space Black', 'Gold', 'Silver', 'Deep Purple'],                           storage: ['128GB', '256GB']           },
  { model: 'iPhone 14',         bp: 400,  colours: ['Midnight', 'Starlight', 'Blue', 'Purple', 'Product Red'],                  storage: ['128GB', '256GB']           },
  { model: 'Samsung Galaxy S25 Ultra', bp: 820, colours: ['Titanium Silverblue', 'Titanium Black', 'Titanium Whitesilver'], storage: ['256GB', '512GB'] },
  { model: 'Samsung Galaxy S25+',      bp: 620, colours: ['Icy Blue', 'Mint', 'Silver Shadow', 'Navy'],                    storage: ['256GB', '512GB'] },
  { model: 'Samsung Galaxy S24 Ultra', bp: 680, colours: ['Titanium Black', 'Titanium Gray', 'Titanium Violet'],            storage: ['256GB', '512GB'] },
  { model: 'Samsung Galaxy S24+',      bp: 520, colours: ['Marble Gray', 'Cobalt Violet', 'Amber Yellow'],                  storage: ['256GB', '512GB'] },
  { model: 'Samsung Galaxy S24',       bp: 430, colours: ['Cobalt Violet', 'Marble Gray', 'Onyx Black'],                    storage: ['128GB', '256GB'] },
  { model: 'Samsung Galaxy A55',       bp: 240, colours: ['Awesome Lilac', 'Awesome Lemon', 'Awesome Navy', 'Awesome Iceblue'], storage: ['128GB', '256GB'] },
  { model: 'Samsung Galaxy A54',       bp: 200, colours: ['Awesome Violet', 'Awesome Black', 'Awesome White'],              storage: ['128GB', '256GB'] },
];

const NOTES_POOL = [
  null, null, null, null, null,  // mostly blank
  'Box missing', 'No charger included', 'Minor scratch on back',
  'Battery health 91%', 'Slight scuff on frame', 'Screen protector included',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

let imeiSeed = 353209102768600;
function nextImei(): string { return String(++imeiSeed); }

function dateStr(daysAgo: number): string {
  const d = new Date('2026-05-06');
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split('T')[0];
}

function orderId(platform: string): string {
  switch (platform) {
    case 'eBay':       return `${randInt(10,99)}-${randInt(10000,99999)}-${randInt(10000,99999)}`;
    case 'Amazon':     return `${randInt(100,999)}-${randInt(1000000,9999999)}-${randInt(1000000,9999999)}`;
    case 'OnBuy':      return `OB-${randInt(100000,999999)}`;
    case 'Backmarket': return `BM-${randInt(100000,999999)}`;
    default:           return `ORD-${randInt(10000,99999)}`;
  }
}

// Sale price = buy price + margin (12–35%)
function salePrice(bp: number): number {
  const margin = 1 + (randInt(12, 35) / 100);
  return Math.round(bp * margin / 5) * 5;  // round to nearest £5
}

type Row = (string | number | null)[];

// ─────────────────────────────────────────────────────────────────────────────
// Build 100 rows
// Split:  60 available · 30 sold · 10 incoming (SHS)
// ─────────────────────────────────────────────────────────────────────────────

const rows: Row[] = [];

// ── 60 available ─────────────────────────────────────────────────────────────
for (let i = 0; i < 60; i++) {
  const m   = pick(MODELS);
  const sup = pick(SUPPLIERS);
  const col = pick(m.colours);
  const sto = pick(m.storage);
  const bp  = m.bp + randInt(-30, 30);          // ±£30 variance
  const daysAgo = randInt(1, 45);

  rows.push([
    dateStr(daysAgo),
    `${m.model} ${sto}`,
    nextImei(),
    sup,
    bp,
    col,
    sto,
    'available',
    null, null, null, null, null,
    pick(NOTES_POOL),
  ]);
}

// ── 30 sold ──────────────────────────────────────────────────────────────────
for (let i = 0; i < 30; i++) {
  const m       = pick(MODELS);
  const sup     = pick(SUPPLIERS);
  const col     = pick(m.colours);
  const sto     = pick(m.storage);
  const bp      = m.bp + randInt(-30, 30);
  const buyDays = randInt(30, 90);
  const sellDaysAgo = randInt(1, buyDays - 1);
  const platform = pick(PLATFORMS);
  const sp       = salePrice(bp);

  rows.push([
    dateStr(buyDays),
    `${m.model} ${sto}`,
    nextImei(),
    sup,
    bp,
    col,
    sto,
    'sold',
    platform,
    sp,
    dateStr(sellDaysAgo),
    orderId(platform),
    8,
    null,
  ]);
}

// ── 10 incoming / SHS ─────────────────────────────────────────────────────────
const SHS_NOTES = [
  'Pre-ordered, ETA 1 week',
  'Pre-ordered, ETA 2 weeks',
  'Awaiting supplier confirmation',
  'Ordered — supplier to dispatch',
  'Reserved batch, supplier holds',
];

for (let i = 0; i < 10; i++) {
  const m   = pick(MODELS.slice(0, 6));          // only newer models for SHS
  const sup = pick(SUPPLIERS);
  const col = pick(m.colours);
  const sto = pick(m.storage);
  const bp  = m.bp + randInt(-20, 20);

  rows.push([
    dateStr(randInt(0, 7)),
    `${m.model} ${sto}`,
    '',                                           // no IMEI — supplier holds
    sup,
    bp,
    col,
    sto,
    'incoming',
    null, null, null, null, null,
    pick(SHS_NOTES),
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Write workbook
// ─────────────────────────────────────────────────────────────────────────────

const wb = XLSX.utils.book_new();

const ws = XLSX.utils.aoa_to_sheet([HEADERS, ...rows]);
ws['!cols'] = [
  { wch: 12 }, // Date In
  { wch: 34 }, // Model
  { wch: 17 }, // IMEI
  { wch: 18 }, // Supplier
  { wch: 11 }, // Buy Price
  { wch: 22 }, // Colour
  { wch: 9  }, // Storage
  { wch: 11 }, // Status
  { wch: 14 }, // Sale Platform
  { wch: 11 }, // Sale Price
  { wch: 12 }, // Sale Date
  { wch: 22 }, // Sale Order ID
  { wch: 13 }, // Postage Cost
  { wch: 28 }, // Notes
];
ws['!freeze'] = { xSplit: 0, ySplit: 1 };

XLSX.utils.book_append_sheet(wb, ws, 'Master Data');

const outPath = path.join(__dirname, '..', 'public', 'sample-100-units.xlsx');
XLSX.writeFile(wb, outPath);

const avail = rows.filter(r => r[7] === 'available').length;
const sold  = rows.filter(r => r[7] === 'sold').length;
const inc   = rows.filter(r => r[7] === 'incoming').length;

console.log(`✓  ${outPath}`);
console.log(`   ${rows.length} rows total`);
console.log(`   ├─ available : ${avail}`);
console.log(`   ├─ sold      : ${sold}`);
console.log(`   └─ incoming  : ${inc}`);
