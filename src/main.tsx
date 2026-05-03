import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { clearAllLocalCaches } from './lib/dbService';

// ── PRODUCTION: Always clear localStorage cache on startup ─────────────────
// Firestore is the single source of truth. localStorage is only used as
// a read-only offline cache that gets populated by onSnapshot.
// Clearing on startup prevents stale/diverged data across devices.
clearAllLocalCaches();
console.log('[Startup] Cleared all localStorage caches. Waiting for Firestore sync...');
// ─────────────────────────────────────────────────────────────────────────────

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

