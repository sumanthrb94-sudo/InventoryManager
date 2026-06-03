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
export const db      = getFirestore(app, firebaseConfig.firestoreDatabaseId);
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
// Admin allowlist (single account today). UX gate only — this is NOT a
// server-side rule. Firestore Security Rules are the actual security
// boundary; this gate hides write controls from non-admins in the UI.
const ADMIN_EMAILS = new Set<string>([
  'admin@inventorymanager.com',
]);

/** Returns true when the signed-in user is the inventory admin. */
export function isAdmin(user: User | null | undefined): boolean {
  const email = user?.email?.toLowerCase().trim();
  if (!email) return false;
  return ADMIN_EMAILS.has(email);
}

// ── Regional role gating (UX only) ───────────────────────────────────────────
//
// Splits the non-admin team into UK warehouse ops (buy / stock intake /
// returns) vs India sell-ops (sell / returns).
//
// Emails must be lowercase + trimmed. The 'admin' region is derived from
// `isAdmin()` — do NOT duplicate admin emails into these sets.

export type UserRegion = 'uk' | 'india' | 'both' | 'admin';

const UK_OPS_EMAILS: ReadonlySet<string> = new Set<string>([
  'sai@inventorymanager.com',
  'bunty@inventorymanager.com',
]);

const INDIA_OPS_EMAILS: ReadonlySet<string> = new Set<string>([
  'mithun@inventorymanager.com',
  'sujatha@inventorymanager.com',
  'aravind@inventorymanager.com',
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

/** Whether the user should see the Buy / Stock Intake tab.
 *  Every signed-in user can VIEW it regardless of region — the read views
 *  are open to the whole team. Edit controls inside the tab are still
 *  gated by `canEdit()`. */
export function canBuy(user: User | null | undefined): boolean {
  return !!user?.email;
}

/** Whether the user should see the Sell / Sales tab.
 *  Every signed-in user can VIEW it regardless of region — same rule as
 *  the Buy tab. Edit controls inside are gated by `canEdit()`. */
export function canSell(user: User | null | undefined): boolean {
  return !!user?.email;
}

/** Whether the user should see the Returns tab.
 *  Every signed-in user can VIEW it. Edit controls inside are gated by
 *  `canEdit()`. */
export function canSeeReturns(user: User | null | undefined): boolean {
  return !!user?.email;
}

// ── Edit-permission gate ─────────────────────────────────────────────────────
//
// Admin is the only role that can mutate state. Non-admins are strictly
// read-only across every surface — Stock Intake, Sales, Returns, Bulk
// Order, all of it. The UI surfaces below `canEdit(user)` should hide
// every edit / record / delete / restore control when this returns false.
//
// Server-side enforcement (Firestore Security Rules) is the actual
// boundary; this helper is a UX gate that keeps the read-only state
// visible and intentional.

/** True when this user is allowed to edit / mutate anything in the app.
 *  Today: admin-only. The entire team can READ everywhere; only admin
 *  can WRITE. */
export function canEdit(user: User | null | undefined): boolean {
  return isAdmin(user);
}

/** Bulk Order intake — admin-only now. Previously open to the whole team;
 *  collapsed back into the general read-only-except-admin rule. */
export function canBulkOrder(user: User | null | undefined): boolean {
  return isAdmin(user);
}
