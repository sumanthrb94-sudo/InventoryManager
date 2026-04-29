export interface Supplier {
  id: string;
  name: string;
  portal: 'eBay' | 'Website' | 'Direct' | 'Other';
  contactEmail?: string;
  websiteUrl?: string;
  ownerId: string;
  createdAt: any;
}

export interface Batch {
  id: string;
  supplierId: string;
  date: any;
  supplierRef?: string;
  itemCount: number;
  costTotal: number;
  status: 'received' | 'processing' | 'completed';
  ownerId: string;
  createdAt: any;
}

export interface Device {
  id: string;
  imei: string;
  model: string;
  brand: string;
  batchId: string;
  supplierId: string;
  condition: 'New' | 'Used - Mint' | 'Used - Good' | 'Used - Fair' | 'Damaged';
  purchasePrice: number;
  status: 'available' | 'sold' | 'returned' | 'lost';
  salePrice?: number;
  saleDate?: any;
  salePlatform?: string;
  orderId?: string;
  updatedAt?: any;
  ownerId: string;
  createdAt: any;
}

export interface Order {
  id: string;
  platform: string;
  platformOrderId: string;
  totalAmount: number;
  date: any;
  status: string;
  deviceIds: string[];
  customerName?: string;
  ownerId: string;
  createdAt: any;
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
