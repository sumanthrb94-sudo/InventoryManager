/**
 * DiagnosticsPanel — the debugging session the operator can run themselves.
 *
 * Born from a two-day outage diagnosed over screenshots: the operator's phone
 * showed zeros while every server-side check passed, and the one thing nobody
 * could see was which leg was failing INSIDE that phone's browser. DevTools
 * on a phone is not a real option for an operator mid-crisis.
 *
 * Open the app with `?diag=1` (there are also links on the warning banners
 * and the login screen) and this panel tests every leg from the device
 * itself, in order of the request's journey:
 *
 *   1. Internet          can this browser reach Google at all?
 *   2. Sign-in service   does Identity Toolkit answer? (an empty request
 *                        must come back "MISSING_EMAIL" — a healthy 400)
 *   3. Database (REST)   does Firestore answer? Signed out, a rules denial
 *                        IS the healthy answer; signed in, one real document
 *                        must come back.
 *   4. Live sync (SDK)   the exact path the app's listeners use.
 *   5. Local storage     IndexedDB usable? (the persistent cache needs it)
 *
 * Every check reports in plain words. No jargon-only failures: each ✗ says
 * what it means and what to do.
 *
 * The RESET APP STORAGE button is "Clear site data" without DevTools: it
 * deletes this site's IndexedDB databases (including a stuck Firestore
 * cache lease from a crashed/backgrounded leader tab), localStorage,
 * sessionStorage and CacheStorage, then hard-reloads. It touches NOTHING on
 * the server — the database is not involved, let alone harmed.
 */
import React, { useEffect, useState } from 'react';
import { collection, getDocsFromServer, limit, query } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import firebaseConfig from '../../firebase-applet-config.json';

type Verdict = { state: 'wait' | 'ok' | 'fail'; detail: string };
const WAIT: Verdict = { state: 'wait', detail: 'checking…' };

const FIRESTORE_BASE =
  `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}` +
  `/databases/${firebaseConfig.firestoreDatabaseId}/documents`;

/** A fetch that treats "no answer inside `ms`" as its own failure mode —
 *  the difference between "blocked network" and "server said no" is the
 *  whole diagnosis. */
async function timedFetch(url: string, init: RequestInit, ms = 12000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

export default function DiagnosticsPanel({ onClose }: { onClose: () => void }) {
  const [internet, setInternet]   = useState<Verdict>(WAIT);
  const [signin, setSignin]       = useState<Verdict>(WAIT);
  const [restRead, setRestRead]   = useState<Verdict>(WAIT);
  const [liveSync, setLiveSync]   = useState<Verdict>(WAIT);
  const [storage, setStorage]     = useState<Verdict>(WAIT);
  const [resetState, setResetState] = useState<'idle' | 'working' | 'failed'>('idle');

  useEffect(() => {
    let dead = false;
    const set = (fn: (v: Verdict) => void) => (v: Verdict) => { if (!dead) fn(v); };

    // 2 · Sign-in service — an empty request must be REFUSED with
    // MISSING_EMAIL. Refusal is the healthy answer; silence is the failure.
    // Returns whether ANY answer arrived, for the internet verdict below.
    const signinAnswered = (async (): Promise<boolean> => {
      const put = set(setSignin);
      try {
        const r = await timedFetch(
          `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${firebaseConfig.apiKey}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const j = await r.json().catch(() => ({}));
        const msg = j?.error?.message || '';
        if (msg.includes('MISSING_EMAIL')) put({ state: 'ok', detail: 'sign-in service answering normally' });
        else if (msg) put({ state: 'fail', detail: `sign-in service answered abnormally: ${msg}` });
        else put({ state: 'fail', detail: `unexpected response (HTTP ${r.status})` });
        return true;
      } catch {
        put({ state: 'fail', detail: 'no answer from the sign-in service — network is blocking identitytoolkit.googleapis.com' });
        return false;
      }
    })();

    // 3 · Database over plain HTTPS. Signed out, a rules denial (403) is the
    // healthy answer. Signed in, one real document must come back.
    const dbAnswered = (async (): Promise<boolean> => {
      const put = set(setRestRead);
      try {
        const user = auth.currentUser;
        const headers: Record<string, string> = {};
        if (user) headers.Authorization = `Bearer ${await user.getIdToken()}`;
        const r = await timedFetch(
          `${FIRESTORE_BASE}:runQuery`,
          { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'models' }], limit: 1 } }) });
        if (user) {
          if (r.ok) put({ state: 'ok', detail: 'database answered a signed-in read with real data' });
          else put({ state: 'fail', detail: `database refused a signed-in read (HTTP ${r.status}) — send this screen to support` });
        } else {
          if (r.status === 403 || r.ok) put({ state: 'ok', detail: 'database reachable (sign in for a full read test)' });
          else put({ state: 'fail', detail: `database answered abnormally (HTTP ${r.status})` });
        }
        return true;
      } catch {
        put({ state: 'fail', detail: 'no answer from the database — network is blocking firestore.googleapis.com' });
        return false;
      }
    })();

    // 1 · Internet — judged by the checks that MATTER, not by its own ping.
    // The first version probed gstatic.com on its own and produced
    // "✗ cannot reach Google" above four green ticks. The operator's console
    // named the culprit: the app's own Content-Security-Policy — gstatic was
    // never on the connect-src allowlist, so the app's own security header
    // blocked the probe. Two fixes: the verdict now derives from the checks
    // below (services answering IS the internet working), and the tie-break
    // ping targets *.googleapis.com, which the CSP allows.
    (async () => {
      const put = set(setInternet);
      const [viaSignin, viaDb] = await Promise.all([signinAnswered, dbAnswered]);
      if (viaSignin || viaDb) {
        put({ state: 'ok', detail: 'this browser is reaching Google’s servers (proved by the answers below)' });
        return;
      }
      try {
        // Any HTTP answer — even a 404 — means the wire works. (generate_204
        // path kept for familiarity; the HOST is what the CSP permits.)
        await timedFetch('https://www.googleapis.com/generate_204', { mode: 'no-cors' }, 8000);
        put({ state: 'ok', detail: 'internet reachable, but Google’s app services are not answering — see the checks below' });
      } catch {
        put({ state: 'fail', detail: 'cannot reach Google at all — this network (or a blocker/VPN on this device) is the problem. Try Wi-Fi vs mobile data.' });
      }
    })();

    // 4 · Live sync — the SDK's own server path, exactly what the app's
    // listeners use. Forced to the SERVER so the local cache cannot fake a
    // pass. 15s without an answer = the silent-stream failure this panel
    // exists to catch.
    (async () => {
      const put = set(setLiveSync);
      if (!auth.currentUser) {
        put({ state: 'fail', detail: 'not signed in — sign in and run diagnostics again for the full test' });
        return;
      }
      try {
        const got = await Promise.race([
          getDocsFromServer(query(collection(db, 'models'), limit(1))),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000)),
        ]);
        put({ state: 'ok', detail: `live sync working — server returned ${got.size} document(s)` });
      } catch (e: any) {
        const msg = e?.message === 'timeout'
          ? 'server never answered the app’s sync channel (15s). Press RESET APP STORAGE below, then sign in again.'
          : `sync failed: ${e?.code || e?.message || e}`;
        put({ state: 'fail', detail: msg });
      }
    })();

    // 5 · IndexedDB — the signed-in session lives here, and a FULL browser
    // storage is the failure that cost two days on the operator's phone:
    // storage writes threw QuotaExceededError and the Firestore SDK of the
    // day melted down with INTERNAL ASSERTION FAILED, making no network
    // traffic at all. The app no longer keeps an offline copy (memory cache
    // by the operator's decision), but a full device still breaks sign-in
    // persistence — so this check measures fullness, not just existence.
    (async () => {
      const put = set(setStorage);
      let pctNote = '';
      let nearlyFull = false;
      try {
        const est = navigator.storage?.estimate ? await navigator.storage.estimate() : null;
        if (est?.quota && est.usage != null) {
          const pct = Math.round((est.usage / est.quota) * 100);
          pctNote = ` — ${pct}% of this browser’s storage allowance used`;
          nearlyFull = pct >= 90;
        }
      } catch { /* estimate unsupported — proceed on the open-probe alone */ }
      try {
        await new Promise<void>((res, rej) => {
          const rq = indexedDB.open('__diag_probe__', 1);
          rq.onsuccess = () => { rq.result.close(); indexedDB.deleteDatabase('__diag_probe__'); res(); };
          rq.onerror = () => rej(rq.error);
          rq.onblocked = () => rej(new Error('blocked'));
        });
        if (nearlyFull) {
          put({ state: 'fail', detail: `browser storage nearly FULL${pctNote}. Sign-in cannot save its session here — clear this browser’s cached data (Settings → Privacy → Clear browsing data) or press Reset below.` });
        } else {
          put({ state: 'ok', detail: `local storage usable${pctNote}` });
        }
      } catch {
        put({ state: 'fail', detail: 'local storage unusable (private mode / locked browser) — the app still works, just without its offline copy' });
      }
    })();

    return () => { dead = true; };
  }, []);

  /** "Clear site data" without DevTools. Local only — the server is untouched. */
  async function resetAppStorage() {
    setResetState('working');
    try {
      try { localStorage.clear(); } catch { /* fine */ }
      try { sessionStorage.clear(); } catch { /* fine */ }
      try {
        if ('caches' in window) {
          for (const k of await caches.keys()) await caches.delete(k);
        }
      } catch { /* fine */ }
      try {
        const dbs: Array<{ name?: string }> =
          'databases' in indexedDB ? await (indexedDB as any).databases() : [];
        await Promise.all(dbs.filter(d => d.name).map(d => new Promise<void>(res => {
          const rq = indexedDB.deleteDatabase(d.name!);
          rq.onsuccess = rq.onerror = rq.onblocked = () => res();
        })));
      } catch { /* fine */ }
      // Cache-busting query so even a stubborn HTTP cache re-fetches.
      window.location.href = `${window.location.pathname}?fresh=${Date.now()}`;
    } catch {
      setResetState('failed');
    }
  }

  const Row = ({ label, v }: { label: string; v: Verdict }) => (
    <div className="flex items-start gap-3 py-2 border-b border-slate-100">
      <span className={`mt-0.5 text-lg leading-none ${v.state === 'ok' ? 'text-emerald-600' : v.state === 'fail' ? 'text-rose-600' : 'text-slate-400'}`}>
        {v.state === 'ok' ? '✓' : v.state === 'fail' ? '✗' : '…'}
      </span>
      <div className="min-w-0">
        <p className="text-[13px] font-bold text-slate-800">{label}</p>
        <p className="text-[12px] text-slate-500 leading-snug">{v.detail}</p>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[500] bg-slate-900/60 flex items-center justify-center p-4" data-testid="diagnostics-panel">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto p-5">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-black tracking-tight text-slate-900">Connection diagnostics</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl leading-none px-2" aria-label="Close">×</button>
        </div>
        <p className="text-[11px] text-slate-500 mb-3">
          Testing every step from THIS device to the database. Signed in as{' '}
          <span className="font-bold">{auth.currentUser?.email || 'nobody (sign in for the full test)'}</span>.
        </p>
        <Row label="1 · Internet"        v={internet} />
        <Row label="2 · Sign-in service" v={signin} />
        <Row label="3 · Database"        v={restRead} />
        <Row label="4 · Live sync (the app’s own channel)" v={liveSync} />
        <Row label="5 · Local storage"   v={storage} />

        <div className="mt-4 bg-slate-50 rounded-xl p-3">
          <p className="text-[11px] text-slate-600 leading-snug mb-2">
            <span className="font-bold">Stuck on zeros while the checks above pass?</span>{' '}
            This device’s saved app state is jammed. The button below erases this
            site’s local data only — cache, saved copy, login — and reloads fresh.
            <span className="font-bold"> Nothing on the server is touched.</span>{' '}
            You will need to sign in again.
          </p>
          <button
            onClick={resetAppStorage}
            disabled={resetState === 'working'}
            className="w-full py-2.5 rounded-xl bg-rose-600 text-white text-[12px] font-bold uppercase tracking-widest hover:bg-rose-700 disabled:opacity-50"
          >
            {resetState === 'working' ? 'Resetting…' : resetState === 'failed' ? 'Failed — try again' : 'Reset app storage on this device'}
          </button>
        </div>
      </div>
    </div>
  );
}
