/**
 * useBuildVersionCheck — detect stale browser sessions after a Vercel deploy.
 *
 * The problem: Vercel serves index.html with no-cache, but the bundled JS
 * chunks have long-cache headers because their filenames are content-hashed.
 * Once a browser loads an old bundle, it KEEPS running that bundle until
 * the user refreshes — even if Vercel has shipped a newer one. Two users
 * on the same URL can therefore be running months-apart code (we saw this
 * surface as "admin and ops see different periodic tables").
 *
 * The fix: vite.config.ts injects the git SHA into:
 *   - `__BUILD_ID__` constant inside the JS bundle (compile-time)
 *   - `<meta name="build-id">` in index.html
 * This hook polls `/` every 5 minutes (and on focus / online events),
 * reads the live meta tag, and compares to the bundle's compile-time ID.
 * If they diverge, the consumer renders a small banner that lets the
 * operator reload at their convenience.
 *
 *   const { stale, reload } = useBuildVersionCheck();
 *   {stale && <Banner onClick={reload}>New version — reload</Banner>}
 */
import { useEffect, useState } from 'react';

const POLL_INTERVAL_MS = 5 * 60 * 1000;

async function fetchLiveBuildId(): Promise<string | null> {
  try {
    // Cache-bust the index.html fetch — otherwise the browser may serve
    // its own cached copy and we'd never detect new deploys.
    const res = await fetch(`/?v=${Date.now()}`, { cache: 'no-store', credentials: 'same-origin' });
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/<meta\s+name=["']build-id["']\s+content=["']([^"']+)["']/i);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

export function useBuildVersionCheck(): { stale: boolean; reload: () => void } {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      if (cancelled || stale) return;
      const live = await fetchLiveBuildId();
      if (cancelled || !live) return;
      if (live !== __BUILD_ID__) setStale(true);
    };

    const onFocus  = () => { void check(); };
    const onOnline = () => { void check(); };

    // Run once immediately so a freshly-opened tab catches a deploy that
    // landed while the laptop was asleep.
    void check();
    const t = window.setInterval(check, POLL_INTERVAL_MS);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);

    return () => {
      cancelled = true;
      window.clearInterval(t);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
    };
  }, [stale]);

  return {
    stale,
    reload: () => window.location.reload(),
  };
}
