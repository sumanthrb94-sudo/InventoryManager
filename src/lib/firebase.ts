import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db      = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const storage = getStorage(app, firebaseConfig.storageBucket);
export const auth    = getAuth(app);

// ── Team login ────────────────────────────────────────────────────────────────
//
// Internal tool used by a fixed 4-5 person team. We use Firebase Auth with
// email/password so password hashing, brute-force protection, and session
// persistence are handled by Firebase rather than rolled by hand — but the
// UI only asks for a username because no one in the team thinks of
// themselves as an email address.
//
// Each entry below maps a short username to the synthetic email Firebase
// expects. To add a teammate:
//   1. Add `{ username: 'frank', email: 'frank@mpm.local' }` to ALLOWED_USERS
//   2. Create the auth record in Firebase Console
//      (Authentication → Add user → email = frank@mpm.local, set password)
// To remove a teammate: drop from the list AND disable in Firebase Console.
//
// Passwords are NOT stored here — Firebase handles them.
export interface TeamUser {
  username: string;
  email: string;
  displayName?: string;
}

export const ALLOWED_USERS: TeamUser[] = [
  { username: 'admin',   email: 'admin@mpm.local',   displayName: 'Admin' },
  { username: 'sumanth', email: 'sumanth@mpm.local', displayName: 'Sumanth' },
  { username: 'ram',     email: 'ram@mpm.local',     displayName: 'Ram' },
  { username: 'ops1',    email: 'ops1@mpm.local',    displayName: 'Ops 1' },
  { username: 'ops2',    email: 'ops2@mpm.local',    displayName: 'Ops 2' },
];

function findTeamUser(usernameOrEmail: string): TeamUser | undefined {
  const key = usernameOrEmail.trim().toLowerCase();
  return ALLOWED_USERS.find(
    u => u.username.toLowerCase() === key || u.email.toLowerCase() === key,
  );
}

/**
 * Sign in with a team username (or email) + password.
 * Returns the Firebase user credential. Throws a friendly Error on failure.
 */
export async function signInWithUsername(usernameOrEmail: string, password: string) {
  const teamUser = findTeamUser(usernameOrEmail);
  if (!teamUser) {
    throw new Error('Unknown username. Ask an admin to add you.');
  }
  if (!password) {
    throw new Error('Password is required.');
  }
  try {
    return await signInWithEmailAndPassword(auth, teamUser.email, password);
  } catch (err: any) {
    // Normalise Firebase's verbose error codes into something we can show.
    const code = err?.code || '';
    if (code === 'auth/wrong-password' || code === 'auth/invalid-credential' || code === 'auth/invalid-login-credentials') {
      throw new Error('Wrong password.');
    }
    if (code === 'auth/user-not-found' || code === 'auth/user-disabled') {
      throw new Error('Account is not active. Ask an admin to provision your login.');
    }
    if (code === 'auth/too-many-requests') {
      throw new Error('Too many attempts. Try again in a few minutes.');
    }
    if (code === 'auth/network-request-failed') {
      throw new Error('Network error. Check your connection.');
    }
    if (code === 'auth/operation-not-allowed') {
      // The Email/Password provider isn't enabled on the Firebase project.
      // This is a one-time admin action, not something the user can fix —
      // surface it clearly so the right person sees the right next step.
      throw new Error(
        'Sign-in is disabled at the project level. An admin needs to ' +
        'enable Email/Password in Firebase Console → Authentication → ' +
        'Sign-in method.',
      );
    }
    if (code === 'auth/configuration-not-found') {
      throw new Error(
        'Firebase Auth is not configured for this project. An admin needs ' +
        'to enable Email/Password sign-in in Firebase Console.',
      );
    }
    throw new Error(err?.message || 'Sign-in failed.');
  }
}

/** Signs the current user out. */
export function signOut() {
  return fbSignOut(auth);
}

/**
 * Resolve the synthetic email back to a display name / username for UI.
 */
export function teamUserForEmail(email: string | null | undefined): TeamUser | undefined {
  if (!email) return undefined;
  return ALLOWED_USERS.find(u => u.email.toLowerCase() === email.toLowerCase());
}

/**
 * Waits for Firebase Auth to resolve its persisted session.
 */
export function ensureAuthReady(): Promise<void> {
  return auth.authStateReady();
}

/**
 * Temporary bypass for the login screen — auto sign-in anonymously so the
 * app loads without anyone typing credentials. We still need a real Firebase
 * auth.uid because Firestore security rules require `request.auth != null`,
 * so a client-side stub user would just trigger PERMISSION_DENIED on every
 * read/write. signInAnonymously gives every browser its own ephemeral uid
 * with no UI.
 *
 * To re-enable the username/password login, just stop calling this from
 * App.tsx — the LoginPage / signInWithUsername code is intact below.
 *
 * Requires "Anonymous" sign-in provider to be enabled in Firebase Console
 * (Authentication → Sign-in method → Anonymous → Enable).
 */
export async function ensureAnonymousSignIn(): Promise<void> {
  await auth.authStateReady();
  if (auth.currentUser) return; // already signed in (anon or otherwise)
  try {
    await signInAnonymously(auth);
  } catch (err: any) {
    const code = err?.code || '';
    if (code === 'auth/admin-restricted-operation' || code === 'auth/operation-not-allowed') {
      console.error(
        '[auth] Anonymous sign-in is disabled. Enable it in Firebase Console → ' +
        'Authentication → Sign-in method → Anonymous.',
      );
    } else {
      console.error('[auth] Anonymous sign-in failed:', err);
    }
    throw err;
  }
}

// Backward-compat alias used by seedData.ts
export const ensureAnonymousAuth = ensureAnonymousSignIn;
