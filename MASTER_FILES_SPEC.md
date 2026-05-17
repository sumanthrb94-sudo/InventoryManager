# CLIENT MASTER FILES — STRUCTURE SPEC (extracted from live data)

## File 1: INVENTORY_REPORT_2026_1.xlsx (87KB)

### Sheet 1: `INVENTORY` (286 data rows, 8 real columns A–H, padded to AA)
Headers (row 1, trailing spaces preserved):
| Col | Header | Type | Example | Nulls/286 | Notes |
|-----|--------|------|---------|-----------|-------|
| A   | `MODEL ` (trailing space)  | str   | "iPad 7 32GB Wifi 2019 10.2 - WIFI + 4G" | 206 | Free-text. Trailing space! |
| B   | `BP`                       | float | 75.0, 380.0  | 222 | Buy price GBP |
| C   | `QUANTITY ` (trailing sp)  | float OR str | 2.0, "SHS", "NO STOCK" | 208 | **MIXED TYPE** — must accept text |
| D   | (no header — `None`)       | str   | "SALES FOCUS", "SHS - BLACK" | 5705/(286×27 anon) | Notes/flag col |
| E   | `VALUE`                    | formula | `=B2*C2` | — | App must emit formula |
| F   | `COLOURS`                  | str   | "GREY 2 SILVER 0", "BLUE 3 LAVENDER 2 MINT 5 RED 1" | 220 | **Embedded colour+qty pairs** |
| G   | `SUPPLIER`                 | str   | "NIHAL", "MHL / ABC / NIHAL" | 214 | **Multi-supplier allowed** |
| H   | `NOTES`                    | str   | "CLEARANCE", "SHS - GREY" | 227 | Free-text |
Trailing cols I–AA are all empty (Excel padding).

Distinct suppliers: NIHAL, MHL, IMAX, NANAK, ABC, RR STOCK, MOBILE KIT, plus combos `MHL / ABC / NIHAL`, `ABC / MHL`, `IMAX / NIHAL`.

### Sheet 2: `IMEI NUMBERS` (855 data rows, 10 real columns A–J, padded to Y)
| Col | Header | Type | Example | Nulls/855 |
|-----|--------|------|---------|-----------|
| A | `STOCK IN DATE` | datetime (fmt `mm/dd/yyyy`) | 2026-05-12 | 541 |
| B | `MODEL`         | str | "IPHONE XS 64GB ", "IPAD 9TH GEN 64GB W/C " | 209 |
| C | `IMEI NUMBER`   | float OR str | 353209102768686.0, "NL6CMQCYTD", "SKC9P3QVP6F" | 209 | **Serial allowed (alphanumeric)** |
| D | `BP`            | float | 60.0…390.0 | 211 |
| E | `COLOURS`       | str | ROSE GOLD, BLUE, PURPLE, "MHL" | 209 | Sometimes contaminated w/ supplier |
| F | `SUPPLIER`      | str | NIHAL, MHL, NIHAL (trailing space) | 209 |
| G | `NOTES`         | str | LCD+BG, GRADE B, GRADE C, REPLACEMENT, PROJECT, "GRADE B- / BG", BG | 779 | Grade+condition tags |
| H | `STATUS`        | str | FBA, SOLD, "R T S" | 395 | "Ready To Ship" with spaces |
| I | `MARKETPLACE`   | str | Back Market, FBA, Amazon, "R T S", Project, OnBuy, eBay | 395 |
| J | `STOCK OUT DATE`| datetime | 2026-05-12 | 460 |

### Sheet 3: `SUPPLIER WHATSAPP UPDATES` (11 data rows, 2 cols)
| A | `MOBILE KIT SUPPLIER` | str | "Apple MacBook Pro 9,1 ..." | 0 |
| B | (no header) | str | "£85", "£100", "£150" | 1 |
Free-form supplier WhatsApp pasted feed.

---

## File 2: SALES_REPORT_2026.xlsx (289KB) — 5 sheets = 5 marketplaces

### Sheet `AMAZON` (1000 rows, 15 real cols A–O)
Headers: `nw, Order Number, SKU, IMEI, Supplier, Quantity, BP, SP, SP-BP, Marginal Tax, Commission, Postage, GP = SP-BP-TAX-COM-AMZTAX-POS-P COM, GP %, Comments`
Formulas: `SP-BP=H-G`, `Marginal Tax=I/6`, `Commission=H/100*7.14`, `Postage=8` (constant), `GP=H-G-J-K-L`, `GP %=M/G*100`.
Date fmt: `[$-409]d\-mmm\-yyyy`. IMEI can be alphanumeric (e.g. `SKC9P3QVP6F`, `JKQXQYGPPF`).

### Sheet `BM` (Back Market, 316 rows, 17 real cols)
Headers: `Date, Order No, SKU, IMEI, Supplier, Quantity, BP, SP, Payment Mode, SP-BP, Marginal Tax, PayPal/Klarna Com, Commission, Postage, GP = SP-BP-TAX-COM-POS-P COM, GP %, Comments`
Payment Mode values: Paypal, PayPal, Googlepay, Clear Pay, Klarna, Google Pay, Clearpay, ApplePay (inconsistent casing — must preserve as-is).
Formulas: `SP-BP=H-G`, `Marginal Tax=J/6` (note different col!), `PayPal/Klarna Com=H/100*2.5` (only when applicable), `Commission=H/100*12`, `Postage=10`, `GP=H-G-K-M-N-L`.

### Sheet `EBAY` (997 rows, 19 real cols)
Headers: `DATE, ORDER NUMBER, SKU, IMEI NUMBER, SUPPLIER, UNITS, BP, SP, SP-BP, MAR TAX, COM, ROF, FVF, 0.2, T.COM, SHIPPING, GP, GP%, NP(incl. PROMOTION)`
Note: header `0.2` is the literal number 0.2 (not a string).
Formulas: `SP-BP=H-G`, `MAR TAX=I*16.6%`, `COM=(H*6.9%)-(H*6.9%)*10%`, `ROF=H*0.35%`, `FVF=0.4` (const), `0.2=(K+L+M)*20%`, `T.COM=K+L+M+N`, `SHIPPING` ∈ {1, 2, 8}, `GP=I-J-O-P`, `GP%=Q/H*100`, `NP=Q-H*5%`.
Supplier includes value "CANCELLED" — implicit status channel.

### Sheet `ONBUY` (231 rows, 15 real cols)
Headers: `DATE, Order Number, SKU, IMEI, Supplier, BP, SP, SP-BP, MAR VAT, COM 7%, VAT 20%, SHIP, GP=SP-BP-COM-SHIP-MARVAT, GP%, Comments`
No QUANT column (vs others).
Formulas: `SP-BP=G-F`, `MAR VAT=H/6`, `COM 7%=G*7%`, `VAT 20%=J*20%`, `SHIP=8`, `GP=G-F-I-J-K-L`.

### Sheet `PROJECT` (460 rows, 15 real cols)
Headers: `Date, Order Number, SKU, IMEI, Supplier, QUANT, BP, SP, SP-BP, MAR TAX, COMM, POST, GP = SP-BP-TAX-COM-AMZTAX-POS-P COM, GP %, Comments`
"PROJECT" is a separate marketplace channel (B2B?). Order Number prefix matches Amazon style.
Formulas: same as AMAZON but `POST=5.9` (different constant).

---

## Cross-marketplace canonical Sale entity (synthesized)
- `saleDate`, `orderNumber`, `sku`, `imei`, `supplierName`, `quantity` (default 1), `buyPrice`, `salePrice`, `paymentMode` (BM only), `marketplace` (sheet name), `comments`.
- Computed: `spMinusBp`, `marginalTax`, `commission`, `postage`, `grossProfit`, `gpPercent`, plus marketplace-specific `payPalKlarnaCom` (BM), `rof, fvf, twentyPercent, totalCom, netProfit` (EBAY), `vat20`, `marVat` (ONBUY).

## Per-marketplace fee constants (must be configurable!)
| Marketplace | Commission % | Postage £ | Other |
|-------------|--------------|-----------|-------|
| Amazon      | 7.14         | 8         | margin tax = SP-BP / 6 |
| BM          | 12           | 10        | PayPal/Klarna fee 2.5% (conditional) |
| eBay        | 6.9% net of 10% reduction | 1/2/8 | ROF 0.35%, FVF £0.40, 20% VAT on (COM+ROF+FVF), promo 5% |
| OnBuy       | 7            | 8         | VAT 20% on margin tax |
| Project     | 7.14         | 5.90      | margin tax = SP-BP / 6 |

## Excel output requirements for daily report
- Multi-sheet workbook with **exact sheet names** and **exact header text** (including trailing spaces, mixed case, the literal `0.2` header).
- Date columns must use the original Excel format strings (`mm/dd/yyyy`, `[$-409]d\-mmm\-yyyy`, `d\-mmm\-yyyy`).
- Formulas must be re-emitted using `=H2-G2` style (so the workbook recomputes when opened) — OR computed numeric values with the same `0.00` cell format.
- IMEI column must allow alphanumeric strings (Apple serials) AND large integers (15-digit IMEIs) without scientific notation — format `0`.
- Trailing empty columns and a 1000-row pre-sized footprint per sheet appear to be intentional (template). App can leave them blank.
