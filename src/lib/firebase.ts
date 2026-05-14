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

/** Signs in with a team account provisioned in the Firebase console. */
export function signInWithEmail(email: string, password: string) {
  return signInWithEmailAndPassword(auth, email.trim(), password);
}

/** Signs the current user out. */
export function signOut() {
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
