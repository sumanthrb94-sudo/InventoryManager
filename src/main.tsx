import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { seedDefaultInventoryData } from './lib/seedData';
import { dedupeInventoryUnitsByImei } from './lib/inventoryMaintenance';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

void seedDefaultInventoryData().catch(err => {
  console.error('Inventory seed failed:', err);
});

void dedupeInventoryUnitsByImei().catch(err => {
  console.error('Inventory dedupe failed:', err);
});
