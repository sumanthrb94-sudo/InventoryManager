import { buildModelSummaries } from './src/lib/modelSummaries.ts';
import { getOnHandValue } from './src/lib/inventorySummary.ts';

// --- Mock Data ---
const mockUnits = [
  {
    id: 'unit_1',
    imei: '358912345678901',
    model: 'iPhone 13 Pro',
    brand: 'Apple',
    category: 'iPhone',
    colour: 'Graphite',
    buyPrice: 500,
    status: 'available',
    dateIn: '2025-01-01',
    supplierId: 'sup_1',
    flags: [],
  },
  {
    id: 'unit_2',
    imei: 'J33G51QXQL', // Alphanumeric Serial
    model: 'iPad Air (5th Gen)',
    brand: 'Apple',
    category: 'iPad',
    colour: 'Space Grey',
    buyPrice: 350,
    status: 'available',
    dateIn: '2024-11-15', // Older
    supplierId: 'sup_2',
    flags: [],
  },
  {
    id: 'unit_3',
    imei: '990000862471854',
    model: 'Galaxy S23',
    brand: 'Samsung',
    category: 'Samsung S Series',
    colour: 'Phantom Black',
    buyPrice: 400,
    status: 'sold',
    dateIn: '2026-04-10',
    salePrice: 550,
    salePlatform: 'eBay',
    supplierId: 'sup_1',
    flags: [],
  }
];

const mockSuppliers = [
  { id: 'sup_1', name: 'Direct Supplier A' },
  { id: 'sup_2', name: 'Wholesale Corp' }
];

let testsPassed = 0;
let testsFailed = 0;

function assert(condition: boolean, testName: string) {
  if (condition) {
    console.log(`✅ PASS: ${testName}`);
    testsPassed++;
  } else {
    console.error(`❌ FAIL: ${testName}`);
    testsFailed++;
  }
}

console.log('--- RUNNING INVENTORY SYSTEM TESTS ---\n');

// 1. Test Dashboard "Oldest Unsold Stock" Logic
const availableUnits = mockUnits.filter(u => u.status === 'available');
const oldestUnits = [...availableUnits]
  .sort((a, b) => new Date(a.dateIn).getTime() - new Date(b.dateIn).getTime())
  .slice(0, 10);

assert(oldestUnits.length === 2, 'Dashboard - Should only filter available units');
assert(oldestUnits[0].id === 'unit_2', 'Dashboard - Should correctly sort oldest unit first (iPad from 2024)');

// 2. Test Inventory "Search" Logic with Alphanumeric Serial
const search = 'j33g51q'; // Lowercase partial match
const searchLower = search.toLowerCase();
const allSummaries = buildModelSummaries(mockUnits as any);

const filteredSummaries = allSummaries.filter(s => {
  return s.model.toLowerCase().includes(searchLower) ||
         s.brand.toLowerCase().includes(searchLower) ||
         s.variants.some(v => v.colour.toLowerCase().includes(searchLower) ||
                              v.units.some(u => u.imei.toLowerCase().includes(searchLower)));
});

assert(filteredSummaries.length === 1, 'Inventory - Should find exactly 1 matching model for alphanumeric serial');
assert(filteredSummaries[0].model === 'iPad Air (5th Gen)', 'Inventory - Should accurately identify the iPad model via serial');

// 3. Test Supplier Aggregation
const supplierStats: any = {};
for (const u of mockUnits) {
  if (!supplierStats[u.supplierId]) {
    supplierStats[u.supplierId] = { total: 0, available: 0, sold: 0, totalCost: 0, revenue: 0 };
  }
  const s = supplierStats[u.supplierId];
  s.total++;
  s.totalCost += u.buyPrice;
  if (u.status === 'available') s.available++;
  if (u.status === 'sold') {
    s.sold++;
    s.revenue += u.salePrice || 0;
  }
}

assert(supplierStats['sup_1'].total === 2, 'Suppliers - Should accurately count total units for Supplier A');
assert(supplierStats['sup_1'].revenue === 550, 'Suppliers - Should accurately sum Gross Revenue without relying on profit field');
assert(supplierStats['sup_2'].totalCost === 350, 'Suppliers - Should accurately sum Stock Cost for Supplier B');

// 4. Test Stock Value Logic
const onHandValue = getOnHandValue(mockUnits as any);
assert(onHandValue === 850, 'Inventory Summary - Should accurately sum buyPrice for ONLY available units (500 + 350)');

console.log(`\n--- TEST RESULTS ---`);
console.log(`Tests Passed: ${testsPassed}`);
console.log(`Tests Failed: ${testsFailed}`);

if (testsFailed > 0) process.exit(1);
