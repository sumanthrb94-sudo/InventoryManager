import * as XLSX from 'xlsx';

// ── CONFIG ─────────────────────────────────────────────────────────────────
const TOTAL = 10000;
const START = new Date('2024-05-02');
const END   = new Date('2026-05-02');
const PLATFORMS = ['eBay','Amazon','OnBuy','Backmarket'];
const SUPPLIERS = ['PhoneTradeUK','BulkMobilesDirect','ReGradeSupply','TechWholesale Ltd','SmartStock London'];

const MODELS = {
  Apple: {
    iPhone: [
      ['iPhone 16 Pro Max',['256GB','512GB','1TB'],['Black Titanium','White Titanium','Desert Titanium','Natural Titanium'],1050,1350],
      ['iPhone 16 Pro',    ['128GB','256GB','512GB'],['Black Titanium','White Titanium','Desert Titanium'],950,1200],
      ['iPhone 16 Plus',   ['128GB','256GB'],['Black','White','Pink','Teal','Ultramarine'],850,1050],
      ['iPhone 16',        ['128GB','256GB'],['Black','White','Pink','Teal','Ultramarine'],750,950],
      ['iPhone 15 Pro Max',['256GB','512GB','1TB'],['Black Titanium','White Titanium','Blue Titanium','Natural Titanium'],900,1150],
      ['iPhone 15 Pro',    ['128GB','256GB','512GB'],['Black Titanium','White Titanium','Blue Titanium','Natural Titanium'],800,1000],
      ['iPhone 15 Plus',   ['128GB','256GB'],['Black','Blue','Green','Yellow','Pink'],700,900],
      ['iPhone 15',        ['128GB','256GB'],['Black','Blue','Green','Yellow','Pink'],600,800],
      ['iPhone 14 Pro Max',['128GB','256GB','512GB','1TB'],['Deep Purple','Gold','Silver','Space Black'],750,950],
      ['iPhone 14 Pro',    ['128GB','256GB','512GB'],['Deep Purple','Gold','Silver','Space Black'],650,850],
      ['iPhone 14 Plus',   ['128GB','256GB'],['Blue','Purple','Midnight','Starlight','Red'],550,750],
      ['iPhone 14',        ['128GB','256GB','512GB'],['Blue','Purple','Midnight','Starlight','Red'],450,650],
      ['iPhone 13 Pro Max',['128GB','256GB','512GB','1TB'],['Alpine Green','Silver','Gold','Graphite','Sierra Blue'],600,800],
      ['iPhone 13 Pro',    ['128GB','256GB','512GB','1TB'],['Alpine Green','Silver','Gold','Graphite','Sierra Blue'],500,700],
      ['iPhone 13',        ['128GB','256GB','512GB'],['Green','Pink','Blue','Midnight','Starlight','Red'],380,580],
      ['iPhone 13 Mini',   ['128GB','256GB'],['Green','Pink','Blue','Midnight','Starlight','Red'],300,480],
      ['iPhone 12',        ['64GB','128GB','256GB'],['Black','White','Blue','Green','Purple','Red'],250,400],
    ],
    iPad: [
      ['iPad Pro 13 M4',   ['256GB','512GB','1TB'],['Silver','Space Black'],950,1350],
      ['iPad Pro 11 M4',   ['256GB','512GB'],['Silver','Space Black'],750,1050],
      ['iPad Air 13 M2',   ['128GB','256GB','512GB'],['Blue','Purple','Starlight','Space Grey'],650,900],
      ['iPad Air 11 M2',   ['128GB','256GB'],['Blue','Purple','Starlight','Space Grey'],500,750],
      ['iPad Mini 7',      ['128GB','256GB'],['Blue','Purple','Starlight','Space Grey'],450,650],
      ['iPad 10th Gen',    ['64GB','256GB'],['Blue','Pink','Silver','Yellow'],280,450],
    ],
  },
  Samsung: {
    'Galaxy S Series': [
      ['Galaxy S25 Ultra',  ['256GB','512GB','1TB'],['Titanium Silverblue','Titanium Black','Titanium Whitesilver'],900,1200],
      ['Galaxy S25+',       ['256GB','512GB'],['Icyblue','Mint','Navy','Silver Shadow'],750,950],
      ['Galaxy S25',        ['128GB','256GB'],['Icyblue','Mint','Navy','Silver Shadow'],650,850],
      ['Galaxy S24 Ultra',  ['256GB','512GB','1TB'],['Titanium Black','Titanium Gray','Titanium Violet'],850,1100],
      ['Galaxy S24+',       ['256GB','512GB'],['Cobalt Violet','Onyx Black','Marble Gray','Jade Green'],700,900],
      ['Galaxy S24',        ['128GB','256GB'],['Cobalt Violet','Onyx Black','Marble Gray','Amber Yellow'],580,780],
      ['Galaxy S23 Ultra',  ['256GB','512GB','1TB'],['Cream','Green','Lavender','Phantom Black'],750,950],
      ['Galaxy S23+',       ['256GB','512GB'],['Cream','Green','Lavender','Phantom Black'],600,800],
      ['Galaxy S23',        ['128GB','256GB'],['Cream','Green','Lavender','Phantom Black'],480,680],
      ['Galaxy S22 Ultra',  ['128GB','256GB','512GB','1TB'],['Burgundy','Green','Phantom Black','Phantom White'],600,800],
      ['Galaxy S22+',       ['128GB','256GB'],['Green','Phantom Black','Phantom White','Violet'],480,650],
      ['Galaxy S22',        ['128GB','256GB'],['Green','Phantom Black','Phantom White','Violet'],380,550],
    ],
    'Galaxy A Series': [
      ['Galaxy A56',  ['128GB','256GB'],['Awesome Black','Awesome White','Awesome Blue'],280,420],
      ['Galaxy A55',  ['128GB','256GB'],['Awesome Black','Awesome White','Awesome Navy','Awesome Lilac'],250,380],
      ['Galaxy A54',  ['128GB','256GB'],['Awesome Black','Awesome White','Awesome Violet','Awesome Lime'],220,350],
      ['Galaxy A35',  ['128GB','256GB'],['Awesome Black','Awesome Navy','Awesome Iceblue','Awesome Lilac'],180,300],
      ['Galaxy A34',  ['128GB','256GB'],['Awesome Black','Awesome White','Awesome Silver','Awesome Lime'],160,280],
      ['Galaxy A25',  ['128GB'],['Blue','Black','Yellow','Light Blue'],130,230],
      ['Galaxy A15',  ['128GB'],['Blue','Black','Peach','Light Green'],100,190],
    ],
    'Galaxy Tab': [
      ['Galaxy Tab S10 Ultra', ['256GB','512GB'],['Moonstone Gray','Titanium Silver'],700,1000],
      ['Galaxy Tab S10+',      ['256GB','512GB'],['Moonstone Gray','Titanium Silver'],600,850],
      ['Galaxy Tab S10',       ['128GB','256GB'],['Moonstone Gray','Titanium Silver'],480,700],
      ['Galaxy Tab S9 FE',     ['128GB','256GB'],['Gray','Lavender','Mint','Pink'],280,430],
      ['Galaxy Tab A9+',       ['64GB','128GB'],['Graphite','Navy','Silver'],220,370],
    ],
  },
};

const CONDITIONS = ['A','A','A','B','B','C','D'];
const NOTES_POOL = [
  '','','','','','',
  'Box missing','Box missing',
  'Minor screen scratch','Minor scratch on back',
  'Charger not included','Charger missing',
  'Battery health 87%','Battery health 82%','Battery health 91%',
  'Screen crack — priced accordingly',
  'All accessories included','Fully boxed',
  'SIM-free unlocked',
  'iCloud cleared','Google account removed',
  'Grade B — light wear','Grade C — heavy use',
];

const STATUS_WEIGHTS = [
  ...Array(55).fill('available'),
  ...Array(38).fill('sold'),
  ...Array(4).fill('returned'),
  ...Array(3).fill('reserved'),
];

function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randDate(from, to) {
  return new Date(from.getTime() + Math.random() * (to.getTime() - from.getTime()));
}
function fmtDate(d) { return d.toISOString().split('T')[0]; }
function genIMEI() {
  let s = '';
  for (let i = 0; i < 15; i++) s += randInt(0,9);
  return s;
}

// Build flat model list with weights (more popular models appear more)
const flatModels = [];
for (const [brand, cats] of Object.entries(MODELS)) {
  for (const [cat, models] of Object.entries(cats)) {
    for (const m of models) {
      const [name, storages, colours, bpMin, bpMax] = m;
      // Newer/popular models appear more
      const weight = name.includes('16')||name.includes('S25')||name.includes('S24') ? 4
                   : name.includes('15')||name.includes('S23')||name.includes('A5') ? 3
                   : name.includes('14')||name.includes('S22')||name.includes('Tab S10') ? 2 : 1;
      for (let w = 0; w < weight; w++) {
        flatModels.push({ brand, cat, name, storages, colours, bpMin, bpMax });
      }
    }
  }
}

// QA scenarios — ensure edge-case rows
const scenarios = [
  // High-value iPhone with all fields
  { model:'iPhone 16 Pro Max', brand:'Apple', cat:'iPhone', storage:'1TB', colour:'Desert Titanium', status:'sold', salePlatform:'eBay', salePrice:1380, condition:'A', notes:'Fully boxed, all accessories' },
  // Zero margin sale (break-even)
  { model:'iPhone 14', brand:'Apple', cat:'iPhone', storage:'128GB', colour:'Midnight', status:'sold', salePlatform:'Amazon', salePrice:450, bpOverride:450, notes:'Break-even sale — clearance' },
  // Negative margin sale (loss)
  { model:'Galaxy S22', brand:'Samsung', cat:'Galaxy S Series', storage:'128GB', colour:'Phantom Black', status:'sold', salePlatform:'OnBuy', salePrice:320, bpOverride:400, notes:'Loss sale — faulty unit' },
  // Very old unit (longest unsold)
  { model:'iPhone 13 Mini', brand:'Apple', cat:'iPhone', storage:'128GB', colour:'Midnight', status:'available', dateOverride:'2024-05-15', notes:'Sitting stock — slow mover' },
  // Returned unit
  { model:'Galaxy S24 Ultra', brand:'Samsung', cat:'Galaxy S Series', storage:'256GB', colour:'Titanium Black', status:'returned', notes:'Customer return — no fault found' },
  // Reserved unit
  { model:'iPhone 16 Pro', brand:'Apple', cat:'iPhone', storage:'256GB', colour:'Black Titanium', status:'reserved', notes:'Reserved for collection' },
  // iPad high value
  { model:'iPad Pro 13 M4', brand:'Apple', cat:'iPad', storage:'1TB', colour:'Space Black', status:'sold', salePlatform:'Amazon', salePrice:1380, notes:'Fully boxed with Apple Pencil' },
  // Samsung Tab
  { model:'Galaxy Tab S10 Ultra', brand:'Samsung', cat:'Galaxy Tab', storage:'512GB', colour:'Titanium Silver', status:'sold', salePlatform:'Backmarket', salePrice:950, notes:'Refurb grade A' },
  // Backmarket listing with grade C
  { model:'iPhone 12', brand:'Apple', cat:'iPhone', storage:'64GB', colour:'Black', status:'sold', salePlatform:'Backmarket', salePrice:230, condition:'C', notes:'Heavy wear — Backmarket Grade C' },
  // Very recent sale (today)
  { model:'iPhone 16', brand:'Apple', cat:'iPhone', storage:'256GB', colour:'Pink', status:'sold', salePlatform:'eBay', salePrice:820, dateOverride:'2026-05-01', saleDateOverride:'2026-05-02', notes:'Same-day dispatch' },
];

// Header
const rows = [['Date In','Model','IMEI','Supplier','Buy Price','Status','Platform','Sale Price','Sale Date','Colour','Storage','Condition','Category','Brand','Order Number','Customer Name','Notes']];

const imeiSet = new Set();
function uniqueIMEI() {
  let im;
  do { im = genIMEI(); } while (imeiSet.has(im));
  imeiSet.add(im);
  return im;
}

// Add QA scenario rows first
for (const sc of scenarios) {
  const m = flatModels.find(f => f.name === sc.model) || flatModels[0];
  const dateIn = sc.dateOverride ? new Date(sc.dateOverride) : randDate(START, new Date('2026-04-01'));
  const bp = sc.bpOverride || randInt(m.bpMin, m.bpMax);
  const saleDate = sc.saleDateOverride ? sc.saleDateOverride
    : (sc.status === 'sold' ? fmtDate(randDate(dateIn, END)) : '');
  const orderId = sc.status === 'sold' ? `ORD-${randInt(100000,999999)}` : '';
  rows.push([
    fmtDate(dateIn), `${sc.model} ${sc.storage || m.storages[0]}`,
    uniqueIMEI(), pick(SUPPLIERS), bp,
    sc.status.toUpperCase(), sc.salePlatform || '',
    sc.salePrice || '', saleDate,
    sc.colour || m.colours[0], sc.storage || m.storages[0],
    sc.condition || 'A', sc.cat, sc.brand,
    orderId, orderId ? `Customer ${randInt(1000,9999)}` : '',
    sc.notes || '',
  ]);
}

// Fill remaining rows
const remaining = TOTAL - scenarios.length;
// Track per-model sold counts for QA reporting accuracy
for (let i = 0; i < remaining; i++) {
  const m = pick(flatModels);
  const storage = pick(m.storages);
  const colour = pick(m.colours);
  const condition = pick(CONDITIONS);
  const supplier = pick(SUPPLIERS);
  const status = pick(STATUS_WEIGHTS);

  // Realistic buy price with small variance
  const bp = randInt(m.bpMin, m.bpMax);

  // Date: weighted toward recent months for more activity
  const recencyRoll = Math.random();
  let dateIn;
  if (recencyRoll < 0.30)      dateIn = randDate(new Date('2026-02-01'), END);      // last 3 months
  else if (recencyRoll < 0.55) dateIn = randDate(new Date('2025-09-01'), new Date('2026-01-31'));
  else if (recencyRoll < 0.75) dateIn = randDate(new Date('2025-03-01'), new Date('2025-08-31'));
  else if (recencyRoll < 0.88) dateIn = randDate(new Date('2024-09-01'), new Date('2025-02-28'));
  else                          dateIn = randDate(START, new Date('2024-08-31'));

  let salePlatform = '', salePrice = '', saleDate = '', orderId = '', customerName = '', notes = pick(NOTES_POOL);

  if (status === 'sold') {
    salePlatform = pick(PLATFORMS);
    // Realistic margin: 5-25% over BP
    const marginPct = (Math.random() * 0.20) + 0.05;
    salePrice = Math.round(bp * (1 + marginPct));
    // Occasional loss (2% of sales)
    if (Math.random() < 0.02) salePrice = Math.round(bp * (0.88 + Math.random() * 0.08));
    // Sale date: between dateIn and END
    const minSale = new Date(Math.min(dateIn.getTime() + 86400000, END.getTime()));
    saleDate = fmtDate(randDate(minSale, END));
    orderId = `ORD-${randInt(100000,999999)}`;
    customerName = `Customer ${randInt(1000,9999)}`;
  } else if (status === 'available') {
    // ~60% listed, 40% unlisted
    salePlatform = Math.random() < 0.6 ? pick(PLATFORMS) : '';
  } else if (status === 'returned') {
    salePlatform = pick(PLATFORMS);
    salePrice = Math.round(bp * (1 + Math.random() * 0.15));
    saleDate = fmtDate(randDate(dateIn, END));
    notes = pick(['Customer return','Return to supplier','Sent for repair','Back to inventory','No fault found — resell']);
  } else if (status === 'reserved') {
    salePlatform = Math.random() < 0.5 ? pick(PLATFORMS) : '';
    notes = 'Reserved for customer collection';
  }

  rows.push([
    fmtDate(dateIn),
    `${m.name} ${storage}`,
    uniqueIMEI(),
    supplier,
    bp,
    status.toUpperCase(),
    salePlatform,
    salePrice,
    saleDate,
    colour,
    storage,
    condition,
    m.cat,
    m.brand,
    orderId,
    customerName,
    notes,
  ]);
}

// Write file
const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet(rows);

// Column widths
ws['!cols'] = [
  {wch:12},{wch:36},{wch:18},{wch:24},{wch:10},
  {wch:12},{wch:12},{wch:10},{wch:12},
  {wch:20},{wch:8},{wch:10},{wch:20},{wch:10},
  {wch:16},{wch:18},{wch:40},
];

XLSX.utils.book_append_sheet(wb, ws, 'Inventory');
const fname = 'inventory_10k_qa.xlsx';
XLSX.writeFile(wb, fname);

const sold    = rows.slice(1).filter(r => r[5]==='SOLD').length;
const avail   = rows.slice(1).filter(r => r[5]==='AVAILABLE').length;
const ret     = rows.slice(1).filter(r => r[5]==='RETURNED').length;
const res     = rows.slice(1).filter(r => r[5]==='RESERVED').length;
console.log(`\n✅  Generated ${rows.length-1} rows → ${fname}`);
console.log(`   Available: ${avail} | Sold: ${sold} | Returned: ${ret} | Reserved: ${res}`);
console.log(`   Date range: 2024-05-02 → 2026-05-02`);
console.log(`   Models: Apple iPhones, iPads | Samsung S/A Series, Tabs`);
console.log(`   Platforms: eBay, Amazon, OnBuy, Backmarket`);
console.log(`   Suppliers: ${SUPPLIERS.join(', ')}`);
console.log(`   QA scenarios included: zero-margin, loss, oldest stock, returns, reserved, cross-platform`);
