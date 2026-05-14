// Field whitelists for write endpoints. Anything outside the list is dropped
// — clients cannot smuggle in createdAt, deletedAt, ownerId, or arbitrary keys.

const INVENTORY_UNIT_FIELDS = new Set<string>([
  'id', 'imei', 'model', 'brand', 'category', 'colour', 'storage', 'grade',
  'batchNo', 'boxIncluded', 'batteryHealth', 'networkLock', 'activationLock',
  'buyPrice', 'dateIn', 'supplierId', 'batchId', 'stockLocation', 'status',
  'flags', 'notes', 'platformListed', 'listingSites', 'listingUrl',
  'listingId', 'listingDate', 'salePrice', 'saleDate', 'salePlatform',
  'saleOrderId', 'customerName', 'postageCost', 'returnType', 'returnDate',
  'returnReason', 'attachments', 'imageUrl',
]);

const SHS_FIELDS = new Set<string>([
  ...Array.from(INVENTORY_UNIT_FIELDS),
]);

const SUPPLIER_FIELDS = new Set<string>([
  'id', 'name', 'portal', 'contactName', 'contactEmail', 'phone', 'address',
  'paymentTerms', 'returnTerms', 'notes', 'websiteUrl',
]);

function pick(body: unknown, allowed: Set<string>): Record<string, unknown> {
  if (!body || typeof body !== 'object') return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (allowed.has(k)) out[k] = v;
  }
  return out;
}

export const pickInventoryUnit = (body: unknown) => pick(body, INVENTORY_UNIT_FIELDS);
export const pickShs           = (body: unknown) => pick(body, SHS_FIELDS);
export const pickSupplier      = (body: unknown) => pick(body, SUPPLIER_FIELDS);

// PostgREST .or() filters interpret `,` and `)` structurally. Escape any
// characters that could let a search term break out of the filter clause.
export function escapeIlike(input: string): string {
  return String(input).replace(/[\\(),%]/g, m => '\\' + m);
}

// Crypto-strong short id (used in place of Math.random()).
export function randomId(len = 12): string {
  const bytes = new Uint8Array(len);
  // Node 18+ exposes crypto.getRandomValues globally.
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(36).padStart(2, '0')).join('').slice(0, len);
}
