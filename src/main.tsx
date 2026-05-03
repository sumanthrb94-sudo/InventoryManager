import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// ── NOTE: localStorage cache is preserved for offline support ───────────────
// Firestore onSnapshot updates the cache. Data syncs across devices via Firestore.
// Do NOT clear cache here - it contains user data.
// ─────────────────────────────────────────────────────────────────────────────

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

