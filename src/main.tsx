import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Auto-seed and dedupe have been intentionally disabled.
// The app now starts with a clean slate — use "Import Excel" to load data.
// To re-enable seeding, uncomment the lines below:
//
// import { seedDefaultInventoryData } from './lib/seedData';
// import { dedupeInventoryUnitsByImei } from './lib/inventoryMaintenance';
// void seedDefaultInventoryData().catch(err => console.error('Seed failed:', err));
// void dedupeInventoryUnitsByImei().catch(err => console.error('Dedupe failed:', err));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
