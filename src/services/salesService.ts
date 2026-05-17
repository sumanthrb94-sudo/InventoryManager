/**
 * Sales write surface — record / void marketplace sales. Owns:
 *   - calcSaleFinancials math (no UI re-computes)
 *   - composite doc id `${marketplace}__${orderNumber}` for natural dedupe
 *   - inventoryUnit status flip to 'sold' + sale linkage
 *   - serverTimestamp on createdAt/updatedAt (via dbService cleanForFirestore)
 *
 * Business rules now centralised here:
 *   - GP / commission / marginalTax / postage are derived ONLY via
 *     calcSaleFinancials. UI must not recompute its own version of these.
 *   - Composite doc id prevents re-record duplicates by orderNumber.
 *   - Unit status flip + sale linkage is one logical operation.
 */

import { dbService } from '../lib/dbService';
import type { InventoryUnit, Marketplace, Sale } from '../types';
import { calcSaleFinancials } from '../lib/platforms';
import { logInventoryEvent } from '../lib/inventoryEvents';

export interface RecordSaleInput {
  marketplace: Marketplace;
  orderNumber: string;
  /** Either `imei` OR `unitId` must be provided so the inventory unit can
   *  be looked up and flipped to status='sold'. */
  imei?: string;
  unitId?: string;
  /** Buy price snapshot — stored on the sale row alongside derived GP fields. */
  buyPrice: number;
  salePrice: number;
  /** ISO yyyy-mm-dd; defaults to today. */
  saleDate?: string;
  /** BM only — preserves Paypal/Klarna/Clear Pay/Apple Pay casing for the
   *  PayPal/Klarna 2.5% commission switch in calcSaleFinancials. */
  paymentMode?: string;
  /** Override the per-marketplace default postage (eBay £1/£2/£8 tiers,
   *  free-shipping promos). */
  postageOverride?: number;
  comments?: string;
}

export type RecordSaleErrorCode =
  | 'missing_marketplace'
  | 'missing_order_number'
  | 'missing_unit'
  | 'invalid_price'
  | 'write_failed';

export interface RecordSaleResult {
  ok: boolean;
  /** The composite doc id `${marketplace}__${orderNumber}` when ok. */
  saleId?: string;
  error?: RecordSaleErrorCode;
  message?: string;
}

const today = () => new Date().toISOString().split('T')[0];

/**
 * Record one marketplace sale. Computes every derived financial field via
 * {@link calcSaleFinancials} so the stored row stays in sync with the live
 * fee schedule. Flips the linked inventoryUnit to status='sold' and stamps
 * sale provenance (`saleOrderId`, `salePrice`, `saleDate`, `salePlatform`).
 *
 * Doc id is composite (`${marketplace}__${orderNumber}`) so re-running the
 * same sale (e.g. by re-import) is a natural upsert.
 */
export async function recordSale(input: RecordSaleInput): Promise<RecordSaleResult> {
  // ── Input validation ────────────────────────────────────────────────────
  if (!input.marketplace) {
    return { ok: false, error: 'missing_marketplace', message: 'Marketplace is required.' };
  }
  const orderNumber = (input.orderNumber ?? '').trim();
  if (!orderNumber) {
    return { ok: false, error: 'missing_order_number', message: 'Order number is required.' };
  }
  const sp = Number(input.salePrice);
  const bp = Number(input.buyPrice);
  if (!Number.isFinite(sp) || sp <= 0) {
    return { ok: false, error: 'invalid_price', message: 'Sale price must be greater than £0.' };
  }
  if (!Number.isFinite(bp) || bp < 0) {
    return { ok: false, error: 'invalid_price', message: 'Buy price must be a valid number.' };
  }

  // ── Look up the unit (by id or imei) so we can flip status + link sale. ──
  let unit: InventoryUnit | undefined;
  if (input.unitId) {
    const all = await dbService.readAll('inventoryUnits');
    unit = all.find((u: any) => u.id === input.unitId);
  } else if (input.imei) {
    const found = await dbService.getByImei(input.imei.trim().toUpperCase());
    unit = found ?? undefined;
  }
  if (!unit) {
    return {
      ok: false,
      error: 'missing_unit',
      message: 'Could not find the inventory unit to mark as sold.',
    };
  }

  // ── Compute derived financials in ONE place. ───────────────────────────
  const hasPayPalKlarna = /paypal|klarna|clearpay|clear pay|applepay|apple pay/i
    .test(input.paymentMode || '');
  // eBay shipping tiers map literal £1/£2/£8 inputs to the helper's tier slot.
  let eBayShippingTier: 1 | 2 | 8 | undefined;
  if (input.marketplace === 'EBAY'
      && (input.postageOverride === 1 || input.postageOverride === 2 || input.postageOverride === 8)) {
    eBayShippingTier = input.postageOverride as 1 | 2 | 8;
  }
  const fin = calcSaleFinancials({
    marketplace: input.marketplace,
    buyPrice: bp,
    salePrice: sp,
    postageOverride: input.postageOverride,
    eBayShippingTier,
    hasPayPalKlarna,
  });

  // ── Build the sale doc using the composite id idiom. ───────────────────
  const saleId = `${input.marketplace}__${orderNumber}`;
  const saleDate = input.saleDate || today();
  const nowIso = new Date().toISOString();

  const sale: Sale = {
    id: saleId,
    marketplace: input.marketplace,
    orderNumber,
    sku: unit.sku,
    imei: unit.imei,
    unitId: unit.id,
    supplierId: unit.supplierId,
    supplierName: unit.supplierName,
    saleDate,
    quantity: 1,
    buyPrice: bp,
    salePrice: sp,
    paymentMode: input.paymentMode,
    spMinusBp: fin.spMinusBp,
    marginalTax: fin.marginalTax,
    commission: fin.commission,
    payPalKlarnaCom: fin.payPalKlarnaCom,
    rof: fin.rof,
    fvf: fin.fvf,
    twentyPercent: fin.twentyPercent,
    totalCom: fin.totalCom,
    vat20: fin.vat20,
    marVat: fin.marVat,
    postage: fin.postage,
    grossProfit: fin.grossProfit,
    gpPercent: fin.gpPercent,
    netProfit: fin.netProfit,
    comments: input.comments,
    importBatchId: 'inapp',
    sourceFile: 'inapp-sell-flow',
    sourceRow: 0,
    importedAt: nowIso,
    createdAt: nowIso,
    updatedAt: nowIso,
    ownerId: 'shared',
  };

  try {
    // 1. Write the sale row (composite id → natural dedupe).
    await dbService.create('sales', saleId, sale);

    // 2. Flip the unit to 'sold' and link sale provenance back to the unit.
    await dbService.update('inventoryUnits', unit.id, {
      status: 'sold',
      salePrice: sp,
      saleDate,
      salePlatform: input.marketplace,
      saleOrderId: orderNumber,
      postageCost: fin.postage,
    });
  } catch (err: any) {
    return { ok: false, error: 'write_failed', message: err?.message || 'Save failed.' };
  }

  // 3. Audit log.
  await logInventoryEvent({
    type: 'sold',
    message: `Sold ${unit.model || unit.imei} on ${input.marketplace} · order ${orderNumber} · £${sp}`,
    unitId: unit.id,
    platform: input.marketplace,
    salePrice: sp,
    buyPrice: bp,
  });

  return { ok: true, saleId };
}

/**
 * Void a recorded sale. Deletes the sale row and reverts the linked unit
 * back to status='available', clearing the sale fields. Logged as a
 * stock_adjusted event with the supplied reason.
 */
export async function voidSale(saleId: string, reason: string): Promise<{ ok: boolean; message?: string }> {
  if (!saleId) return { ok: false, message: 'Sale id is required.' };
  const all = await dbService.readAll('sales');
  const sale = all.find((s: any) => s.id === saleId) as Sale | undefined;
  if (!sale) return { ok: false, message: `Sale ${saleId} not found.` };

  try {
    if (sale.unitId) {
      // Revert the unit by clearing sale fields and putting it back available.
      await dbService.update('inventoryUnits', sale.unitId, {
        status: 'available',
        salePrice: null,
        saleDate: null,
        salePlatform: null,
        saleOrderId: null,
      });
    }
    await dbService.delete('sales', saleId);
    await logInventoryEvent({
      type: 'stock_adjusted',
      message: `Voided sale ${saleId} — ${reason}`,
      unitId: sale.unitId,
    });
    return { ok: true };
  } catch (err: any) {
    return { ok: false, message: err?.message || 'Void failed.' };
  }
}
