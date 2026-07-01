/**
 * SHS service — admin-only operations on supplier-held (incoming) stock.
 *
 * Centralises:
 *   - Hard-deleting SHS inventory units / aggregates
 *   - Cleaning up the synthetic SHS placeholder unit tied to an aggregate
 *   - Emitting an inventoryEvents audit row
 *   - Posting a persistent notice to the team notice board
 *
 * IMPORTANT: The UI gates these buttons with isAdmin(); Firestore rules also
 * restrict inventoryUnits / inventoryAggregates / notices deletes and notices
 * creates to admin. This service is the single place the business logic lives
 * so the audit trail + notice stay consistent regardless of which surface
 * triggers the delete.
 */

import { dbService } from '../lib/dbService';
import { auth, isAdmin } from '../lib/firebase';
import { logInventoryEvent } from '../lib/inventoryEvents';
import type { InventoryAggregate, InventoryUnit, Notice } from '../types';

// ── Shared helpers ───────────────────────────────────────────────────────────

const nowIso = () => new Date().toISOString();

/** Same slug used to build synthetic SHS placeholder ids in
 *  inventoryService.receiveShsAggregate and ImportModal.parseClientBulkSheet. */
function slugify(s: string): string {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'unknown';
}

function supplierNameFor(unit: InventoryUnit, aggregate?: InventoryAggregate): string {
  if (unit.supplierName) return unit.supplierName;
  // Match the placeholder-id derivation in inventoryService.receiveShsAggregate:
  // a legacy supplierName field wins, otherwise fall back to the first supplierId.
  if ((aggregate as any)?.supplierName) return (aggregate as any).supplierName;
  if (aggregate?.supplierIds?.[0]) return aggregate.supplierIds[0];
  return '';
}

async function postDeletionNotice(payload: {
  model: string;
  supplierName?: string;
  quantity?: number;
  colour?: string;
  storage?: string;
  reason: string;
}): Promise<void> {
  const now = nowIso();
  const adminEmail = auth.currentUser?.email || 'admin';
  const parts = [
    'SHS stock deleted',
    payload.model,
    payload.colour,
    payload.storage,
    payload.quantity !== undefined ? `qty ${payload.quantity}` : undefined,
    payload.supplierName ? `supplier: ${payload.supplierName}` : undefined,
    `— ${payload.reason}`,
    `(by ${adminEmail} · ${now.slice(0, 10)})`,
  ].filter(Boolean);

  const id = `notice_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const notice: Omit<Notice, 'id'> & { id: string } = {
    id,
    content: parts.join(' · '),
    createdAt: now,
    createdBy: adminEmail,
    ownerId: 'shared',
  };
  await dbService.create('notices', id, notice);
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface DeleteShsResult {
  ok: boolean;
  message?: string;
}

/**
 * Delete a single SHS unit (status === 'incoming') and post a notice.
 * Used from the SHS overlay / intake screen when the supplier confirms
 * they no longer have the stock.
 */
export async function deleteShsUnit(unit: InventoryUnit): Promise<DeleteShsResult> {
  if (!isAdmin(auth.currentUser)) {
    return { ok: false, message: 'Admin access required.' };
  }
  if (unit.status !== 'incoming') {
    return { ok: false, message: 'Only incoming / SHS units can be deleted here.' };
  }

  try {
    await dbService.delete('inventoryUnits', unit.id);
  } catch (err: any) {
    return { ok: false, message: err?.message || 'Failed to delete SHS unit.' };
  }

  await Promise.all([
    logInventoryEvent({
      type: 'stock_adjusted',
      message: `SHS unit deleted · ${unit.model}${unit.storage ? ' ' + unit.storage : ''}${unit.colour ? ' · ' + unit.colour : ''} · supplier: ${supplierNameFor(unit)} — supplier has no stock`,
      unitId: unit.id,
      buyPrice: unit.buyPrice,
    }),
    postDeletionNotice({
      model: unit.model,
      supplierName: supplierNameFor(unit),
      colour: unit.colour,
      storage: unit.storage,
      reason: 'supplier has no stock',
    }),
  ]);

  return { ok: true };
}

/**
 * Delete an SHS aggregate rollup and its synthetic placeholder unit, then
 * post a notice. The placeholder id is deterministic so a stale placeholder
 * is cleaned up even if the aggregate was partially received.
 */
export async function deleteShsAggregate(aggregate: InventoryAggregate): Promise<DeleteShsResult> {
  if (!isAdmin(auth.currentUser)) {
    return { ok: false, message: 'Admin access required.' };
  }
  if ((aggregate.quantityText || '').toUpperCase() !== 'SHS') {
    return { ok: false, message: 'Only SHS aggregates can be deleted here.' };
  }

  const supplierName = (aggregate as any).supplierName
    || aggregate.supplierIds?.[0]
    || '';
  const primarySupplierId = aggregate.supplierIds?.[0] || '';

  try {
    // 1. Remove the aggregate rollup (source of truth for the SHS row).
    await dbService.delete('inventoryAggregates', aggregate.id);

    // 2. Remove the synthetic placeholder unit if it exists.
    //    Deterministic id matches ImportModal / smokeMasterFiles.
    const placeholderId = `shs_${slugify(aggregate.model)}_${slugify(supplierName)}_${aggregate.sourceRow}`;
    await dbService.delete('inventoryUnits', placeholderId).catch(() => {
      // Placeholder may already have been received or never created — ignore.
    });
  } catch (err: any) {
    return { ok: false, message: err?.message || 'Failed to delete SHS aggregate.' };
  }

  const qty = aggregate.quantityNum ?? 1;

  await Promise.all([
    logInventoryEvent({
      type: 'stock_adjusted',
      message: `SHS aggregate deleted · ${aggregate.model}${aggregate.storage ? ' ' + aggregate.storage : ''} · qty ${qty} · supplier: ${supplierName} — supplier has no stock`,
      supplierId: primarySupplierId,
      buyPrice: aggregate.buyPrice,
    }),
    postDeletionNotice({
      model: aggregate.model,
      supplierName,
      quantity: qty,
      storage: aggregate.storage,
      reason: 'supplier has no stock',
    }),
  ]);

  return { ok: true };
}
