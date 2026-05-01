import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// ── Clear any previously seeded local cache ──────────────────────────────────
// This ensures the app always starts fresh after the seed was disabled.
// Safe to run every time — has no effect once the cache is already empty.
const SEED_CLEARED_KEY = 'nexus_seed_cleared_v2';
if (!localStorage.getItem(SEED_CLEARED_KEY)) {
  const keysToRemove = Object.keys(localStorage).filter(k => k.startsWith('nexus_db_'));
  keysToRemove.forEach(k => localStorage.removeItem(k));
  localStorage.setItem(SEED_CLEARED_KEY, '1');
  console.log(`[Startup] Cleared ${keysToRemove.length} cached collection(s) from localStorage.`);
}
// ─────────────────────────────────────────────────────────────────────────────

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

