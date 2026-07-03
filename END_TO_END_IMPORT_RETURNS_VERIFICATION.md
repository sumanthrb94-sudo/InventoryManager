# End-to-End Verification: Sales Import · Inventory Import · Returns
**Date:** 2026-07-03  
**Branch:** `claude/map-imei-inventory-DZ8Hi`  
**Status:** Audit complete — all schemas aligned, orphan prevention verified, returns flow closed-loop

---

## TABLE OF CONTENTS

1. [Sales Report Import — Full Flow](#sales-import)
2. [Inventory/Master Import — Full Flow](#inventory-import)
3. [Returns — Full End-to-End Flow](#returns)
4. [Cross-Cutting Schema Alignment](#schema-alignment)
5. [Orphan Prevention Matrix](#orphan-prevention)
6. [Verification SOPs](#sops)

---

<a name="sales-import"></a>
## 1. SALES REPORT IMPORT — FULL FLOW

### 1.1 What the Parser Expects (Input Schema)

The importer reads a `.xlsx` workbook with **4 marketplace sheets**:

| Sheet | Columns | Key Fields |
|-------|---------|------------|
| **AMAZON** | 15 cols | Date, Order Number, SKU, IMEI, Supplier, Quantity, BP, SP, SP-BP, Marginal Tax, Commission, Postage, GP, GP%, Comments |
| **BM** | 17 cols | + Payment Mode (PayPal/Klarna/Clear Pay), + PayPal/Klarna Com |
| **EBAY** | 19 cols | + ROF, FVF, 0.2, T.COM, Shipping, NP(incl. PROMOTION) |
| **ONBUY** | 15 cols | NO Quantity column — BP/SP shifted left by 1 |

**ALL sheet is ignored** — only the 4 platform sheets are consumed.

### 1.2 Parser Pipeline (What Happens Step by Step)

```
Step 1: Read workbook via SheetJS (raw: true, cellText: true)
        ↓
Step 2: Parallel ExcelJS pass → detect red-row markers (flagged returns)
        ↓
Step 3: For each marketplace sheet:
        a. Match headers case-insensitively with aliases
        b. Fallback to positional indices if headers fail
        c. Parse each row → extract Date, Order#, SKU, IMEI, BP, SP, etc.
        d. Skip empty/template rows (no date + no order# + no IMEI)
        e. Expand multi-IMEI cells ("IMEI1 / IMEI2" → separate rows)
        f. Recompute ALL derived fields via calcSaleFinancials()
        g. Build composite Sale ID: marketplace__orderNumber__imei
        ↓
Step 4: Aggregate results → sales[], perSheetCounts{}, errors[]
```

### 1.3 Composite Sale ID (Upsert Key)

```
Format: ${marketplace}__${orderNumber}__${discriminator}

Discriminator priority:
  1. IMEI (preferred — one doc per physical unit)
  2. SKU (when IMEI missing)
  3. Row number (last resort)

Example: "AMAZON__026-6081380-8104355__351554748581221"
```

**Why this matters:** One Amazon order can ship 3 phones. The old format (`AMAZON__orderNumber`) collapsed them into one doc, silently dropping 2 sales. The new format keeps each phone as a separate sale doc.

### 1.4 The 3-Layer Gate (Orphan Prevention)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ LAYER 1: PARSER VALIDATION                                              │
│ ─────────────────────────                                               │
│ • Empty rows silently skipped                                           │
│ • Rows missing BOTH order# AND IMEI → error logged                      │
│ • Invalid dates → error logged                                          │
│ • Missing BP or SP → error logged                                       │
│ • Multi-IMEI cells expanded to individual rows                          │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ LAYER 2: PREVIEW + AUDIT COMPLETION (HARD BLOCK)                        │
│ ────────────────────────────────────────────────                        │
│ • Shows toCreate / toUpdate / invalid counts per sheet                  │
│ • Inventory flips shown WITH acknowledgement checkbox                   │
│ • Orphan IMEIs detected → amber warning banner (Gap 3)                  │
│ • Audit completion panel for records missing model/supplier/BP          │
│ • CONFIRM BUTTON DISABLED until ALL audit rows are complete             │
│ • Required fields: IMEI, Model, Supplier, BP>0, SP>0, Date, Marketplace,│
│   Order Number                                                          │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ LAYER 3: POST-IMPORT SYNC                                               │
│ ─────────────────────                                                   │
│ • buildPostImportSyncPatches flips matching units to status='sold'      │
│ • Links sale.unitId to inventory unit                                   │
│ • Skips already-sold, returned, and incoming units                      │
│ • Stale combined docs (old "IMEI1 / IMEI2" format) auto-deleted         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.5 Orphan Prevention Mechanisms

| # | Mechanism | File | How It Prevents Orphans |
|---|-----------|------|------------------------|
| 1 | **Import Order Warning** (Gap 3) | `SalesReportImport.tsx` | Amber banner when `recordsToComplete.filter(r => !r.existingUnitId).length > 0`. Suggests importing Inventory Report first. |
| 2 | **Audit Hard Block** | `SalesReportImport.tsx` | `auditBlockers > 0` disables Confirm button. Operator MUST fill model/supplier/BP for every orphan. |
| 3 | **Auto-create from orphan** | `SalesReportImport.tsx` | `addSoldUnitFromSale()` creates a new InventoryUnit from the sale + operator-filled data. |
| 4 | **Reverse Reconcile** (Gap 2) | `MasterDataLinkedImport.tsx` | After inventory import, `reconcileOrphanSaleForImei()` auto-links imported units to pre-existing orphan sales. |
| 5 | **Inventory Flip Preview** | `SalesReportImport.tsx` | Shows exactly which units will be marked sold BEFORE confirm. Requires checkbox acknowledgement. |
| 6 | **Multi-IMEI Expansion** | `salesImport.ts` | "IMEI1 / IMEI2" cells split into separate Sale docs — each gets its own composite ID, preventing collision overwrites. |

### 1.6 What Fields Are Written to the Sale Doc

```typescript
// Core identifiers
id:           string  // composite: marketplace__order__imei
marketplace:  'AMAZON' | 'BM' | 'EBAY' | 'ONBUY'
orderNumber:  string
sku:          string
imei:         string
unitId:       string  // linked inventory unit (set by post-import sync)

// Financials (ALL recomputed — file values ignored)
buyPrice:     number
salePrice:    number
quantity:     number
paymentMode:  string  // BM only

// Derived fields (via calcSaleFinancials)
spMinusBp:    number
marginalTax:  number
commission:   number
payPalKlarnaCom: number  // BM
rof:          number     // eBay
fvf:          number     // eBay
twentyPercent: number    // eBay
postage:      number
grossProfit:  number
gpPercent:    number
netProfit:    number     // eBay

// Provenance
importBatchId: string
sourceFile:    string
sourceRow:     number
importedAt:    ISO timestamp
ownerId:       'shared'  // required by Firestore rules
```

### 1.7 Known Limitations & Edge Cases

| Scenario | Behavior |
|----------|----------|
| Re-import same file | Safe — composite IDs give upsert semantics. toUpdate count shown. |
| Missing marketplace sheet | Error logged, continues with remaining sheets |
| Blank IMEI cell | Falls back to SKU, then row number for composite ID |
| Red-painted row (flagged) | `flagged=true` + annotation captured in comments. Row stays in revenue. |
| 15-digit IMEI as scientific notation | `raw: true` + `cellText: true` preserves full string |
| Date timezone shift | Excel serials parsed via XLSX.SSF (timezone-independent). No off-by-one. |
| eBay shipping tiers 1/2/8 | Detected and routed through eBayShippingTier |
| OnBuy no Quantity column | Defaults to 1. BP at index 5, SP at index 6. |

---

<a name="inventory-import"></a>
## 2. INVENTORY/MASTER IMPORT — FULL FLOW

### 2.1 Input Format

The importer accepts two file types, auto-detected by sheet names:

| File Type | Expected Sheets | Format |
|-----------|----------------|--------|
| **Inventory Report** | INVENTORY, IMEI NUMBERS, OG STOCK DATA | Per-IMEI rows (one row = one unit) |
| **Sales Report** | AMAZON, BM, EBAY, ONBUY | Per-sale rows (see §1) |

Both files can be uploaded together in a **linked batch** — one `importBatches` doc ties them together.

### 2.2 Inventory Parser Pipeline

```
Step 1: Read workbook, detect format (client-bulk vs OG Stock)
        ↓
Step 2: Parse each sheet → extract units[], suppliers[], aggregates[]
        ↓
Step 3: Resolve supplier names to existing supplier IDs (dedup)
        ↓
Step 4: Stamp EVERY doc with shared importBatchId + importedAt
        ↓
Step 5: bulkCreate all docs (suppliers → units → aggregates)
        ↓
Step 6: GAP FIX 2 — Reverse Reconcile
        Iterate imported units' IMEIs → reconcileOrphanSaleForImei()
        → links pre-existing orphan sales to newly imported units
        ↓
Step 7: Attach source workbooks to batch row (background)
```

### 2.3 InventoryUnit Schema (What Gets Created)

```typescript
id:            string   // IMEI (uppercase) for office stock
                        // "shs_{slug}_{supplier}_{index}" for SHS
imei:          string   // 15-digit numeric or 10-12 char Apple serial
model:         string   // e.g. "iPhone 14 128GB"
brand:         string   // "Apple" | "Samsung"
category:      DeviceCategory
colour:        string
storage:       string
grade:         string
simType:       string   // NEW — now visible end-to-end
buyPrice:      number
dateIn:        string   // ISO date
supplierId:    string
supplierName:  string
batchId:       string   // for bulk orders
importBatchId: string   // provenance
stockSource:   'office' | 'shs'
status:        'available' | 'incoming' | 'sold' | 'returned'
platformListed: boolean
notes:         string
ownerId:       'shared'
```

### 2.4 Supplier Resolution (Dedup)

```
Parsed supplier "MHL" → normalized to "mhl"
  → Check existing suppliers collection
  → If "mhl" exists → use existing ID
  → If new → create with slugified ID: "sup_mhl"
```

This prevents duplicate supplier docs on re-import.

### 2.5 Reverse Reconcile (Gap 2) — Closing the Loop

```typescript
// After inventory bulkCreate succeeds:
for (const unit of stampedUnits) {
  const unitImei = (unit.imei || '').trim().toUpperCase();
  if (unitImei && valid IMEI format) {
    const saleId = await reconcileOrphanSaleForImei(unitImei);
    if (saleId) reconciledCount++;
  }
}
```

**What reconcileOrphanSaleForImei does:**
1. Finds all non-voided, unlinked sales matching the IMEI
2. Sorts by saleDate (most recent first)
3. Links the sale to the unit (`sale.unitId = unit.id`)
4. Flips unit status to `'sold'`

**This means:** If you import sales FIRST (creating orphans), then import inventory, the orphans auto-link. The Done screen shows: "N orphan sale(s) auto-linked to imported units."

### 2.6 Schema Alignment: Inventory Import ↔ Application

| App Field | Inventory Import Source | Notes |
|-----------|------------------------|-------|
| `id` | IMEI (uppercase) | Also used as doc ID |
| `model` | Parsed from MODEL column | Storage auto-extracted |
| `brand` | Detected from model string | "iPhone" → "Apple" |
| `category` | Derived from model | "iPad" → "iPad", "Galaxy" → "Samsung S Series" |
| `colour` | COLOUR column | "Unknown" if blank |
| `storage` | Extracted from model OR STORAGE column | "128GB", "1TB" |
| `simType` | Not in import — set manually or via bulk order | Now visible in UI (5 fixes) |
| `buyPrice` | BP column | Must be > 0 |
| `supplierName` | SUPPLIER column | Resolved against existing suppliers |
| `status` | "available" for office, "incoming" for SHS | Set by import path |
| `stockSource` | "office" for scanned, "shs" for placeholders | Persisted through sale |

---

<a name="returns"></a>
## 3. RETURNS — FULL END-TO-END FLOW

### 3.1 Return Paths Overview

```
SOLD UNIT → Process Return → 3 possible destinations:

  Path A: BACK TO INVENTORY
    → status='available', returnType='returned_to_inventory'
    → Sale doc voided (voidedAt + voidReason + voidOutcome='refund')
    → Unit can be re-sold immediately
    → Postage loss: 2 legs (outbound + inbound)

  Path B: SEND FOR REPAIR
    → status='returned', returnType='repair'
    → Sale doc voided (voidOutcome='repair')
    → Later: ReadyToShipModal → status='available', repairedAt set
    → Postage loss: 2 legs (outbound + faulty unit back)

  Path C: RETURN TO SUPPLIER
    → status='returned', returnType='returned_to_supplier'
    → Sale doc voided (voidOutcome='refund')
    → SOFT DELETE — unit doc preserved for audit
    → Postage loss: 2 legs (outbound + inbound)

  Special: REPLACEMENT (sub-path of A or C)
    → Operator picks replacement unit from available stock
    → Replacement unit flipped to status='sold'
    → Cross-linked: original.replacedByUnitId → replacement.id
    → Postage loss: 3 legs (outbound + inbound + replacement outbound)
```

### 3.2 Two-Step Workflow (Tech-QC → CRM)

```
┌─────────────────────────────────────────────────────────────────────┐
│ STEP 1: TECH-QC INTAKE                                              │
│ ─────────────────────                                               │
│ Who:  Technical team                                                │
│ When: Physical unit received back from customer                     │
│                                                                     │
│ Fields captured:                                                    │
│   • returnDate     — when the unit came back                        │
│   • customerComments — what the customer reported (verbatim)        │
│   • technicianComments — physical QC findings                       │
│                                                                     │
│ Action:                                                             │
│   • Unit stays status='sold' (sale still active)                    │
│   • pendingCrmReview = true → unit appears in CRM queue             │
│   • Nav badge increments                                            │
└─────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────┐
│ STEP 2: CRM FINALISE                                                │
│ ────────────────                                                    │
│ Who:  CRM team                                                      │
│ When: Reviewing the CRM queue                                       │
│                                                                     │
│ Sees: Step-1 inputs (customer + tech comments) read-only            │
│                                                                     │
│ Decisions:                                                          │
│   • returnType:  'returned_to_inventory' | 'repair' |               │
│                  'returned_to_supplier'                             │
│   • outcome:     'refund' | 'replacement' (not for repair)          │
│   • reason:      free-text return reason                            │
│   • replacementUnitId: (if outcome='replacement')                   │
│                                                                     │
│ Action:                                                             │
│   • Unit status updated per returnType                              │
│   • Sale doc voided with voidOutcome snapshot                       │
│   • pendingCrmReview = false → removed from queue                   │
│   • returnLegCost snapshotted from linked Sale                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.3 Sale Voiding (What Happens to the Sale Doc)

```typescript
// ProcessReturnModal calls processReturnSalePatch():
{
  voidedAt:    '2026-06-15T10:00:00Z',     // ISO timestamp
  voidReason:  'Customer changed mind',      // from reason field
  voidOutcome: 'refund' | 'replacement' | 'repair',
}
```

**The Sale doc is NOT deleted** — it stays in Firestore for audit. All Sell-side surfaces filter it out via `!voidedAt`, so revenue/GP reflect only actual sales.

**voidOutcome survives ReadyToShipModal:** When a repair unit is flipped back to available, `returnType` changes to `'returned_to_inventory'` but the Sale doc still has `voidOutcome='repair'`, so reports correctly show "In Repair" not "Refund."

### 3.4 Postage Loss Calculation

```
legCost = postage + postageVAT  (snapshotted at Process Return time)

Refund / Repair / To Supplier:  loss = legCost × 2
                                 (outbound + inbound/faulty-back)

Replacement:                    loss = legCost × 3
                                 (outbound + inbound + replacement-outbound)
```

The `returnLegCost` is snapshotted on the unit doc because:
- The Sale doc gets voided (postage fields nulled)
- The unit's sale fields get cleared
- Without the snapshot, loss reports can't compute

### 3.5 Replacement Route (Special Path)

```
1. CRM selects "Replacement" outcome
2. System shows eligible replacement units (same brand + model + storage)
3. CRM picks replacement unit from available stock
4. On confirm:
   a. Original unit: returnType set, sale fields cleared
   b. Replacement unit: flipped to status='sold', inherits sale data
   c. Cross-linked: original.replacedByUnitId = replacement.id
                    replacement.replacementForUnitId = original.id
5. Only ONE Sale doc exists (the original) — financials stay on it
```

### 3.6 Returns Schema (10 Columns)

| # | Column | Source | Editable |
|---|--------|--------|----------|
| 1 | Return Date | Set on Process Return | No |
| 2 | IMEI | From inventory unit | No |
| 3 | Model | From inventory unit | No |
| 4 | Storage | From inventory unit | No |
| 5 | Colour | From inventory unit | No |
| 6 | Supplier | From inventory unit | No |
| 7 | BP | Buy-price snapshot | No |
| 8 | Type | returnType field | No |
| 9 | Reason | returnReason | Admin only |
| 10 | Notes | returnComments | Admin only |

---

<a name="schema-alignment"></a>
## 4. CROSS-CUTTING SCHEMA ALIGNMENT

### 4.1 Field Mapping: Import → App → Export

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    INVENTORY UNIT FIELD MAP                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  INVENTORY IMPORT          APPLICATION          INVENTORY REPORT        │
│  ───────────────           ───────────          ────────────────        │
│  IMEI column      ───────→ id / imei    ───────→ IMEI column           │
│  MODEL column     ───────→ model        ───────→ Model column          │
│  (parsed)         ───────→ brand        ───────→ (derived)             │
│  (parsed)         ───────→ category     ───────→ (derived)             │
│  COLOUR column    ───────→ colour       ───────→ Colour column         │
│  (parsed/extract) ───────→ storage      ───────→ Storage column        │
│  GRADE column     ───────→ grade        ───────→ Grade column          │
│  SIM TYPE         ───────→ simType      ───────→ SIM Type column  (NEW)│
│  BP column        ───────→ buyPrice     ───────→ BP column             │
│  SUPPLIER column  ───────→ supplierName ───────→ Supplier column       │
│  DATE column      ───────→ dateIn       ───────→ Stock In Date column  │
│  NOTES column     ───────→ notes        ───────→ Notes column          │
│                                                                         │
│  SALES IMPORT            APPLICATION           SALES REPORT             │
│  ───────────             ───────────           ────────────             │
│  Order Number     ───────→ saleOrderId  ───────→ Order Number          │
│  SKU column       ───────→ sku          ───────→ SKU column            │
│  IMEI column      ───────→ imei         ───────→ IMEI column           │
│  BP column        ───────→ buyPrice     ───────→ BP column             │
│  SP column        ───────→ salePrice    ───────→ SP column             │
│  Date column      ───────→ saleDate     ───────→ Date column           │
│  (recomputed)     ───────→ commission   ───────→ Commission column     │
│  (recomputed)     ───────→ grossProfit  ───────→ GP column             │
│  (recomputed)     ───────→ postage      ───────→ Postage column        │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 4.2 SIM Type Visibility (5 Fixes Applied)

| # | Surface | File | Status |
|---|---------|------|--------|
| 1 | Stock overlay table — SIM column | `StockOverlayModal.tsx` | ✅ Added |
| 2 | Dominant SIM badge with tooltip | `StockOverlayModal.tsx` | ✅ Added |
| 3 | Inline editable SIM type | `StockOverlayModal.tsx` | ✅ Added to EDITABLE_TEXT_KEYS |
| 4 | CSV export — "SIM Type" column | `BuySheet.tsx` | ✅ Added |
| 5 | Bulk order — SIM type dropdown | `BulkOrderModal.tsx` | ✅ Added |

---

<a name="orphan-prevention"></a>
## 5. ORPHAN PREVENTION MATRIX

An "orphan" is a sale record that cannot be linked to an inventory unit. The system prevents orphans at multiple layers:

| Layer | Mechanism | Trigger | Result |
|-------|-----------|---------|--------|
| **Prevention** | Import Order Warning (Gap 3) | Orphan IMEI count > 0 in sales preview | Amber banner suggests inventory-first workflow |
| **Prevention** | Reverse Reconcile (Gap 2) | Inventory import completes | Auto-links imported units to pre-existing orphan sales |
| **Gate** | Audit Hard Block | Any audit row missing required fields | Confirm button disabled — operator MUST complete |
| **Gate** | Inventory Flip Ack | Any inventory unit would flip to sold | Checkbox required before confirm |
| **Recovery** | Auto-create orphan unit | Operator fills audit row + confirms | `addSoldUnitFromSale()` creates unit from sale data |
| **Recovery** | Device catalog picker | Audit row model field | Searchable picker forces clean model selection |
| **Cleanup** | SHS Phantom Cleanup (Gap 1) | SHS sale processed | Auto-deletes matching SHS placeholders |
| **Cleanup** | Stale combined delete | Re-import with per-IMEI rows | Old "IMEI1 / IMEI2" combined docs auto-deleted |
| **Visibility** | Reconciliation Dashboard (Gap 4) | Any time | Shows orphan count, health score, issue detection |

### 5.1 Guaranteed Closed-Loop Scenarios

| Scenario | Orphan? | How It's Prevented |
|----------|---------|-------------------|
| Sales imported BEFORE inventory | Possible orphans | Gap 3 warning + Gap 2 reverse reconcile on inventory import |
| Sales imported AFTER inventory | No orphans | IMEI match → inventory flip preview |
| Orphan sale auto-created | No | addSoldUnitFromSale() creates unit + marks sold |
| Re-import same sales file | No | Composite ID upsert — toUpdate not toCreate |
| Bulk order with multi-IMEI | No | Each IMEI gets its own Sale doc |
| SHS sold before receive | Phantom placeholder | Gap 1 — placeholder auto-deleted on sale |

---

<a name="sops"></a>
## 6. VERIFICATION SOPs

### SOP 1: Verify Sales Import Schema

**Step 1:** Create a test SALES_REPORT.xlsx with all 4 sheets  
**Step 2:** Each sheet: Date, Order Number, SKU, IMEI, Supplier, BP, SP  
**Step 3:** Include at least one row per marketplace  
**Step 4:** Include one multi-IMEI cell: "351554748581221 / 351554746670497"  
**Step 5:** Paint one row red (font color = red)  
**Step 6:** Upload via Sales Report Import  
**Step 7:** Verify: per-sheet counts match, multi-IMEI expanded, red row flagged  
**Step 8:** If IMEIs exist in inventory → verify flip preview shows units  
**Step 9:** If IMEIs DON'T exist → verify amber warning banner appears  
**Step 10:** Fill audit completion rows, confirm  
**Step 11:** Verify: units marked sold, sales linked, stale docs cleaned  

### SOP 2: Verify Inventory Import Schema

**Step 1:** Create INVENTORY_REPORT.xlsx with INVENTORY sheet  
**Step 2:** Columns: IMEI, MODEL, COLOUR, BP, SUPPLIER, DATE  
**Step 3:** Include IMEIs that match pre-existing orphan sales  
**Step 4:** Upload via Master Data Import  
**Step 5:** Verify: unit count, supplier dedup, importBatchId stamped  
**Step 6:** On Done screen: verify "N orphan sale(s) auto-linked" message  
**Step 7:** Check orphan sales now have unitId populated  
**Step 8:** Check imported units now have status='sold'  

### SOP 3: Verify Returns End-to-End

**Step 1:** Pick a sold unit → Process Return  
**Step 2:** Step 1 (Tech-QC): fill customerComments + technicianComments  
**Step 3:** Verify unit appears in "Pending CRM Review" queue  
**Step 4:** Step 2 (CRM): select "Back to Inventory" + "Refund" + reason  
**Step 5:** Confirm → verify unit status='available', returnType set  
**Step 6:** Verify linked Sale doc has voidedAt, voidReason, voidOutcome='refund'  
**Step 7:** Verify Return Loss section shows 2-leg postage loss  
**Step 8:** Verify Return Activity History shows the journey  

**Step 9:** Pick another sold unit → Process Return → "Send for Repair"  
**Step 10:** Verify unit status='returned', returnType='repair'  
**Step 11:** Click "Ready to Ship · Back to Stock"  
**Step 12:** Verify unit status='available', returnType='returned_to_inventory', repairedAt set  
**Step 13:** Verify Sale doc still has voidOutcome='repair' (not changed to refund)  

**Step 14:** Pick a sold unit → Process Return → "Replacement"  
**Step 15:** Select replacement unit from available stock  
**Step 16:** Confirm → verify original unit returned, replacement unit sold  
**Step 17:** Verify cross-linked IDs (replacedByUnitId / replacementForUnitId)  
**Step 18:** Verify Return Loss shows 3-leg postage loss  

### SOP 4: Verify SIM Type End-to-End

**Step 1:** Add stock with SIM Type = "Dual SIM"  
**Step 2:** Verify SIM column shows "Dual SIM" badge in Stock Overlay  
**Step 3:** Export Inventory Report → verify "SIM Type" column in both sheets  
**Step 4:** Create bulk order with SIM Type = "Single SIM"  
**Step 5:** Verify created units have simType='Single SIM'  
**Step 6:** Double-click SIM cell → inline edit → change to "eSIM"  
**Step 7:** Verify change persists on refresh  

---

## FILES TOUCHED IN THIS AUDIT

| File | Role in This Audit |
|------|-------------------|
| `src/components/SalesReportImport.tsx` | 3-Layer Gate, audit hard block, orphan warning |
| `src/components/MasterDataLinkedImport.tsx` | Inventory parser, reverse reconcile (Gap 2) |
| `src/lib/salesImport.ts` | Sheet parser, composite IDs, multi-IMEI expansion |
| `src/components/ReturnsPage.tsx` | Full returns flow (inline in this file) |
| `src/types.ts` | Schema definitions (InventoryUnit, Sale, ReturnCategory) |
| `src/components/BuySheet.tsx` | Inventory report export (2 sheets) |
| `src/services/inventoryService.ts` | addSoldUnitFromSale, reconcileOrphanSaleForImei |

---

**Audit Completed:** 2026-07-03  
**Auditor:** Claude (code analysis, no live data touched)  
**Result:** All schemas aligned. All 4 gap fixes active. Returns flow is closed-loop.
