# InventoryManager - Phase 1: Critical Tests
**Error Handling, Complex Workflows, Data Consistency, Financial Accuracy**

---

## Phase 1 Overview

**Target Tests**: 40 critical test cases  
**Priority**: 🔴 HIGH - Must all pass for production release  
**Time Estimate**: 8 hours  
**Risk Level**: CRITICAL  
**Status**: Not Started

---

## Section 1: Error Handling & Validation (12 Tests)

### TEST-101: Invalid IMEI Format (Empty String)
**Workflow**: Input Validation  
**Priority**: 🔴 HIGH  
**Risk Level**: CRITICAL  
**Time**: 8 minutes  
**Status**: Not Started

#### Pre-Conditions
- [ ] Logged in to InventoryManager
- [ ] On "New Unit" entry form
- [ ] Form fields visible and editable

#### Test Steps
1. **Enter unit details**: Model=iPhone 14 Pro, Grade=Excellent, Storage=256GB
2. **Leave IMEI field empty**: Click on IMEI field and immediately move to next field
3. **Submit form**: Click "Create Unit" button
4. **Observe error state**: Check for validation error message

#### Expected Results
- ✅ Error message displayed: "IMEI is required or must be 8+ characters"
- ✅ Form does NOT submit
- ✅ IMEI field highlighted in red
- ✅ Cannot proceed without valid IMEI or skip option

#### Verification Points
□ Error message text correct  
□ Form styling shows error state  
□ Submit button disabled or error shown  
□ No unit created in database  

#### Pass Criteria
- [ ] Error displayed for empty IMEI
- [ ] Form submission prevented
- [ ] Field highlighted appropriately
- [ ] Clear user guidance provided

---

### TEST-102: Invalid IMEI Format (Too Short)
**Workflow**: Input Validation  
**Priority**: 🔴 HIGH  
**Risk Level**: CRITICAL  
**Time**: 8 minutes  
**Status**: Not Started

#### Pre-Conditions
- [ ] Logged in to InventoryManager
- [ ] On "New Unit" entry form
- [ ] Form fields visible

#### Test Steps
1. **Enter unit details**: Model=iPhone 14 Pro, Grade=Good, Storage=128GB
2. **Enter short IMEI**: Type "ABC123" (6 characters) in IMEI field
3. **Attempt submit**: Click "Create Unit" button
4. **Observe validation**: Watch for error message

#### Expected Results
- ✅ Validation error: "IMEI must be at least 8 characters"
- ✅ Form does NOT submit
- ✅ No database record created
- ✅ IMEI field shows red border or error state

#### Verification Points
□ Validation triggers on blur or submit  
□ Error message specific (mentions character count)  
□ Unit not created in localStorage/DB  
□ User can correct and resubmit  

#### Pass Criteria
- [ ] Short IMEI rejected
- [ ] Error message shown
- [ ] Form not submitted
- [ ] User can correct and retry

---

### TEST-103: Invalid IMEI Format (Special Characters)
**Workflow**: Input Validation  
**Priority**: 🟡 MEDIUM  
**Risk Level**: HIGH  
**Time**: 8 minutes  
**Status**: Not Started

#### Pre-Conditions
- [ ] Logged in to InventoryManager
- [ ] On "New Unit" entry form

#### Test Steps
1. **Enter unit details**: Model=Samsung Galaxy S23, Grade=Like New, Storage=512GB
2. **Enter IMEI with invalid chars**: Type "IMEI-!!!@@@##" (13 chars with special)
3. **Attempt submit**: Click "Create Unit"
4. **Check validation**: Observe error handling

#### Expected Results
- ✅ Validation may pass if alphanumeric allowed, OR error shown if strict validation
- ✅ Behavior is consistent and documented
- ✅ Either unit created with sanitized IMEI or error shown

#### Verification Points
□ IMEI validation logic consistent  
□ No database injection possible  
□ Sanitization applied if accepted  
□ Error message clear if rejected  

#### Pass Criteria
- [ ] Either accepted or rejected with clear reason
- [ ] No security issues with special characters
- [ ] Validation behavior documented
- [ ] Consistent handling across app

---

### TEST-104: Duplicate IMEI Detection
**Workflow**: Data Consistency  
**Priority**: 🔴 HIGH  
**Risk Level**: CRITICAL  
**Time**: 10 minutes  
**Status**: Not Started

#### Pre-Conditions
- [ ] Unit 1 exists with IMEI "352012345678901" (status=available)
- [ ] On "New Unit" form
- [ ] Ready to create another unit

#### Test Steps
1. **Enter same IMEI**: Model=iPhone 14, Grade=Excellent, IMEI=352012345678901
2. **Attempt submit**: Click "Create Unit"
3. **Observe duplicate check**: Check if duplicate IMEI validation triggers
4. **Verify behavior**: See error or warning

#### Expected Results
- ✅ Duplicate IMEI detected
- ✅ Error message: "IMEI already exists in inventory"
- ✅ Form submission prevented
- ✅ User pointed to existing unit

#### Verification Points
□ Duplicate check runs before save  
□ Error message shows conflicting IMEI  
□ Link to existing unit provided  
□ No duplicate created in DB  

#### Pass Criteria
- [ ] Duplicate IMEI blocked
- [ ] Clear error message
- [ ] User can navigate to existing unit
- [ ] Database integrity maintained

---

### TEST-105: Null/Undefined Field Handling
**Workflow**: Input Validation  
**Priority**: 🔴 HIGH  
**Risk Level**: HIGH  
**Time**: 10 minutes  
**Status**: Not Started

#### Pre-Conditions
- [ ] On "New Unit" form
- [ ] All fields visible
- [ ] Browser DevTools open

#### Test Steps
1. **Fill partial form**: Model=iPhone, Grade=(leave empty), Storage=256GB
2. **Try submit**: Click "Create Unit"
3. **Check missing field**: Verify Grade field validation
4. **Observe error**: Watch for error message or visual indication
5. **Check console**: Look for any JavaScript errors in DevTools → Console

#### Expected Results
- ✅ Validation error for missing Grade
- ✅ Form highlights missing required field
- ✅ No unit created
- ✅ Console shows no errors (no crashes)

#### Verification Points
□ All required fields validated  
□ No null/undefined values in DB  
□ Error messages clear  
□ No console errors  

#### Pass Criteria
- [ ] All required fields validated
- [ ] Missing fields highlighted
- [ ] Helpful error messages
- [ ] No JavaScript errors

---

### TEST-106: Batch Import - Invalid CSV Format
**Workflow**: Batch Import Validation  
**Priority**: 🔴 HIGH  
**Risk Level**: HIGH  
**Time**: 12 minutes  
**Status**: Not Started

#### Pre-Conditions
- [ ] On "Batch Import" page
- [ ] CSV file prepared with incorrect format
- [ ] File has missing columns (e.g., no IMEI column)

#### Test Steps
1. **Prepare bad CSV**: Create file with columns: Model,Grade (missing IMEI, Storage, BP)
2. **Select file**: Click "Choose File" and select malformed CSV
3. **Preview import**: Click "Preview" button
4. **Observe error**: Check if error message appears before import

#### Expected Results
- ✅ Error message: "Missing required columns: IMEI, Storage, BP"
- ✅ Import preview shows all issues
- ✅ "Import" button disabled until fixed
- ✅ User can correct CSV and retry

#### Verification Points
□ Column validation runs before import  
□ Error message specific (lists missing columns)  
□ Preview shows validation errors  
□ No partial imports allowed  

#### Pass Criteria
- [ ] Invalid CSV rejected
- [ ] Specific columns listed as missing
- [ ] No data imported
- [ ] User guided to fix CSV

---

### TEST-107: Batch Import - Duplicate IMEIs Within File
**Workflow**: Batch Import Validation  
**Priority**: 🔴 HIGH  
**Risk Level**: CRITICAL  
**Time**: 12 minutes  
**Status**: Not Started

#### Pre-Conditions
- [ ] On "Batch Import" page
- [ ] CSV prepared with duplicate IMEIs:
  - Row 1: IMEI=352012345678901
  - Row 2: IMEI=352012345678901 (duplicate)
  - Row 3: IMEI=352012345678902

#### Test Steps
1. **Select CSV file**: Click "Choose File" and select CSV with duplicates
2. **Preview import**: Click "Preview" button
3. **Observe duplicate detection**: Check if duplicates highlighted
4. **Check error message**: Verify which rows show as duplicates

#### Expected Results
- ✅ Duplicate IMEI detected in preview
- ✅ Error message: "Row 2: Duplicate IMEI found in same import (also in Row 1)"
- ✅ Preview shows which rows conflict
- ✅ "Import" button disabled until duplicates resolved

#### Verification Points
□ Duplicates detected before import  
□ Error shows conflicting row numbers  
□ User can edit CSV  
□ No partial import of batch  

#### Pass Criteria
- [ ] Duplicates within file detected
- [ ] Specific rows identified
- [ ] Import prevented
- [ ] User can fix and retry

---

### TEST-108: Sale Price Validation - Below Cost
**Workflow**: Financial Validation  
**Priority**: 🔴 HIGH  
**Risk Level**: CRITICAL  
**Time**: 10 minutes  
**Status**: Not Started

#### Pre-Conditions
- [ ] Unit exists with BP (Buy Price) = £200
- [ ] On "Sell Unit" page for this unit
- [ ] Sale form ready

#### Test Steps
1. **Enter sale details**: Platform=eBay, Order ID=ORD-001
2. **Enter low sale price**: Price = £50 (below BP of £200)
3. **Attempt submit**: Click "Record Sale" button
4. **Observe warning/error**: Check if system warns about loss

#### Expected Results
- ✅ Warning shown: "Sale price (£50) is below buy price (£200) - This will result in a loss"
- ✅ User must confirm to proceed (optional but recommended)
- ✅ If confirmed, sale records with negative profit
- ✅ Dashboard shows red profit amount for this sale

#### Verification Points
□ Price validation runs before save  
□ Warning message clear and helpful  
□ Loss calculated correctly  
□ Confirmation not required but loss recorded  

#### Pass Criteria
- [ ] Below-cost sale detected
- [ ] Warning shown
- [ ] Loss calculated correctly
- [ ] Sale proceeds with warning (user choice)

---

### TEST-109: Sale - Missing Required Fields
**Workflow**: Data Validation  
**Priority**: 🟡 MEDIUM  
**Risk Level**: HIGH  
**Time**: 10 minutes  
**Status**: Not Started

#### Pre-Conditions
- [ ] Unit available in inventory
- [ ] On "Sell Unit" form
- [ ] Form fields visible

#### Test Steps
1. **Fill partial form**: Platform=eBay, Price=£300, (leave Postage empty)
2. **Attempt submit**: Click "Record Sale"
3. **Observe validation**: Check for error on missing Postage
4. **Verify field highlight**: See if Postage field highlighted

#### Expected Results
- ✅ Validation error: "Postage cost is required"
- ✅ Form highlights Postage field in red
- ✅ Sale not recorded
- ✅ User can enter postage and retry

#### Verification Points
□ All required sale fields validated  
□ Error messages specific to missing field  
□ Field highlighting clear  
□ No sale created without all data  

#### Pass Criteria
- [ ] Missing fields detected
- [ ] Clear error messages
- [ ] Field highlighted
- [ ] Sale prevented

---

### TEST-110: Return Processing - Invalid Return Type
**Workflow**: Return Validation  
**Priority**: 🟡 MEDIUM  
**Risk Level**: MEDIUM  
**Time**: 8 minutes  
**Status**: Not Started

#### Pre-Conditions
- [ ] Sold unit exists in inventory
- [ ] On "Process Return" form
- [ ] Return type dropdown visible

#### Test Steps
1. **Attempt direct input**: Try to type custom return type in dropdown
2. **Verify restricted input**: Check if only predefined options allowed
3. **Select valid option**: Choose "Return to Inventory" from dropdown
4. **Verify form accepts**: Confirm selection registered

#### Expected Results
- ✅ Dropdown only accepts predefined values
- ✅ Custom typing prevented
- ✅ Valid selections work correctly
- ✅ Form validates return type required

#### Verification Points
□ Dropdown restricts to valid options  
□ No custom values accepted  
□ Selection updates form state  
□ Validation accepts valid values  

#### Pass Criteria
- [ ] Return type restricted to dropdown options
- [ ] No custom/invalid types allowed
- [ ] Valid selections work
- [ ] Form validates correctly

---

### TEST-111: SHS - Status Constraint Validation
**Workflow**: SHS Workflow  
**Priority**: 🔴 HIGH  
**Risk Level**: HIGH  
**Time**: 10 minutes  
**Status**: Not Started

#### Pre-Conditions
- [ ] SHS unit created with status=incoming
- [ ] Unit exists in Available Units table (filtered view)
- [ ] Try to mark as sold without adding IMEI

#### Test Steps
1. **Click "Sell" on SHS unit**: Open sell modal
2. **Leave IMEI field empty**: Don't enter or change IMEI in modal
3. **Submit sale form**: Click "Record Sale" button
4. **Check error**: Verify if empty IMEI rejected for SHS

#### Expected Results
- ✅ System warns: "SHS units should have IMEI entered"
- ✅ Either requires IMEI or allows sale with empty IMEI (behavior documented)
- ✅ If allowed, IMEI remains empty or preserved
- ✅ Sale records correctly with or without IMEI

#### Verification Points
□ SHS validation consistent with workflow  
□ IMEI handling documented  
□ No data corruption from SHS sales  
□ Sold History shows SHS with/without IMEI  

#### Pass Criteria
- [ ] SHS validation enforced or bypassed (documented)
- [ ] IMEI handling consistent
- [ ] Sale recorded correctly
- [ ] No data inconsistencies

---

### TEST-112: Platform Fee Calculation - Unsupported Platform
**Workflow**: Financial Calculation  
**Priority**: 🟡 MEDIUM  
**Risk Level**: MEDIUM  
**Time**: 8 minutes  
**Status**: Not Started

#### Pre-Conditions
- [ ] On "Sell Unit" form
- [ ] Platform dropdown visible
- [ ] Default platforms: eBay, Amazon, OnBuy, Backmarket

#### Test Steps
1. **Verify platform options**: Check dropdown shows 4 platforms only
2. **Attempt to enter custom platform**: Try to type "Facebook" in platform field
3. **Verify restriction**: Confirm custom values not accepted
4. **Select valid platform**: Choose "Amazon"
5. **Enter sale price**: £250
6. **Verify fee calculation**: Confirm Amazon fee (8%) calculated = £20

#### Expected Results
- ✅ Only 4 platforms available in dropdown
- ✅ Custom platforms not allowed
- ✅ Fee automatically calculated for selected platform
- ✅ Amazon fee calculation: 8% of £250 = £20

#### Verification Points
□ Platform restricted to 4 valid options  
□ Correct fee formula by platform  
□ Calculation automatic  
□ Fee deducted from profit  

#### Pass Criteria
- [ ] Platform restricted to 4 options
- [ ] Correct fee calculated
- [ ] No unsupported platforms accepted
- [ ] Fee appears in profit calculation

---

## Section 2: Complex Workflows (10 Tests)

### TEST-201: Multi-Platform Sales - Same Unit Price Sensitivity
**Workflow**: Sales & Financial  
**Priority**: 🔴 HIGH  
**Risk Level**: HIGH  
**Time**: 15 minutes  
**Status**: Not Started

#### Pre-Conditions
- [ ] Unit exists with BP=£200, available status
- [ ] On dashboard or Available Units page
- [ ] Ready to sell same unit at different prices

#### Test Steps
1. **First sale scenario**: Record sale with Price=£350, Platform=eBay, Postage=£8
   - eBay fee: 12.8% + £0.30 = (£350 × 0.128) + £0.30 = £45.10 + £0.30 = £45.40
   - Profit: £350 - £200 (BP) - £45.40 (eBay fee) - £8 (postage) = £96.60
2. **Verify profit display**: Check dashboard shows green (profit)
3. **Return unit**: Process return to available status
4. **Second sale scenario**: Sell same unit at Price=£180, Platform=Amazon, Postage=£5
   - Amazon fee: 8% = £180 × 0.08 = £14.40
   - Profit: £180 - £200 (BP) - £14.40 (fee) - £5 (postage) = -£39.40 (loss)
5. **Verify loss display**: Check dashboard shows red (loss)

#### Expected Results
- ✅ First sale records as profit (£96.60) displayed in green
- ✅ Unit returned to available
- ✅ Second sale records as loss (-£39.40) displayed in red
- ✅ Both sales in Sold History with correct calculations
- ✅ Dashboard totals updated correctly

#### Verification Points
□ eBay fee calculation correct (12.8% + £0.30)  
□ Amazon fee calculation correct (8%)  
□ Return process clears sale data  
□ Unit available for resale  
□ Profit/loss colors accurate (green/red)  
□ Dashboard totals reflect both sales  

#### Pass Criteria
- [ ] eBay fee calculated correctly
- [ ] Profit displays in green
- [ ] Return clears sale data
- [ ] Amazon fee calculated correctly
- [ ] Loss displays in red
- [ ] Both sales tracked in history

---

### TEST-202: Batch Import - Mixed Status Units
**Workflow**: Batch Import  
**Priority**: 🟡 MEDIUM  
**Risk Level**: MEDIUM  
**Time**: 20 minutes  
**Status**: Not Started

#### Pre-Conditions
- [ ] CSV prepared with 5 units:
  - Units 1-3: status=available (newly imported)
  - Units 4-5: status=sold (presold units from supplier data)
- [ ] On Batch Import page

#### Test Steps
1. **Load CSV file**: Select file with mixed statuses
2. **Preview import**: Click "Preview" button
3. **Verify separation**: Check that preview shows status=available units separately
4. **Complete import**: Click "Import" button
5. **Verify in dashboard**: Navigate to dashboard after import
6. **Count available units**: Verify only 3 available units counted
7. **Check sold history**: Verify 2 sold units appear in Sold History

#### Expected Results
- ✅ All 5 units imported successfully
- ✅ 3 units with status=available counted in Available count
- ✅ 2 units with status=sold excluded from Available count
- ✅ Sold History shows the 2 presold units
- ✅ Dashboard totals accurate (Available=3, Sold=2)

#### Verification Points
□ Mixed statuses imported correctly  
□ Status field respected on import  
□ Available count excludes sold units  
□ Sold History includes presold units  
□ Dashboard calculations accurate  

#### Pass Criteria
- [ ] All units imported regardless of status
- [ ] Status field preserved on import
- [ ] Dashboard counts accurate
- [ ] Sold History updated
- [ ] No data loss

---

### TEST-203: Concurrent Unit Operations - Add & Sell Simultaneously
**Workflow**: Concurrent Operations  
**Priority**: 🟠 ORANGE  
**Risk Level**: HIGH  
**Time**: 15 minutes  
**Status**: Not Started

#### Pre-Conditions
- [ ] Dashboard open in one browser tab
- [ ] Sell Unit page open in another tab or window
- [ ] Same unit available in both tabs
- [ ] Ready to perform operations

#### Test Steps
1. **Tab 1**: Click "Sell" on available unit, enter sale details but don't submit yet
2. **Tab 2**: Navigate to dashboard, refresh to see unit still available
3. **Tab 1**: Submit sale form without refreshing other tab
4. **Tab 2**: Manually refresh dashboard
5. **Verify state**: Check if unit shows as sold or still available
6. **Check Sold History**: Verify sale appears or doesn't appear

#### Expected Results
- ✅ Tab 2 refresh after sale shows unit as sold
- ✅ Sold History updated with new sale
- ✅ Available count decremented
- ✅ Sold count incremented
- ✅ No data corruption from concurrent access

#### Verification Points
□ Real-time synchronization working  
□ Unit status consistency across tabs  
□ No duplicate sales created  
□ Database state consistent  
□ No stale data displayed  

#### Pass Criteria
- [ ] Sale recorded correctly
- [ ] Dashboard reflects change after refresh
- [ ] No duplicate sales
- [ ] Data consistent across tabs

---

### TEST-204: Return Processing - Full Data Cleanup
**Workflow**: Return Processing  
**Priority**: 🔴 HIGH  
**Risk Level**: HIGH  
**Time**: 15 minutes  
**Status**: Not Started

#### Pre-Conditions
- [ ] Sold unit with complete sale data:
  - status=sold
  - salePrice=£350, Platform=eBay, OrderID=ORD-12345
  - Postage=£8, saleDate=2026-05-07
  - Profit=£96.60 calculated and stored
- [ ] Unit appears in Sold History

#### Test Steps
1. **Open unit details**: Click on unit in Sold History
2. **Process return**: Click "Process Return" button
3. **Select type**: Choose "Return to Inventory"
4. **Confirm return**: Click "Confirm Return"
5. **Verify status change**: Check status changed to "available"
6. **Inspect data fields**: Check if all sale fields cleared:
   - salePrice should be null/empty
   - Platform should be null/empty
   - OrderID should be null/empty
   - saleDate should be null/empty
7. **Dashboard verification**: Refresh dashboard, verify unit removed from Sold History and added to Available Units

#### Expected Results
- ✅ Status changes to "available"
- ✅ All sale fields cleared (salePrice, Platform, OrderID, Postage, saleDate)
- ✅ Profit calculation cleared
- ✅ Unit appears in Available Units list
- ✅ Unit removed from Sold History
- ✅ Dashboard counts updated: Available +1, Sold -1

#### Verification Points
□ All sale fields properly nullified  
□ Status transition correct  
□ Dashboard Updated immediately  
□ No orphaned sale data  
□ Unit findable in Available Units  

#### Pass Criteria
- [ ] Status changed to available
- [ ] All sale fields cleared
- [ ] Dashboard updated correctly
- [ ] Available Units list includes unit
- [ ] Sold History no longer shows unit

---

### TEST-205: SHS Workflow - From Incoming to Sold with IMEI
**Workflow**: SHS Complete Workflow  
**Priority**: 🔴 HIGH  
**Risk Level**: CRITICAL  
**Time**: 18 minutes  
**Status**: Not Started

#### Pre-Conditions
- [ ] SHS unit created with:
  - status=incoming
  - Model=iPhone 14 Pro
  - Grade=Excellent
  - Storage=256GB
  - IMEI="" (empty - supplier hasn't provided yet)
  - BP=£220

#### Test Steps
1. **Step 1 - Create SHS unit**: Navigate to New Unit form, select SHS=Yes, leave IMEI empty, create unit
2. **Verify incoming status**: Check Available Units page, unit shows status=incoming or separate SHS section
3. **Step 2 - Add IMEI manually**: 
   - Open unit detail view
   - Click "Edit IMEI" or similar option
   - Enter IMEI: 352012345678901
   - Save changes
4. **Verify IMEI saved**: Confirm unit detail now shows IMEI=352012345678901
5. **Step 3 - Mark as sold**:
   - Click "Sell" button on SHS unit
   - Enter sale details: Platform=eBay, Price=£450, Postage=£8
   - In IMEI field of modal, leave empty (IMEI already added) or re-enter same IMEI
   - Submit sale
6. **Verify IMEI preserved**: Check Sold History, unit shows IMEI=352012345678901 (NOT cleared)
7. **Verify financial data**:
   - eBay fee: (£450 × 0.128) + £0.30 = £58.14
   - Profit: £450 - £220 (BP) - £58.14 (eBay fee) - £8 (postage) = £163.86
   - Check dashboard shows green profit of £163.86

#### Expected Results
- ✅ SHS unit created with status=incoming, IMEI=empty
- ✅ IMEI added via edit, verified in unit detail
- ✅ Unit marked as sold
- ✅ **CRITICAL**: IMEI preserved (£352012345678901) - NOT cleared to empty string
- ✅ Sold History shows complete data
- ✅ Profit calculated correctly as £163.86
- ✅ Dashboard displays profit in green

#### Verification Points
□ SHS creation status is "incoming"  
□ IMEI field editable after creation  
□ IMEI update persists  
□ Sale modal opens correctly for SHS  
□ **CRITICAL**: IMEI NOT cleared on sale  
□ Financial calculation accurate  
□ Dashboard updated with new sale  

#### Pass Criteria
- [ ] SHS created with incoming status
- [ ] IMEI successfully added
- [ ] IMEI verified in unit detail
- [ ] Sale recorded without clearing IMEI
- [ ] **CRITICAL PASS**: IMEI preserved in sold record
- [ ] Profit calculated correctly
- [ ] Dashboard shows correct profit

---

### TEST-206: Barcode Scan - Auto-Population with Verification
**Workflow**: Barcode Scanning  
**Priority**: 🟡 MEDIUM  
**Risk Level**: MEDIUM  
**Time**: 12 minutes  
**Status**: Not Started

#### Pre-Conditions
- [ ] Barcode scan simulation ready
- [ ] Test barcode: "iPhone14Pro|Excellent|256GB|£220|352012345678901"
- [ ] On Barcode Scan page or modal

#### Test Steps
1. **Enter barcode**: Paste or type test barcode in scan field
2. **Trigger parse**: Press Enter or click "Parse Barcode"
3. **Verify auto-population**:
   - Model field: Should show "iPhone14Pro" or "iPhone 14 Pro"
   - Grade field: Should show "Excellent"
   - Storage field: Should show "256GB"
   - BP field: Should show "£220"
   - IMEI field: Should show "352012345678901"
4. **Review populated form**: Check all fields populated correctly
5. **Submit unit**: Click "Create Unit" to save
6. **Verify in Available Units**: Confirm unit appears with auto-populated data

#### Expected Results
- ✅ Barcode parsing succeeds
- ✅ All fields auto-populated from barcode
- ✅ Model parsed correctly (with proper spacing/formatting)
- ✅ Grade, Storage, BP, IMEI all extracted accurately
- ✅ Unit created with auto-populated data
- ✅ Data visible in Available Units list

#### Verification Points
□ Barcode parsing logic correct  
□ All fields extracted from barcode  
□ Data formatting applied (model spacing, etc.)  
□ Unit creation succeeds with scanned data  
□ Available Units shows scanned unit  

#### Pass Criteria
- [ ] Barcode parsed successfully
- [ ] All 5 fields auto-populated
- [ ] Data formatted correctly
- [ ] Unit created and visible
- [ ] No manual re-entry needed

---

### TEST-207: Batch - Category Filter with Mixed Units
**Workflow**: Batch Operations  
**Priority**: 🟡 MEDIUM  
**Risk Level**: MEDIUM  
**Time**: 15 minutes  
**Status**: Not Started

#### Pre-Conditions
- [ ] Batch imported with 6 units:
  - 3 iPhones (14 Pro, 13, 12)
  - 2 Samsung Galaxy (S23, S22)
  - 1 Google Pixel (7 Pro)
- [ ] Batch visible in Batch List page
- [ ] Filter options available (Category dropdown)

#### Test Steps
1. **Open batch**: Click batch to view all units
2. **Verify count**: Confirm 6 units displayed initially
3. **Filter by iPhone**: Select "iPhone" from category filter dropdown
4. **Verify filtered results**: Should show 3 iPhone units only
5. **Verify count**: Confirm "3 of 6" or similar counter
6. **Filter by Samsung**: Select "Samsung" from dropdown
7. **Verify Samsung units**: Should show 2 Samsung units
8. **Clear filter**: Select "All" or clear filter
9. **Verify all units**: All 6 units displayed again

#### Expected Results
- ✅ iPhone filter shows 3 units only
- ✅ Samsung filter shows 2 units only
- ✅ Pixel filter shows 1 unit
- ✅ Filter counter accurate ("3 of 6", "2 of 6", etc.)
- ✅ Clearing filter shows all 6 units again
- ✅ Filter persists until changed

#### Verification Points
□ Filter dropdown populated with categories  
□ Filtered results accurate  
□ Counter updated correctly  
□ Filtering doesn't modify data (view-only)  
□ Clear filter works  

#### Pass Criteria
- [ ] iPhone filter returns 3 units
- [ ] Samsung filter returns 2 units
- [ ] Counter shows correct ratio
- [ ] Filter reversible
- [ ] No data modified by filtering

---

### TEST-208: Dashboard - Real-Time Update on Sale
**Workflow**: Dashboard  
**Priority**: 🔴 HIGH  
**Risk Level**: HIGH  
**Time**: 15 minutes  
**Status**: Not Started

#### Pre-Conditions
- [ ] Dashboard open and visible in browser
- [ ] Shows: Available=5, Sold=2, Revenue=£850
- [ ] Available Units list visible
- [ ] SellUnit page ready in another tab/window

#### Test Steps
1. **Note baseline**: Record current counts (Available=5, Sold=2)
2. **Open SellUnit in new tab**: Navigate to Sell Unit page (don't close dashboard)
3. **Select unit**: Choose first available unit from Available Units
4. **Record sale**: Enter sale details, submit sale
5. **Switch to dashboard tab**: Return to dashboard tab (don't refresh)
6. **Check for real-time update**:
   - Available count should change to 4
   - Sold count should change to 3
   - New sale should appear in Sold History
   - Newest sale should appear at TOP of Sold History
7. **If not updated**: Manually refresh dashboard and verify counts updated

#### Expected Results
- ✅ Dashboard Available count decrements to 4 (real-time or after refresh)
- ✅ Dashboard Sold count increments to 3
- ✅ New sale appears in Sold History
- ✅ New sale appears at TOP (latest first)
- ✅ Revenue total updated
- ✅ Available Units list no longer shows sold unit

#### Verification Points
□ Real-time updates working (or manual refresh required)  
□ Counts accurate after update  
□ Sales history order correct (latest first)  
□ Revenue recalculated  
□ UI consistent across tabs  

#### Pass Criteria
- [ ] Available count decrements
- [ ] Sold count increments
- [ ] New sale appears in list
- [ ] Latest sale shows at top
- [ ] All counts accurate

---

### TEST-209: Multiple Suppliers - Data Isolation
**Workflow**: Supplier Management  
**Priority**: 🟡 MEDIUM  
**Risk Level**: MEDIUM  
**Time**: 12 minutes  
**Status**: Not Started

#### Pre-Conditions
- [ ] Logged in as user with access to multiple suppliers
- [ ] Units from Supplier A: 3 units
- [ ] Units from Supplier B: 2 units
- [ ] Units from Supplier C: 4 units
- [ ] Total: 9 units across 3 suppliers

#### Test Steps
1. **Note current supplier**: Check which supplier logged in as
2. **Filter by Supplier A**: Select Supplier A from dropdown/filter
3. **Verify count**: Confirm only 3 units display
4. **Check unit source**: Verify all shown units belong to Supplier A
5. **Filter by Supplier B**: Select Supplier B
6. **Verify isolation**: Confirm only Supplier B's 2 units display
7. **Verify no crossover**: Confirm no Supplier A units visible
8. **Filter "All Suppliers"**: Select view all
9. **Verify total**: Confirm all 9 units visible

#### Expected Results
- ✅ Supplier A filter shows exactly 3 units (none from B or C)
- ✅ Supplier B filter shows exactly 2 units (none from A or C)
- ✅ Supplier C filter shows exactly 4 units
- ✅ All Suppliers view shows all 9 units
- ✅ No data leakage between suppliers
- ✅ Filter counter accurate for each supplier

#### Verification Points
□ Supplier filter working correctly  
□ Data properly isolated per supplier  
□ Filter counter accurate  
□ All units count accurate when viewing all  
□ No cross-supplier data visible  

#### Pass Criteria
- [ ] Supplier A shows 3 units only
- [ ] Supplier B shows 2 units only
- [ ] No data crossover
- [ ] All suppliers view shows 9 units
- [ ] Counts accurate

---

### TEST-210: Financial Accuracy - Edge Case (£0.01 Rounding)
**Workflow**: Financial Calculation  
**Priority**: 🟡 MEDIUM  
**Risk Level**: MEDIUM  
**Time**: 12 minutes  
**Status**: Not Started

#### Pre-Conditions
- [ ] Unit with BP=£123.45
- [ ] Ready to test fee calculation with odd prices
- [ ] On Sell Unit form

#### Test Steps
1. **Enter odd sale price**: Price=£333.33 (triggers 0.01 rounding in fees)
2. **Select platform**: Choose OnBuy (9% fee)
3. **Calculate expected fee**: £333.33 × 0.09 = £30.00 (rounded)
4. **Set postage**: £7.50
5. **Submit sale**: Record sale
6. **Check profit calculation**:
   - Expected: £333.33 - £123.45 (BP) - £30.00 (fee) - £7.50 (postage) = £172.38
7. **Verify in Sold History**: Check profit shows exactly £172.38 (no rounding errors)
8. **Check dashboard**: Verify revenue includes £333.33 exactly

#### Expected Results
- ✅ Fee calculated correctly: £30.00 (rounded appropriately)
- ✅ Profit shows £172.38 (no accumulation of rounding errors)
- ✅ Revenue total includes full £333.33 (not rounded down)
- ✅ Dashboard calculations consistent
- ✅ No floating-point math errors

#### Verification Points
□ Rounding consistent throughout  
□ No accumulation of rounding errors  
□ Profit accurate to £0.01  
□ Revenue total unrounded  
□ All calculations consistent  

#### Pass Criteria
- [ ] Fee rounded correctly (£30.00)
- [ ] Profit accurate (£172.38)
- [ ] No floating-point errors
- [ ] Calculations consistent

---

## Section 3: Data Consistency (8 Tests)

### TEST-301: Unit Status Integrity - Sold Unit Cannot Be Sold Again
**Workflow**: Data Integrity  
**Priority**: 🔴 HIGH  
**Risk Level**: CRITICAL  
**Time**: 10 minutes  
**Status**: Not Started

#### Pre-Conditions
- [ ] Unit with status=sold exists
- [ ] Unit appears in Sold History
- [ ] Unit's "Sell" button should be disabled or unavailable

#### Test Steps
1. **Open sold unit**: Click on unit in Sold History to view details
2. **Look for "Sell" button**: Check if button present and enabled
3. **Attempt to sell**: Try clicking "Sell" if button visible
4. **Check for error**: Observe error message or button disabled state
5. **Try edit mode**: Check if sale fields editable (should not be)

#### Expected Results
- ✅ "Sell" button is NOT visible for sold units (or disabled)
- ✅ Clicking button shows error: "Unit already sold"
- ✅ Sale fields are read-only
- ✅ Cannot change sale price, platform, or postage
- ✅ No "Record Sale" button available for sold units

#### Verification Points
□ Sold units inaccessible for selling  
□ UI prevents double-sales  
□ Sale data read-only  
□ No duplicate sales possible  
□ Clear error messages if attempted  

#### Pass Criteria
- [ ] "Sell" button disabled for sold units
- [ ] Sale fields read-only
- [ ] No way to re-sell without return first
- [ ] Clear error if attempted

---

### TEST-302: Batch Integrity - Individual Unit Sales Don't Break Batch
**Workflow**: Batch Operations  
**Priority**: 🟡 MEDIUM  
**Risk Level**: MEDIUM  
**Time**: 15 minutes  
**Status**: Not Started

#### Pre-Conditions
- [ ] Batch imported with 4 units (batchNo="INV-2061"):
  - Unit 1: iPhone 14 Pro
  - Unit 2: iPhone 14
  - Unit 3: iPhone 13
  - Unit 4: iPhone 12
- [ ] All units visible in Batch view
- [ ] Batch totals calculated

#### Test Steps
1. **View batch totals**: Note initial count: "4 units"
2. **Sell Unit 1**: Open Sell page, record sale for iPhone 14 Pro
3. **Return to batch**: Navigate back to Batch view
4. **Verify unit count**: Should still show 4 units (sold units remain in batch)
5. **Check unit status**: Unit 1 should show status=sold within batch
6. **Sell Unit 3**: Record another sale
7. **Verify batch integrity**: Batch still shows 4 units, with units 1 and 3 marked sold

#### Expected Results
- ✅ Batch remains intact with 4 units
- ✅ Sold units still appear in batch view (not removed)
- ✅ Unit status visible in batch (available vs sold)
- ✅ Batch totals update:
  - Available within batch: 2
  - Sold within batch: 2
- ✅ Batch financial totals recalculate if applicable

#### Verification Points
□ Batch not deleted or broken by sales  
□ Unit count remains 4  
□ Unit statuses visible in batch  
□ Batch totals accurate  
□ Sold units trackable within batch  

#### Pass Criteria
- [ ] Batch shows 4 units after sales
- [ ] Unit statuses visible (sold/available)
- [ ] Batch totals accurate
- [ ] No batch corruption

---

### TEST-303: Database State - Consistency After Failed Operations
**Workflow**: Error Recovery  
**Priority**: 🟡 MEDIUM  
**Risk Level**: MEDIUM  
**Time**: 15 minutes  
**Status**: Not Started

#### Pre-Conditions
- [ ] Unit ready for sale with all required data
- [ ] Network simulator ready (or prepare to interrupt request)
- [ ] Browser DevTools open (Network tab)

#### Test Steps
1. **Start sale recording**: Begin filling Sell form
2. **Fill all fields**: Platform=eBay, Price=£300, Postage=£8, all required fields
3. **Simulate network error**: Open DevTools → Network tab, throttle to Offline
4. **Click submit**: Attempt to record sale while offline
5. **Observe error**: Check for error message about network failure
6. **Restore network**: Switch network back to online
7. **Check unit state**: Verify unit is still available (not partially updated)
8. **Retry sale**: Attempt to sell again with same data
9. **Verify success**: Confirm sale records after retry

#### Expected Results
- ✅ Network error caught and displayed to user
- ✅ Sale NOT recorded during failed attempt
- ✅ Unit remains available (not stuck in intermediate state)
- ✅ User can retry without duplicate data
- ✅ Retry succeeds on network recovery
- ✅ No orphaned/inconsistent data in database

#### Verification Points
□ Error handling for network failures  
□ Rollback if partial save attempted  
□ Unit state not corrupted  
□ User can retry safely  
□ No duplicate data created  

#### Pass Criteria
- [ ] Error message shown on network failure
- [ ] Unit remains available
- [ ] No partial data saved
- [ ] Retry succeeds
- [ ] Database consistent

---

### TEST-304: Inventory Count Accuracy - After Multiple Operations
**Workflow**: Data Consistency  
**Priority**: 🔴 HIGH  
**Risk Level**: HIGH  
**Time**: 20 minutes  
**Status**: Not Started

#### Pre-Conditions
- [ ] Dashboard showing: Available=10, Sold=5, Total=15
- [ ] Ready to perform multiple operations

#### Test Steps
1. **Record baseline**: Available=10, Sold=5, Total=15
2. **Sell 3 units**: Record 3 sales one by one
3. **Check counts**: Available should be 7, Sold should be 8
4. **Return 1 unit**: Process 1 return to inventory
5. **Check counts**: Available should be 8, Sold should be 7
6. **Import batch with 5 units**: Load batch import with 5 new units
7. **Check counts**: Available should be 13, Sold should be 7, Total should be 20
8. **Return supplier unit**: Process 1 return to supplier (different from return to inventory)
9. **Check counts**: Available=13, Sold=6, Returned=1, Total=20

#### Expected Results
- ✅ After 3 sales: Available=7, Sold=8
- ✅ After 1 return: Available=8, Sold=7
- ✅ After batch import: Available=13, Sold=7, Total=20
- ✅ After supplier return: Available=13, Sold=6, Total=20 (Returned tracked separately)
- ✅ All counts accurate throughout

#### Verification Points
□ Available count decrements on sale  
□ Sold count increments on sale  
□ Available count increments on return  
□ Sold count decrements on return  
□ Batch import adds to counts  
□ All totals remain consistent  

#### Pass Criteria
- [ ] All counts accurate at each step
- [ ] Total always matches sum of components
- [ ] Counts persistent (survive refresh)
- [ ] No lost or duplicated units

---

### TEST-305: IMEI Data Integrity - Uniqueness Enforced
**Workflow**: Data Validation  
**Priority**: 🔴 HIGH  
**Risk Level**: CRITICAL  
**Time**: 15 minutes  
**Status**: Not Started

#### Pre-Conditions
- [ ] Unit 1 exists with IMEI="352012345678901"
- [ ] On New Unit form to create Unit 2
- [ ] Ready to attempt duplicate IMEI

#### Test Steps
1. **Create first unit**: IMEI="352012345678901", Model=iPhone 14, etc. (already created)
2. **Verify in inventory**: Unit 1 appears in Available Units
3. **Attempt duplicate**: Try to create Unit 2 with same IMEI="352012345678901"
4. **Observe validation**: Check if duplicate IMEI rejected
5. **Note error message**: Document what error shown
6. **Check database**: Verify only 1 unit with IMEI-352012345678901 exists (no duplicate created)
7. **Try different IMEI**: Create Unit 2 with IMEI="352012345678902"
8. **Verify success**: Unit 2 created with unique IMEI

#### Expected Results
- ✅ Duplicate IMEI rejected during creation
- ✅ Error message: "IMEI 352012345678901 already exists"
- ✅ Form submission prevented
- ✅ No duplicate unit created in database
- ✅ Unique IMEI accepted and unit created

#### Verification Points
□ Duplicate IMEI detection working  
□ Only 1 unit per IMEI in database  
□ Clear error message  
□ User can correct and retry  
□ Unique IMEI accepted  

#### Pass Criteria
- [ ] Duplicate IMEI rejected
- [ ] Error message shown
- [ ] Only 1 unit in database for IMEI
- [ ] Unique IMEI accepted
- [ ] No duplicates created

---

### TEST-306: Sale Financial Data - Completeness and Consistency
**Workflow**: Financial Data  
**Priority**: 🟡 MEDIUM  
**Risk Level**: MEDIUM  
**Time**: 12 minutes  
**Status**: Not Started

#### Pre-Conditions
- [ ] Unit sold with complete financial data
- [ ] Sale visible in Sold History
- [ ] Unit details page open

#### Test Steps
1. **View sold unit**: Open unit detail from Sold History
2. **Verify all fields present**:
   - salePrice: Should show £XXX
   - Platform: Should show eBay/Amazon/OnBuy/Backmarket
   - OrderID: Should show order number
   - Postage: Should show £X.XX
   - saleDate: Should show date sold
   - Profit/Loss: Should show calculated amount
3. **Verify no NULL fields**: Confirm no fields show "undefined" or "null"
4. **Check profit calculation**: Verify profit = salePrice - BP - Fee - Postage
5. **Compare with dashboard**: Verify data matches displayed in Sold History list

#### Expected Results
- ✅ All required sale fields present
- ✅ No NULL or undefined values
- ✅ Profit calculated and displayed
- ✅ Profit matches calculation formula
- ✅ All data consistent with Sold History list
- ✅ No data truncation or loss

#### Verification Points
□ All sale fields populated  
□ No null/undefined values  
□ Profit calculation correct  
□ Data consistent across views  
□ No truncated data  

#### Pass Criteria
- [ ] All sale fields present
- [ ] No undefined/null values
- [ ] Profit calculated correctly
- [ ] Data consistent
- [ ] Complete record in database

---

### TEST-307: Dashboard Totals - Recalculation After Each Change
**Workflow**: Dashboard Calculations  
**Priority**: 🔴 HIGH  
**Risk Level**: HIGH  
**Time**: 15 minutes  
**Status**: Not Started

#### Pre-Conditions
- [ ] Dashboard showing current totals
- [ ] Ready to make changes and observe recalculation

#### Test Steps
1. **Record baseline**: Available=8, Sold=3, Total Revenue=£950
2. **Sell 1 unit**: Price=£200, Platform=Amazon, Postage=£5
   - Expected revenue: £950 + £200 = £1150
3. **Check dashboard**: Verify Revenue = £1150 (updated)
4. **Return 1 unit**: Process return to inventory
   - Returned unit had sale price=£300
   - Expected revenue: £1150 - £300 = £850
5. **Check dashboard**: Verify Revenue = £850 (recalculated)
6. **Sell another unit**: Price=£400
   - Expected revenue: £850 + £400 = £1250
7. **Verify dashboard**: Confirm Revenue = £1250
8. **Check Available/Sold counts**: Verify counts accurate at each step

#### Expected Results
- ✅ After first sale: Revenue updated to £1150
- ✅ After return: Revenue recalculated to £850
- ✅ After second sale: Revenue updated to £1250
- ✅ Available count decrements on sale, increments on return
- ✅ Sold count increments on sale, decrements on return
- ✅ All totals accurate and up-to-date

#### Verification Points
□ Revenue recalculates on sale  
□ Revenue recalculates on return  
□ Available count updates correctly  
□ Sold count updates correctly  
□ Total always accurate  
□ No rounding errors in totals  

#### Pass Criteria
- [ ] Revenue updates on each sale/return
- [ ] Available count accurate
- [ ] Sold count accurate
- [ ] All calculations correct
- [ ] Real-time updates working

---

### TEST-308: Historical Data Preservation - Archive Integrity
**Workflow**: Data Integrity  
**Priority**: 🟡 MEDIUM  
**Risk Level**: MEDIUM  
**Time**: 12 minutes  
**Status**: Not Started

#### Pre-Conditions
- [ ] Sold History contains sales from multiple dates
- [ ] Oldest sale: 2026-04-01
- [ ] Most recent sale: 2026-05-07
- [ ] Export or view historical data available

#### Test Steps
1. **View Sold History**: Check all sales displayed
2. **Note oldest sale**: Verify 2026-04-01 sale visible
3. **Note newest sale**: Verify 2026-05-07 sale at top
4. **Check sale details**: Open oldest sale, verify all data intact
   - Sale price, platform, postage, profit should all be preserved
5. **Check for data integrity**: No truncation or loss of data
6. **Export if available**: If export feature exists, export Sold History
7. **Verify export**: Check that export includes all historical sales with complete data

#### Expected Results
- ✅ All historical sales visible in Sold History
- ✅ Oldest sale data complete and intact
- ✅ No data loss or truncation
- ✅ Sale details accessible and readable
- ✅ If export exists: Export includes all historical data
- ✅ Archive integrity maintained

#### Verification Points
□ All historical sales accessible  
□ Oldest sales not deleted  
□ Data not truncated  
□ Sale details complete  
□ Export includes all data  

#### Pass Criteria
- [ ] All historical sales visible
- [ ] Data complete for old sales
- [ ] No truncation or loss
- [ ] Oldest sales findable
- [ ] Archive integrity maintained

---

## Section 4: Financial Accuracy (10 Tests)

### TEST-401: Platform Fee Calculation - eBay (12.8% + £0.30)
**Workflow**: Financial Calculation  
**Priority**: 🔴 HIGH  
**Risk Level**: CRITICAL  
**Time**: 10 minutes  
**Status**: Not Started

#### Pre-Conditions
- [ ] Unit with BP=£150 exists and available
- [ ] On Sell Unit form
- [ ] Ready to test eBay fee

#### Test Steps
1. **Select unit**: Choose available unit
2. **Select platform**: Choose "eBay" from platform dropdown
3. **Enter sale price**: £500
4. **Enter postage**: £8
5. **Observe fee calculation**: Check if fee displayed
6. **Calculate expected**: 
   - eBay fee = (£500 × 0.128) + £0.30 = £64 + £0.30 = £64.30
   - Profit = £500 - £150 (BP) - £64.30 (fee) - £8 (postage) = £277.70
7. **Submit sale**: Record sale
8. **Verify in Sold History**: Check profit shows £277.70

#### Expected Results
- ✅ Fee shown as £64.30 (or near calculation, depending on rounding)
- ✅ Profit calculated as £277.70 (or correct rounding)
- ✅ Sale recorded with accurate fee
- ✅ Sold History displays correct profit

#### Verification Points
□ Fee formula correct (12.8% + fixed £0.30)  
□ Percentage applied correctly (12.8% of sale price)  
□ Fixed amount added (£0.30)  
□ Profit calculated with correct fee  
□ Displayed profit matches calculation  

#### Pass Criteria
- [ ] eBay fee calculated as £64.30
- [ ] Profit shows £277.70
- [ ] Formula applied correctly
- [ ] Sale recorded with accurate fee

---

### TEST-402: Platform Fee Calculation - Amazon (8%)
**Workflow**: Financial Calculation  
**Priority**: 🔴 HIGH  
**Risk Level**: CRITICAL  
**Time**: 10 minutes  
**Status**: Not Started

#### Pre-Conditions
- [ ] Unit with BP=£200 exists and available
- [ ] On Sell Unit form

#### Test Steps
1. **Select platform**: Choose "Amazon"
2. **Enter sale price**: £400
3. **Enter postage**: £6
4. **Expected fee**: £400 × 0.08 = £32
5. **Expected profit**: £400 - £200 (BP) - £32 (fee) - £6 (postage) = £162
6. **Submit sale**: Record sale
7. **Verify profit**: Check Sold History shows £162

#### Expected Results
- ✅ Amazon fee calculated as £32 (8%)
- ✅ Profit shown as £162
- ✅ Sale recorded with correct fee

#### Verification Points
□ Amazon fee is 8% (no fixed amount)  
□ Percentage calculated correctly  
□ Profit includes fee deduction  

#### Pass Criteria
- [ ] Amazon fee calculated as £32
- [ ] Profit shows £162
- [ ] 8% formula applied correctly

---

### TEST-403: Platform Fee Calculation - OnBuy (9%)
**Workflow**: Financial Calculation  
**Priority**: 🔴 HIGH  
**Risk Level**: CRITICAL  
**Time**: 10 minutes  
**Status**: Not Started

#### Pre-Conditions
- [ ] Unit with BP=£180 exists and available
- [ ] On Sell Unit form

#### Test Steps
1. **Select platform**: Choose "OnBuy"
2. **Enter sale price**: £450
3. **Enter postage**: £7.50
4. **Expected fee**: £450 × 0.09 = £40.50
5. **Expected profit**: £450 - £180 (BP) - £40.50 (fee) - £7.50 (postage) = £222
6. **Submit sale**: Record sale
7. **Verify profit**: Check Sold History shows £222

#### Expected Results
- ✅ OnBuy fee calculated as £40.50 (9%)
- ✅ Profit shown as £222

#### Verification Points
□ OnBuy fee is 9%  
□ Percentage calculated correctly  

#### Pass Criteria
- [ ] OnBuy fee calculated as £40.50
- [ ] Profit shows £222

---

### TEST-404: Platform Fee Calculation - Backmarket (10%)
**Workflow**: Financial Calculation  
**Priority**: 🔴 HIGH  
**Risk Level**: CRITICAL  
**Time**: 10 minutes  
**Status**: Not Started

#### Pre-Conditions
- [ ] Unit with BP=£250 exists and available
- [ ] On Sell Unit form

#### Test Steps
1. **Select platform**: Choose "Backmarket"
2. **Enter sale price**: £500
3. **Enter postage**: £10
4. **Expected fee**: £500 × 0.10 = £50
5. **Expected profit**: £500 - £250 (BP) - £50 (fee) - £10 (postage) = £190
6. **Submit sale**: Record sale
7. **Verify profit**: Check Sold History shows £190

#### Expected Results
- ✅ Backmarket fee calculated as £50 (10%)
- ✅ Profit shown as £190

#### Verification Points
□ Backmarket fee is 10%  
□ Percentage calculated correctly  

#### Pass Criteria
- [ ] Backmarket fee calculated as £50
- [ ] Profit shows £190

---

### TEST-405: Profit vs Loss Determination - Threshold Testing
**Workflow**: Financial Analysis  
**Priority**: 🟡 MEDIUM  
**Risk Level**: MEDIUM  
**Time**: 12 minutes  
**Status**: Not Started

#### Pre-Conditions
- [ ] Unit with BP=£300 exists

#### Test Steps
1. **Sale 1 - Break even scenario**: 
   - Price=£300, Platform=Amazon (8%), Postage=£0
   - Fee = £300 × 0.08 = £24
   - Profit = £300 - £300 (BP) - £24 (fee) - £0 (postage) = -£24 (LOSS)
2. **Submit and verify**: Check displays red color (loss)
3. **Return and test profit**:
   - Price=£350, Platform=Amazon, Postage=£0
   - Fee = £350 × 0.08 = £28
   - Profit = £350 - £300 (BP) - £28 (fee) - £0 (postage) = £22 (PROFIT)
4. **Submit and verify**: Check displays green color (profit)
5. **Check threshold**: Verify £0 profit shows correctly (neither green nor red, or specifically styled)

#### Expected Results
- ✅ Loss scenario (-£24) displays in RED
- ✅ Profit scenario (£22) displays in GREEN
- ✅ Color coding consistent throughout app
- ✅ Dashboard reflects profit/loss colors

#### Verification Points
□ Profit/loss calculation correct  
□ Color coding accurate (red for negative, green for positive)  
□ Threshold handling correct  
□ Colors consistent across views  

#### Pass Criteria
- [ ] Loss displays in red
- [ ] Profit displays in green
- [ ] Threshold clear
- [ ] Colors consistent

---

### TEST-406: Batch Financial Totals - Multi-Unit Aggregation
**Workflow**: Batch Financial Calculation  
**Priority**: 🟡 MEDIUM  
**Risk Level**: MEDIUM  
**Time**: 15 minutes  
**Status**: Not Started

#### Pre-Conditions
- [ ] Batch with 4 units:
  - Unit 1: BP=£200, Sold at £450 (eBay)
  - Unit 2: BP=£180, Sold at £180 (Amazon) - Loss
  - Unit 3: BP=£250, Available (not sold)
  - Unit 4: BP=£300, Sold at £500 (OnBuy)

#### Test Steps
1. **View batch totals**: Navigate to batch summary
2. **Calculate expected totals**:
   - Total BP (all units): £200 + £180 + £250 + £300 = £930
   - Total SP (sold units): £450 + £180 + £500 = £1130
   - Unit 1 profit: £450 - £200 (BP) - £45.40 (eBay) - £8 (postage) = £196.60
   - Unit 2 loss: £180 - £180 (BP) - £14.40 (Amazon) - £5 (postage) = -£19.40
   - Unit 4 profit: £500 - £300 (BP) - £45 (OnBuy) - £10 (postage) = £145
   - Total profit from sold units: £196.60 - £19.40 + £145 = £322.20
3. **Verify batch totals display**:
   - Batch Total BP: £930
   - Batch Total Revenue: £1130
   - Batch Total Profit: £322.20

#### Expected Results
- ✅ Batch totals calculated accurately
- ✅ BP total: £930
- ✅ Revenue total: £1130
- ✅ Profit total: £322.20
- ✅ Individual unit profits accurate
- ✅ Mix of profit and loss units handled correctly

#### Verification Points
□ Batch aggregation correct  
□ Individual profit/loss per unit accurate  
□ Totals sum correctly  
□ Mix of sold and unsold units handled  
□ No data loss in aggregation  

#### Pass Criteria
- [ ] Batch BP total: £930
- [ ] Revenue total: £1130
- [ ] Profit total: £322.20
- [ ] Individual calculations accurate
- [ ] Totals verified

---

### TEST-407: Financial Accuracy with Postage Variations
**Workflow**: Financial Calculation  
**Priority**: 🟡 MEDIUM  
**Risk Level**: MEDIUM  
**Time**: 12 minutes  
**Status**: Not Started

#### Pre-Conditions
- [ ] Units with BP=£200 exist

#### Test Steps
1. **Sale 1 - Standard postage (£8)**:
   - Price=£400, Platform=eBay, Postage=£8
   - Fee: (£400 × 0.128) + £0.30 = £51.50 + £0.30 = £51.80
   - Profit: £400 - £200 - £51.80 - £8 = £140.20
2. **Sale 2 - High postage (£20)**:
   - Price=£400, Platform=eBay, Postage=£20
   - Fee: £51.80 (same)
   - Profit: £400 - £200 - £51.80 - £20 = £128.20
3. **Sale 3 - Free postage (£0)**:
   - Price=£400, Platform=eBay, Postage=£0
   - Fee: £51.80
   - Profit: £400 - £200 - £51.80 - £0 = £148.20
4. **Verify all three sales**: Check Sold History shows correct profits

#### Expected Results
- ✅ Sale 1 profit: £140.20
- ✅ Sale 2 profit: £128.20 (correctly reduced by additional £20 postage)
- ✅ Sale 3 profit: £148.20 (correctly increased by £0 postage)
- ✅ Postage impact on profit accurate
- ✅ All three profits tracked and visible

#### Verification Points
□ Postage correctly deducted from profit  
□ Variation in postage properly handled  
□ Profit calculations accurate  
□ Postage impact visible in results  

#### Pass Criteria
- [ ] Different postage amounts handled correctly
- [ ] Profit calculations accurate for each
- [ ] Postage deduction verified
- [ ] All three sales recorded correctly

---

### TEST-408: Revenue Totals - Sum of All Sale Prices
**Workflow**: Dashboard Financial Accuracy  
**Priority**: 🔴 HIGH  
**Risk Level**: CRITICAL  
**Time**: 12 minutes  
**Status**: Not Started

#### Pre-Conditions
- [ ] Sold History with multiple sales:
  - Sale 1: Price=£450
  - Sale 2: Price=£180
  - Sale 3: Price=£320
  - Sale 4: Price=£250
- [ ] Dashboard showing total revenue

#### Test Steps
1. **Note dashboard revenue**: Check total revenue displayed
2. **Calculate expected**: £450 + £180 + £320 + £250 = £1200
3. **Verify dashboard total**: Confirm revenue shows £1200
4. **Check individual sales**: Open Sold History to verify each sale price
5. **Create new sale**: Record Sale 5 at Price=£400
6. **Verify updated total**: Revenue should now be £1200 + £400 = £1600
7. **Return one sale**: Process return for Sale 3 (£320)
8. **Verify recalculated**: Revenue should now be £1600 - £320 = £1280

#### Expected Results
- ✅ Initial revenue: £1200 (sum of 4 sales)
- ✅ After new sale: £1600
- ✅ After return: £1280
- ✅ Revenue calculation always accurate
- ✅ Only sale prices counted (not profit/loss)

#### Verification Points
□ Revenue is sum of all sale prices  
□ Not affected by profit/loss  
□ Updated correctly on new sales  
□ Decremented correctly on returns  
□ No rounding errors in total  

#### Pass Criteria
- [ ] Revenue totals £1200 initially
- [ ] Updated to £1600 after new sale
- [ ] Recalculated to £1280 after return
- [ ] All three figures accurate

---

### TEST-409: Profit Loss Breakdown - Dashboard Visualization
**Workflow**: Dashboard Analysis  
**Priority**: 🟡 MEDIUM  
**Risk Level**: MEDIUM  
**Time**: 12 minutes  
**Status**: Not Started

#### Pre-Conditions
- [ ] Sold History with mix of profitable and loss-making sales
- [ ] Dashboard showing profit/loss summary

#### Test Steps
1. **Count profitable sales**: Count how many show green/positive
2. **Count loss sales**: Count how many show red/negative
3. **Calculate total profit**: Sum all positive amounts
4. **Calculate total loss**: Sum all negative amounts (as absolute)
5. **Verify dashboard**: Check if total profit - total loss matches net profit shown on dashboard
6. **Example**:
   - Profitable sales: £100 + £150 + £200 = £450
   - Loss sales: -£30 - £50 = -£80
   - Net: £450 - £80 = £370
7. **Verify dashboard shows £370 net profit**

#### Expected Results
- ✅ Profitable sales correctly identified (green)
- ✅ Loss sales correctly identified (red)
- ✅ Total profit calculated correctly
- ✅ Total loss calculated correctly
- ✅ Net profit/loss accurate
- ✅ Dashboard visualization matches calculations

#### Verification Points
□ Profit/loss identification accurate  
□ Calculations correct  
□ Visualization helpful  
□ Net profit accurate  

#### Pass Criteria
- [ ] Profitable and loss sales identified
- [ ] Totals calculated correctly
- [ ] Net profit accurate (£370)
- [ ] Dashboard shows correct totals

---

### TEST-410: Financial Data Persistence - Across Session
**Workflow**: Data Persistence  
**Priority**: 🟡 MEDIUM  
**Risk Level**: MEDIUM  
**Time**: 15 minutes  
**Status**: Not Started

#### Pre-Conditions
- [ ] Multiple sales recorded with complete financial data
- [ ] Dashboard showing financial totals
- [ ] Ready to close and reopen app

#### Test Steps
1. **Note current state**: Record dashboard totals
   - Revenue: £1500
   - Profit: £400
   - Available: 5
   - Sold: 8
2. **Close app**: Close browser tab or log out
3. **Clear browser cache** (optional test): If testing persistence, clear cache/cookies
4. **Reopen app**: Navigate back to app, log in if required
5. **Check dashboard**: Verify all data still present
6. **Verify totals persist**:
   - Revenue should still be £1500
   - Profit should still be £400
   - Sold count should still be 8
7. **Check Sold History**: Verify all past sales still visible with financial data intact
8. **Verify database**: Check that data persisted (either local storage or cloud)

#### Expected Results
- ✅ All financial data persists after session close
- ✅ Dashboard totals unchanged
- ✅ Sold History complete with all sale details
- ✅ No data loss on reload
- ✅ Financial calculations remain accurate

#### Verification Points
□ Data persists in storage (localStorage or cloud)  
□ Totals accurate after reload  
□ All sales visible  
□ No data corruption  

#### Pass Criteria
- [ ] Dashboard totals persist
- [ ] Revenue: £1500 (unchanged)
- [ ] Profit: £400 (unchanged)
- [ ] Sold History complete
- [ ] No data loss

---

## Test Execution Tracking

| Test ID | Test Name | Status | Time | Notes |
|---------|-----------|--------|------|-------|
| TEST-101 | Invalid IMEI (Empty) | ⬜ | 8 min | |
| TEST-102 | Invalid IMEI (Too Short) | ⬜ | 8 min | |
| TEST-103 | Invalid IMEI (Special Chars) | ⬜ | 8 min | |
| TEST-104 | Duplicate IMEI Detection | ⬜ | 10 min | |
| TEST-105 | Null/Undefined Fields | ⬜ | 10 min | |
| TEST-106 | Batch Import - Invalid CSV | ⬜ | 12 min | |
| TEST-107 | Batch Import - Duplicates | ⬜ | 12 min | |
| TEST-108 | Sale Price Validation | ⬜ | 10 min | |
| TEST-109 | Missing Required Fields | ⬜ | 10 min | |
| TEST-110 | Invalid Return Type | ⬜ | 8 min | |
| TEST-111 | SHS Status Constraints | ⬜ | 10 min | |
| TEST-112 | Unsupported Platform | ⬜ | 8 min | |
| TEST-201 | Multi-Platform Sales | ⬜ | 15 min | |
| TEST-202 | Mixed Status Batch Import | ⬜ | 20 min | |
| TEST-203 | Concurrent Operations | ⬜ | 15 min | |
| TEST-204 | Return Full Data Cleanup | ⬜ | 15 min | |
| TEST-205 | SHS Complete Workflow | ⬜ | 18 min | CRITICAL |
| TEST-206 | Barcode Auto-Population | ⬜ | 12 min | |
| TEST-207 | Batch Category Filter | ⬜ | 15 min | |
| TEST-208 | Dashboard Real-Time Update | ⬜ | 15 min | |
| TEST-209 | Multiple Suppliers Isolation | ⬜ | 12 min | |
| TEST-210 | Edge Case Rounding | ⬜ | 12 min | |
| TEST-301 | Unit Status Integrity | ⬜ | 10 min | |
| TEST-302 | Batch Integrity | ⬜ | 15 min | |
| TEST-303 | Failed Operations Recovery | ⬜ | 15 min | |
| TEST-304 | Inventory Count Accuracy | ⬜ | 20 min | |
| TEST-305 | IMEI Uniqueness | ⬜ | 15 min | CRITICAL |
| TEST-306 | Sale Data Completeness | ⬜ | 12 min | |
| TEST-307 | Dashboard Totals Recalc | ⬜ | 15 min | |
| TEST-308 | Historical Data Preservation | ⬜ | 12 min | |
| TEST-401 | eBay Fee (12.8% + £0.30) | ⬜ | 10 min | CRITICAL |
| TEST-402 | Amazon Fee (8%) | ⬜ | 10 min | CRITICAL |
| TEST-403 | OnBuy Fee (9%) | ⬜ | 10 min | CRITICAL |
| TEST-404 | Backmarket Fee (10%) | ⬜ | 10 min | CRITICAL |
| TEST-405 | Profit vs Loss Determination | ⬜ | 12 min | |
| TEST-406 | Batch Financial Totals | ⬜ | 15 min | |
| TEST-407 | Postage Variations | ⬜ | 12 min | |
| TEST-408 | Revenue Totals | ⬜ | 12 min | |
| TEST-409 | Profit/Loss Breakdown | ⬜ | 12 min | |
| TEST-410 | Financial Persistence | ⬜ | 15 min | |

---

**Phase 1 Total**: 40 tests, ~8 hours testing time  
**Critical Tests**: TEST-205 (SHS IMEI), TEST-305 (IMEI uniqueness), TEST-401-404 (Platform fees)  
**All tests must pass before proceeding to Phase 2**

---

**Last Updated**: 2026-05-07  
**Status**: Ready for QA Execution
