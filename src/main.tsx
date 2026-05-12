import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Stale-chunk recovery.
//
// Vercel ships a new build → every chunk gets a new hash → the user's
// already-open tab still has the old index.html in memory referencing
// chunk names like `index-4nMqtr8p.js` that no longer exist on disk.
// The lazy-loaded tesseract.js module (or any other code-split chunk)
// then fails with "Failed to fetch dynamically imported module" or
// "Failed to load module script" — and the failure is permanent for
// the lifetime of the tab unless we reload.
//
// We trap those specific errors globally and force a hard reload at
// most once per session. The sessionStorage flag keeps us from looping
// if the reload itself somehow hits a real (non-stale) chunk problem.
const STALE_CHUNK_PATTERNS = [
  /Failed to fetch dynamically imported module/i,
  /Failed to load module script/i,
  /Importing a module script failed/i,
  /Loading chunk \S+ failed/i,
];

function looksLikeStaleChunk(message: string | undefined): boolean {
  if (!message) return false;
  return STALE_CHUNK_PATTERNS.some(re => re.test(message));
}

function recoverFromStaleChunk(reason: unknown) {
  const message = reason instanceof Error ? reason.message : String(reason);
  if (!looksLikeStaleChunk(message)) return;
  const KEY = 'app:reloaded-for-stale-chunk';
  if (sessionStorage.getItem(KEY)) return; // already tried once this session
  sessionStorage.setItem(KEY, String(Date.now()));
  console.warn('[App] Stale chunk detected, reloading once:', message);
  window.location.reload();
}

window.addEventListener('error', e => recoverFromStaleChunk(e.error || e.message));
window.addEventListener('unhandledrejection', e => recoverFromStaleChunk(e.reason));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
