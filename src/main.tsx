import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// ── Stale-cache guard (runs BEFORE React renders) ────────────────────────────
// Ensures localStorage is never in a state where version is set but data is gone.
const CURRENT_SEED_VERSION = 'client-v1';
const storedVersion = localStorage.getItem('nexus_seed_version');

if (storedVersion !== CURRENT_SEED_VERSION) {
  // Version mismatch — wipe stale cached tables so subscriptions never serve wrong data
  Object.keys(localStorage)
    .filter(k => k.startsWith('nexus_db_'))
    .forEach(k => localStorage.removeItem(k));
} else {
  // Version matches — but verify data actually exists (browser may have evicted it)
  const hasData = !!localStorage.getItem('nexus_db_inventoryUnits');
  if (!hasData) {
    // Data is gone; clear version key so seedDefaultInventoryData re-seeds on next cycle
    localStorage.removeItem('nexus_seed_version');
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
