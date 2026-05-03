import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as fbSignOut,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db      = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const storage = getStorage(app, firebaseConfig.storageBucket);
export const auth    = getAuth(app);

export const googleProvider = new GoogleAuthProvider();

/** Opens the Google Sign-In popup. */
export function signInWithGoogle() {
  return signInWithPopup(auth, googleProvider);
}

/** Signs the current user out. */
export function signOut() {
  return fbSignOut(auth);
}

/**
 * Waits for Firebase Auth to resolve its persisted session.
 * Replaces ensureAnonymousAuth — no anonymous fallback needed now
 * that all users sign in with Google.
 */
export function ensureAuthReady(): Promise<void> {
  return auth.authStateReady();
}

// Backward-compat alias used by seedData.ts
export const ensureAnonymousAuth = ensureAuthReady;
