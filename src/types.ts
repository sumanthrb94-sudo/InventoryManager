export type DeviceCategory = 'iPhone' | 'iPad' | 'Apple Watch' | 'Tablet' | 'Samsung S Series' | 'Samsung A Series' | 'Other';

export type DeviceStatus = 'available' | 'sold' | 'reserved' | 'returned' | 'lost';

export type OperationalFlag = 'top10' | 'officeOnly' | 'supplierHasStock' | 'stockSold';

export interface Supplier {
  id: string;
  name: string;
  portal: 'eBay' | 'Website' | 'Direct' | 'Other';
  contactEmail?: string;
  websiteUrl?: string;
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
  buyPrice: number;       // Buying price (BP)
  dateIn: string;         // ISO date string — when unit arrived in office
  supplierId: string;
  status: DeviceStatus;
  // Operational flags for daily updates
  flags: OperationalFlag[];
  // Free-text note for this unit (e.g. "Screen crack", "Box missing")
  notes: string;
  // Sales platform listing status — derived from listingSites, kept for compatibility.
  platformListed: boolean;
  // Active marketplace listing sites for this unit.
  listingSites?: string[];
  // Sale info
  salePrice?: number;
  saleDate?: string;
  salePlatform?: 'eBay' | 'Amazon' | 'OnBuy' | 'Backmarket' | 'Other' | string;
  saleOrderId?: string;
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
  notes?: string;
  unitCount: number;
  totalBuyValue: number;  // Sum of buy prices for all units
  ownerId: string;
  createdAt: any;
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
  }[];
  totalAvailable: number;
  totalValue: number;
  flags: OperationalFlag[];
  latestDateIn: string;
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
