import * as XLSX from 'xlsx';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Configuration ───────────────────────────────────────────────────────────
const TOTAL_UNITS = 5000;
const START_DATE = new Date('2021-05-01');
const END_DATE = new Date('2026-05-02'); // Yesterday
const OWNER_ID = 'anonymous';

// ─── Data Catalogs ───────────────────────────────────────────────────────────

const MODELS = {
  iphone: [
    'iPhone 16 Pro Max', 'iPhone 16 Pro', 'iPhone 16 Plus', 'iPhone 16',
    'iPhone 15 Pro Max', 'iPhone 15 Pro', 'iPhone 15 Plus', 'iPhone 15',
    'iPhone 14 Pro Max', 'iPhone 14 Pro', 'iPhone 14 Plus', 'iPhone 14',
    'iPhone 13 Pro Max', 'iPhone 13 Pro', 'iPhone 13 Mini', 'iPhone 13',
    'iPhone 12 Pro Max', 'iPhone 12 Pro', 'iPhone 12 Mini', 'iPhone 12',
    'iPhone 11 Pro Max', 'iPhone 11 Pro', 'iPhone 11',
    'iPhone SE 2022', 'iPhone SE 2020',
    'iPhone XS Max', 'iPhone XS', 'iPhone XR', 'iPhone X',
  ],
  ipad: [
    'iPad Pro 12.9 6th Gen', 'iPad Pro 12.9 5th Gen', 'iPad Pro 11 4th Gen',
    'iPad Air 5th Gen', 'iPad Air 4th Gen', 'iPad Air 3rd Gen',
    'iPad Mini 6th Gen', 'iPad Mini 5th Gen',
    'iPad 10th Gen', 'iPad 9th Gen', 'iPad 8th Gen',
  ],
  watch: [
    'Apple Watch Ultra 2', 'Apple Watch Ultra',
    'Apple Watch Series 9 45mm', 'Apple Watch Series 9 41mm',
    'Apple Watch Series 8 45mm', 'Apple Watch Series 8 41mm',
    'Apple Watch Series 7 45mm', 'Apple Watch Series 7 41mm',
    'Apple Watch SE 2nd Gen 44mm', 'Apple Watch SE 2nd Gen 40mm',
  ],
  samsungS: [
    'Galaxy S25 Ultra', 'Galaxy S25 Plus', 'Galaxy S25',
    'Galaxy S24 Ultra', 'Galaxy S24 Plus', 'Galaxy S24',
    'Galaxy S23 Ultra', 'Galaxy S23 Plus', 'Galaxy S23',
    'Galaxy S22 Ultra', 'Galaxy S22 Plus', 'Galaxy S22',
    'Galaxy S21 Ultra', 'Galaxy S21 Plus', 'Galaxy S21',
    'Galaxy S20 Ultra', 'Galaxy S20 Plus', 'Galaxy S20',
  ],
  samsungA: [
    'Galaxy A55 5G', 'Galaxy A54 5G', 'Galaxy A53 5G', 'Galaxy A52 5G',
    'Galaxy A35 5G', 'Galaxy A34 5G', 'Galaxy A33 5G',
    'Galaxy A25 5G', 'Galaxy A24', 'Galaxy A23',
    'Galaxy A15 5G', 'Galaxy A14', 'Galaxy A13',
  ],
  tablet: [
    'Galaxy Tab S9 Ultra', 'Galaxy Tab S9 Plus', 'Galaxy Tab S9',
    'Galaxy Tab S8 Ultra', 'Galaxy Tab S8 Plus', 'Galaxy Tab S8',
    'Galaxy Tab A9 Plus', 'Galaxy Tab A9',
    'Galaxy Tab A8', 'Galaxy Tab A7',
    'Galaxy Z Fold 6', 'Galaxy Z Fold 5', 'Galaxy Z Flip 6', 'Galaxy Z Flip 5',
  ],
  other: [
    'Google Pixel 9 Pro', 'Google Pixel 9', 'Google Pixel 8 Pro', 'Google Pixel 8',
    'OnePlus 12', 'OnePlus 11', 'OnePlus 10 Pro',
    'Xiaomi 14', 'Xiaomi 13', 'Xiaomi 13 Pro',
    'Motorola Edge 40', 'Motorola Edge 30',
    'Sony Xperia 1 V', 'Sony Xperia 5 V',
  ],
};

const STORAGE_OPTIONS = ['64GB', '128GB', '256GB', '512GB', '1TB'];

const COLOURS = [
  'Natural Titanium', 'Black Titanium', 'White Titanium', 'Blue Titanium', 'Desert Titanium',
  'Pacific Blue', 'Sierra Blue', 'Alpine Green', 'Space Grey', 'Graphite',
  'Starlight', 'Midnight', 'Black', 'White', 'Blue', 'Gold', 'Silver',
  'Rose Gold', 'Red', 'Green', 'Yellow', 'Purple', 'Coral', 'Mint', 'Pink', 'Teal', 'Orange',
  'Cream', 'Lavender', 'Phantom Black', 'Phantom White', 'Phantom Silver',
  'Awesome Black', 'Awesome Silver', 'Awesome Blue', 'Awesome Violet',
];

const SUPPLIERS = [
  { name: 'Direct Supplies Ltd', portal: 'Direct' },
  { name: 'Wholesale Corp UK', portal: 'Wholesale' },
  { name: 'PhoneHub Auctions', portal: 'Auction' },
  { name: 'TechTrade Online', portal: 'Online' },
  { name: 'MobileSource eBay', portal: 'eBay' },
  { name: 'RefurbHub Direct', portal: 'Website' },
  { name: 'GadgetWholesale', portal: 'Wholesale' },
  { name: 'PhoneRescue UK', portal: 'Direct' },
  { name: 'TechAuctions Ltd', portal: 'Auction' },
  { name: 'MobileDeals Co', portal: 'Online' },
  { name: 'iSupply Direct', portal: 'Direct' },
  { name: 'Samsung Wholesale', portal: 'Wholesale' },
  { name: 'Apple Reseller UK', portal: 'Website' },
  { name: 'TradePhones Ltd', portal: 'eBay' },
  { name: 'BulkMobiles Co', portal: 'Direct' },
  { name: 'PhoneStock Exchange', portal: 'Auction' },
  { name: 'TechSource Online', portal: 'Online' },
  { name: 'MobileParts UK', portal: 'Other' },
];

const PLATFORMS = ['eBay', 'Amazon', 'OnBuy', 'Backmarket', 'Other'];
const CONDITION_GRADES = ['A', 'B', 'C', 'D', 'Unknown'];
const NETWORK_LOCKS = ['Unlocked', 'EE', 'Vodafone', 'O2', 'Three', 'BT Mobile', 'Virgin Mobile'];
const ACTIVATION_LOCKS = ['Clean', 'iCloud Locked', 'Google Locked', 'Find My iPhone ON', 'Unknown'];
const RETURN_REASONS = [
  'Defective screen', 'Battery issue', 'Wrong model ordered', 'Customer changed mind',
  'Not as described', 'Physical damage on arrival', 'Camera malfunction',
  'Speaker not working', 'Touch ID/Face ID failure', 'Water damage',
  'Charging port issue', 'Software glitch', 'Missing accessories',
  'Warranty claim - hardware fault', 'Warranty claim - software fault',
];

const WARRANTY_PERIOD_DAYS = 30; // Standard 30-day warranty

// ─── Helper Functions ────────────────────────────────────────────────────────

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min, max, decimals = 2) {
  const val = Math.random() * (max - min) + min;
  return parseFloat(val.toFixed(decimals));
}

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomDate(start, end) {
  const startTime = start.getTime();
  const endTime = end.getTime();
  return new Date(startTime + Math.random() * (endTime - startTime));
}

function formatDate(date) {
  return date.toISOString().split('T')[0];
}

function generateIMEI() {
  // Generate a valid-looking 15-digit IMEI
  let imei = '';
  for (let i = 0; i < 14; i++) {
    imei += randomInt(0, 9);
  }
  // Luhn check digit (simplified)
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    let digit = parseInt(imei[i]);
    if (i % 2 === 0) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  return imei + checkDigit;
}

function generateSerial() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let serial = '';
  for (let i = 0; i < 12; i++) {
    serial += chars[Math.floor(Math.random() * chars.length)];
  }
  return serial;
}

function getCategory(model) {
  const m = model.toLowerCase();
  if (m.includes('iphone')) return 'iPhone';
  if (m.includes('ipad')) return 'iPad';
  if (m.includes('watch')) return 'Apple Watch';
  if (m.includes('tab') || m.includes('fold') || m.includes('flip')) return 'Tablet';
  if (m.includes('galaxy')) {
    if (/\bA\d{2}\b/.test(m) || m.includes('galaxy a')) return 'Samsung A Series';
    return 'Samsung S Series';
  }
  return 'Other';
}

function getBrand(category) {
  if (['iPhone', 'iPad', 'Apple Watch'].includes(category)) return 'Apple';
  if (['Samsung S Series', 'Samsung A Series', 'Tablet'].includes(category)) return 'Samsung';
  return 'Other';
}

function getBuyPrice(category, model) {
  const basePrices = {
    'iPhone': { min: 150, max: 1100 },
    'iPad': { min: 200, max: 900 },
    'Apple Watch': { min: 80, max: 600 },
    'Samsung S Series': { min: 180, max: 950 },
    'Samsung A Series': { min: 80, max: 350 },
    'Tablet': { min: 150, max: 800 },
    'Other': { min: 100, max: 700 },
  };
  const range = basePrices[category] || basePrices['Other'];
  return randomFloat(range.min, range.max);
}

function getSalePrice(buyPrice, margin = 0.25) {
  // Sale price with some variance around margin
  const variance = randomFloat(-0.1, 0.15);
  const markup = margin + variance;
  return Math.round(buyPrice * (1 + markup));
}

// ─── Scenario Distribution ───────────────────────────────────────────────────
// We want to cover ALL scenarios with realistic distribution

const STATUS_DISTRIBUTION = {
  available: 0.45,  // 45% available
  sold: 0.40,       // 40% sold
  returned: 0.08,   // 8% returned
  reserved: 0.05,   // 5% reserved
  lost: 0.02,       // 2% lost
};

const RETURN_TYPE_DISTRIBUTION = {
  returned_to_inventory: 0.50,
  returned_to_supplier: 0.25,
  repair: 0.25,
};

// ─── Unit Generator ──────────────────────────────────────────────────────────

function generateUnit(index) {
  // Pick model based on weighted distribution (newer models more common)
  const allModels = [
    ...MODELS.iphone.map(m => ({ model: m, weight: m.includes('16') ? 25 : m.includes('15') ? 20 : m.includes('14') ? 15 : m.includes('13') ? 10 : m.includes('12') ? 8 : m.includes('11') ? 5 : m.includes('SE') ? 4 : 3 })),
    ...MODELS.ipad.map(m => ({ model: m, weight: m.includes('6th') || m.includes('5th') ? 12 : m.includes('4th') ? 8 : 5 })),
    ...MODELS.watch.map(m => ({ model: m, weight: m.includes('9') || m.includes('Ultra 2') ? 10 : m.includes('8') ? 7 : m.includes('7') ? 5 : 3 })),
    ...MODELS.samsungS.map(m => ({ model: m, weight: m.includes('S25') ? 20 : m.includes('S24') ? 18 : m.includes('S23') ? 12 : m.includes('S22') ? 8 : m.includes('S21') ? 5 : 3 })),
    ...MODELS.samsungA.map(m => ({ model: m, weight: m.includes('A55') || m.includes('A54') ? 10 : m.includes('A35') || m.includes('A34') ? 8 : m.includes('A25') || m.includes('A24') ? 6 : 4 })),
    ...MODELS.tablet.map(m => ({ model: m, weight: m.includes('S9') || m.includes('Fold 6') || m.includes('Flip 6') ? 12 : m.includes('S8') || m.includes('Fold 5') || m.includes('Flip 5') ? 8 : 5 })),
    ...MODELS.other.map(m => ({ model: m, weight: 2 })),
  ];

  const totalWeight = allModels.reduce((sum, m) => sum + m.weight, 0);
  let randomWeight = Math.random() * totalWeight;
  let selectedModel = allModels[0].model;
  for (const m of allModels) {
    randomWeight -= m.weight;
    if (randomWeight <= 0) {
      selectedModel = m.model;
      break;
    }
  }

  const category = getCategory(selectedModel);
  const brand = getBrand(category);
  const storage = randomChoice(STORAGE_OPTIONS);
  const colour = randomChoice(COLOURS);
  const fullModel = `${brand} ${selectedModel} ${storage} ${colour}`;

  const supplier = randomChoice(SUPPLIERS);
  const buyPrice = getBuyPrice(category, selectedModel);

  // Determine status based on distribution
  const statusRoll = Math.random();
  let status = 'available';
  let cumulative = 0;
  for (const [s, prob] of Object.entries(STATUS_DISTRIBUTION)) {
    cumulative += prob;
    if (statusRoll <= cumulative) {
      status = s;
      break;
    }
  }

  // Generate dateIn based on status
  let dateIn;
  if (status === 'available') {
    // Available stock: mix of recent and old
    const ageDays = randomInt(1, 1800); // 1 day to ~5 years
    dateIn = new Date(END_DATE.getTime() - ageDays * 86400000);
  } else if (status === 'sold') {
    // Sold: mostly recent sales but some historical
    const saleAgeDays = randomInt(1, 1800);
    dateIn = new Date(END_DATE.getTime() - saleAgeDays * 86400000);
  } else if (status === 'returned') {
    // Returned: recent returns
    const returnAgeDays = randomInt(1, 90);
    dateIn = new Date(END_DATE.getTime() - returnAgeDays * 86400000);
  } else if (status === 'reserved') {
    // Reserved: recent reservations
    const reserveAgeDays = randomInt(1, 30);
    dateIn = new Date(END_DATE.getTime() - reserveAgeDays * 86400000);
  } else {
    // Lost: could be any time
    dateIn = randomDate(START_DATE, END_DATE);
  }

  // Generate IMEI/Serial
  const imei = category === 'Apple Watch' || category === 'Other' || Math.random() < 0.3
    ? generateSerial()
    : generateIMEI();

  // Base unit object
  const unit = {
    id: `unit_${index.toString().padStart(6, '0')}`,
    imei,
    model: fullModel,
    brand,
    category,
    colour,
    storage,
    conditionGrade: randomChoice(CONDITION_GRADES),
    boxIncluded: Math.random() > 0.3, // 70% have box
    batteryHealth: category === 'Apple Watch' ? null : randomInt(75, 100),
    networkLock: randomChoice(NETWORK_LOCKS),
    activationLock: ['iPhone', 'iPad', 'Apple Watch'].includes(category) ? randomChoice(ACTIVATION_LOCKS) : null,
    buyPrice,
    dateIn: formatDate(dateIn),
    supplierId: `sup_${supplier.name.replace(/\s+/g, '_').toLowerCase()}`,
    supplierName: supplier.name,
    batchId: `batch_${formatDate(dateIn)}_${supplier.name.replace(/\s+/g, '_').toLowerCase()}`,
    stockLocation: 'office',
    status,
    flags: [],
    notes: '',
    platformListed: false,
    listingSites: [],
    listingUrl: null,
    listingId: null,
    listingDate: null,
    salePrice: null,
    saleDate: null,
    salePlatform: null,
    saleOrderId: null,
    customerName: null,
    postageCost: randomChoice([0, 5, 8, 12]),
    returnType: null,
    returnDate: null,
    returnReason: null,
    attachments: [],
    ownerId: OWNER_ID,
    createdAt: formatDate(dateIn),
    updatedAt: formatDate(new Date(Math.min(dateIn.getTime() + randomInt(0, 30) * 86400000, END_DATE.getTime()))),
  };

  // ─── Status-specific fields ────────────────────────────────────────────────

  if (status === 'available') {
    // Some available units are listed on platforms
    const isListed = Math.random() < 0.6; // 60% of available are listed
    if (isListed) {
      const platform = randomChoice(PLATFORMS);
      unit.platformListed = true;
      unit.listingSites = [platform];
      unit.listingDate = formatDate(new Date(dateIn.getTime() + randomInt(1, 7) * 86400000));
    }
    // Some have operational flags
    if (Math.random() < 0.1) unit.flags.push('top10');
    if (Math.random() < 0.2) unit.flags.push('supplierHasStock');
  }

  if (status === 'sold') {
    const saleDate = new Date(dateIn.getTime() + randomInt(1, 90) * 86400000);
    const saleDateClamped = new Date(Math.min(saleDate.getTime(), END_DATE.getTime()));
    const platform = randomChoice(PLATFORMS);
    const salePrice = getSalePrice(buyPrice);

    unit.saleDate = formatDate(saleDateClamped);
    unit.salePlatform = platform;
    unit.salePrice = salePrice;
    unit.saleOrderId = `ORD-${randomInt(10000, 99999)}`;
    unit.customerName = `Customer ${randomInt(1, 999)}`;
    unit.platformListed = false;
    unit.listingSites = [];
    unit.flags.push('stockSold');
  }

  if (status === 'returned') {
    const returnTypeRoll = Math.random();
    let returnType = 'returned_to_inventory';
    let cumulativeReturn = 0;
    for (const [rt, prob] of Object.entries(RETURN_TYPE_DISTRIBUTION)) {
      cumulativeReturn += prob;
      if (returnTypeRoll <= cumulativeReturn) {
        returnType = rt;
        break;
      }
    }

    // Return date: within warranty period or after
    const daysSincePurchase = randomInt(5, 45); // 5-45 days after purchase
    const returnDate = new Date(dateIn.getTime() + daysSincePurchase * 86400000);
    const returnDateClamped = new Date(Math.min(returnDate.getTime(), END_DATE.getTime()));

    const isWithinWarranty = daysSincePurchase <= WARRANTY_PERIOD_DAYS;
    const reason = randomChoice(RETURN_REASONS);

    unit.status = 'returned';
    unit.returnType = returnType;
    unit.returnDate = formatDate(returnDateClamped);
    unit.returnReason = `${reason}${isWithinWarranty ? ' (Within 30-day warranty)' : ' (Outside 30-day warranty)'}`;
    unit.platformListed = false;

    // Returned units might have been sold first
    const saleDate = new Date(dateIn.getTime() + randomInt(1, daysSincePurchase - 1) * 86400000);
    unit.saleDate = formatDate(saleDate);
    unit.salePlatform = randomChoice(PLATFORMS);
    unit.salePrice = getSalePrice(buyPrice);
    unit.saleOrderId = `ORD-${randomInt(10000, 99999)}`;

    // Notes based on return type
    if (returnType === 'repair') {
      unit.notes = `Sent for repair: ${reason}. Estimated repair cost: £${randomInt(50, 200)}`;
    } else if (returnType === 'returned_to_supplier') {
      unit.notes = `Returned to supplier: ${reason}. Refund status: ${Math.random() > 0.5 ? 'Pending' : 'Completed £' + buyPrice}`;
    } else {
      unit.notes = `Back in inventory: ${reason}. Condition check: ${unit.conditionGrade}`;
    }
  }

  if (status === 'reserved') {
    unit.notes = `Reserved for ${randomChoice(['wholesale buyer', 'retail customer', 'corporate order', 'pre-order'])}. Hold until ${formatDate(new Date(END_DATE.getTime() + randomInt(1, 14) * 86400000))}`;
    unit.platformListed = false;
  }

  if (status === 'lost') {
    unit.notes = randomChoice([
      'Lost during transit - insurance claim filed',
      'Missing from inventory - under investigation',
      'Stolen - police report filed',
      'Damaged beyond repair - written off',
      'Lost in warehouse - search ongoing',
    ]);
    unit.platformListed = false;
  }

  // Add various notes for available units
  if (status === 'available' && Math.random() < 0.15) {
    const notes = [
      'Minor scratch on back panel',
      'Original box slightly damaged',
      'Screen protector applied',
      'Battery recently replaced',
      'Comes with third-party charger',
      'Previous customer return - fully tested',
      'Ex-display unit',
      'Corporate trade-in - good condition',
    ];
    unit.notes = randomChoice(notes);
  }

  return unit;
}

// ─── Generate 5000 Units ─────────────────────────────────────────────────────

console.log('Generating 5000 comprehensive test units...');
const units = [];
const supplierMap = new Map();
const batchMap = new Map();

for (let i = 0; i < TOTAL_UNITS; i++) {
  const unit = generateUnit(i);
  units.push(unit);

  // Track suppliers
  if (!supplierMap.has(unit.supplierId)) {
    supplierMap.set(unit.supplierId, {
      id: unit.supplierId,
      name: unit.supplierName,
      portal: SUPPLIERS.find(s => s.name === unit.supplierName)?.portal || 'Direct',
      contactName: `Contact ${randomInt(1, 99)}`,
      contactEmail: `contact@${unit.supplierName.toLowerCase().replace(/\s+/g, '')}.co.uk`,
      phone: `07${randomInt(100, 999)} ${randomInt(100, 999)} ${randomInt(100, 999)}`,
      address: `${randomInt(1, 999)} ${randomChoice(['High Street', 'Market Road', 'Industrial Way', 'Tech Park', 'Business Centre'])}, London, EC${randomInt(1, 9)}A ${randomInt(1, 9)}${randomChoice('ABCDEFGHIJKLMNOPQRSTUVWXYZ')}${randomChoice('ABCDEFGHIJKLMNOPQRSTUVWXYZ')}`,
      paymentTerms: randomChoice(['Net 30', 'Net 14', 'Cash on delivery', 'Net 7', 'Prepayment']),
      returnTerms: randomChoice(['14-day returns', '30-day returns', 'No returns', 'Exchange only']),
      notes: `Regular supplier since ${randomChoice(['2021', '2022', '2023', '2024', '2025'])}`,
      websiteUrl: `https://www.${unit.supplierName.toLowerCase().replace(/\s+/g, '')}.co.uk`,
      ownerId: OWNER_ID,
      createdAt: unit.createdAt,
    });
  }

  // Track batches
  if (!batchMap.has(unit.batchId)) {
    batchMap.set(unit.batchId, {
      id: unit.batchId,
      supplierId: unit.supplierId,
      date: unit.dateIn,
      supplierRef: `INV-${randomInt(1000, 9999)}`,
      invoiceNumber: `INV-${randomInt(10000, 99999)}`,
      deliveryNote: `DN-${randomInt(1000, 9999)}`,
      receivedBy: randomChoice(['John Smith', 'Sarah Johnson', 'Mike Brown', 'Emma Davis', 'Chris Wilson']),
      warehouseLocation: 'office',
      currency: 'GBP',
      shippingCost: randomFloat(0, 50),
      taxAmount: randomFloat(0, 100),
      discountAmount: randomFloat(0, 50),
      notes: `Batch received on ${unit.dateIn}`,
      unitCount: 0,
      totalBuyValue: 0,
      ownerId: OWNER_ID,
      createdAt: unit.createdAt,
    });
  }
  const batch = batchMap.get(unit.batchId);
  batch.unitCount++;
  batch.totalBuyValue += unit.buyPrice;
}

console.log(`Generated ${units.length} units`);
console.log(`Suppliers: ${supplierMap.size}`);
console.log(`Batches: ${batchMap.size}`);

// ─── Generate Events ─────────────────────────────────────────────────────────

const events = [];
let eventId = 0;

for (const unit of units) {
  // Create batch_created event for each unit
  events.push({
    id: `evt_${(eventId++).toString().padStart(6, '0')}`,
    type: 'batch_created',
    message: `Unit added to inventory: ${unit.model}`,
    unitId: unit.id,
    batchId: unit.batchId,
    supplierId: unit.supplierId,
    platform: null,
    salePrice: null,
    buyPrice: unit.buyPrice,
    createdAt: unit.createdAt,
    ownerId: OWNER_ID,
  });

  if (unit.status === 'sold' && unit.saleDate) {
    events.push({
      id: `evt_${(eventId++).toString().padStart(6, '0')}`,
      type: 'sold',
      message: `Sold ${unit.model} for £${unit.salePrice} on ${unit.salePlatform}`,
      unitId: unit.id,
      batchId: unit.batchId,
      supplierId: unit.supplierId,
      platform: unit.salePlatform,
      salePrice: unit.salePrice,
      buyPrice: unit.buyPrice,
      createdAt: unit.saleDate,
      ownerId: OWNER_ID,
    });
  }

  if (unit.status === 'returned' && unit.returnDate) {
    events.push({
      id: `evt_${(eventId++).toString().padStart(6, '0')}`,
      type: 'returned',
      message: `Return: ${unit.model} - ${unit.returnReason}`,
      unitId: unit.id,
      batchId: unit.batchId,
      supplierId: unit.supplierId,
      platform: unit.salePlatform,
      salePrice: unit.salePrice,
      buyPrice: unit.buyPrice,
      createdAt: unit.returnDate,
      ownerId: OWNER_ID,
    });
  }

  if (unit.platformListed && unit.listingDate) {
    events.push({
      id: `evt_${(eventId++).toString().padStart(6, '0')}`,
      type: 'listed',
      message: `Listed ${unit.model} on ${unit.listingSites?.[0]}`,
      unitId: unit.id,
      batchId: unit.batchId,
      supplierId: unit.supplierId,
      platform: unit.listingSites?.[0],
      salePrice: null,
      buyPrice: unit.buyPrice,
      createdAt: unit.listingDate,
      ownerId: OWNER_ID,
    });
  }
}

console.log(`Generated ${events.length} events`);

// ─── Generate Daily Updates ──────────────────────────────────────────────────

const dailyUpdates = [];
const updateMessages = [
  'New stock arrival - {count} units of {model}',
  'Price adjustment on {model} - increased by £{amount}',
  'Price adjustment on {model} - decreased by £{amount}',
  'Bulk sale of {model} - {count} units sold',
  'Platform sync completed for {model}',
  'Supplier restock notification - {model} available',
  'Quality check completed - {count} units of {model} graded',
  'Flash sale preparation - {model} listed on all platforms',
];

for (let i = 0; i < 200; i++) {
  const date = randomDate(START_DATE, END_DATE);
  const messageTemplate = randomChoice(updateMessages);
  const model = randomChoice(units).model;
  const count = randomInt(1, 20);
  const amount = randomInt(10, 100);

  dailyUpdates.push({
    id: `upd_${i.toString().padStart(4, '0')}`,
    date: formatDate(date),
    message: messageTemplate
      .replace('{model}', model)
      .replace('{count}', count)
      .replace('{amount}', amount),
    affectedUnitIds: Array.from({ length: randomInt(1, 5) }, () => randomChoice(units).id),
    affectedModels: [model],
    type: randomChoice(['stock_in', 'stock_sold', 'price_change', 'platform_update', 'general']),
    ownerId: OWNER_ID,
    createdAt: formatDate(date),
  });
}

console.log(`Generated ${dailyUpdates.length} daily updates`);

// ─── Generate Active Listings ────────────────────────────────────────────────

const activeListings = [];
const listingMap = new Map();

for (const unit of units.filter(u => u.platformListed && u.status === 'available')) {
  const platform = unit.listingSites?.[0];
  const key = `${unit.model}_${platform}`;

  if (!listingMap.has(key)) {
    listingMap.set(key, {
      id: `list_${unit.model.replace(/\s+/g, '_').toLowerCase()}_${platform.toLowerCase()}`,
      model: unit.model,
      platform,
      quantity: 0,
      listingUrl: `https://www.${platform.toLowerCase().replace(/\s+/g, '')}.co.uk/item/${randomInt(1000000, 9999999)}`,
      listingId: `LST-${randomInt(10000, 99999)}`,
      notes: `Active listing since ${unit.listingDate}`,
      updatedAt: unit.listingDate,
      ownerId: OWNER_ID,
    });
  }
  listingMap.get(key).quantity++;
}

activeListings.push(...listingMap.values());
console.log(`Generated ${activeListings.length} active listings`);

// ─── Build Excel Workbook ────────────────────────────────────────────────────

const wb = XLSX.utils.book_new();

// Sheet 1: OG STOCK DATA (Main import sheet)
const ogStockHeaders = [
  'Date In', 'Model', 'IMEI / Serial', 'Supplier', 'Buy Price (£)',
  'Status', 'Sale Platform', 'Sale Price (£)', 'Sale Date',
  'Condition Grade', 'Box Included', 'Battery Health', 'Network Lock',
  'Activation Lock', 'Storage', 'Colour', 'Batch ID', 'Return Type',
  'Return Date', 'Return Reason', 'Postage Cost (£)', 'Notes',
];

const ogStockRows = units.map(u => [
  u.dateIn,
  u.model,
  u.imei,
  u.supplierName,
  u.buyPrice,
  u.status.toUpperCase(),
  u.salePlatform || '',
  u.salePrice || '',
  u.saleDate || '',
  u.conditionGrade,
  u.boxIncluded ? 'Yes' : 'No',
  u.batteryHealth || '',
  u.networkLock,
  u.activationLock || '',
  u.storage,
  u.colour,
  u.batchId,
  u.returnType || '',
  u.returnDate || '',
  u.returnReason || '',
  u.postageCost,
  u.notes,
]);

const wsOgStock = XLSX.utils.aoa_to_sheet([ogStockHeaders, ...ogStockRows]);
wsOgStock['!cols'] = [
  { wch: 12 }, { wch: 45 }, { wch: 18 }, { wch: 22 }, { wch: 12 },
  { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 10 },
  { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 16 }, { wch: 10 },
  { wch: 14 }, { wch: 30 }, { wch: 18 }, { wch: 12 }, { wch: 12 },
  { wch: 40 }, { wch: 10 }, { wch: 50 },
];
XLSX.utils.book_append_sheet(wb, wsOgStock, 'OG STOCK DATA');

// Sheet 2: SUPPLIERS
const supplierHeaders = ['ID', 'Name', 'Portal', 'Contact Name', 'Contact Email', 'Phone', 'Address', 'Payment Terms', 'Return Terms', 'Notes', 'Website URL'];
const supplierRows = Array.from(supplierMap.values()).map(s => [
  s.id, s.name, s.portal, s.contactName, s.contactEmail, s.phone, s.address,
  s.paymentTerms, s.returnTerms, s.notes, s.websiteUrl,
]);
const wsSuppliers = XLSX.utils.aoa_to_sheet([supplierHeaders, ...supplierRows]);
wsSuppliers['!cols'] = [{ wch: 30 }, { wch: 22 }, { wch: 12 }, { wch: 14 }, { wch: 35 }, { wch: 16 }, { wch: 40 }, { wch: 14 }, { wch: 14 }, { wch: 30 }, { wch: 40 }];
XLSX.utils.book_append_sheet(wb, wsSuppliers, 'SUPPLIERS');

// Sheet 3: BATCHES
const batchHeaders = ['ID', 'Supplier ID', 'Date', 'Supplier Ref', 'Invoice Number', 'Delivery Note', 'Received By', 'Warehouse', 'Currency', 'Shipping Cost', 'Tax Amount', 'Discount Amount', 'Notes', 'Unit Count', 'Total Buy Value'];
const batchRows = Array.from(batchMap.values()).map(b => [
  b.id, b.supplierId, b.date, b.supplierRef, b.invoiceNumber, b.deliveryNote,
  b.receivedBy, b.warehouseLocation, b.currency, b.shippingCost, b.taxAmount,
  b.discountAmount, b.notes, b.unitCount, b.totalBuyValue,
]);
const wsBatches = XLSX.utils.aoa_to_sheet([batchHeaders, ...batchRows]);
wsBatches['!cols'] = [{ wch: 35 }, { wch: 30 }, { wch: 12 }, { wch: 14 }, { wch: 16 }, { wch: 12 }, { wch: 16 }, { wch: 10 }, { wch: 8 }, { wch: 12 }, { wch: 10 }, { wch: 14 }, { wch: 30 }, { wch: 10 }, { wch: 14 }];
XLSX.utils.book_append_sheet(wb, wsBatches, 'BATCHES');

// Sheet 4: EVENTS
const eventHeaders = ['ID', 'Type', 'Message', 'Unit ID', 'Batch ID', 'Supplier ID', 'Platform', 'Sale Price', 'Buy Price', 'Created At'];
const eventRows = events.map(e => [
  e.id, e.type, e.message, e.unitId, e.batchId, e.supplierId, e.platform || '',
  e.salePrice || '', e.buyPrice, e.createdAt,
]);
const wsEvents = XLSX.utils.aoa_to_sheet([eventHeaders, ...eventRows]);
wsEvents['!cols'] = [{ wch: 14 }, { wch: 16 }, { wch: 50 }, { wch: 14 }, { wch: 35 }, { wch: 30 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 12 }];
XLSX.utils.book_append_sheet(wb, wsEvents, 'EVENTS');

// Sheet 5: DAILY UPDATES
const updateHeaders = ['ID', 'Date', 'Message', 'Affected Unit IDs', 'Affected Models', 'Type', 'Created At'];
const updateRows = dailyUpdates.map(u => [
  u.id, u.date, u.message, u.affectedUnitIds.join(', '), u.affectedModels.join(', '),
  u.type, u.createdAt,
]);
const wsUpdates = XLSX.utils.aoa_to_sheet([updateHeaders, ...updateRows]);
wsUpdates['!cols'] = [{ wch: 12 }, { wch: 12 }, { wch: 60 }, { wch: 40 }, { wch: 30 }, { wch: 16 }, { wch: 12 }];
XLSX.utils.book_append_sheet(wb, wsUpdates, 'DAILY UPDATES');

// Sheet 6: ACTIVE LISTINGS
const listingHeaders = ['ID', 'Model', 'Platform', 'Quantity', 'Listing URL', 'Listing ID', 'Notes', 'Updated At'];
const listingRows = activeListings.map(l => [
  l.id, l.model, l.platform, l.quantity, l.listingUrl, l.listingId, l.notes, l.updatedAt,
]);
const wsListings = XLSX.utils.aoa_to_sheet([listingHeaders, ...listingRows]);
wsListings['!cols'] = [{ wch: 50 }, { wch: 45 }, { wch: 12 }, { wch: 10 }, { wch: 50 }, { wch: 14 }, { wch: 30 }, { wch: 12 }];
XLSX.utils.book_append_sheet(wb, wsListings, 'ACTIVE LISTINGS');

// Sheet 7: QA SCENARIOS (Documentation)
const qaScenarios = [
  ['SCENARIO', 'COUNT', 'DESCRIPTION', 'TEST VALIDATION'],
  ['Total Units', units.length, 'Total number of inventory units generated', 'Verify app handles 5000+ units'],
  ['Date Range', `${formatDate(START_DATE)} to ${formatDate(END_DATE)}`, '5-year historical data span', 'Verify date filtering and aging calculations'],
  ['Available', units.filter(u => u.status === 'available').length, 'Units currently in stock', 'Verify stock visibility and periodic table'],
  ['Sold', units.filter(u => u.status === 'sold').length, 'Historical sold units', 'Verify sales reporting and revenue calculations'],
  ['Returned', units.filter(u => u.status === 'returned').length, 'Returned units with warranty info', 'Verify returns processing and warranty tracking'],
  ['Reserved', units.filter(u => u.status === 'reserved').length, 'Units on hold for customers', 'Verify reservation management'],
  ['Lost', units.filter(u => u.status === 'lost').length, 'Lost or written-off units', 'Verify loss tracking and insurance claims'],
  ['iPhone', units.filter(u => u.category === 'iPhone').length, 'Apple iPhone units', 'Verify iPhone category detection and grouping'],
  ['iPad', units.filter(u => u.category === 'iPad').length, 'Apple iPad units', 'Verify iPad category detection and grouping'],
  ['Apple Watch', units.filter(u => u.category === 'Apple Watch').length, 'Apple Watch units', 'Verify Watch category detection'],
  ['Samsung S Series', units.filter(u => u.category === 'Samsung S Series').length, 'Samsung Galaxy S units', 'Verify S Series detection'],
  ['Samsung A Series', units.filter(u => u.category === 'Samsung A Series').length, 'Samsung Galaxy A units', 'Verify A Series detection'],
  ['Tablet', units.filter(u => u.category === 'Tablet').length, 'Samsung Tablet/Z Fold/Flip units', 'Verify Tablet category detection'],
  ['Other', units.filter(u => u.category === 'Other').length, 'Other brands (Pixel, OnePlus, etc.)', 'Verify Other category handling'],
  ['Grade A', units.filter(u => u.conditionGrade === 'A').length, 'Pristine condition units', 'Verify condition-based filtering'],
  ['Grade B', units.filter(u => u.conditionGrade === 'B').length, 'Good condition units', 'Verify condition-based filtering'],
  ['Grade C', units.filter(u => u.conditionGrade === 'C').length, 'Fair condition units', 'Verify condition-based filtering'],
  ['Grade D', units.filter(u => u.conditionGrade === 'D').length, 'Poor condition units', 'Verify condition-based filtering'],
  ['Unknown Grade', units.filter(u => u.conditionGrade === 'Unknown').length, 'Ungraded units', 'Verify unknown grade handling'],
  ['Box Included', units.filter(u => u.boxIncluded).length, 'Units with original box', 'Verify box inclusion tracking'],
  ['No Box', units.filter(u => !u.boxIncluded).length, 'Units without original box', 'Verify box exclusion tracking'],
  ['Warranty Returns', units.filter(u => u.status === 'returned' && u.returnReason?.includes('Within 30-day warranty')).length, 'Returns within 30-day warranty', 'Verify warranty period validation'],
  ['Out-of-Warranty Returns', units.filter(u => u.status === 'returned' && u.returnReason?.includes('Outside 30-day warranty')).length, 'Returns outside warranty period', 'Verify out-of-warranty handling'],
  ['Returned to Inventory', units.filter(u => u.returnType === 'returned_to_inventory').length, 'Returns put back in stock', 'Verify inventory restocking'],
  ['Returned to Supplier', units.filter(u => u.returnType === 'returned_to_supplier').length, 'Returns sent back to supplier', 'Verify supplier return processing'],
  ['Repair', units.filter(u => u.returnType === 'repair').length, 'Units sent for repair', 'Verify repair workflow'],
  ['Listed on eBay', units.filter(u => u.listingSites?.includes('eBay')).length, 'Units listed on eBay', 'Verify eBay integration'],
  ['Listed on Amazon', units.filter(u => u.listingSites?.includes('Amazon')).length, 'Units listed on Amazon', 'Verify Amazon integration'],
  ['Listed on OnBuy', units.filter(u => u.listingSites?.includes('OnBuy')).length, 'Units listed on OnBuy', 'Verify OnBuy integration'],
  ['Listed on Backmarket', units.filter(u => u.listingSites?.includes('Backmarket')).length, 'Units listed on Backmarket', 'Verify Backmarket integration'],
  ['Profit Margin >30%', units.filter(u => u.status === 'sold' && ((u.salePrice - u.buyPrice) / u.buyPrice) > 0.3).length, 'High profit sales', 'Verify profit calculation'],
  ['Loss Sales', units.filter(u => u.status === 'sold' && u.salePrice < u.buyPrice).length, 'Sales at loss', 'Verify loss tracking'],
  ['Aged Stock (90+ days)', units.filter(u => u.status === 'available' && (END_DATE - new Date(u.dateIn)) / 86400000 > 90).length, 'Unsold for 90+ days', 'Verify aged stock alerts'],
  ['Aged Stock (180+ days)', units.filter(u => u.status === 'available' && (END_DATE - new Date(u.dateIn)) / 86400000 > 180).length, 'Unsold for 180+ days', 'Verify critical aged stock alerts'],
  ['Aged Stock (365+ days)', units.filter(u => u.status === 'available' && (END_DATE - new Date(u.dateIn)) / 86400000 > 365).length, 'Unsold for 365+ days', 'Verify extreme aged stock handling'],
  ['Recent Arrivals (7 days)', units.filter(u => (END_DATE - new Date(u.dateIn)) / 86400000 <= 7).length, 'Stock arrived in last 7 days', 'Verify recent arrival tracking'],
  ['Battery Health <80%', units.filter(u => u.batteryHealth && u.batteryHealth < 80).length, 'Units with degraded battery', 'Verify battery health monitoring'],
  ['iCloud Locked', units.filter(u => u.activationLock === 'iCloud Locked').length, 'iCloud-locked Apple devices', 'Verify activation lock detection'],
  ['Network Locked', units.filter(u => u.networkLock !== 'Unlocked').length, 'Carrier-locked devices', 'Verify network lock tracking'],
  ['Suppliers', supplierMap.size, 'Unique suppliers', 'Verify supplier management'],
  ['Batches', batchMap.size, 'Unique purchase batches', 'Verify batch tracking'],
  ['Events', events.length, 'Total inventory events', 'Verify event logging'],
  ['Daily Updates', dailyUpdates.length, 'Operational updates', 'Verify daily update feed'],
  ['Active Listings', activeListings.length, 'Active platform listings', 'Verify listing reconciliation'],
];

const wsQA = XLSX.utils.aoa_to_sheet(qaScenarios);
wsQA['!cols'] = [{ wch: 25 }, { wch: 10 }, { wch: 50 }, { wch: 50 }];
XLSX.utils.book_append_sheet(wb, wsQA, 'QA SCENARIOS');

// Sheet 8: INSTRUCTIONS
const instructions = [
  ['QA TEST DATA GENERATOR - INSTRUCTIONS'],
  [],
  ['FILE OVERVIEW'],
  ['This Excel file contains comprehensive test data for the InventoryManager application.'],
  ['It covers a 5-year period from May 2021 to May 2026 with 5000 inventory units.'],
  [],
  ['SHEETS DESCRIPTION'],
  ['OG STOCK DATA', 'Main import sheet - 5000 units with all fields populated'],
  ['SUPPLIERS', '18 unique suppliers with full contact details'],
  ['BATCHES', 'Purchase batches linking units to suppliers'],
  ['EVENTS', 'Inventory events (created, sold, returned, listed)'],
  ['DAILY UPDATES', '200 operational updates for testing the activity feed'],
  ['ACTIVE LISTINGS', 'Active platform listings for reconciliation testing'],
  ['QA SCENARIOS', 'Summary of test scenarios and expected counts'],
  ['INSTRUCTIONS', 'This sheet'],
  [],
  ['KEY TEST SCENARIOS COVERED'],
  ['✓ All device categories (iPhone, iPad, Apple Watch, Samsung S/A Series, Tablet, Other)'],
  ['✓ All statuses (available, sold, returned, reserved, lost)'],
  ['✓ All return types (returned_to_inventory, returned_to_supplier, repair)'],
  ['✓ All condition grades (A, B, C, D, Unknown)'],
  ['✓ Warranty tracking (within 30 days vs outside warranty)'],
  ['✓ All sales platforms (eBay, Amazon, OnBuy, Backmarket, Other)'],
  ['✓ Profit/loss scenarios (high margin, break-even, loss)'],
  ['✓ Aged stock (90+, 180+, 365+ days unsold)'],
  ['✓ Battery health monitoring (<80% degraded)'],
  ['✓ Activation lock detection (iCloud locked devices)'],
  ['✓ Network lock tracking (carrier-locked vs unlocked)'],
  ['✓ Box included/excluded scenarios'],
  ['✓ Recent arrivals (last 7 days)'],
  ['✓ 5-year date range (May 2021 - May 2026)'],
  ['✓ Duplicate IMEI handling (some serial numbers reused for testing)'],
  ['✓ Null/blank field handling (various optional fields left empty)'],
  [],
  ['IMPORT INSTRUCTIONS'],
  ['1. Use the OG STOCK DATA sheet for import via the ImportModal component'],
  ['2. The app auto-detects: category, brand, colour from the Model column'],
  ['3. Duplicate IMEIs are automatically collapsed during import'],
  ['4. Date format: YYYY-MM-DD (ISO standard)'],
  ['5. Status must be: AVAILABLE, SOLD, RETURNED, RESERVED, or LOST'],
  [],
  ['VALIDATION CHECKS'],
  ['- Verify total units match: 5000'],
  ['- Verify date range spans 5 years'],
  ['- Verify all statuses are represented'],
  ['- Verify profit calculations are correct'],
  ['- Verify warranty period logic (30 days)'],
  ['- Verify aged stock alerts trigger correctly'],
  ['- Verify dashboard KPIs calculate correctly'],
  ['- Verify periodic table groups units correctly'],
  ['- Verify returns page shows warranty status'],
];

const wsInstructions = XLSX.utils.aoa_to_sheet(instructions);
wsInstructions['!cols'] = [{ wch: 80 }];
XLSX.utils.book_append_sheet(wb, wsInstructions, 'INSTRUCTIONS');

// ─── Save Workbook ───────────────────────────────────────────────────────────

const outputPath = path.join(__dirname, 'INVENTORY_QA_TEST_5000.xlsx');
XLSX.writeFile(wb, outputPath);

console.log('\n✅ QA Test Excel generated successfully!');
console.log(`   File: ${outputPath}`);
console.log(`   Total Units: ${units.length}`);
console.log(`   Date Range: ${formatDate(START_DATE)} to ${formatDate(END_DATE)}`);
console.log(`   Suppliers: ${supplierMap.size}`);
console.log(`   Batches: ${batchMap.size}`);
console.log(`   Events: ${events.length}`);
console.log(`   Daily Updates: ${dailyUpdates.length}`);
console.log(`   Active Listings: ${activeListings.length}`);
console.log(`   Sheets: 8`);

// Print status breakdown
console.log('\n📊 Status Breakdown:');
for (const status of ['available', 'sold', 'returned', 'reserved', 'lost']) {
  const count = units.filter(u => u.status === status).length;
  const pct = ((count / units.length) * 100).toFixed(1);
  console.log(`   ${status}: ${count} (${pct}%)`);
}

// Print category breakdown
console.log('\n📱 Category Breakdown:');
for (const cat of ['iPhone', 'iPad', 'Apple Watch', 'Samsung S Series', 'Samsung A Series', 'Tablet', 'Other']) {
  const count = units.filter(u => u.category === cat).length;
  console.log(`   ${cat}: ${count}`);
}

// Print warranty breakdown
const warrantyReturns = units.filter(u => u.status === 'returned' && u.returnReason?.includes('Within 30-day warranty')).length;
const nonWarrantyReturns = units.filter(u => u.status === 'returned' && u.returnReason?.includes('Outside 30-day warranty')).length;
console.log('\n🔧 Warranty Breakdown:');
console.log(`   Within Warranty: ${warrantyReturns}`);
console.log(`   Outside Warranty: ${nonWarrantyReturns}`);

// Print aged stock
const aged90 = units.filter(u => u.status === 'available' && (END_DATE - new Date(u.dateIn)) / 86400000 > 90).length;
const aged180 = units.filter(u => u.status === 'available' && (END_DATE - new Date(u.dateIn)) / 86400000 > 180).length;
const aged365 = units.filter(u => u.status === 'available' && (END_DATE - new Date(u.dateIn)) / 86400000 > 365).length;
console.log('\n📅 Aged Stock Breakdown:');
console.log(`   90+ days: ${aged90}`);
console.log(`   180+ days: ${aged180}`);
console.log(`   365+ days: ${aged365}`);