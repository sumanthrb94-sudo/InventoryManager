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
 *   - units returned ON OR AFTER the sale's date — see below
 *
 * ── Re-import guard ─────────────────────────────────────────────────────
 * Callers hand us the PARSED rows, which carry no voidedAt (the workbook
 * has no such column), so `s.voidedAt` alone cannot protect a sale that
 * was voided in-app after the first import. And the status skip-list only
 * caught `returned`: a Back-to-Inventory unit sits at status 'available',
 * so re-uploading the same monthly report dragged it back to 'sold' and
 * nulled its return fields — silently erasing the return, restoring
 * refunded revenue, and leaving a replacement pair reading as two sales
 * of one order.
 *
 * The date comparison is the durable fix: a return dated on or after the
 * sale being imported SUPERSEDES that sale, whatever the row says. A
 * genuine re-sale (new sale dated after the return) still flows through
 * and still clears the stale return fields, which is the case the
 * clearing behaviour was written for.
 *
 * Callers should also pass sale docs merged over their stored versions so
 * `voidedAt` survives — belt and braces, since the guard above no longer
 * depends on it.
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
  /** Units that were SUPPLIER-HELD when the sale fulfilled them. The
   *  caller passes these to reconcileShsAfterFulfilment so the matching
   *  placeholder and master-file aggregate stop counting as stock we no
   *  longer have — the patches alone flip the unit but leave that trail. */
  shsFulfilled: Array<{ unitId: string; model: string; supplierName: string }>;
} {
  const unitsByImei = new Map<string, InventoryUnit>();
  for (const u of units) {
    const k = (u.imei || '').trim().toUpperCase();
    if (k && !unitsByImei.has(k)) unitsByImei.set(k, u);
  }

  // Supplier-held stock has NO IMEI — the supplier hasn't shipped, so there is
  // no handset to read one off. When they ship straight to the customer, the
  // sale arrives carrying an IMEI we have never seen, and matching by IMEI
  // finds nothing at all. The holding then sits "on order" forever while the
  // phone is gone.
  //
  // So IMEI-less SHS units are also indexed by model + supplier, which is the
  // only thing the holding and the sale genuinely share. Same pairing
  // reconcileShsAfterFulfilment uses to close the master row, so both halves
  // of the trail agree on what matched.
  const shsKey = (model: string, supplier: string) =>
    `${(model || '').trim().toUpperCase()}|${(supplier || '').trim().toUpperCase()}`;
  const shsByModelSupplier = new Map<string, InventoryUnit[]>();
  for (const u of units) {
    if (u.status !== 'incoming' || (u.imei || '').trim()) continue;
    const k = shsKey(u.rawModel || u.model || '', u.supplierName || '');
    shsByModelSupplier.set(k, [...(shsByModelSupplier.get(k) ?? []), u]);
  }
  /** Consume one holding for this model+supplier, if any remain. */
  const takeShsUnit = (model: string, supplier: string): InventoryUnit | undefined => {
    const pool = shsByModelSupplier.get(shsKey(model, supplier));
    // shift() so ten of the same model fulfil one sale each, not ten each.
    return pool && pool.length ? pool.shift() : undefined;
  };

  const unitPatches: Array<{ collection: 'inventoryUnits'; id: string; data: Record<string, any> }> = [];
  const salePatches: Array<{ collection: 'sales'; id: string; data: Record<string, any> }> = [];
  const shsFulfilled: Array<{ unitId: string; model: string; supplierName: string }> = [];

  // Two sales can legitimately share one IMEI within a single import — a
  // barcode typo, or the same physical device genuinely cross-listed and
  // marked sold on two marketplaces before either listing was pulled. Both
  // resolve to the SAME existing unit via unitsByImei, so without dedup
  // below, the unit's own sold-state fields (salePrice/saleDate/platform/
  // orderId) would be decided by whichever sale happened to be iterated
  // last — which for a combined workbook is always the same marketplace
  // (AMAZON, BM, EBAY, ONBUY, TEMU, in that fixed sheet order), not
  // whichever sale actually happened later. Collect every qualifying
  // (sale, unit) pairing first, so the chronologically LATEST sale can be
  // picked as the unit's true final state regardless of iteration order.
  const candidates: Array<{ sale: Sale; unit: InventoryUnit }> = [];

  for (const s of sales) {
    if (s.voidedAt) continue;
    const imeiKey = (s.imei || '').trim().toUpperCase();
    if (!imeiKey) continue;
    // IMEI first. Falling back to a supplier holding only when nothing
    // matches keeps a normal office sale from ever consuming one.
    const u = unitsByImei.get(imeiKey)
      ?? takeShsUnit(s.model || '', s.supplierName || '');
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

    // Re-import guard: a return dated on or after this sale supersedes it.
    // Protects Back-to-Inventory units (status 'available'), which the
    // status check above cannot see, from being resurrected as sold by a
    // re-upload of the report that originally sold them.
    if (u.returnType && u.returnDate && s.saleDate && u.returnDate >= s.saleDate) continue;

    // Sale → unit linkage. Only patch when unitId is missing or wrong;
    // a no-op write would still bump the doc's updatedAt timestamp
    // unnecessarily. Every qualifying sale gets linked — even a duplicate-
    // IMEI collision is still, individually, real proof this unit was
    // involved in that sale, so the audit trail (Unit History, Returns)
    // should be able to find it either way.
    if (!s.unitId || s.unitId !== u.id) {
      salePatches.push({ collection: 'sales', id: s.id, data: { unitId: u.id } });
    }

    candidates.push({ sale: s, unit: u });
  }

  // Exactly one sale gets to decide each unit's own sold-state fields —
  // the one with the latest saleDate. Ties (or missing dates) keep
  // whichever was seen first, so the outcome is still deterministic
  // rather than depending on object identity/insertion order.
  const winnerByUnitId = new Map<string, Sale>();
  for (const c of candidates) {
    const prev = winnerByUnitId.get(c.unit.id);
    if (!prev || (c.sale.saleDate || '') > (prev.saleDate || '')) {
      winnerByUnitId.set(c.unit.id, c.sale);
    }
  }

  for (const { sale: s, unit: u } of candidates) {
    if (winnerByUnitId.get(u.id) !== s) continue;

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
    // Record the SHS trail to clear BEFORE the patch flips the status —
    // afterwards there is nothing left to tell us it was supplier-held.
    if (u.status === 'incoming') {
      shsFulfilled.push({
        unitId: u.id,
        model: u.model || '',
        supplierName: u.supplierName || '',
      });
    }
    // Fulfilling an IMEI-less holding is the moment its IMEI becomes known:
    // the supplier shipped a specific handset and the marketplace reported
    // it. Without this the unit stays permanently unidentifiable.
    const learnsImei = !(u.imei || '').trim() && !!s.imei;

    if (needsUnitPatch || learnsImei) {
      unitPatches.push({
        collection: 'inventoryUnits',
        id: u.id,
        data: {
          status: 'sold',
          // Where the unit CAME FROM, decided at fulfilment time and then
          // immutable — reports split office vs SHS revenue on it.
          //
          // An incoming unit is supplier-held by definition, so a sale
          // that fulfils it is an SHS sale. The old rule
          // (`u.stockSource ?? 'office'`) only preserved provenance when
          // something had already set the field, so parser-created SHS
          // placeholders — which never carry it — were relabelled office
          // the moment they sold, and the SHS column of every report lost
          // them. An explicit value still wins.
          stockSource: u.stockSource ?? (u.status === 'incoming' ? 'shs' : 'office'),
          ...(learnsImei ? { imei: s.imei } : {}),
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
  return { unitPatches, salePatches, shsFulfilled };
}
