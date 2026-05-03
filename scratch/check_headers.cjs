const XLSX = require('xlsx');
const wb = XLSX.readFile('C:/Users/Manikanta Sridhar M/Inventorymanager/InventoryManager/inventory_10k_qa.xlsx');
const ws = wb.Sheets['Inventory'];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
console.log(rows[0]);
