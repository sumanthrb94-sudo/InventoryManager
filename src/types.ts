export type DeviceCategory = 'iPhone' | 'iPad' | 'Apple Watch' | 'Tablet' | 'Samsung S Series' | 'Samsung A Series' | 'Other';

export type DeviceStatus = 'available' | 'sold' | 'reserved' | 'returned' | 'lost' | 'incoming' | 'ready_to_ship' | 'fba';
export type ListingSite = 'eBay' | 'Amazon' | 'OnBuy' | 'Backmarket' | 'Back Market' | 'Temu' | 'FBA' | 'R T S' | 'Other';
export type StockLocation = 'office';  // Single location — all stock is held at the office
export type OperationalFlag = 'top10' | 'supplierHasStock' | 'stockSold' | 'repaired_unit';

export type ReturnCategory = 'returned_to_inventory' | 'returned_to_supplier' | 'repair';

// Canonical marketplace sheet names matching the SALES_REPORT workbook tabs
export type Marketplace = 'AMAZON' | 'BM' | 'EBAY' | 'ONBUY' | 'TEMU';
export const MARKETPLACES: Marketplace[] = ['AMAZON', 'BM', 'EBAY', 'ONBUY', 'TEMU'];

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
  /** Original model string as it sits in Firestore, before any runtime
   *  normalisation. Used by admin reconciliation screens to spot units
   *  whose persisted model is still a raw operator SKU. */
  rawModel?: string;
  brand: string;          // e.g. "Apple", "Samsung"
  category: DeviceCategory;
  colour: string;         // e.g. "Natural Titanium", "Phantom Black"
  storage?: string;
  grade?: string;         // e.g. "A", "B", "C", "Refurbished"
  simType?: string;       // e.g. "Physical SIM", "eSIM", "Dual SIM"
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
  /** Fulfilment source of the unit — whether it was held in our office
   *  ('office') or supplier-held / SHS ('shs'). Distinct from the mutable
   *  `status`: it PERSISTS through the sold flip so a sold unit still records
   *  whether it was an office sale or an SHS sale, letting reports and the
   *  periodic table filter SHS as its own component even after it's sold.
   *  While in stock it tracks status (incoming → 'shs', available → 'office');
   *  captured explicitly per-unit when a sale is reconciled at import. */
  stockSource?: 'office' | 'shs';
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
  /** Customer-facing outcome of the return: 'refund' (money back) or
   *  'replacement' (we ship another unit). Drives the postage-loss
   *  multiplier in the Returns loss sheet — refund = 2 shipping legs
   *  (outbound + inbound), replacement = 3 (outbound + inbound +
   *  replacement outbound). */
  returnOutcome?: 'refund' | 'replacement';
  /** Set by ReadyToShipModal when a repair-route unit is marked complete
   *  and put back on the shelf. Acts as a post-completion repair marker —
   *  outcomeFor() and the Lifecycle table read it to keep classifying the
   *  historical cycle as "In Repair" even after returnType has been
   *  flipped to 'returned_to_inventory' (QA round 3 BUG-RP-002). */
  repairedAt?: string;
  /** Operator's free-text comments captured at Process Return time —
   *  separate from returnReason so the structured reason stays short. */
  returnComments?: string;
  /** Snapshot of one shipping leg's cost (postage + P.VAT) taken from
   *  the linked Sale at Process Return time. Snapshotted because the
   *  unit's own sale fields are cleared on return; loss = this ×
   *  (returnOutcome === 'replacement' ? 3 : 2). */
  returnLegCost?: number;
  /** Replacement audit link — when this unit was returned as a
   *  Replacement, points at the inventory unit that was actually shipped
   *  to the customer in its place. Mirrors `replacementForUnitId` on the
   *  shipped unit so the link is traversable from either side. */
  replacedByUnitId?: string;
  /** Replacement audit link — when this unit was shipped as the
   *  replacement for an earlier return, points back at the unit it
   *  replaced. Set on the OUTBOUND (now-sold) unit. */
  replacementForUnitId?: string;

  // ─── Return cost capture (2026-08, from the operator's returns policy) ───
  //
  // Before these three fields the ONLY cost a return recorded was carriage.
  // The operator confirmed the other three legs of the economics, and each
  // one is money the app was previously showing as zero:
  //
  //   repair       → the repair invoice is a real cost, recordable per unit
  //   replacement  → which handset went out (audit only — NOT a loss, the
  //                  faulty one comes back as it ships, so net stock is flat)
  //   to supplier  → credit comes back (full credit or a replacement unit)
  //
  // All three are OPTIONAL and all three default to absent, not zero. An
  // absent value means "not recorded yet", which the loss maths must treat
  // differently from a recorded £0 — otherwise an un-invoiced repair reads
  // as a free repair. See returnLoss.ts.

  /** Repair invoice for this unit's current/most recent repair cycle, £.
   *  Captured at repair COMPLETION rather than at return time because the
   *  invoice does not exist until the repairer has finished — the operator
   *  said the cost "depends on the issue with the phone". Cleared at the
   *  start of every new return cycle so a second repair does not inherit
   *  the first one's invoice. */
  repairCost?: number;
  /** Purchase price of the handset shipped out as the replacement, £,
   *  snapshotted onto the RETURNING unit at Process Return time.
   *
   *  AUDIT ONLY — this is deliberately not charged to the return's cost.
   *  A replacement sends one unit out and takes the faulty one back, so net
   *  stock is unchanged and only the three carriage legs are consumed. Both
   *  handsets' purchase prices already sit inside the gross profit of the
   *  two sales they belong to (the original sale, which the customer keeps
   *  paying for, and the later resale of the unit that came back), so adding
   *  this to the loss is a third charge for stock bought twice.
   *
   *  Kept because "which handset went out and what had it cost" is a real
   *  question during an audit, and snapshotted rather than read live through
   *  replacedByUnitId because that unit stays editable. */
  replacementUnitCost?: number;
  /** Credit received from the supplier for a returned-to-supplier unit, £.
   *  The operator gets "full credit or a replacement unit", same day. When
   *  the supplier sends a replacement handset instead of money, record the
   *  unit's buyPrice here — the value came back in kind. Offsets the sunk
   *  purchase price in the loss maths. */
  supplierCreditAmount?: number;
  /** ISO date the supplier credit landed. Recorded because the operator
   *  asked for the credit to be booked against the unit when it arrives. */
  supplierCreditDate?: string;
  /** How the supplier settled: money back, or a replacement handset.
   *  Kept separate from the amount so a like-for-like swap is auditable
   *  as a swap rather than looking like a cash refund. */
  supplierCreditType?: 'credit' | 'replacement_unit';

  // ─── Two-step return workflow (Tech-QC → CRM handoff) ───────────────────
  /** Step-1 (Tech/QC): customer's complaint as logged at intake time.
   *  Captured before the CRM team decides the outcome — they read this
   *  to understand what the customer reported. */
  customerComments?: string;
  /** Step-1 (Tech/QC): inspection findings after physical QC of the unit.
   *  CRM reads this alongside customerComments to pick the right outcome
   *  (Refund / Replacement / Repair / RTS). */
  technicianComments?: string;
  /** ISO timestamp when step-1 (Tech-QC) was completed. Sets the wall
   *  clock the CRM team's "n units pending" timer reads against. */
  returnQcAt?: string;
  /** Gate flag for the CRM queue. true between step-1 (Tech logs the
   *  unit) and step-2 (CRM finalises). The nav badge counts these. */
  pendingCrmReview?: boolean;
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
 * Notice — admin-authored team broadcast posted to the notice board.
 * Persisted in Firestore; create/update/delete are admin-gated in rules.
 */
export interface Notice {
  id: string;
  content: string;
  createdAt: string;      // ISO timestamp
  updatedAt?: string;     // bumped on admin edit
  createdBy?: string;     // admin email
  ownerId: string;
}

/**
 * ModelSummary — a computed view grouping units by model+colour for platform sync.
 */
export interface ModelSummary {
  model: string;
  brand: string;
  category: DeviceCategory;
  /** Storage capacity (e.g. "128GB", "1TB") — part of the SKU grouping key.
   *  May be `undefined` for legacy units whose storage is embedded in the
   *  `model` string. The (brand, model, storage) tuple is the canonical
   *  unique key; rows with different storage must not collapse together. */
  storage?: string;
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
 * Doc id convention: `${marketplace}__${orderNumber}__${imei|sku|row}` —
 * the IMEI (or SKU / sheet row as fallbacks) discriminates multiple
 * phones shipped on the same order so bulkUpsertSales doesn't collapse
 * them. Stays deterministic across re-imports of the same file.
 */
export interface Sale {
  id: string;
  marketplace: Marketplace;
  orderNumber: string;
  sku?: string;
  model?: string;                // manually reconciled model name for unlinked sales
  /**
   * TWO-STAGE SALE — stage 1 is done, stage 2 is not.
   *
   * The sales team knows the model, order number, SKU, marketplace and sale
   * price, because that is what the marketplace tells them. They do not know
   * the IMEI: nobody has walked to the shelf yet. They record the sale by
   * MODEL, the app computes every fee, VAT line and profit figure, and the row
   * lands in the report immediately — flagged, so nobody reads it as finished.
   *
   * While this is true the sale carries no `unitId` and no `imei`, and NO unit
   * has been marked sold. The warehouse then picks an IMEI for that model and
   * completes it (linkImeiToPendingSale), which clears this flag, flips the
   * unit, and recomputes the money against the unit's real buy price.
   */
  awaitingImei?: boolean;
  /**
   * The buy price on this sale is a stand-in, not the cost of an actual
   * handset. Set alongside `awaitingImei`: with no unit chosen there is no
   * real BP, so the cheapest available unit of the model is used to make gross
   * profit indicative rather than blank. Cleared when the IMEI is linked and
   * the true BP replaces it.
   */
  provisionalBuyPrice?: boolean;
  // Buy-side identity carried on the sale row so an export → re-import round
  // trip can restore it. The marketplace tabs gained Storage / Colour columns
  // in 2026-08; before that a sale for an IMEI never held in stock had no way
  // to supply either, and every such unit landed on the Orphans list.
  // Absent on older rows — always treat as optional.
  storage?: string;
  colour?: string;
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
  // Amazon-only VAT / DSF / accessory breakdown introduced when the operator
  // moved Amazon to the explicit per-line VAT model. All optional so older
  // sale docs round-trip without these fields populated.
  commissionVat?: number;        // Amazon: Commission * 20%
  dsf?: number;                  // Amazon: Digital Services Fee = Commission * 2%
  dsfVat?: number;               // Amazon: DSF * 20%
  postageVat?: number;           // Amazon + eBay + OnBuy + BM: Postage * 20%
  /** PACKAGING cost, £. The "Accessories" column on every marketplace tab —
   *  named for the sheet's own header, not for the accessory-SKU stock pool,
   *  which is an unrelated thing. Flat £1 per sale ROW on all five
   *  marketplaces; see MarketplaceFee.accessoryFee in platforms.ts for what
   *  "per row" does and does not mean. */
  accessoryFee?: number;
  totalVat?: number;             // Amazon: Commission VAT + DSF VAT + Postage VAT
                                 // eBay: VAT + P. VAT + M. VAT (the eBay VAT bundle is the (Com+ROF+FVF)*20% one)
                                 // OnBuy: VAT 20% + P. VAT
                                 // BM has only one VAT (P. VAT) so no separate Total VAT column
  totalVatNtp?: number;          // Amazon + eBay + OnBuy + BM: Marginal Tax − Total VAT (net tax payable)
  // eBay-only: 2026-05 schema replaces the old "promo as % of SP" model with
  // an operator-entered Marketing line + its own VAT.
  marketing?: number;            // eBay: operator-entered marketing/promo £
  marketingVat?: number;         // eBay: Marketing * 20%
  // BM-only: flat customer care fee per sale.
  customerCareFees?: number;     // BM: flat £9.99
  /** BM-only: Payment Seller Fee, SP × 1%. Deducted from GP, and it is NOT a
   *  VAT line — it does not appear in Total VAT NTP. */
  psf?: number;
  /** Temu-only: Commission + Commission VAT, the client's own column. Purely
   *  the sum of the two cells beside it; kept so the grid can show what the
   *  sheet shows rather than making the operator add them up. */
  commissionPlusVat?: number;
  // Operator-flagged: zero-rate this sale's postage VAT (e.g. zero-rated
  // export / VAT-exempt shipping label). When true, P. VAT = 0 and every
  // downstream field that depends on it (Total VAT, GP, Total VAT NTP)
  // recomputes accordingly. Stored alongside `postageVat` so re-displays
  // and re-exports preserve the operator's choice.
  postageVatExempt?: boolean;
  postage: number;
  grossProfit: number;
  gpPercent: number;
  netProfit?: number;            // eBay incl. promo
  comments?: string;
  // Void / return reversal — set when the linked unit goes through the
  // Returns flow. The sale doc is preserved for audit, but every Sell-side
  // surface filters it out so revenue, GP and Avg GP% reflect only what
  // actually stuck. If the unit is later re-sold a new Sale doc is written;
  // this one stays voided in the audit trail.
  voidedAt?: string;     // ISO date when the sale was reversed
  voidReason?: string;   // From ProcessReturnModal (return reason)
  /** Customer-facing outcome snapshotted at void time. Canonical signal
   *  for "what kind of return was this?" — lives on the immutable Sale
   *  doc so downstream surfaces don't have to chase the unit's mutable
   *  returnType (which ReadyToShipModal overwrites at repair completion,
   *  silently re-classifying historical voids as refunds — see QA round 3
   *  BUG-RP-002). Drives the Postage Loss column on the downloaded
   *  SALES_REPORT:
   *    'refund'      → 2 shipping legs lost
   *    'replacement' → 3 shipping legs lost
   *    'repair'      → 2 shipping legs lost (outbound + inbound; unit kept and fixed)
   *  Defaults to refund (2) for legacy voids missing the field. */
  voidOutcome?: 'refund' | 'replacement' | 'repair';
  /** Did the customer get their money back on this return?
   *
   *  Voiding a sale strips its revenue from every Sell-side surface. That is
   *  right for a refund and wrong for the two routes where the money stays
   *  paid: a replacement (the customer keeps what they paid and receives a
   *  handset) and a repair after the warranty refund window. Without this
   *  flag the report deleted revenue the business had actually kept.
   *
   *  Absent on returns processed before the correction — see gpBasis. */
  customerRefunded?: boolean;
  /** Which profit basis this return was recorded under.
   *
   *  'returns_v2' returns have their gross profit zeroed on the marketplace
   *  tab when customerRefunded is true, so the row reads as the loss it is
   *  instead of showing the profit the sale would have made. Returns without
   *  this field keep the original behaviour, which is what "apply the
   *  correction from today onward" means in practice: the cutoff is stamped
   *  on the data, not inferred from a deploy date. */
  gpBasis?: 'returns_v2';
  // Operator's red-row flag from the source workbook — when the DATE / ORDER
  // NUMBER cell was painted red on the operator's Sales Report sheet, that
  // row carries an issue (return, refund, chargeback, dispute). Surfaced in
  // every Sales view with a red highlight so the operator's signal is
  // preserved through import → Firestore → UI.
  flagged?: boolean;
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
  vatPct?: number;                   // 20 (OnBuy margin; eBay fees; Amazon VAT-on-fees)
  promoPct?: number;                 // eBay 5
  // Amazon-only line-level VAT / DSF / accessory rates. Defaults baked in
  // platforms.ts; broken out into the type so the Firestore loader can
  // override them per-marketplace without touching the calculator.
  commissionBase?: 'sp' | 'spMinusBp';  // 'spMinusBp' for Amazon (7% of margin); 'sp' for everyone else
  dsfPct?: number;                   // Amazon DSF = Commission * 2%
  /** PACKAGING cost, £ — flat £1 per sale row. See Sale.accessoryFee. */
  accessoryFee?: number;
  customerCareFees?: number;         // BM flat customer-care charge (£9.99)
  /** BM Payment Seller Fee, % of SP. New on the client's 14-Aug-2026 report:
   *  the PSF column there is `=I2*1%` on every row, I being SP — so "1% of
   *  the total sale value" means the sale price, not sale price plus postage. */
  psfPct?: number;
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
 * AccessoryStock — quantity-pool inventory for items that never carry an
 * IMEI or serial at all (chargers, SIM eject pins, cables). Unlike
 * InventoryUnit (one doc per physical, individually-identified device),
 * one AccessoryStock doc represents an entire SKU: `quantity` units are
 * added at Add Stock and decremented by a sale's own `quantity` when a
 * matching no-IMEI sale row is imported. Doc id = slugified `sku`.
 */
export interface AccessoryStock {
  id: string;
  sku: string;
  name: string;           // display name, e.g. "USB-C 20W Charger"
  supplierId?: string;
  supplierName?: string;
  quantity: number;       // units currently in stock
  /** Cumulative units ever added to this pool (Add Stock top-ups), never
   *  decremented by a sale. This is what the Inventory Report exports and
   *  restores on re-import — `quantity` itself is NOT exported, since a
   *  wipe + re-upload replays every historical sale via the Sales Report
   *  (same as regular units), which nets totalReceived back down to the
   *  correct current quantity. Falls back to `quantity` for docs created
   *  before this field existed. */
  totalReceived?: number;
  buyPrice: number;       // BP per unit
  notes?: string;
  ownerId: string;
  createdAt: any;
  updatedAt?: any;
}

export type AccessoryEventType = 'topup' | 'sale' | 'adjustment' | 'return' | 'restore';
export type AccessoryEventSource = 'sales_report_import' | 'manual';

/**
 * AccessoryStockEvent — one ledger row per change to an AccessoryStock
 * pool's `quantity`. AccessoryStock itself only ever carries the CURRENT
 * total, same as a bank balance; this is the transaction history behind
 * it, giving every stock movement its own referenceable id — the same
 * "why did this number change" traceability InventoryUnit gets for free
 * from its IMEI, which a quantity pool has no equivalent of.
 *
 * Deliberately per-TRANSACTION, not per-physical-item: chargers/cables/SIM
 * pins have no identifier of any kind to hang a per-unit id on (that's the
 * whole reason AccessoryStock is a pool rather than one InventoryUnit doc
 * per item — see AccessoryStock above). Serialising individual items would
 * invent an id that maps to nothing physical; a ledger row per event gives
 * the same traceability without that fiction.
 *
 * Reconciliation note: only `type: 'topup'` (via totalReceived) and real
 * `sales`-collection rows (type: 'sale', source: 'sales_report_import')
 * are replayed on a wipe + re-upload — see restoreAccessoryStockFromImport
 * in inventoryService.ts. Manual sales/adjustments/returns recorded here
 * are NOT currently replayed; they live only in this ledger until a wipe.
 */
export interface AccessoryStockEvent {
  id: string;
  sku: string;
  skuId: string;          // matching AccessoryStock.id (slugified sku)
  type: AccessoryEventType;
  delta: number;           // signed change to `quantity` (+ or -)
  quantityAfter: number;
  source: AccessoryEventSource;
  orderNumber?: string;
  marketplace?: string;
  /** Required for manual adjustments; optional context elsewhere. */
  reason?: string;
  /** For a return, the id of the AccessoryStockEvent it reverses (if known). */
  refEventId?: string;
  notes?: string;
  ownerId: string;
  createdAt: any;
  createdBy?: string;
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
