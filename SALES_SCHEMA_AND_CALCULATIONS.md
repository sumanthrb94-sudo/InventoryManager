# Sales — Schema & Calculations

Definitive reference for what a sale stores, what the Sales Report shows, and
the formula behind every line, per marketplace.

Every number below comes from a live run of
`scripts/e2eMarkSalesAllMarketplaces.mjs` — one sale marked on each of the five
marketplaces through the real UI, with all 70 assertions green. The ground
truth in that script is transcribed from the operator's master sheet and is
deliberately **not** imported from `src/lib/platforms.ts`, so a bug in the
app's calculator cannot make the test agree with itself.

---

## 1. Two schemas, and the difference that matters

### 1a. The Sale document (Firestore `sales`)

Written by `recordSale()` in `src/services/salesService.ts`.

| Field | Type | Notes |
|---|---|---|
| `id` | string | `MARKETPLACE__orderNumber__discriminator` (IMEI, else SKU, else `inapp`) — makes a re-import a natural upsert |
| `marketplace` | enum | `AMAZON` \| `BM` \| `EBAY` \| `ONBUY` \| `TEMU` |
| `orderNumber`, `sku`, `imei`, `unitId` | string | `unitId` links to `inventoryUnits` |
| `supplierId`, `supplierName` | string | |
| `saleDate` | `yyyy-mm-dd` | |
| `quantity` | number | always 1 for a unit; N for an accessory line |
| `buyPrice`, `salePrice` | number | for an accessory these are **line totals**, not per-unit |
| `paymentMode` | string | BM only |
| `storage`, `colour` | string? | buy-side identity, restored on re-import (2026-08) |
| **`spMinusBp`** | number | stored |
| **`marginalTax`** | number | stored |
| **`commission`** | number | stored |
| **`postageVat`** | number | stored |
| **`grossProfit`**, **`gpPercent`** | number | stored |
| `rof`, `fvf`, `twentyPercent`, `totalCom`, `vat20` | number | eBay / OnBuy only |
| `marVat` | number | OnBuy alias for `marginalTax` |
| `postage`, `postageVatExempt` | number / bool | |
| `voidedAt`, `voidOutcome`, `voidReason` | — | set when returned |
| `importBatchId`, `sourceFile`, `sourceRow`, `importedAt` | — | provenance |

### 1b. Fields that exist ONLY in the report

These are **never persisted**. They are recomputed at export time and written
into the workbook as live Excel formulas:

```
commissionVat · dsf · dsfVat · totalVat · totalVatNtp
accessoryFee · customerCareFees · marketing · marketingVat
```

**Why it matters:** the workbook is always correct, but nothing is pinned at
sale time. If `MARKETPLACE_FEES` in `src/lib/platforms.ts` ever changes,
**historical rows restate at the new rates** — last year's report will not
reproduce byte-for-byte. That is fine (arguably desirable) when correcting an
error, and a problem if you need an immutable record. Currently unpinned by
design; the E2E asserts this boundary so it can't drift silently.

---

## 2. The shared skeleton

Every marketplace follows the same chain. Only the fee lines in the middle differ.

```
SP − BP
  → Marginal Tax   = (SP − BP) × 16.67%
  → Commission     = SP × <rate>
  → [marketplace-specific VAT / fee lines]
  → Postage        (operator-entered)
  → P. VAT         = Postage × 20%      (0 if the line is VAT-exempt)
  → Accessories    = £1 flat
  = Gross Profit
  → GP %           = GP ÷ <BP or SP> × 100
  → Total VAT NTP  = Marginal Tax − Total VAT
```

Two conventions worth stating plainly:

- **"Accessories £1" is a FEE line**, charged on every sale of anything. It has
  nothing to do with accessory products.
- **Compute raw, round once.** Every intermediate is held at full precision and
  rounded only on output, matching Excel's "compute precise, display rounded".
  Rounding each step compounds into ~1p drift on Total VAT / GP / NTP.

---

## 3. Per marketplace

### AMAZON

Commission 7% of SP · VAT 20% · DSF 2% of commission · Accessories £1

| Line | Formula | Excel |
|---|---|---|
| SP − BP | `SP − BP` | `H2-G2` |
| Marginal Tax | `(SP−BP) × 16.67%` | `I2*16.67%` |
| Commission | `SP × 7%` | `H2/100*7` |
| C. VAT | `Commission × 20%` | `K2*20%` |
| DSF | `Commission × 2%` | `K2*2%` |
| DSF VAT | `DSF × 20%` | `M2*20%` |
| P. VAT | `Postage × 20%` | `O2*20%` |
| Total VAT | `C.VAT + DSF VAT + P.VAT` | `L2+N2+P2` |
| GP | `(SP−BP) − MarTax − Com − C.VAT − DSF − DSF VAT − Postage − P.VAT − £1` | `I2-J2-K2-L2-M2-N2-O2-P2-Q2` |
| GP % | `GP ÷ **BP** × 100` | `(S2-AB2)/G2*100` |
| Total VAT NTP | `Marginal Tax − Total VAT` | `J2-R2` |

**Worked — BP £350, SP £499.99, postage £6.30**

```
SP − BP 149.99 · MarTax 25.00 · Commission 35.00 · C.VAT 7.00
DSF 0.70 · DSF VAT 0.14 · P.VAT 1.26 · Accessories 1.00
Total VAT 8.40 → GP 73.59 → GP% 21.03 → Total VAT NTP 16.60
```

### BACK MARKET (BM)

Commission 11% of SP · Customer Care £9.99 flat · Accessories £1

| Line | Formula | Excel |
|---|---|---|
| Marginal Tax | `(SP−BP) × 16.67%` | `I2*16.67%` |
| Commission | `SP × 11%` | `H2/100*11` |
| Customer Care Fees | `£9.99` flat | literal |
| P. VAT | `Postage × 20%` | `M2*20%` |
| GP | `(SP−BP) − MarTax − Com − £9.99 − Postage − P.VAT − £1` | `I2-J2-K2-L2-M2-N2-O2` |
| GP % | `GP ÷ **BP** × 100` | `(P2-Y2)/G2*100` |
| Total VAT NTP | `Marginal Tax − P. VAT` | `J2-N2` |

> **BM has no Total VAT column.** P. VAT is its only VAT line, so NTP subtracts
> P. VAT directly. Asserted by the E2E.

**Worked — BP £300, SP £449.99, postage £6.30**

```
SP − BP 149.99 · MarTax 25.00 · Commission 49.50 · Care 9.99
P.VAT 1.26 · Accessories 1.00 → GP 56.94 → GP% 18.98 → NTP 23.74
```

### EBAY

Commission 6.21% (6.9% less a 10% reduction) · ROF 0.35% · FVF £0.40 flat ·
Marketing 5% of SP · Accessories £1

| Line | Formula | Excel |
|---|---|---|
| Marginal Tax | `(SP−BP) × 16.67%` | `I2*16.67%` |
| Commission | `SP × 6.21%` | `(H2*6.9%)-(H2*6.9%)*10%` |
| ROF | `SP × 0.35%` | `H2*0.35%` |
| FVF | `£0.40` flat | literal |
| VAT | `(Com + ROF + FVF) × 20%` | `(K2+L2+M2)*20%` |
| T.COM | `Com + ROF + FVF + VAT` | `K2+L2+M2+N2` |
| Marketing | `SP × 5%` | `H2*5%` |
| M. VAT | `Marketing × 20%` | `R2*20%` |
| Total VAT | `VAT + P.VAT + M.VAT` | `N2+Q2+S2` |
| GP | `(SP−BP) − MarTax − T.COM − Postage − P.VAT − Marketing − M.VAT − £1` | `I2-J2-O2-P2-Q2-R2-S2-T2` |
| GP % | `GP ÷ **SP** × 100` | `(V2-AE2)/H2*100` |

**Worked — BP £280, SP £429.99, postage £0**

```
SP − BP 149.99 · MarTax 25.00 · Commission 26.70 · ROF 1.50 · FVF 0.40
VAT 5.72 · T.COM 34.33 · Marketing 21.50 · M.VAT 4.30 · Accessories 1.00
Total VAT 10.02 → GP 63.86 → GP% 14.85 (÷SP) → NTP 14.98
```

### ONBUY

Commission 7% of SP · VAT 20% on the commission · Accessories £1

| Line | Formula | Excel |
|---|---|---|
| Marginal Tax | `(SP−BP) × 16.67%` | `H2*16.67%` |
| Commission | `SP × 7%` | `G2*7%` |
| VAT 20% | `Commission × 20%` | `J2*20%` |
| P. VAT | `Postage × 20%` | `L2*20%` |
| Total VAT | `VAT 20% + P.VAT` | `K2+M2` |
| GP | `(SP−BP) − MarTax − Com − VAT20 − Postage − P.VAT − £1` | `H2-I2-J2-K2-L2-M2-N2` |
| GP % | `GP ÷ **BP** × 100` | `(P2-Y2)/F2*100` |

> OnBuy has **no Quantity column**, so every column letter sits one to the left
> of the other tabs. `VAT 20%` is VAT on the *commission*, not on the margin.

**Worked — BP £260, SP £399.99, postage £6.30**

```
SP − BP 139.99 · MarTax 23.34 · Commission 28.00 · VAT20 5.60
P.VAT 1.26 · Accessories 1.00 → Total VAT 6.86 → GP 74.49 → GP% 28.65 → NTP 16.48
```

### TEMU

Commission from Temu's own export (7% fallback) · Commission VAT tracked but
excluded · Accessories £1

| Line | Formula | Excel |
|---|---|---|
| Marginal Tax | `(SP−BP) × 16.67%` | `I2*16.67%` |
| Commission | the export's own value; `SP × 7%` only as fallback | literal cell |
| Commission VAT | the export's own value | literal cell |
| P. VAT | `Postage × 20%` | `M2*20%` |
| Total VAT | `P. VAT` **alone** | `N2` |
| GP | `(SP−BP) − MarTax − Com − Postage − P.VAT − £1` | `I2-J2-K2-M2-N2-O2` |
| GP % | `GP ÷ **BP** × 100` | `(Q2-Z2)/G2*100` |

> **Commission VAT is excluded from both Total VAT and GP.** Temu VAT-invoices
> it to the seller as reclaimable input tax. Confirmed against the client's own
> export: Total VAT equals P. VAT alone, and GP only reconciles when Commission
> VAT is left out of the subtraction. Temu's rate varies by category, so the
> sheet's own figure always wins over the 7% fallback.

**Worked — BP £240, SP £379.99, postage £6.30**

```
SP − BP 139.99 · MarTax 23.34 · Commission 26.60 · Commission VAT 5.32 (excluded)
P.VAT 1.26 · Accessories 1.00 → Total VAT 1.26 → GP 81.49
```

---

## 4. Three traps

1. **GP % base differs.** `GP ÷ BP` on Amazon / BM / OnBuy / Temu;
   `GP ÷ SP` on **eBay**. Both are valid business metrics — this matches the
   operator's master file per tab. In the run above eBay reads 14.85%; the same
   sale over BP would read 22.81%.
2. **Marginal Tax is the literal `16.67%`, not `1/6`.** They diverge in the
   third decimal and that drift propagates into GP and Total VAT NTP. The
   operator's cells say `=C3*16.67%`, so the app does too.
3. **Temu's commission is data, not a rate.** Its export reports the real
   per-order commission because the rate varies by category. The 7% constant is
   a fallback for files that lack the column.

---

## 5. Accessories

Identical marketplace formulas — the product type never enters the calculation.
Verified: the same BP/SP produces byte-identical figures for an accessory and a
phone on every marketplace.

The only difference is an **input**: `BP = pool buy price × quantity`, and SP is
the line total. So the flat fees (Accessories £1, BM's £9.99, eBay's £0.40) are
charged **once per line**, not per item — which matches how the marketplaces
actually bill per order.

Accessory sales appear on their own marketplace tab *and* on the
cross-marketplace `Accessories` sheet. That sheet is a view, not a second
source of truth.

---

## 6. Report tab layout

Column order per tab (2026-08). `Storage` and `Colour` are appended **last** on
purpose: every GP / GP % / TOTAL formula references hard column letters, so
inserting mid-sheet would shift them silently.

| Tab | Columns |
|---|---|
| AMAZON | Date · Order Number · SKU · IMEI · Supplier · Quantity · BP · SP · SP-BP · Marginal Tax · Commission · C. VAT · DSF · DSF. VAT · Postage · P. VAT · Accessories · Total VAT · GP · GP % · Total VAT NTP · Comments · Model · Return Date · Outcome · Return Reason · Shipping Legs · Postage Loss · Net GP £ · Storage · Colour |
| BM | …as Amazon, but Customer Care Fees replaces the C.VAT/DSF block and there is **no Total VAT** |
| EBAY | …adds ROF · FVF · VAT · T.COM · Marketing · M. VAT; Units replaces Quantity |
| ONBUY | …adds VAT 20%; **no Quantity column** (every letter shifts one left) |
| TEMU | …adds Commission VAT; no DSF block |

Returns add: `Return Date · Outcome · Return Reason · Shipping Legs ·
Postage Loss · Net GP £`, where
`Postage Loss = (Postage + P.VAT) × legs`, legs = **3** for a replacement and
**2** for a refund or repair, and `Net GP £ = GP − Postage Loss`.

---

## Reproducing this

```bash
VITE_E2E=1 npx vite build --outDir dist-e2e
npx vite preview --outDir dist-e2e --port 4173
node scripts/e2eMarkSalesAllMarketplaces.mjs
```

Outputs `e2e-screenshots/mark-sales-all-marketplaces/calculations.json` —
every input and derived figure, per marketplace. This document is written from
that file.
