export type DeviceCategory = 'iPhone' | 'iPad' | 'Apple Watch' | 'Tablet' | 'Samsung S Series' | 'Samsung A Series' | 'Other';

export type DeviceStatus = 'available' | 'sold' | 'reserved' | 'returned' | 'lost';
export type ListingSite = 'eBay' | 'Amazon' | 'OnBuy' | 'Backmarket' | 'Other';
export type StockLocation = 'office';  // Single location — all stock is held at the office
export type ConditionGrade = 'A' | 'B' | 'C' | 'D' | 'Unknown';

export type OperationalFlag = 'top10' | 'supplierHasStock' | 'stockSold';

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
  conditionGrade?: ConditionGrade;
  boxIncluded?: boolean;
  batteryHealth?: number;
  networkLock?: string;
  activationLock?: string;
  buyPrice: number;       // Buying price (BP)
  dateIn: string;         // ISO date string — when unit arrived in office
  supplierId: string;
  batchId?: string;
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
  attachments?: string[];
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
