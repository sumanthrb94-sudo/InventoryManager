import { InventoryUnit } from '../../types';

/**
 * Seed Data Generator for Mock Database Testing
 * Generates 200 realistic inventory units with:
 * - Varied statuses (available, sold, incoming, returned)
 * - Historical dates (past 6 months)
 * - Realistic models and prices
 * - Multiple suppliers and batches
 */

export function generateMockSeedData(): InventoryUnit[] {
  const units: InventoryUnit[] = [];
  const today = new Date();

  const models = [
    'iPhone 15 Pro Max 256GB',
    'iPhone 15 Pro 512GB',
    'iPhone 15 256GB',
    'iPhone 14 Pro 256GB',
    'iPhone 14 128GB',
    'iPhone 13 Pro 256GB',
    'iPhone 13 128GB',
    'Samsung Galaxy S24 Ultra 256GB',
    'Samsung Galaxy S24 128GB',
    'Samsung Galaxy S23 256GB',
    'Samsung Galaxy S23 128GB',
    'Google Pixel 8 Pro 128GB',
    'Google Pixel 8 256GB',
    'Google Pixel 7 Pro 256GB',
    'OnePlus 12 256GB',
    'Sony Xperia 1 V 256GB',
    'Google Pixel Fold 256GB',
    'Samsung Galaxy Z Fold5 256GB',
    'Apple iPad Pro 12.9" 256GB',
    'Samsung Galaxy Tab S9 Ultra 256GB',
  ];

  const suppliers = [
    'sup_001', 'sup_002', 'sup_003', 'sup_004', 'sup_005',
    'sup_006', 'sup_007', 'sup_008', 'sup_009', 'sup_010'
  ];

  const colours = ['Black', 'White', 'Silver', 'Gold', 'Blue', 'Purple', 'Red', 'Green', 'Space Gray', 'Titanium'];
  const grades = ['Excellent', 'Good', 'Fair', 'Like New'];
  const platforms = ['eBay', 'Amazon', 'OnBuy', 'Backmarket'];

  // Helper to subtract days from today
  const getDateDaysAgo = (days: number): string => {
    const date = new Date(today);
    date.setDate(date.getDate() - days);
    return date.toISOString().split('T')[0];
  };

  // Helper to generate IMEI
  const generateIMEI = (index: number): string => {
    const base = String(352000000000000 + index).substring(0, 15);
    return base.padEnd(15, '0');
  };

  // Helper to get random element
  const randomFrom = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

  let unitIndex = 0;

  // Generate units with different statuses
  // 60% Available (120 units)
  for (let i = 0; i < 120; i++) {
    const daysAgo = Math.floor(Math.random() * 150) + 5; // 5-155 days ago
    const unit: InventoryUnit = {
      id: `unit_available_${i}`,
      imei: generateIMEI(unitIndex++),
      model: randomFrom(models),
      brand: randomFrom(['Apple', 'Samsung', 'Google', 'OnePlus', 'Sony']),
      category: randomFrom(['iPhone', 'Android', 'Tablet']),
      colour: randomFrom(colours),
      grade: randomFrom(grades),
      storage: randomFrom(['64GB', '128GB', '256GB', '512GB']),
      buyPrice: Math.round(Math.random() * 400 + 100),
      dateIn: getDateDaysAgo(daysAgo),
      supplierId: randomFrom(suppliers),
      batchId: `batch_${Math.floor(i / 20)}`,
      batchNo: `INV-${2026}${String(Math.floor(i / 20) + 1).padStart(2, '0')}`,
      status: 'available',
      flags: [],
      notes: `Available unit ${i + 1}`,
      platformListed: false,
      listingSites: [],
      ownerId: 'shared',
      createdAt: getDateDaysAgo(daysAgo) + 'T09:00:00Z',
    };
    units.push(unit);
  }

  // 30% Sold (60 units)
  for (let i = 0; i < 60; i++) {
    const daysAgo = Math.floor(Math.random() * 120) + 1; // 1-120 days ago
    const salePrice = Math.round(Math.random() * 350 + 120);
    const platform = randomFrom(platforms);

    // Calculate fee based on platform
    let fee = 0;
    if (platform === 'eBay') {
      fee = (salePrice * 0.128) + 0.30;
    } else if (platform === 'Amazon') {
      fee = salePrice * 0.08;
    } else if (platform === 'OnBuy') {
      fee = salePrice * 0.09;
    } else if (platform === 'Backmarket') {
      fee = salePrice * 0.10;
    }

    const buyPrice = Math.round(Math.random() * 300 + 100);
    const postage = Math.random() * 10 + 3;
    const profit = salePrice - buyPrice - fee - postage;

    const unit: InventoryUnit = {
      id: `unit_sold_${i}`,
      imei: generateIMEI(unitIndex++),
      model: randomFrom(models),
      brand: randomFrom(['Apple', 'Samsung', 'Google', 'OnePlus', 'Sony']),
      category: randomFrom(['iPhone', 'Android', 'Tablet']),
      colour: randomFrom(colours),
      grade: randomFrom(grades),
      storage: randomFrom(['64GB', '128GB', '256GB', '512GB']),
      buyPrice: buyPrice,
      dateIn: getDateDaysAgo(daysAgo + 20),
      salePrice: salePrice,
      platform: platform,
      orderId: `ORD-${String(Math.random()).substring(2, 7)}-${Date.now() % 100000}`,
      saleDate: getDateDaysAgo(daysAgo),
      postage: postage,
      profit: profit,
      supplierId: randomFrom(suppliers),
      batchId: `batch_${Math.floor((120 + i) / 20)}`,
      batchNo: `INV-${2026}${String(Math.floor((120 + i) / 20) + 1).padStart(2, '0')}`,
      status: 'sold',
      flags: [],
      notes: `Sold unit ${i + 1} - ${profit > 0 ? 'Profit' : 'Loss'}`,
      platformListed: false,
      listingSites: [],
      ownerId: 'shared',
      createdAt: getDateDaysAgo(daysAgo + 20) + 'T09:00:00Z',
    };
    units.push(unit);
  }

  // 8% Returned (16 units)
  for (let i = 0; i < 16; i++) {
    const daysAgo = Math.floor(Math.random() * 100) + 5;
    const unit: InventoryUnit = {
      id: `unit_returned_${i}`,
      imei: generateIMEI(unitIndex++),
      model: randomFrom(models),
      brand: randomFrom(['Apple', 'Samsung', 'Google', 'OnePlus', 'Sony']),
      category: randomFrom(['iPhone', 'Android', 'Tablet']),
      colour: randomFrom(colours),
      grade: randomFrom(grades),
      storage: randomFrom(['64GB', '128GB', '256GB', '512GB']),
      buyPrice: Math.round(Math.random() * 300 + 100),
      dateIn: getDateDaysAgo(daysAgo + 30),
      returnType: randomFrom(['Return to Inventory', 'Return to Supplier']),
      returnReason: randomFrom(['Defective', 'Change of Mind', 'Wrong Item', 'Damaged on Delivery']),
      returnDate: getDateDaysAgo(daysAgo),
      supplierId: randomFrom(suppliers),
      batchId: `batch_${Math.floor((180 + i) / 20)}`,
      batchNo: `INV-${2026}${String(Math.floor((180 + i) / 20) + 1).padStart(2, '0')}`,
      status: 'returned',
      flags: [],
      notes: `Returned unit ${i + 1}`,
      platformListed: false,
      listingSites: [],
      ownerId: 'shared',
      createdAt: getDateDaysAgo(daysAgo + 30) + 'T09:00:00Z',
    };
    units.push(unit);
  }

  // 2% Incoming/SHS (4 units)
  for (let i = 0; i < 4; i++) {
    const daysAgo = Math.floor(Math.random() * 30); // Very recent
    const unit: InventoryUnit = {
      id: `unit_incoming_${i}`,
      imei: '', // SHS units don't have IMEI initially
      model: randomFrom(models),
      brand: randomFrom(['Apple', 'Samsung', 'Google', 'OnePlus', 'Sony']),
      category: randomFrom(['iPhone', 'Android', 'Tablet']),
      colour: randomFrom(colours),
      grade: randomFrom(grades),
      storage: randomFrom(['64GB', '128GB', '256GB', '512GB']),
      buyPrice: Math.round(Math.random() * 400 + 100),
      dateIn: getDateDaysAgo(daysAgo),
      supplierId: randomFrom(suppliers),
      batchId: `batch_shs`,
      batchNo: `SHS-${Date.now() % 10000}`,
      status: 'incoming',
      flags: ['SHS'],
      notes: `SHS unit - IMEI pending`,
      platformListed: false,
      listingSites: [],
      ownerId: 'shared',
      createdAt: getDateDaysAgo(daysAgo) + 'T09:00:00Z',
    };
    units.push(unit);
  }

  return units;
}

/**
 * Reset seed data - clears and regenerates
 */
export function resetMockDatabase(): InventoryUnit[] {
  return generateMockSeedData();
}

/**
 * Get stats about seed data
 */
export function getMockDataStats(units: InventoryUnit[]) {
  const stats = {
    total: units.length,
    available: units.filter(u => u.status === 'available').length,
    sold: units.filter(u => u.status === 'sold').length,
    returned: units.filter(u => u.status === 'returned').length,
    incoming: units.filter(u => u.status === 'incoming').length,
    totalRevenue: units
      .filter(u => u.status === 'sold' && u.salePrice)
      .reduce((sum, u) => sum + (u.salePrice || 0), 0),
    totalProfit: units
      .filter(u => u.status === 'sold' && u.profit)
      .reduce((sum, u) => sum + (u.profit || 0), 0),
    averageBuyPrice: Math.round(
      units.reduce((sum, u) => sum + u.buyPrice, 0) / units.length
    ),
  };
  return stats;
}
