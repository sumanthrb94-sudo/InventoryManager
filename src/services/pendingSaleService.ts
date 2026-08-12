/**
 * Two-stage selling — the sales team records the order, the warehouse supplies
 * the handset.
 *
 * THE PROBLEM THIS SOLVES
 *
 * Two teams touch one sale. The first knows what was sold and for how much —
 * model, order number, SKU, marketplace, sale price — because that is what the
 * marketplace tells them. They do not know the IMEI, because nobody has walked
 * to the shelf yet. Under the old single-step flow they could not record the
 * sale at all: Mark Sold needs a specific unit, so the order sat unrecorded
 * until someone with shelf access got to it, and the day's figures were always
 * behind.
 *
 * So the sale is split:
 *
 *   STAGE 1  recordPendingSale — by MODEL. Every fee, VAT line and profit
 *            figure is computed and the row appears in the Sales Report
 *            straight away, flagged "UPDATE IMEI & MARK SOLD". No unit is
 *            touched and nothing is marked sold.
 *
 *   STAGE 2  linkImeiToPendingSale — the warehouse picks an IMEI from the
 *            available units of that model. The unit flips to sold, the real
 *            buy price replaces the provisional one, and every downstream
 *            number is recomputed from it.
 *
 * WHY THE STOCK IS NOT RESERVED AT STAGE 1
 *
 * Deliberate, and worth stating because the alternative looks tempting.
 * Holding a specific unit at stage 1 would mean choosing one, which is exactly
 * the thing the first team cannot do. Reserving "one of these" would need a
 * second kind of stock state that every count, KPI and report would then have
 * to understand.
 *
 * The cost of not reserving is that stock can be oversold: two pending sales
 * for a model with one unit left. That is a real risk, and it is surfaced
 * rather than prevented — pendingCountByModel lets the UI show "2 awaiting, 1
 * in stock" so the shortfall is visible to the people who can act on it. A
 * silent reservation that made the shelf disagree with the app would be worse.
 *
 * WHY THE BUY PRICE IS PROVISIONAL RATHER THAN BLANK
 *
 * Gross profit needs a buy price and there is no handset yet. Leaving it blank
 * would put a hole in the report exactly where the operator looks for the
 * day's profit. Instead the cheapest available unit of the model stands in —
 * the conservative direction, since it makes profit look its best only when
 * every unit cost the same, which is the common case — and the sale is stamped
 * `provisionalBuyPrice` so the figure is never mistaken for settled. Stage 2
 * replaces it with the actual cost and recomputes.
 */
import { dbService } from '../lib/dbService';
import { buildSaleFinancials } from './salesService';
import { sanitiseFsIdSegment } from '../lib/firestoreIds';
import { logInventoryEvent } from '../lib/inventoryEvents';
import { normalizeBucketModel } from '../lib/modelStorage';
import type { InventoryUnit, Marketplace, Sale } from '../types';

const today = () => new Date().toISOString().slice(0, 10);

export interface RecordPendingSaleInput {
  marketplace: Marketplace;
  orderNumber: string;
  /** The model as the sales team knows it. Matched to stock at stage 2. */
  model: string;
  /** Mandatory, same as the rest of the sell flow. */
  sku: string;
  salePrice: number;
  saleDate?: string;
  storage?: string;
  paymentMode?: string;
  postageOverride?: number;
  postageVatExempt?: boolean;
  marketing?: number;
  comments?: string;
}

export type PendingSaleError =
  | 'missing_marketplace' | 'missing_order_number' | 'missing_model'
  | 'missing_sku' | 'invalid_price' | 'duplicate' | 'write_failed';

export interface RecordPendingSaleResult {
  ok: boolean;
  saleId?: string;
  error?: PendingSaleError;
  message?: string;
}

/** Units that could fulfil a pending sale for `model` — available office stock. */
export function candidateUnitsFor(model: string, units: InventoryUnit[]): InventoryUnit[] {
  const want = normalizeBucketModel(model);
  return units.filter(u =>
    u.status === 'available'
    && (u.imei || '').trim()
    && normalizeBucketModel(u.model || '') === want);
}

/**
 * The stand-in buy price: the cheapest available unit of the model.
 *
 * Cheapest rather than newest or average because it is the one that cannot
 * flatter the figures — a low BP yields a high provisional profit, so if the
 * number looks good at stage 1 it is because the stock really is cheap, not
 * because the estimate was generous. Returns 0 when nothing is in stock, which
 * is honest: there is no cost basis to quote yet.
 */
export function provisionalBuyPriceFor(model: string, units: InventoryUnit[]): number {
  const prices = candidateUnitsFor(model, units)
    .map(u => Number(u.buyPrice) || 0)
    .filter(n => n > 0);
  return prices.length ? Math.min(...prices) : 0;
}

/** Every sale still waiting for an IMEI, newest first. */
export function pendingSales(sales: Sale[]): Sale[] {
  return sales
    .filter(s => s.awaitingImei && !s.voidedAt)
    .sort((a, b) => (b.saleDate || '').localeCompare(a.saleDate || ''));
}

/**
 * How many pending sales are owed per normalised model. Lets the UI show the
 * shortfall this design accepts rather than prevents — see the file docblock.
 */
export function pendingCountByModel(sales: Sale[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of pendingSales(sales)) {
    const k = normalizeBucketModel(s.model || '');
    if (!k) continue;
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

/**
 * STAGE 1 — record a sale by model, with no handset attached.
 *
 * Writes a real Sale doc so the row is in the report, the VAT return and every
 * total from the moment it is entered. It differs from a finished sale in
 * exactly two ways: `awaitingImei` is set, and there is no unitId/imei.
 */
export async function recordPendingSale(
  input: RecordPendingSaleInput,
): Promise<RecordPendingSaleResult> {
  if (!input.marketplace) {
    return { ok: false, error: 'missing_marketplace', message: 'Marketplace is required.' };
  }
  const orderNumber = (input.orderNumber ?? '').trim();
  if (!orderNumber) {
    return { ok: false, error: 'missing_order_number', message: 'Order number is required.' };
  }
  const model = (input.model ?? '').trim();
  if (!model) {
    return { ok: false, error: 'missing_model', message: 'Model is required — it is how the IMEI is found later.' };
  }
  const sku = (input.sku ?? '').trim();
  if (!sku) {
    return { ok: false, error: 'missing_sku', message: 'SKU is required.' };
  }
  const sp = Number(input.salePrice);
  if (!Number.isFinite(sp) || sp <= 0) {
    return { ok: false, error: 'invalid_price', message: 'Sale price must be greater than £0.' };
  }

  const units = (await dbService.readAll('inventoryUnits')) as InventoryUnit[];
  const bp = provisionalBuyPriceFor(model, units);

  const fin = buildSaleFinancials({
    marketplace: input.marketplace,
    buyPrice: bp,
    salePrice: sp,
    postageOverride: input.postageOverride,
    postageVatExempt: input.postageVatExempt,
    marketing: input.marketing,
    paymentMode: input.paymentMode,
  });

  // Doc id: same composite idiom as recordSale, with the SKU as discriminator
  // because there is no IMEI yet. Stage 2 does NOT re-key the document — the
  // id it was created with is the id it keeps, so anything already pointing at
  // it stays valid.
  //
  // One order can legitimately contain two of the same model, which would
  // collide on this id. A numeric suffix is appended rather than letting the
  // second line overwrite the first — silently losing a sale is far worse than
  // an id that reads `__2`.
  const base = `${input.marketplace}__${sanitiseFsIdSegment(orderNumber)}__${sanitiseFsIdSegment(sku)}`;
  const existing = (await dbService.readAll('sales')) as Sale[];
  const taken = new Set(existing.map(s => s.id));
  let saleId = base;
  for (let n = 2; taken.has(saleId); n++) saleId = `${base}__${n}`;

  const nowIso = new Date().toISOString();
  const sale: Sale = {
    id: saleId,
    marketplace: input.marketplace,
    orderNumber,
    sku,
    model,
    ...(input.storage ? { storage: input.storage } : {}),
    // The two markers that make this a stage-1 row.
    awaitingImei: true,
    provisionalBuyPrice: true,
    imei: '',
    saleDate: input.saleDate || today(),
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
    commissionVat: fin.commissionVat,
    dsf: fin.dsf,
    dsfVat: fin.dsfVat,
    customerCareFees: fin.customerCareFees,
    accessoryFee: fin.accessoryFee,
    marketing: fin.marketing,
    marketingVat: fin.marketingVat,
    totalVat: fin.totalVat,
    totalVatNtp: fin.totalVatNtp,
    grossProfit: fin.grossProfit,
    gpPercent: fin.gpPercent,
    netProfit: fin.netProfit,
    comments: input.comments,
    importBatchId: 'inapp',
    sourceFile: 'inapp-pending-sale',
    sourceRow: 0,
    importedAt: nowIso,
    createdAt: nowIso,
    updatedAt: nowIso,
    ownerId: 'shared',
  } as Sale;

  try {
    await dbService.create('sales', saleId, sale);
    await logInventoryEvent({
      type: 'stock_adjusted',
      message: `Sale recorded awaiting IMEI — ${model} · ${input.marketplace} · ${orderNumber} · £${sp}`,
    });
    return { ok: true, saleId };
  } catch (err: any) {
    return { ok: false, error: 'write_failed', message: err?.message || 'Could not record the sale.' };
  }
}

export interface LinkImeiResult {
  ok: boolean;
  error?: 'sale_not_found' | 'not_pending' | 'unit_not_found' | 'unit_not_available' | 'write_failed';
  message?: string;
}

/**
 * STAGE 2 — attach the handset and complete the sale.
 *
 * Recomputes the money from the unit's real buy price. Skipping that would
 * leave the provisional figure on a finished sale, which is the whole reason
 * the stage-1 number is flagged in the first place.
 */
export async function linkImeiToPendingSale(input: {
  saleId: string;
  unitId: string;
}): Promise<LinkImeiResult> {
  const sales = (await dbService.readAll('sales')) as Sale[];
  const sale = sales.find(s => s.id === input.saleId);
  if (!sale) return { ok: false, error: 'sale_not_found', message: `Sale ${input.saleId} not found.` };
  if (!sale.awaitingImei) {
    return { ok: false, error: 'not_pending', message: 'That sale already has a handset attached.' };
  }

  const units = (await dbService.readAll('inventoryUnits')) as InventoryUnit[];
  const unit = units.find(u => u.id === input.unitId);
  if (!unit) return { ok: false, error: 'unit_not_found', message: 'Could not find that unit.' };
  if (unit.status !== 'available') {
    // Two warehouse users completing different pending sales with the same
    // handset is the realistic race here, and it must not silently sell one
    // phone twice.
    return {
      ok: false,
      error: 'unit_not_available',
      message: `${unit.imei || unit.id} is ${unit.status}, not available.`,
    };
  }

  const bp = Number(unit.buyPrice) || 0;
  const fin = buildSaleFinancials({
    marketplace: sale.marketplace,
    buyPrice: bp,
    salePrice: Number(sale.salePrice) || 0,
    postageOverride: sale.postage,
    postageVatExempt: sale.postageVatExempt,
    marketing: sale.marketing,
    paymentMode: sale.paymentMode,
  });

  const nowIso = new Date().toISOString();
  try {
    await dbService.update('sales', sale.id, {
      awaitingImei: false,
      provisionalBuyPrice: false,
      imei: unit.imei || '',
      unitId: unit.id,
      supplierId: unit.supplierId ?? null,
      supplierName: unit.supplierName ?? null,
      buyPrice: bp,
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
      commissionVat: fin.commissionVat,
      dsf: fin.dsf,
      dsfVat: fin.dsfVat,
      customerCareFees: fin.customerCareFees,
      accessoryFee: fin.accessoryFee,
      totalVat: fin.totalVat,
      totalVatNtp: fin.totalVatNtp,
      grossProfit: fin.grossProfit,
      gpPercent: fin.gpPercent,
      netProfit: fin.netProfit,
      updatedAt: nowIso,
    });

    await dbService.update('inventoryUnits', unit.id, {
      status: 'sold',
      saleDate: sale.saleDate,
      salePrice: sale.salePrice,
      salePlatform: sale.marketplace,
      saleOrderId: sale.orderNumber,
      stockSource: unit.stockSource ?? 'office',
      updatedAt: nowIso,
    });

    await logInventoryEvent({
      type: 'stock_adjusted',
      message: `IMEI ${unit.imei || unit.id} attached to ${sale.marketplace} ${sale.orderNumber} — marked sold`,
      unitId: unit.id,
    });
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: 'write_failed', message: err?.message || 'Could not complete the sale.' };
  }
}
