const XLSX = require('xlsx');
const fs = require('fs');
const crypto = require('crypto');

function uid(...parts) {
  return crypto.createHash('md5').update(parts.join('|')).digest('hex').slice(0,16);
}

const FILE = 'C:/Users/Manikanta Sridhar M/Inventorymanager/InventoryManager/inventory_10k_qa.xlsx';
console.log('Reading file:', FILE);
const wb = XLSX.readFile(FILE);
const ws = wb.Sheets['Inventory'];
const rows = XLSX.utils.sheet_to_json(ws);

const suppliersMap = {};
const units = [];

for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  const model = r['Model'];
  if (!model) continue;

  const imei = r['IMEI'] ? r['IMEI'].toString() : '';
  const supplierName = r['Supplier'] || 'Unknown';
  const buyPrice = parseFloat(r['Buy Price']) || 0;
  const status = (r['Status'] || 'available').toString().toLowerCase();
  
  const supKey = supplierName.toUpperCase();
  if (!suppliersMap[supKey]) {
    suppliersMap[supKey] = {
      id: 'sup_' + uid(supKey),
      name: supplierName,
      portal: 'Direct',
      ownerId: 'anonymous',
      createdAt: new Date().toISOString(),
    };
  }
  
  let dateIn = r['Date In'];
  if (typeof dateIn === 'number') {
    dateIn = new Date(Math.round((dateIn - 25569) * 86400 * 1000)).toISOString().split('T')[0];
  }

  let saleDate = r['Sale Date'];
  if (typeof saleDate === 'number') {
    saleDate = new Date(Math.round((saleDate - 25569) * 86400 * 1000)).toISOString().split('T')[0];
  }

  const unitId = 'u_' + uid(imei || (model + i), dateIn || '', supplierName);

  units.push({
    id: unitId,
    imei,
    model,
    brand: r['Brand'] || 'Other',
    category: r['Category'] || 'Other',
    colour: r['Colour'] || 'Unknown',
    storage: r['Storage'] || '',
    conditionGrade: r['Condition'] || 'Unknown',
    buyPrice,
    dateIn: dateIn || '2025-01-01',
    supplierId: suppliersMap[supKey].id,
    status,
    flags: [],
    notes: r['Notes'] || '',
    platformListed: status === 'available',
    ownerId: 'anonymous',
    ...(status === 'sold' && r['Platform'] ? { salePlatform: r['Platform'] } : {}),
    ...(status === 'sold' && r['Sale Price'] ? { salePrice: parseFloat(r['Sale Price']) } : {}),
    ...(status === 'sold' && saleDate ? { saleDate: saleDate } : {}),
    ...(status === 'sold' && r['Order Number'] ? { saleOrderId: r['Order Number'].toString() } : {}),
    ...(status === 'sold' && r['Customer Name'] ? { customerName: r['Customer Name'].toString() } : {}),
    createdAt: new Date().toISOString(),
  });
}

const suppliers = Object.values(suppliersMap);
const out = { suppliers, units };
fs.writeFileSync('imported_inventory.json', JSON.stringify(out));
console.log(`Saved ${units.length} units and ${suppliers.length} suppliers to imported_inventory.json`);
