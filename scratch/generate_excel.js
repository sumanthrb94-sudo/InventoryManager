import * as XLSX from 'xlsx';
import fs from 'fs';

const brands = ["Apple", "Samsung"];
const models = {
    "Apple": ["iPhone 15 Pro Max", "iPhone 15 Pro", "iPhone 15", "iPhone 14 Pro Max", "iPhone 14", "iPhone 13"],
    "Samsung": ["Galaxy S24 Ultra", "Galaxy S24+", "Galaxy S24", "Galaxy S23 Ultra", "Galaxy S23", "Galaxy S22 Ultra"]
};
const storage = ["128GB", "256GB", "512GB", "1TB"];
const colors = {
    "Apple": ["Natural Titanium", "Blue Titanium", "Black Titanium", "White Titanium", "Space Grey", "Silver", "Gold", "Starlight", "Midnight"],
    "Samsung": ["Titanium Gray", "Titanium Black", "Titanium Violet", "Phantom Black", "Cream", "Lavender", "Green"]
};
const suppliers = ["Amazon UK", "eBay Wholesale", "Backmarket Direct", "Lazada Bulk", "Local Trade-in"];
const statuses = ["AVAILABLE", "SOLD"];
const platforms = ["eBay", "Amazon", "OnBuy", "Backmarket", "Direct"];

const data = [
    ["Date In", "Model", "IMEI", "Supplier", "Buy Price", "Status", "Platform", "Sale Price", "Sale Date"]
];

const now = new Date();

for (let i = 0; i < 1000; i++) {
    const brand = brands[Math.floor(Math.random() * brands.length)];
    const model_name = models[brand][Math.floor(Math.random() * models[brand].length)];
    const st = storage[Math.floor(Math.random() * storage.length)];
    const color = colors[brand][Math.floor(Math.random() * colors[brand].length)];
    
    const full_model = `${model_name} ${st} ${color}`;
    
    // Generate fake IMEI (15 digits)
    const imei = Array.from({length: 15}, () => Math.floor(Math.random() * 10)).join('');
    
    // Generate a date within the last 90 days so the calendar shows activity
    const daysAgo = Math.floor(Math.random() * 90);
    const dateObj = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
    const date_in = dateObj.toISOString().split('T')[0];

    const supplier = suppliers[Math.floor(Math.random() * suppliers.length)];
    const buy_price = Math.floor(Math.random() * 800) + 400;
    
    const status = statuses[Math.floor(Math.random() * statuses.length)];
    let platform = "";
    let sale_price = "";
    let sale_date = "";
    
    if (status === "SOLD") {
        platform = platforms[Math.floor(Math.random() * platforms.length)];
        sale_price = buy_price + Math.floor(Math.random() * 150) + 50;
        // Sale date is between dateIn and now
        const saleDaysAgo = Math.floor(Math.random() * (daysAgo + 1));
        const saleDateObj = new Date(now.getTime() - saleDaysAgo * 24 * 60 * 60 * 1000);
        sale_date = saleDateObj.toISOString().split('T')[0];
    } else {
        // Available items: Assign a listing platform by default
        platform = platforms[Math.floor(Math.random() * (platforms.length - 1))];
    }
    
    data.push([date_in, full_model, imei, supplier, buy_price, status, platform, sale_price, sale_date]);
}

// Manually ensure exactly TWO items are unlisted (Available with no Platform)
let unlistedCount = 0;
for (let i = 1; i < data.length && unlistedCount < 2; i++) {
    if (data[i][5] === "AVAILABLE") {
        data[i][6] = ""; // Clear platform
        unlistedCount++;
    }
}

const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet(data);
XLSX.utils.book_append_sheet(wb, ws, "Inventory");

XLSX.writeFile(wb, "inventory_1000_v2.xlsx");

console.log("Generated 1000 rows in inventory_1000_v2.xlsx with dates from the last 90 days.");
