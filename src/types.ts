export type DeviceCategory = 'iPhone' | 'iPad' | 'Apple Watch' | 'Tablet' | 'Samsung S Series' | 'Samsung A Series' | 'Other';

export type DeviceStatus = 'available' | 'sold' | 'reserved' | 'returned' | 'lost' | 'incoming' | 'ready_to_ship' | 'fba';
export type ListingSite = 'eBay' | 'Amazon' | 'OnBuy' | 'Backmarket' | 'Back Market' | 'FBA' | 'Project' | 'R T S' | 'Other';
export type StockLocation = 'office';  // Single location — all stock is held at the office
export type OperationalFlag = 'top10' | 'supplierHasStock' | 'stockSold';

export type ReturnCategory = 'returned_to_inventory' | 'returned_to_supplier' | 'repair';

// Canonical marketplace sheet names matching the SALES_REPORT workbook tabs
export type Marketplace = 'AMAZON' | 'BM' | 'EBAY' | 'ONBUY' | 'PROJECT';
export const MARKETPLACES: Marketplace[] = ['AMAZON', 'BM', 'EBAY', 'ONBUY', 'PROJECT'];

export interface Supplier {
  id: string;
  name: string;
  portal: 'eBay' | 'Website' | 'Direct' | 'Other' | 'Wholesale' | 'Auction' | 'Online';
  contactName?: string;
  contactEmail?: string;
  phone?: string;
  address?: string;
  paymentTerms?: string;
  returnTerms?: string;
  notes?: string;
  websiteUrl?: string;
  ownerId: string;
  createdAt: any;
}

export interface SourceDocument {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  storagePath: string;
  downloadURL: string;
  linkedType: 'supplier' | 'batch' | 'unit' | 'import';
  linkedId: string;
  ownerId: string;
  createdAt: any;
}

/**
 * InventoryUnit — one physical unit tracked by IMEI/Serial.
 * This is the core entity of the new inventory model.
 */
export interface InventoryUnit {
  id: string;
  imei: string;           // IMEI or serial number
  model: string;          // e.g. "iPhone 15 Pro Max 256GB"
  brand: string;          // e.g. "Apple", "Samsung"
  category: DeviceCategory;
  colour: string;         // e.g. "Natural Titanium", "Phantom Black"
  storage?: string;
  grade?: string;         // e.g. "A", "B", "C", "Refurbished"
  batchNo?: string;       // e.g. "INV-2061", custom batch identifier
  boxIncluded?: boolean;
  batteryHealth?: number;
  networkLock?: string;
  activationLock?: string;
  buyPrice: number;       // Buying price (BP)
  dateIn: string;         // ISO date string — when unit arrived in office
  supplierId: string;
  supplierName?: string;
  /** All suppliers attributed to this unit (e.g. "MHL / ABC / NIHAL" from a master sheet row). Primary = supplierId. */
  supplierIds?: string[];
  batchId?: string;
  /** Doc id of the importBatches row that created this unit (provenance). */
  importBatchId?: string;
  sourceFile?: string;
  sourceRow?: number;
  /** Firestore serverTimestamp() of import — distinct from createdAt for re-imports. */
  importedAt?: any;
  /** Free-text marketplace label preserved verbatim from the master file (e.g. "Back Market", "R T S", "FBA"). */
  marketplace?: string;
  /** Status verbatim from the master file (e.g. "R T S"), preserved alongside the typed `status` field. */
  statusRaw?: string;
  stockOutDate?: string;
  sku?: string;
  stockLocation?: StockLocation;
  status: DeviceStatus;
  // Operational flags for daily updates
  flags: OperationalFlag[];
  // Free-text note for this unit (e.g. "Screen crack", "Box missing")
  notes: string;
  // Sales platform listing status
  platformListed: boolean;
  listingSites?: ListingSite[];
  listingUrl?: string;
  listingId?: string;
  listingDate?: string;
  // Sale info
  salePrice?: number;
  saleDate?: string;
  salePlatform?: ListingSite | string;
  saleOrderId?: string;
  customerName?: string;
  postageCost?: number;      // Outbound postage paid by seller (default £8)
  // Returns
  returnType?: ReturnCategory;
  returnDate?: string;
  returnReason?: string;
  attachments?: string[];
  imageUrl?: string;        // Cloud image URL for the device (imgbb)
  ownerId: string;
  createdAt: any;
  updatedAt?: any;
}

/**
 * Batch — a supplier packing slip / purchase batch.
 */
export interface Batch {
  id: string;
  supplierId: string;
  date: string;           // ISO date string
  supplierRef?: string;   // Supplier invoice/ref number
  invoiceNumber?: string;
  deliveryNote?: string;
  receivedBy?: string;
  warehouseLocation?: StockLocation;
  currency?: string;
  shippingCost?: number;
  taxAmount?: number;
  discountAmount?: number;
  notes?: string;
  unitCount: number;
  totalBuyValue: number;  // Sum of buy prices for all units
  attachments?: string[];
  ownerId: string;
  createdAt: any;
}

export interface InventoryEvent {
  id: string;
  type: 'batch_created' | 'file_attached' | 'listed' | 'delisted' | 'sold' | 'returned' | 'available' | 'price_update' | 'stock_adjusted' | 'notes_updated';
  message: string;
  unitId?: string;
  batchId?: string;
  supplierId?: string;
  platform?: ListingSite | string;
  salePrice?: number;
  buyPrice?: number;
  createdAt: any;
  ownerId: string;
}

/**
 * DailyUpdate — a date-stamped operational update from the ops team.
 */
export interface DailyUpdate {
  id: string;
  date: string;           // ISO date string
  message: string;        // The update text
  affectedUnitIds: string[];
  affectedModels: string[];
  type: 'stock_in' | 'stock_sold' | 'price_change' | 'platform_update' | 'general';
  ownerId: string;
  createdAt: any;
}

/**
 * ModelSummary — a computed view grouping units by model+colour for platform sync.
 */
export interface ModelSummary {
  model: string;
  brand: string;
  category: DeviceCategory;
  variants: {
    colour: string;
    availableCount: number;
    units: InventoryUnit[];
    lowestBuyPrice: number;
    listingSites: ListingSite[];
  }[];
  totalAvailable: number;
  totalValue: number;
  flags: OperationalFlag[];
  latestDateIn: string;
  listingSites: ListingSite[];
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  }
}

/**
 * ActiveListing — Represents a model listed on a platform.
 * Used to reconcile physical inventory with online presence.
 */
export interface ActiveListing {
  id: string;
  model: string;
  platform: ListingSite | string;
  quantity: number;
  listingUrl?: string;
  listingId?: string;
  notes?: string;
  updatedAt: any;
  ownerId: string;
}

/**
 * Sale — one marketplace transaction. Replaces sale_* fields on InventoryUnit.
 * Doc id convention: `${marketplace}__${orderNumber}` for natural dedupe on re-import.
 */
export interface Sale {
  id: string;
  marketplace: Marketplace;
  orderNumber: string;
  sku?: string;
  imei?: string;                 // alphanumeric allowed, may be empty
  unitId?: string;               // link to inventoryUnits when matched
  supplierId?: string;
  supplierName?: string;
  saleDate: string;              // ISO yyyy-mm-dd
  quantity: number;
  buyPrice: number;
  salePrice: number;
  paymentMode?: string;          // BM only; preserve original casing (Paypal/Klarna/Clear Pay/...)
  // Computed financials
  spMinusBp: number;
  marginalTax: number;
  commission: number;
  payPalKlarnaCom?: number;      // BM
  rof?: number;                  // eBay
  fvf?: number;                  // eBay
  twentyPercent?: number;        // eBay 20%-on-fees bundle
  totalCom?: number;             // eBay
  vat20?: number;                // OnBuy / eBay
  marVat?: number;               // OnBuy
  postage: number;
  grossProfit: number;
  gpPercent: number;
  netProfit?: number;            // eBay incl. promo
  comments?: string;
  // Provenance
  importBatchId: string;
  sourceFile: string;
  sourceRow: number;
  importedAt: any;
  createdAt: any;
  updatedAt: any;
  ownerId: string;
}

/**
 * ImportBatch — provenance for every bulk import.
 * Doc id auto-assigned; every row in inventoryUnits/sales/inventoryAggregates carries this id.
 */
export interface ImportBatch {
  id: string;
  sourceFile: string;            // "INVENTORY_REPORT_2026_1.xlsx"
  sourceSheet?: string;          // "IMEI NUMBERS"
  rowCount: number;
  supplierId?: string;
  importedBy: string;            // uid or "shared"
  importedAt: any;               // Firestore serverTimestamp()
  notes?: string;
}

/**
 * MarketplaceFee — per-marketplace fee schedule. Doc id = marketplace name.
 * Read at app boot to drive both runtime GP calculations and Excel export formulas.
 */
export interface MarketplaceFee {
  marketplace: Marketplace;
  commissionPct: number;
  commissionReductionPct?: number;   // eBay 10
  fixedFee?: number;                 // eBay FVF 0.40
  postage: number;                   // 8 / 10 / 8 / 5.90
  marginTaxDivisor?: number;         // 6 for Amazon/BM/OnBuy/Project
  payPalKlarnaPct?: number;          // BM 2.5
  rofPct?: number;                   // eBay 0.35
  vatPct?: number;                   // 20 (OnBuy margin; eBay fees)
  promoPct?: number;                 // eBay 5
}

/**
 * InventoryAggregate — the INVENTORY sheet's model-roll-up rows
 * (one row per Model+Supplier with a free-text quantity, compound colours, etc.).
 * Distinct from per-IMEI `inventoryUnits` documents.
 */
export interface InventoryAggregate {
  id: string;
  model: string;
  /** Storage capacity (e.g. "32GB", "1TB") extracted out of the MODEL string
   * by `extractStorage()`; mirrors `InventoryUnit.storage`. */
  storage?: string;
  buyPrice?: number;
  quantityNum?: number;
  /** Captures non-numeric quantity values like "SHS", "NO STOCK". */
  quantityText?: string;
  /** Unnamed column D in the client sheet (e.g. "SALES FOCUS"). */
  notesFlag?: string;
  /** Parsed compound colours, e.g. { GREY: 2, SILVER: 0 }. */
  coloursMap?: { [colour: string]: number };
  /** Verbatim original colours string, e.g. "GREY 2 SILVER 0". */
  coloursRaw?: string;
  supplierIds: string[];
  notes?: string;
  importBatchId?: string;
  sourceRow?: number;
  ownerId: string;
  createdAt: any;
  updatedAt: any;
}

/**
 * SupplierWhatsappUpdate — one line from the SUPPLIER WHATSAPP UPDATES sheet,
 * captured as a free-form supplier feed.
 */
export interface SupplierWhatsappUpdate {
  id: string;
  supplierId?: string;           // best-effort link
  rawText: string;
  priceText?: string;            // "£85"
  postedAt: any;                 // Firestore serverTimestamp()
  ownerId: string;
}
