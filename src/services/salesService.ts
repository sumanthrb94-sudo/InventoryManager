/**
 * Sales write surface — record / void marketplace sales. Owns:
 *   - calcSaleFinancials math (no UI re-computes)
 *   - composite doc id `${marketplace}__${orderNumber}__${imei|sku|'inapp'}`
 *     for natural dedupe (matches src/lib/salesImport.ts so the in-app
 *     and master-file write paths produce the same composite for the
 *     same sale)
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
import { sanitiseFsIdSegment } from '../lib/salesImport';

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
  /** Operator-typed SKU. Wins over the stored unit.sku so an in-app correction
   *  takes effect on the sale row without a separate unit edit. */
  sku?: string;
  /** BM only — preserves Paypal/Klarna/Clear Pay/Apple Pay casing for the
   *  PayPal/Klarna 2.5% commission switch in calcSaleFinancials. */
  paymentMode?: string;
  /** Override the per-marketplace default postage (eBay £1/£2/£8 tiers,
   *  free-shipping promos). */
  postageOverride?: number;
  /** Operator marked this sale's postage as VAT-exempt (zero-rated export,
   *  etc). When true, P. VAT = 0 across all marketplaces and the downstream
   *  Total VAT / GP / Total VAT NTP fields recompute accordingly. */
  postageVatExempt?: boolean;
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
 * Doc id is composite (`${marketplace}__${orderNumber}__${imei|sku|'inapp'}`)
 * so re-running the same sale (e.g. by re-import) is a natural upsert,
 * while multiple phones shipped on the same order get their own docs.
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
    postageVatExempt: input.postageVatExempt,
  });

  const saleDate = input.saleDate || today();
  const nowIso = new Date().toISOString();

  // SKU: prefer the operator-typed value when present (an in-modal edit), fall
  // back to whatever's stamped on the unit. Either may be undefined / empty.
  const sku = (input.sku ?? '').trim() || unit.sku || '';

  // ── Build the sale doc using the composite id idiom. ───────────────────
  // Doc id = marketplace__orderNumber__discriminator (IMEI, then SKU,
  // then 'inapp'). MUST match the scheme in src/lib/salesImport.ts:
  // when the operator records a sale in-app and later re-imports the
  // same data from the master workbook, both paths produce the same
  // composite so bulkUpsertSales dedupes correctly instead of writing
  // a second copy. The in-app flow always has a unit (and therefore an
  // IMEI), so the first fallback path is the common case here.
  // sanitiseFsIdSegment scrubs Firestore-illegal chars (notably `/` —
  // some operator IMEI cells hold "IMEI1 / IMEI2" for multi-phone
  // orders, which would split the doc path).
  const idDiscriminator = sanitiseFsIdSegment((unit.imei || '').trim() || sku || 'inapp');
  const saleId = `${input.marketplace}__${sanitiseFsIdSegment(orderNumber)}__${idDiscriminator}`;

  const sale: Sale = {
    id: saleId,
    marketplace: input.marketplace,
    orderNumber,
    sku,
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
    postageVat: fin.postageVat,
    postageVatExempt: input.postageVatExempt || undefined,
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
    //    Persist the operator-typed SKU on the unit too if it differs from
    //    what was stored — keeps both surfaces in sync without a separate edit.
    const unitPatch: Record<string, any> = {
      status: 'sold',
      salePrice: sp,
      saleDate,
      salePlatform: input.marketplace,
      saleOrderId: orderNumber,
      postageCost: fin.postage,
      // Clear stale return state — this unit is starting a fresh sale
      // cycle. Without these nulls the unit doc carries returnType /
      // returnDate / returnOutcome from a previous return-then-resale,
      // which then leaks into every downstream filter (Returns KPIs
      // counting it twice, SellSheet allSold dropping it, loss sheet
      // mis-attributing the old leg cost). Each *cycle's* historical
      // loss is preserved on the corresponding Sale doc's voidedAt +
      // voidOutcome, so wiping the unit-side fields here is non-
      // destructive — the audit trail lives on the sales collection.
      returnType: null,
      returnDate: null,
      returnReason: null,
      returnOutcome: null,
      returnLegCost: null,
      returnComments: null,
    };
    if (input.sku && input.sku.trim() && input.sku.trim() !== (unit.sku || '')) {
      unitPatch.sku = input.sku.trim();
    }
    await dbService.update('inventoryUnits', unit.id, unitPatch);
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

/**
 * Bug B from the architectural review: when sales are imported from the
 * master workbook, the InventoryUnit on the buy side never gets flipped
 * to `status='sold'` (the import path writes Sale docs only; only the
 * in-app `recordSale` dual-writes). Result: Inventory still shows the
 * IMEI as in-stock even though the import says it sold.
 *
 * This helper inspects the freshly-imported sales against the live units
 * store, and returns the patch entries needed to bring both collections
 * in sync:
 *   - SET `sale.unitId` so the Sales Report ALL sheet's join works
 *     (clientReport.ts:550 keys off s.unitId)
 *   - SET `unit.status='sold'`, salePrice, saleDate, salePlatform,
 *     saleOrderId, postageCost from the matching Sale
 *
 * Matching is by IMEI (uppercased + trimmed). Skipped:
 *   - voided sales (sale.voidedAt set)
 *   - sales with no IMEI (orphan rows)
 *   - units whose status is `returned` or `incoming` (those lifecycle
 *     states encode operator-driven workflow we mustn't trample)
 *
 * Both patch arrays use the same shape dbService.bulkCreate consumes
 * with merge:true semantics, so callers can concatenate and write in
 * one batch.
 */
export function buildPostImportSyncPatches(
  sales: Sale[],
  units: InventoryUnit[],
): {
  unitPatches: Array<{ collection: 'inventoryUnits'; id: string; data: Record<string, any> }>;
  salePatches: Array<{ collection: 'sales'; id: string; data: Record<string, any> }>;
} {
  const unitsByImei = new Map<string, InventoryUnit>();
  for (const u of units) {
    const k = (u.imei || '').trim().toUpperCase();
    if (k && !unitsByImei.has(k)) unitsByImei.set(k, u);
  }

  const unitPatches: Array<{ collection: 'inventoryUnits'; id: string; data: Record<string, any> }> = [];
  const salePatches: Array<{ collection: 'sales'; id: string; data: Record<string, any> }> = [];

  for (const s of sales) {
    if (s.voidedAt) continue;
    const imeiKey = (s.imei || '').trim().toUpperCase();
    if (!imeiKey) continue;
    const u = unitsByImei.get(imeiKey);
    if (!u) continue;
    // A SALE record is proof of fulfilment. When the matched unit is SHS /
    // supplier-held (status==='incoming'), the sale means the supplier
    // shipped it — so we fulfil from THAT unit (flip incoming → sold),
    // carrying its full buy-side info (model, supplier, BP). Previously
    // incoming units were skipped, which left them stuck "on order" forever
    // even though they'd sold, and produced sold rows with no fulfilment
    // state. Returned units stay skipped: re-selling a returned unit is a
    // distinct re-listing cycle handled elsewhere (date-compare in
    // SellSheet.allSold), not a fresh fulfilment.
    if (u.status === 'returned') continue;

    // Sale → unit linkage. Only patch when unitId is missing or wrong;
    // a no-op write would still bump the doc's updatedAt timestamp
    // unnecessarily.
    if (!s.unitId || s.unitId !== u.id) {
      salePatches.push({ collection: 'sales', id: s.id, data: { unitId: u.id } });
    }

    // Unit's sold-state fields. Same idempotency check — skip when
    // already matching so re-imports don't churn updatedAt. Stale
    // returnType also forces a patch even if the sale fields match,
    // because letting the old return state ride forward into a new
    // sale cycle leaks into every downstream surface (Returns count,
    // SellSheet filter, loss sheet attribution).
    const hasStaleReturn = !!u.returnType || !!u.returnDate;
    const needsUnitPatch =
      u.status !== 'sold'
      || u.salePrice !== s.salePrice
      || u.saleDate !== s.saleDate
      || u.salePlatform !== s.marketplace
      || u.saleOrderId !== s.orderNumber
      || hasStaleReturn;
    if (needsUnitPatch) {
      unitPatches.push({
        collection: 'inventoryUnits',
        id: u.id,
        data: {
          status: 'sold',
          salePrice: s.salePrice,
          saleDate: s.saleDate,
          salePlatform: s.marketplace,
          saleOrderId: s.orderNumber,
          postageCost: s.postage,
          // Clear stale return fields on re-sale — historical cycle
          // data lives on the voided Sale docs (voidedAt + voidOutcome
          // per cycle) so wiping the unit-side copy is non-destructive.
          returnType: null,
          returnDate: null,
          returnReason: null,
          returnOutcome: null,
          returnLegCost: null,
          returnComments: null,
        },
      });
    }
  }
  return { unitPatches, salePatches };
}
