import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  type User,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

/**
 * MEMORY CACHE, ON PURPOSE — the operator's decision, 2026-08-29:
 * "I upgraded to Blaze plan so I don't need any local storage … if no
 * network, ask to refresh and connect."
 *
 * HISTORY, because this line has been changed twice and the next person
 * deserves the whole story. A persistent IndexedDB cache
 * (initializeFirestore + persistentLocalCache + multi-tab manager) was added
 * when the FREE tier's 50,000 reads/day kept running out — every page load
 * re-downloaded ~1,300 documents. It solved that, and then caused three
 * incidents of its own inside one week:
 *
 *   1. STUCK LEADER: with many tabs sharing the cache, one tab leads the
 *      network sync. A backgrounded leader stuck in retry backoff starved
 *      every other tab — including freshly reloaded ones — indefinitely.
 *   2. FULL-DEVICE MELTDOWN: on a phone whose browser storage was full,
 *      every cache write threw QuotaExceededError and the SDK died with
 *      INTERNAL ASSERTION FAILED (ID: b815) — no network traffic, no clean
 *      error, just silent zeros.
 *   3. SAVED-COPY CONFUSION: a device showing day-old cached figures looks
 *      identical to a healthy one, and the operator burned hours comparing
 *      devices that were both technically "working".
 *
 * On Blaze the reads the cache was saving cost pennies (~£1–3/month at
 *  current volume), so the operator chose simplicity: every load reads live
 * from the server; if the server is unreachable the rose banner says exactly
 * that and asks for a refresh. No stale copies, no leader elections, no
 * IndexedDB failure modes. If read costs ever matter again, this history is
 * the checklist of what re-enabling persistence must survive.
 */
function makeDb() {
  return getFirestore(app, firebaseConfig.firestoreDatabaseId);
}

export const db      = makeDb();
export const storage = getStorage(app, firebaseConfig.storageBucket);
export const auth    = getAuth(app);

// ── Sign-in ──────────────────────────────────────────────────────────────────
//
// Plain Firebase email/password — users sign in with their REAL email
// (e.g. `admin@inventorymanager.com`, or any teammate's `@gmail.com`).
// No allowlist, no username-to-synthetic-email mapping. The Firebase
// Console is the source of truth for who can sign in.

/**
 * Sign in with email + password.
 * Returns the Firebase user credential. Throws a friendly Error on failure.
 */
export async function signInWithEmail(email: string, password: string) {
  const trimmed = email.trim();
  if (!trimmed) {
    throw new Error('Email is required.');
  }
  if (!password) {
    throw new Error('Password is required.');
  }
  try {
    return await signInWithEmailAndPassword(auth, trimmed, password);
  } catch (err: any) {
    // Normalise Firebase's verbose error codes into something we can show.
    const code = err?.code || '';
    if (code === 'auth/wrong-password' || code === 'auth/invalid-credential' || code === 'auth/invalid-login-credentials') {
      throw new Error('Wrong email or password.');
    }
    if (code === 'auth/invalid-email') {
      throw new Error('That doesn’t look like a valid email.');
    }
    if (code === 'auth/user-not-found' || code === 'auth/user-disabled') {
      throw new Error('Account is not active. Ask an admin.');
    }
    if (code === 'auth/too-many-requests') {
      throw new Error('Too many attempts. Try again in a few minutes.');
    }
    if (code === 'auth/network-request-failed') {
      throw new Error('Network error. Check your connection.');
    }
    throw new Error(err?.message || 'Sign-in failed.');
  }
}

/** Signs the current user out. */
export function signOut() {
  return fbSignOut(auth);
}

/**
 * Waits for Firebase Auth to resolve its persisted session.
 */
export function ensureAuthReady(): Promise<void> {
  return auth.authStateReady();
}

// Backward-compat alias used by seedData.ts
export const ensureAnonymousAuth = ensureAuthReady;

// ── Role gating (UX only) ────────────────────────────────────────────────────
//
// Single-admin allowlist. UX gate only — this is NOT a server-side rule.
// Firestore rules are the actual security boundary. Expand the list if/when
// more admins are needed.
const ADMIN_EMAILS = new Set<string>([
  'admin@inventorymanager.com',
  'sumanthbolla97@gmail.com',
  'sai@inventorymanager.com',
]);

/** Returns true when the signed-in user is the inventory admin. */
export function isAdmin(user: User | null | undefined): boolean {
  const email = user?.email?.toLowerCase().trim();
  if (!email) return false;
  return ADMIN_EMAILS.has(email);
}

// Returns-manager allowlist. UX gate only — firestore.rules enforce the real
// boundary. Keep in sync with the isReturnsManager() helper in firestore.rules.
const RETURNS_MANAGER_EMAILS = new Set<string>([
  // TODO: populate returns-manager emails (admins already included via isAdmin)
]);

/** Returns true when the signed-in user may process returns. */
export function isReturnsManager(user: User | null | undefined): boolean {
  if (isAdmin(user)) return true;
  const email = user?.email?.toLowerCase().trim();
  if (!email) return false;
  return RETURNS_MANAGER_EMAILS.has(email);
}

// ── Regional role gating (UX only) ───────────────────────────────────────────
//
// Splits the (non-admin) team into UK warehouse ops (buy + returns) vs
// India sell-ops (sell + returns). Admin → Users sub-tab will manage these
// allowlists in a follow-up; for the MVP they are empty and every gmail user
// falls through to 'both' (current default — Buy + Sell + Returns).
//
// Emails must be lowercase + trimmed. The 'admin' region is derived from
// `isAdmin()` — do NOT duplicate admin emails into these sets.

export type UserRegion = 'uk' | 'india' | 'both' | 'admin';

// eslint-disable-next-line @typescript-eslint/no-inferrable-types
const UK_OPS_EMAILS: ReadonlySet<string> = new Set<string>([
  // TODO: admin to fill in UK warehouse ops gmail addresses
]);

const INDIA_OPS_EMAILS: ReadonlySet<string> = new Set<string>([
  // TODO: admin to fill in India sell-ops gmail addresses
]);

/**
 * Resolve a user's region for nav-gating purposes.
 * Admin wins over allowlists; unknown users default to 'both'.
 */
export function userRegion(user: User | null | undefined): UserRegion {
  if (!user) return 'both';
  if (isAdmin(user)) return 'admin';
  const email = user.email?.toLowerCase().trim() ?? '';
  if (UK_OPS_EMAILS.has(email))    return 'uk';
  if (INDIA_OPS_EMAILS.has(email)) return 'india';
  return 'both'; // default — non-allowlisted users see both Buy and Sell
}

/** Whether the user should see the Buy tab. */
export function canBuy(user: User | null | undefined): boolean {
  const r = userRegion(user);
  return r === 'uk' || r === 'both' || r === 'admin';
}

/** Whether the user should see the Sell tab. */
export function canSell(user: User | null | undefined): boolean {
  const r = userRegion(user);
  return r === 'india' || r === 'both' || r === 'admin';
}
