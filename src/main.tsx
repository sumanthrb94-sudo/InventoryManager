import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// ── Stale-cache guard (runs BEFORE React renders) ────────────────────────────
// If the seed version stored in localStorage doesn't match the current master,
// wipe the cached db tables NOW so subscriptions never serve wrong data.
// seedData.ts will repopulate from master_seed.json + Firestore in the background.
const CURRENT_SEED_VERSION = 'client-v1';
if (localStorage.getItem('nexus_seed_version') !== CURRENT_SEED_VERSION) {
  Object.keys(localStorage)
    .filter(k => k.startsWith('nexus_db_'))
    .forEach(k => localStorage.removeItem(k));
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
