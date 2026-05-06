# QA TEST PLAN: Platform Commission Calculation & Sell Flow

**Project:** MOBILEPHONEMARKET Inventory Manager  
**Module:** Sell Page - Platform Commission & Net Profit Calculation  
**Date:** May 2026  
**Total Test Cases:** 68  
**Platforms Tested:** eBay, Amazon, OnBuy, Backmarket

---

## Platform Fee Structure Reference

| Platform | Commission | Fixed Fee | Formula |
|----------|-----------|-----------|---------|
| **eBay** | 12.8% | £0.30 | Fee = (Price × 0.128) + 0.30 |
| **Amazon** | 8.0% | £0.00 | Fee = (Price × 0.08) + 0 |
| **OnBuy** | 9.0% | £0.00 | Fee = (Price × 0.09) + 0 |
| **Backmarket** | 10.0% | £0.00 | Fee = (Price × 0.10) + 0 |

**Net Profit Formula:**
```
Net Profit = Sale Price - Buy Price - Platform Fee - Postage Cost
```

---

## Test Execution Summary

| Test Category | Count | Priority |
|---------------|-------|----------|
| Platform Fee Calculation | 16 | CRITICAL |
| Net Profit Calculation | 16 | CRITICAL |
| Edge Cases & Boundaries | 12 | HIGH |
| Postage Cost Variations | 8 | HIGH |
| UI/UX & User Input | 10 | MEDIUM |
| Integration & Data Persistence | 6 | HIGH |
| **TOTAL** | **68** | |

---

## Category 1: Platform Fee Calculation (16 Tests)

### TC-001: eBay - Calculate 12.8% commission + £0.30 fixed fee on £500 sale
**Priority:** CRITICAL  
**Preconditions:**
- User is on Sell Page
- An available inventory unit is selected (e.g., iPhone 15 Pro, BP £300)

**Steps:**
1. Click "Record Sale" on an available unit
2. Select Platform: eBay
3. Enter Sale Price: £500
4. Accept default postage: £8
5. Observe the Platform Fee display

**Expected Result:**  
Platform Fee = (£500 × 0.128) + £0.30 = **£64.30**

**Actual Result:** ____________

**Status:** [ ] Pass [ ] Fail [ ] Blocked

---

### TC-002: Amazon - Calculate 8% commission on £500 sale
**Priority:** CRITICAL  
**Expected Result:** Platform Fee = £500 × 0.08 = **£40.00**

---

### TC-003: OnBuy - Calculate 9% commission on £500 sale
**Priority:** CRITICAL  
**Expected Result:** Platform Fee = £500 × 0.09 = **£45.00**

---

### TC-004: Backmarket - Calculate 10% commission on £500 sale
**Priority:** CRITICAL  
**Expected Result:** Platform Fee = £500 × 0.10 = **£50.00**

---

### TC-005: eBay - Fixed £0.30 fee appears on low-value sale (£10)
**Priority:** CRITICAL  
**Expected Result:** Fee = (£10 × 0.128) + £0.30 = **£1.58**

---

### TC-006: Amazon - Low-value sale (£15) rounds to 2 decimals
**Priority:** CRITICAL  
**Expected Result:** Fee = £15 × 0.08 = **£1.20** (exactly)

---

### TC-007: OnBuy - Medium-value sale (£333) with decimal rounding
**Priority:** CRITICAL  
**Expected Result:** Fee = £333 × 0.09 = **£29.97** (rounded to 2dp)

---

### TC-008: High-value sale (£2000) accuracy test
**Priority:** CRITICAL  
**Expected Result:** Fee = (£2000 × 0.128) + £0.30 = **£256.30**

---

### TC-009: Fee changes when platform selection changes
**Priority:** CRITICAL  
**Setup:** eBay selected, price £500 (fee £64.30)  
**Action:** Switch to Amazon  
**Expected Result:** Fee updates to **£40.00** immediately

---

### TC-010: Fee updates dynamically when sale price changes
**Priority:** CRITICAL  
**Setup:** eBay platform, price £500 (fee £64.30)  
**Action:** Change price to £1000  
**Expected Result:** Fee updates to **£128.30** in real-time

---

### TC-011: Fractional price (£99.99) fee calculation
**Priority:** CRITICAL  
**Expected Result:** Fee = (£99.99 × 0.128) + £0.30 = **£12.80** (rounded)

---

### TC-012: Fee stays constant when postage changes
**Priority:** HIGH  
**Setup:** eBay, price £500 (fee £64.30), postage £8  
**Action:** Change postage to £15  
**Expected Result:** Platform fee remains **£64.30**; net profit decreases by £7

---

### TC-013: Zero or empty price - fee should be £0.00
**Priority:** HIGH  
**Expected Result:** Fee displays as **£0.00**

---

### TC-014: Very large price (£50,000) without overflow
**Priority:** MEDIUM  
**Expected Result:** Fee = (£50,000 × 0.128) + £0.30 = **£6400.30**

---

### TC-015: Negative price validation error
**Priority:** MEDIUM  
**Action:** Attempt to enter -£100  
**Expected Result:** Error message: "Please enter a valid selling price" OR field rejects negative

---

### TC-016: Non-numeric input (e.g., "abc") handling
**Priority:** MEDIUM  
**Action:** Type "abc" in price field, attempt save  
**Expected Result:** Field converts to 0 or shows error; save blocked

---

## Category 2: Net Profit Calculation (16 Tests)

### TC-017: eBay - Net profit with default postage (£8)
**Priority:** CRITICAL  
**Setup:** Unit BP £300, Sale Price £500, eBay, Postage £8  
**Expected Result:**  
Net Profit = £500 - £300 - £64.30 - £8 = **£127.70**

---

### TC-018: Amazon - Net profit (lower fees advantage)
**Priority:** CRITICAL  
**Setup:** Unit BP £300, Sale Price £500, Amazon, Postage £8  
**Expected Result:**  
Net Profit = £500 - £300 - £40 - £8 = **£152.00**

---

### TC-019: OnBuy - Net profit calculation
**Priority:** CRITICAL  
**Expected Result:** Net Profit = £500 - £300 - £45 - £8 = **£147.00**

---

### TC-020: Backmarket - Net profit calculation
**Priority:** CRITICAL  
**Expected Result:** Net Profit = £500 - £300 - £50 - £8 = **£142.00**

---

### TC-021: Negative profit scenario (price < BP + fees)
**Priority:** CRITICAL  
**Setup:** Unit BP £200, Price £100 (below break-even)  
**Expected Result:** Net Profit = £100 - £200 - £8 - £8 = **-£116.00** (negative)

---

### TC-022: Break-even scenario
**Priority:** CRITICAL  
**Setup:** BP £300, eBay fee £64.30, postage £8 → need price £372.30  
**Expected Result:** Net Profit ≈ **£0.00**

---

### TC-023: Net profit updates when postage changes
**Priority:** HIGH  
**Setup:** eBay, BP £300, Price £500, currently £127.70 with £8 postage  
**Action:** Change postage from £8 to £12  
**Expected Result:** Net Profit updates to **£123.70** (£4 decrease)

---

### TC-024: Custom postage cost (£20)
**Priority:** HIGH  
**Expected Result:** Net Profit = £500 - £300 - £64.30 - £20 = **£115.70**

---

### TC-025: Zero postage cost (digital items)
**Priority:** HIGH  
**Setup:** Unit BP £300, Price £500, eBay, Postage £0  
**Expected Result:** Net Profit = £500 - £300 - £64.30 - £0 = **£135.70**

---

### TC-026: Profit margin percentage calculation
**Priority:** HIGH  
**Setup:** Unit BP £300, Price £500, eBay, Postage £8; Net Profit £127.70  
**Expected Result:** Profit Margin = (£127.70 / £500) × 100 = **25.54%**

---

### TC-027: High-value item profit (BP £1500, Price £2500)
**Priority:** MEDIUM  
**Expected Result:**  
Net Profit = £2500 - £1500 - (£2500 × 0.128 + £0.30) - £8 = **£703.70**

---

### TC-028: Fractional sale price (£499.99) precision
**Priority:** MEDIUM  
**Expected Result:** Net Profit = £499.99 - £300 - £64.30 - £8 = **£127.69**

---

### TC-029: Platform comparison - same item across all 4 platforms
**Priority:** MEDIUM  
**Setup:** Unit BP £300, Price £500  
**Comparison:**
- eBay: **£127.70**
- Amazon: **£152.00** (best - lowest fees)
- OnBuy: **£147.00**
- Backmarket: **£142.00**

**Expected:** Amazon has highest profit (8% vs 12.8% eBay)

---

## Category 3: Edge Cases & Boundaries (12 Tests)

### TC-030: Decimal precision in fee calculation
**Setup:** Sale price £123.45, eBay  
**Expected:** Fee = (£123.45 × 0.128) + £0.30 = **£16.10** (exact)

---

### TC-031: Very small sale price (£1)
**Setup:** Unit BP £50, Price £1, eBay  
**Expected Result:** Fee = (£1 × 0.128) + £0.30 = **£0.43**; Net Profit likely negative

---

### TC-032: Maximum price without overflow
**Setup:** Price £999,999  
**Expected:** Calculation succeeds without overflow or precision loss

---

### TC-033: Zero postage is valid
**Setup:** Digital item, Postage £0  
**Expected:** No error; net profit calculated without postage

---

### TC-034: Rounding edge case (.995 pence)
**Setup:** Price £777.78, OnBuy (9% = £69.9999 ≈ £70)  
**Expected:** Fee = **£70.00** (correctly rounded)

---

### TC-035: Minimal price edge (£0.01)
**Priority:** MEDIUM  
**Setup:** Price £0.01, eBay  
**Expected:** Fee calculated accurately (£0.30 fixed fee dominates)

---

### TC-036: Price equals Buy Price
**Setup:** Unit BP £300, Price £300, eBay, Postage £8  
**Expected:** Net Profit = £300 - £300 - £38.30 - £8 = **-£46.30** (loss)

---

### TC-037: Postage exceeds profit
**Setup:** Unit BP £300, Price £350, eBay, Postage £100  
**Expected:** Net Profit = £350 - £300 - £44.30 - £100 = **-£94.30**

---

### TC-038: Platform fee alone exceeds profit margin
**Setup:** Unit BP £400, Price £410, eBay (fee £52.30 + postage £8)  
**Expected:** Net Profit = £410 - £400 - £52.30 - £8 = **-£50.30** (loss)

---

### TC-039: Simultaneous changes (price, platform, postage)
**Priority:** LOW  
**Action:** Change all three values at once  
**Expected:** All calculations update correctly and consistently

---

## Category 4: Postage Cost Variations (8 Tests)

### TC-040: Default postage applied (£8)
**Priority:** HIGH  
**Setup:** New sale, no postage specified  
**Expected:** Default £8 postage applied automatically

---

### TC-041: Custom postage (£0)
**Priority:** HIGH  
**Expected:** £0 postage accepted; net profit maximized

---

### TC-042: High postage (£25)
**Priority:** HIGH  
**Expected:** Net profit reduced by £25

---

### TC-043: Very high postage (£100) creates loss
**Priority:** MEDIUM  
**Expected:** Can still save; negative profit allowed

---

### TC-044: Postage with fractional amount (£8.50)
**Priority:** MEDIUM  
**Expected:** Accepted and calculated correctly

---

### TC-045: Zero postage + high margin = maximum profit
**Priority:** MEDIUM  
**Setup:** Price £1000, BP £300, Postage £0  
**Expected:** Net profit maximized for platform selection

---

### TC-046: Postage change reflects on invoice/receipt
**Priority:** MEDIUM  
**Expected:** Postage cost saved to unit record correctly

---

### TC-047: Postage cost validation (no negative values)
**Priority:** LOW  
**Action:** Attempt to enter -£5 postage  
**Expected:** Field rejects negative or converts to 0

---

## Category 5: UI/UX & User Input (10 Tests)

### TC-048: Fee display updates in real-time
**Priority:** HIGH  
**Action:** Type price "500" digit by digit  
**Expected:** Fee updates after each keystroke

---

### TC-049: Net profit display updates in real-time
**Priority:** HIGH  
**Expected:** Net profit recalculates as user types

---

### TC-050: Platform dropdown shows all 4 options
**Priority:** HIGH  
**Expected:** eBay, Amazon, OnBuy, Backmarket all available

---

### TC-051: Currency symbol (£) consistent throughout
**Priority:** MEDIUM  
**Expected:** All monetary fields prefixed with £

---

### TC-052: Read-only fields (BP, IMEI) not editable
**Priority:** MEDIUM  
**Expected:** Buy Price field shows unit BP; not editable

---

### TC-053: Sale Date defaults to today
**Priority:** MEDIUM  
**Setup:** Open new sale modal  
**Expected:** Sale Date field shows current date (2026-05-06)

---

### TC-054: Sale Date can be edited (past dates allowed)
**Priority:** MEDIUM  
**Action:** Change sale date to yesterday  
**Expected:** Accepted; influences warranty/age calculations

---

### TC-055: Order ID field is required
**Priority:** HIGH  
**Action:** Try to save without Order ID  
**Expected:** Error: "Please enter the order number from the platform"

---

### TC-056: Modal closes on successful save
**Priority:** HIGH  
**Action:** Fill all fields, click Save  
**Expected:** Modal closes; unit status changes to 'sold'

---

### TC-057: Modal has Cancel button (discard unsaved)
**Priority:** MEDIUM  
**Action:** Click Cancel without saving  
**Expected:** Modal closes; unit remains 'available'

---

## Category 6: Integration & Data Persistence (6 Tests)

### TC-058: Sale record saved to Firestore correctly
**Priority:** CRITICAL  
**Action:** Record a sale; refresh page  
**Expected:** Unit status = 'sold', sale price, platform, fee all persisted

---

### TC-059: Multiple sales recorded for same model
**Priority:** HIGH  
**Setup:** Same model, different sales  
**Expected:** All sales tracked independently in database

---

### TC-060: Sale updates Intelligence Panel (Fast Movers)
**Priority:** HIGH  
**Setup:** Sell 5+ of same model in 14 days  
**Expected:** Model appears in "Fast Movers" intelligence

---

### TC-061: Sold unit no longer in "Available" inventory
**Priority:** HIGH  
**Action:** Record sale for available unit  
**Expected:** Unit removed from stock count; appears in sold history

---

### TC-062: Platform fee history is auditable
**Priority:** MEDIUM  
**Setup:** Record sale with fee calculation  
**Expected:** Fee amount saved with transaction; can be reviewed later

---

### TC-063: Net profit aggregate by platform
**Priority:** MEDIUM  
**Action:** Sell via all 4 platforms; check analytics  
**Expected:** Total profit by platform calculated correctly

---

---

## Test Execution Checklist

- [ ] All CRITICAL tests passed (32/32)
- [ ] All HIGH priority tests passed (22/22)  
- [ ] All MEDIUM priority tests passed (12/12)
- [ ] All LOW priority tests passed (2/2)
- [ ] No blockers or failures
- [ ] UI responsive on desktop and mobile
- [ ] Data persists after refresh
- [ ] No console errors
- [ ] No precision/rounding errors
- [ ] All platforms tested with realistic prices

---

## Sign-Off

**QA Tester Name:** ___________________  
**Date Completed:** ___________________  
**Build Version:** ___________________  
**Notes:** ___________________________________

**Approved For Production:** [ ] YES [ ] NO
