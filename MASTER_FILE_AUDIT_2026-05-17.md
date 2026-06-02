# Master File Audit — Data Quality Findings

**File analysed:** `INVENTORY_REPORT_2026.xlsx` (uploaded 17 May 2026)
**Sheets reviewed:** `INVENTORY`, `IMEI NUMBERS`, `SUPPLIER WHATSAPP UPDATES`
**Analyst:** Engineering team — pre-import data review
**Date:** 17 May 2026

---

## Executive summary

The master file contains **~200 in-office IMEIs** ready to seed the new
inventory app, but a handful of data-quality issues need confirming before
upload so the app starts clean rather than inheriting drift.

Six findings, ranked by impact:

| # | Finding | Affected rows | Severity |
|---|---|---:|---|
| 1 | Colour value entered into SUPPLIER column ("BLACK") | 42 | **High** — creates a phantom supplier |
| 2 | INVENTORY rollup total (157) ≠ sum of qty cells (148) | 9-unit gap | Medium |
| 3 | Same model named differently across the two sheets | 17 INV + 67 IMEI rows | Medium |
| 4 | iPhone 13 128GB — INV supplier ≠ IMEI suppliers | 2 | Low |
| 5 | Unclear status codes (RTS / FBA) — terminology confirmation needed | 69 | Clarification |
| 6 | IMEI sheet shows 38 more units in office than INVENTORY rollup admits | 38 | Medium |

---

## Finding 1 — "BLACK" entered as a supplier

**42 rows in IMEI NUMBERS sheet** have `SUPPLIER = BLACK`. All 42 are
*Samsung Galaxy A32 5G 64GB*. Black is a colour, not a supplier — this is a
column-shift / copy-paste mistake that propagated across one entire batch.

**Breakdown:**
- 20 rows with STATUS blank (available)
- 22 rows with STATUS = SOLD

**Likely intended supplier:** IMAX. The same SKU has 78 other rows under
IMAX (34 available + 44 sold), and the INVENTORY rollup names IMAX as the
primary supplier for this model.

**Recommendation:** Find & Replace `BLACK` → `IMAX` in the SUPPLIER column,
limited to Samsung A32 rows. Quick fix, 1 minute.

---

## Finding 2 — INVENTORY total marker vs cell sum

Row 40 of the INVENTORY sheet says:

| Cell | Value |
|---|---|
| MODEL | TOTAL |
| QUANTITY | **157** |
| VALUE | **£14,719** |

But adding up the actual `QUANTITY` cells in the rows above (rows 2–39,
excluding the SHS + SOLD sections) gives **148 units** / **£13,308**.

So the TOTAL marker is 9 units / ~£1,411 ahead of what the individual rows
add to. Either the TOTAL is stale (rows were edited without refreshing the
total) or some cells were updated without the total being recomputed.

**Recommendation:** Refresh the TOTAL row formula, or confirm which number
is the source of truth (we'd default to the cell sum as the authoritative
office stock figure).

---

## Finding 3 — Naming drift between the two sheets

The same physical model is written differently on each sheet, which means
the INVENTORY rollup and IMEI rows don't auto-join cleanly. Examples:

| INVENTORY name | IMEI sheet name | Units affected |
|---|---|---:|
| `iPad 10.2 (2021) 9th gen 64 GB - WiFi + 4G` | `IPAD 9TH GEN 64GB W/C` | 12 |
| `Samsung Galaxy S20 FE 5G 128GB` | `SAMSUNG S20FE 128GB` | 11 |
| `Samsung Galaxy S21 5G 128GB (DUAL PHY SIM)` | `SAMSUNG S21 128GB` | 11 |
| `Samsung Galaxy A13 64GB - 2 SIM SLOTS` | `SAMSUNG A13 5G 64GB` | 6 |
| `Galaxy Tab S9FE 128GB WiFi` | `GALAXY TAB S9FE 128GB W/C` | 3 |
| `Samsung Galaxy S23 128` | `SAMSUNG S23 128GB` | 3 |
| `Samsung Galaxy X Cover Pro 64GB` | `SAMSUNG X COVER PRO 64GB` | 3 |

**Total impact:** ~17 INVENTORY rows + ~67 IMEI rows that fail an automated
join. They're physically the same products, just written two different ways.

**Recommendation:** Agree on canonical model names (we'd suggest the
INVENTORY sheet's longer form, e.g. `Samsung Galaxy S20 FE 5G 128GB`) and
rename matching IMEI sheet rows before upload. Or accept the naming drift
and the app's auto-mapper will catch the obvious matches at runtime —
ambiguous ones will surface in the "Mapping Review" queue in the app.

---

## Finding 4 — iPhone 13 128GB supplier mismatch

INVENTORY says the 2 in-office iPhone 13 128GB units came from supplier
**ABC**.

IMEI sheet shows:
- 1 available IMEI under **RR STOCK**
- 1 available IMEI under **IMAX**
- 2 sold IMEIs (historical) under **NANAK**

So ABC doesn't appear anywhere in the IMEI sheet for this model. Either:
- The ABC purchase order never landed and 2 different units from other
  suppliers ended up in the office, or
- The INVENTORY row is mis-attributed

**Recommendation:** Cross-check the ABC purchase order vs the IMEI sheet's
RR STOCK + IMAX entries for iPhone 13 128GB. Pick whichever record reflects
the physical reality.

---

## Finding 5 — STATUS code terminology

The IMEI sheet's STATUS column has four values:

| STATUS | Row count | Our interpretation |
|---|---:|---|
| (blank) | 902 | Available in office |
| SOLD | 391 | Sold to customer |
| FBA | 50 | **Confirm**: Fulfillment By Amazon? |
| R T S | 19 | **Confirm**: Ready To Ship? |

The app currently treats:
- `FBA` = stock sent to Amazon's warehouse, owned by us but in Amazon's
  custody
- `R T S` = packed in office, awaiting courier collection (NOT "Return To
  Supplier")

Please confirm both interpretations match how your team uses these codes,
so the app's KPIs and screens reflect the right mental model.

---

## Finding 6 — Office stock count discrepancy

Two different counts of "units physically in office":

| Source | Count |
|---|---:|
| INVENTORY sheet (sum of qty cells, ex-SHS, ex-SOLD section) | **148** |
| IMEI NUMBERS sheet (rows with STATUS = blank) | **186** |
| INVENTORY sheet TOTAL marker row | 157 |

The IMEI sheet shows 38 more available units than the INVENTORY rollup
admits.

**Likely causes** (in order of plausibility):

1. **Naming drift** (Finding 3) — IMEIs filed under names the INVENTORY
   rollup doesn't recognise, so they count toward IMEI's "in office" pool
   but not the rollup.
2. **INVENTORY rollup is incomplete** — some batches were received and
   IMEIs were logged, but the rollup row was never created.
3. **Stale IMEI sheet rows** — some units were sold but the STOCK OUT DATE
   wasn't entered, so they still look "in office" in the IMEI sheet.

**Recommendation:** After Findings 1-3 are addressed, re-count both pools.
The gap should shrink dramatically. Any residual difference is a real
ops question worth flagging.

---

## Supplier reality check

Across all IMEI rows (available + sold combined), the suppliers seen:

| Supplier | Total IMEIs | Available | Sold/RTS/FBA |
|---|---:|---:|---:|
| NIHAL | 168 | 23 | 145 |
| IMAX | 133 | 47 | 86 |
| MHL | 129 | 47 | 82 |
| NANAK | 92 | 36 | 56 |
| **BLACK** *(data error, see Finding 1)* | **42** | **20** | **22** |
| MOBILE KIT | 33 | 0 | 33 |
| RR STOCK | 25 | 9 | 16 |
| ABC | 12 | 2 | 10 |
| MHL (RR) | 4 | 2 | 2 |
| FBA STOCK | 4 | 0 | 4 |
| IMAX (RR) | 3 | 0 | 3 |
| NIHAL (RR) | 1 | 0 | 1 |

The `(RR)` variants and `BLACK` look like they should be merged into their
parent suppliers (`IMAX (RR)` → `IMAX`, `BLACK` → likely `IMAX`).

---

## What we'd propose

Once the client confirms RTS / FBA definitions and acknowledges these data
points, two practical paths:

**Path A — clean the Excel once, then bulk-import.**
- Find & Replace the 42 `BLACK` rows
- Optionally canonicalise the 7-8 worst orphan SKU names
- Upload via the app's Master Data Importer — all ~150-200 units land in
  the database in one shot, takes 30 seconds after the cleanup

**Path B — accept the data as-is, fix on import.**
- App's importer flags any unknown supplier name pre-write so the operator
  can remap inline
- Mapping Review queue in the Buy screen surfaces orphan IMEIs for manual
  matching against INVENTORY rows
- Slower but no Excel cleanup needed

We'd suggest **Path A** — the cleanups are 10 minutes of Excel work and
mean the app starts with a tidy dataset. Path B is the fallback if Excel
edits aren't feasible.

---

## Questions for the client

1. **STATUS = R T S** — is this "Ready To Ship" (packed, awaiting courier)
   or "Return To Supplier"? Affects how the app treats these 19 units.
2. **STATUS = FBA** — confirm this means "sent to Amazon's warehouse"
   (Fulfillment By Amazon) rather than something else?
3. **`BLACK` supplier** — confirm these 42 Samsung A32 rows are an IMAX
   purchase mis-keyed, so we can fix them with a single replace?
4. **`(RR)` supplier suffix** — what does it stand for? Should
   `IMAX (RR)` / `MHL (RR)` / `NIHAL (RR)` be treated as the same supplier
   as the unsuffixed version, or genuinely different?
5. **INVENTORY TOTAL** — is the 157 figure authoritative, or should we
   trust the row-by-row sum of 148?
6. **iPhone 13 128GB / ABC** — was the ABC purchase actually received,
   or did the units come from RR STOCK / IMAX instead?

Once these are answered, we can finalise the import plan and seed the app.
