# Questions for the client

Things the system has to guess at. Each one changes the profit figures, so we
would rather ask than assume. Answers are recorded inline as they arrive.

**Open: 1, 2 and 8.** Question 6 is parked for a conversation. Questions 3, 4,
5 and 7 are answered and recorded below — kept in place rather than deleted so
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

## 2. Profit % — measured against what you paid, or what you sold for?

You buy a phone at £300, sell at £400, and make **£60** after all fees.

- Measured against what you **paid**: 20%
- Measured against what you **sold it for**: 15%

Right now eBay shows 15% and the other four show 20%. Same phone, same £60 —
it just reads differently depending on the channel, so the channels cannot be
compared with each other.

**Which one do you want to see everywhere?**

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

## 8. Two fixed fees — every order, or only sometimes? — STILL OPEN, re-asked

Rewording this, because the first version was unclear.

**Back Market takes £8.99 off every order**, labelled "Customer Care Fees".
It is a flat amount, so it hurts far more on a cheap phone than an expensive
one:

| you buy | you sell | your profit | the £8.99 is |
|---|---|---|---|
| £50 | £80 | **−£1.35** | more than the entire profit |
| £100 | £150 | £7.62 | 54% of it |
| £300 | £400 | £21.78 | 29% of it |

**The question: does Back Market really charge you £8.99 on every single
order — including a £80 phone, where it turns the sale into a loss?**

Or is it charged only sometimes — for example only when a customer actually
contacts support, or only on certain categories?

**The same question for eBay's £0.40** (labelled FVF), charged on every eBay
order. That one is small enough not to change any decisions, but it should
still be right.

*This matters because Back Market is where the money is leaking. In the
simulated month, 36% of Back Market sales lost money — more than three times
any other channel — and this flat fee plus the 11%-of-sale-price commission is
why.*

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

---

# Not a client question — needed internally

**Who should be able to process returns?**

Right now only three email addresses can: `admin@inventorymanager.com`,
`sumanthbolla97@gmail.com` and `sai@inventorymanager.com`. Everyone else is
blocked from processing a return at all.

Send the work email addresses of anyone else who needs to, and they can be
added.
