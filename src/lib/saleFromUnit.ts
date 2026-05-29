/**
 * saleFromUnit.ts — single source of truth for creating a `Sale` document
 * from an in-app "mark as sold" action.
 *
 * Used by the drawer (UnitDetailDrawer.markSold) and the scanner
 * (ScanPage.commitAction) so the SALES_REPORT export contains every sale
 * regardless of which surface the operator used.
 *
 * If the chosen listing site doesn't map to one of the four SALES_REPORT
 * marketplaces (AMAZON / BM / EBAY / ONBUY), returns null and the caller
 * skips persistence — the unit still gets flagged sold, but no Sale row
 * is written (matching the pre-existing behaviour for off-platform sales).
 */
import type { InventoryUnit, Sale } from '../types';
import { calcSaleFinancials, marketplaceFromListingSite } from './platforms';

export interface BuildSaleInput {
  unit: InventoryUnit;
  listingSite: string;            // user-facing platform name (eBay / Amazon / ...)
  salePrice: number;
  saleDate: string;               // ISO yyyy-mm-dd
  postage?: number;               // £; defaults to 6.30 (matches client master)
  /** When true, P.VAT is forced to 0 (postage is VAT-exempt). */
  postageVatExempt?: boolean;
  accessories?: number;           // £; defaults to 1 (0 when no accessory bundled)
  saleOrderId?: string;
  customerName?: string;
  paymentMode?: string;           // BM only
}

const DEFAULT_POSTAGE = 6.30;
const DEFAULT_ACCESSORIES = 1;

export function buildSaleFromUnit(input: BuildSaleInput): Sale | null {
  const marketplace = marketplaceFromListingSite(input.listingSite);
  if (!marketplace) return null;

  const postage = input.postage ?? DEFAULT_POSTAGE;
  const accessories = input.accessories ?? DEFAULT_ACCESSORIES;
  const postageVatExempt = input.postageVatExempt ?? false;
  const orderNumber = input.saleOrderId || `INAPP-${input.unit.id}`;

  const fin = calcSaleFinancials({
    marketplace,
    buyPrice: input.unit.buyPrice ?? 0,
    salePrice: input.salePrice,
    postage,
    postageVatExempt,
    accessories,
  });

  const now = new Date();
  return {
    id: `${marketplace}__${orderNumber}`,
    marketplace,
    orderNumber,
    sku: input.unit.sku,
    imei: input.unit.imei,
    unitId: input.unit.id,
    supplierId: input.unit.supplierId,
    supplierName: input.unit.supplierName,
    saleDate: input.saleDate,
    quantity: 1,
    buyPrice: input.unit.buyPrice ?? 0,
    salePrice: input.salePrice,
    paymentMode: marketplace === 'BM' ? (input.paymentMode || undefined) : undefined,
    postageVatExempt: postageVatExempt || undefined,
    ...fin,
    comments: input.customerName || undefined,
    importBatchId: 'inapp',
    sourceFile: 'inapp-sell-flow',
    sourceRow: 0,
    importedAt: now,
    createdAt: now,
    updatedAt: now,
    ownerId: 'shared',
  };
}
