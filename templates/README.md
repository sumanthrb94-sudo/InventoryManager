# Upload templates — the standard for every report

Build every future inventory and sales report from these files. They match
the schemas the importers parse **and** the schemas the app exports, so a
file built from a template survives the full round trip:

```
export from the app  →  edit in Excel  →  re-import  →  same data, no loss
```

| File | Use it for |
|---|---|
| `INVENTORY_REPORT_TEMPLATE.xlsx` | Adding or updating stock in bulk (office **and** SHS) |
| `SALES_REPORT_TEMPLATE.xlsx` | Backfilling sales — combined workbook, one sheet per marketplace |
| `SALES_AMAZON_TEMPLATE.xlsx` etc. | **One file per channel** — the usual case, since marketplaces report separately |
| `samples/INVENTORY_REPORT_SAMPLE.xlsx` | 120 realistic rows (110 office + 10 SHS) — compare your file against it |
| `samples/SALES_REPORT_SAMPLE.xlsx` | 100 realistic sales across all four marketplaces |
| `samples/SALES_AMAZON_SAMPLE.xlsx` etc. | The same rows split per channel — 25-26 each |
| `samples/RETURNS_REPORT_REFERENCE.xlsx` | Returns export shape. **Export only — there is no returns importer** |

Templates are the *blank* standard to build from; samples are *filled* files at
realistic volume, and are the exact files the automated upload test drives.

Each template carries a **README sheet** documenting every column: required
or not, accepted values, and what the importer does with it. Read that sheet
before changing a header.

---

## The rules that matter most

**1. Delete the grey example rows.** They are illustrations, not data.

**2. Never rename or reorder columns.** Headers are matched by name, with a
positional fallback. Rename one and the importer either drops the column or —
worse — reads the neighbouring column's values into it.

**3. Leave the derived money columns blank on sales.** The app recomputes
`SP-BP`, `Marginal Tax`, `Commission`, `ROF`, `FVF`, `VAT`, `GP` and `GP %`
from BP, SP, postage and the marketplace's current fee schedule. Anything
typed there is ignored. Fill in only what the marketplace actually gave you:
date, order number, IMEI, supplier, BP, SP, postage.

**4. Import inventory BEFORE sales.** Sales match stock by IMEI. Import in the
right order and units auto-match, flip to sold and link to their sale. Import
sales first and every unmatched row has to be completed by hand — the import
will not confirm until they are.

**5. Supplier-held stock needs the Stock Type column.** `SHS` in **Stock Type**
lands the unit as incoming, under SHS, not on the office shelf. Writing "SHS"
in **Notes** does nothing — that was the old workaround and it never worked.

**6. Re-uploading the same file is safe.** An IMEI already in the system
updates that unit; an order number + IMEI already recorded updates that sale.
Nothing duplicates, and a processed return is not undone by a re-import.

---

## Inventory report — column contract

`Stock In Date · Model · IMEI · Grade · Storage · SIM Type · Colour · Supplier · BP · Stock Type · Notes`

| Column | Required | Notes |
|---|---|---|
| Stock In Date | No | `yyyy-mm-dd`. Blank = today. |
| Model | **Yes** | e.g. `IPHONE 13 PRO`. Keep spelling consistent — it groups stock everywhere. |
| IMEI | **Yes** | 15 digits, or a 10–12 char Apple serial. Existing IMEI = update, new = create. |
| Grade | No | `A+ A B+ B C` |
| Storage | No | `64GB` `128GB` `256GB` `1TB` |
| SIM Type | No | `Physical SIM` `eSIM` `Dual SIM` `Not Applicable` |
| Colour | No | Free text |
| Supplier | **Yes** | Matched case-insensitively; unknown names are created automatically. |
| BP | **Yes** | Must be > 0 — every profit figure depends on it. |
| Stock Type | No | `OFFICE` (default) or `SHS`. Also accepts `INCOMING`, `SUPPLIER`, `Y`, `YES`, `TRUE`, `1`. |
| Notes | No | Free text. |

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

## Model names are decided in Configuration

Create the canonical model name once, under **Admin → Configuration**. That
spelling then wins everywhere: Model Reconciliation proposes the catalog name
even when more units are spelled some other way, so applying it is permanent
and the same cluster does not re-open after the next import. Reconciliation
only falls back to a majority vote for models that are not in the catalog.

## Regenerating

```bash
node scripts/generateImportTemplates.mjs   # templates
node scripts/generateE2EWorkbooks.mjs      # samples/
```

`src/__tests__/lib/templates.test.ts` runs both templates through the real
parsers on every test run, so if a schema moves and the templates don't, the
test suite fails here — not an operator's upload.
