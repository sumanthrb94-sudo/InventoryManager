const xlsx = require('xlsx');
const fs = require('fs');

const MODELS = [
  'iPhone 15 Pro Max', 'iPhone 15 Pro', 'iPhone 15', 'iPhone 14 Pro Max', 'iPhone 14',
  'iPhone 13', 'iPhone 12', 'iPhone 11', 'iPhone SE (2022)',
  'Samsung Galaxy S24 Ultra', 'Samsung Galaxy S23', 'Samsung Galaxy S22',
  'Google Pixel 8 Pro', 'Google Pixel 7a', 'Google Pixel 6'
];

const COLORS = ['Black', 'White', 'Blue', 'Titanium', 'Red', 'Green', 'Purple'];
const STORAGES = ['64GB', '128GB', '256GB', '512GB', '1TB'];
const GRADES = ['Grade A', 'Grade B', 'Grade C', 'Grade D'];
const PLATFORMS = ['eBay', 'Amazon', 'Backmarket', 'OnBuy'];
const SUPPLIERS = [
  { id: 'supp_1', name: 'TechWholesale Ltd' },
  { id: 'supp_2', name: 'Global Devices Inc' },
  { id: 'supp_3', name: 'EuroPhones' }
];

const generateImei = () => '35' + Math.floor(Math.random() * 10000000000000).toString().padStart(13, '0');

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomDate(start, end) {
  const d = new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
  return d.toISOString().split('T')[0];
}

const data = [];
const units = [];

const TOTAL = 5000;

for (let i = 0; i < TOTAL; i++) {
  const model = randomChoice(MODELS);
  const color = randomChoice(COLORS);
  const storage = randomChoice(STORAGES);
  const condition = randomChoice(GRADES);
  const supplier = randomChoice(SUPPLIERS);
  const imei = generateImei();
  
  const buyPrice = Math.floor(Math.random() * 500) + 150;
  
  // Date in (up to 2 years ago)
  const dateIn = randomDate(new Date(2023, 0, 1), new Date());
  
  // Decide status
  const rand = Math.random();
  let status = 'available';
  let salePrice = null;
  let saleDate = null;
  let platform = null;
  let orderId = null;
  let returnType = null;
  let returnDate = null;
  let returnReason = null;
  let postage = null;
  
  // 30% available, 60% sold, 10% returned
  if (rand < 0.6) {
    status = 'sold';
    salePrice = buyPrice + Math.floor(Math.random() * 150) + 50;
    // Edge case: some sold recently, some sold > 1 year ago for expired warranty
    const saleStart = new Date(dateIn);
    saleDate = randomDate(saleStart, new Date());
    platform = randomChoice(PLATFORMS);
    orderId = `ORD-${Math.floor(Math.random() * 999999)}`;
    postage = Math.floor(Math.random() * 10) + 3;
  } else if (rand < 0.7) {
    status = 'returned';
    // Edge case: Returns
    const returnTypes = ['repair', 'returned_to_supplier', 'returned_to_inventory'];
    returnType = randomChoice(returnTypes);
    
    if (returnType === 'returned_to_inventory') {
      status = 'available'; // actually, returned to inventory becomes available again!
    }
    
    returnDate = randomDate(new Date(dateIn), new Date());
    returnReason = randomChoice(['Customer changed mind', 'Faulty battery', 'Wrong item received', 'Scratched screen']);
    
    // We clear sale info if returned, as per your business logic
  }

  // Generate row for Excel
  data.push({
    'IMEI': imei,
    'Model': model,
    'Colour': color,
    'Capacity': storage,
    'Grade': condition,
    'Supplier': supplier.name,
    'Date In': dateIn,
    'Buy Price': buyPrice,
    'Status': status,
    'Sale Price': salePrice || '',
    'Sale Date': saleDate || '',
    'Platform': platform || '',
    'Order ID': orderId || '',
    'Postage Cost': postage || '',
    'Return Type': returnType || '',
    'Return Date': returnDate || '',
    'Return Reason': returnReason || ''
  });

  // Generate row for JSON
  units.push({
    id: `unit_5k_${i}`,
    imei,
    model,
    colour: color,
    storage,
    conditionGrade: condition.replace('Grade ', ''),
    supplierId: supplier.id,
    dateIn,
    buyPrice,
    status,
    salePrice,
    saleDate,
    salePlatform: platform,
    saleOrderId: orderId,
    postageCost: postage,
    returnType,
    returnDate,
    returnReason,
    createdAt: dateIn
  });
}

// 1. Write Excel File
const ws = xlsx.utils.json_to_sheet(data);
const wb = xlsx.utils.book_new();
xlsx.utils.book_append_sheet(wb, ws, "Inventory");
xlsx.writeFile(wb, "inventory_5000_edge_cases.xlsx");
console.log("Created Excel file: inventory_5000_edge_cases.xlsx");

// 2. Write JSON File for Web App seeding
const appData = {
  suppliers: SUPPLIERS,
  units
};
fs.writeFileSync("public/inventory_5k.json", JSON.stringify(appData));
console.log("Created Web JSON: public/inventory_5k.json");
