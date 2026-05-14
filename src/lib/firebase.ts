import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut as fbSignOut,
  setPersistence,
  browserLocalPersistence,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db      = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const storage = getStorage(app, firebaseConfig.storageBucket);
export const auth    = getAuth(app);

// Keep the session across reloads / new tabs until the user explicitly
// signs out. Without this, refresh would bounce the operator back to
// the login screen.
setPersistence(auth, browserLocalPersistence).catch(() => {
  /* falls back to in-memory persistence; non-fatal */
});

// ── Session timeout policy ───────────────────────────────────────────────────
// Firebase auto-refreshes its ID token via the refresh token, so the user
// would otherwise stay signed in indefinitely. We track the sign-in time
// independently and force a sign-out once the configured age is exceeded.
export const SESSION_MAX_AGE_MS = 60 * 60 * 1000;           // 1 hour
const SESSION_STARTED_AT_KEY    = 'auth_session_started_at';
const SESSION_EXPIRED_FLAG_KEY  = 'auth_session_expired';

function safeGetLs(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSetLs(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* private mode */ }
}
function safeDelLs(key: string) {
  try { localStorage.removeItem(key); } catch { /* private mode */ }
}

function markSessionStart() {
  safeSetLs(SESSION_STARTED_AT_KEY, String(Date.now()));
  safeDelLs(SESSION_EXPIRED_FLAG_KEY);
}
function clearSessionTimestamp() {
  safeDelLs(SESSION_STARTED_AT_KEY);
}

/** ms elapsed since the current sign-in, or null if no timestamp is set. */
export function getSessionAgeMs(): number | null {
  const raw = safeGetLs(SESSION_STARTED_AT_KEY);
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? Date.now() - n : null;
}

/** True if the current sign-in is older than SESSION_MAX_AGE_MS. */
export function isSessionExpired(): boolean {
  const age = getSessionAgeMs();
  return age !== null && age > SESSION_MAX_AGE_MS;
}

/** True if the previous session ended because of the 1h timeout. */
export function consumeExpiredFlag(): boolean {
  const flag = safeGetLs(SESSION_EXPIRED_FLAG_KEY) === '1';
  if (flag) safeDelLs(SESSION_EXPIRED_FLAG_KEY);
  return flag;
}

/** Force sign-out due to the session-age policy. */
export async function expireSession(): Promise<void> {
  safeSetLs(SESSION_EXPIRED_FLAG_KEY, '1');
  clearSessionTimestamp();
  try { await fbSignOut(auth); } catch { /* ignore — UI will re-render anyway */ }
}

/** Signs in with a team account provisioned in the Firebase console. */
export async function signInWithEmail(email: string, password: string) {
  const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
  markSessionStart();
  return cred;
}

/** Signs the current user out (user-initiated). */
export async function signOut() {
  clearSessionTimestamp();
  return fbSignOut(auth);
}

/** Sends a Firebase password-reset email to the admin account. */
export function sendPasswordReset(email: string) {
  return sendPasswordResetEmail(auth, email.trim());
}

/** Waits for Firebase Auth to resolve its persisted session. */
export function ensureAuthReady(): Promise<void> {
  return auth.authStateReady();
}

// Backward-compat alias used by seedData.ts
export const ensureAnonymousAuth = ensureAuthReady;
