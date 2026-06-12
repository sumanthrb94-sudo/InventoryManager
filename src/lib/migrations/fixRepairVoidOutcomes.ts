/**
 * One-shot data fix for Sale docs whose `voidOutcome` was wrongly stamped
 * as 'refund' under the pre-`f0f8e1e` deploy (round 3/4 BUG-RP-003).
 *
 * Symptom in the field: a unit was sent for repair, the linked Sale got
 * voided with voidOutcome:'refund' (because the old ProcessReturnModal
 * trusted the modal's radio default instead of gating on returnType).
 * Every report then either inflated postage loss by £15.12 (on platforms
 * with a non-zero shipping leg) or, on eBay's £0 leg, drifted the
 * refund/total counters silently. The new code at read time can only
 * trust an explicit stored value, so the corruption persists in Firestore
 * until rewritten.
 *
 * Detection heuristic — safe by construction:
 *   - Sale has voidedAt set AND voidOutcome === 'refund'.
 *   - Linked unit shows repair markers:
 *       returnType === 'repair'        (mid-cycle, pre-completion), OR
 *       repairedAt set / 'repaired_unit' flag  (post-completion).
 *   - The unit has EXACTLY ONE voided Sale linked to it.
 *
 * The single-cycle gate is the safety property: a unit with a repair on
 * its history AND multiple voided Sales might have been legitimately
 * refunded after the repair cycle, and we can't tell which cycle was the
 * repair from the unit doc alone. Multi-cycle units are returned in the
 * `manualReview` bucket for a human to look at; nothing is auto-patched.
 *
 * Usage:
 *   import { findCorruptedRepairVoids, fixCorruptedRepairVoids } from
 *     './lib/migrations/fixRepairVoidOutcomes';
 *   const corrupted = findCorruptedRepairVoids(allSales, allUnits);
 *   // Review `corrupted` first — the function returns the proposed
 *   // patches without writing. Then:
 *   await fixCorruptedRepairVoids(corrupted, dbService);
 *
 * Or run from a tiny admin script that imports the helpers. We don't ship
 * a CLI wrapper because the dbService is browser-shaped (uses Firebase
 * Web SDK with auth-context-resolved rules); the admin runs it from
 * inside the app via a dev-only button or the browser console.
 */
import type { InventoryUnit, Sale } from '../../types';

export interface CorruptedRepairVoid {
  saleId: string;
  unitId: string;
  imei: string;
  /** What the Sale doc currently holds. */
  current: { voidOutcome?: string; voidReason?: string };
  /** What we'll write. */
  patch: { voidOutcome: 'repair'; voidReason: string };
}

export interface FindCorruptedRepairVoidsResult {
  /** Safe, single-cycle units — auto-patchable. */
  autoFixable: CorruptedRepairVoid[];
  /** Multi-cycle units with repair markers — a human must pick which
   *  void was the repair. */
  manualReview: Array<{ unitId: string; imei: string; voidedSaleIds: string[] }>;
}

/** Returns proposed patches without writing. Use to review before
 *  applying. Pure — safe to call from anywhere. */
export function findCorruptedRepairVoids(
  sales: Sale[],
  units: InventoryUnit[],
): FindCorruptedRepairVoidsResult {
  // Index units for the join.
  const unitsById = new Map<string, InventoryUnit>();
  const unitsByImei = new Map<string, InventoryUnit>();
  for (const u of units) {
    if (u.id) unitsById.set(u.id, u);
    const k = (u.imei || '').trim().toUpperCase();
    if (k && !unitsByImei.has(k)) unitsByImei.set(k, u);
  }

  // Group voided sales per unit so we can pick "the void that triggered
  // the latest repair" with confidence — not a legitimate refund of a
  // previously-repaired unit.
  const voidedByUnit = new Map<string, Sale[]>();
  for (const s of sales) {
    if (!s.voidedAt) continue;
    const key = s.unitId || (s.imei || '').trim().toUpperCase();
    if (!key) continue;
    const arr = voidedByUnit.get(key) ?? [];
    arr.push(s);
    voidedByUnit.set(key, arr);
  }

  const autoFixable: CorruptedRepairVoid[] = [];
  const manualReview: FindCorruptedRepairVoidsResult['manualReview'] = [];
  const reportedUnits = new Set<string>();

  for (const s of sales) {
    if (!s.voidedAt) continue;
    if (s.voidOutcome !== 'refund') continue;
    const k = (s.imei || '').trim().toUpperCase();
    const u = (s.unitId && unitsById.get(s.unitId)) || (k && unitsByImei.get(k)) || undefined;
    if (!u) continue;

    const hasRepairMarker =
      u.returnType === 'repair'
      || !!u.repairedAt
      || (Array.isArray(u.flags) && u.flags.includes('repaired_unit'));
    if (!hasRepairMarker) continue;

    const unitKey = s.unitId || k;
    const cycles = voidedByUnit.get(unitKey) ?? [];

    // Multi-cycle: can't tell which void was the repair from unit data
    // alone. Surface for manual review (de-dup once per unit).
    if (cycles.length > 1) {
      if (!reportedUnits.has(u.id)) {
        reportedUnits.add(u.id);
        manualReview.push({
          unitId: u.id,
          imei: u.imei || '',
          voidedSaleIds: cycles.map(c => c.id),
        });
      }
      continue;
    }

    const reason = (s.voidReason || '').replace(/^Refund — /, 'In Repair — ');
    autoFixable.push({
      saleId: s.id,
      unitId: u.id,
      imei: u.imei || '',
      current: { voidOutcome: s.voidOutcome, voidReason: s.voidReason },
      patch: {
        voidOutcome: 'repair',
        voidReason: reason.startsWith('In Repair — ') ? reason : `In Repair — ${reason || 'historical repair void backfill'}`,
      },
    });
  }
  return { autoFixable, manualReview };
}

/** Apply the patches. Writes one Sale doc per item via dbService.update. */
export async function fixCorruptedRepairVoids(
  items: CorruptedRepairVoid[],
  dbServiceArg: { update: (collection: string, id: string, data: Record<string, unknown>) => Promise<void> },
): Promise<{ saleId: string; ok: boolean; err?: string }[]> {
  const results: { saleId: string; ok: boolean; err?: string }[] = [];
  for (const item of items) {
    try {
      await dbServiceArg.update('sales', item.saleId, item.patch);
      results.push({ saleId: item.saleId, ok: true });
    } catch (e: unknown) {
      const err = e instanceof Error ? e.message : String(e);
      results.push({ saleId: item.saleId, ok: false, err });
    }
  }
  return results;
}
