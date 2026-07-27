# InventoryManager — Full Bug Fix Ledger

**Compiled:** 2026-07-27
**Scope:** Entire project history, 860 commits, 2026-04-29 → 2026-07-27
**Method:** Every commit subject scanned for fix-signal language, ~60 ambiguous ones
individually read in full (`git log -1`, `git show --stat`) to confirm what was actually
broken before listing it here. Pure feature additions, refactors, screenshot/test-only
commits, and docs-only commits are excluded — this is a ledger of genuine defects, not a
changelog. Multi-commit fix-and-refine chains are collapsed into one entry, noting how many
commits it took to fully resolve.

This is the full backing detail behind the summarized bug counts in the main PDF report
(`2026-07-27_Production_Closure_Report.pdf`). Every entry below references the commit hash(es)
that fixed it — `git show <hash>` on this branch reproduces the exact change.

---

## TEMU marketplace integration

- **Temu commission/VAT formula mismatch** (`359efe8`) — the app's Temu commission/VAT
  calculation didn't match the client's authoritative export figures; corrected to match the
  real transaction in the client's final CSV.

## Accessory (no-IMEI) stock

- **Earbuds and watches could not be entered into stock at all** (`2c3022a`) —
  `isAppleDevice`'s serial-unlock regex required a word boundary after "BUDS"/"WATCH" that
  fused model names like `Buds2`, `AirPods4`, `Galaxy Watch6` never had, so these devices had
  no IMEI to type and no serial path either — a hard dead end on intake. Widened the
  fused-token pattern (the same class of bug already patched for tablets, never carried
  across to earbuds/watches).

## Returns workflow

- **£0 sale silently bypassed the sales ledger** (`3b63e81`) — `UnitDetailDrawer.markSold`
  accepted `salePrice="0"` and wrote `status:'sold'` directly, never creating a `sales`
  record — the unit vanished from the Sales Report entirely. Rerouted through the shared
  `recordSale` path used by every other sell flow.
- **Repair-route units stayed "In Repair" forever, injecting phantom postage loss**
  (`f0f8e1e`, hardened by `a3bf036` — 2 commits) — completing a repair overwrote the unit's
  `returnType` from `'repair'` to `'returned_to_inventory'`, so every downstream renderer
  fell back to the "refund" default and charged 2 phantom shipping legs. Moved the signal
  onto the immutable Sale doc and extracted the write logic to a pure, unit-tested helper.
- **Inventory Report overstated stock by soft-deleted (returned-to-supplier) units**
  (`3888ba1`) — the export showed 211 rows vs. 210 on the live KPI because a
  `returned_to_supplier` unit slipped past a `status==='sold'`-only filter; fixed with a
  shared `isStockOnHand()` predicate used everywhere.
- **Return-restore idempotency check clobbered an older cycle's date/reason** (`99cae57`) —
  a unit returned twice in its history, sharing the same return type across both cycles,
  could get permanently stuck on the first cycle's stale date and reason after a full
  wipe+rebuild.
- **Return-restore could clobber a unit resold under a newer order** (`8b82c98`) — guarded
  against overwriting a newer sale's state with an older return's data.
- **48 returned units silently lost during an earlier re-import incident** (`d2c04ec`) —
  folded return history into the Sales Report itself so a re-upload replays a voided sale's
  return state back onto its unit instead of losing it.
- **Re-imports were silently erasing existing returns** (`a9f6f2e`) — a Back-to-Inventory
  unit (status `'available'`) matched the same "returned" skip-list gate as a true return, so
  re-uploading a Sales Report dragged it back to `sold` and nulled its return fields,
  restoring refunded revenue as if it hadn't been returned.
- **Multi-cycle return state incorrectly carried over on re-sale** (`0152b8a`, with
  downstream symptoms patched in `4df31ca` and `73fba21` — 3 commits) — `recordSale` never
  cleared stale return fields on a unit going sold→returned→re-sold, leaving dual,
  contradictory state that broke Sold Today counts and cross-screen KPI consistency.
- **Returns/Sales Report silently dropped voided/returned sales, hiding real postage
  exposure** (`bcc932d`) — the downloaded Sales Report filtered out `!s.voidedAt`, so
  accountants never saw the return rows or cumulative loss across multiple cycles on one
  unit; every voided sale now ships in the workbook, flagged, with its Postage Loss.
- **GP % overstated profitability on refunded/replaced sales** (`b34c518`) — the GP% column
  ignored the 2–3 shipping legs already tracked in the separate Postage Loss column, so a
  sale that actually lost money could read as +12% GP.
- **Returns/sales tallies double-counted or disagreed screen-to-screen** (4 commits:
  `70d438b`, `af6c18e`, `164af94`, `f162728`) — Sales Summary and Returns Summary counted
  duplicate void sub-records instead of deduping; Sell tile "Returned" chips counted return
  *events* while the Returns page counted physical *units*, so one unit cycled
  sold→returned→re-sold→returned showed "2" on one screen and "1" on the other. Resolved with
  a consistent earliest-void-date-per-unit model (one commit in the chain was an intentional
  revert after the operator clarified they wanted event counts on that one specific tile).
- **A prior commit had wrongly auto-voided "red flagged" sales rows** (`dd9a412`,
  self-correcting `dc2d798`) — red highlighting was meant to be a soft visual annotation, but
  the previous commit had been auto-stamping `voidedAt`, silently dropping those rows out of
  GP/revenue rollups as if confirmed refunds.
- **Units stuck in a status that made them un-sellable** (`6198c67`) — `ProcessReturn` wrote
  `status` and `returnType` in one call; a partial write race could leave a unit correctly
  flagged as returned-to-inventory but still `status='returned'`, so the Returns page showed
  it available while Buy/Sell screens hid it entirely.
- **Sales counting double-counted / lost re-sold units** (`7d07387`, `4df31ca`) — the Sell
  screen's sale-counting logic double-counted in one case and dropped re-sold units in
  another.
- **Dead-end return actions left on finished returns** (`3811c68`, `5e3d53c` — 2 commits) —
  "Send to Repair" / "Re-process Return" stayed clickable on already-finished return records.
- **Sales Report failed to surface returns when `Sale.voidedAt` wasn't written** (`86cd766`)
  — a return could complete without the void flag ever landing on the Sale doc.
- **Duplicate-IMEI cross-marketplace race** (`99eab03`) — two sales sharing one IMEI resolved
  to whichever marketplace sheet came later in a fixed list (Amazon/BM/eBay/OnBuy/Temu),
  regardless of actual sale chronology; now the chronologically later sale always wins.
- **Refunded sales inflating Best Sellers / Supplier Performance / Daily Revenue** (`3b6f2b3`)
  — those panels' revenue/GP totals never excluded voided sales, self-contradicting their own
  "return rate" column on the same row.

## SHS (supplier-held stock)

- **SHS templates/importer wrongly required an IMEI** (`9bf1a90`) — supplier-held stock
  hasn't shipped and has no IMEI, but the template's own instructions said IMEI was required
  — making the template unusable without inventing fake IMEIs.
- **SHS counts disagreed across the Buy and Sell tabs** (4 commits: `d05e392`, `e12a2e4`,
  `5fa6634`, `fb17549`) — the same data produced two different totals because each screen
  computed the count with its own formula; a manual-SHS unit ID prefix mismatch also made
  manually-added SHS units invisible to the KPI. Consolidated into one `shsCount.ts` source
  of truth.
- **SHS stock wasn't excluded from Office Stock KPI or out-of-stock alerts** (`5f9fb8e`,
  `5fa6634`) — incoming SHS units counted as available office stock, and SKUs with SHS
  coverage still fired false "Sold Out / Reorder" alerts.
- **SHS row import silently landed as regular available stock** (`f9bc78c`) — the 9-column
  schema had no field to mark "supplier still holds this," so every SHS row imported as
  available office stock.
- **Sales couldn't fulfil against SHS units** (`74b05e3`) — a sale against SHS stock left the
  unit stuck at `status='incoming'` instead of fulfilling it.
- **Selling an SHS unit without a new IMEI cleared its existing IMEI** (`7ccd3ce`).
- **SHS placeholder units became permanent phantoms, inflating the SHS KPI** (`2ba8733`) —
  selling SHS stock before formal receipt left the placeholder unit stuck forever,
  double-counting inventory.
- **Silent data loss re-uploading multiple identical SHS holdings** (`03b75c2`) — a
  single-slot matching map only remembered the last of N identical holdings; fixed with a
  pool-based consumption model so N holdings map to N distinct records.
- **ReceiveSHSModal crashed on the first keystroke** (`b49bd68`).

## Sales / Reports figures

- **Admin → Reports double-counted revenue** (`31e131e`) — showed 194 sold / £88.8k instead
  of the correct 101 sold / £45.7k.
- **Every imported sale was attributed to one fake supplier** (`4f8bc0d`, root-caused and
  fixed at the import layer by `9a474a8` — 2 commits) — the real cause was upstream in
  `salesImport`, which produced only a `supplierName` with no `supplierId` for any consumer to
  join on. Fixed so `SalesReportImport` resolves and writes `supplierId` at import time;
  duplicate suppliers are now refused outright.
- **Sales History listed every imported sale twice** (`dea20b3`).
- **Platform Scorecard read zero on every imported sale** (`d4a8a0c`).
- **Two conflicting VAT figures on two different screens** (`301f131`, `c7b1c85` — 2 commits)
  — Reports carried a second, duplicate VAT engine on a rolling 90-day window with locally
  recomputed fees (matching no real filing period), while the VAT Centre computed a per-sale
  figure but never totalled it — so the one number needed to file was never produced
  anywhere. Consolidated to one authoritative, totalled VAT figure.
- **Sales Report export/import schema disagreed with itself** (`f9773f7`, `63d39a5` — 2
  commits) — Amazon's positional fallback read `postage` from the Comments column index
  instead of Postage's — any file with a renamed/stripped Postage header silently parsed
  free text as £0 postage, overstating GP by exactly the postage amount on every affected
  row; the inventory export also had Colour and SIM Type transposed vs. the import template.
- **NP (Net Profit) column blank for ~90% of Sales Report rows** (`b460b20`) —
  `calcSaleFinancials` only ever set `netProfit` for eBay; other marketplaces rendered blank
  instead of falling back to Gross Profit.
- **Sale financial formulas didn't match the client's authoritative master spreadsheet**
  (8-commit saga: `7d8256b`, `78908f8`, `994293b`, `bc7237c`, `367bc2e`, `533fd94`, `b682473`,
  `308b42b`, `eeeb3a8`) — systematically wrong figures across all four original marketplaces:
  Amazon commission computed on the wrong base, intermediate values rounded before use
  (compounding penny errors), GP% using the wrong denominator, and several marketplaces
  missing per-line VAT/Marketing/DSF/Customer-Care-Fee/Accessories components the master
  sheet accounted for. Fully reconciled with a 48-row master-fixture parity test suite.
- **`bulkUpsertSales` silently discarded the correct sale ID, collapsing multi-item orders**
  (`2694562`) — re-derived the doc ID on every write, silently overriding the parser's
  carefully-built composite ID, leaving an earlier fix for this exact symptom (`6471bae`)
  inert on two of the app's write paths.
- **Multi-phone orders collapsed into a single sale record** (`6471bae`) — the parser's
  composite Sale ID didn't include IMEI/SKU, so a multi-unit order overwrote itself down to
  one row.
- **Sales writes failed on Firestore-illegal ID characters** (`a867259`) and **`recordSale`'s
  ID scheme didn't match the importer's** (`69b92cb`) — both part of the composite-ID
  correctness effort.
- **Sales import never touched the matching inventory unit** (`50ec8bb`) — imported sales
  left the matching IMEI showing `status='available'` even though it had sold, and left
  `sale.unitId` blank, so every buy-side column (Model/Grade/Storage/Colour/etc.) rendered
  "—" for imported sales in the ALL sheet.
- **`cleanForFirestore` silently stripped `supplierName` on every write** (`6158e6f`).
- **BP (buy price) computed as £0 on every imported unit** (`df7014f`, same root cause zeroing
  SP/Postage/Commission on the sales side, `2b0096b` — 2 commits) — `Math.max(findCol(...), 4)`
  clobbered a correctly-found column index of 3 back to 4, so the parser read the Colour
  column as a price and `parseFloat("SPACE GREY")` silently became 0.
- **Re-uploading the app's own Sales Report always flagged 4 invalid rows** (`8458974`) — a
  self-consistency bug in the audit-completion gate.
- **Imported sale dates drifted back one day for IST (+05:30) users** (`76973d5`) — a
  timezone conversion bug silently shifted every imported sale's date.
- **"Returned Today = 394" bug** (`9250420`) — an absurd, clearly-wrong KPI figure caused by
  a save-path failure.
- **Dashboard stock value KPI included non-available units** (`8094b19`) — fixed to
  available-only.
- **Reorder Alerts mismatch** (`a21255b`) — sell-through metrics and average sell time were
  missing/wrong, causing alerts to disagree with actual stock state.
- **QA batch of production fixes** (`d1ca705`) — `bulkCreate` silently failed for >500-unit
  imports (Firestore batch limit not chunked); `subscribeToCollection` used an ordering field
  that errored on non-inventory collections; `resetDatabase` only cleared 2 of 7 collections;
  a brand-detection bug where every model read as "iPhone" regardless of actual model.
- **5 master-file → Firestore import gaps from a coverage audit** (`32afd30`) — `MARKETPLACE`,
  `STOCK OUT DATE`, verbatim `STATUS` values, the Supplier WhatsApp Updates sheet, and an
  unlabeled notes-flag column were all silently dropped by the parser.

## Admin restructure / Data Health / Device & model catalog

- **Periodic table tile count disagreed with its own overlay (316 vs. 116)** (`24dacb6`,
  same-day correction `db0a94d` — 2 commits) — tiles and their drill-down overlay used
  different key derivations for the same model bucket.
- **False-duplicate tiles in the periodic table** (`39a0ced`) — normalization gaps split one
  model into separate tiles; also fixed XCover model-number labels reading as a quantity.
- **Apple Watch tile opened to "0 rows"** (`6f42ef6`) — a case-mismatch bug in the
  tile-to-overlay filter.
- **Periodic-table overlay matched Galaxy S20 rows into the S20 FE tile** (`83336a0`) — an
  exact-match filtering bug conflating two distinct models.
- **"Brand New" vs. "Brand new" treated as two different values** (`aafc9c8`).
- **Inventory Report re-import could match units across the wrong stock bucket** (`679d5f6`)
  — office and SHS rows could cross-match during re-import.
- **Model picker showed a misleading empty-state count** (`18b8648`) and **wasn't filtered
  by its own row's Office/SHS toggle** (`d662093`) — orphan-row resolution during import
  could offer or apply models from the wrong stock bucket.
- **Model picker silently capped results at 8 with no indication more existed** (`f6fb640`)
  — added "Showing top 8 of N matches — keep typing to narrow."
- **Sales audit gate accepted placeholder/legacy-format IMEIs as valid** (`28604fd`).
- **Import blocked by "Missing or insufficient permissions"** (`7501f34`) — fixed by writing
  a consistent `ownerId='shared'`.
- **Client Walkthrough data-reconciliation effort** (~15 commits: `de2a965` S9/S9+ collision,
  `0e6dab4` S21+ rename, `9a1c210` COLOURS↔SUPPLIER column swap across 42 rows, plus
  row-by-row resolutions for iPhone XS/SE, Galaxy Tab A8/S9FE/S20FE) — a live, in-meeting
  audit found the inventory sheet and the IMEI numbers sheet disagreed on colour, supplier
  and model naming for dozens of specific units, all individually verified and corrected.

## Analytics / Insights KPIs

- **Sold Today / Returned Today counted by UTC calendar day instead of a rolling 24h window**
  (`8b3f87b`) — wrong daily figures for any operator not in UTC.
- **Out-of-stock tile corner badge showed the lifetime-sold count instead of 0** (`5dd6137`).
- **72-hour "Stock Added" KPI filtered on `createdAt` instead of Stock-In date** (`c780687`).

## Notifications

- **Notification duplication / lifecycle bugs** (~8 commits: `bf2e677`, `79d765d`, `1dc9925`,
  `e974d54`, `38c319e`, `074fea5`, `10371c0`, `9a486ff`) — notifications re-fired on reload
  instead of deduping against fire history; "Clear" removed notifications younger than 24h
  instead of only older ones; unread badge count reset incorrectly when the auto-close banner
  disappeared; the loss-sale trigger fired incorrectly; toast notifications rendered fully
  transparent in one regression.

## Stock Alerts ticker

- **Duplicate/incorrect out-of-stock and low-stock alerts** (~5 commits: `405b7bb`,
  `fda8e85`, `a79fcd2`, `21306cf`, `d8257b6`) — the scrolling ticker rendered the same alert
  multiple times (an animation-loop rendering the array twice), and separately failed to
  properly detect out-of-stock/low-stock conditions in an earlier iteration.

## Stock intake — image capture / OCR pipeline (early build)

- **Image capture and OCR blocked stock intake outright** (~10 commits across the project's
  first weeks: `64edfd7` P1 incident — image picker/file selection failure, `e7129a9`/
  `13fdcc4` file input not triggering on mobile, `ca333e2` OCR worker null-pointer crash,
  `982dc3a` OCR Worker DataCloneError, `e10b1e1` OCR worker serialization failure, `40e172e`
  Cloudinary 401 upload error, `8812da7`/`177e79f` null-IMEI crash) — a series of defects
  that made "add stock by photo" crash or silently do nothing, resolved before the team
  settled on Firebase Storage for images.

## Data layer reliability

- **New devices/fresh sessions showed blank data, or old sessions lost data on reload**
  (~15 commits spanning the Firebase → Supabase → Firestore migrations: `ae93267` stop
  clearing localStorage, `6dfd12c` immediate data load on subscribe, `eb88f78`/`90679d2`
  stale localStorage flash on seed/reset, `d26ad11` blank seed data after wipe, `dd0b44b`
  Firestore quota/query-limit overflow, `eea53e3` infinite loading from a missed
  `endSeeding()` path, `397aa0e` stuck loading screen, `4ada9d7`/`263e1d3` "SAVING..." hang,
  `40b691a` `onSnapshot` wiping local cache, `0e99f7f` non-self-healing subscription,
  `8fd2044` "bulletproof new-device loading") — a long-running class of data-loss/hang bugs,
  stabilized incrementally across three backend migrations before settling on Firestore.

## Other

- **Excel duplicate-import** (`7127d33` prevents it, `ab4a97b` surfaces a warning) — 2
  commits, one root issue: re-uploading the same file created duplicate units.
- **`bulkCreate`/`bulkDelete` cache-stomp and silently-failing deletes** (`6ff2402`).
- **Crash reading `.postage` on an undefined `calcSaleFinancials` result** (`12867b2`).

---

### Investigated and ruled out (not a bug)

- **Suppliers panel Sold/Revenue undercounting for mixed import + in-app sales sources** —
  suspected from a stale code comment; proven live to be correct current behaviour
  (`SalesReportImport.tsx` already resolves a real `supplierId` at import time). Kept as a
  permanent regression test (`e2eSupplierSoldRevenueMixedSourceBrutal.mjs`).

### Scope notes

Excluded from this ledger even though flagged by keyword search: pure UI/UX redesigns and
rebrand commits, "Refresh E2E screenshots" / "Add E2E proof" commits (test evidence, not
fixes), typecheck/build-only fixes with no runtime behaviour change, and deliberate
product-behaviour reversions where the "old" behaviour wasn't wrong, just not what the
operator wanted.
