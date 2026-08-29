# Report schemas — standard operating procedure

The definitive column contract for every report the system reads and writes.
Every header below was dumped from the live templates and from real downloads,
not transcribed from memory. If a file disagrees with this document, the file
is wrong.

Companion to `templates/README.md`, which covers *how* to use the files. This
document covers *what is in them*.

---

## 0. The rules, in one place

1. **Headers are matched by name, not position.** Rename a column and the
   importer drops it or reads its neighbour. Reorder columns and nothing
   breaks. Never rename; reorder only if you must.
2. **An export is always a valid import — a superset, never a variant.**
   This is the rule the whole round trip rests on:
   - Every column the importer reads appears in the export, under the same
     name, **in the same order**.
   - The export may add columns. It may never rename, reorder or drop one.
   - The only legitimate additions are **derived** — values the app computes
     and recomputes on the way back in.

   Where the two differ for any other reason, that is a defect, not a design.
   Two such defects were found and fixed while writing this document; §9
   records them.
3. **Derived money is recomputed on import.** `SP-BP`, `Marginal Tax`,
   `Commission`, `ROF`, `FVF`, `VAT`, `GP`, `GP %` — anything you type there
   is discarded. Supply only what the marketplace actually gave you.
4. **Import inventory before sales.** Sales match stock by IMEI.
5. **Re-importing is safe.** IMEI already known → update. Order number + IMEI
   already known → update. Nothing duplicates.

---

## 1. Inventory Report

One importer handles all stock, office and supplier-held. `Stock Type` decides
which.

### 1.1 Import — what you upload

**11 columns.** `templates/INVENTORY_REPORT_TEMPLATE.xlsx`, sheet `INVENTORY`.

| # | Column | Required | Accepted values |
|---|---|---|---|
| 1 | Stock In Date | No | `yyyy-mm-dd`, an Excel date, or blank (= today) |
| 2 | Model | **Yes** | Free text. Snapped to the admin catalog spelling on write |
| 3 | IMEI | **Office only** | 15 digits, or a 10–12 char Apple serial. **Blank for SHS** — see §1.3 |
| 4 | Grade | No | `A` `B` `C` `ONU` `Brand new` |
| 5 | Storage | No | `16GB` `32GB` `64GB` `128GB` `256GB` `512GB` `1TB` `Not Applicable` |
| 6 | SIM Type | No | `Physical SIM` `Physical SIM + eSIM` `Dual Physical SIM` `Not Applicable` |
| 7 | Colour | No | Free text |
| 8 | Supplier | **Yes** | Matched case-insensitively; unknown names are created |
| 9 | BP | **Yes** | Must be > 0 |
| 10 | Stock Type | No | `OFFICE` (default) or `SHS` |
| 11 | Notes | No | Free text |

The Grade / Storage / SIM Type lists are exactly what the app's Add Stock
screen offers. They are **helpers, not gates** — Excel will let you type
something else and the import will accept it, but a value the app doesn't
recognise won't group with anything on any screen. Grade and SIM Type are
snapped to canonical casing on write, so `brand new` lands as `Brand new`.

**Accepted header aliases** (case- and whitespace-insensitive):

| Field | Aliases |
|---|---|
| Stock In Date | `stock in date` `stockindate` `stock in` `date in` `datein` `date` |
| IMEI | `imei` `serial` `imei/serial` `imei / serial` |
| SIM Type | `sim type` `simtype` `sim` |
| Colour | `colour` `color` |
| Stock Type | `stock type` `stocktype` `stock status` `shs` `holding` |
| BP | `bp` `bp (£)` `buy price` `buying price` |
| Notes | `notes` `note` |

**Stock Type values read as SHS:** `SHS` `INCOMING` `SUPPLIER` `SUPPLIER HELD`
`SUPPLIER-HELD` `Y` `YES` `TRUE` `1`. Everything else, including blank, is
office stock. Writing "SHS" in **Notes** does nothing.

### What can be stocked

Every unit needs its own identifier, so what the system holds is one row per
physical thing:

| Item | Identifier | Stockable |
|---|---|---|
| Android phone | 15-digit IMEI — always has one | Yes |
| Apple phone / cellular iPad | 15-digit IMEI **or** Apple serial | Yes |
| WiFi-only tablet | serial (no IMEI exists on the device) | Yes |
| AirPods · Galaxy Buds · Watches | serial | Yes |
| Case · charger · cable · screen protector | none | **No** |

The last row is a decision, not a gap. Those have no unique identifier, so
supporting them would mean quantity-based stock — a different stock model
rather than a looser validation rule.

**Serials may be all digits.** Some Samsung tablets ship identifiers that are
numeric and shorter than 15 digits, so a 10–12 character all-numeric value is
accepted on serial-family devices. This means a half-typed IMEI can also get
through on those models — check the identifier in the import preview, which
is where a mistype is meant to be caught.

**Every sheet in the workbook is read**, not just the first. Sheets whose
header row lacks both Model and IMEI (Summary, Notes) are skipped and named in
the error if nothing parses.

### 1.2 Export — what you download

**Two sheets, 12 columns each.**

```
Office Stock   available + returned-to-inventory units
SHS Stock      incoming units (supplier still holds them)
```

`Stock In Date · Model · IMEI · Grade · Storage · SIM Type · Colour ·
Supplier · BP · Stock Type · Notes · Age (days)`

**The first 11 columns are the import schema, in the same order.** The one
difference is the 12th: **`Age (days)`**, computed from Stock In Date and
ignored on the way back in.

**Sold units are not in this report.** It is a stock report: what you hold,
not what you have held. Sold units come back from the Sales Report.

### 1.3 SHS stock

`templates/SHS_STOCK_TEMPLATE.xlsx` is the same 11-column `INVENTORY` schema
with every row pre-set to `SHS`. There is one stock importer, not two.

**Leave the IMEI blank.** Supplier-held stock has not shipped — there is no
handset in anyone's hand, so there is no IMEI to read off it. That is the
whole point of recording it as SHS. Never invent one: an invented IMEI matches
no real phone and has to be found and corrected later.

The unit is tracked by **Model + Supplier** until it arrives, and that is also
how it gets fulfilled — if the supplier ships straight to a customer, the
Sales Report carries an IMEI you have never seen, and the holding closes on
the Model + Supplier match rather than on the IMEI. The IMEI is captured when
the phone arrives and you **Receive** it.

A real IMEI is accepted if the supplier has already sent one, and is validated
exactly as any other. Optional does not mean unchecked.

Because there is no IMEI to recognise a row by, a re-upload matches an SHS
holding on **Model + Supplier + BP + Stock In Date**. Two identical rows are
the same holding, so re-importing the same file stays safe.

An SHS unit leaves SHS in exactly three ways:

1. It arrives → Receive it (Buy → SHS tile → Receive) → becomes office stock.
2. The supplier ships direct to the customer → it appears on a Sales Report.
   That sale carries an IMEI you have **never seen** — the holding had none —
   so it arrives as an unmatched row on the import's audit screen. Enter the
   model and set that row's toggle to **SHS**. The holding for that model +
   supplier is then closed, the master row decremented, and the sale tagged as
   SHS revenue rather than office.

   That toggle is deliberately a decision, not a guess. On a restore every
   sale re-imports unmatched, and inferring "unmatched + a holding exists =
   supplier shipped it" silently ate real holdings. Only you know which is
   which.
3. The supplier cancels → an admin deletes it from the SHS overlay.

---

## 2. Sales Report

Column order differs per marketplace and is **not** interchangeable. Upload
either a combined four-sheet workbook or one file per channel with the
marketplace picker set — both produce an identical system.

Required on every row, every marketplace: **Date, Order Number, BP, SP.**
IMEI is optional but without it a sale cannot match a unit.

**Record id** = `marketplace__orderNumber__discriminator`, where the
discriminator is the IMEI, else the SKU, else the sheet row index. One order
can legitimately ship several phones, so the IMEI is what keeps those rows
apart; the id is deterministic across re-imports, which is why per-channel and
combined uploads update the same rows instead of duplicating them.

### 2.1 Import — what you upload

**AMAZON — 15 columns.**

```
Date | Order Number | SKU | IMEI | Supplier | Quantity | BP | SP |
SP-BP | Marginal Tax | Commission | Postage | GP | GP % | Comments
```

**BM — 17 columns.** `Payment Mode` is inserted at position 9.

```
Date | Order No | SKU | IMEI | Supplier | Quantity | BP | SP | Payment Mode |
SP-BP | Marginal Tax | PayPal/Klarna Com | Commission | Postage | GP | GP % | Comments
```

**EBAY — 19 columns.** Postage is `SHIPPING`; values `1`, `2`, `8` are read as
standard shipping tiers.

```
DATE | ORDER NUMBER | SKU | IMEI NUMBER | SUPPLIER | UNITS | BP | SP |
SP-BP | MAR TAX | COM | ROF | FVF | 0.2 | T.COM | SHIPPING | GP | GP% |
NP(incl. PROMOTION)
```

**ONBUY — 15 columns. No Quantity column**, so BP and SP sit one position
further left than the other three.

```
DATE | Order Number | SKU | IMEI | Supplier | BP | SP |
SP-BP | MAR VAT | COM 7% | VAT 20% | SHIP | GP | GP% | Comments
```

**TEMU — 19 columns. Its own layout, not Amazon's.** Added 2026-07,
corrected against the client's final Temu export (`TEMU_FORMULA.csv`).
**Commission and Commission VAT are read straight from the file** — Temu's
referral rate varies by category, so the export reports the actual fee it
charged per order rather than a flat percentage the app could derive; a
file without those columns falls back to 7% of SP (and commission × 20%
for Commission VAT). Postage VAT is a genuine 20% (not zero). Commission
VAT is tracked for the record but excluded from Total VAT and GP — Temu
VAT-invoices it to the seller as reclaimable input tax. **No DSF column at
all** — Temu doesn't charge one. See §2.2 for the export-side column set.

```
Date | Order Number | SKU | IMEI | Supplier | Quantity | BP | SP |
SP-BP | Marginal Tax | Commission | Commission VAT | Postage | P. VAT |
Acc | Total VAT | GP | GP % | Total VAT NTP
```

**Header aliases per field:**

| Field | Accepted headers |
|---|---|
| Date | `date`, plus `nw` on Amazon (legacy — see below) |
| Order Number | `order number` `order no` |
| IMEI | `imei` `imei number` |
| Quantity | `quantity` `units` `quant` |
| Postage | `postage`, and `shipping` on eBay |

If a header cannot be matched the parser falls back to the documented
positional index, so BP and SP keep flowing as real numbers rather than
silently defaulting to zero.

**Legacy Amazon date header.** Amazon's date column used to be headed `nw` — a
typo in the original operator workbook that became the schema by accident, and
the only column in any marketplace whose name didn't say what it held.
Templates and samples now emit `Date`, matching the other three sheets and the
app's own Sales Report export. **`nw` remains an accepted alias permanently**:
years of operator files carry it, and both spellings parse to the same record
id, so a mix of old and new files cannot double-count.

**Two behaviours worth knowing:**

- **Bulk orders.** Several IMEIs in one cell separated by ` / ` split into one
  row per phone, with BP and SP divided evenly.
- **Red rows.** Fill the Date or Order Number cell red and the sale imports as
  *flagged* and shows red across the app — the convention for returns,
  refunds, chargebacks and disputes. Cell fill is the only way to set it.

### 2.2 Export — what you download

**Seven sheets:** `Summary · Returns · AMAZON · BM · EBAY · ONBUY · TEMU`

The five marketplace sheets carry the import columns plus computed VAT/fee
columns, a resolved `Model`, the buy-side attributes and a return-linkage
block. Column counts: **AMAZON 35, BM 34, EBAY 38, ONBUY 32, TEMU 34.**
Reconciled column-for-column against the client's own live report
(`14TH_AUGUST_SALES_REPORT_2026.xlsx`) on 2026-08-14: BM gained `Payment
Mode` and `PSF`, TEMU gained `Commission+VAT`, and `Accessories` is now
`Acc` on all five tabs — his header.

The sheet reads left to right as **what was sold → what it cost → what it
made → what happened to it afterwards**:

```
Date | Order Number | SKU | IMEI | Model | Colour | Storage | Supplier |
[Quantity|Units] | [Payment Mode] | BP | SP | SP-BP | Marginal Tax |
Commission | …fees… | Postage | P. VAT | Acc | [Total VAT] | GP | GP % |
Total VAT NTP | Postage Loss | Fees Kept | Repair Cost | Supplier Credit |
Return Cost | Net GP £ | Return Date | Outcome |
Shipping Legs | Return Reason | Comments
```

Three blocks, in order:

1. **Identity** — `Date … Supplier`. `Model`, `Colour` and `Storage` sit
   directly after `IMEI` so the handset is described in one place: an
   accountant reading a row sees *iPhone 13 / Black / 128GB* side by side
   rather than hunting the far end of the sheet. `Model` is the resolved model
   name — `sale.model` when the audit is complete, otherwise a live normalised
   guess off the preserved raw SKU.
2. **Money** — `[Quantity|Units] … Net GP £`. Every fee, VAT and profit figure
   in one uninterrupted run, ending on the bottom line. The last five columns
   before `Net GP £` are the return economics (2026-08-29, at the operator's
   request): `Postage Loss` (carriage legs × (postage + P.VAT)), `Fees Kept`
   (what the marketplace did not give back on a refund — Amazon
   min(20% × commission, £5) + VAT, eBay the fixed £0.40 + VAT, BM/OnBuy/Temu
   everything; blank on replacements), `Repair Cost` and `Supplier Credit`
   (unit-side; blank until entered — absent is not zero), and `Return Cost`,
   a live formula `Postage Loss + Fees Kept + Repair Cost − Supplier Credit`.
   `Net GP £ = GP − Return Cost` and `GP %` nets the same figure.
3. **Return** — `Return Date … Comments`. Every tab ends on `Comments`, so the
   operator's note about the return is the last thing read.

`Colour` and `Storage` are what make the round trip **self-healing**: a unit
whose attributes were lost (raw operator SKU, no storage or colour recorded)
gets them back when the exported report is re-imported, instead of coming back
as an orphan a second time.

**Reordering these columns is safe — and it was not always.** Every GP / GP % /
Total VAT NTP / TOTAL formula written onto these tabs used to reference **hard
column letters**, so inserting a column mid-sheet shifted those letters and
silently corrupted the arithmetic: the cells still looked plausible, they just
pointed one column left. That is why `Model`, `Storage` and `Colour` were
originally appended after `Comments`. `excelFormulaFor` and `writeSaleRow` now
resolve every column **by header name** through `salesCol` / `salesColLetter`,
which throw on an unknown name. The order above is therefore a presentation
decision, changed by editing `SALES_HEADERS` alone.

The importer also matches on header name, so a report exported under the old
order still imports.

Marketplace-specific fee columns:

| Marketplace | Extra columns |
|---|---|
| AMAZON | `C. VAT` `DSF` `DSF. VAT` |
| BM | `Payment Mode` (between Quantity and BP) `Customer Care Fees` `PSF` — and **no `Total VAT` column**: BM's only VAT line is `P. VAT`, so `Total VAT NTP = Marginal Tax − P. VAT` directly. `PSF` is the Payment Seller Fee, `SP × 1%`, new on 2026-08-14; it comes out of GP and stays out of Total VAT NTP, because it is a charge and not a tax |
| EBAY | `ROF` `FVF` `VAT` `T.COM` `Marketing` `M. VAT` — and `Units`, not `Quantity` |
| ONBUY | `VAT 20%` — and no Quantity column |
| TEMU | `Commission VAT` `Commission+VAT` — no DSF. Commission is a FORMULA as of 2026-08-14, `SP × 3.96%`, the one rate the client's report applies to every row; it was a literal while Temu's fee was believed to vary by category. `Commission+VAT` is the two cells beside it added up, not an extra charge. Commission VAT is excluded from Total VAT and GP |

`Returns` sheet (16 columns):

```
Sale Date | Return Date | Marketplace | Order Number | SKU | IMEI | Supplier |
Outcome | Return Reason | Shipping Legs | Postage Loss £ | BP | SP | SP-BP |
Postage | Comments
```

**This export re-imports.** The headers the importer needs — Date, Order
Number, SKU, IMEI, Supplier, Quantity, BP, SP, Postage, Comments — are all
present under recognised names. Verified: a downloaded Sales Report uploaded
into an empty system restores 101 sales and 93 sold units with identical
record ids.

**"Recognised names", not "identical names."** Rule §0.2 says the export never
renames a column the importer reads. That holds *semantically* — via the alias
table in §2.1 — but a few headers are spelled differently on the way out
because the export normalises to one house style across all five tabs:

| Marketplace | Import header | Export header | Why it still parses |
|---|---|---|---|
| BM | `Order No` | `Order Number` | both are `Order Number` aliases |
| EBAY | `IMEI NUMBER` | `IMEI` | both are `IMEI` aliases |
| EBAY | `SHIPPING` | `Postage` | `shipping` is the eBay `Postage` alias |
| EBAY | `MAR TAX` `COM` `0.2` | `Marginal Tax` `Commission` `VAT` | derived — recomputed on import, never read |

Header matching is case-insensitive, so `DATE` / `Date` and
`ORDER NUMBER` / `Order Number` are the same column. None of these differences
can drop a value; they are listed so a reader comparing a template against a
download side by side doesn't mistake house style for a defect.

---

### 2.3 Orphan IMEIs on the audit screen

An **orphan** is a sale whose IMEI the system has never seen. It is not an
error state — it is the normal arrival of a phone that was sold before it was
ever in stock, and it is how supplier-held stock gets fulfilled.

The importer will not confirm while an orphan is incomplete. The audit screen
shows `Complete N records to continue`, and Confirm stays disabled. Nothing is
written until every orphan has a model and a stock source.

**Each orphan row asks two things:**

| Field | What it means |
|---|---|
| Model | What was sold. The report gave an SKU, not a catalogue model. |
| Office / SHS | **Where it came from.** Office = it was on the shelf. SHS = the supplier shipped it direct to the customer. |

**Setting a row to SHS** does four things at confirm:

1. Finds the open holdings for that **Model + Supplier** — matched on what the
   holding *is* (`status: incoming`, no IMEI), not on how its id happens to be
   spelled.
2. Closes **exactly one** of them. Not the model line, not every holding from
   that supplier — one unit shipped, one unit closes.
3. Writes the sale's **real IMEI onto that unit**. The holding never had one;
   the supplier's report is the first time that number exists in the system.
   This is the moment the IMEI is learned.
4. Tags the sale `stockSource: shs`, so the revenue lands in supplier-held
   margin rather than office margin.

**Leaving a row on Office** takes none of those steps. The sale records
normally and every SHS holding stays open.

**Why the toggle is a decision and not an inference.** "Unmatched sale + an
open holding for that model exists ⇒ the supplier must have shipped it" is
wrong often enough to be dangerous. On a restore, *every* sale re-imports
unmatched — that rule silently closed three real holdings that were still
sitting with the supplier (SHS went 8 → 5 on a rebuild that should have been
a no-op). The system now closes a holding only when an operator says so.

**Verified end to end** by `scripts/e2eShsOrphanFlow.mjs` — 14 checks, 12
screenshots in `e2e-screenshots/shs-orphan-flow/`:

| Screenshot | What it shows |
|---|---|
| 01–02 | Empty database, then the inventory preview with Office and SHS rows |
| 03 | SHS tile reads **10 holdings**, all IMEI-less |
| 04–05 | Sales preview, then the audit screen **blocked** on incomplete orphans |
| 06–08 | The direct-shipment orphan row; model entered; toggle set to **SHS** |
| 09–10 | All orphans complete → Done screen reports *SHS fulfilled · 1 supplier-held unit shipped & sold* |
| 11–12 | SHS tile drops to **9**; the overlay shows the other nine untouched |

The assertions that matter: exactly one holding closed (10 → 9), the closed
one was the model+supplier match, the sold unit carries the supplier's real
IMEI, the sale is tagged `shs`, and the remaining nine are still open and
still IMEI-less.

---

## 3. Returns Report — export only

**There is no returns importer, by design.** A return is a workflow, not a
row: Returns → Process Return, step 1 Tech-QC logs the complaint and the
inspection, step 2 CRM picks the outcome. Only then is the linked sale voided.

**Three sheets.**

`Summary` — a label/value block: Total Returns, Total Postage Loss £, Avg Loss
per Return £, a By Marketplace breakdown, the carriage cost policy, and the
pre-tracking cutoff.

`Returns Detail` — 16 columns:

```
Return Date | Unit IMEI | Model | Storage | Colour | Supplier |
Original Sale Date | Original Sale Price | Marketplace | Return Type |
Outcome | Reason | Comments | Leg Cost £ | Shipping Legs | Postage Loss £
```

`Unit Histories` — 7 columns:

```
Unit IMEI | Model | Event Date | Event | Detail | Amount £ | Comments
```

`Event` is one of `STOCK IN` `SOLD` `RETURNED` `STATUS`.

**Value domains:**

| Field | Values |
|---|---|
| Return Type | `returned_to_inventory` `repair` `returned_to_supplier` |
| Outcome | `refund` `replacement` `repair` |
| Shipping Legs | Journeys the parcel made. Refund / in-warranty repair / to-supplier = 2 (out + back); replacement = 3 (out, faulty back, new one out); repair after the warranty window = 3 (it goes back mended) |
| Postage Loss £ | Leg Cost × (Shipping Legs − 1 if the sale kept its revenue). **Not** Leg Cost × Shipping Legs — see below |

**Why Postage Loss can be less than Leg Cost × Shipping Legs.**
The first journey was paid at sale time and is recorded as that sale's own
`Postage`, which its gross profit already subtracts. So it only needs charging
here when that gross profit does *not* stand:

| | Sale's GP | Journeys | Already paid | Billed |
|---|---|---|---|---|
| Refund | reversed | 2 | 0 | 2 |
| Repair, in warranty (refunded) | reversed | 2 | 0 | 2 |
| Repair, after warranty | stands | 3 | 1 | 2 |
| Replacement | stands | 3 | 1 | 2 |
| Accessory return (revenue voided outright) | reversed | 2 or 3 | 0 | 2 or 3 |

Billing all three journeys on a replacement charged **four** legs for three —
the sale kept its revenue with the outbound leg inside it, and the return
charged that same leg again.

---

## 4. Viewing a report

**View** (the eye icon beside a range) renders the same workbook the download
produces — same sheets, same tab names, formulas computed in-browser. The
Inventory Report previews as two tabs, Office Stock and SHS Stock. The row
tally in the footer is per sheet.

---

## 5. Backup and restore

The Inventory Report and the Sales Report together are a complete backup.

**Download both before you wipe anything.** Both describe the state at the
moment you export them.

1. Stock Intake → Inventory Report → All Time
2. Sell → Sales Report → All Time

**Restore in this order:**

1. Inventory Report first — stock must exist before a sale can match it.
2. Sales Report second — each row finds its unit by IMEI, marks it sold and
   restores the sale.

Reversed, every sale row arrives as an orphan needing manual completion.
Nothing is lost, but you re-key what the file already knew.

---

## 6. Getting a template without leaving the app

Every template is one click away from the report it belongs to — no need to
find this folder.

- **Stock Intake → Inventory Report** → *Build a new file from* → Inventory
  template · SHS stock template
- **Sell → Sales Report** → *Build a new file from* → combined, or any single
  channel
- **Import → Inventory Report / Sales Report** → the same offer, before you
  pick a file. On the sales side, picking a marketplace first narrows the
  offer to that channel's layout.

The app serves the files from `public/templates/`, written by the same
generator run that writes `templates/`. `templates.test.ts` checks the two
are byte-identical, so the button can never hand out a schema the importer
has moved past.

Returns has no template button — there is no returns importer.

### Worked examples

`templates/filled-examples/` holds every template filled in exactly as this
document says to fill it — example rows deleted, data typed into the columns
as headed, README sheet left attached. They are generated by
`scripts/fillTemplatesAsOperator.mjs` and uploaded through the real UI by
`scripts/e2eTemplateFillAndUpload.mjs`, which checks the numbers land:
40 stock rows in as 34 office + 6 SHS, 21 sales out as office 34 → 14 and
SHS 6 → 5. Compare your file against these when something won't import.

**If you forget to delete the grey example rows**, the import does not fail —
it offers to load them, and confirming puts five fictional phones into stock
under IMEIs starting `35010000000…`. Nothing is written until you confirm, so
the preview is the place to catch it. That is why deleting them is rule 1.

## 7. Files

| File | Purpose |
|---|---|
| `INVENTORY_REPORT_TEMPLATE.xlsx` | Blank stock template, office and SHS |
| `SHS_STOCK_TEMPLATE.xlsx` | Same schema, pre-set to SHS |
| `SALES_REPORT_TEMPLATE.xlsx` | Blank combined workbook, five sheets |
| `SALES_{AMAZON,BM,EBAY,ONBUY,TEMU}_TEMPLATE.xlsx` | One blank file per channel |
| `samples/INVENTORY_REPORT_SAMPLE.xlsx` | 120 rows — 110 office + 10 SHS |
| `samples/SALES_REPORT_SAMPLE.xlsx` | 100 sales across four marketplaces (AMAZON/BM/EBAY/ONBUY — the original round-robin sample; TEMU is exercised via its own template's example row, not this bulk sample, so the 100+ tests keyed to this exact file stay unaffected by the new channel) |
| `samples/SALES_{AMAZON,BM,EBAY,ONBUY}_SAMPLE.xlsx` | The same rows, split per channel |
| `samples/SHS_STOCK_SAMPLE.xlsx` | The 10 supplier-held rows |
| `samples/INVENTORY_EDGE_CASES.xlsx` | Awkward stock rows, each labelled |
| `samples/SALES_EDGE_CASES.xlsx` | Awkward sales rows, each labelled |
| `samples/RETURNS_REPORT_REFERENCE.xlsx` | Returns export shape (export only) |

Every template carries a **README sheet** documenting its own columns.

---

## 8. What keeps this document honest

These schemas are executable, not aspirational. If the code moves and this
document doesn't, a test fails:

| Suite | What it pins |
|---|---|
| `src/__tests__/lib/templates.test.ts` | Both templates parse through the real importers |
| `src/__tests__/lib/edgeCaseFiles.test.ts` | The labelled edge cases behave as labelled |
| `src/__tests__/lib/inventoryImportSheets.test.ts` | Multi-sheet stock parsing |
| `src/__tests__/lib/salesImportPerMarketplace.test.ts` | Per-channel column layouts |
| `scripts/e2eReportRoundTrip.mjs` | View matches the upload, cell by cell |
| `scripts/e2eBatchVsMarketplace.mjs` | Batch = per-channel; download rebuilds the system |
| `scripts/e2eTemplateDownloads.mjs` | The in-app buttons serve a real, current template |
| `scripts/e2eTemplateFillAndUpload.mjs` | The shipped templates, filled per this SOP, upload and reconcile |
| `scripts/e2eShsOrphanFlow.mjs` | §2.3 — an IMEI-less holding fulfilled through the orphan audit screen |

| `src/__tests__/lib/schemaAlignment.test.ts` | Export mirrors import; fallback indices point at the right columns |

Regenerate the files after a schema change:

```bash
node scripts/generateImportTemplates.mjs   # templates
node scripts/generateE2EWorkbooks.mjs      # samples/
```

---

## 9. Defects found while writing this document

Both were found by asking the question this document exists to answer: where
import and export differ, is the difference deliberate?

**AMAZON postage read the Comments column.** The positional fallback for
`postage` was index 14 — the Comments column — instead of 11. Fallbacks only
fire when header matching fails, so this never triggered on a well-formed
file. On a file with a renamed or stripped `Postage` header it parsed the
free-text Comments cell as the postage cost; `parseNumber` turns text into 0,
so postage silently became £0 and **GP was overstated by exactly the postage
on every row of that upload**. Fixed, and `schemaAlignment.test.ts` now checks
every fallback index in `SHEET_LAYOUTS` against the real template headers —
including that no two fields in a layout share an index, which is how this one
hid (postage and comments both claimed 14).

**Inventory export had Colour and SIM Type swapped** relative to the import
template. Nothing broke, because matching is by name — but an export that
cannot be read positionally is a trap for every tool that is not this
importer, and it is exactly the kind of drift that later becomes a real
column shift. The export now matches the template order.
