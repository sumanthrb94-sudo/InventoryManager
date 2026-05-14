import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { auth, db } from './firebase';

/**
 * Append a row to the /commandLog Firestore collection. Fire-and-forget:
 * the dispatch caller never waits for the audit write to land, and a
 * failed write only logs a warning so the user-facing flow is unaffected
 * even if rules deny the audit (e.g. the user lost permissions mid-
 * session). Schema is read by the future Admin > Audit Log screen.
 */
export interface AuditEntry {
  type:        string;                       // Command.type
  payload:     Record<string, unknown>;      // serialised command args
  actorEmail:  string;                       // request.auth.token.email at dispatch time
  at:          number;                       // client ms (server timestamp also written)
  success:     boolean;
  error?:      string;
  durationMs?: number;
}

export function writeAuditLog(entry: AuditEntry): void {
  // Fire-and-forget. addDoc returns a Promise; we deliberately don't
  // await it from the dispatcher — failed audit writes must not block
  // or fail the underlying command.
  void addDoc(collection(db, 'commandLog'), {
    ...entry,
    actorEmail: entry.actorEmail || auth.currentUser?.email || 'unknown',
    serverAt:   serverTimestamp(),
  }).catch(err => {
    console.warn(`[auditLog] failed to write ${entry.type}:`, err?.message || err);
  });
}
