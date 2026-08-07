# Questions for the client

Things the system has to guess at. Each one changes the profit figures, so we
would rather ask than assume. Answers are recorded inline as they arrive.

**Open: 1, plus eBay's £0.40 in question 8.** Question 6 is parked for a conversation. Questions 2, 3, 4, 5, 7
and Back Market's part of 8 are answered and recorded below — kept in place rather than deleted so
the reasoning survives.

---

## 1. When you refund a customer, does the marketplace give you its commission back?

You sell a phone for £400 on Amazon. Amazon keeps about **£33** as commission.
The customer returns it and you refund them in full.

**Do you get that £33 back?**

Please answer for each channel separately — they may well differ:

| | commission returned? |
|---|---|
| Amazon | |
| Back Market | |
| eBay | |
| OnBuy | |
| Temu | |

*Today the system assumes you do NOT get it back. If you do, every refund is
costing you around £33 less than the reports are showing.*

---

## 2. Profit % — measured against what you paid, or what you sold for? — ANSWERED

**Divide by what you paid, on every channel.** Implemented 2026-08.

Why it mattered. The same phone — £300 in, £400 out:

| | money actually made | percentage shown |
|---|---|---|
| Amazon | £40.50 | 13.5% |
| eBay | **£44.06** | **11.0%** |

eBay earned more and displayed less, purely because it divided by the £400
sale price while the other four divided by the £300 cost. Read at face value,
the report recommended the worse channel.

Confirmed against the operator's live file of 30 July before changing
anything — the split is real and it is theirs:

| tab | rows checked | divides by |
|---|---|---|
| Amazon | 60 | BP (60/60) |
| Back Market | 13 | BP (13/13) |
| OnBuy | 6 | BP (6/6) |
| **eBay** | 32 | **SP (32/32)** |

**So the app now deliberately differs from the operator's own eBay tab on this
one cell.** Every other eBay figure still reproduces their file exactly —
verified on 8 live rows, gross profit matching to the penny on 8 of 8. Only
the percentage moved.

Historical eBay percentages will read higher than before: 18.86% becomes
35.20% on a £30/£55.99 sale. No money changed; the same profit is simply
being measured against the cost instead of the sale price.

---

## 3. If a fee changes, should last year's figures change with it? — ANSWERED

**"That's fine, leave it."** Retrospective restatement is accepted: when a fee
rate changes, every past sale recomputes at the new rate. No change needed.

*Also noted: the plan is to eventually remove sales import altogether, so
sales would only ever be entered in the app. Nothing to do today, but it means
this question loses most of its force in future.*

---

## 4. Do you ever give money back without taking the phone? — ANSWERED

**"In any case we accept the postage loss."** No goodwill/partial-refund
record is wanted. Nothing to build.

---

## 5. Is delivery included in the price you type in? — ANSWERED

**"In all cases consider we bear the postage loss, so that it's clear."**

Verified this is already what happens — postage comes off gross profit on all
five channels:

| | postage | postage VAT | effect on profit |
|---|---|---|---|
| Amazon | £6.30 | £1.26 | −£7.56 |
| Back Market | £6.30 | £1.26 | −£7.56 |
| eBay | £6.30 | £0.00 | −£6.30 |
| OnBuy | £6.30 | £1.26 | −£7.56 |
| Temu | £6.30 | £1.26 | −£7.56 |

eBay's postage VAT is £0 because eBay zero-rates shipping to us; the £6.30
itself is still our cost. No change needed.

---

## 6. A phone sold in July, refunded in August — which month takes the hit? — TO DISCUSS

**"We need to discuss."** Left open. Today July's sales figure drops when the
refund happens, so July's profit changes after it has been read.

---

## 7. Is a returned phone ever thrown away? — ANSWERED

**No.** Every returned phone is either repaired and resold or sent back to the
supplier. Nothing is ever written off.

*This confirms the returns cost model is complete: a return costs carriage,
possibly a repair invoice, and is offset by any supplier credit — never the
value of a handset. There is no write-off path to build.*

---

## 8. Two fixed fees — every order, or only sometimes? — ANSWERED for Back Market

**"BM has £8.99 as customer care fee for each and every unit."**

Confirmed as current behaviour. Handsets are tracked one per IMEI, so each
unit is its own row and each row carries £8.99 — three phones cost £26.97, not
£8.99. No change needed.

*Small edge, noted rather than acted on: if a single row ever carried a
quantity above 1, the fee would apply once rather than per unit. That cannot
happen for handsets, which are one per row by construction. It could only
arise on a quantity-pooled accessory line, and whether customer care applies
to those at all is not something we have been told.*

**eBay's £0.40 (FVF) is still unconfirmed**, charged on every eBay order. It is
small enough that no decision turns on it, but it should still be right.

### What this confirms about Back Market

The £8.99 is flat, so it lands hardest on cheap stock — and this is now
confirmed behaviour rather than an assumption:

| you buy | you sell | your profit | the £8.99 is |
|---|---|---|---|
| £50 | £80 | **−£1.35** | more than the entire profit |
| £100 | £150 | £7.62 | 54% of it |
| £300 | £400 | £21.78 | 29% of it |

Together with Back Market's 11%-of-sale-price commission, this is why Back
Market needs a far bigger markup than anywhere else just to break even:

| you paid | AMAZON | **BM** | EBAY | ONBUY | TEMU |
|---|---|---|---|---|---|
| £100 | +£23 | **+£39** | +£21 | +£23 | +£17 |
| £300 | +£46 | **+£70** | +£42 | +£45 | +£28 |
| £500 | +£69 | **+£100** | +£62 | +£67 | +£40 |

**Roughly 1.5× the markup of Amazon, eBay and OnBuy, and 2.5× Temu.** If the
same price is listed everywhere, Back Market is where money leaks — which is
exactly what the simulated month showed, with 36% of Back Market sales losing
money against 8–17% elsewhere.

This is worth checking against a real trading month.

---

# Already answered — recorded here so nothing gets asked twice

| | answer |
|---|---|
| Replacement carriage | Three journeys: out, faulty one back, replacement out |
| No stock for a replacement | Refund instead |
| The £1 "Accessories" line | The box and charger supplied with a phone |
| Which channels charge it | All five |
| Office vs SHS stock | Both charge it |
| Accessories sold on their own | No £1 — the charger IS the charger |
| Warranty | Full refund within 30 days, then free repair or replacement |
| Repair cost | Recorded per unit as the invoice arrives |
| Faulty unit | Comes back, repaired and resold where possible |
| Supplier returns | Full credit or a replacement unit; no carriage cost; credit lands same day |
| The Postage figure | What the carrier charges us |
| Which period a return's costs fall in | The period it was returned |
| Fee changes restating closed months | Accepted — no change needed |
| Partial / goodwill refunds | Not recorded; the postage loss is simply accepted |
| Who bears postage | We do, in all cases |
| Scrapping a returned phone | Never happens |
| Profit % | Divided by what you paid, on all five channels |
| BM customer care fee | £8.99 on each and every unit |

---

# Not a client question — needed internally

**Who should be able to process returns?**

Right now only three email addresses can: `admin@inventorymanager.com`,
`sumanthbolla97@gmail.com` and `sai@inventorymanager.com`. Everyone else is
blocked from processing a return at all.

Send the work email addresses of anyone else who needs to, and they can be
added.
