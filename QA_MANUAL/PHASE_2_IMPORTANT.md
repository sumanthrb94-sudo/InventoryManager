# InventoryManager - Phase 2: Important Tests
**Search & Filtering, Batch Operations, Concurrent Operations, Dashboard, Notifications, Reporting**

---

## Phase 2 Overview

**Target Tests**: 50 important test cases  
**Priority**: 🟡 MEDIUM-HIGH - Core feature coverage  
**Time Estimate**: 10 hours  
**Risk Level**: HIGH  
**Status**: Not Started

---

## Section 1: Search & Filtering (8 Tests)

### TEST-501: Search by IMEI - Exact Match
**Workflow**: Search & Filtering  
**Priority**: 🟡 MEDIUM  
**Time**: 10 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] Unit with IMEI="352012345678901" exists
- [ ] Search bar available on dashboard

**Test Steps**
1. Click search bar
2. Enter full IMEI: "352012345678901"
3. Press Enter or click Search
4. Verify results show only matching unit

**Expected Results**
- ✅ Search returns exact match
- ✅ Only 1 unit displayed
- ✅ IMEI field highlighted in search results

**Verification Points**
□ Exact match search works  
□ No partial matches returned  
□ Single result  

**Pass Criteria**
- [ ] Correct unit found
- [ ] No false positives
- [ ] Exact match enforced

---

### TEST-502: Search by Model - Partial Match
**Workflow**: Search & Filtering  
**Priority**: 🟡 MEDIUM  
**Time**: 10 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] 5 units in inventory:
  - iPhone 14 Pro
  - iPhone 14
  - iPhone 13
  - Samsung Galaxy S23
  - Google Pixel 7

**Test Steps**
1. Search for "iPhone"
2. Verify all iPhone models returned
3. Verify Samsung and Pixel not returned

**Expected Results**
- ✅ All 3 iPhone units returned
- ✅ 0 Samsung/Pixel units returned
- ✅ Case-insensitive search (works with "iphone" or "iPhone")

**Pass Criteria**
- [ ] All iPhone results returned
- [ ] 3 units found
- [ ] Partial match works
- [ ] Case-insensitive

---

### TEST-503: Search by Grade - Filter Works
**Workflow**: Search & Filtering  
**Priority**: 🟡 MEDIUM  
**Time**: 8 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] Units with different grades:
  - 3 units: grade=Excellent
  - 2 units: grade=Good
  - 1 unit: grade=Fair

**Test Steps**
1. Use Grade filter dropdown
2. Select "Excellent"
3. Verify 3 units returned
4. Select "Good"
5. Verify 2 units returned

**Expected Results**
- ✅ Grade filter works correctly
- ✅ Excellent shows 3 units
- ✅ Good shows 2 units
- ✅ Fair shows 1 unit

**Pass Criteria**
- [ ] Filter by grade works
- [ ] Correct count returned
- [ ] No cross-filter contamination

---

### TEST-504: Search by Status - Available vs Sold
**Workflow**: Search & Filtering  
**Priority**: 🟡 MEDIUM  
**Time**: 8 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] 10 units total:
  - 6 available
  - 4 sold

**Test Steps**
1. Filter by status=Available
2. Verify 6 units shown
3. Filter by status=Sold
4. Verify 4 units shown

**Expected Results**
- ✅ Available filter shows 6 units
- ✅ Sold filter shows 4 units
- ✅ No overlap between filters

**Pass Criteria**
- [ ] Status filter works
- [ ] Correct counts
- [ ] Clean separation

---

### TEST-505: Combined Filter - IMEI + Grade + Status
**Workflow**: Search & Filtering  
**Priority**: 🟡 MEDIUM  
**Time**: 12 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] 15 units with varied attributes

**Test Steps**
1. Filter: Grade=Excellent AND Status=Available
2. Count results
3. Apply: IMEI contains "14"
4. Count results
5. Verify all filters applied together

**Expected Results**
- ✅ Multiple filters applied simultaneously
- ✅ Results narrow with each filter
- ✅ No data loss

**Pass Criteria**
- [ ] Multiple filters work together
- [ ] Results progressively narrow
- [ ] All conditions respected

---

### TEST-506: Search with No Results
**Workflow**: Search & Filtering  
**Priority**: 🟢 LOW  
**Time**: 8 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] Search bar available

**Test Steps**
1. Search for "NonExistentIMEI123456"
2. Verify no results message shown
3. Verify "Clear Search" or similar option available

**Expected Results**
- ✅ Clear message: "No units found"
- ✅ Option to clear search
- ✅ Can return to full list

**Pass Criteria**
- [ ] No results message clear
- [ ] Can clear search
- [ ] Full list accessible

---

### TEST-507: Search Results Sorting - By Date
**Workflow**: Search & Filtering  
**Priority**: 🟡 MEDIUM  
**Time**: 10 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] 5 units matching search criteria with different dates

**Test Steps**
1. Perform search returning 5 units
2. Verify default sort order
3. Click "Sort by Date" if available
4. Verify oldest first (or newest first if configured)
5. Click sort again to reverse order

**Expected Results**
- ✅ Results sortable by date
- ✅ Ascending/descending toggle works
- ✅ Order visibly changes

**Pass Criteria**
- [ ] Sort by date works
- [ ] Order changes on toggle
- [ ] Consistent with configuration

---

### TEST-508: Search Result Pagination
**Workflow**: Search & Filtering  
**Priority**: 🟡 MEDIUM  
**Time**: 10 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] 50+ units in inventory (to test pagination)

**Test Steps**
1. Perform search returning 50+ results
2. Check if pagination shown (Page 1 of X)
3. Click "Next" button
4. Verify new page of results loaded
5. Click "Previous" to go back
6. Verify original results returned

**Expected Results**
- ✅ Pagination works for large result sets
- ✅ Page navigation works
- ✅ Correct results on each page
- ✅ No duplicate results across pages

**Pass Criteria**
- [ ] Pagination implemented for 50+ results
- [ ] Page navigation works
- [ ] Correct data per page
- [ ] No duplicates

---

## Section 2: Batch Operations (8 Tests)

### TEST-601: Batch Import - Large File (500 units)
**Workflow**: Batch Operations  
**Priority**: 🟡 MEDIUM  
**Time**: 15 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] CSV file with 500 units prepared
- [ ] On Batch Import page
- [ ] Browser console open to monitor for errors

**Test Steps**
1. Select large CSV file (500 units)
2. Click Preview
3. Observe import preview loads
4. Check console for errors (should be none)
5. Click Import
6. Monitor import progress
7. Verify completion message
8. Navigate to dashboard
9. Verify total unit count increased by 500

**Expected Results**
- ✅ Large file loads without crashing
- ✅ Preview handles 500 records
- ✅ Import completes successfully
- ✅ All 500 units added to inventory
- ✅ No console errors

**Verification Points**
□ Large file handling  
□ Performance acceptable (< 30s import)  
□ No memory issues  
□ All units imported  

**Pass Criteria**
- [ ] All 500 units imported
- [ ] No errors or crashes
- [ ] Import time reasonable
- [ ] Count verified

---

### TEST-602: Batch - Edit Multiple Units
**Workflow**: Batch Operations  
**Priority**: 🟡 MEDIUM  
**Time**: 15 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] Batch with 5 units
- [ ] On batch detail page

**Test Steps**
1. Select first 3 units (checkbox)
2. Click "Bulk Edit" if available
3. Change Grade field to "Excellent"
4. Apply changes
5. Verify all 3 units updated

**Expected Results**
- ✅ Bulk edit option available
- ✅ Multiple selection works
- ✅ Grade updated for all selected
- ✅ Unselected units unchanged

**Verification Points**
□ Bulk edit functionality  
□ Multiple selection  
□ Targeted updates  
□ No unintended changes  

**Pass Criteria**
- [ ] 3 units selected
- [ ] Grade changed to Excellent
- [ ] All 3 updated
- [ ] Other units unchanged

---

### TEST-603: Batch - Delete Multiple Units
**Workflow**: Batch Operations  
**Priority**: 🟡 MEDIUM  
**Time**: 12 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] Batch with 5 units, all available (not sold)
- [ ] On batch detail page

**Test Steps**
1. Select 2 units to delete
2. Click "Delete Selected"
3. Confirm delete in modal
4. Verify units removed from batch
5. Verify batch count now 3
6. Navigate away and back to confirm persistence

**Expected Results**
- ✅ Delete confirmation modal shown
- ✅ Selected units removed
- ✅ Batch count decremented
- ✅ Change persists after reload

**Verification Points**
□ Delete confirmation required  
□ Units removed from DB  
□ Count updated  
□ Persistence verified  

**Pass Criteria**
- [ ] 2 units deleted
- [ ] Batch count now 3
- [ ] Deletion confirmed
- [ ] Change persists

---

### TEST-604: Batch Export to CSV
**Workflow**: Batch Operations  
**Priority**: 🟡 MEDIUM  
**Time**: 12 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] Batch with 5 units
- [ ] Export feature available

**Test Steps**
1. Navigate to batch detail
2. Click "Export to CSV"
3. Download CSV file
4. Open CSV in spreadsheet app
5. Verify all columns present: Model, Grade, Storage, BP, IMEI, Status
6. Count rows (should be 5 + header)
7. Spot-check data accuracy

**Expected Results**
- ✅ CSV downloaded successfully
- ✅ All required columns present
- ✅ 5 data rows + 1 header
- ✅ Data accurate and untruncated

**Verification Points**
□ Export functionality works  
□ CSV format correct  
□ All columns included  
□ Data accuracy verified  

**Pass Criteria**
- [ ] CSV file downloaded
- [ ] All 5 units in file
- [ ] All columns present
- [ ] Data accurate

---

### TEST-605: Batch Import - Resume Failed Import
**Workflow**: Batch Operations  
**Priority**: 🟠 ORANGE  
**Time**: 15 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] CSV with 10 units: first 5 valid, row 6 has duplicate IMEI
- [ ] On Batch Import page
- [ ] Network simulator or prepared error state

**Test Steps**
1. Start batch import with error-containing CSV
2. Preview shows error on row 6
3. Option to "Skip Error Rows" or "Fix and Retry"
4. If Skip: Import first 5, skip row 6 and beyond
5. If Fix: Edit row 6, continue import
6. Verify final count matches expected

**Expected Results**
- ✅ Error detected before import
- ✅ Option to continue/skip/fix provided
- ✅ If skipped: 5 units imported, 5 skipped
- ✅ User informed of results

**Verification Points**
□ Error detection before import  
□ User choice on handling errors  
□ Partial import if requested  
□ Results clearly communicated  

**Pass Criteria**
- [ ] Error detected
- [ ] Option provided to user
- [ ] Partial import successful
- [ ] Count verified

---

### TEST-606: Batch Filtering - By Date Range
**Workflow**: Batch Operations  
**Priority**: 🟡 MEDIUM  
**Time**: 10 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] Batches imported on different dates:
  - Batch A: 2026-04-01
  - Batch B: 2026-04-15
  - Batch C: 2026-05-01
  - Batch D: 2026-05-07

**Test Steps**
1. Filter by date range: 2026-04-01 to 2026-04-30
2. Verify Batch A and B shown
3. Verify Batch C and D not shown
4. Change filter: 2026-05-01 to 2026-05-07
5. Verify Batch C and D shown

**Expected Results**
- ✅ Date range filter works
- ✅ Correct batches displayed
- ✅ Exclusion of out-of-range batches accurate

**Pass Criteria**
- [ ] Date filter works
- [ ] Correct batches shown
- [ ] Range exclusion accurate

---

### TEST-607: Batch - Merge Multiple Batches
**Workflow**: Batch Operations  
**Priority**: 🟡 MEDIUM  
**Time**: 15 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] Two separate batches:
  - Batch A: 3 units
  - Batch B: 3 units
- [ ] Merge feature available

**Test Steps**
1. Open Batch A
2. Click "Merge with Batch"
3. Select Batch B to merge
4. Confirm merge
5. Verify new merged batch shows 6 units
6. Verify original batches no longer exist (or marked as merged)

**Expected Results**
- ✅ Merge operation completes
- ✅ Final batch has 6 units
- ✅ No duplicate units
- ✅ All data preserved

**Pass Criteria**
- [ ] Batches merged
- [ ] Total units: 6
- [ ] No data loss
- [ ] Merge confirmed

---

## Section 3: Concurrent Operations (6 Tests)

### TEST-701: Concurrent Sales - Same Unit from Two Tabs
**Workflow**: Concurrent Operations  
**Priority**: 🔴 HIGH  
**Time**: 15 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] Unit with status=available
- [ ] Two browser tabs/windows open with app

**Test Steps**
1. Tab 1: Open sell form for unit
2. Tab 2: Simultaneously open sell form for SAME unit
3. Tab 1: Complete sale form and submit
4. Tab 2: Attempt to submit sale (unit now sold)
5. Observe error handling

**Expected Results**
- ✅ Tab 1 sale succeeds
- ✅ Tab 2 shows error: "Unit already sold"
- ✅ Unit appears as sold in both tabs after reload
- ✅ No duplicate sales created

**Verification Points**
□ Concurrency handled gracefully  
□ Second attempt prevented  
□ No duplicate sales  
□ Error message clear  

**Pass Criteria**
- [ ] First sale succeeds
- [ ] Second attempt blocked
- [ ] No duplicate sales
- [ ] Error shown to user

---

### TEST-702: Concurrent Batch Import - Multiple Users
**Workflow**: Concurrent Operations  
**Priority**: 🟡 MEDIUM  
**Time**: 15 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] User A and User B logged in (separate sessions)
- [ ] User A: Importing Batch X (5 units)
- [ ] User B: Importing Batch Y (5 units)

**Test Steps**
1. User A: Start import of Batch X
2. User B: Start import of Batch Y (before A completes)
3. Both complete imports
4. Check dashboard: Total should be +10 units
5. Verify no data corruption
6. Verify Unit IDs don't overlap

**Expected Results**
- ✅ Both imports complete successfully
- ✅ Total +10 units in inventory
- ✅ No data loss or corruption
- ✅ Unit IDs unique across both batches

**Verification Points**
□ Concurrent imports don't conflict  
□ Total count correct  
□ No duplicate IDs  
□ Data integrity maintained  

**Pass Criteria**
- [ ] Both imports complete
- [ ] Total units: +10
- [ ] No data corruption
- [ ] IDs unique

---

### TEST-703: Concurrent Return Operations
**Workflow**: Concurrent Operations  
**Priority**: 🟡 MEDIUM  
**Time**: 15 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] Two sold units
- [ ] Two browser tabs/windows with app
- [ ] Both units ready for return

**Test Steps**
1. Tab 1: Open return form for Unit A
2. Tab 2: Open return form for Unit B
3. Tab 1: Select "Return to Inventory" and submit
4. Tab 2: Select "Return to Supplier" and submit
5. Verify both returns processed
6. Check counts: Available should increment, Sold should decrement

**Expected Results**
- ✅ Both returns complete successfully
- ✅ Unit A: status=available
- ✅ Unit B: status=returned
- ✅ Available count incremented by 1
- ✅ Sold count decremented by 2

**Verification Points**
□ Concurrent returns don't conflict  
□ Different return types handled  
□ Counts updated correctly  
□ No data loss  

**Pass Criteria**
- [ ] Both returns complete
- [ ] Correct statuses assigned
- [ ] Counts accurate
- [ ] No conflicts

---

### TEST-704: Concurrent Edit and Delete
**Workflow**: Concurrent Operations  
**Priority**: 🟡 MEDIUM  
**Time**: 15 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] Two units in inventory
- [ ] Two browser tabs open

**Test Steps**
1. Tab 1: Open Unit A for editing
2. Tab 2: Delete Unit A
3. Tab 1: Attempt to save changes to Unit A
4. Observe error or conflict resolution

**Expected Results**
- ✅ Error message: "Unit no longer exists" or "Unit was deleted"
- ✅ Tab 1 prevented from saving to deleted unit
- ✅ Unit A fully removed from inventory
- ✅ No orphaned data

**Pass Criteria**
- [ ] Delete takes precedence
- [ ] Edit prevented on deleted unit
- [ ] Error message clear
- [ ] No data corruption

---

### TEST-705: Concurrent Dashboard Refresh
**Workflow**: Concurrent Operations  
**Priority**: 🟡 MEDIUM  
**Time**: 12 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] Dashboard open in Tab 1
- [ ] Sell Unit page open in Tab 2
- [ ] Unit available for sale

**Test Steps**
1. Tab 1: Auto-refresh dashboard every 30 seconds (or manual refresh)
2. Tab 2: Record sale at time T
3. Tab 1: At time T+5 sec, manual refresh dashboard
4. Verify immediate update of counts and Sold History
5. At time T+30 sec, verify auto-refresh (if configured) catches the sale

**Expected Results**
- ✅ Manual refresh shows sale immediately
- ✅ Available count decremented
- ✅ Sold History updated with new sale
- ✅ Auto-refresh (if enabled) also catches update

**Pass Criteria**
- [ ] Manual refresh updates immediately
- [ ] Counts accurate
- [ ] Sold History includes new sale
- [ ] Auto-refresh works if enabled

---

### TEST-706: Concurrent Admin Actions - Permissions
**Workflow**: Concurrent Operations  
**Priority**: 🟡 MEDIUM  
**Time**: 15 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] Admin user and Regular user logged in (separate sessions)
- [ ] Admin has delete permissions
- [ ] Regular user has read-only access

**Test Steps**
1. Admin user: Delete a unit
2. Regular user: Simultaneously try to access deleted unit
3. Verify regular user sees error: "Unit not found"
4. Admin user: Create new unit
5. Regular user: Check if new unit appears (verify permissions)

**Expected Results**
- ✅ Admin delete succeeds
- ✅ Regular user gets "not found" error
- ✅ Permissions enforced
- ✅ New units visible to authorized users

**Pass Criteria**
- [ ] Delete succeeds for admin
- [ ] Regular user blocked from deleted unit
- [ ] Permissions working
- [ ] Error messages appropriate

---

## Section 4: Dashboard Accuracy & Display (9 Tests)

### TEST-801: Dashboard - Total Units Count
**Workflow**: Dashboard  
**Priority**: 🔴 HIGH  
**Time**: 10 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] 15 total units:
  - 8 available
  - 6 sold
  - 1 returned

**Test Steps**
1. Navigate to dashboard
2. Check "Total Units" display
3. Verify shows 15
4. Add 1 new unit
5. Verify total updates to 16

**Expected Results**
- ✅ Total Units shows 15 initially
- ✅ Updates to 16 after adding unit
- ✅ Count includes all statuses (available, sold, returned)

**Pass Criteria**
- [ ] Initial count: 15
- [ ] Updated count: 16
- [ ] Includes all statuses

---

### TEST-802: Dashboard - Available vs Sold Breakdown
**Workflow**: Dashboard  
**Priority**: 🔴 HIGH  
**Time**: 10 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] 15 units: 8 available, 6 sold, 1 returned

**Test Steps**
1. Check dashboard Available count
2. Verify shows 8
3. Check Sold count
4. Verify shows 6
5. Verify sum: 8 + 6 + 1 = 15

**Expected Results**
- ✅ Available: 8
- ✅ Sold: 6
- ✅ Returned: 1 (if tracked separately)
- ✅ Total: 15

**Pass Criteria**
- [ ] Available count: 8
- [ ] Sold count: 6
- [ ] Totals correct

---

### TEST-803: Dashboard - Revenue Total Calculation
**Workflow**: Dashboard  
**Priority**: 🔴 HIGH  
**Time**: 10 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] 6 sold units with prices:
  - £450, £300, £250, £400, £200, £150

**Test Steps**
1. Check dashboard Revenue total
2. Verify equals sum: £450+£300+£250+£400+£200+£150 = £1750
3. Sell new unit at £100
4. Verify revenue updates to £1850

**Expected Results**
- ✅ Revenue: £1750 (initial)
- ✅ Revenue: £1850 (after new sale)
- ✅ Calculation accurate to £0.01

**Pass Criteria**
- [ ] Revenue: £1750
- [ ] Updated to £1850
- [ ] Calculation accurate

---

### TEST-804: Dashboard - Profit Summary (Green)
**Workflow**: Dashboard  
**Priority**: 🟡 MEDIUM  
**Time**: 12 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] 5 profitable sales:
  - Sale 1: Profit £100 (green)
  - Sale 2: Profit £150 (green)
  - Sale 3: Profit £80 (green)
  - Sale 4: Profit £200 (green)
  - Sale 5: Profit £120 (green)

**Test Steps**
1. Check dashboard profit display
2. Verify total: £100+£150+£80+£200+£120 = £650
3. Verify color is green (profit)
4. Click on profit to expand/detail view if available

**Expected Results**
- ✅ Total profit: £650
- ✅ Color: GREEN
- ✅ Details accessible

**Pass Criteria**
- [ ] Profit total: £650
- [ ] Color: Green
- [ ] Display accurate

---

### TEST-805: Dashboard - Loss Summary (Red)
**Workflow**: Dashboard  
**Priority**: 🟡 MEDIUM  
**Time**: 12 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] 3 loss-making sales:
  - Sale 1: Loss -£50 (red)
  - Sale 2: Loss -£80 (red)
  - Sale 3: Loss -£30 (red)

**Test Steps**
1. Check dashboard loss display
2. Verify total: -£50-£80-£30 = -£160
3. Verify color is red (loss)
4. Check if negative symbol displayed

**Expected Results**
- ✅ Total loss: -£160 (or -£160.00)
- ✅ Color: RED
- ✅ Negative indicator present

**Pass Criteria**
- [ ] Loss total: -£160
- [ ] Color: Red
- [ ] Negative indicator shown

---

### TEST-806: Dashboard - Net Profit Calculation
**Workflow**: Dashboard  
**Priority**: 🟡 MEDIUM  
**Time**: 12 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] Sales data:
  - Total Profit (green): £650
  - Total Loss (red): -£160
  - Net should be: £650 - £160 = £490

**Test Steps**
1. Check dashboard Net Profit
2. Verify shows £490
3. Verify color (green, as positive)
4. Verify breakdown available (profit - loss)

**Expected Results**
- ✅ Net Profit: £490
- ✅ Color: GREEN (positive)
- ✅ Breakdown available

**Pass Criteria**
- [ ] Net profit: £490
- [ ] Color: Green
- [ ] Calculation accurate

---

### TEST-807: Dashboard - Average Sell Price
**Workflow**: Dashboard  
**Priority**: 🟡 MEDIUM  
**Time**: 10 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] 6 sold units:
  - Prices: £450, £300, £250, £400, £200, £150
  - Total: £1750
  - Average: £1750 / 6 = £291.67

**Test Steps**
1. Check dashboard Average Sell Price
2. Verify shows ~£291.67
3. Verify accurate to 2 decimals

**Expected Results**
- ✅ Average: £291.67
- ✅ Rounded to 2 decimals
- ✅ Calculation accurate

**Pass Criteria**
- [ ] Average: £291.67
- [ ] Decimal places: 2
- [ ] Formula correct

---

### TEST-808: Dashboard - Oldest Available Units Display
**Workflow**: Dashboard  
**Priority**: 🟡 MEDIUM  
**Time**: 10 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] Available units with dates:
  - Unit A: Date In=2026-04-01
  - Unit B: Date In=2026-04-15
  - Unit C: Date In=2026-05-01
  - Unit D: Date In=2026-05-05

**Test Steps**
1. Check dashboard "Oldest Available" section
2. Verify Unit A appears first (oldest)
3. Verify Unit D appears last (newest)
4. Verify sort order ascending (oldest first)

**Expected Results**
- ✅ Unit A first
- ✅ Unit D last
- ✅ Proper ascending sort

**Pass Criteria**
- [ ] Unit A first
- [ ] Unit D last
- [ ] Sort order correct

---

### TEST-809: Dashboard - Latest Sold History Display
**Workflow**: Dashboard  
**Priority**: 🔴 HIGH  
**Time**: 10 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] Sold units with dates:
  - Sale A: Date=2026-04-01
  - Sale B: Date=2026-04-20
  - Sale C: Date=2026-05-05
  - Sale D: Date=2026-05-07

**Test Steps**
1. Check Sold History in dashboard
2. Verify Sale D appears FIRST (most recent)
3. Verify Sale A appears LAST (oldest)
4. Verify reverse chronological sort (newest first)

**Expected Results**
- ✅ Sale D first (2026-05-07)
- ✅ Sale A last (2026-04-01)
- ✅ Descending date sort (latest first)

**Pass Criteria**
- [ ] Sale D first
- [ ] Sale A last
- [ ] Reverse chrono sort correct

---

## Section 5: Notifications System (7 Tests)

### TEST-901: Notification - Unit Sold (Profit)
**Workflow**: Notifications  
**Priority**: 🟡 MEDIUM  
**Time**: 10 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] Unit ready to sell (profitable)
- [ ] Notifications enabled
- [ ] On Sell Unit form

**Test Steps**
1. Record sale: Price=£350, Platform=eBay, Postage=£8
2. Calculate profit: £350 - BP - fees - £8 = profit (e.g., £100)
3. Submit sale
4. Listen for notification
5. Check notification message

**Expected Results**
- ✅ Notification appears (visual/audio)
- ✅ Message: "Unit sold! Profit: £100"
- ✅ Notification auto-dismisses after 5 seconds (or click to dismiss)
- ✅ Notification icon/color indicates success (green)

**Verification Points**
□ Notification triggers on sale  
□ Profit amount accurate  
□ Auto-dismiss works  
□ Visual/audio present  

**Pass Criteria**
- [ ] Notification shown
- [ ] Profit amount correct
- [ ] Auto-dismiss works
- [ ] Clear and informative

---

### TEST-902: Notification - Unit Sold (Loss)
**Workflow**: Notifications  
**Priority**: 🟡 MEDIUM  
**Time**: 10 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] Unit with BP=£200 ready to sell
- [ ] Ready to record loss

**Test Steps**
1. Record sale: Price=£150, Platform=Amazon, Postage=£5
2. Calculate loss: £150 - £200 (BP) - fees - £5 = loss (e.g., -£60)
3. Submit sale
4. Check notification

**Expected Results**
- ✅ Notification appears
- ✅ Message: "Unit sold! Loss: -£60"
- ✅ Notification icon/color indicates warning (orange/red)
- ✅ Loss amount accurate

**Verification Points**
□ Loss notification triggers  
□ Loss amount accurate  
□ Color indicates loss  
□ Clear messaging  

**Pass Criteria**
- [ ] Notification shown
- [ ] Loss amount correct
- [ ] Color indicates warning
- [ ] User aware of loss

---

### TEST-903: Notification - New Stock Received
**Workflow**: Notifications  
**Priority**: 🟡 MEDIUM  
**Time**: 10 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] Batch import ready
- [ ] 5 units to import
- [ ] Notifications enabled

**Test Steps**
1. Import batch with 5 units
2. Wait for import to complete
3. Check for "New Stock" notification
4. Verify notification shows count: "5 units added to inventory"

**Expected Results**
- ✅ Notification appears after import
- ✅ Message: "5 new units added"
- ✅ Count accurate
- ✅ Notification color (blue or green)

**Pass Criteria**
- [ ] Notification shown
- [ ] Count correct: 5 units
- [ ] Auto-dismiss works
- [ ] Clear messaging

---

### TEST-904: Notification - Return Processed
**Workflow**: Notifications  
**Priority**: 🟡 MEDIUM  
**Time**: 10 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] Sold unit ready for return
- [ ] On return form

**Test Steps**
1. Process return: Select "Return to Inventory"
2. Confirm return
3. Check for notification
4. Verify notification: "Unit returned to inventory"

**Expected Results**
- ✅ Notification appears
- ✅ Message: "Unit returned to inventory"
- ✅ Color: Green
- ✅ Unit now available

**Pass Criteria**
- [ ] Notification shown
- [ ] Message correct
- [ ] Color appropriate
- [ ] Unit status updated

---

### TEST-905: Notification - SHS Received
**Workflow**: Notifications  
**Priority**: 🟡 MEDIUM  
**Time**: 10 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] SHS unit created with status=incoming
- [ ] Notifications enabled

**Test Steps**
1. Create SHS unit (status=incoming automatically)
2. Check for "SHS Received" notification
3. Verify notification: "SHS unit received from supplier"
4. Check notification includes IMEI field (empty until filled)

**Expected Results**
- ✅ Notification appears on SHS creation
- ✅ Message: "SHS unit received"
- ✅ Status shows as incoming
- ✅ Notification color (blue)

**Pass Criteria**
- [ ] Notification shown
- [ ] Message correct
- [ ] Status: incoming
- [ ] Clear messaging

---

### TEST-906: Notification - Batch Complete
**Workflow**: Notifications  
**Priority**: 🟡 MEDIUM  
**Time**: 10 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] Large batch import in progress

**Test Steps**
1. Start import of 100-unit batch
2. Wait for import to complete
3. Check for "Batch Complete" notification
4. Verify notification: "Import complete: 100 units"

**Expected Results**
- ✅ Notification shows on completion
- ✅ Message: "100 units imported successfully"
- ✅ All 100 units added to inventory
- ✅ Notification color (green)

**Pass Criteria**
- [ ] Notification shown
- [ ] Count accurate: 100 units
- [ ] All units in inventory
- [ ] Clear messaging

---

### TEST-907: Notification - Error Alert
**Workflow**: Notifications  
**Priority**: 🟡 MEDIUM  
**Time**: 10 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] Prepared scenario to trigger error (e.g., invalid data)

**Test Steps**
1. Attempt invalid action (e.g., sell with missing postage)
2. Form validation should prevent submission
3. Error notification should appear
4. Verify error message: "Postage is required"
5. Check notification color (red)

**Expected Results**
- ✅ Error notification appears
- ✅ Message specific: "Postage is required"
- ✅ Color: RED
- ✅ Error notification remains until dismissed

**Pass Criteria**
- [ ] Error notification shown
- [ ] Message specific
- [ ] Color: Red
- [ ] Doesn't auto-dismiss (user must acknowledge)

---

## Section 6: Reporting & Analytics (6 Tests)

### TEST-1001: Report - Sales Summary by Month
**Workflow**: Reporting  
**Priority**: 🟡 MEDIUM  
**Time**: 12 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] Sales across 3 months:
  - April: 5 units, £800 revenue
  - May (1-7): 8 units, £1200 revenue
- [ ] Report feature available

**Test Steps**
1. Navigate to Reports → Sales Summary
2. Select date range: April-May 2026
3. Filter: Group by Month
4. Verify April shows 5 units, £800
5. Verify May shows 8 units, £1200

**Expected Results**
- ✅ April summary: 5 units, £800
- ✅ May summary: 8 units, £1200
- ✅ Monthly totals accurate
- ✅ Visualization (chart or table) clear

**Pass Criteria**
- [ ] April data: 5 units, £800
- [ ] May data: 8 units, £1200
- [ ] Totals accurate
- [ ] Grouping correct

---

### TEST-1002: Report - Profit/Loss Analysis
**Workflow**: Reporting  
**Priority**: 🟡 MEDIUM  
**Time**: 12 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] 10 sold units:
  - 7 profitable (total profit: £700)
  - 3 loss-making (total loss: -£150)

**Test Steps**
1. Navigate to Reports → Profit/Loss
2. View summary: 7 profitable, 3 loss
3. Check totals: £700 profit, -£150 loss, £550 net
4. Verify visualization (pie chart or table)

**Expected Results**
- ✅ Profitable: 7 units, £700
- ✅ Loss: 3 units, -£150
- ✅ Net: £550
- ✅ Visualization clear

**Pass Criteria**
- [ ] Profit count: 7
- [ ] Loss count: 3
- [ ] Totals accurate
- [ ] Visualization helpful

---

### TEST-1003: Report - Inventory Aging
**Workflow**: Reporting  
**Priority**: 🟡 MEDIUM  
**Time**: 12 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] Available units aged:
  - <7 days: 3 units
  - 7-30 days: 4 units
  - 30+ days: 2 units

**Test Steps**
1. Navigate to Reports → Inventory Aging
2. View age buckets
3. Verify counts: 3, 4, 2 for respective age groups
4. Check which units are oldest (identify slow-movers)

**Expected Results**
- ✅ <7 days: 3 units
- ✅ 7-30 days: 4 units
- ✅ 30+ days: 2 units (slow-movers)
- ✅ Identifies units sitting in inventory longest

**Pass Criteria**
- [ ] Age buckets accurate
- [ ] Counts correct
- [ ] Slow-movers identified
- [ ] Helpful for inventory decisions

---

### TEST-1004: Report - Top Performing Suppliers
**Workflow**: Reporting  
**Priority**: 🟡 MEDIUM  
**Time**: 12 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] Sales from suppliers:
  - Supplier A: 15 units, £2250 revenue, £600 profit
  - Supplier B: 8 units, £1200 revenue, £300 profit
  - Supplier C: 5 units, £750 revenue, £50 profit

**Test Steps**
1. Navigate to Reports → Supplier Performance
2. View rankings by units sold
3. Verify Supplier A ranks 1st (15 units)
4. View rankings by profit
5. Verify Supplier A ranks 1st (£600 profit)

**Expected Results**
- ✅ By units: A (15), B (8), C (5)
- ✅ By profit: A (£600), B (£300), C (£50)
- ✅ Rankings accurate
- ✅ Identifies best suppliers

**Pass Criteria**
- [ ] Rankings correct by units
- [ ] Rankings correct by profit
- [ ] Data accurate
- [ ] Actionable insights

---

### TEST-1005: Report - Platform Comparison
**Workflow**: Reporting  
**Priority**: 🟡 MEDIUM  
**Time**: 12 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] Sales across platforms:
  - eBay: 8 units, £1200 revenue, 12.8%+£0.30 fee, £400 profit
  - Amazon: 6 units, £900 revenue, 8% fee, £250 profit
  - OnBuy: 4 units, £600 revenue, 9% fee, £150 profit
  - Backmarket: 2 units, £300 revenue, 10% fee, £80 profit

**Test Steps**
1. Navigate to Reports → Platform Performance
2. Compare units sold per platform
3. Compare fee percentages
4. Compare profit by platform
5. Identify best performing platform

**Expected Results**
- ✅ eBay: 8 units, highest profit (£400)
- ✅ Amazon: 6 units, lower fees (8%)
- ✅ OnBuy: 4 units, mid-range fees (9%)
- ✅ Backmarket: 2 units, highest fee (10%)
- ✅ eBay identified as best performer

**Pass Criteria**
- [ ] Units per platform accurate
- [ ] Fees correct
- [ ] Profit rankings correct
- [ ] Platform comparison helpful

---

### TEST-1006: Report - Export to PDF/CSV
**Workflow**: Reporting  
**Priority**: 🟡 MEDIUM  
**Time**: 12 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] Report page open
- [ ] Export options available

**Test Steps**
1. Generate Sales Summary report
2. Click "Export to CSV"
3. Verify CSV downloads
4. Open CSV in spreadsheet app
5. Verify data intact and readable
6. Return to report
7. Click "Export to PDF" if available
8. Verify PDF downloads and opens

**Expected Results**
- ✅ CSV exports successfully
- ✅ CSV data accurate and complete
- ✅ PDF exports successfully (if available)
- ✅ PDF formatted well and readable
- ✅ Charts/tables included in export

**Pass Criteria**
- [ ] CSV downloads and opens
- [ ] Data accurate in CSV
- [ ] PDF downloads (if available)
- [ ] Export quality acceptable

---

## Section 7: Advanced Filtering (6 Tests)

### TEST-1101: Advanced Filter - Multiple Criteria with AND Logic
**Workflow**: Search & Filtering  
**Priority**: 🟡 MEDIUM  
**Time**: 12 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] 20 units with varied attributes

**Test Steps**
1. Apply filters:
   - Grade = Excellent AND
   - Status = Available AND
   - Storage = 256GB
2. Count results
3. Manually verify all conditions met

**Expected Results**
- ✅ All three filters applied
- ✅ Only units matching ALL criteria shown
- ✅ No units with missing any condition

**Pass Criteria**
- [ ] All filters applied
- [ ] AND logic correct
- [ ] Only matching units shown

---

### TEST-1102: Advanced Filter - Save Filter Preset
**Workflow**: Search & Filtering  
**Priority**: 🟡 MEDIUM  
**Time**: 12 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] Multiple filters applied (Grade=Excellent, Status=Available, Storage=256GB)

**Test Steps**
1. Apply complex filter set
2. Click "Save Filter As..."
3. Name filter: "High-Value Available"
4. Confirm save
5. Clear filters
6. Click "Load Preset"
7. Select "High-Value Available"
8. Verify filters restore exactly

**Expected Results**
- ✅ Filter preset saved
- ✅ Filters clear completely
- ✅ Preset restores all filters
- ✅ No manual re-entry needed

**Pass Criteria**
- [ ] Preset saves
- [ ] Filters clear
- [ ] Preset restores correctly
- [ ] Exact match to original

---

### TEST-1103: Advanced Filter - Clear All Filters
**Workflow**: Search & Filtering  
**Priority**: 🟢 LOW  
**Time**: 8 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] Multiple filters applied

**Test Steps**
1. Apply 5+ filters
2. Click "Clear All Filters"
3. Verify all filters removed
4. Verify full inventory list displayed

**Expected Results**
- ✅ All filters cleared
- ✅ Full list displayed
- ✅ Single click to reset

**Pass Criteria**
- [ ] All filters cleared
- [ ] Full list shows
- [ ] One-click reset works

---

### TEST-1104: Filter - Exclude Sold Units
**Workflow**: Search & Filtering  
**Priority**: 🟡 MEDIUM  
**Time**: 8 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] 10 available, 5 sold units

**Test Steps**
1. Check "Show Available Only" option
2. Verify 10 units displayed
3. Verify 5 sold units hidden
4. Uncheck option
5. Verify all 15 units displayed

**Expected Results**
- ✅ Checkbox available
- ✅ Sold units excluded when checked
- ✅ All units shown when unchecked
- ✅ Quick toggle works

**Pass Criteria**
- [ ] Checkbox works
- [ ] Sold units excluded correctly
- [ ] Toggle functional

---

### TEST-1105: Filter - Search Within Results
**Workflow**: Search & Filtering  
**Priority**: 🟡 MEDIUM  
**Time**: 10 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] Filtered results showing (e.g., 50 units with Grade=Excellent)

**Test Steps**
1. Have 50 units filtered by Grade=Excellent
2. Use search box: "iPhone"
3. Verify results narrow to iPhones with Grade=Excellent
4. Enter different search: "Samsung"
5. Verify results change to Samsungs with Grade=Excellent

**Expected Results**
- ✅ Search works within filtered results
- ✅ Results progressively narrow
- ✅ Both criteria applied simultaneously
- ✅ Fast performance on narrowed set

**Pass Criteria**
- [ ] Search within filters works
- [ ] Results accurate
- [ ] Progressive narrowing correct
- [ ] Performance acceptable

---

### TEST-1106: Filter - Performance with Many Filters
**Workflow**: Search & Filtering  
**Priority**: 🟡 MEDIUM  
**Time**: 12 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] 1000+ units in inventory
- [ ] Multiple filters available

**Test Steps**
1. Apply 5 complex filters
2. Measure response time
3. Apply 10 filters
4. Measure response time
5. Verify no lag or timeout

**Expected Results**
- ✅ Response time < 2 seconds with 5 filters
- ✅ Response time < 3 seconds with 10 filters
- ✅ No UI freezing
- ✅ Results accurate even with many filters

**Pass Criteria**
- [ ] Fast performance (< 2-3s)
- [ ] Results accurate
- [ ] No UI lag
- [ ] Scales well

---

## Section 8: Integration Tests (6 Tests)

### TEST-1201: Full Workflow - Creation to Return
**Workflow**: Integration  
**Priority**: 🔴 HIGH  
**Time**: 20 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] Empty state or fresh database
- [ ] Ready to execute full workflow

**Test Steps**
1. **Create unit**: SHS unit, Model=iPhone 14, IMEI=empty, BP=£220
2. **Add IMEI**: Edit unit, add IMEI=352012345678901
3. **Sell unit**: Record sale, Price=£450, Platform=eBay, Postage=£8
4. **Verify sold**: Check Sold History, IMEI preserved
5. **Process return**: Return to inventory
6. **Verify available**: Unit back in Available Units, sale data cleared
7. **Sell again**: Sell at different price (£400)
8. **Verify final**: Dashboard shows 2 sales, correct financial data

**Expected Results**
- ✅ Unit created as SHS (incoming status)
- ✅ IMEI added and verified
- ✅ First sale recorded with profit
- ✅ IMEI preserved in sold record
- ✅ Return clears all sale data
- ✅ Unit resellable
- ✅ Second sale recorded
- ✅ Dashboard shows both sales with correct calculations

**Verification Points**
□ All workflow steps complete  
□ Data integrity maintained  
□ Financial calculations accurate  
□ IMEI handled correctly  
□ Status transitions correct  

**Pass Criteria**
- [ ] Complete workflow functional
- [ ] All data accurate
- [ ] Financial calculations correct
- [ ] Resale capability verified

---

### TEST-1202: Integration - Batch Import to Dashboard
**Workflow**: Integration  
**Priority**: 🟡 MEDIUM  
**Time**: 15 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] CSV with 20 units

**Test Steps**
1. Import batch
2. Verify 20 units in Available Units
3. Sell 8 units
4. Check dashboard: Available=12, Sold=8, Revenue=total sales
5. Return 2 units
6. Verify: Available=14, Sold=6
7. Batch totals should reflect changes

**Expected Results**
- ✅ Batch imported: 20 units
- ✅ Available: 20 initially
- ✅ After sales: Available=12, Sold=8
- ✅ After returns: Available=14, Sold=6
- ✅ Dashboard accurate throughout

**Pass Criteria**
- [ ] Batch imported
- [ ] Counts accurate at each step
- [ ] Sales and returns tracked
- [ ] Dashboard consistent

---

### TEST-1203: Integration - Barcode to Sale
**Workflow**: Integration  
**Priority**: 🟡 MEDIUM  
**Time**: 15 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] Barcode scan simulator

**Test Steps**
1. Scan barcode: "iPhone14Pro|Excellent|256GB|£220|352012345678901"
2. Verify auto-population
3. Create unit
4. Immediately sell unit
5. Check Sold History: All data present
6. Verify profit calculation

**Expected Results**
- ✅ Barcode parsed correctly
- ✅ Unit created with auto-populated fields
- ✅ Unit immediately sellable
- ✅ Sold History complete
- ✅ Financial data accurate

**Pass Criteria**
- [ ] Barcode parsing works
- [ ] Unit created quickly
- [ ] Sold immediately
- [ ] All data correct

---

### TEST-1204: Integration - Multiple Platforms Same Day
**Workflow**: Integration  
**Priority**: 🟡 MEDIUM  
**Time**: 15 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] 4 units available

**Test Steps**
1. Sell Unit 1: Platform=eBay, Price=£300
2. Sell Unit 2: Platform=Amazon, Price=£280
3. Sell Unit 3: Platform=OnBuy, Price=£320
4. Sell Unit 4: Platform=Backmarket, Price=£250
5. Verify all 4 in Sold History
6. Verify each has correct platform fee
7. Dashboard should show all 4 sales

**Expected Results**
- ✅ All 4 sales recorded
- ✅ Platform fees correct for each
- ✅ Profit calculations accurate per platform
- ✅ Dashboard shows all sales
- ✅ Revenue: £300+£280+£320+£250 = £1150

**Pass Criteria**
- [ ] All 4 sales recorded
- [ ] Correct platform fees
- [ ] Accurate profit calculations
- [ ] Revenue: £1150
- [ ] Dashboard updated

---

### TEST-1205: Integration - Error Recovery and Continuation
**Workflow**: Integration  
**Priority**: 🟡 MEDIUM  
**Time**: 15 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] Unit ready to sell
- [ ] Network available

**Test Steps**
1. Start selling unit
2. Simulate network error (fail midway)
3. Observe error message
4. Verify unit still available (rollback)
5. Retry sale (should succeed now)
6. Verify sale recorded once (no duplicate)

**Expected Results**
- ✅ Network error caught
- ✅ Sale not recorded during failure
- ✅ Unit remains available
- ✅ Retry succeeds
- ✅ No duplicate sale created

**Pass Criteria**
- [ ] Error handled gracefully
- [ ] Rollback successful
- [ ] Retry works
- [ ] No duplicates

---

### TEST-1206: Integration - User Session Persistence
**Workflow**: Integration  
**Priority**: 🟡 MEDIUM  
**Time**: 15 minutes  
**Status**: Not Started

**Pre-Conditions**
- [ ] User logged in
- [ ] Multiple actions performed (sales, returns, imports)

**Test Steps**
1. Note dashboard state: Available=10, Sold=5, Revenue=£800
2. Perform actions: Sell 2 units, Return 1
3. Expected state: Available=9, Sold=6, Revenue=updated
4. Close browser tab completely
5. Wait 5 minutes
6. Reopen app, log in
7. Verify dashboard state matches expected (Available=9, Sold=6)

**Expected Results**
- ✅ Actions persist after logout
- ✅ Dashboard state preserved
- ✅ All financial data intact
- ✅ No data loss on session change

**Pass Criteria**
- [ ] State persists after logout
- [ ] All data recovered
- [ ] No data loss
- [ ] Session recovery works

---

## Test Execution Summary

| Section | Test Count | Time Est. | Status |
|---------|-----------|-----------|--------|
| Search & Filtering | 8 | 1.5 hrs | ⬜ |
| Batch Operations | 8 | 2 hrs | ⬜ |
| Concurrent Operations | 6 | 1.5 hrs | ⬜ |
| Dashboard Accuracy | 9 | 2 hrs | ⬜ |
| Notifications | 7 | 1.5 hrs | ⬜ |
| Reporting & Analytics | 6 | 1.5 hrs | ⬜ |
| Advanced Filtering | 6 | 1.5 hrs | ⬜ |
| Integration Tests | 6 | 2 hrs | ⬜ |
| **TOTAL** | **50** | **10 hrs** | **⬜** |

---

**Phase 2 Status**: Ready for QA Execution  
**Last Updated**: 2026-05-07
