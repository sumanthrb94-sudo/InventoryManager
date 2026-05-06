# QA Test Cases Index - 168 Test Cases
## MOBILEPHONEMARKET Inventory Manager - Platform Commission & Net Profit Verification

**Total Test Cases:** 168  
**Last Updated:** 2026-05-06  
**Status:** Ready for Execution

---

## QUICK REFERENCE

| Category | Test Count | File |
|----------|-----------|------|
| Platform Fee Calculation | 28 | QA_TEST_PLAN_COMPREHENSIVE_168.md |
| Net Profit Calculation | 28 | QA_TEST_PLAN_COMPREHENSIVE_168.md |
| Edge Cases & Boundaries | 24 | QA_TEST_PLAN_COMPREHENSIVE_168.md |
| Postage Cost Variations | 16 | QA_TEST_PLAN_COMPREHENSIVE_168.md |
| UI/UX & User Input Validation | 20 | QA_TEST_PLAN_COMPREHENSIVE_168.md |
| Real-Time Updates & Performance | 12 | QA_TEST_PLAN_COMPREHENSIVE_168.md |
| Data Persistence & Firestore | 12 | QA_TEST_PLAN_COMPREHENSIVE_168.md |
| Cross-Platform Comparisons | 12 | QA_TEST_PLAN_COMPREHENSIVE_168.md |
| Integration & Analytics | 10 | QA_TEST_PLAN_COMPREHENSIVE_168.md |
| Mobile Responsiveness | 8 | QA_TEST_PLAN_COMPREHENSIVE_168.md |
| Accessibility & Compliance | 6 | QA_TEST_PLAN_COMPREHENSIVE_168.md |
| Concurrent Transactions | 8 | QA_TEST_PLAN_COMPREHENSIVE_168.md |
| Report Generation & Audit | 6 | QA_TEST_PLAN_COMPREHENSIVE_168.md |
| Browser Compatibility | 8 | QA_TEST_PLAN_COMPREHENSIVE_168.md |
| Security & Validation | 10 | QA_TEST_PLAN_COMPREHENSIVE_168.md |

---

## SECTION 1: PLATFORM FEE CALCULATION (TC-001 to TC-028)

### eBay Commission Tests (12.8% + £0.30 Fixed Fee)
- **TC-001:** £1 sale → Expected Fee: £0.43
- **TC-002:** £10 sale → Expected Fee: £1.58
- **TC-003:** £50 sale → Expected Fee: £6.70
- **TC-004:** £100 sale → Expected Fee: £13.10
- **TC-005:** £500 sale → Expected Fee: £64.30
- **TC-006:** £1000 sale → Expected Fee: £128.30
- **TC-007:** £999.99 sale → Expected Fee: £128.30
- **TC-008:** £5000 sale → Expected Fee: £640.30

### Amazon Commission Tests (8% Flat)
- **TC-009:** £1 sale → Expected Fee: £0.08
- **TC-010:** £50 sale → Expected Fee: £4.00
- **TC-011:** £100 sale → Expected Fee: £8.00
- **TC-012:** £333.33 sale → Expected Fee: £26.67
- **TC-013:** £500 sale → Expected Fee: £40.00
- **TC-014:** £1000 sale → Expected Fee: £80.00
- **TC-015:** £2500 sale → Expected Fee: £200.00

### OnBuy Commission Tests (9% Flat)
- **TC-016:** £1 sale → Expected Fee: £0.09
- **TC-017:** £100 sale → Expected Fee: £9.00
- **TC-018:** £250 sale → Expected Fee: £22.50
- **TC-019:** £500 sale → Expected Fee: £45.00
- **TC-020:** £777.78 sale → Expected Fee: £70.00
- **TC-021:** £1000 sale → Expected Fee: £90.00
- **TC-022:** £3000 sale → Expected Fee: £270.00

### Backmarket Commission Tests (10% Flat)
- **TC-023:** £100 sale → Expected Fee: £10.00
- **TC-024:** £500 sale → Expected Fee: £50.00
- **TC-025:** £1000 sale → Expected Fee: £100.00
- **TC-026:** £1500 sale → Expected Fee: £150.00
- **TC-027:** £2000 sale → Expected Fee: £200.00
- **TC-028:** £10000 sale → Expected Fee: £1000.00

---

## SECTION 2: NET PROFIT CALCULATION (TC-029 to TC-056)

### Low Buy Price Scenarios
- **TC-029:** eBay - BP £50, SP £100, Postage £8 → Expected Net Profit: £28.90
- **TC-030:** Amazon - BP £75, SP £150, Postage £8 → Expected Net Profit: £55.00
- **TC-031:** OnBuy - BP £100, SP £200, Postage £8 → Expected Net Profit: £74.00
- **TC-032:** Backmarket - BP £25, SP £50, Postage £0 → Expected Net Profit: £20.00
- **TC-033:** eBay - BP £60, SP £120, Postage £12 → Expected Net Profit: £32.34
- **TC-034:** Amazon - BP £40, SP £80, Postage £8 → Expected Net Profit: £25.60
- **TC-035:** OnBuy - BP £90, SP £180, Postage £8 → Expected Net Profit: £65.80

### Medium Buy Price Scenarios
- **TC-036:** eBay - BP £300, SP £500, Postage £8 → Expected Net Profit: £127.70
- **TC-037:** Amazon - BP £400, SP £600, Postage £8 → Expected Net Profit: £144.00
- **TC-038:** OnBuy - BP £350, SP £550, Postage £8 → Expected Net Profit: £142.50
- **TC-039:** Backmarket - BP £300, SP £500, Postage £8 → Expected Net Profit: £142.00
- **TC-040:** eBay - BP £500, SP £800, Postage £12 → Expected Net Profit: £185.30
- **TC-041:** Amazon - BP £400, SP £700, Postage £10 → Expected Net Profit: £234.00
- **TC-042:** OnBuy - BP £450, SP £750, Postage £8 → Expected Net Profit: £224.50

### High Buy Price Scenarios
- **TC-043:** eBay - BP £1000, SP £1500, Postage £8 → Expected Net Profit: £299.70
- **TC-044:** Amazon - BP £1200, SP £1800, Postage £8 → Expected Net Profit: £448.00
- **TC-045:** OnBuy - BP £1500, SP £2000, Postage £10 → Expected Net Profit: £310.00
- **TC-046:** Backmarket - BP £2000, SP £3000, Postage £12 → Expected Net Profit: £688.00
- **TC-047:** eBay - BP £800, SP £2500, Postage £8 → Expected Net Profit: £1371.70
- **TC-048:** Amazon - BP £500, SP £1200, Postage £8 → Expected Net Profit: £596.00
- **TC-049:** OnBuy - BP £300, SP £1500, Postage £0 → Expected Net Profit: £1065.00

### Negative Profit Scenarios
- **TC-050:** eBay - BP £500, SP £300, Postage £8 → Expected Net Profit: -£246.70
- **TC-051:** Amazon - BP £400, SP £200, Postage £8 → Expected Net Profit: -£224.00
- **TC-052:** OnBuy - BP £600, SP £400, Postage £8 → Expected Net Profit: -£244.00
- **TC-053:** Backmarket - BP £300, SP £100, Postage £8 → Expected Net Profit: -£218.00
- **TC-054:** eBay - BP £1000, SP £500, Postage £8 → Expected Net Profit: -£572.30
- **TC-055:** Amazon - BP £200, SP £50, Postage £8 → Expected Net Profit: -£162.00
- **TC-056:** OnBuy - BP £800, SP £300, Postage £8 → Expected Net Profit: -£535.00

---

## SECTION 3: EDGE CASES & BOUNDARIES (TC-057 to TC-080)

### Rounding & Precision Tests
- **TC-057:** Minimum price £0.01
- **TC-058:** Sub-pound price £0.99
- **TC-059:** Pence precision £1.23
- **TC-060:** Repeating decimal £333.33
- **TC-061:** Edge rounding £777.77
- **TC-062:** Near round number £999.99
- **TC-063:** Multi-digit decimal £1234.56
- **TC-064:** Near maximum £99999.99

### Zero & Break-Even Scenarios
- **TC-065:** Zero sale price
- **TC-066:** Zero buy price (gifted item)
- **TC-067:** Zero postage (local pickup)
- **TC-068:** Break-even point (SP = BP + Fee + Postage)
- **TC-069:** Minimal positive profit £0.01
- **TC-070:** Minimal negative profit -£0.01

### Extreme Values
- **TC-071:** Maximum price £999999.99
- **TC-072:** Extreme margin (SP = 10× BP)
- **TC-073:** Extreme discount (SP = 0.1× BP)
- **TC-074:** Identical buy/sell prices
- **TC-075:** Single pence difference (BP £100 vs SP £100.01)

### Commission Edge Cases
- **TC-076:** Platform fee equals margin (profit break-even on fee alone)
- **TC-077:** Postage equals margin (profit break-even on postage alone)
- **TC-078:** Fee + postage exceed margin (significant loss)
- **TC-079:** Multiple commissions comparison (same item on 4 platforms)
- **TC-080:** Rounding cascades (multiple decimal places)

---

## SECTION 4: POSTAGE COST VARIATIONS (TC-081 to TC-096)

### Standard Postage Tests
- **TC-081:** Royal Mail Special Delivery £8.00
- **TC-082:** Royal Mail Signed For £6.50
- **TC-083:** Standard Parcel £4.50
- **TC-084:** Large Parcel £10.00
- **TC-085:** DHL International £15.00
- **TC-086:** UPS Standard £12.00

### Custom Postage Tests
- **TC-087:** Free postage (included in price)
- **TC-088:** Very high postage £50.00
- **TC-089:** Fractional postage £3.45
- **TC-090:** Postage as percentage of item value

### Postage Update Scenarios
- **TC-091:** Update postage before sale confirmation
- **TC-092:** Postage refund calculation
- **TC-093:** Multiple items, combined postage
- **TC-094:** Postage per item split calculation
- **TC-095:** Postage savings on bulk orders
- **TC-096:** Dynamic postage based on weight/zone

---

## SECTION 5: UI/UX & USER INPUT VALIDATION (TC-097 to TC-116)

### Form Input Validation
- **TC-097:** Sale price input (numbers only)
- **TC-098:** Buy price input (numbers only)
- **TC-099:** Decimal input (2 places max)
- **TC-100:** Negative value rejection
- **TC-101:** Extremely large number handling
- **TC-102:** Currency symbol handling

### Real-Time Calculation Display
- **TC-103:** Live fee update as price changes
- **TC-104:** Live profit update as price changes
- **TC-105:** Live profit update as postage changes
- **TC-106:** Platform selection updates calculations
- **TC-107:** Multi-platform comparison display
- **TC-108:** Highlight negative profit (red)

### User Feedback & Warnings
- **TC-109:** Warning when profit < £10
- **TC-110:** Warning when profit < £0
- **TC-111:** Success message on save
- **TC-112:** Error message on invalid input
- **TC-113:** Confirmation before delete
- **TC-114:** Toast notifications appear/disappear

### Accessibility Features
- **TC-115:** Keyboard navigation (Tab/Enter)
- **TC-116:** Screen reader compatibility (ARIA labels)

---

## SECTION 6: REAL-TIME UPDATES & PERFORMANCE (TC-117 to TC-128)

### Performance Benchmarks
- **TC-117:** Form input response time < 50ms
- **TC-118:** Calculation update < 100ms
- **TC-119:** Page load time < 2 seconds
- **TC-120:** Database query response < 500ms
- **TC-121:** Large data set rendering (1000+ items)
- **TC-122:** Concurrent user simulation (10 users)

### Real-Time Synchronization
- **TC-123:** Updates reflect across tabs
- **TC-124:** Updates reflect across devices
- **TC-125:** Conflict resolution on concurrent edits
- **TC-126:** Websocket connection stability
- **TC-127:** Offline mode handling
- **TC-128:** Sync on reconnection

---

## SECTION 7: DATA PERSISTENCE & FIRESTORE (TC-129 to TC-140)

### Save & Retrieval
- **TC-129:** Save new inventory item
- **TC-130:** Update existing item
- **TC-131:** Delete item
- **TC-132:** Retrieve item by ID
- **TC-133:** Retrieve all items
- **TC-134:** Search by item name

### Data Integrity
- **TC-135:** No duplicate entries
- **TC-136:** Required fields validation
- **TC-137:** Data type enforcement
- **TC-138:** Timestamp accuracy
- **TC-139:** Audit trail logging
- **TC-140:** Backup & restore functionality

---

## SECTION 8: CROSS-PLATFORM COMPARISONS (TC-141 to TC-152)

### Platform Fee Comparison
- **TC-141:** eBay vs Amazon same item
- **TC-142:** eBay vs OnBuy same item
- **TC-143:** eBay vs Backmarket same item
- **TC-144:** Amazon vs OnBuy same item
- **TC-145:** Amazon vs Backmarket same item
- **TC-146:** OnBuy vs Backmarket same item

### Profit Comparison
- **TC-147:** Highest profit platform (same item)
- **TC-148:** Lowest profit platform (same item)
- **TC-149:** Most expensive platform (fee%)
- **TC-150:** Least expensive platform (fee%)
- **TC-151:** Multi-platform price optimization
- **TC-152:** Platform selection recommendation

---

## SECTION 9: INTEGRATION & ANALYTICS (TC-153 to TC-162)

### Inventory Integration
- **TC-153:** Sales affect stock count
- **TC-154:** Sold items move to archive
- **TC-155:** Profit aggregation per platform
- **TC-156:** Profit aggregation total

### Reporting & Analytics
- **TC-157:** Daily sales report
- **TC-158:** Weekly profit summary
- **TC-159:** Platform performance metrics
- **TC-160:** Profit margin analysis
- **TC-161:** Top-performing items list
- **TC-162:** Trend analysis over time

---

## FILES IN THIS FOLDER

1. **QA_TEST_PLAN_COMPREHENSIVE_168.md** - Full detailed test plan with step-by-step instructions
2. **QA_EXECUTION_GUIDE.md** - Enterprise testing protocol and execution schedule
3. **QA_TEST_PLAN.md** - Original test plan with 63 test cases
4. **QA_TEST_PLAN_PLATFORM_COMMISSION.docx** - Professional DOCX format report with tables
5. **TEST_CASES_INDEX.md** - This file - Quick reference index of all test cases

---

## EXECUTION GUIDE

**Estimated Duration:** 10-12 business days  
**Total Hours:** 40+ hours  
**Testers Required:** 1-2 testers  
**Test Environment:** Staging/Dev environment

### Daily Execution Schedule
- Day 1-2: Platform Fee Calculation tests (TC-001 to TC-028) - 4 hours
- Day 2-3: Net Profit Calculation tests (TC-029 to TC-056) - 4 hours
- Day 3: Edge Cases & Boundaries (TC-057 to TC-080) - 3 hours
- Day 4: Postage Variations (TC-081 to TC-096) - 2 hours
- Day 5: UI/UX Validation (TC-097 to TC-116) - 3 hours
- Day 6: Real-Time Updates (TC-117 to TC-128) - 2 hours
- Day 7: Data Persistence (TC-129 to TC-140) - 2 hours
- Day 8: Cross-Platform (TC-141 to TC-152) - 2 hours
- Day 9: Integration & Analytics (TC-153 to TC-162) - 2 hours
- Day 10: Final verification and sign-off - 2 hours

---

## PLATFORM COMMISSION RATES

| Platform | Commission % | Fixed Fee | Example: £500 Sale |
|----------|-------------|-----------|-------------------|
| eBay | 12.8% | £0.30 | (500 × 0.128) + £0.30 = **£64.30** |
| Amazon | 8.0% | None | 500 × 0.08 = **£40.00** |
| OnBuy | 9.0% | None | 500 × 0.09 = **£45.00** |
| Backmarket | 10.0% | None | 500 × 0.10 = **£50.00** |

---

## SIGN-OFF

- **Test Execution Date:** _______________
- **Executed By:** _______________
- **Approved By:** _______________
- **Pass Rate:** ____% (Target: 100%)
- **Critical Issues:** _______
- **Minor Issues:** _______
- **Status:** ☐ PASS ☐ FAIL ☐ CONDITIONAL PASS

**Notes:**
```
_________________________________________________________________
_________________________________________________________________
_________________________________________________________________
```
