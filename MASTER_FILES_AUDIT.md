# Master Files Production-Readiness Audit (Firestore edition)
**Scope:** Can InventoryManager (a) load the client's two live master Excel files unchanged, (b) operate on them daily, (c) re-emit them in identical Excel format every evening?
**Verdict:** **NOT production-ready. 11 blockers + multiple high-severity gaps must be resolved before go-live.**
**Stack:** Firebase Auth + Firestore (NoSQL) + imgbb image storage. No SQL database, no API tier — frontend writes to Firestore directly via `src/lib/dbService.ts`. The Vercel `api/` directory and `src/lib/supabase*.ts` were removed (dead code) — see `2026-05-16` cleanup commit.

Source spec extracted from the two client files is in `MASTER_FILES_SPEC.md` (every sheet, every header, every formula).

---

## 1. Client master file shape (ground truth)

### `INVENTORY_REPORT_2026_1.xlsx` (87 KB, 3 sheets)
| Sheet | Rows | Key shape findings |
|---|---|---|
| `INVENTORY` | 286 | Headers have **trailing spaces** (`MODEL `, `QUANTITY `). QUANTITY is **mixed type** — floats AND strings (`SHS`, `NO STOCK`). VALUE is a live formula `=B2*C2`. COLOURS is a **compound string** (`GREY 2 SILVER 0`, `BLUE 3 LAVENDER 2 MINT 5 RED 1`). SUPPLIER allows **multi-value** (`MHL / ABC / NIHAL`). Unlabeled col D used for status notes. |
| `IMEI NUMBERS` | 855 | IMEI col carries 15-digit ints **and** alphanumeric serials (`NL6CMQCYTD`, `SKC9P3QVP6F`). STATUS = `FBA`/`SOLD`/`R T S`. MARKETPLACE = Back Market/Amazon/eBay/OnBuy/FBA/**Project**/R T S. Dates fmt `mm/dd/yyyy`. |
| `SUPPLIER WHATSAPP UPDATES` | 11 | Free-form supplier feed + price column (`£85`, `£100`). |

### `SALES_REPORT_2026.xlsx` (289 KB, 5 sheets — one per marketplace)
| Sheet | Rows | Distinctive cols / formulas |
|---|---|---|
| `AMAZON` | 1 000 | 15 cols. Commission `=H/100*7.14`, Postage £8. Date fmt `[$-409]d\-mmm\-yyyy`. |
| `BM` (Back Market) | 316 | 17 cols. **Extra `Payment Mode` col** (Paypal/PayPal/Googlepay/Clear Pay/Klarna/Google Pay/Clearpay/ApplePay — casing preserved). Conditional `PayPal/Klarna Com = SP*2.5%`. Commission 12%, Postage £10. |
| `EBAY` | 997 | 19 cols. **One header is the literal number `0.2`**. MAR TAX 16.6%, COM `(SP*6.9%)-(SP*6.9%)*10%`, ROF 0.35%, FVF £0.40, VAT bundle 20%, `NP(incl. PROMOTION) = Q-H*5%`. |
| `ONBUY` | 231 | 15 cols. **No QUANT column.** COM 7%, VAT 20%, SHIP £8. |
| `PROJECT` | 460 | 15 cols. POST £5.90. **"Project" marketplace not in app enum.** |

---

## 2. BLOCKERS (cannot ship)

| # | Blocker | Evidence | Why it blocks |
|---|---------|----------|---------------|
| B1 | **No multi-sheet Excel writer.** Only PDF + CSV. | `src/lib/pdfReport.ts:711`, `src/components/ReportingPage.tsx:17-38`; `xlsx@0.18.5` (SheetJS-CE) listed in `package.json` — only used for reads / mock data in `LoadMockDataModal.tsx:116-146` (writes `Summary`/`Units`/`Suppliers`, none of the marketplace sheets) | Daily download requirement cannot be met. SheetJS-CE additionally cannot reliably write formulas + cell formats — **must install `exceljs`** (already added to package.json). |
| B2 | **No `Sale` entity / `sales` collection.** Sales fields denormalised onto `inventoryUnits` documents (`sale_price`, `sale_date`, `sale_platform`, `sale_order_id`). | `src/types.ts:74-85`, `src/lib/dbService.ts` `COL` map | Cannot hold the ~3 000 historical sales rows across 5 marketplaces, nor capture per-marketplace fee fields (PayPal/Klarna, ROF, FVF, MAR VAT, MAR TAX, NP). |
| B3 | **Sheet-aware sales importer missing.** Reader picks ONE sheet (`OG STOCK DATA` or first); does not loop AMAZON/BM/EBAY/ONBUY/PROJECT. | `src/components/ImportModal.tsx:305`, `import_excel.cjs:102 resolveSheet`, `convert_excel.py:160` | 5-marketplace sales workbook cannot be ingested. |
| B4 | **IMEI parsing strips alphanumeric serials.** `normalizeImei` does `.replace(/\D/g,'')` so `NL6CMQCYTD` → `""`. | `src/components/ImportModal.tsx:48,225`, `import_excel.cjs:268`, `convert_excel.py:306`; `src/lib/dbService.ts:247` also gates `imei.length < 14` | Apple serials silently discarded; duplicates created on re-import. |
| B5 | **All five marketplace fee constants wrong.** Required vs current: Amazon 7.14 vs `8.0`; BM 12 vs `10.0` (no PayPal/Klarna 2.5%); eBay 6.9%×0.9 vs `12.8` (no ROF/FVF/VAT/promo); OnBuy 7 vs `9.0`; Project 7.14 + £5.90 absent. | `src/lib/platforms.ts:26-63`, `DEFAULT_POSTAGE_COST=8` at `:10` | GP calculations are wrong today; daily report would propagate the error. |
| B6 | **`ListingSite` enum lacks `Project`, `FBA`, `R T S`; uses `Backmarket` not `Back Market`.** | `src/types.ts:4`; hard-coded lists in `BulkListingModal.tsx:9`, `ScanPage.tsx:14`, `UnitDetailDrawer.tsx:17`, `ViewAllUnitsModal.tsx:16` | Importing the IMEI sheet loses MARKETPLACE/STATUS values. |
| B7 | **Multi-supplier (`MHL / ABC / NIHAL`) truncated** to first token. | `src/components/ImportModal.tsx:101`, `import_excel.cjs:288`, `convert_excel.py:308`; single `supplierId` at `src/types.ts:59` | Inventory rows lose supplier provenance. |
| B8 | **`QUANTITY` mixed-type only partially handled.** `SHS` recognised; `NO STOCK` (and other tags) fall through `parseFloat→0` and the row is dropped at `if (!bp && qtyRaw !== 'SHS')`. | `src/components/ImportModal.tsx:106,108` | Rows representing zero-stock placeholders silently lost. |
| B9 | **Importer never assigns a batch number to imported rows.** `importId = import_${Date.now()}` is attached only to the source-file event, never propagated to imported rows. `generateBatchId()` exists in `batchUtils.ts:7` but is unused by importers. | `src/components/ImportModal.tsx:400`, `import_excel.cjs:313-339` | Violates user requirement: "batch wise number and SQL time of creation". |
| B10 | **`createdAt` set client-side, not by Firestore.** `nowIso() = new Date().toISOString()` everywhere. Should use Firestore `serverTimestamp()` so all timestamps are authoritative regardless of client clock. | `src/lib/dbService.ts:90,103,153,164,191` | Audit trail untrustworthy; clock-skew across users; no immutable "server time of creation". |
| B11 | **No date-range query helper.** Today's-changes computed in JS over the full collection after pulling every document. | `Dashboard.tsx:40-43`, `StockInPage.tsx:38,110`, `SellPage.tsx:405,423`, `PeriodicInventory.tsx:312-314`, `Sales.tsx:51-59` | Daily report cannot scale; no Firestore composite indexes on `importedAt`/`saleDate`. |

---

## 3. HIGH-severity gaps

| Gap | Evidence | Fix |
|-----|----------|-----|
| Compound `COLOURS` like `"GREY 2 SILVER 0"` only parseable in `parseClientBulkSheet`; main `parseOGStockSheet` / `import_excel.cjs` / `convert_excel.py` treat colour as opaque string | `src/components/ImportModal.tsx:51-58, 199`, `import_excel.cjs:186 parseColour`, `convert_excel.py:203` | Promote `parseColoursAndQty(s)` to all readers; store as `coloursMap` field on `inventoryAggregates` document. |
| `ModelSummary` cannot WRITE the compound string back | `src/lib/modelSummaries.ts:23-34`, `src/components/ReportingPage.tsx:124,190` (joins with `'; '`) | Add `buildColourString(variants) → "GREY 2 SILVER 0"` for export. |
| BM `paymentMode` not in schema/UI | repo-wide grep: 0 hits | Add `paymentMode` string field on `sales` documents, capture from col I. |
| Re-import dedupe for sales | IMEI-only dedupe (`ImportModal.tsx:346-371`) — sales merged into `inventoryUnits` by IMEI which may be blank/alphanumeric | Use composite document ID `${marketplace}__${orderNumber}` on `sales` collection (Firestore upsert on this key is atomic). |
| `SUPPLIER WHATSAPP UPDATES` sheet not captured anywhere | grep: 0 hits | New `supplierWhatsappUpdates` collection, paste-in UI on `Suppliers.tsx`. |
| No `from/to` date filter in ReportingPage | `src/components/ReportingPage.tsx:43,55-57` single-day picker | Replace with range picker bound to Firestore `where('importedAt', '>=', from).where('importedAt', '<=', to)`. |
| No status value for `ready_to_ship` / `fba` | `src/types.ts:3` | Extend `DeviceStatus` OR move STATUS to free-text `statusRaw`. |
| `BP * QUANTITY = VALUE` not emitted as formula | `src/components/ReportingPage.tsx:184-196` | Use exceljs `cell.value = { formula: 'B2*C2' }`. |

---

## 4. MEDIUM-severity gaps

- Trailing-space headers (`MODEL `, `QUANTITY `) — readers `trim()` for matching (`import_excel.cjs:133`, `ImportModal.tsx:78,167`) which is fine for import but writers must re-emit the literal spaces.
- EBAY literal `0.2` header (numeric, not string) will fail alias matching once writes are wired (`ImportModal.tsx:78`).
- ONBUY has no `QUANT` column — parsers assume it exists (`ImportModal.tsx:99`).
- Cached formulas (`=B2*C2`) not preserved on round-trip; only computed values read (`import_excel.cjs:391`).
- `batchUtils.generateBatchId()` is client-side `new Date()` → clock-skew collision risk (`src/lib/batchUtils.ts:7-28`). Switch to Firestore-assigned `doc().id` (auto-id) plus a human label.
- Multi-supplier join uses `, ` instead of ` / ` in current export (`ReportingPage.tsx:149`).

---

## 5. Required Firestore collections (new — no migration; collections exist on first write)

```
importBatches (doc id = auto)
  sourceFile        string                — e.g. "INVENTORY_REPORT_2026_1.xlsx"
  sourceSheet       string                — e.g. "IMEI NUMBERS"
  rowCount          number
  supplierId        string?               — null for sales workbooks
  importedBy        string                — uid or "shared"
  importedAt        Timestamp (server)    — serverTimestamp()
  notes             string?

sales (doc id = `${marketplace}__${orderNumber}` for natural dedupe)
  marketplace       string                — "AMAZON"|"BM"|"EBAY"|"ONBUY"|"PROJECT"
  orderNumber       string
  sku               string?
  imei              string?               — alphanumeric ok, may be empty
  unitId            string?               — link to inventoryUnits when matched
  supplierId        string?
  supplierName      string?               — denormalised for fast filtering
  saleDate          string (ISO yyyy-mm-dd)
  quantity          number                — default 1
  buyPrice          number
  salePrice         number
  paymentMode       string?               — BM only; preserve original casing
  spMinusBp         number
  marginalTax       number
  commission        number
  payPalKlarnaCom   number?               — BM
  rof               number?               — eBay
  fvf               number?               — eBay
  twentyPercent     number?               — eBay
  totalCom          number?               — eBay
  vat20             number?               — OnBuy / eBay
  marVat            number?               — OnBuy
  postage           number
  grossProfit       number
  gpPercent         number
  netProfit         number?               — eBay incl. promo
  comments          string?
  importBatchId     string                — doc id of importBatches row
  sourceFile        string
  sourceRow         number
  importedAt        Timestamp (server)
  createdAt         Timestamp (server)
  updatedAt         Timestamp (server)
  ownerId           string

marketplaceFees (doc id = marketplace name)
  commissionPct           number
  commissionReductionPct  number          — eBay 10
  fixedFee                number          — eBay FVF 0.40
  postage                 number          — £8 / £10 / £8 / £5.90
  marginTaxDivisor        number?         — 6 for Amazon/BM/OnBuy/Project
  payPalKlarnaPct         number?         — BM 2.5
  rofPct                  number?         — eBay 0.35
  vatPct                  number?         — 20 (OnBuy margin; eBay fees)
  promoPct                number?         — eBay 5

  Seed values:
    AMAZON   { commissionPct: 7.14, postage: 8.00, marginTaxDivisor: 6 }
    BM       { commissionPct: 12.00, postage: 10.00, marginTaxDivisor: 6, payPalKlarnaPct: 2.5 }
    EBAY     { commissionPct: 6.90, commissionReductionPct: 10, fixedFee: 0.40, postage: 8.00, rofPct: 0.35, vatPct: 20, promoPct: 5 }
    ONBUY    { commissionPct: 7.00, postage: 8.00, marginTaxDivisor: 6, vatPct: 20 }
    PROJECT  { commissionPct: 7.14, postage: 5.90, marginTaxDivisor: 6 }

inventoryAggregates (doc id = auto)         — for the INVENTORY sheet (model+supplier roll-ups)
  model              string                — preserve original casing
  buyPrice           number?
  quantityNum        number?
  quantityText       string?               — "SHS" | "NO STOCK" | other
  notesFlag          string?               — column D ("SALES FOCUS" etc.)
  coloursMap         { [colour: string]: number }  — { GREY: 2, SILVER: 0 }
  coloursRaw         string                — original "GREY 2 SILVER 0" verbatim
  supplierIds        string[]              — multi-supplier
  notes              string?
  importBatchId      string
  sourceRow          number
  ownerId            string
  createdAt          Timestamp (server)
  updatedAt          Timestamp (server)

supplierWhatsappUpdates (doc id = auto)
  supplierId   string?                     — best-effort link
  rawText      string                      — full pasted line
  priceText    string?                     — "£85"
  postedAt     Timestamp (server)
  ownerId      string
```

### Firestore changes to existing `inventoryUnits` documents (additive — no migration script; new fields appear as units get re-saved)
Add fields:
- `importBatchId: string`
- `sourceFile: string`
- `sourceRow: number`
- `importedAt: Timestamp (server)`
- `statusRaw: string` — preserve "R T S" verbatim
- `marketplace: string` — "FBA" | "Project" | "Back Market" (free text)
- `stockOutDate: string (ISO)`
- `sku: string`
- `supplierIds: string[]` — multi-supplier (`supplierId` becomes the primary, `supplierIds` the full list)

### `firestore.indexes.json` — add composite indexes
```
inventoryUnits: (ownerId ASC, importedAt DESC)
inventoryUnits: (ownerId ASC, updatedAt DESC)
inventoryUnits: (ownerId ASC, dateIn DESC)
inventoryUnits: (ownerId ASC, importBatchId ASC, importedAt DESC)
sales:          (ownerId ASC, saleDate DESC)
sales:          (ownerId ASC, marketplace ASC, saleDate DESC)
sales:          (ownerId ASC, importedAt DESC)
sales:          (ownerId ASC, importBatchId ASC)
importBatches:  (ownerId ASC, importedAt DESC)
```

### `firestore.rules` — add per-collection allow for the new collections (mirror existing inventoryUnits rules: ownerId === request.auth.uid OR ownerId === 'shared').

---

## 6. Required code changes (ordered punch list)

1. `package.json` — add `exceljs ^4.4.0` (done in this commit). SheetJS-CE cannot write formulas+formats reliably.
2. `src/lib/platforms.ts` — replace `PLATFORMS` constants with `MARKETPLACE_FEES` keyed by sheet name; load from Firestore `marketplaceFees` at boot with code-side defaults as fallback.
3. `src/types.ts` — add `Sale` and `ImportBatch` and `InventoryAggregate` interfaces; extend `ListingSite` with `'Back Market' | 'FBA' | 'Project' | 'R T S'` OR move to free-text `marketplace: string` everywhere.
4. `src/lib/dbService.ts:247` — relax `imei.length < 14` gate; accept any non-empty string.
5. `src/components/ImportModal.tsx:48` & `import_excel.cjs:268` & `convert_excel.py:306` — stop `replace(/\D/g, '')` on IMEI; preserve raw string. Read xlsx with `{raw: true, cellText: true}` so 15-digit integers arrive as strings (no scientific notation).
6. `ImportModal.tsx:101` — split supplier on `/`, store `supplierIds: string[]` (keep `supplierId` as the primary).
7. `ImportModal.tsx:106` — add `parseQuantityCell()` returning either `{qty}` or `{flag: 'SHS'|'NO_STOCK'|'OTHER', raw}` instead of dropping rows.
8. New `src/lib/salesImport.ts::parseSalesWorkbook(wb)` — loops `['AMAZON','BM','EBAY','ONBUY','PROJECT']`, switches column layout per sheet, returns canonical `Sale[]` (BM captures `paymentMode`).
9. Wire `importBatches` doc creation into `ImportModal.processFile` BEFORE bulk write; tag every unit/sale with `importBatchId`, `sourceFile`, `sourceRow`.
10. New `src/lib/clientReport.ts::downloadClientWorkbooks(units, suppliers, whatsappFeed, sales, {from, to})` — produces two workbooks via `exceljs`:
    * `INVENTORY_REPORT_YYYY_M.xlsx` (3 sheets, headers preserve trailing spaces, col E formula `=B${r}*C${r}`, col F compound colour string via `buildColourString()`, col G suppliers joined ` / `, dates `mm/dd/yyyy`, IMEI col `numFmt: '0'`).
    * `SALES_REPORT_YYYY.xlsx` (5 sheets per marketplace; emits per-sheet formulas pulled from `MARKETPLACE_FEES`; dates `[$-409]d\-mmm\-yyyy`; money `0.00`; EBAY header includes literal numeric `0.2`).
11. New `src/lib/changesQuery.ts` — `getChangesInRange(from, to)` using Firestore `where('importedAt', '>=', from).where('importedAt', '<=', to)`; rely on the new composite indexes.
12. New `src/components/ExcelReportButton.tsx` sitting beside `PDFReportButton`, triggers `downloadClientWorkbooks(...)`.
13. Replace every `createdAt: nowIso()` / `updatedAt: nowIso()` in `src/lib/dbService.ts` with Firestore `serverTimestamp()` (import from `firebase/firestore`); also wire `importedAt: serverTimestamp()` on bulk inserts.
14. Add `parseColoursAndQty` to `parseOGStockSheet`, `import_excel.cjs::parseWorksheet`, `convert_excel.py::parse_sheet` so compound colours survive the master-sheet path too.
15. Update `generate_sample_excel.mjs` to emit a 5-sheet sales sample matching this spec for QA round-trip tests.
16. Update `firestore.indexes.json` and `firestore.rules`; deploy via `firebase deploy --only firestore:indexes,firestore:rules`.

---

## 7. What is already PASS

- Per-unit IMEI tracking (`InventoryUnit` shape covers most fields).
- ISO date storage for `dateIn` / `saleDate`.
- IMEI dedupe path (just needs to stop stripping non-digits and to drop the length gate).
- `parseClientBulkSheet` already understands compound COLOURS (just needs to be the default parser).
- Supplier collection exists with NIHAL / MHL / IMAX / NANAK / ABC / RR STOCK (matches client data).
- `generateBatchId()` helper exists in `batchUtils.ts` — just needs to be called by the importers.
- Firebase Auth + Firestore + imgbb already wired and working.

---

## 8. Production go-live readiness

| Phase | Status |
|---|---|
| Load INVENTORY sheet today, as-is | ❌ blocked (B4, B7, B8) |
| Load IMEI NUMBERS sheet today, as-is | ❌ blocked (B4, B6) |
| Load SALES workbook today, as-is | ❌ blocked (B2, B3, B4, B5, B6) |
| Operate daily with batch + server-timestamp audit | ❌ blocked (B9, B10, B11) |
| Re-emit identical Excel daily | ❌ blocked (B1) |

**Estimated effort to round-trip parity:** Firestore type/lib changes + indexes (~½ day), importer refactor + `exceljs` writer (~2–3 days), test against the two live files (~½ day). Total: ~4 working days.

---

*Generated by surgical parallel audit (4 agents) against the live client files INVENTORY_REPORT_2026_1.xlsx and SALES_REPORT_2026.xlsx on 2026-05-16. Full extracted spec: `MASTER_FILES_SPEC.md`.*
