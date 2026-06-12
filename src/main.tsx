import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { inject as injectAnalytics } from '@vercel/analytics';
import { injectSpeedInsights } from '@vercel/speed-insights';
import * as Sentry from '@sentry/react';
import App from './App.tsx';
import './index.css';

// ── Observability — Sentry + Vercel Analytics + Speed Insights ─────────────
// Sentry only initialises when VITE_SENTRY_DSN is set (Vercel env var); the
// dev server stays quiet without a DSN. Vercel Analytics + Speed Insights
// auto-no-op outside the Vercel runtime so they're safe in dev/CI too.
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: import.meta.env.MODE,
    // Trim noisy errors that aren't actionable (network blips, browser
    // extensions, the stale-chunk recovery flow below).
    ignoreErrors: [
      /Failed to fetch dynamically imported module/i,
      /Failed to load module script/i,
      /Loading chunk \S+ failed/i,
      /ResizeObserver loop/i,
      /Network request failed/i,
    ],
    tracesSampleRate: 0.1,           // 10% perf traces
    replaysOnErrorSampleRate: 1.0,   // capture replay on errors
    replaysSessionSampleRate: 0,     // no idle replays (battery / quota)
    integrations: [Sentry.browserTracingIntegration(), Sentry.replayIntegration({ maskAllText: false, blockAllMedia: true })],
  });
}
injectAnalytics();
injectSpeedInsights();

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
    <Sentry.ErrorBoundary
      fallback={({ error, resetError }) => (
        <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
          <div className="max-w-md w-full bg-white border border-rose-200 rounded-2xl shadow-lg p-6 space-y-4">
            <h1 className="text-lg font-bold text-rose-900">Something went wrong.</h1>
            <p className="text-sm text-slate-700">
              The error has been reported. You can try again — if it keeps
              happening, hard-refresh the page (Ctrl+Shift+R) or sign out
              and back in.
            </p>
            <pre className="text-xs font-mono text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-3 max-h-32 overflow-auto whitespace-pre-wrap break-words">
              {error instanceof Error ? error.message : String(error)}
            </pre>
            <div className="flex gap-2">
              <button
                onClick={() => resetError()}
                className="flex-1 py-2 rounded-xl bg-slate-900 text-white text-sm font-bold uppercase tracking-widest hover:bg-slate-700 transition-all"
              >
                Try again
              </button>
              <button
                onClick={() => window.location.reload()}
                className="flex-1 py-2 rounded-xl border border-slate-300 text-slate-900 text-sm font-bold uppercase tracking-widest hover:bg-slate-50 transition-all"
              >
                Reload
              </button>
            </div>
          </div>
        </div>
      )}
    >
      <App />
    </Sentry.ErrorBoundary>
  </StrictMode>,
);
