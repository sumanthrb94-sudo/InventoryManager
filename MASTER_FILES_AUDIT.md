# Master Files Production-Readiness Audit
**Scope:** Can InventoryManager (a) load the client's two live master Excel files unchanged, (b) operate on them daily, (c) re-emit them in identical Excel format every evening?
**Verdict:** **NO — not production-ready. 11 blockers + multiple high-severity gaps must be resolved before go-live.**

Method: four parallel surgical audits — data model, Excel I/O round-trip, batch+SQL timestamps, daily-download pipeline. Source spec extracted from the two client files is in `/tmp/CLIENT_FILES_SPEC.md` (every sheet, every header, every formula).

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
| B1 | **No multi-sheet Excel writer.** Only PDF + CSV. | `src/lib/pdfReport.ts:711`, `src/components/ReportingPage.tsx:17-38`; `xlsx@0.18.5` (SheetJS-CE) listed in `package.json:70` — only used for reads / mock data in `LoadMockDataModal.tsx:116-146` (writes `Summary`/`Units`/`Suppliers`, none of the marketplace sheets) | Daily download requirement cannot be met. SheetJS-CE additionally cannot reliably write formulas + cell formats — **must install `exceljs`**. |
| B2 | **No `Sale` entity.** Sales fields denormalised onto `inventory_units` (`sale_price`, `sale_date`, `sale_platform`, `sale_order_id`). | `src/types.ts:74-85`, `reseed.sql:19-20`, `api/inventory.ts:29` | Cannot hold the ~3 000 historical sales rows across 5 marketplaces, nor capture per-marketplace fee fields (PayPal/Klarna, ROF, FVF, MAR VAT, MAR TAX, NP). |
| B3 | **Sheet-aware sales importer missing.** Reader picks ONE sheet (`OG STOCK DATA` or first); does not loop AMAZON/BM/EBAY/ONBUY/PROJECT. | `src/components/ImportModal.tsx:305`, `import_excel.cjs:102 resolveSheet`, `convert_excel.py:160` | 5-marketplace sales workbook cannot be ingested. |
| B4 | **IMEI parsing strips alphanumeric serials.** `normalizeImei` does `.replace(/\D/g,'')` so `NL6CMQCYTD` → `""`. | `src/components/ImportModal.tsx:48,225`, `import_excel.cjs:268`, `convert_excel.py:306`; `src/lib/dbService.ts:247` also gates `imei.length < 14` | Apple serials silently discarded; duplicates created on re-import. |
| B5 | **All five marketplace fee constants wrong.** Required vs current: Amazon 7.14 vs `8.0`; BM 12 vs `10.0` (and no PayPal/Klarna 2.5%); eBay 6.9% net-of-10% vs `12.8` (no ROF/FVF/VAT breakdown); OnBuy 7 vs `9.0`; Project 7.14 + £5.90 entirely absent. | `src/lib/platforms.ts:26-63`, `DEFAULT_POSTAGE_COST=8` at `:10` | GP calculations are wrong today; daily report would propagate the error. |
| B6 | **`ListingSite` enum lacks `Project`, `FBA`, `R T S`; uses `Backmarket` not `Back Market`.** | `src/types.ts:4`; hard-coded lists in `BulkListingModal.tsx:9`, `ScanPage.tsx:14`, `UnitDetailDrawer.tsx:17`, `ViewAllUnitsModal.tsx:16` | Importing the IMEI sheet loses MARKETPLACE/STATUS values. |
| B7 | **Multi-supplier (`MHL / ABC / NIHAL`) truncated** to first token. | `src/components/ImportModal.tsx:101`, `import_excel.cjs:288`, `convert_excel.py:308`; single `supplierId` FK at `src/types.ts:59` | Inventory rows lose supplier provenance. |
| B8 | **`QUANTITY` mixed-type only partially handled.** `SHS` recognised; `NO STOCK` (and other tags) fall through `parseFloat→0` and row is dropped at `if (!bp && qtyRaw !== 'SHS')`. | `src/components/ImportModal.tsx:106,108` | Rows representing zero-stock placeholders are silently lost. |
| B9 | **Importer assigns no `batch_id`.** `importId = import_${Date.now()}` is tagged only on the source-file event, never propagated to imported rows. `generateBatchId()` exists in `batchUtils.ts:7` but importers never call it. | `src/components/ImportModal.tsx:400`, `import_excel.cjs:313-339` | Violates user requirement: "we have batch wise number and sql time of creation". |
| B10 | **`created_at` set client-side, not by DB.** `nowIso() = new Date().toISOString()` everywhere; no `DEFAULT NOW()` on `inventory_units`. | `src/lib/dbService.ts:90,103,153,164,191`; `api/inventory.ts:48`, `api/inventory/[id].ts:39`, `api/shs.ts:51`; `reseed.sql:20` passes literal timestamps | Audit trail untrustworthy; clock-skew across users; no immutable "sql time of creation". |
| B11 | **No date-range query API.** Today's-changes computed in JS over the full collection (`Dashboard.tsx:40-43`, `StockInPage.tsx:38,110`, `SellPage.tsx:405,423`, `PeriodicInventory.tsx:312-314`, `Sales.tsx:51-59`). | — | Daily report cannot scale to a year of sales; no index on `imported_at`/`updated_at`. |

---

## 3. HIGH-severity gaps

| Gap | Evidence | Fix |
|-----|----------|-----|
| Compound `COLOURS` like `"GREY 2 SILVER 0"` parseable only in `parseClientBulkSheet`; main `parseOGStockSheet` / `import_excel.cjs` / `convert_excel.py` treat colour as opaque string | `src/components/ImportModal.tsx:51-58, 199`, `import_excel.cjs:186 parseColour`, `convert_excel.py:203` | Promote `parseColoursAndQty(s)` to all readers; store as `inventory_aggregate_colours` join. |
| `ModelSummary` cannot WRITE the compound string back | `src/lib/modelSummaries.ts:23-34`, `src/components/ReportingPage.tsx:124,190` (joins with `'; '`) | Add `buildColourString(variants) → "GREY 2 SILVER 0"` for export. |
| BM `Payment Mode` not in schema/UI | repo-wide grep: 0 hits | Add `payment_mode TEXT` on sales, capture from col I. |
| Re-import dedupe key for sales | IMEI-only dedupe (`ImportModal.tsx:346-371`) — sales merged into inventory_units by IMEI which may be blank/alphanumeric | UNIQUE `(marketplace, order_number)` on sales table. |
| `SUPPLIER WHATSAPP UPDATES` sheet not captured anywhere | grep: 0 hits | New table `supplier_whatsapp_updates`, paste-in UI on `Suppliers.tsx`. |
| No `from/to` date filter in ReportingPage | `src/components/ReportingPage.tsx:43,55-57` single-day picker | Replace with range picker bound to `imported_at`/`sale_date`. |
| Sales dedupe forces duplicates on re-upload | no UNIQUE constraint, IMEI-only check | Add UNIQUE `(marketplace, order_number)` + upsert. |
| No `DeviceStatus` value for `ready_to_ship` / `fba` | `src/types.ts:3` | Extend enum or move STATUS to free-text `status_raw`. |
| `BP * QUANTITY = VALUE` not emitted as formula | `src/components/ReportingPage.tsx:184-196` | Use `exceljs` `cell.value = { formula: 'B2*C2' }`. |

---

## 4. MEDIUM-severity gaps

- Trailing-space headers (`MODEL `, `QUANTITY `) — readers `trim()` for matching (`import_excel.cjs:133`, `ImportModal.tsx:78,167`) which is fine for import but writers must re-emit the literal spaces.
- EBAY literal `0.2` header (numeric, not string) will fail alias matching once writes are wired (`ImportModal.tsx:78`).
- ONBUY has no `QUANT` column — parsers assume it exists (`ImportModal.tsx:99`).
- Cached formulas (`=B2*C2`) not preserved on round-trip; only computed values read (`import_excel.cjs:391`).
- `batchUtils.generateBatchId()` is client-side `new Date()` → clock-skew collision risk (`src/lib/batchUtils.ts:7-28`). Move to Postgres `gen_random_uuid()` or sequence.
- Multi-supplier join uses `, ` instead of ` / ` in current export (`ReportingPage.tsx:149`).
- `reseed.sql` literal `BATCH_001…BATCH_050` strings are unsearchable buckets, not real batch IDs.

---

## 5. Required SQL migrations (consolidated)

```sql
-- ─── A. Authoritative import provenance ─────────────────────────────────
CREATE TABLE import_batches (
  id              TEXT PRIMARY KEY,                  -- e.g. NIH-20260516-101152
  source_file     TEXT NOT NULL,
  source_sheet    TEXT,
  row_count       INTEGER NOT NULL DEFAULT 0,
  supplier_id     TEXT REFERENCES suppliers(id),
  imported_by     TEXT NOT NULL DEFAULT 'shared',
  imported_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes           TEXT
);
CREATE INDEX idx_batches_imported_at ON import_batches(imported_at DESC);

-- ─── B. Inventory provenance + DB-default timestamps ────────────────────
ALTER TABLE inventory_units
  ADD COLUMN import_batch_id TEXT REFERENCES import_batches(id),
  ADD COLUMN source_file     TEXT,
  ADD COLUMN source_row      INTEGER,
  ADD COLUMN imported_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN status_raw      TEXT,                   -- preserve "R T S" verbatim
  ADD COLUMN marketplace     TEXT,                   -- "FBA", "Project", "Back Market"
  ADD COLUMN stock_out_date  DATE,
  ADD COLUMN sku             TEXT;
ALTER TABLE inventory_units
  ALTER COLUMN created_at SET DEFAULT NOW(),
  ALTER COLUMN updated_at SET DEFAULT NOW();
CREATE INDEX idx_units_imported_at ON inventory_units(imported_at DESC);
CREATE INDEX idx_units_updated_at  ON inventory_units(updated_at  DESC);
CREATE INDEX idx_units_batch       ON inventory_units(import_batch_id);
CREATE UNIQUE INDEX inventory_units_imei_uq ON inventory_units(imei) WHERE imei <> '';

-- ─── C. Sales table (replaces sale_* on inventory_units) ────────────────
CREATE TABLE sales (
  id                 TEXT PRIMARY KEY,
  marketplace        TEXT NOT NULL,                  -- AMAZON|BM|EBAY|ONBUY|PROJECT
  order_number       TEXT NOT NULL,
  sku                TEXT,
  imei               TEXT,                           -- nullable, alphanumeric ok
  unit_id            TEXT REFERENCES inventory_units(id),
  supplier_id        TEXT REFERENCES suppliers(id),
  sale_date          DATE NOT NULL,
  quantity           INTEGER NOT NULL DEFAULT 1,
  buy_price          NUMERIC(10,2),
  sale_price         NUMERIC(10,2),
  payment_mode       TEXT,                           -- BM only; preserve casing
  sp_minus_bp        NUMERIC(10,2),
  marginal_tax       NUMERIC(10,2),
  commission         NUMERIC(10,2),
  paypal_klarna_com  NUMERIC(10,2),                  -- BM
  rof                NUMERIC(10,2),                  -- eBay
  fvf                NUMERIC(10,2),                  -- eBay
  twenty_percent     NUMERIC(10,2),                  -- eBay
  total_com          NUMERIC(10,2),                  -- eBay
  vat20              NUMERIC(10,2),                  -- OnBuy / eBay
  mar_vat            NUMERIC(10,2),                  -- OnBuy
  postage            NUMERIC(10,2),
  gross_profit       NUMERIC(10,2),
  gp_percent         NUMERIC(6,3),
  net_profit         NUMERIC(10,2),                  -- eBay incl. promo
  comments           TEXT,
  import_batch_id    TEXT REFERENCES import_batches(id),
  source_file        TEXT,
  source_row         INTEGER,
  imported_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (marketplace, order_number)                 -- re-import dedupe key
);
CREATE INDEX idx_sales_sale_date ON sales(sale_date DESC);
CREATE INDEX idx_sales_imported  ON sales(imported_at DESC);
CREATE INDEX idx_sales_batch     ON sales(import_batch_id);

-- ─── D. Configurable marketplace fees (replace platforms.ts constants) ──
CREATE TABLE marketplace_fees (
  marketplace               TEXT PRIMARY KEY,
  commission_pct            NUMERIC NOT NULL,        -- 7.14, 12, 6.9, 7, 7.14
  commission_reduction_pct  NUMERIC DEFAULT 0,       -- eBay 10
  fixed_fee                 NUMERIC DEFAULT 0,       -- eBay FVF 0.40
  postage                   NUMERIC NOT NULL,        -- 8, 10, 1/2/8, 8, 5.90
  margin_tax_divisor        NUMERIC,                 -- 6 for Amazon/BM/OnBuy/Project
  paypal_klarna_pct         NUMERIC,                 -- BM 2.5
  rof_pct                   NUMERIC,                 -- eBay 0.35
  vat_pct                   NUMERIC,                 -- 20 (OnBuy on margin; eBay on fees)
  promo_pct                 NUMERIC                  -- eBay 5
);
INSERT INTO marketplace_fees VALUES
  ('AMAZON',  7.14, 0,  0,    8.00, 6, NULL, NULL, NULL, NULL),
  ('BM',     12.00, 0,  0,   10.00, 6, 2.5,  NULL, NULL, NULL),
  ('EBAY',    6.90,10,  0.40, 8.00, NULL, NULL, 0.35, 20, 5),
  ('ONBUY',   7.00, 0,  0,    8.00, 6, NULL, NULL, 20, NULL),
  ('PROJECT', 7.14, 0,  0,    5.90, 6, NULL, NULL, NULL, NULL);

-- ─── E. Multi-supplier link for aggregate inventory rows ────────────────
CREATE TABLE inventory_aggregates (
  id              TEXT PRIMARY KEY,
  model           TEXT NOT NULL,
  buy_price       NUMERIC,
  quantity_num    NUMERIC,
  quantity_text   TEXT,                              -- 'SHS','NO STOCK', etc.
  notes_flag      TEXT,                              -- col D
  colours_raw     TEXT,                              -- raw "GREY 2 SILVER 0"
  notes           TEXT,
  owner_id        TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE inventory_aggregate_colours (
  aggregate_id TEXT REFERENCES inventory_aggregates(id) ON DELETE CASCADE,
  colour       TEXT NOT NULL,
  quantity     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (aggregate_id, colour)
);
CREATE TABLE inventory_unit_suppliers (
  unit_id     TEXT REFERENCES inventory_units(id) ON DELETE CASCADE,
  supplier_id TEXT REFERENCES suppliers(id),
  sort_order  INTEGER DEFAULT 0,
  PRIMARY KEY (unit_id, supplier_id)
);

-- ─── F. Supplier WhatsApp feed (sheet 3) ────────────────────────────────
CREATE TABLE supplier_whatsapp_updates (
  id          BIGSERIAL PRIMARY KEY,
  supplier_id TEXT REFERENCES suppliers(id),
  raw_text    TEXT NOT NULL,
  price_text  TEXT,
  posted_at   TIMESTAMPTZ DEFAULT NOW(),
  owner_id    TEXT NOT NULL
);
```

---

## 6. Required code changes (ordered punch list)

1. `package.json` — add `exceljs ^4.4.0` (SheetJS-CE cannot write formulas+formats; jspdf is irrelevant to Excel parity).
2. `src/lib/platforms.ts` — replace `PLATFORMS` constants with `MARKETPLACE_FEES` keyed by sheet name, sourced from the `marketplace_fees` table at boot (or fall back to seed constants in code).
3. `src/types.ts` — add `Sale` interface, extend `ListingSite` to include `'Back Market' | 'FBA' | 'Project' | 'R T S'` OR move to free-text `marketplace: string` everywhere.
4. `src/lib/dbService.ts:247` — relax `imei.length < 14` gate; accept any non-empty string.
5. `src/components/ImportModal.tsx:48` & `import_excel.cjs:268` & `convert_excel.py:306` — stop `replace(/\D/g, '')` on IMEI; preserve raw string. Read xlsx with `{raw: true, cellText: true}` so 15-digit integers arrive as strings (no scientific notation).
6. `ImportModal.tsx:101` — split supplier on `/`, store `supplierIds[]` via new `inventory_unit_suppliers` join.
7. `ImportModal.tsx:106` — add `parseQuantityCell()` returning either `{qty}` or `{flag: 'SHS'|'NO_STOCK'|'OTHER', raw}` instead of dropping rows.
8. New `src/lib/salesImport.ts::parseSalesWorkbook(wb)` — loops `['AMAZON','BM','EBAY','ONBUY','PROJECT']`, switches column layout per sheet, returns canonical `Sale[]` (BM captures `payment_mode`).
9. Wire `import_batches` row creation into `ImportModal.processFile` BEFORE `bulkCreate`; tag every unit/sale with `import_batch_id`, `source_file`, `source_row`.
10. New `src/lib/clientReport.ts::downloadClientWorkbooks(units, suppliers, whatsappFeed, {from, to})` — produces two workbooks via `exceljs`:
    * `INVENTORY_REPORT_YYYY_M.xlsx` (3 sheets, headers preserve trailing spaces, col E formula `=B${r}*C${r}`, col F compound colour string via `buildColourString()`, col G suppliers joined ` / `, dates `mm/dd/yyyy`, IMEI col `numFmt: '0'`).
    * `SALES_REPORT_YYYY.xlsx` (5 sheets per marketplace; emits per-sheet formulas pulled from `MARKETPLACE_FEES`; dates `[$-409]d\-mmm\-yyyy`; money `0.00`; EBAY header includes literal numeric `0.2`).
11. New `GET /api/changes?from=&to=` querying `imported_at`/`sale_date`/`updated_at` ranges using new btree indexes.
12. New `src/components/ExcelReportButton.tsx` sitting beside `PDFReportButton`, triggers `downloadClientWorkbooks(...)`.
13. Drop `created_at`/`updated_at` literals from all client/server inserts (`dbService.ts:90,103,164,191`, `api/inventory.ts:48`, etc.); let Postgres defaults fire.
14. `reseed.sql:20` — remove hardcoded timestamps, rely on defaults; replace `BATCH_xxx` strings with real `import_batches` rows.
15. Add `parseColoursAndQty` to `parseOGStockSheet`, `import_excel.cjs::parseWorksheet`, `convert_excel.py::parse_sheet` so compound colours survive the master-sheet path too.
16. Update `generate_sample_excel.mjs` to emit a 5-sheet sales sample matching this spec for QA round-trip tests.

---

## 7. What is already PASS

- Per-unit IMEI tracking (`InventoryUnit` shape covers most fields).
- ISO date storage for `dateIn` / `saleDate`.
- IMEI dedupe path (just needs to stop stripping non-digits and to drop the length gate).
- `parseClientBulkSheet` already understands compound COLOURS (just needs to be the default parser).
- Supplier table exists with the seed of NIHAL / MHL / IMAX / NANAK / ABC / RR STOCK (matches client data).
- `generateBatchId()` helper exists in `batchUtils.ts` — just needs to be called by the importers.

---

## 8. Production go-live readiness

| Phase | Status |
|---|---|
| Load INVENTORY sheet today, as-is | ❌ blocked (B4, B7, B8) |
| Load IMEI NUMBERS sheet today, as-is | ❌ blocked (B4, B6) |
| Load SALES workbook today, as-is | ❌ blocked (B2, B3, B4, B5, B6) |
| Operate daily with batch+sql-timestamp audit | ❌ blocked (B9, B10, B11) |
| Re-emit identical Excel daily | ❌ blocked (B1) |

**Estimated effort to reach round-trip parity:** schema migrations (~½ day), importer refactor + `exceljs` writer (~2–3 days), test against the two live files (~½ day). Total: ~4 working days for a focused effort, assuming a Supabase project exists.

---

*Generated by surgical parallel audit (4 agents) against the live client files INVENTORY_REPORT_2026_1.xlsx and SALES_REPORT_2026.xlsx on 2026-05-16. Full extracted spec: `/tmp/CLIENT_FILES_SPEC.md`.*
