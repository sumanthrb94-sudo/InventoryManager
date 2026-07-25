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
| 3 | IMEI | **Yes** | 15 digits, or a 10–12 char Apple serial |
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

An SHS unit leaves SHS in exactly three ways:

1. It arrives → Receive it (Buy → SHS tile → Receive) → becomes office stock.
2. The supplier ships direct to the customer → it appears on a Sales Report →
   marked sold, tagged as an SHS sale, placeholder removed, master row
   decremented.
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

**Six sheets:** `Summary · Returns · AMAZON · BM · EBAY · ONBUY`

The four marketplace sheets carry the import columns plus computed VAT/fee
columns and a trailing return-linkage block. Column counts: AMAZON 28,
BM 25, EBAY 31, ONBUY 25.

Common leading block, every marketplace:

```
Date | Order Number | SKU | IMEI | Supplier | [Quantity] | BP | SP | SP-BP |
Marginal Tax | Commission | …fees… | Postage | P. VAT | Accessories |
[Total VAT] | GP | GP % | Total VAT NTP | Comments
```

Trailing return-linkage block, every marketplace:

```
Return Date | Outcome | Return Reason | Shipping Legs | Postage Loss | Net GP £
```

Marketplace-specific fee columns:

| Marketplace | Extra columns |
|---|---|
| AMAZON | `C. VAT` `DSF` `DSF. VAT` |
| BM | `Customer Care Fees` |
| EBAY | `ROF` `FVF` `VAT` `T.COM` `Marketing` `M. VAT` — and `Units`, not `Quantity` |
| ONBUY | `VAT 20%` — and no Quantity column |

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
| Shipping Legs | refund / repair / to-supplier = 2 (out + back); replacement = 3 |
| Postage Loss £ | Leg Cost × Shipping Legs |

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
| `SALES_REPORT_TEMPLATE.xlsx` | Blank combined workbook, four sheets |
| `SALES_{AMAZON,BM,EBAY,ONBUY}_TEMPLATE.xlsx` | One blank file per channel |
| `samples/INVENTORY_REPORT_SAMPLE.xlsx` | 120 rows — 110 office + 10 SHS |
| `samples/SALES_REPORT_SAMPLE.xlsx` | 100 sales across four marketplaces |
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
