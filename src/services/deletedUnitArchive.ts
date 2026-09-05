/**
 * The tombstone written before a unit is destroyed.
 *
 * WHAT THIS REPLACES
 *
 * Deleting an office unit hard-deletes the Firestore document. Until now the
 * only trace was two free-text strings — an `inventoryEvents` row and a
 * `notices` post — carrying six of the unit's ~60 fields, and neither carried
 * the IMEI as a queryable field. So the one identifier an operator would
 * actually search by was unrecoverable, and "was this handset ever in stock?"
 * had no answer.
 *
 * Worse, the destructive act came FIRST: `deleteOfficeUnit` deleted the doc and
 * only then wrote the notice and the event. A crash, a dropped connection or a
 * closed tab in between lost the unit with no record at all.
 *
 * THIS MODULE DELIBERATELY BREAKS THE `logInventoryEvent` CONTRACT.
 *
 * `lib/inventoryEvents.ts` never throws — by design, because it describes an
 * act that already succeeded, and failing the caller over a lost audit line
 * would be worse than losing the line. This module is the inverse: it runs
 * BEFORE the act, and its failure must PREVENT the act. Fail closed. A delete
 * that cannot be recorded does not happen.
 *
 * APPEND-ONLY. firestore.rules denies delete on this collection outright and
 * permits an update only to `voided` / `voidedReason`. Nobody — admin included
 * — can erase who deleted what and when. It is also excluded from every wipe
 * path (ResetDataModal's PROTECTED_COLLECTIONS; wipeScopes never names it).
 */
import { dbService } from '../lib/dbService';
import { auth } from '../lib/firebase';
import { normaliseImeiKey } from '../lib/imeiValidation';
import type { DeletedUnitRecord, InventoryUnit } from '../types';

export interface ArchiveInput {
  unit: InventoryUnit;
  /** Exactly what the operator typed. Stored verbatim, junk included. */
  reason: string;
  source?: DeletedUnitRecord['source'];
}

export interface ArchiveResult {
  ok: boolean;
  id?: string;
  error?: 'archive_denied' | 'archive_failed';
  message?: string;
}

/**
 * Recursively strip values Firestore rejects.
 *
 * THE SILENT-FAILURE THIS EXISTS FOR. `cleanForFirestore` (lib/dbService.ts)
 * only drops TOP-LEVEL undefined. `InventoryUnit` is ~60 mostly-optional
 * fields and `snapshot` nests the whole object, so a nested `undefined` would
 * make Firestore reject the write with `invalid-argument` — and
 * `rethrowIfDenied` rethrows ONLY permission errors, so that rejection is
 * swallowed with a console warning. The archive would quietly never write
 * while the unit still got deleted: the exact data loss this module exists to
 * prevent, reintroduced by a field nobody set.
 *
 * Functions and symbols get the same treatment for the same reason.
 */
export function sanitizeSnapshot(value: unknown): unknown {
  if (value === null) return null;
  const t = typeof value;
  if (t === 'undefined' || t === 'function' || t === 'symbol') return undefined;
  if (Array.isArray(value)) {
    // Firestore stores arrays but not `undefined` inside them — drop holes
    // rather than letting one poison the whole document.
    return value.map(sanitizeSnapshot).filter(v => v !== undefined);
  }
  if (t === 'object') {
    // Leave Firestore's own types (Timestamp, GeoPoint, DocumentReference)
    // intact — `importedAt` arrives as a Timestamp from the snapshot listener
    // and rebuilding it as a plain object would corrupt it.
    const ctor = (value as object).constructor;
    if (ctor && ctor !== Object) return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const clean = sanitizeSnapshot(v);
      if (clean !== undefined) out[k] = clean;
    }
    return out;
  }
  return value;
}

/** 6 chars of base-36 randomness — see the id note below. */
const rand6 = () => Math.random().toString(36).slice(2, 8);

/**
 * Build the record. Pure and exported so the shape can be tested without
 * touching Firestore.
 *
 * The id is `del_{key}_{ms}_{rand6}` and every part earns its place: the key
 * makes a record greppable by IMEI in the console, the timestamp orders them,
 * and the random suffix stops two deletions colliding. That last one is not
 * theoretical — `dbService.create` writes with `setDoc(..., { merge: true })`,
 * so a colliding id would silently MERGE one deletion over another instead of
 * erroring, and a double-clicked delete button lands well inside the same
 * millisecond.
 */
export function buildDeletedUnitRecord(input: ArchiveInput): DeletedUnitRecord {
  const { unit, reason, source = 'office' } = input;
  const imei = normaliseImeiKey(unit.imei || unit.id);
  const key = (imei || 'NOIMEI').replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 40) || 'NOIMEI';
  const deletedAt = new Date().toISOString();
  const record: DeletedUnitRecord = {
    id: `del_${key}_${Date.now()}_${rand6()}`,
    imei,
    unitId: unit.id ?? '',
    source,
    // Verbatim. The archive records what happened; it does not improve it.
    // Renderers decide how to present a blank or meaningless reason.
    reason: (reason ?? '').trim(),
    deletedAt,
    deletedBy: auth.currentUser?.email || 'unknown',
    model: unit.model ?? '',
    storage: unit.storage,
    colour: unit.colour,
    grade: unit.grade,
    supplierName: unit.supplierName,
    supplierId: unit.supplierId,
    buyPrice: unit.buyPrice,
    status: unit.status,
    dateIn: unit.dateIn,
    snapshot: sanitizeSnapshot({ ...unit }) as Record<string, unknown>,
    ownerId: 'shared',
  };
  return record;
}

/**
 * Write the tombstone. Resolves `{ ok: false }` rather than throwing so the
 * caller's own error path runs — but it NEVER resolves ok on a failed write.
 *
 * `dbService.create` rethrows permission-denied (see rethrowIfDenied), which
 * is the failure that matters most here: it is what a not-yet-deployed
 * firestore.rules looks like, and the message says so, because the operator
 * seeing it needs the fix and not the stack trace.
 */
export async function archiveDeletedUnit(input: ArchiveInput): Promise<ArchiveResult> {
  let record: DeletedUnitRecord;
  try {
    record = buildDeletedUnitRecord(input);
  } catch (err: any) {
    return { ok: false, error: 'archive_failed', message: err?.message || 'Could not build the deletion record.' };
  }
  try {
    await dbService.create('deletedUnits', record.id, record);
    return { ok: true, id: record.id };
  } catch (err: any) {
    const code = String(err?.code || '');
    if (code === 'permission-denied' || code === 'unauthenticated') {
      return {
        ok: false,
        error: 'archive_denied',
        message:
          'Could not record this deletion (archive write denied — firestore.rules '
          + 'may not be deployed yet). The unit was NOT deleted.',
      };
    }
    return {
      ok: false,
      error: 'archive_failed',
      message: err?.message || 'Could not record this deletion. The unit was NOT deleted.',
    };
  }
}

/**
 * Mark a record as void when the archive landed but the delete that followed
 * did not.
 *
 * The record is never removed — the collection is append-only — but it must
 * not be read as a deletion, or the intake screens would warn forever about a
 * handset still sitting in inventory. Best-effort by design: this runs on a
 * path that has already failed, and throwing here would replace the caller's
 * real error with a less useful one.
 */
export async function voidArchiveRecord(id: string, reason: string): Promise<void> {
  try {
    await dbService.update('deletedUnits', id, { voided: true, voidedReason: reason });
  } catch (err: any) {
    console.warn('[deletedUnitArchive] could not void record', id, err?.message);
  }
}
