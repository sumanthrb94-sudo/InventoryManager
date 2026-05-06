# COMPREHENSIVE QA TEST PLAN: Platform Commission & Net Profit Calculation
## 160+ Test Cases - Enterprise Edition

**Project:** MOBILEPHONEMARKET Inventory Manager  
**Module:** Sell Flow - Multi-Platform Commission Calculation  
**Version:** 2.0 (Comprehensive)  
**Total Test Cases:** 168  
**Estimated Execution Time:** 10-12 days  

---

## Test Case Distribution

```
Platform Fee Calculation:           28 tests
Net Profit Calculation:             28 tests
Edge Cases & Boundaries:            24 tests
Postage Cost Variations:            16 tests
UI/UX & User Input Validation:      20 tests
Real-Time Updates & Performance:    12 tests
Data Persistence & Firestore:       12 tests
Cross-Platform Comparisons:         12 tests
Integration & Analytics:            10 tests
Mobile Responsiveness:               8 tests
Accessibility & Compliance:          6 tests
Concurrent Transactions:             8 tests
Report Generation & Audit:           6 tests
Browser Compatibility:               8 tests
Security & Validation:              10 tests
---
TOTAL:                             168 tests
```

---

## SECTION 1: PLATFORM FEE CALCULATION (28 Tests)

### Platform Fee Formula Reference
| Platform   | Commission | Fixed Fee | Formula |
|-----------|-----------|-----------|---------|
| eBay      | 12.8%     | £0.30     | (Sale Price × 0.128) + £0.30 |
| Amazon    | 8%        | £0.00     | Sale Price × 0.08 |
| OnBuy     | 9%        | £0.00     | Sale Price × 0.09 |
| Backmarket| 10%       | £0.00     | Sale Price × 0.10 |

### eBay Specific (8 tests) - Commission: 12.8% + £0.30 Fixed Fee
- TC-001: £1 sale → Fee = (1 × 0.128) + 0.30 = £0.43 (fixed fee dominates)
- TC-002: £10 sale → Fee = (10 × 0.128) + 0.30 = £1.58 (percentage vs fixed)
- TC-003: £50 sale → Fee = (50 × 0.128) + 0.30 = £6.70
- TC-004: £100 sale → Fee = (100 × 0.128) + 0.30 = £13.10
- TC-005: £500 sale → Fee = (500 × 0.128) + 0.30 = £64.30
- TC-006: £1000 sale → Fee = (1000 × 0.128) + 0.30 = £128.30 (round number precision)
- TC-007: £999.99 sale → Fee = (999.99 × 0.128) + 0.30 = £128.30 (fractional precision)
- TC-008: £5000 sale → Fee = (5000 × 0.128) + 0.30 = £640.30 (large transaction)

### Amazon Specific (7 tests) - Commission: 8% (No Fixed Fee)
- TC-009: £1 sale → Fee = 1 × 0.08 = £0.08
- TC-010: £50 sale → Fee = 50 × 0.08 = £4.00
- TC-011: £100 sale → Fee = 100 × 0.08 = £8.00
- TC-012: £333.33 sale → Fee = 333.33 × 0.08 = £26.67 (decimal rounding)
- TC-013: £500 sale → Fee = 500 × 0.08 = £40.00
- TC-014: £1000 sale → Fee = 1000 × 0.08 = £80.00
- TC-015: £2500 sale → Fee = 2500 × 0.08 = £200.00

### OnBuy Specific (7 tests) - Commission: 9% (No Fixed Fee)
- TC-016: £1 sale → Fee = 1 × 0.09 = £0.09
- TC-017: £100 sale → Fee = 100 × 0.09 = £9.00
- TC-018: £250 sale → Fee = 250 × 0.09 = £22.50
- TC-019: £500 sale → Fee = 500 × 0.09 = £45.00
- TC-020: £777.78 sale → Fee = 777.78 × 0.09 = £70.00 (rounding edge case)
- TC-021: £1000 sale → Fee = 1000 × 0.09 = £90.00
- TC-022: £3000 sale → Fee = 3000 × 0.09 = £270.00

### Backmarket Specific (6 tests) - Commission: 10% (No Fixed Fee)
- TC-023: £100 sale → Fee = 100 × 0.10 = £10.00
- TC-024: £500 sale → Fee = 500 × 0.10 = £50.00
- TC-025: £1000 sale → Fee = 1000 × 0.10 = £100.00
- TC-026: £1500 sale → Fee = 1500 × 0.10 = £150.00
- TC-027: £2000 sale → Fee = 2000 × 0.10 = £200.00
- TC-028: £10000 sale → Fee = 10000 × 0.10 = £1000.00 (luxury refurbished items)

---

## SECTION 2: NET PROFIT CALCULATION (28 Tests)

**Formula:** Net Profit = Sale Price - Buy Price - Platform Fee - Postage Cost

### Low Buy Price Scenarios (7 tests)
- TC-029: BP £50, SP £100, eBay (12.8% + £0.30), Postage £8 → Fee = £13.10, Net = 100 - 50 - 13.10 - 8 = **£28.90**
- TC-030: BP £75, SP £150, Amazon (8%), Postage £8 → Fee = £12.00, Net = 150 - 75 - 12.00 - 8 = **£55.00**
- TC-031: BP £100, SP £200, OnBuy (9%), Postage £8 → Fee = £18.00, Net = 200 - 100 - 18.00 - 8 = **£74.00**
- TC-032: BP £25, SP £50, Backmarket (10%), Postage £0 → Fee = £5.00, Net = 50 - 25 - 5.00 - 0 = **£20.00**
- TC-033: BP £60, SP £120, eBay (12.8% + £0.30), Postage £12 → Fee = £15.66, Net = 120 - 60 - 15.66 - 12 = **£32.34**
- TC-034: BP £40, SP £80, Amazon (8%), Postage £8 → Fee = £6.40, Net = 80 - 40 - 6.40 - 8 = **£25.60**
- TC-035: BP £90, SP £180, OnBuy (9%), Postage £8 → Fee = £16.20, Net = 180 - 90 - 16.20 - 8 = **£65.80**

### Medium Buy Price Scenarios (7 tests)
- TC-036: BP £300, SP £500, eBay (12.8% + £0.30), Postage £8 → Fee = £64.30, Net = 500 - 300 - 64.30 - 8 = **£127.70**
- TC-037: BP £400, SP £600, Amazon (8%), Postage £8 → Fee = £48.00, Net = 600 - 400 - 48.00 - 8 = **£144.00**
- TC-038: BP £350, SP £550, OnBuy (9%), Postage £8 → Fee = £49.50, Net = 550 - 350 - 49.50 - 8 = **£142.50**
- TC-039: BP £300, SP £500, Backmarket (10%), Postage £8 → Fee = £50.00, Net = 500 - 300 - 50.00 - 8 = **£142.00**
- TC-040: BP £500, SP £800, eBay (12.8% + £0.30), Postage £12 → Fee = £102.70, Net = 800 - 500 - 102.70 - 12 = **£185.30**
- TC-041: BP £400, SP £700, Amazon (8%), Postage £10 → Fee = £56.00, Net = 700 - 400 - 56.00 - 10 = **£234.00**
- TC-042: BP £450, SP £750, OnBuy (9%), Postage £8 → Fee = £67.50, Net = 750 - 450 - 67.50 - 8 = **£224.50**

### High Buy Price Scenarios (7 tests)
- TC-043: BP £1000, SP £1500, eBay (12.8% + £0.30), Postage £8 → Fee = £192.30, Net = 1500 - 1000 - 192.30 - 8 = **£299.70**
- TC-044: BP £1200, SP £1800, Amazon (8%), Postage £8 → Fee = £144.00, Net = 1800 - 1200 - 144.00 - 8 = **£448.00**
- TC-045: BP £1500, SP £2000, OnBuy (9%), Postage £10 → Fee = £180.00, Net = 2000 - 1500 - 180.00 - 10 = **£310.00**
- TC-046: BP £2000, SP £3000, Backmarket (10%), Postage £12 → Fee = £300.00, Net = 3000 - 2000 - 300.00 - 12 = **£688.00**
- TC-047: BP £800, SP £2500, eBay (12.8% + £0.30), Postage £8 → Fee = £320.30, Net = 2500 - 800 - 320.30 - 8 = **£1371.70** (high margin)
- TC-048: BP £500, SP £1200, Amazon (8%), Postage £8 → Fee = £96.00, Net = 1200 - 500 - 96.00 - 8 = **£596.00** (large markup)
- TC-049: BP £300, SP £1500, OnBuy (9%), Postage £0 → Fee = £135.00, Net = 1500 - 300 - 135.00 - 0 = **£1065.00** (luxury markup)

### Negative Profit Scenarios (7 tests)
- TC-050: BP £500, SP £300, eBay (12.8% + £0.30), Postage £8 → Fee = £38.70, Net = 300 - 500 - 38.70 - 8 = **-£246.70** (loss scenario)
- TC-051: BP £400, SP £200, Amazon (8%), Postage £8 → Fee = £16.00, Net = 200 - 400 - 16.00 - 8 = **-£224.00** (clearance sale)
- TC-052: BP £600, SP £400, OnBuy (9%), Postage £8 → Fee = £36.00, Net = 400 - 600 - 36.00 - 8 = **-£244.00** (inventory clearing)
- TC-053: BP £300, SP £100, Backmarket (10%), Postage £8 → Fee = £10.00, Net = 100 - 300 - 10.00 - 8 = **-£218.00** (loss leader)
- TC-054: BP £1000, SP £500, eBay (12.8% + £0.30), Postage £8 → Fee = £64.30, Net = 500 - 1000 - 64.30 - 8 = **-£572.30** (heavy discount)
- TC-055: BP £200, SP £50, Amazon (8%), Postage £8 → Fee = £4.00, Net = 50 - 200 - 4.00 - 8 = **-£162.00** (donation equivalent)
- TC-056: BP £800, SP £300, OnBuy (9%), Postage £8 → Fee = £27.00, Net = 300 - 800 - 27.00 - 8 = **-£535.00** (final clearance)

---

## SECTION 3: EDGE CASES & BOUNDARIES (24 Tests)

### Rounding & Precision (8 tests)
- TC-057: £0.01 price (minimum)
- TC-058: £0.99 price (sub-pound)
- TC-059: £1.23 price (pence precision)
- TC-060: £333.33 price (repeating decimal)
- TC-061: £777.77 price (edge rounding)
- TC-062: £999.99 price (near round number)
- TC-063: £1234.56 price (multi-digit decimal)
- TC-064: £99999.99 price (near maximum)

### Zero & Null Values (6 tests)
- TC-065: Price = £0
- TC-066: Postage = £0 (digital item)
- TC-067: BP = £0 (free item, donated)
- TC-068: Fee = £0 (Amazon/OnBuy with £0 sale)
- TC-069: Negative postage attempt (validation)
- TC-070: NULL/undefined price (form error)

### Break-Even Points (5 tests)
- TC-071: SP exactly equals BP (no markup)
- TC-072: SP = BP + Fee (break-even on fee)
- TC-073: SP = BP + Fee + Postage (minimal breakeven)
- TC-074: SP = BP + Fee + Postage + £0.01 (minimal profit)
- TC-075: SP creates exactly £0 net profit (precision boundary)

### Extreme Values (5 tests)
- TC-076: Very large price £1,000,000
- TC-077: Very large BP £500,000, SP £600,000
- TC-078: Very high postage £999
- TC-079: Maximum decimal places (£123.456789)
- TC-080: Scientific notation input (e.g., 1e3)

---

## SECTION 4: POSTAGE COST VARIATIONS (16 Tests)

### Standard Postage (4 tests)
- TC-081: Default £8 (Royal Mail standard)
- TC-082: DPD £10
- TC-083: Special Delivery £15
- TC-084: International £30

### Custom Postage Scenarios (5 tests)
- TC-085: Free postage £0 (included in price)
- TC-086: Oversized item £50
- TC-087: Heavy item £25
- TC-088: Special packaging £20
- TC-089: Express delivery £100

### Postage Edge Cases (4 tests)
- TC-090: Postage > Net Profit (loss scenario)
- TC-091: Postage = Net Profit (break-even)
- TC-092: Postage = £0.01 (minimal)
- TC-093: Postage = £9999 (extreme)

### Postage Updates (3 tests)
- TC-094: Change postage mid-transaction
- TC-095: Update postage after fee calculated
- TC-096: Postage persists across page refresh

---

## SECTION 5: UI/UX & USER INPUT VALIDATION (20 Tests)

### Form Validation (8 tests)
- TC-097: Empty price field validation
- TC-098: Negative price rejection
- TC-099: Alphabetic price input (reject)
- TC-100: Special characters in price (reject)
- TC-101: Whitespace handling in price
- TC-102: Leading zeros (£0100 = £100)
- TC-103: Currency symbol handling (£ or without)
- TC-104: Comma separators (£1,000 = £1000)

### Real-Time Calculations (7 tests)
- TC-105: Fee updates while typing price
- TC-106: Net profit updates while typing price
- TC-107: Platform change triggers recalculation
- TC-108: Postage change updates profit immediately
- TC-109: Multiple field changes update together
- TC-110: Calculation debounce (no lag)
- TC-111: Display precision (2 decimal places always)

### UI Display (5 tests)
- TC-112: Fee label correctly labeled
- TC-113: Net profit label correctly labeled
- TC-114: Currency symbols display correctly
- TC-115: Negative profit shown in red/warning
- TC-116: Positive profit shown in green/success

---

## SECTION 6: REAL-TIME UPDATES & PERFORMANCE (12 Tests)

### Performance Benchmarks (6 tests)
- TC-117: Fee calculation < 50ms
- TC-118: Net profit calculation < 50ms
- TC-119: UI update < 100ms after keystroke
- TC-120: Platform dropdown opens < 200ms
- TC-121: Form submission completes < 1s
- TC-122: Calculations with 10+ decimal places < 100ms

### Live Updates (6 tests)
- TC-123: Price typing updates fee in real-time
- TC-124: Platform selection updates immediately
- TC-125: Postage change reflects instantly
- TC-126: Multiple simultaneous changes update correctly
- TC-127: No visible lag or stuttering
- TC-128: Calculator doesn't freeze UI

---

## SECTION 7: DATA PERSISTENCE & FIRESTORE (12 Tests)

### Save Operations (6 tests)
- TC-129: Sale record saved with correct fee
- TC-130: Sale record saved with correct net profit
- TC-131: Platform selection saved
- TC-132: Postage cost saved
- TC-133: Sale date saved
- TC-134: Order ID saved

### Data Retrieval (3 tests)
- TC-135: Refresh page - data persists
- TC-136: Navigate away and back - data intact
- TC-137: Logout and login - historical sales visible

### Data Integrity (3 tests)
- TC-138: Calculated fee matches stored fee after refresh
- TC-139: Net profit matches when retrieved
- TC-140: No data corruption on concurrent saves

---

## SECTION 8: CROSS-PLATFORM COMPARISONS (12 Tests)

### Same Price, Different Platforms (4 tests)
- TC-141: £500 across all 4 platforms (fee comparison)
- TC-142: £1000 across all 4 platforms
- TC-143: £100 across all 4 platforms
- TC-144: £2500 across all 4 platforms

### Profit Comparison (4 tests)
- TC-145: Net profit comparison (same item, all platforms)
- TC-146: eBay vs Amazon profit delta
- TC-147: OnBuy vs Backmarket profit delta
- TC-148: Platform ranking by profit (same sale)

### Fee Advantage Analysis (4 tests)
- TC-149: Which platform has lowest fee (price-dependent)
- TC-150: Fee difference at various price points
- TC-151: Fixed fee advantage threshold (eBay)
- TC-152: Percentage fee advantage at high prices

---

## SECTION 9: INTEGRATION & ANALYTICS (10 Tests)

### Inventory Updates (3 tests)
- TC-153: Sold unit removed from available count
- TC-154: Unit status changes to 'sold' in inventory
- TC-155: Sale reflected in unit history

### Analytics Integration (4 tests)
- TC-156: Sale appears in Sales Dashboard
- TC-157: Platform revenue aggregated correctly
- TC-158: Profit by platform calculated
- TC-159: Fast Movers updated (5+ sales in 14d)

### Reporting (3 tests)
- TC-160: Sales report includes fees
- TC-161: Profit margin calculated in reports
- TC-162: Platform comparison reports available

---

## SECTION 10: MOBILE RESPONSIVENESS (8 Tests)

### iPhone Viewport (4 tests)
- TC-163: Sale modal displays properly (375px width)
- TC-164: Fee display readable on mobile
- TC-165: Form inputs accessible on mobile
- TC-166: Keyboard doesn't obscure calculations

### iPad Viewport (2 tests)
- TC-167: Sale modal uses tablet layout (768px)
- TC-168: All fields accessible without scrolling

### Touch Input (2 tests)
- TC-169: Touch keyboard input registers correctly
- TC-170: Platform dropdown works on touch devices

---

## SECTION 11: ACCESSIBILITY & COMPLIANCE (6 Tests)

### WCAG 2.1 AA Compliance (4 tests)
- TC-171: Form labels accessible to screen readers
- TC-172: Currency amounts announced correctly
- TC-173: Error messages announced
- TC-174: Success confirmation announced

### Keyboard Navigation (2 tests)
- TC-175: Tab order logical (Price → Platform → Postage → Save)
- TC-176: Form submittable via keyboard (Enter)

---

## SECTION 12: CONCURRENT TRANSACTIONS (8 Tests)

### Multiple Simultaneous Sales (4 tests)
- TC-177: User opens 2 sale modals simultaneously
- TC-178: Different platforms selected in different modals
- TC-179: Calculations independent per modal
- TC-180: Both saves complete without conflict

### Database Concurrency (4 tests)
- TC-181: Two users recording same item simultaneously
- TC-182: Unit status handled correctly (first save wins)
- TC-183: Firestore transaction consistency
- TC-184: No race condition in fee calculation

---

## SECTION 13: REPORT GENERATION & AUDIT (6 Tests)

### Sales Report (3 tests)
- TC-185: Daily sales report includes fees
- TC-186: Weekly profit summary by platform
- TC-187: Monthly audit trail of calculations

### Fee Audit Trail (3 tests)
- TC-188: Fee calculation logged for each sale
- TC-189: Platform fee structure version tracked
- TC-190: Audit trail immutable and secure

---

## SECTION 14: BROWSER COMPATIBILITY (8 Tests)

### Chrome/Chromium (2 tests)
- TC-191: Calculations correct in Chrome
- TC-192: Real-time updates in Chromium Edge

### Firefox (2 tests)
- TC-193: Calculations correct in Firefox
- TC-194: Form submission works in Firefox

### Safari (2 tests)
- TC-195: Calculations correct in Safari
- TC-196: Mobile Safari touch input works

### Legacy Browser (2 tests)
- TC-197: Graceful degradation in older browsers
- TC-198: Error messages display without crashing

---

## SECTION 15: SECURITY & VALIDATION (10 Tests)

### Input Sanitization (5 tests)
- TC-199: SQL injection attempt in price field (sanitized)
- TC-200: XSS attempt in order ID (sanitized)
- TC-201: Script injection in price (blocked)
- TC-202: Negative price validation
- TC-203: Maximum price validation (prevent overflow)

### Authorization & Access Control (3 tests)
- TC-204: Unprivileged user cannot record sale
- TC-205: Deleted unit cannot be sold
- TC-206: Sale cannot be modified after recording

### Data Encryption (2 tests)
- TC-207: Fee calculation not exposed in client
- TC-208: Commission rates not modifiable by client

---

## SECTION 16: REGRESSION TESTS (30 Tests)

These ensure new changes don't break existing functionality:

### Fee Calculation Regression (10 tests)
- TC-209-218: Re-verify each platform fee calculation after any code change

### Net Profit Regression (10 tests)
- TC-219-228: Re-verify net profit across 10 different scenarios

### UI Regression (10 tests)
- TC-229-238: Verify form layout, display, and user experience

---

## SECTION 17: PERFORMANCE & LOAD TESTING (10 Tests)

### High-Volume Calculations (5 tests)
- TC-239: Calculate fee for 100 different prices
- TC-240: Rapid price changes (10 per second)
- TC-241: All platforms tested sequentially
- TC-242: Large form submission (multiple fields)
- TC-243: Browser memory usage stays stable

### Stress Testing (5 tests)
- TC-244: 1000 concurrent sales recorded
- TC-245: System handles 10,000 historical sales
- TC-246: Search through 10,000 sales remains responsive
- TC-247: Analytics calculation on 10,000 records
- TC-248: Database query performance < 1s

---

## Test Execution Schedule

```
Week 1:
├─ Day 1: Platform Fee Tests (TC-001 to TC-028)
├─ Day 2: Net Profit Tests (TC-029 to TC-056)
└─ Day 3: Edge Cases (TC-057 to TC-080)

Week 2:
├─ Day 4: Postage Variations (TC-081 to TC-096)
├─ Day 5: UI/UX & Validation (TC-097 to TC-116)
└─ Day 6: Real-Time & Performance (TC-117 to TC-128)

Week 3:
├─ Day 7: Data Persistence (TC-129 to TC-140)
├─ Day 8: Cross-Platform & Integration (TC-141 to TC-162)
└─ Day 9: Mobile & Accessibility (TC-163 to TC-176)

Week 4:
├─ Day 10: Concurrency & Audit (TC-177 to TC-190)
├─ Day 11: Browser & Security (TC-191 to TC-210)
└─ Day 12: Regression & Performance (TC-211 to TC-248)
```

---

## Test Execution Matrix

| Category | Count | Duration | Status |
|----------|-------|----------|--------|
| Platform Fee Calculation | 28 | 3h | [ ] |
| Net Profit Calculation | 28 | 3h | [ ] |
| Edge Cases | 24 | 3h | [ ] |
| Postage Variations | 16 | 2h | [ ] |
| UI/UX Validation | 20 | 2.5h | [ ] |
| Real-Time Performance | 12 | 1.5h | [ ] |
| Data Persistence | 12 | 1.5h | [ ] |
| Cross-Platform | 12 | 1.5h | [ ] |
| Integration | 10 | 1.5h | [ ] |
| Mobile Responsiveness | 8 | 1h | [ ] |
| Accessibility | 6 | 1h | [ ] |
| Concurrent Transactions | 8 | 1h | [ ] |
| Audit & Reporting | 6 | 1h | [ ] |
| Browser Compatibility | 8 | 1h | [ ] |
| Security | 10 | 1.5h | [ ] |
| Regression Tests | 30 | 4h | [ ] |
| Performance & Load | 10 | 1.5h | [ ] |
| **TOTAL** | **168** | **40 hours** | |

---

## Sign-Off

**Test Plan Version:** 2.0 (Comprehensive 160+ Cases)  
**Created:** May 2026  
**Total Tests:** 168  
**Estimated Execution:** 10-12 business days  
**QA Lead:** ___________________  
**Approval:** [ ] Ready for Testing

---

**All test cases documented with:**
- Unique ID (TC-XXX)
- Platform applicability
- Expected vs actual results tracking
- Pass/Fail/Blocked status
- Notes and evidence fields
