# Client Demo — Loom Script

**Duration:** ~7 minutes. Hit record, follow this script verbatim. Every step has the click + the narration. Pause between steps if needed; Loom edits are easy.

**Pre-flight (do this BEFORE recording):**

- [ ] Vercel deploy is green at https://inventory-manager-peach-alpha.vercel.app
- [ ] You have the two master files on your desktop:
  - `INVENTORY_REPORT_2026_1.xlsx`
  - `SALES_REPORT_2026.xlsx`
- [ ] You're logged in as `admin@inventorymanager.com` (or sign in fresh during the recording — your call)
- [ ] Tab count cleaned up (close non-relevant tabs so they aren't visible)
- [ ] Network panel closed, DevTools closed
- [ ] Loom set to "screen + camera" or "screen only" — your preference

---

## Scene 1 — Open the app (15 sec)

**Click:** open https://inventory-manager-peach-alpha.vercel.app in a fresh tab

**Say:**
> "This is MOBILEPHONEMARKET — the inventory manager we built to replace your master Excel files. Two files: the inventory report and the sales report. Everything in the app lives off those two."

---

## Scene 2 — Sign in (15 sec)

**Click:** enter `admin@inventorymanager.com` + password → Sign In

**Say:**
> "Standard email-password sign-in. There are three operator roles — UK buying ops, India sell ops, and admin. Admin sees everything; the other two are scoped down so cashiers don't see import controls."

---

## Scene 3 — The sidebar, four tabs (10 sec)

**Click:** hover the sidebar — point at Buy, Sell, Returns, Admin

**Say:**
> "Four top-level tabs. Buy is what your UK warehouse uses when stock arrives. Sell is what India ops uses to mark items sold. Returns handles the come-backs. Admin is everything else — imports, reports, analytics, suppliers, audit."

---

## Scene 4 — Master Data import (60 sec) — THE MONEY SHOT

**Click:** Admin (sidebar) → Master Data sub-tab

**Say:**
> "This is the single most important screen. Today, you maintain two Excel files. Drop both here, one time, and the app takes over."

**Click:** Drag `INVENTORY_REPORT_2026_1.xlsx` into the LEFT slot

**Say (while parsing):**
> "It auto-detects which file goes where by sheet names. Inventory report has the INVENTORY sheet, IMEI NUMBERS sheet, and SUPPLIER WHATSAPP UPDATES — all three get parsed. You'll see counts populate in a second."

**Wait** for left slot to show: `~833 units · 79 aggregates · 23 SHS · 14 suppliers`

**Click:** Drag `SALES_REPORT_2026.xlsx` into the RIGHT slot

**Say (while parsing):**
> "Sales report — five marketplace sheets, fourteen hundred and fifty sales. Notice the per-marketplace breakdown: Amazon nine forty, BM one sixteen, eBay one oh three, OnBuy thirty one, Project two sixty."

**Wait** for right slot to populate. Combined totals card appears.

**Click:** "Import Linked Batch" button

**Say:**
> "One click, one linked batch. Every unit, every aggregate, every sale gets the same import batch id stamped on it — that's how the audit trail works. Watch the progress bar."

**Wait** for "✓ Imported" toast.

---

## Scene 5 — Buy tab (60 sec)

**Click:** Buy (sidebar)

**Say:**
> "The Buy tab is the UK warehouse view. Three sections, in priority order: Supplier Holdings, Missing IMEIs, Pending IMEIs."

**Scroll to Supplier Holdings (SHS) section. Expand it.**

**Say:**
> "Supplier Holdings is stock the supplier is holding for us. Master file flagged twenty-three SKUs as SHS. Each row has a Receive Into Stock button — when the supplier delivers, you click that, scan the IMEIs, and they become real stock."

**Click:** Receive Into Stock on any SHS row → modal opens

**Say:**
> "This is the receive flow. Expected one, scanned zero. Hard cap — you can't scan more than the supplier said they were holding. Multi-colour SKUs get a colour picker per IMEI so each phone lands in the right bucket."

**Click:** Cancel (we don't want to actually receive in the demo)

**Scroll to Pending IMEIs section.**

**Say:**
> "Pending IMEIs is everything physically in office that hasn't been listed on a marketplace yet. Three hundred and fifty four units, grouped by SKU. Notice the count badges — fifty one of the same Samsung A32 5G in BLACK isn't fifty one rows, it's one row with a ×51 badge."

**Click:** the chevron on one SKU row to expand

**Say:**
> "Expand to see the individual IMEIs, each with its supplier, date in, and price."

**Point at the "Listed on:" chip strip**

**Say:**
> "And this is critical: listing is at the SKU level, not the IMEI level. You list one of these on Amazon, one on eBay, and as units sell the quantity decrements automatically. Click the pencil to set the marketplaces."

**Click:** the pencil → SkuListingEditor opens

**Say:**
> "Tick the marketplaces you've actually listed this SKU on. Save. Every available unit in the group gets marked listed. Done."

**Click:** Cancel

---

## Scene 6 — Sell tab (45 sec)

**Click:** Sell (sidebar)

**Say:**
> "The Sell tab is what India ops sees. Same grouping — fourteen hundred sales, fifty seven SKUs. SHS Pending, In Stock, Sold Today — three KPI cards at the top."

**Scroll to Available Stock list.**

**Click:** any SELL button on a SKU group row

**Say:**
> "When India marks an item sold, they pick the SKU here, enter the sale price, order number, marketplace. The app computes commission, postage, marginal tax, GP automatically — using the exact fee schedule from your master Excel."

**Click:** Cancel (don't actually mark sold in the demo unless you want to)

---

## Scene 7 — Periodic Table (30 sec)

**Scroll down on the Sell tab to the periodic table.**

**Say:**
> "This is the inventory at a glance. Each block is a SKU — model plus storage. Brand-aware sections — Apple iPhones, Apple iPads, Samsung Galaxy S, Galaxy A, Galaxy Tab, Galaxy XCover. Six hundred and thirty units in office, fourteen hundred sold."

**Click:** any block

**Say:**
> "Click any block and you get an Excel-style overlay of every unit in that SKU — date, IMEI, supplier, BP, status, marketplace. Copy to clipboard or download as CSV — straight into Excel if you need to share."

**Click:** outside to close

---

## Scene 8 — Sales History (45 sec)

**Click:** Admin (sidebar) → Sales History sub-tab

**Say:**
> "The full sold history. Fourteen hundred sales. Excel-parity columns — date, marketplace, order number, SKU, IMEI, supplier, BP, SP, payment mode for Back Market, postage, commission, GP, GP percent."

**Click:** marketplace chips — Amazon, then BM, then All

**Say:**
> "Filter by marketplace. Date range picker scope tabs — today, this month, all time. Search across order number, IMEI, SKU, supplier."

**Type** "samsung" into the search box

**Say:**
> "All sale numbers are live-computed. Change the fee schedule and the history retrofits — never stale."

---

## Scene 9 — Reports + Download Excel (45 sec)

**Click:** Admin → Reports sub-tab

**Say:**
> "Daily report. Stock value, VAT margin scheme, daily sales log. CSV exports per tab."

**Click:** "Download Master Excel" button at the top right

**Wait** for two .xlsx files to download.

**Open** the downloaded `INVENTORY_REPORT_2026_5.xlsx` in Excel/Numbers/Sheets

**Say:**
> "Two workbooks. Inventory report — three sheets, same structure as yours. IMEI numbers, supplier holdings, supplier WhatsApp updates."

**Open the SALES_REPORT_2026.xlsx**

**Say:**
> "Sales report — five sheets, one per marketplace. Same headers as yours. Same formulas — every GP cell is a live Excel formula, not a baked-in number. Pop a cell and you see equals SP minus BP minus commission."

---

## Scene 10 — Admin Overview & Audit (30 sec)

**Click:** Admin → Overview sub-tab

**Say:**
> "Admin dashboard. Stock on hand, SHS pending, sold this month, sales by marketplace, last import batch. Real-time."

**Click:** Audit sub-tab

**Say:**
> "Every import batch logged. Click any to see what came in, when, and what it touched. Full provenance — if a number's wrong, you trace it back to the source file row."

---

## Scene 11 — Close (15 sec)

**Sign out**

**Say:**
> "That's the whole loop. Drop two Excel files in, the app does everything your team does manually today — and gives you back the same two Excel files at the end of the day if you ever need to switch back. No lock-in, no data hostage. Questions?"

---

## Numbers to remember (cheat sheet for the recording)

- Total units imported: **~833**
- SHS aggregates: **~23**
- Suppliers: **~14**
- Sales rows: **1,450** (Amazon 940 · BM 116 · EBAY 103 · ONBUY 31 · PROJECT 260)
- Mean SP per marketplace: Amazon £139, BM £197, eBay £145, OnBuy £173, Project £125

## If something goes wrong on camera

| Failure | Recover |
|---|---|
| Master Data import fails with permissions error | Open Firestore Console → Rules → make sure the audit-collections block is published (you did this earlier — should be live) |
| Sales History shows £0 SPs | Re-import via Master Data. Master sales had column-detection bug fixed two commits ago; existing docs won't fix until re-imported |
| Periodic table shows Samsung in "Other" | Refresh the page (runtime series fix lives in the bundle — hard refresh forces it) |
| Browser cache showing old build | Open in Incognito; Vercel CDN caches aggressively |

## After the demo — leave-behind for the client

- **Branch:** `claude/audit-master-files-uouwf` on GitHub
- **Production URL:** https://inventory-manager-peach-alpha.vercel.app
- **Audit doc:** `MASTER_FILES_AUDIT.md` in the repo
- **Spec doc:** `MASTER_FILES_SPEC.md` in the repo
- **Open punch list:** the issues we cut for v1 (sub-supplier RR split, region admin UI, returns scanner)
