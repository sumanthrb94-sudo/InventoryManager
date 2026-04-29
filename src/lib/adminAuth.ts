/**
 * Admin Auth Config
 * ─────────────────────────────────────────────────────────────────────────────
 * Simple credential-based auth for the Nexus Inventory admin.
 * Change these to your preferred email/password before deploying.
 *
 * For production: move these to Vercel Environment Variables as
 * VITE_ADMIN_EMAIL and VITE_ADMIN_PASSWORD, then reference them via
 * import.meta.env.VITE_ADMIN_EMAIL etc.
 */

export const ADMIN_EMAIL    = import.meta.env.VITE_ADMIN_EMAIL    ?? 'admin@nexusinventory.com';
export const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD ?? 'Nexus@2026';

const SESSION_KEY = 'nexus_admin_session';

export const adminAuth = {
  /** Returns true if the provided credentials match admin config */
  check(email: string, password: string): boolean {
    return (
      email.trim().toLowerCase() === ADMIN_EMAIL.trim().toLowerCase() &&
      password.trim() === ADMIN_PASSWORD.trim()
    );
  },

  /** Persist session so page refresh keeps user logged in */
  saveSession() {
    localStorage.setItem(SESSION_KEY, 'true');
  },

  /** Clear session on sign-out */
  clearSession() {
    localStorage.removeItem(SESSION_KEY);
  },

  /** Returns true if a valid session exists */
  hasSession(): boolean {
    return localStorage.getItem(SESSION_KEY) === 'true';
  },
};
