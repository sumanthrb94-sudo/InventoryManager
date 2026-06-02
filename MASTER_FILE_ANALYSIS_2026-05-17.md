# Master File Analysis — INVENTORY ↔ IMEI Tally

**File:** `INVENTORY_REPORT_2026_corrected.xlsx` (post-BLACK fix applied)
**Match rules:** Jaccard ≥ 70% · case-insensitive · `Galaxy` treated as Samsung
**4G and 5G kept distinct** (different SKUs / different prices)
**Date:** 17 May 2026

---

## Headline numbers

| | Count | % |
|---|---:|---:|
| INVENTORY rows total | 32 | 100% |
| → **CLEAN** (perfect match) | 5 | 16% |
| → **PARTIAL** (some discrepancy) | 10 | 31% |
| → **NO MATCH** (no IMEI under any name) | 17 | 53% |
| | | |
| INVENTORY units total | 148 | 100% |
| → CLEAN units | 6 | 4% |
| → PARTIAL units | 85 | 57% |
| → NO MATCH units | 57 | 39% |
| | | |
| Available IMEIs (STATUS blank) | 186 | 100% |
| → Matched to an INV row | 118 | 63% |
| → **Orphan** (no INV row at all) | 68 | 37% |

**Bottom line:** 142 of 148 units (96%) and 68 of 186 IMEIs (37%) need client clarification before clean import.

---

## Issue categories

### A. Colour mismatch — same model, wrong colour on one sheet (6 rows / 71+ units)

The biggest concentration is **Samsung A32 5G 64GB**:
- INV says: BLACK 41, BLUE 1
- IMEI sheet has: 71 IMEIs, all BLACK (no BLUE)

Other colour disagreements:

| Model | INV says | IMEI shows |
|---|---|---|
| **Galaxy Tab A8 32GB** | GREY 16 | BLACK 16 |
| **iPhone XS 64GB** | GREY 1 | BLACK 1 |
| **Samsung S9+ 64GB** | PURPLE 1 | PINK 1 |
| **Samsung S22 256GB** | PURPLE 2, BLACK 1 | LAVENDER 2, BLACK 2 (no PURPLE) |
| **Samsung A14 5G 64GB** | BLACK 5 | GREEN 1 (4 missing) |

Question for client: *"Are these colour names being used differently across sheets (e.g. is 'GREY' written as 'BLACK' in some places), or are the rollup colours genuinely wrong?"*

---

### B. Naming drift — same product, different name across sheets (12 distinct SKUs / 51 units affected)

The two sheets call the same phone different things. INV uses full descriptive names; IMEI sheet uses short abbreviations.

| INVENTORY name | IMEI sheet name | Units |
|---|---|---:|
| iPad 10.2 (2021) 9th gen 64 GB - WiFi + 4G | IPAD 9TH GEN 64GB W/C | 12 |
| Samsung Galaxy S21 5G 128GB (DUAL PHY SIM) | SAMSUNG S21 128GB | 11 (orphan) |
| Samsung Galaxy S20 FE 5G 128GB | SAMSUNG S20FE 128GB | 11 (orphan) |
| Samsung Galaxy A13 64GB - 2 SIM SLOTS | SAMSUNG A13 5G 64GB | 6 (orphan) |
| Samsung Galaxy S20 5G 128GB - SS No E-Sim | SAMSUNG S20 128GB | 4 (orphan) |
| Samsung Galaxy S21 FE 5G 128GB | SAMSUNG S21FE 128GB | 4 (orphan) |
| Galaxy Tab S9FE 128GB WiFi | GALAXY TAB S9FE 128GB W/C | 3 |
| Samsung Galaxy S23 128 (missing "GB") | SAMSUNG S23 128GB | 3 (orphan) |
| iPad 7 32GB Wifi 2019 10.2 - WIFI + 4G | IPAD 7TH GEN 32GB W/C | 2 (orphan) |
| Apple iPhone SE 3rd 64GB | IPHONE SE3 64GB | 2 (orphan) |
| iPad Air 11-inch (M3) 128GB - Wi-Fi | IPAD AIR 11in M3 128GB W | 1 (orphan) |

Question for client: *"Can we agree on one naming style across both sheets going forward? I'd suggest the longer descriptive form (e.g. 'Samsung Galaxy S20 FE 5G 128GB' rather than 'SAMSUNG S20FE 128GB')."*

---

### C. 4G vs 5G ambiguity — REAL product distinction (4 SKUs / 14+ units)

These are technically different phones (different chipsets, cameras, prices). The two sheets disagree on which variant is in stock:

| Model | INVENTORY claims | IMEI sheet has | Risk |
|---|---|---|---|
| **Samsung A14 64GB** | A14 **5G** 64GB × 5 (BLACK) | A14 **4G** 64GB × 1 (VIOLET) | **High** — different SKUs |
| **Samsung A16 128GB** | A16 **4G** 128GB × 2 (GREEN/WHITE) | A16 **5G** 128GB × 1 (GREEN) | **High** — different SKUs |
| **Samsung A13 64GB** | A13 64GB × 5 (no 4G/5G tag) | A13 **5G** 64GB × 6 | Medium — INV missing the tag? |
| **Samsung A15 5G** | A15 5G **128GB** × 1 (BLACK) | A15 5G **64GB** × 1 (BLACK) | Medium — different storage |

Confirmed via product research: Samsung A13, A14, A16 all have distinct 4G and 5G variants with different specs and retail prices.

Questions for client:
- *"For Samsung A14 64GB — INV says you have 5 of the **5G** variant in BLACK. IMEI sheet shows 1 VIOLET **4G** unit. Which is actually in office, and where are the other 4 expected units?"*
- *"For Samsung A16 128GB — same flip: INV says **4G**, IMEI says **5G**. Which model is the office holding?"*
- *"For Samsung A13 64GB — the INVENTORY row doesn't specify 4G or 5G. The IMEI rows say 5G. Are all units the 5G model?"*
- *"Going forward: every model name should explicitly include 4G or 5G — no ambiguity. Agreed?"*

---

### D. Storage missing from INVENTORY (3 rows / 4 units)

Three INV rows have a number with no `GB` suffix, breaking the storage match entirely:

| INVENTORY (as written) | Should be? |
|---|---|
| `Samsung Galaxy S23 128` | `S23 128GB`? |
| `Samsung Galaxy S23 FE 128` | `S23 FE 128GB`? |
| `Samsung Galaxy S23 FE 256` | `S23 FE 256GB`? |

Question for client: *"Three Samsung S23 entries are missing 'GB' on the storage — should they be 128GB and 256GB respectively?"*

---

### E. Supplier disagreement — only one real case (2 units)

| Model | INV supplier | IMEI suppliers found | Notes |
|---|---|---|---|
| **iPhone 13 128GB** | ABC | RR STOCK + IMAX | ABC purchase order vs reality |

Worth checking the ABC invoice — did the units physically arrive from ABC, or were they re-sourced?

---

### F. Quantity over/under (4 rows)

INV qty doesn't match the count of available IMEIs:

| Model | INV qty | IMEI qty | Δ |
|---|---:|---:|---:|
| Samsung A32 5G 64GB | 42 | 71 | **+29** (way over) |
| Samsung A21S 32GB | 4 | 5 | +1 |
| Samsung S22 128GB | 7 | 8 | +1 |
| Samsung S22 256GB | 5 | 6 | +1 |
| Samsung A14 5G 64GB | 5 | 1 | -4 |
| Samsung A16 4G 128GB | 2 | 1 | -1 |

For Samsung A32 (+29): the IMEI sheet has 71 BLACK units from multiple suppliers (IMAX 34, MHL 20, NANAK 16, RR STOCK 1). INV only mentions IMAX with 42. Reasons could be:
- The MHL batch (20 units) isn't reflected in INV — unlogged stock
- The NANAK 16 came in but weren't added to the rollup
- Some are old units that should have been marked sold/RTS already

Question for client: *"For Samsung A32 5G 64GB — INV says 42 units from IMAX. IMEI sheet shows 71 units across 4 suppliers (IMAX 34, MHL 20, NANAK 16, RR STOCK 1). Are the extra 29 units real stock that hasn't been added to the rollup, or are some of those IMEIs already sold/listed and just not marked?"*

---

### G. Orphan IMEIs (68 IMEIs / no INV row)

IMEIs in the sheet that have no INVENTORY counterpart at all (mostly because of naming drift, but a few may be entirely new SKUs):

| Count | Model | Likely cause |
|---:|---|---|
| 12 | IPAD 9TH GEN 64GB W/C | Naming drift — same as INV "iPad 10.2 (2021) 9th gen 64 GB" |
| 11 | SAMSUNG S20FE 128GB | Naming drift — INV "Samsung Galaxy S20 FE 5G 128GB" |
| 11 | SAMSUNG S21 128GB | Naming drift — INV "Samsung Galaxy S21 5G 128GB (DUAL PHY SIM)" |
| 6 | SAMSUNG A13 5G 64GB | Naming drift — INV "Samsung Galaxy A13 64GB" (missing 5G tag) |
| 4 | SAMSUNG S20 128GB | Naming drift — INV "Samsung Galaxy S20 5G 128GB - SS No E-Sim" |
| 4 | SAMSUNG S21FE 128GB | Naming drift — INV "Samsung Galaxy S21 FE 5G 128GB" |
| 3 | GALAXY TAB S9FE 128GB W/C | Naming drift + WiFi/cellular tag difference |
| 3 | SAMSUNG S23 128GB | Naming drift — INV missing "GB" |
| 3 | SAMSUNG X COVER PRO 64GB | **Possibly new SKU** — not in INV at all |
| 2 | IPAD 7TH GEN 32GB W/C | Naming drift — INV "iPad 7 32GB Wifi 2019 10.2" |
| 2 | IPHONE SE3 64GB | Naming drift — INV "Apple iPhone SE 3rd 64GB" |
| 1 | IPAD AIR 11in M3 128GB W | Naming drift |
| 1 | IPHONE SE2 64GB | **Possibly new SKU** — not in INV |
| 1 | SAMSUNG A05 128GB | **Possibly new SKU** — not in INV |
| 1 | SAMSUNG A14 4G 64GB | 4G/5G mismatch with INV's 5G variant |
| 1 | SAMSUNG A15 5G 64GB | Storage mismatch — INV has 128GB only |
| 1 | SAMSUNG A16 5G 128GB | 4G/5G mismatch with INV's 4G variant |
| 1 | SAMSUNG X COVER 4 8GB | **Possibly new SKU** — not in INV |

Question for client: *"5 IMEIs are filed under models the INVENTORY rollup doesn't have at all — X Cover Pro (3), iPhone SE2 (1), Samsung A05 (1), X Cover 4 (1). Are these recent additions not yet rollup-counted, or were they originally meant to be under a different existing row?"*

---

## Summary for client conversation

Bring this list when you meet:

| # | Category | Rows | Units | What's needed |
|---|---|---:|---:|---|
| 1 | 4G/5G ambiguity (REAL SKU issue) | 4 | 14+ | Physical stock-take confirmation |
| 2 | Naming drift across sheets | 12 | 51 | Pick one canonical style, rename |
| 3 | Colour mismatches | 6 | 71+ | Confirm colour names, fix one sheet |
| 4 | Storage missing in INV (S23 rows) | 3 | 4 | Add "GB" suffix to INV rows |
| 5 | Quantity over/under (A32 +29) | 6 | varied | Investigate unlogged stock or unmarked sales |
| 6 | iPhone 13 ABC supplier mismatch | 1 | 2 | Cross-check the ABC purchase order |
| 7 | Possibly new SKUs missing in INV | 4 | 6 | Add to rollup or merge into existing rows |
| | **TOTAL** | **27** | **142** | |

Plus 68 orphan IMEIs that are mostly absorbed once #2 (naming drift) is resolved.

## Recommended approach

1. **Today**: walk through this report with the client, get answers
2. **Tomorrow** (10-15 min Excel work): fix names, colours, storage, GB suffixes based on answers
3. **Same day**: upload corrected file via the app's Master Data Importer — all matched units land cleanly
4. **Ongoing**: the app's Add Stock form (dropdowns, validation, structured fields) prevents these drifts from happening again

**Only 5 of 32 rows are clean today.** That's the gap to close before the import gives us tidy data.
