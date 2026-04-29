const fs = require('fs');
const path = require('path');

const componentsDir = path.join(__dirname, 'src', 'components');

const filesToUpdate = [
  'Dashboard.tsx',
  'Inventory.tsx',
  'Suppliers.tsx',
  'Sales.tsx',
  'NewBatchModal.tsx'
];

filesToUpdate.forEach(file => {
  const filePath = path.join(componentsDir, file);
  if (!fs.existsSync(filePath)) return;
  
  let content = fs.readFileSync(filePath, 'utf8');

  // Generic background and text colors
  content = content.replace(/bg-black/g, 'bg-white');
  content = content.replace(/text-white/g, 'text-black');
  
  // Specific dark mode classes to light mode
  content = content.replace(/bg-\[\#020202\]/g, 'bg-gray-50');
  content = content.replace(/bg-\[\#0B0B0B\]/g, 'bg-white');
  
  // Borders
  content = content.replace(/border-white\/5/g, 'border-gray-200');
  content = content.replace(/border-white\/10/g, 'border-gray-200');
  content = content.replace(/border-white\/20/g, 'border-gray-300');
  content = content.replace(/border-white\/40/g, 'border-gray-400');
  content = content.replace(/border-white/g, 'border-gray-200');
  
  // Subtle backgrounds
  content = content.replace(/bg-white\/\[0\.01\]/g, 'bg-gray-50');
  content = content.replace(/bg-white\/\[0\.02\]/g, 'bg-gray-50');
  content = content.replace(/bg-white\/\[0\.03\]/g, 'bg-gray-50');
  content = content.replace(/bg-white\/\[0\.05\]/g, 'bg-white');
  content = content.replace(/bg-white\/5/g, 'bg-gray-50');
  content = content.replace(/bg-white\/10/g, 'bg-gray-100');

  // Hover states
  content = content.replace(/hover:bg-white\/\[0\.02\]/g, 'hover:bg-gray-100');
  content = content.replace(/hover:bg-white\/\[0\.03\]/g, 'hover:bg-gray-100');
  content = content.replace(/hover:bg-white\/5/g, 'hover:bg-gray-100');
  
  // Custom Recharts replacements
  if (file === 'Dashboard.tsx') {
    content = content.replace(/stopColor="#ffffff"/g, 'stopColor="#000000"');
    content = content.replace(/stroke="#ffffff10"/g, 'stroke="#00000010"');
    content = content.replace(/stroke="#ffffff50"/g, 'stroke="#00000050"');
    content = content.replace(/backgroundColor: '#1A1A1A', border: '1px solid #ffffff10'/g, "backgroundColor: '#ffffff', border: '1px solid #00000010'");
    content = content.replace(/itemStyle={{ color: '#fff' }}/g, "itemStyle={{ color: '#000' }}");
    content = content.replace(/stroke="#ffffff"/g, 'stroke="#000000"');
    content = content.replace(/bg-white/g, 'bg-black'); // fix inverted
  }

  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`Updated ${file}`);
});
