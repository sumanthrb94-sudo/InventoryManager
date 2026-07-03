# Report Templates — Schema Reference

This folder contains sample upload/download templates with the exact schemas
InventoryManager expects. Use these as starting points for imports and exports.

---

## 1. INVENTORY REPORT IMPORT

**File:** `INVENTORY_REPORT_IMPORT_TEMPLATE.xlsx` (or `.csv`)
**Used by:** Master Data Import (Buy Sheet → Import)
**Format:** One row = one physical unit

### Mandatory Fields (upload will fail without these)

| Field | Column | Format | Notes |
|-------|--------|--------|-------|
| **IMEI** | A | 15-digit numeric or 10-12 char Apple serial | Primary key. Becomes Firestore doc ID. |
| **MODEL** | B | e.g. "iPhone 14 128GB" | Storage auto-parses from model string. |
| **COLOUR** | C | Black / White / Blue / etc. | Defaults to "Unknown" if blank. |
| **BP** | G | Number > 0 | Buying price. Must be greater than zero. |
| **SUPPLIER** | H | e.g. MHL / NANAK / RB | Name resolved against existing suppliers. |
| **DATE** | I | YYYY-MM-DD | Stock in date. Parsed as local midnight. |

### Optional Fields

| Field | Column | Format | Notes |
|-------|--------|--------|-------|
| GRADE | D | A / B / C / ONU / Brand New | Condition grade. |
| STORAGE | E | 64GB / 128GB / 256GB / 512GB / 1TB | Auto-extracted from MODEL if blank. |
| SIM TYPE | F | Single SIM / Dual SIM / eSIM / Dual Physical SIM | Now visible throughout app. |
| NOTES | J | Free text | Any additional notes. |
| BATCH ID | K | Any string | Groups units from same bulk order. |

### Key Rules

1. **IMEI must be unique** — duplicates are rejected with error.
2. **BP must be > 0** — zero or negative rejected.
3. **After upload:** Gap Fix 2 (Reverse Reconcile) auto-links imported units to any pre-existing orphan sales.

---

## 2. SALES REPORT IMPORT

**File:** `SALES_REPORT_IMPORT_TEMPLATE.xlsx`
**Used by:** Sales Report Import (Sell tab)
**Format:** 4 marketplace sheets — AMAZON, BM, EBAY, ONBUY

### CRITICAL: Model is NOT in the sales report

Marketplace sales reports (Amazon, BM, eBay, OnBuy) do **not** contain a Model column.
They contain **SKU** and **IMEI**. The model is resolved automatically or by the operator
in the audit completion step (see "How Model Mapping Works" below).

### Universal Mandatory Fields (all sheets)

| Field | Format | Notes |
|-------|--------|-------|
| **Date** | YYYY-MM-DD or Excel date | Sale date. |
| **Order Number** | String | Marketplace order ID. |
| **SKU** | String | Product SKU code (e.g. "ASI-IP14-128-BK-A"). |
| **IMEI** | 15-digit numeric | Links sale to inventory unit. |
| **Supplier** | String | For GP attribution. |
| **BP** | Number > 0 | Buying price. |
| **SP** | Number > 0 | Selling price. |

### Per-Sheet Differences

#### AMAZON Sheet (15 columns)
Date, Order Number, SKU, IMEI, Supplier, Quantity, BP, SP, SP-BP, Marginal Tax, Commission, Postage, GP, GP%, Comments

#### BM Sheet (17 columns)
+ **Payment Mode** — PayPal / Klarna / Clear Pay
+ **PayPal/Klarna Com** — Platform fee amount

#### EBAY Sheet (19 columns)
+ **ROF** — Reserve Out Fee
+ **FVF** — Final Value Fee
+ **0.2** — eBay commission rate
+ **T.COM** — Trend Commission
+ **Shipping** — Shipping tier (1 / 2 / 8)
+ **NP** — Net Profit (computed)

#### ONBUY Sheet (15 columns)
**NO Quantity column.** BP at position 5, SP at position 6. Quantity defaults to 1.

### How Model Mapping Works (No Model Column in Sales Report)

```
SALES REPORT (has IMEI + SKU, does NOT have MODEL)
        |
        |---> IMEI found in inventory? ----> YES: Model auto-pulled from unit
        |                                          Unit flipped to 'sold'
        |
        |---> IMEI NOT in inventory? ------> NO: Orphan sale
        |                                                  |
        |                                                  v
        |                                           AUDIT COMPLETION PANEL
        |                                           Operator MUST fill:
        |                                           - Model (searchable DeviceComboBox)
        |                                           - Supplier
        |                                           - BP
        |                                           - Colour (optional)
        |                                           - Storage (optional)
        |                                           - Office vs SHS
        |                                                  |
        |                                                  v
        |                                           addSoldUnitFromSale() creates
        |                                           new inventory unit + marks sold
        |
        |---> SKU hint: "ASI-IP14-128-BK-A" --> normalizeOperatorSku() --> "iPhone 14 128GB"
              (seeds the DeviceComboBox search, but operator MUST confirm)
```

**The audit panel enforces strict mode** — no free text. The operator must pick a model from the searchable device catalog. Confirm is **hard-blocked** until every orphan row has model + supplier + BP filled. This ensures no SKU codes leak into the inventory database.

### Orphan Prevention (3-Layer Gate)

| Layer | What Happens |
|-------|-------------|
| **Layer 1: Parser** | Invalid rows skipped, multi-IMEI cells expanded to separate Sale docs |
| **Layer 2: Audit Block** | Confirm disabled until ALL orphan rows have model + supplier + BP filled |
| **Layer 3: Post-Import Sync** | Matching units flipped to 'sold'. Sale docs linked. Stale combined docs deleted. |

### Composite Sale ID Format

```
AMAZON__026-6081380-8104355__351554748581221
^^^^^^^^  ^^^^^^^^^^^^^^^^^^^  ^^^^^^^^^^^^^^^
market    order number         IMEI (discriminator)
```

One doc per physical unit. Prevents 3-phone orders from collapsing into 1 sale doc.

---

## 3. RETURNS REPORT

**File:** `RETURNS_REPORT_TEMPLATE.xlsx` (or `.csv`)
**Used by:** Returns Page (export download)
**Format:** One row = one processed return

### All Fields (10 columns)

| # | Field | Source | Editable |
|---|-------|--------|----------|
| 1 | Return Date | Set on Process Return | No |
| 2 | IMEI | Inventory unit | No |
| 3 | Model | Inventory unit | No |
| 4 | Storage | Inventory unit | No |
| 5 | Colour | Inventory unit | No |
| 6 | Supplier | Inventory unit | No |
| 7 | BP | buyPrice snapshot | No |
| 8 | Type | returnType field | No |
| 9 | Reason | returnReason | Admin only |
| 10 | Notes | returnComments | Admin only |

### Return Type Values

| Type | What Happens | Postage Loss |
|------|-------------|-------------|
| **To Inventory** | Unit restored to available stock. Can re-sell. | 2 legs |
| **In Repair** | Unit sent for repair. Use "Ready to Ship" to restore. | 2 legs |
| **To Supplier** | Soft-delete. Doc preserved for audit. | 2 legs |

### Replacement Route

If outcome = "Replacement":
1. Operator picks replacement unit from available stock (same brand + model + storage)
2. Original unit: returned
3. Replacement unit: marked as sold, inherits sale data
4. Cross-linked: `replacedByUnitId` / `replacementForUnitId`
5. Postage loss: **3 legs** (outbound + inbound + replacement outbound)

---

## Quick Reference: Mandatory Field Matrix

| Flow | IMEI | Model | BP | Supplier | Date | Order# | SKU | SP |
|------|------|-------|-----|----------|------|--------|-----|-----|
| Inventory Import | Yes | Yes | Yes | Yes | Yes | — | — | — |
| Sales Import | Yes | **Audit** | Yes | Yes | Yes | Yes | Yes | Yes |
| Returns (UI) | Yes | — | — | — | Yes | — | — | — |

Yes = Mandatory  ·  **Audit** = Filled in audit panel (not in upload file)  ·  — = Not applicable

---

## Schema Alignment: Import → App → Export

```
INVENTORY IMPORT          APP FIELD              INVENTORY REPORT EXPORT
-----------------         ---------              -----------------------
IMEI column      --------> id / imei    --------> IMEI column
MODEL column     --------> model        --------> Model column
COLOUR column    --------> colour       --------> Colour column
GRADE column     --------> grade        --------> Grade column
STORAGE column   --------> storage      --------> Storage column
SIM TYPE column  --------> simType      --------> SIM Type column  (NEW)
BP column        --------> buyPrice     --------> BP column
SUPPLIER column  --------> supplierName --------> Supplier column
DATE column      --------> dateIn       --------> Stock In Date column
NOTES column     --------> notes        --------> Notes column

SALES IMPORT:
  - Model is NOT in the upload file
  - Auto-pulled from inventory unit (IMEI match), OR
  - Filled by operator in audit panel (DeviceComboBox picker)
  - SKU gives a hint via normalizeOperatorSku() but MUST be confirmed
```

---

*Templates generated: 2026-07-03*
*Branch: claude/map-imei-inventory-DZ8Hi*
