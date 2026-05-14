import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { err } from './cors';

// Lazy-initialise firebase-admin from a single FIREBASE_SERVICE_ACCOUNT_JSON
// env var (recommended) or the standard GOOGLE_APPLICATION_CREDENTIALS.
function ensureAdminApp() {
  if (getApps().length > 0) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (raw) {
    initializeApp({ credential: cert(JSON.parse(raw)) });
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    initializeApp();
  } else {
    throw new Error(
      'Firebase admin not configured: set FIREBASE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS.',
    );
  }
}

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);

export interface AuthedUser {
  uid: string;
  email: string;
}

/**
 * Verifies the Bearer ID token and that the caller is on the admin allow-list.
 * On failure, writes an error response and returns null — handlers should
 * `return` immediately when this returns null.
 */
export async function requireAdmin(
  req: VercelRequest,
  res: VercelResponse,
): Promise<AuthedUser | null> {
  const header = (req.headers.authorization as string | undefined) || '';
  const match = /^Bearer\s+(.+)$/.exec(header);
  if (!match) {
    err(res, 'Missing or malformed Authorization header', 401);
    return null;
  }
  try {
    ensureAdminApp();
    const decoded = await getAuth().verifyIdToken(match[1], true);
    const email = (decoded.email || '').toLowerCase();
    if (!decoded.email_verified || !email) {
      err(res, 'Email not verified', 403);
      return null;
    }
    if (ADMIN_EMAILS.length === 0 || !ADMIN_EMAILS.includes(email)) {
      err(res, 'Not authorised', 403);
      return null;
    }
    return { uid: decoded.uid, email };
  } catch {
    err(res, 'Invalid or expired token', 401);
    return null;
  }
}
