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
// Single-admin allowlist. UX gate only — this is NOT a server-side rule.
// Firestore rules are the actual security boundary. Expand the list if/when
// more admins are needed.
const ADMIN_EMAILS = new Set<string>([
  'admin@inventorymanager.com',
]);

/** Returns true when the signed-in user is the inventory admin. */
export function isAdmin(user: User | null | undefined): boolean {
  const email = user?.email?.toLowerCase().trim();
  if (!email) return false;
  return ADMIN_EMAILS.has(email);
}
