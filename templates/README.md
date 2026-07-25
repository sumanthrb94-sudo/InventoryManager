# Upload templates — the standard for every report

> **Column contracts live in [`REPORT_SCHEMAS.md`](REPORT_SCHEMAS.md)** — every
> import and export schema, header aliases, value domains, and the backup /
> restore procedure. This file covers how to use the templates; that one is
> the reference for what is in them.

Build every future inventory and sales report from these files. They match
the schemas the importers parse **and** the schemas the app exports, so a
file built from a template survives the full round trip:

```
export from the app  →  edit in Excel  →  re-import  →  same data, no loss
```

| File | Use it for |
|---|---|
| `INVENTORY_REPORT_TEMPLATE.xlsx` | Adding or updating stock in bulk (office **and** SHS) |
| `SHS_STOCK_TEMPLATE.xlsx` | **Marking supplier-held stock** — same importer, every row pre-set to SHS |
| `SALES_REPORT_TEMPLATE.xlsx` | Backfilling sales — combined workbook, one sheet per marketplace |
| `SALES_AMAZON_TEMPLATE.xlsx` etc. | **One file per channel** — the usual case, since marketplaces report separately |
| `samples/INVENTORY_REPORT_SAMPLE.xlsx` | 120 realistic rows (110 office + 10 SHS) — compare your file against it |
| `samples/SALES_REPORT_SAMPLE.xlsx` | 100 realistic sales across all four marketplaces |
| `samples/SALES_AMAZON_SAMPLE.xlsx` etc. | The same rows split per channel — 25-26 each |
| `samples/SHS_STOCK_SAMPLE.xlsx` | The 10 supplier-held rows the upload test drives |
| `samples/INVENTORY_EDGE_CASES.xlsx` | Every awkward stock row, each labelled with what should happen |
| `samples/SALES_EDGE_CASES.xlsx` | Every awkward sales row — bulk IMEIs, orphans, rejects |
| `samples/RETURNS_REPORT_REFERENCE.xlsx` | Returns export shape. **Export only — there is no returns importer** |

Templates are the *blank* standard to build from; samples are *filled* files at
realistic volume, and are the exact files the automated upload test drives.

Each template carries a **README sheet** documenting every column: required
or not, accepted values, and what the importer does with it. Read that sheet
before changing a header.

---

## The rules that matter most

**1. Delete the grey example rows.** They are illustrations, not data.

**2. Use the dropdown values, not your own.** Grade and SIM Type offer exactly
what the app's Add Stock screen offers. The dropdowns are helpers, not gates —
Excel will let you type something else, and the import will accept it, but a
value the app doesn't recognise won't group with anything on any screen.

**3. Never rename or reorder columns.** Headers are matched by name, with a
positional fallback. Rename one and the importer either drops the column or —
worse — reads the neighbouring column's values into it.

**4. Leave the derived money columns blank on sales.** The app recomputes
`SP-BP`, `Marginal Tax`, `Commission`, `ROF`, `FVF`, `VAT`, `GP` and `GP %`
from BP, SP, postage and the marketplace's current fee schedule. Anything
typed there is ignored. Fill in only what the marketplace actually gave you:
date, order number, IMEI, supplier, BP, SP, postage.

**5. Import inventory BEFORE sales.** Sales match stock by IMEI. Import in the
right order and units auto-match, flip to sold and link to their sale. Import
sales first and every unmatched row has to be completed by hand — the import
will not confirm until they are.

**6. Supplier-held stock needs the Stock Type column.** `SHS` in **Stock Type**
lands the unit as incoming, under SHS, not on the office shelf. Writing "SHS"
in **Notes** does nothing — that was the old workaround and it never worked.

**7. Re-uploading the same file is safe.** An IMEI already in the system
updates that unit; an order number + IMEI already recorded updates that sale.
Nothing duplicates, and a processed return is not undone by a re-import.

**8. Every stock sheet in the workbook is read.** The Inventory Report comes
back as **two** sheets — `Office Stock` and `SHS Stock` — and both are parsed
on the way back in, so a downloaded report re-imports complete. Sheets whose
header row has no Model + IMEI columns (Summary, Notes) are skipped, not
treated as bad data.

---

## Inventory report — column contract

`Stock In Date · Model · IMEI · Grade · Storage · SIM Type · Colour · Supplier · BP · Stock Type · Notes`

| Column | Required | Notes |
|---|---|---|
| Stock In Date | No | `yyyy-mm-dd`. Blank = today. |
| Model | **Yes** | e.g. `IPHONE 13 PRO`. Keep spelling consistent — it groups stock everywhere. |
| IMEI | **Yes** | 15 digits, or a 10–12 char Apple serial. Existing IMEI = update, new = create. |
| Grade | No | `A` `B` `C` `ONU` `Brand new` — exactly what the Add Stock screen offers. ONU = Open Never Used. |
| Storage | No | `64GB` `128GB` `256GB` `1TB` |
| SIM Type | No | `Physical SIM` `Physical SIM + eSIM` `Dual Physical SIM` `Not Applicable` (the app also allows a free-text `Other`) |
| Colour | No | Free text |
| Supplier | **Yes** | Matched case-insensitively; unknown names are created automatically. |
| BP | **Yes** | Must be > 0 — every profit figure depends on it. |
| Stock Type | No | `OFFICE` (default) or `SHS`. Also accepts `INCOMING`, `SUPPLIER`, `Y`, `YES`, `TRUE`, `1`. |
| Notes | No | Free text. |

### Viewing it back

**View** (the eye icon next to a report) shows the same workbook the
**Download** gives you, tab for tab — Office Stock and SHS Stock as separate
sheets, so supplier-held stock is never mixed into the shelf count. The row
tally in the footer is per sheet.

## Uploading one marketplace at a time

Marketplaces send their reports separately, so you rarely have a single
workbook with four sheets. In **Import → Sales Report**, pick the marketplace
before choosing the file:

- Only that marketplace's layout is applied — no guessing from the sheet name.
- The sheet does **not** have to be named `AMAZON`; with a marketplace selected
  the first sheet is used, so a raw channel export works as-is.
- The other three marketplaces are not looked for, so a single-channel upload
  no longer reports three "sheet missing" errors.
- Record ids are identical to the combined path, so uploading per-channel today
  and a combined file next month **updates the same rows** rather than
  duplicating them.

Leave the picker on **All marketplaces** for a combined four-sheet workbook.

**Both routes end in the same place.** Uploading the four channel files one at
a time and uploading the combined workbook produce an identical system —
same units sold, same stock left, same sale ids, same revenue to the penny.
`scripts/e2eBatchVsMarketplace.mjs` runs both and compares them unit for unit,
so the two paths can't drift apart unnoticed.

## Sales report — one sheet per marketplace

Column order differs per marketplace and is **not** interchangeable:

- **AMAZON** — 15 columns, date header is `nw`
- **BM** — 17 columns, `Payment Mode` inserted at position 9
- **EBAY** — 19 columns, postage is `SHIPPING`; values `1`, `2`, `8` are read as standard shipping tiers
- **ONBUY** — 15 columns, **no Quantity column**, so BP/SP sit one position further left

Required on every row: **date, order number, BP, SP**. IMEI is optional but
strongly recommended — without it a sale cannot match a unit.

Two behaviours worth knowing:

- **Bulk orders.** Several IMEIs in one cell separated by ` / ` are split into
  one row per phone, with BP and SP divided evenly.
- **Red rows.** Fill the Date or Order Number cell red and the sale imports as
  *flagged* and shows red across the app — the convention for returns, refunds,
  chargebacks and disputes. Cell fill is the only way to set it.

---

## Returns are not imported

There is no returns importer, by design — a return is a workflow, not a row.
Returns are created in-app through **Returns → Process Return**: step 1 Tech-QC
logs the customer complaint and the inspection, step 2 CRM picks the outcome
(Refund / Replacement / Repair / Return to supplier). Only then is the linked
sale voided.

`samples/RETURNS_REPORT_REFERENCE.xlsx` documents the shape the app **exports**
so a downloaded Returns Report can be checked against it. The live export has
three sheets — Summary, Returns Detail, Unit Histories.

| Field | Values |
|---|---|
| Return Type | `returned_to_inventory` · `repair` · `returned_to_supplier` |
| Outcome | `refund` · `replacement` · `repair` |
| Shipping Legs | refund and repair = 2 (out + back); replacement = 3 (out + back + replacement out) |
| Postage Loss £ | Leg Cost × Shipping Legs |

## Marking stock as SHS

`SHS_STOCK_TEMPLATE.xlsx` is the report for stock a supplier is **holding**
that has not arrived. It goes through the same importer as the Inventory
Report — there is only one stock importer — and the `Stock Type` column is
what makes the rows supplier-held. Units land as **incoming** and appear under
the SHS tile, never on the office shelf.

**IMEI is required, same as any stock row.** Without it, the sale that
eventually fulfils the unit has nothing to match. If the supplier has not sent
IMEIs yet, don't invent them.

**Supplier must be right.** It's how the SHS master row is matched when the
unit is later fulfilled.

An SHS unit leaves SHS in exactly three ways:

1. **It arrives** → Receive it (Buy → SHS tile → Receive). It becomes office stock.
2. **The supplier ships it straight to the customer** → it turns up on a Sales
   Report. The import marks it sold, keeps it tagged as an *SHS* sale, removes
   the placeholder and decrements the master row — so the SHS count drops.
3. **The supplier cancels** → an admin deletes it from the SHS overlay.

## Rebuilding the system from downloaded reports

The two reports together are a complete backup. Downloaded from a live
system and re-uploaded into an empty one, they reproduce it exactly —
verified end to end by `scripts/e2eBatchVsMarketplace.mjs`, which wipes a
28-office / 9-SHS / 93-sold / 101-sale system and rebuilds it to the same
figures, the same IMEIs and the same revenue to the penny.

**Download both BEFORE you wipe anything.** Both reports describe the state
at the moment you export them; after a wipe there is nothing left to export.

1. **Stock Intake → Inventory Report → All Time.** Two sheets, Office Stock
   and SHS Stock — everything still on hand.
2. **Sell → Sales Report → All Time.** Every sale, one sheet per marketplace.

To restore, upload in this order:

1. **Inventory Report first.** Stock has to exist before a sale can match it.
2. **Sales Report second.** Each row finds its unit by IMEI, marks it sold and
   restores the sale. Record ids are rebuilt from marketplace + order number +
   IMEI, so the sales that come back are the same records, not copies.

Get the order wrong and every sale row arrives as an orphan needing manual
completion — nothing is lost, but you will re-key what the file already knew.

**What the Inventory Report does not carry:** sold units. It is a stock
report — what you hold, not what you have held. Sold units come back from the
Sales Report, which is why a full restore needs both files.

## Model names are decided in Configuration

Create the canonical model name once, under **Admin → Configuration**. That
spelling is then applied automatically on every inventory import, so data
arrives consistent and never needs cleaning up afterwards. Models absent from
the catalog import exactly as typed. (The old manual "Reconcile Models" screen
was removed once this became automatic.)

## Testing error handling

The two `*_EDGE_CASES.xlsx` files carry one row per awkward shape, with the
expected outcome written in the row's own Notes / Comments cell:

- **Inventory** — blank date, missing Model / IMEI / Supplier, BP of 0, a
  malformed IMEI, an Apple alphanumeric serial, a duplicate IMEI, free-text
  Grade and SIM, and `incoming` as an alias for SHS.
- **Sales** — a matching sale, an SHS fulfilment, an orphan IMEI, a bulk order
  with two IMEIs in one cell, a sale with no IMEI, a row with neither order
  number nor IMEI, a bad date, a missing BP, a duplicate order and a blank
  postage cell.

Upload one and the preview should reject exactly the rows labelled REJECTED
and accept the rest. `src/__tests__/lib/edgeCaseFiles.test.ts` reads those
labels and checks the parsers agree with them, so the files can't drift into
documenting behaviour the code doesn't have.

## Regenerating

```bash
node scripts/generateImportTemplates.mjs   # templates
node scripts/generateE2EWorkbooks.mjs      # samples/
```

`src/__tests__/lib/templates.test.ts` runs both templates through the real
parsers on every test run, so if a schema moves and the templates don't, the
test suite fails here — not an operator's upload.
