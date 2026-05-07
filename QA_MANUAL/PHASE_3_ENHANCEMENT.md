# InventoryManager - Phase 3: Enhancement Tests
**Warranty, Permissions, Performance, Migration, Advanced APIs**

---

## Phase 3 Overview

**Target Tests**: 22 enhancement test cases  
**Priority**: 🟢 MEDIUM - Nice-to-have features  
**Time Estimate**: 4.5 hours  
**Risk Level**: MEDIUM  
**Status**: Not Started

---

## Section 1: Warranty Management (5 Tests)

### TEST-1301: Warranty - Create with Expiry Date
**Workflow**: Warranty Management  
**Priority**: 🟡 MEDIUM  
**Time**: 10 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] Unit purchased with warranty
- [ ] Warranty feature enabled in form

**Test Steps**
1. Create unit with warranty
2. Set warranty expiry: 2027-05-07 (1 year from purchase)
3. Save unit
4. Navigate to unit details
5. Verify warranty expiry shows

**Expected Results**
- ✅ Warranty expiry date stored
- ✅ Displayed on unit detail
- ✅ Calculation: Purchase date + 1 year = expiry

**Verification Points**
□ Warranty field present  
□ Date saved correctly  
□ Date displayed on detail  

**Pass Criteria**
- [ ] Warranty created
- [ ] Expiry date: 2027-05-07
- [ ] Displayed correctly

---

### TEST-1302: Warranty - Validation (Not Past Date)
**Workflow**: Warranty Management  
**Priority**: 🟡 MEDIUM  
**Time**: 8 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] On create unit form

**Test Steps**
1. Try to set warranty expiry to past date: 2024-01-01
2. Attempt to save
3. Check validation error

**Expected Results**
- ✅ Error: "Warranty expiry cannot be in the past"
- ✅ Form prevents submission
- ✅ User must select future date

**Pass Criteria**
- [ ] Past date rejected
- [ ] Error message shown
- [ ] Form validation works

---

### TEST-1303: Warranty - Expiry Alert
**Workflow**: Warranty Management  
**Priority**: 🟡 MEDIUM  
**Time**: 10 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] Unit with warranty expiring: 2026-05-10 (3 days away)
- [ ] Dashboard open

**Test Steps**
1. Check dashboard for warranty alerts
2. Look for warning: "Warranty expires in 3 days"
3. Color should indicate warning (orange/red)
4. Click to view expiring units list

**Expected Results**
- ✅ Alert shown for units expiring soon (< 30 days)
- ✅ Warning color (orange)
- ✅ Clickable to view list
- ✅ List shows expiry dates

**Pass Criteria**
- [ ] Alert displayed
- [ ] Expiry date shown
- [ ] Color: orange
- [ ] List accessible

---

### TEST-1304: Warranty - Renewal Tracking
**Workflow**: Warranty Management  
**Priority**: 🟡 MEDIUM  
**Time**: 12 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] Unit with warranty expiring tomorrow
- [ ] Warranty renewal feature available

**Test Steps**
1. Open unit details
2. Click "Renew Warranty"
3. Set new expiry: +1 year
4. Confirm renewal
5. Verify old expiry recorded as "Previous Warranty"
6. New expiry shown as current

**Expected Results**
- ✅ Warranty renewal recorded
- ✅ Old expiry preserved in history
- ✅ New expiry set correctly
- ✅ History visible on unit detail

**Pass Criteria**
- [ ] Warranty renewed
- [ ] Old expiry saved
- [ ] New expiry set
- [ ] History tracked

---

### TEST-1305: Warranty - Report on Expiring Units
**Workflow**: Warranty Management  
**Priority**: 🟡 MEDIUM  
**Time**: 12 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] Multiple units with warranty:
  - 3 expiring this month
  - 5 expiring next month
  - 2 already expired

**Test Steps**
1. Navigate to Reports → Warranty Status
2. View expiring this month: should show 3
3. View expiring next month: should show 5
4. View expired: should show 2
5. Export report

**Expected Results**
- ✅ This month: 3 units
- ✅ Next month: 5 units
- ✅ Expired: 2 units
- ✅ Export available

**Pass Criteria**
- [ ] Counts accurate
- [ ] Expiry dates grouped correctly
- [ ] Export functional
- [ ] Report helpful

---

## Section 2: Permissions & Access Control (4 Tests)

### TEST-1401: Permissions - Admin Only Features
**Workflow**: Access Control  
**Priority**: 🟡 MEDIUM  
**Time**: 10 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] Admin user logged in
- [ ] Regular user account available

**Test Steps**
1. **As Admin**: Navigate to Settings
2. Verify "Delete Unit" button visible
3. Verify "Reset Database" button visible
4. **Switch to Regular User**: Log out, log in as regular
5. Navigate to Settings
6. Verify buttons not visible or disabled
7. Try to delete unit (should be blocked)

**Expected Results**
- ✅ Admin sees delete/reset buttons
- ✅ Regular user doesn't see these buttons
- ✅ Attempted delete blocked for regular user
- ✅ Error: "Permission denied"

**Pass Criteria**
- [ ] Admin features visible to admin
- [ ] Hidden from regular user
- [ ] Actions blocked appropriately
- [ ] Error message clear

---

### TEST-1402: Permissions - Read-Only Mode
**Workflow**: Access Control  
**Priority**: 🟡 MEDIUM  
**Time**: 10 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] Viewer/Read-only user account

**Test Steps**
1. Log in as read-only user
2. Navigate to Available Units
3. Try to click "Sell" button
4. Try to create new unit
5. Try to delete unit
6. Verify all blocked with appropriate messages

**Expected Results**
- ✅ Sell button disabled or hidden
- ✅ Create unit form blocked
- ✅ Delete button hidden/disabled
- ✅ View/search functions work
- ✅ Error messages: "Read-only access"

**Pass Criteria**
- [ ] View functions work
- [ ] All edit functions blocked
- [ ] Clear permission messages
- [ ] No accidental modifications possible

---

### TEST-1403: Permissions - Supplier Data Isolation
**Workflow**: Access Control  
**Priority**: 🟡 MEDIUM  
**Time**: 10 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] Supplier A user (can only see Supplier A units)
- [ ] Supplier B user (can only see Supplier B units)

**Test Steps**
1. **Supplier A user**: Log in, navigate to inventory
2. Verify only Supplier A units visible (5 units)
3. Search for Supplier B IMEI (should not find)
4. **Switch to Supplier B user**: Log in
5. Verify only Supplier B units visible (3 units)
6. Verify Supplier A units not visible

**Expected Results**
- ✅ Supplier A user sees only 5 Supplier A units
- ✅ Supplier B user sees only 3 Supplier B units
- ✅ Complete data isolation
- ✅ No cross-supplier visibility

**Pass Criteria**
- [ ] Data properly isolated
- [ ] No cross-supplier leakage
- [ ] Each user sees only their data
- [ ] Security verified

---

### TEST-1404: Permissions - Audit Log (Admin Only)
**Workflow**: Access Control  
**Priority**: 🟡 MEDIUM  
**Time**: 12 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] Admin user logged in
- [ ] Regular user has performed actions

**Test Steps**
1. Admin logs in
2. Navigate to Settings → Audit Log
3. View log entries: user actions, timestamps, details
4. Filter by user: should show actions by specific user
5. Filter by action type: should show all sales, returns, etc.
6. Verify regular user cannot access this log

**Expected Results**
- ✅ Audit log visible to admin only
- ✅ Log shows: User, Action, Timestamp, Details
- ✅ Filtering by user works
- ✅ Filtering by action type works
- ✅ Regular user blocked from access

**Pass Criteria**
- [ ] Audit log accessible to admin
- [ ] Log complete and accurate
- [ ] Filtering works
- [ ] Regular user blocked

---

## Section 3: Performance Testing (7 Tests)

### TEST-1501: Performance - Load Time with 1000 Units
**Workflow**: Performance  
**Priority**: 🟡 MEDIUM  
**Time**: 15 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] 1000 units in inventory
- [ ] Browser DevTools Network tab open
- [ ] Network throttling: "Fast 3G" (to simulate real conditions)

**Test Steps**
1. Open dashboard
2. Measure page load time (until fully interactive)
3. Expected: < 3 seconds
4. Scroll through Available Units list
5. Verify smooth scrolling (no lag)
6. Open Sold History
7. Measure load time for Sold History (should be fast)

**Expected Results**
- ✅ Dashboard loads in < 3 seconds
- ✅ Scrolling smooth (60 FPS)
- ✅ Sold History accessible
- ✅ No UI freezing
- ✅ Responsive interaction

**Verification Points**
□ Page load time < 3s  
□ Smooth scrolling  
□ Responsive UI  
□ No memory issues  

**Pass Criteria**
- [ ] Load time < 3 seconds
- [ ] Scrolling smooth
- [ ] Fully interactive within 3s
- [ ] No lag on interaction

---

### TEST-1502: Performance - Search Speed (1000 Units)
**Workflow**: Performance  
**Priority**: 🟡 MEDIUM  
**Time**: 12 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] 1000 units in inventory
- [ ] Search feature

**Test Steps**
1. Perform search: "iPhone"
2. Measure search time
3. Expected: < 500ms
4. Verify results shown: ~100 iPhone units
5. Perform another search: "Grade=Excellent"
6. Measure filter time
7. Expected: < 500ms

**Expected Results**
- ✅ Search results in < 500ms
- ✅ Filter applies in < 500ms
- ✅ 100 results displayed smoothly
- ✅ No lag in input field

**Pass Criteria**
- [ ] Search time < 500ms
- [ ] Filter time < 500ms
- [ ] Results displayed smoothly
- [ ] Responsive input

---

### TEST-1503: Performance - Batch Import (500 Units)
**Workflow**: Performance  
**Priority**: 🟡 MEDIUM  
**Time**: 15 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] CSV with 500 units
- [ ] On Batch Import page
- [ ] Timer ready

**Test Steps**
1. Select CSV file with 500 units
2. Start import, note time
3. Expected duration: < 30 seconds
4. Monitor console for errors
5. Verify all 500 imported
6. Check dashboard: count increased by 500
7. Measure time to dashboard update

**Expected Results**
- ✅ Import completes in < 30 seconds
- ✅ All 500 units imported successfully
- ✅ No console errors
- ✅ Dashboard updated quickly
- ✅ No browser freeze during import

**Pass Criteria**
- [ ] Import time < 30 seconds
- [ ] All 500 imported
- [ ] No errors
- [ ] Dashboard updates quickly
- [ ] No freezing

---

### TEST-1504: Performance - Real-Time Updates (100 Concurrent Users)
**Workflow**: Performance  
**Priority**: 🟠 ORANGE  
**Time**: 20 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] Load testing tool available (e.g., Apache JMeter, Locust)
- [ ] Cloud infrastructure for testing

**Test Steps**
1. Simulate 100 concurrent users
2. Each user: Perform 5 sales per minute
3. Monitor server response time
4. Expected: < 2 seconds per request
5. Monitor database performance
6. Expected: < 100ms per query
7. Verify data consistency under load
8. Check for race conditions

**Expected Results**
- ✅ Response time < 2 seconds under load
- ✅ Database queries < 100ms
- ✅ No data corruption
- ✅ No race conditions detected
- ✅ System handles 100 concurrent users

**Pass Criteria**
- [ ] Response time < 2s
- [ ] Query time < 100ms
- [ ] Data consistent
- [ ] Handles 100 concurrent users
- [ ] No crashes or errors

---

### TEST-1505: Performance - Report Generation (1 Year Data)
**Workflow**: Performance  
**Priority**: 🟡 MEDIUM  
**Time**: 12 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] 1 year of sales data (500+ transactions)
- [ ] Reports page open

**Test Steps**
1. Generate report for full year: 2025-05-07 to 2026-05-07
2. Measure generation time
3. Expected: < 5 seconds
4. Verify all data included
5. Export to CSV
6. Measure export time
7. Expected: < 3 seconds

**Expected Results**
- ✅ Report generates in < 5 seconds
- ✅ All 500+ transactions included
- ✅ Export completes in < 3 seconds
- ✅ CSV file accurate and complete
- ✅ Visualization responsive

**Pass Criteria**
- [ ] Report time < 5 seconds
- [ ] Export time < 3 seconds
- [ ] Complete data included
- [ ] Accurate calculations

---

### TEST-1506: Performance - Memory Usage (Long Session)
**Workflow**: Performance  
**Priority**: 🟡 MEDIUM  
**Time**: 30 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] Browser DevTools Memory tab open
- [ ] 1000 units in inventory

**Test Steps**
1. Note initial memory usage
2. Use app for 30 minutes: view units, perform sales, etc.
3. Every 5 minutes: check memory usage
4. Look for memory leaks (increasing without recovery)
5. After 30 minutes, measure final memory
6. Expected: No more than 20% increase

**Expected Results**
- ✅ Memory usage stable throughout session
- ✅ No rapid increase (indicates leak)
- ✅ Max increase < 20% from baseline
- ✅ Memory recovered after operations complete
- ✅ No performance degradation over time

**Verification Points**
□ Memory stable during session  
□ No growth pattern indicating leak  
□ Performance doesn't degrade  
□ Garbage collection working  

**Pass Criteria**
- [ ] Memory increase < 20%
- [ ] No memory leak detected
- [ ] Stable performance throughout
- [ ] Recovery after operations

---

### TEST-1507: Performance - Mobile Loading (Fast 3G)
**Workflow**: Performance  
**Priority**: 🟡 MEDIUM  
**Time**: 15 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] Mobile device or browser emulation
- [ ] DevTools Network tab: Fast 3G throttling
- [ ] 1000 units in inventory

**Test Steps**
1. Open app on mobile (3G throttled)
2. Measure dashboard load time
3. Expected: < 5 seconds on 3G
4. Scroll through units
5. Verify smooth scrolling despite throttling
6. Try search on mobile
7. Measure search time
8. Expected: < 1 second

**Expected Results**
- ✅ Dashboard loads in < 5 seconds on 3G
- ✅ Scrolling remains responsive
- ✅ Search completes in < 1 second
- ✅ Touch interactions responsive
- ✅ No significant lag on mobile

**Pass Criteria**
- [ ] Load time < 5s on 3G
- [ ] Scrolling smooth
- [ ] Search < 1 second
- [ ] Touch responsive
- [ ] Good mobile UX

---

## Section 4: Data Migration & Backup (3 Tests)

### TEST-1601: Migration - Import from Legacy System (CSV)
**Workflow**: Data Migration  
**Priority**: 🟡 MEDIUM  
**Time**: 20 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] Legacy system CSV export prepared
- [ ] CSV format: Model, Grade, BP, IMEI, Status
- [ ] 100 units in CSV

**Test Steps**
1. Navigate to Admin → Data Import (if available)
2. Select legacy CSV file
3. Map fields: Legacy_Model → Model, Legacy_Grade → Grade, etc.
4. Preview import
5. Verify 100 units shown
6. Start import
7. Verify all 100 units created
8. Check data integrity (spot-check 5 units)

**Expected Results**
- ✅ CSV imports successfully
- ✅ All 100 units created
- ✅ Field mapping works correctly
- ✅ Data integrity maintained
- ✅ No data loss during migration

**Pass Criteria**
- [ ] All 100 units imported
- [ ] Field mapping correct
- [ ] Data integrity verified
- [ ] No data loss
- [ ] Migration successful

---

### TEST-1602: Migration - Data Backup & Restore
**Workflow**: Data Migration  
**Priority**: 🟡 MEDIUM  
**Time**: 20 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] 200 units in inventory
- [ ] Admin access to backup feature

**Test Steps**
1. Admin navigates to Settings → Backup
2. Click "Create Backup"
3. Wait for backup to complete (expected: < 2 min for 200 units)
4. Download backup file (JSON or database export)
5. Delete 50 units to simulate data loss
6. Click "Restore from Backup"
7. Select backup file
8. Verify all 200 units restored
9. Verify deleted units back
10. Check all unit data intact

**Expected Results**
- ✅ Backup created successfully
- ✅ Backup completes in < 2 minutes
- ✅ Restore from backup works
- ✅ All 200 units restored
- ✅ Data integrity maintained
- ✅ No data loss

**Pass Criteria**
- [ ] Backup created
- [ ] Restore functional
- [ ] All units recovered
- [ ] Data integrity verified
- [ ] Complete recovery

---

### TEST-1603: Migration - Multi-Supplier Data Consolidation
**Workflow**: Data Migration  
**Priority**: 🟡 MEDIUM  
**Time**: 20 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] Data from 3 separate supplier accounts
- [ ] Each has 50 units
- [ ] Consolidation feature available

**Test Steps**
1. Supplier A user: Note 50 units
2. Supplier B user: Note 50 units
3. Supplier C user: Note 50 units
4. Admin: Navigate to Settings → Consolidate
5. Select all 3 suppliers to merge
6. Confirm consolidation
7. Verify merged view shows all 150 units
8. Check data integrity: all units still present
9. Verify supplier tags preserved (for reference)

**Expected Results**
- ✅ All 150 units consolidated
- ✅ Data integrity maintained
- ✅ Supplier origin tracked
- ✅ Consolidated view shows all units
- ✅ No data loss during merge

**Pass Criteria**
- [ ] All 150 units consolidated
- [ ] Data integrity verified
- [ ] Supplier tracking preserved
- [ ] Consolidated view functional
- [ ] No data loss

---

## Section 5: API Integration (3 Tests)

### TEST-1701: API - Export Inventory as JSON
**Workflow**: API Integration  
**Priority**: 🟡 MEDIUM  
**Time**: 10 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] API endpoint available: `/api/inventory`
- [ ] 50 units in inventory

**Test Steps**
1. Call API: GET /api/inventory
2. Check response status: 200 OK
3. Verify response format: JSON array of units
4. Verify all 50 units in response
5. Spot-check 3 units: fields present (model, grade, imei, etc.)
6. Verify pagination if applicable (e.g., 20 per page)

**Expected Results**
- ✅ API returns 200 OK
- ✅ Response is valid JSON
- ✅ All 50 units included (or pagination working)
- ✅ All required fields present
- ✅ Data matches database

**Pass Criteria**
- [ ] API returns 200 OK
- [ ] Valid JSON response
- [ ] All 50 units returned
- [ ] All fields present
- [ ] Data accurate

---

### TEST-1702: API - Create Unit via API
**Workflow**: API Integration  
**Priority**: 🟡 MEDIUM  
**Time**: 12 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] API endpoint available: POST /api/units
- [ ] API authentication configured

**Test Steps**
1. Call API: POST /api/units
2. Send payload:
   ```json
   {
     "model": "iPhone 14",
     "grade": "Excellent",
     "storage": "256GB",
     "bp": 220,
     "imei": "352012345678901"
   }
   ```
3. Check response status: 201 Created
4. Verify unit created with assigned ID
5. Verify in database: unit present with all fields
6. Verify in dashboard: new unit visible

**Expected Results**
- ✅ API returns 201 Created
- ✅ Unit created with ID assigned
- ✅ All fields saved correctly
- ✅ Unit visible in dashboard
- ✅ Database matches payload

**Pass Criteria**
- [ ] API returns 201 Created
- [ ] Unit created with ID
- [ ] All fields saved
- [ ] Visible in dashboard
- [ ] Data accurate

---

### TEST-1703: API - Record Sale via API
**Workflow**: API Integration  
**Priority**: 🟡 MEDIUM  
**Time**: 12 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] API endpoint available: POST /api/units/{id}/sell
- [ ] Unit with ID ready for sale
- [ ] API authentication configured

**Test Steps**
1. Call API: POST /api/units/{unitId}/sell
2. Send payload:
   ```json
   {
     "salePrice": 400,
     "platform": "eBay",
     "orderId": "ORD-12345",
     "postage": 8
   }
   ```
3. Check response status: 200 OK
4. Verify unit status changed to "sold"
5. Verify sale data saved (price, platform, etc.)
6. Verify in Sold History: sale visible

**Expected Results**
- ✅ API returns 200 OK
- ✅ Unit status: sold
- ✅ Sale data saved correctly
- ✅ Sale visible in Sold History
- ✅ Dashboard updated

**Pass Criteria**
- [ ] API returns 200 OK
- [ ] Unit status: sold
- [ ] Sale data saved
- [ ] Visible in Sold History
- [ ] Dashboard reflects change

---

## Section 6: Advanced Features (2 Tests)

### TEST-1801: Advanced - Bulk Operations with Templates
**Workflow**: Advanced Features  
**Priority**: 🟡 MEDIUM  
**Time**: 15 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] 50 available units
- [ ] Bulk operations feature available

**Test Steps**
1. Select 10 units (checkbox select all)
2. Click "Bulk Actions" → "Apply Template"
3. Select template: "Mark as Premium"
4. Confirm bulk action
5. Verify all 10 units updated
6. Check dashboard: status reflected

**Expected Results**
- ✅ Bulk select works (select 10)
- ✅ Template applied to all 10
- ✅ No individual confirmation needed
- ✅ Saves time vs. individual edits
- ✅ Audit log tracks bulk operation

**Pass Criteria**
- [ ] Bulk select works
- [ ] Template applies to all 10
- [ ] Efficient operation
- [ ] All units updated
- [ ] Tracked in audit log

---

### TEST-1802: Advanced - Batch Forecasting & Recommendations
**Workflow**: Advanced Features  
**Priority**: 🟡 MEDIUM  
**Time**: 20 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] 300+ units with 6 months sales history
- [ ] Analytics/forecasting feature available

**Test Steps**
1. Navigate to Analytics → Forecasting
2. View predicted demand for next 30 days
3. View recommended actions (e.g., "5 iPhones expected to sell this month")
4. Compare with historical data
5. Verify recommendations align with trends

**Expected Results**
- ✅ Forecasting model presents predictions
- ✅ Confidence level shown for predictions
- ✅ Recommendations match historical trends
- ✅ Actionable insights provided
- ✅ Helps with inventory planning

**Pass Criteria**
- [ ] Forecasting functional
- [ ] Recommendations generated
- [ ] Align with historical data
- [ ] Helpful for planning
- [ ] Confidence levels shown

---

## Section 7: Accessibility & Localization (2 Tests - Optional)

### TEST-1901: Accessibility - Keyboard Navigation
**Workflow**: Accessibility  
**Priority**: 🟢 LOW  
**Time**: 10 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] App open in browser
- [ ] Keyboard available (no mouse)

**Test Steps**
1. Tab through dashboard elements
2. Verify all buttons/links reachable
3. Press Enter on focused button → should activate
4. Tab through form fields in New Unit form
5. Verify all fields tab-able
6. Press Tab → Shift+Tab to navigate backward

**Expected Results**
- ✅ All UI elements keyboard accessible
- ✅ Logical tab order (left-to-right, top-to-bottom)
- ✅ Focus indicator visible
- ✅ Enter key activates buttons
- ✅ No keyboard traps

**Pass Criteria**
- [ ] Keyboard navigation works
- [ ] Tab order logical
- [ ] Focus visible
- [ ] All functions accessible
- [ ] No traps

---

### TEST-1902: Localization - Multiple Languages
**Workflow**: Localization  
**Priority**: 🟢 LOW  
**Time**: 15 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] Multi-language support implemented
- [ ] English, Spanish, French available

**Test Steps**
1. Change language to Spanish
2. Verify UI text translated (buttons, labels)
3. Verify numbers formatted per locale (comma vs. period)
4. Verify currency symbol correct for locale
5. Change to French
6. Verify French translation complete

**Expected Results**
- ✅ UI translates completely
- ✅ No untranslated strings ("MISSING_TRANSLATION")
- ✅ Date/number formatting per locale
- ✅ Currency symbols correct
- ✅ Right-to-left support (if applicable)

**Pass Criteria**
- [ ] Spanish translation complete
- [ ] French translation complete
- [ ] Formatting per locale
- [ ] No untranslated strings
- [ ] Professional appearance

---

## Phase 3 Summary

| Category | Tests | Time Est. | Status |
|----------|-------|-----------|--------|
| Warranty | 5 | 0.75 hrs | ⬜ |
| Permissions | 4 | 0.75 hrs | ⬜ |
| Performance | 7 | 1.5 hrs | ⬜ |
| Migration | 3 | 1 hr | ⬜ |
| API Integration | 3 | 0.5 hrs | ⬜ |
| Advanced Features | 2 | 0.5 hrs | ⬜ |
| Accessibility/Localization | 2 | 0.5 hrs | ⬜ |
| **TOTAL** | **22** | **4.5 hrs** | **⬜** |

---

**Phase 3 Status**: Ready for QA Execution  
**Last Updated**: 2026-05-07

---

## Implementation Priority

### Must Have (MVP)
- Warranty Management (TEST-1301 to 1303)
- Permissions & Access (TEST-1401 to 1403)
- Performance (TEST-1501 to 1503)

### Should Have (V1.1)
- Audit Log (TEST-1404)
- Migration Features (TEST-1601 to 1603)

### Nice to Have (V1.2+)
- Advanced Features (TEST-1801, 1802)
- API Integration (TEST-1701 to 1703)
- Accessibility/Localization (TEST-1901, 1902)
