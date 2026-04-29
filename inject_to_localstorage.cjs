/**
 * inject_to_localstorage.cjs
 * Writes the parsed JSON into browser localStorage format.
 * Usage: open the app in Chrome, paste the output into the browser console.
 */
const fs   = require('fs');
const data = JSON.parse(fs.readFileSync('og_inventory_import.json', 'utf8'));

// Build localStorage-compatible script
const suppliersJson = JSON.stringify(data.suppliers);
const unitsJson     = JSON.stringify(data.units);

const script = `
// Nexus Inventory — Paste this entire block into your browser DevTools console
(function(){
  localStorage.setItem('nexus_db_suppliers', '${suppliersJson.replace(/'/g, "\\'")}');
  localStorage.setItem('nexus_db_inventoryUnits', '${unitsJson.replace(/'/g, "\\'")}');
  console.log('✓ Nexus DB loaded: ${data.suppliers.length} suppliers, ${data.units.length} units');
  window.location.reload();
})();
`;

fs.writeFileSync('inject_console.js', script);
console.log('✓ Written inject_console.js');
console.log('\nSteps:');
console.log('1. Open your Nexus app in Chrome (localhost or Vercel)');
console.log('2. Log in');
console.log('3. Open DevTools → Console (F12)');
console.log('4. Paste the contents of inject_console.js');
console.log('5. Press Enter — page reloads with all data loaded');
