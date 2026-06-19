/**
 * useIsAdmin — single source of truth for the UI-side admin-edit gate.
 *
 * Returns true when the signed-in user's email is on the ADMIN_EMAILS
 * allowlist in src/lib/firebase.ts. Subscribes to onAuthStateChanged so
 * components re-render the moment the auth status flips (e.g. an employee
 * logs out and the admin logs in on the same tab).
 *
 * This hook is the UI gate ONLY. Firestore rules remain as-is — the
 * server still trusts signed-in users for non-admin collections. Per the
 * spec: a determined employee with the URL could theoretically still
 * write; the gate's job is to make every WRITE BUTTON disappear so the
 * normal app surface is read-only for non-admins.
 *
 *   import { useIsAdmin, AdminOnly } from '../lib/useIsAdmin';
 *
 *   const isAdmin = useIsAdmin();
 *   ...
 *   {isAdmin && <button onClick={save}>Save</button>}
 *
 *   // OR using the wrapper:
 *   <AdminOnly><button onClick={save}>Save</button></AdminOnly>
 */
import { useEffect, useState, type ReactNode } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, isAdmin } from './firebase';

export function useIsAdmin(): boolean {
  const [admin, setAdmin] = useState<boolean>(() => isAdmin(auth.currentUser));
  useEffect(() => {
    return onAuthStateChanged(auth, u => setAdmin(isAdmin(u)));
  }, []);
  return admin;
}

/** Render `children` only when the current user is admin. Use to gate
 *  buttons, inline-edit handlers, modal openers, import controls — any
 *  write surface. Equivalent to `{useIsAdmin() && children}` but cleaner
 *  inside JSX. */
export function AdminOnly({ children }: { children: ReactNode }) {
  return useIsAdmin() ? <>{children}</> : null;
}
