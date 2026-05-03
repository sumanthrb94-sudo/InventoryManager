const XLSX = require('xlsx');
const wb = XLSX.readFile('C:/Users/Manikanta Sridhar M/Inventorymanager/InventoryManager/inventory_10k_qa.xlsx');
console.log(wb.SheetNames);
