/**
 * Returns write surface — process, repair, and complete returns.
 *
 * Owns:
 *   - Two-step return lifecycle (Tech-QC intake → CRM finalise)
 *   - Voiding the linked Sale doc with the canonical voidOutcome
 *     (uses processReturnSalePatch so the mapping stays unit-testable)
 *   - Flipping inventoryUnit status + returnType fields
 *   - Snapshotting returnLegCost (postage + P.VAT) for the loss sheet
 *   - Replacement unit cross-linking (replacedByUnitId / replacementForUnitId)
 *   - Repair completion (Ready to Ship)
 *   - Atomic transaction wrapping so unit + replacement + sale updates are
 *     all-or-nothing
 *
 * IMPORTANT: UI components MUST NOT call dbService.update('inventoryUnits', ...)
 * or dbService.update('sales', ...) for return workflows directly — they must
 * route through here so the Sale voidOutcome contract and leg-cost snapshot
 * are applied consistently.
 */

import { doc, type Transaction } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { dbService } from '../lib/dbService';
import { processReturnSalePatch } from '../lib/processReturnSalePatch';
import { logInventoryEvent } from '../lib/inventoryEvents';
import type { InventoryUnit, ReturnCategory, Sale } from '../types';

// ── Input / Result types ─────────────────────────────────────────────────────

export interface RecordReturnQcInput {
  unit: InventoryUnit;
  returnDate: string;
  customerComments: string;
  technicianComments: string;
}

export interface ProcessReturnInput {
  unit: InventoryUnit;
  returnType: ReturnCategory;
  returnDate: string;
  reason: string;
  /** Customer outcome — required except when returnType === 'repair'. */
  outcome: 'refund' | 'replacement';
  customerComments?: string;
  technicianComments?: string;
  /** Required when outcome === 'replacement'. */
  replacementUnit?: InventoryUnit;
}

export interface QuickRepairInput {
  unit: InventoryUnit;
  returnDate?: string;
  reason?: string;
}

export interface CompleteRepairInput {
  unit: InventoryUnit;
  repairedAt?: string;
  /** Repair invoice for this cycle, £. Optional because the unit can come
   *  back on the shelf before the repairer has billed — an absent value is
   *  recorded as absent, NOT as £0, so the returns loss can report it as a
   *  cost still outstanding rather than a free repair. */
  repairCost?: number;
}

export interface RecordSupplierCreditInput {
  unit: InventoryUnit;
  /** £ recovered. For a like-for-like replacement handset, pass the unit's
   *  buyPrice — the value came back in kind. */
  amount: number;
  /** ISO date the credit landed. Defaults to today; the operator said
   *  credits arrive same-day. */
  creditDate?: string;
  type: 'credit' | 'replacement_unit';
}

export type ReturnsErrorCode =
  | 'missing_unit'
  | 'missing_return_type'
  | 'missing_date'
  | 'missing_reason'
  | 'missing_outcome'
  | 'missing_replacement'
  | 'unit_not_sold'
  | 'replacement_not_available'
  | 'not_returned_to_supplier'
  | 'invalid_amount'
  | 'write_failed';

export interface ReturnsResult {
  ok: boolean;
  error?: ReturnsErrorCode;
  message?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}

/** Find non-voided sales linked to a unit by unitId, falling back to IMEI. */
async function findLinkedSales(unit: InventoryUnit): Promise<Sale[]> {
  const [byUnitId, byImei] = await Promise.all([
    dbService.querySalesByUnitId(unit.id),
    unit.imei ? dbService.querySalesByImei(unit.imei) : Promise.resolve([]),
  ]);
  const seen = new Set<string>();
  const out: Sale[] = [];
  for (const s of [...byUnitId, ...byImei]) {
    if (seen.has(s.id)) continue;
    if (s.voidedAt) continue;
    seen.add(s.id);
    out.push(s as Sale);
  }
  return out.sort((a, b) => (b.saleDate || '').localeCompare(a.saleDate || ''));
}

/** Compute one shipping leg cost (postage + P.VAT) from the latest linked sale. */
function computeLegCost(linkedSales: Sale[], unit: InventoryUnit): number | null {
  const src = linkedSales[0];
  if (src) {
    const postage = Number(src.postage) || 0;
    const pVat = src.postageVatExempt ? 0 : (Number(src.postageVat) || postage * 0.2);
    return postage + pVat;
  }
  if (unit.postageCost) return unit.postageCost * 1.2;
  return null;
}

/** Build the patch for the returning unit based on return type and outcome.
 *  Exported so tests can assert against the REAL patch rather than a copy of
 *  it — a mirrored version passes whether or not the service is correct. */
export function buildReturningUnitPatch(
  unit: InventoryUnit,
  returnType: ReturnCategory,
  returnDate: string,
  reason: string,
  outcome: 'refund' | 'replacement' | null,
  legCost: number | null,
  customerComments?: string,
  technicianComments?: string,
  replacementUnit?: InventoryUnit,
): Record<string, any> {
  const newStatus = returnType === 'returned_to_inventory' ? 'available' : 'returned';
  const commentsParts: string[] = [];
  if (customerComments?.trim()) commentsParts.push(`Customer: ${customerComments.trim()}`);
  if (technicianComments?.trim()) commentsParts.push(`Tech QC: ${technicianComments.trim()}`);

  const patch: Record<string, any> = {
    status: newStatus,
    returnType,
    returnDate,
    returnReason: reason.trim(),
    // Clear the PREVIOUS cycle's completion marker. completeRepair stamps
    // repairedAt, and nothing used to clear it, so a unit sent for repair a
    // second time still carried the first cycle's stamp. The Returns page
    // reads that as "already repaired" — which hid the "Mark Repaired · Back
    // to Stock" button and left the unit stuck In Repair with no way back,
    // while the journey chips read Returned → Repaired on a unit that was
    // still at the repairer.
    //
    // Cleared on EVERY new return, not just repairs: the field describes the
    // cycle that finished, and a refund cycle should not inherit it either.
    // The permanent 'repaired_unit' flag is what preserves the historical
    // fact, and the loss accounting keys off that and off voidOutcome, so
    // nothing downstream loses a repair it already recorded.
    repairedAt: null,
    // Cleared for the same reason as repairedAt: the invoice describes the
    // cycle that finished. A unit sent for repair a second time must not
    // inherit the first repair's cost, or the second cycle reads as already
    // invoiced and its real bill never gets asked for.
    repairCost: null,
    returnOutcome: outcome,
    returnLegCost: legCost ?? null,
    pendingCrmReview: false,
    salePrice: null,
    saleDate: null,
    salePlatform: null,
    saleOrderId: null,
    postageCost: null,
    returnComments: commentsParts.join(' · ') || null,
    ...(customerComments?.trim() ? { customerComments: customerComments.trim() } : {}),
    ...(technicianComments?.trim() ? { technicianComments: technicianComments.trim() } : {}),
  };

  if (returnType === 'returned_to_inventory') {
    patch.platformListed = false;
    patch.listingSites = [];
  }
  if (replacementUnit) {
    patch.replacedByUnitId = replacementUnit.id;
    // Snapshot what the second handset cost us. The operator's ruling is that
    // a replacement costs a whole second handset, and until now that number
    // was nowhere in the app — a replacement recorded 3 carriage legs (~£24)
    // against a real cost in the hundreds.
    //
    // Snapshotted, not read live through replacedByUnitId, because the
    // replacement unit stays editable: correcting its buyPrice next month
    // must not silently restate a return that was closed last month.
    const cost = Number(replacementUnit.buyPrice);
    patch.replacementUnitCost = Number.isFinite(cost) ? cost : null;
  }
  return patch;
}

/** Build the patch for the replacement unit being flipped to sold. */
function buildReplacementUnitPatch(
  replacementUnit: InventoryUnit,
  returningUnit: InventoryUnit,
  linkedSales: Sale[],
  returnDate: string,
): Record<string, any> {
  const src = linkedSales[0];
  return {
    status: 'sold',
    salePrice: src?.salePrice ?? returningUnit.salePrice ?? null,
    saleDate: src?.saleDate ?? returningUnit.saleDate ?? returnDate,
    salePlatform: src?.marketplace ?? returningUnit.salePlatform ?? null,
    saleOrderId: src?.orderNumber ?? returningUnit.saleOrderId ?? null,
    postageCost: src?.postage ?? returningUnit.postageCost ?? null,
    platformListed: false,
    listingSites: [],
    replacementForUnitId: returningUnit.id,
  };
}

/** Build a ready-to-ship patch for a repaired unit. Exported for the same
 *  reason as buildReturningUnitPatch. */
export function buildCompleteRepairPatch(): Record<string, any> {
  return {
    status: 'available',
    returnType: 'returned_to_inventory',
    repairedAt: todayStr(),
    flags: [], // caller should merge existing flags
  };
}

// ── Public functions ─────────────────────────────────────────────────────────

/** Step 1: Tech/QC intake — log comments and send unit to CRM queue. */
export async function recordReturnQc(input: RecordReturnQcInput): Promise<ReturnsResult> {
  const { unit, returnDate, customerComments, technicianComments } = input;
  if (!unit?.id) return { ok: false, error: 'missing_unit', message: 'Unit is required.' };
  if (!returnDate) return { ok: false, error: 'missing_date', message: 'Return date is required.' };

  const patch: Record<string, any> = {
    returnDate,
    pendingCrmReview: true,
    returnQcAt: new Date().toISOString(),
  };
  if (customerComments?.trim()) patch.customerComments = customerComments.trim();
  if (technicianComments?.trim()) patch.technicianComments = technicianComments.trim();

  try {
    await dbService.update('inventoryUnits', unit.id, patch);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: 'write_failed', message: err?.message || 'Failed to save QC intake.' };
  }
}

/** Step 2: CRM finalise — refund, replacement, repair, or return-to-supplier. */
export async function processReturn(input: ProcessReturnInput): Promise<ReturnsResult> {
  const { unit, returnType, returnDate, reason, outcome, replacementUnit, customerComments, technicianComments } = input;

  // ── Validation ─────────────────────────────────────────────────────────────
  if (!unit?.id) return { ok: false, error: 'missing_unit', message: 'Unit is required.' };
  if (!returnType) return { ok: false, error: 'missing_return_type', message: 'Return type is required.' };
  if (!returnDate) return { ok: false, error: 'missing_date', message: 'Return date is required.' };
  if (!(reason || '').trim()) return { ok: false, error: 'missing_reason', message: 'Reason is required.' };

  const effectiveOutcome: 'refund' | 'replacement' | null = returnType === 'repair' ? null : outcome;
  if (returnType !== 'repair' && !outcome) {
    return { ok: false, error: 'missing_outcome', message: 'Outcome is required.' };
  }
  if (effectiveOutcome === 'replacement' && !replacementUnit?.id) {
    return { ok: false, error: 'missing_replacement', message: 'Replacement unit is required.' };
  }

  // ── Resolve linked sales (pre-read for leg cost, used inside transaction too) ─
  let linkedSales: Sale[] = [];
  try {
    linkedSales = await findLinkedSales(unit);
  } catch (err: any) {
    return { ok: false, error: 'write_failed', message: err?.message || 'Failed to load linked sales.' };
  }

  const legCost = computeLegCost(linkedSales, unit);
  const unitPatch = buildReturningUnitPatch(
    unit, returnType, returnDate, reason, effectiveOutcome, legCost,
    customerComments, technicianComments, replacementUnit,
  );
  const salePatch = processReturnSalePatch({
    returnType,
    outcome: outcome ?? 'refund',
    returnDate,
    reason: reason.trim(),
  });

  // ── Atomic transaction ─────────────────────────────────────────────────────
  try {
    await dbService.runTransaction(async (transaction: Transaction) => {
      // 1. Verify returning unit is still sold
      const unitRef = doc(db, 'inventoryUnits', unit.id);
      const unitSnap = await transaction.get(unitRef);
      if (!unitSnap.exists()) throw new Error('Unit not found');
      const currentUnit = unitSnap.data() as InventoryUnit;
      if (currentUnit.status !== 'sold') {
        throw new Error('Unit is no longer sold; it may have been returned or re-sold already.');
      }

      // 2. Verify replacement unit is still available
      let replacementRef;
      if (replacementUnit) {
        replacementRef = doc(db, 'inventoryUnits', replacementUnit.id);
        const replacementSnap = await transaction.get(replacementRef);
        if (!replacementSnap.exists()) throw new Error('Replacement unit not found');
        const r = replacementSnap.data() as InventoryUnit;
        if (r.status !== 'available') {
          throw new Error('Replacement unit is no longer available.');
        }
      }

      // 3. Write returning unit
      transaction.update(unitRef, unitPatch);

      // 4. Write replacement unit
      if (replacementUnit && replacementRef) {
        const replacementPatch = buildReplacementUnitPatch(replacementUnit, unit, linkedSales, returnDate);
        transaction.update(replacementRef, replacementPatch);
      }

      // 5. Void linked sales
      for (const s of linkedSales) {
        const saleRef = doc(db, 'sales', s.id);
        transaction.update(saleRef, salePatch as Record<string, any>);
      }
    });
  } catch (err: any) {
    const msg = err?.message || 'Failed to process return.';
    if (msg.includes('Replacement unit is no longer available')) {
      return { ok: false, error: 'replacement_not_available', message: msg };
    }
    if (msg.includes('no longer sold') || msg.includes('not found')) {
      return { ok: false, error: 'unit_not_sold', message: msg };
    }
    return { ok: false, error: 'write_failed', message: msg };
  }

  // ── Refresh in-memory cache after transaction commit ───────────────────────
  dbService.applyCacheItem('inventoryUnits', unit.id, unitPatch);
  if (replacementUnit) {
    dbService.applyCacheItem('inventoryUnits', replacementUnit.id, buildReplacementUnitPatch(replacementUnit, unit, linkedSales, returnDate));
  }
  for (const s of linkedSales) {
    dbService.applyCacheItem('sales', s.id, salePatch);
  }

  // ── Audit log ──────────────────────────────────────────────────────────────
  await logInventoryEvent({
    type: 'returned',
    message: `Return processed · ${unit.model}${unit.storage ? ' ' + unit.storage : ''} · ${returnType.replace(/_/g, ' ')}${effectiveOutcome ? ' · ' + effectiveOutcome : ''}`,
    unitId: unit.id,
    buyPrice: unit.buyPrice,
  });

  return { ok: true };
}

/** One-click repair shortcut — bypasses Tech-QC and sends unit straight to repair. */
export async function quickRepair(input: QuickRepairInput): Promise<ReturnsResult> {
  const { unit, returnDate = todayStr(), reason = 'Unit sent for repair' } = input;
  if (!unit?.id) return { ok: false, error: 'missing_unit', message: 'Unit is required.' };

  let linkedSales: Sale[] = [];
  try {
    linkedSales = await findLinkedSales(unit);
  } catch { /* best-effort */ }

  const legCost = computeLegCost(linkedSales, unit);
  const unitPatch = buildReturningUnitPatch(
    unit, 'repair', returnDate, reason, null, legCost,
    unit.customerComments, unit.technicianComments,
  );
  // repair route stamps voidOutcome='repair' regardless of outcome radio default
  const salePatch = processReturnSalePatch({
    returnType: 'repair',
    outcome: 'refund',
    returnDate,
    reason: reason.trim(),
  });

  try {
    await dbService.runTransaction(async (transaction: Transaction) => {
      const unitRef = doc(db, 'inventoryUnits', unit.id);
      const unitSnap = await transaction.get(unitRef);
      if (!unitSnap.exists()) throw new Error('Unit not found');
      const currentUnit = unitSnap.data() as InventoryUnit;
      if (currentUnit.status !== 'sold') throw new Error('Unit is no longer sold.');

      transaction.update(unitRef, unitPatch);

      for (const s of linkedSales) {
        const saleRef = doc(db, 'sales', s.id);
        transaction.update(saleRef, salePatch as Record<string, any>);
      }
    });
  } catch (err: any) {
    const msg = err?.message || 'Failed to send unit for repair.';
    if (msg.includes('no longer sold') || msg.includes('not found')) {
      return { ok: false, error: 'unit_not_sold', message: msg };
    }
    return { ok: false, error: 'write_failed', message: msg };
  }

  dbService.applyCacheItem('inventoryUnits', unit.id, unitPatch);
  for (const s of linkedSales) {
    dbService.applyCacheItem('sales', s.id, salePatch);
  }

  await logInventoryEvent({
    type: 'returned',
    message: `Quick repair · ${unit.model}${unit.storage ? ' ' + unit.storage : ''}`,
    unitId: unit.id,
    buyPrice: unit.buyPrice,
  });

  return { ok: true };
}

/** Repair completion — mark a repaired unit as back in stock, and record what
 *  the repair cost if the invoice is known. */
export async function completeRepair(input: CompleteRepairInput): Promise<ReturnsResult> {
  const { unit, repairedAt = todayStr(), repairCost } = input;
  if (!unit?.id) return { ok: false, error: 'missing_unit', message: 'Unit is required.' };

  const existingFlags = Array.isArray(unit.flags) ? unit.flags : [];
  const patch: Record<string, any> = {
    ...buildCompleteRepairPatch(),
    repairedAt,
    flags: existingFlags.includes('repaired_unit')
      ? existingFlags
      : [...existingFlags, 'repaired_unit'],
  };

  // Only written when a figure was actually supplied. Writing 0 for "the
  // operator left the box empty" would report an un-invoiced repair as a free
  // one, which is the error this whole change exists to remove.
  if (repairCost !== undefined && repairCost !== null && Number.isFinite(Number(repairCost))) {
    const n = Number(repairCost);
    if (n < 0) return { ok: false, error: 'invalid_amount', message: 'Repair cost cannot be negative.' };
    patch.repairCost = n;
  }

  try {
    await dbService.update('inventoryUnits', unit.id, patch);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: 'write_failed', message: err?.message || 'Failed to complete repair.' };
  }
}

/** Book the supplier's settlement against a unit that was sent back to them.
 *
 *  The operator gets full credit or a replacement handset, same day, and asked
 *  for it to be recorded against the unit when it lands. Without this the
 *  unit's purchase price stays sunk with nothing offsetting it, so a supplier
 *  return that actually cost nothing reads as a total write-off. */
export async function recordSupplierCredit(input: RecordSupplierCreditInput): Promise<ReturnsResult> {
  const { unit, amount, creditDate = todayStr(), type } = input;
  if (!unit?.id) return { ok: false, error: 'missing_unit', message: 'Unit is required.' };
  if (unit.returnType !== 'returned_to_supplier') {
    return {
      ok: false,
      error: 'not_returned_to_supplier',
      message: 'Only a unit returned to the supplier can carry a supplier credit.',
    };
  }
  const n = Number(amount);
  if (!Number.isFinite(n) || n < 0) {
    return { ok: false, error: 'invalid_amount', message: 'Credit amount must be a number of £0 or more.' };
  }

  const patch = {
    supplierCreditAmount: n,
    supplierCreditDate: creditDate,
    supplierCreditType: type,
  };

  try {
    await dbService.update('inventoryUnits', unit.id, patch);
  } catch (err: any) {
    return { ok: false, error: 'write_failed', message: err?.message || 'Failed to record supplier credit.' };
  }

  dbService.applyCacheItem('inventoryUnits', unit.id, patch);
  await logInventoryEvent({
    type: 'returned',
    message: `Supplier ${type === 'replacement_unit' ? 'replacement unit' : 'credit'} recorded · `
      + `${unit.model}${unit.storage ? ' ' + unit.storage : ''} · £${n.toFixed(2)}`,
    unitId: unit.id,
    buyPrice: unit.buyPrice,
  });

  return { ok: true };
}
