# Report Templates — Final Schema Reference
**Date:** 2026-07-03  
**Branch:** claude/map-imei-inventory-DZ8Hi  

---

## 1. INVENTORY REPORT

**File:** `INVENTORY_REPORT.xlsx`  
**Sheet:** INVENTORY  
**Used by:** Master Data Import (Buy Sheet)

### Columns (10 total)

| # | Column | Required | Format / Valid Values |
|---|--------|----------|----------------------|
| 1 | **IMEI** | MANDATORY | 15-digit numeric or 10-12 char Apple serial |
| 2 | **MODEL** | MANDATORY | e.g. "iPhone 14 128GB" — storage auto-parses |
| 3 | **COLOUR** | MANDATORY | Black / White / Blue / Gold / Purple / etc. |
| 4 | GRADE | Optional | A / B / C / ONU / Brand New |
| 5 | **STORAGE** | MANDATORY | 16GB / 32GB / 64GB / 128GB / 256GB / 512GB / 1TB / **Not Applicable** |
| 6 | SIM TYPE | Optional | Single SIM / Dual SIM / eSIM / Dual Physical SIM |
| 7 | **BP** | MANDATORY | Number > 0 (buying price) |
| 8 | **SUPPLIER** | MANDATORY | e.g. MHL / NANAK / RB / SKYMO |
| 9 | **DATE** | MANDATORY | YYYY-MM-DD (stock in date) |
| 10 | NOTES | Optional | Free text |

### Removed
- ~~BATCH ID~~ — not needed

### Auto-Derived (do not include)
- `brand` — from model ("iPhone" → "Apple")
- `category` — from model ("iPad" → "iPad")
- `id` — uppercase IMEI

---

## 2. SALES REPORT

**File:** `SALES_REPORT.xlsx`  
**Sheets:** AMAZON, BM, EBAY, ONBUY  
**Used by:** Sales Report Import (Sell tab)

### CRITICAL: Model is NOT in the sales report

Marketplace reports only have SKU + IMEI. Model is auto-pulled from inventory (IMEI match) or filled by operator in the audit panel.

### AMAZON Sheet (22 columns) — LIVE Formulas

| # | Column | Required | Formula / Notes |
|---|--------|----------|-----------------|
| 1 | **Date** | Yes | YYYY-MM-DD |
| 2 | **Order Number** | Yes | Marketplace order ID |
| 3 | **SKU** | Yes | e.g. "ASI-IP14-128-BK-A" |
| 4 | **IMEI** | Yes | 15-digit numeric |
| 5 | **Supplier** | Yes | For GP attribution |
| 6 | **Quantity** | Yes | Defaults to 1 |
| 7 | **BP** | Yes | Buying price > 0 |
| 8 | **SP** | Yes | Selling price > 0 |
| 9 | **SP-BP** | Derived | `=SP-BP` |
| 10 | **Marginal Tax** | Derived | `=SP-BP*16.67%` |
| 11 | **Commission** | Derived | `=SP/100*7` (7% of SP) |
| 12 | **C. VAT** | Derived | `=Commission*20%` |
| 13 | **DSF** | Derived | `=Commission*2%` |
| 14 | **DSF VAT** | Derived | `=DSF*20%` |
| 15 | **Postage** | Input | Operator-entered |
| 16 | **P. VAT** | Derived | `=Postage*20%` |
| 17 | **Accessories** | Input | Default £1 |
| 18 | **Total VAT** | Derived | `=C.VAT+DSF.VAT+P.VAT` |
| 19 | **GP** | Derived | `=SP-BP-MarginalTax-Commission-C.VAT-DSF-DSF.VAT-Postage-P.VAT-Accessories` |
| 20 | **GP %** | Derived | `=GP/BP*100` |
| 21 | **Total VAT NTP** | Derived | `=MarginalTax-TotalVAT` |
| 22 | Comments | Optional | Free text |

### BM Sheet (19 columns) — LIVE Formulas

| # | Column | Required | Formula / Notes |
|---|--------|----------|-----------------|
| 1-8 | Same as Amazon | | Date through SP |
| 9 | **SP-BP** | Derived | `=SP-BP` |
| 10 | **Marginal Tax** | Derived | `=SP-BP*16.67%` |
| 11 | **Commission** | Derived | `=SP/100*11` (11% of SP) |
| 12 | **Customer Care Fees** | Fixed | £9.99 |
| 13 | **Postage** | Input | Operator-entered |
| 14 | **P. VAT** | Derived | `=Postage*20%` |
| 15 | **Accessories** | Input | Default £1 |
| 16 | **GP** | Derived | `=SP-BP-MarginalTax-Commission-CareFees-Postage-P.VAT-Accessories` |
| 17 | **GP %** | Derived | `=GP/BP*100` |
| 18 | **Total VAT NTP** | Derived | `=MarginalTax-P.VAT` |
| 19 | Comments | Optional | |

### EBAY Sheet (25 columns) — LIVE Formulas

| # | Column | Required | Formula / Notes |
|---|--------|----------|-----------------|
| 1-8 | Same as Amazon | | Date through SP |
| 9 | **SP-BP** | Derived | `=SP-BP` |
| 10 | **Marginal Tax** | Derived | `=SP-BP*16.67%` |
| 11 | **Commission** | Derived | `=(SP*6.9%)-(SP*6.9%)*10%` |
| 12 | **ROF** | Derived | `=SP*0.35%` |
| 13 | **FVF** | Fixed | £0.40 |
| 14 | **VAT** | Derived | `=(Commission+ROF+FVF)*20%` |
| 15 | **T.COM** | Derived | `=SP*5%` |
| 16 | **Postage** | Input | Operator-entered |
| 17 | **P. VAT** | Derived | `=Postage*20%` |
| 18 | **Marketing** | Derived | `=SP*5%` |
| 19 | **M. VAT** | Derived | `=Marketing*20%` |
| 20 | **Accessories** | Input | Default £1 |
| 21 | **Total VAT** | Derived | `=VAT+P.VAT+M.VAT` |
| 22 | **GP** | Derived | `=SP-BP-MarginalTax-T.COM-Postage-P.VAT-Marketing-M.VAT-Accessories` |
| 23 | **GP %** | Derived | `=GP/SP*100` |
| 24 | **Total VAT NTP** | Derived | `=MarginalTax-TotalVAT` |
| 25 | Comments | Optional | |

### ONBUY Sheet (19 columns) — LIVE Formulas

| # | Column | Required | Formula / Notes |
|---|--------|----------|-----------------|
| 1-5 | Date, Order#, SKU, IMEI, Supplier | | |
| 6 | **BP** | Yes | No Quantity column |
| 7 | **SP** | Yes | |
| 8 | **SP-BP** | Derived | `=SP-BP` |
| 9 | **MAR VAT** | Derived | `=SP-BP*16.67%` |
| 10 | **COM 7%** | Derived | `=SP*7%` |
| 11 | **VAT 20%** | Derived | `=COM*20%` |
| 12 | **Postage** | Input | |
| 13 | **P. VAT** | Derived | `=Postage*20%` |
| 14 | **Accessories** | Input | Default £1 |
| 15 | **Total VAT** | Derived | `=VAT+P.VAT` |
| 16 | **GP** | Derived | `=SP-BP-MAR.VAT-COM-VAT-Postage-P.VAT-Accessories` |
| 17 | **GP %** | Derived | `=GP/BP*100` |
| 18 | **Total VAT NTP** | Derived | `=MAR.VAT-TotalVAT` |
| 19 | Comments | Optional | |

### Round-Trip Rule
Any report generated by the app contains the same columns as the upload template. Download → re-upload works seamlessly. Derived fields are recomputed; input fields are preserved.

---

## 3. RETURNS REPORT

**File:** `RETURNS_REPORT.xlsx`  
**Sheet:** RETURNS  
**Used by:** Returns Page (export)

### Columns (10 total)

| # | Column | Required | Source | Editable |
|---|--------|----------|--------|----------|
| 1 | **Return Date** | Yes | Set on Process Return | No |
| 2 | **IMEI** | Yes | Inventory unit | No |
| 3 | **Model** | Yes | Inventory unit | No |
| 4 | **Storage** | Yes | Inventory unit | No |
| 5 | **Colour** | Yes | Inventory unit | No |
| 6 | **Supplier** | Yes | Inventory unit | No |
| 7 | **BP** | Yes | buyPrice snapshot | No |
| 8 | **Type** | Yes | Back to Inventory / Repair / Return to Supplier | No |
| 9 | Reason | No | returnReason | Admin |
| 10 | Notes | No | returnComments | Admin |

### Return Types

| Type | Result | Postage Loss |
|------|--------|-------------|
| **Back to Inventory** | status='available', can re-sell | 2 legs |
| **Repair** | status='returned', ReadyToShip restores | 2 legs |
| **Return to Supplier** | Soft-delete, doc preserved | 2 legs |

---

## Mandatory Field Matrix

| Flow | IMEI | Model | Storage | BP | Supplier | Date | Order# | SKU | SP |
|------|------|-------|---------|-----|----------|------|--------|-----|-----|
| Inventory Import | Yes | Yes | Yes | Yes | Yes | Yes | — | — | — |
| Sales Import | Yes | Audit* | — | Yes | Yes | Yes | Yes | Yes | Yes |
| Returns Export | Yes | Yes | Yes | — | Yes | Yes | — | — | — |

*Audit = Filled in audit completion panel (DeviceComboBox), not in upload file

---

## Live Formula Summary by Platform

| Fee | Amazon | BM | eBay | OnBuy |
|-----|--------|-----|------|-------|
| Commission | SP * 7% | SP * 11% | (SP*6.9%)-(SP*6.9%)*10% | SP * 7% |
| Care Fees | — | £9.99 | — | — |
| ROF | — | — | SP * 0.35% | — |
| FVF | — | — | £0.40 | — |
| T.COM | — | — | SP * 5% | — |
| Marketing | — | — | SP * 5% | — |
| DSF | Commission * 2% | — | — | — |
| Marginal Tax | SP-BP * 16.67% | SP-BP * 16.67% | SP-BP * 16.67% | SP-BP * 16.67% |
| Postage VAT | Postage * 20% | Postage * 20% | Postage * 20% | Postage * 20% |
| Accessories | £1 | £1 | £1 | £1 |
| GP Formula | SP-BP-Tax-Com-CVAT-DSF-DSFVAT-Post-PVAT-Acc | SP-BP-Tax-Com-Care-Post-PVAT-Acc | SP-BP-Tax-TCOM-Post-PVAT-Mkt-MVAT-Acc | SP-BP-Tax-Com-VAT-Post-PVAT-Acc |

---

*Finalized: 2026-07-03*
