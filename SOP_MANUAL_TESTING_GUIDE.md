# SOP: Manual Testing Guide - InventoryManager
**Version**: 1.0  
**Last Updated**: May 2026  
**Test Framework**: Vitest + React Testing Library  
**Coverage Target**: 80%+ for critical paths

---

## Table of Contents
1. [Testing Overview](#testing-overview)
2. [P0 Critical Components - Manual Testing](#p0-critical-components---manual-testing)
3. [P1 High Priority Components - Manual Testing](#p1-high-priority-components---manual-testing)
4. [P2 Medium Priority Components - Manual Testing](#p2-medium-priority-components---manual-testing)
5. [P3 Low Priority Components - Manual Testing](#p3-low-priority-components---manual-testing)
6. [Test Execution Checklist](#test-execution-checklist)
7. [Bug Reporting Template](#bug-reporting-template)

---

## Testing Overview

### Test Execution Environment
- **Browser**: Chrome/Firefox (latest)
- **Screen Sizes**: Desktop (1920x1080), Tablet (768x1024), Mobile (375x667)
- **Network**: Test both online and offline scenarios
- **Browser Console**: Check for errors/warnings before each test

### Pre-Test Checklist
- [ ] Clear browser cache
- [ ] Check internet connection
- [ ] Ensure mock data is loaded
- [ ] Verify all UI elements are visible
- [ ] Check browser console for errors
- [ ] Note timestamp before starting tests

---

## P0 Critical Components - Manual Testing

### 1. SellPage.tsx - Sale Transaction Workflow (36 tests)

#### Test Group 1: Available Stock Display
**Location**: Sell Page → Available Stock Section

**Test 1.1: Display In-Stock Units**
1. Navigate to **SELL** page
2. Scroll to **"Available Stock"** section
3. Verify:
   - [ ] Units display with model name (e.g., "iPhone 15 Pro")
   - [ ] Display shows IMEI (truncated to 10 digits)
   - [ ] Colour is shown (e.g., "Black")
   - [ ] Storage is displayed (e.g., "128GB")
   - [ ] Buy price is visible (e.g., "£450")

**Test 1.2: Search Stock by Model**
1. Click search field in Available Stock section
2. Type "iPhone"
3. Verify:
   - [ ] Only iPhone models display
   - [ ] Samsung/other brands filter out
   - [ ] Real-time filtering works
   - [ ] Clear button (X) appears

**Test 1.3: Search by IMEI**
1. Click search field
2. Type first 6 digits of IMEI: "359108"
3. Verify:
   - [ ] Matching unit displays
   - [ ] Non-matching units hide
   - [ ] Search is case-insensitive

**Test 1.4: Filter by Colour**
1. Type "Black" in search
2. Verify:
   - [ ] Only black units show
3. Clear search
4. Type "Blue"
5. Verify:
   - [ ] Only blue units show

#### Test Group 2: Sale Transaction - Profit/Loss Calculation
**Location**: Sell Page → Available Stock → Click "Sell" Button

**Test 2.1: Open Sell Modal**
1. In Available Stock, click "Sell" button on any unit
2. Verify modal opens with:
   - [ ] Unit model displayed in header
   - [ ] IMEI shown
   - [ ] Colour and storage shown
   - [ ] Buy price visible (e.g., "BP £450")

**Test 2.2: Platform Selection**
1. In Sell modal, observe platform buttons (eBay, Amazon, OnBuy, Backmarket)
2. Click each platform and verify:
   - **eBay**: [ ] Button highlights, [ ] Commission shows "12.8% +£0.30"
   - **Amazon**: [ ] Button highlights, [ ] Commission shows "8%"
   - **OnBuy**: [ ] Button highlights, [ ] Commission shows "9%"
   - **Backmarket**: [ ] Button highlights, [ ] Commission shows "10%"

**Test 2.3: Enter Selling Price**
1. Enter selling price: "520"
2. Verify:
   - [ ] Live profit/loss calculation appears
   - [ ] Calculation breakdown shows:
     - Sold For: £520
     - Bought For: £450
     - eBay Fee: -£64.30 (for eBay)
     - Postage: -£3.50
     - Net Profit: Shows calculated value

**Test 2.4: Profit Calculation Accuracy - eBay Example**
1. Select **eBay** platform
2. Set sale price to "520"
3. Verify calculation:
   - [ ] Fee = 520 × 0.128 + 0.30 = £67.36
   - [ ] Postage (default) = £3.50
   - [ ] Net Profit = 520 - 450 - 67.36 - 3.50 = -£0.86
   - [ ] Display shows "-£0.86" in red (loss indicator)

**Test 2.5: Loss Sale Identification**
1. Select **eBay**
2. Set sale price: "350" (below buy price)
3. Verify:
   - [ ] Profit section shows RED background
   - [ ] Amount displays in RED
   - [ ] Shows "-£148.60" (loss amount)

**Test 2.6: Profitable Sale Identification**
1. Select **Amazon**
2. Set sale price: "600" (well above buy price)
3. Verify:
   - [ ] Profit section shows GREEN background
   - [ ] Amount displays in GREEN
   - [ ] Shows "+£81.20" (profit amount)

#### Test Group 3: Platform Fee Calculations
**Location**: Sell Modal → Platform Selection

**Test 3.1: eBay Fee Calculation (12.8% + £0.30)**
1. Select **eBay**, Enter sale price: "500"
2. Verify fee display: "-£64.30" ([500 × 0.128] + 0.30 = 64.30)
3. Test multiple prices:
   - Price "200" → Fee "-£26.90" ✓
   - Price "1000" → Fee "-£128.30" ✓

**Test 3.2: Amazon Fee Calculation (8%)**
1. Select **Amazon**, Enter sale price: "500"
2. Verify fee display: "-£40.00" (500 × 0.08 = 40)
3. Test edge cases:
   - Price "100" → Fee "-£8.00" ✓
   - Price "999" → Fee "-£79.92" ✓

**Test 3.3: OnBuy Fee Calculation (9%)**
1. Select **OnBuy**, Enter sale price: "500"
2. Verify fee display: "-£45.00" (500 × 0.09 = 45)

**Test 3.4: Backmarket Fee Calculation (10%)**
1. Select **Backmarket**, Enter sale price: "500"
2. Verify fee display: "-£50.00" (500 × 0.10 = 50)

#### Test Group 4: Sold History Display
**Location**: Sell Page → Sold History Section

**Test 4.1: Display Sold Units**
1. Scroll to **"Sold History"** section
2. Verify for each sold unit:
   - [ ] Model name displayed
   - [ ] IMEI truncated to 10 digits with copy button
   - [ ] Platform badge shown (eBay, Amazon, etc.)
   - [ ] Order ID displayed
   - [ ] Sale price in green (£...)

**Test 4.2: Sold History Financial Breakdown (NEW)**
1. In Sold History, look for detail line below each unit
2. Verify all columns display:
   - [ ] **Buy Price**: Shows £450 (original purchase)
   - [ ] **Fee**: Shows "-£126.38 (12.8%)" with percentage
   - [ ] **Postage**: Shows "-£3.50" (shipping cost)
   - [ ] **Profit**: Shows final profit/loss amount
     - GREEN text if profit ("+£220.14")
     - RED text if loss ("-£70.54")

**Test 4.3: Verify Correct Financial Calculation in History**
1. Find a sold unit with loss (e.g., selling price lower than buy price)
2. Check detail line:
   - [ ] Profit shows in RED
   - [ ] Amount is negative (starts with -)
   - [ ] Format: "-£70.54"

**Test 4.4: Group Sold Units by Date**
1. In Sold History, verify units are grouped:
   - [ ] Date header shows "Today", "Yesterday", or date (e.g., "TUE, 19 MAY 2026")
   - [ ] Count shows units per day (e.g., "1 unit", "5 units")
   - [ ] Total revenue per day shown (green text)

#### Test Group 5: IMEI Validation
**Location**: Sell Modal → Manual IMEI Entry or Enter IMEI Modal

**Test 5.1: IMEI Length Validation**
1. In Enter IMEI modal, try entering:
   - "35910809672" (11 digits) → [ ] Shows error: "need X more digits"
   - "359108096724237" (15 digits) → [ ] Accepts ✓
   - "35910809672423" (14 digits) → [ ] Accepts ✓

**Test 5.2: Non-Numeric IMEI (Alphanumeric Serial)**
1. Enter: "ABC123DEF456" (12 alphanumeric chars)
2. Verify:
   - [ ] System recognizes as serial number
   - [ ] Shows: "Serial: ABC123DEF456 ✓"
   - [ ] Allows save

**Test 5.3: Duplicate IMEI Detection**
1. Enter an IMEI that exists in database
2. Click "Save IMEI"
3. Verify error: [ ] "359108096724237 is already in stock as a different unit"

#### Test Group 6: SHS (Supplier Direct) Units
**Location**: Sell Page → SHS Section (top of page)

**Test 6.1: Display SHS Units**
1. If SHS units exist, they appear in dedicated section
2. Verify:
   - [ ] Section header: "SHS — Supplier Direct"
   - [ ] Count badge shows number of units
   - [ ] Units list shows model, colour, BP, supplier
   - [ ] "Record Sale" button visible for each

**Test 6.2: Record SHS Sale**
1. Click "Record Sale" on any SHS unit
2. In modal, verify:
   - [ ] Header shows "Supplier Direct Sale"
   - [ ] Truck icon displayed
   - [ ] IMEI field shows (optional for SHS)
   - [ ] Text: "Optional now, enter after supplier dispatches"

**Test 6.3: Optional IMEI for SHS**
1. In SHS sale modal, leave IMEI blank
2. Enter selling price: "500"
3. Select platform and order number
4. Click "Confirm Sale"
5. Verify:
   - [ ] Sale saves without IMEI
   - [ ] Unit moves to "Awaiting IMEI" section
   - [ ] Message: "No IMEI — unit will appear in Awaiting IMEI"

---

### 2. NewBatchModal.tsx - Batch Creation (34 tests)

#### Test Group 1: Batch Header Fields
**Location**: Stock In Page → Click "+" or "Stock In" → New Batch Modal

**Test 1.1: Set Batch Date**
1. Open New Batch Modal
2. In "Date" field, set to "2026-04-15"
3. Verify:
   - [ ] Date picker shows calendar
   - [ ] Selected date saves
   - [ ] Defaults to today's date

**Test 1.2: Enter Invoice Number**
1. In "Invoice #" field, type: "INV-2061"
2. Verify:
   - [ ] Text saves as entered
   - [ ] Field is optional (greyed out label)
   - [ ] Placeholder shows example format

#### Test Group 2: IMEI Validation
**Location**: New Batch Modal → Model/IMEI Rows

**Test 2.1: Accept 14-Digit IMEI**
1. In first row, enter:
   - Model: "iPhone 14 128GB"
   - IMEI: "35910809672423" (14 digits)
2. Verify:
   - [ ] IMEI field highlights in green
   - [ ] No error shown
   - [ ] Can proceed to save

**Test 2.2: Accept 15-Digit IMEI**
1. Enter IMEI: "359108096724237" (15 digits)
2. Verify:
   - [ ] Field shows green
   - [ ] No validation error
   - [ ] Ready to save

**Test 2.3: Reject 13-Digit IMEI**
1. Try entering: "3591080967242" (13 digits)
2. Click "Save" button
3. Verify error:
   - [ ] Message: "IMEI must be 14-15 digits"
   - [ ] Unit cannot be saved
   - [ ] Field highlights in red

**Test 2.4: Filter Non-Numeric Characters**
1. Type in IMEI field: "3591-080A9B-724237"
2. Verify:
   - [ ] Only numeric characters stored
   - [ ] Displays: "359108096724237"
   - [ ] A, B characters removed

**Test 2.5: Detect Duplicate IMEI in Database**
1. Enter an IMEI that exists in system
2. Complete other fields
3. Click "Save X Units to Stock"
4. Verify error:
   - [ ] Message: "IMEI 359108096724237 already exists in stock"
   - [ ] Batch not saved
   - [ ] Error highlighted in red

**Test 2.6: Detect Duplicate Within Batch**
1. Row 1: Model "iPhone 14", IMEI "359108096724237"
2. Row 2: Model "Samsung Galaxy", IMEI "359108096724237" (same)
3. Click "Save"
4. Verify error:
   - [ ] Message: "Duplicate IMEIs within this batch"
   - [ ] Batch fails to save

#### Test Group 3: Batch Creation & Saving
**Location**: New Batch Modal → Save Section

**Test 3.1: Save Single Unit**
1. Fill row 1:
   - Model: "iPhone 15 Pro 128GB"
   - IMEI: "359108096724237"
   - Buy Price: "450"
   - Colour: "Black"
   - Supplier: "MHL"
2. Click "Save 1 Unit to Stock"
3. Verify:
   - [ ] Modal closes
   - [ ] Success message appears
   - [ ] Unit appears in Inventory

**Test 3.2: Save Multiple Units in Batch**
1. Row 1: iPhone 15 (IMEI: 359108..., BP: 450)
2. Click "Add Unit"
3. Row 2: Samsung Galaxy (IMEI: 350220..., BP: 300)
4. Click "Save 2 Units to Stock"
5. Verify:
   - [ ] Both units save
   - [ ] Batch ID assigned to both
   - [ ] Units appear with same batch label

**Test 3.3: Unit Status on Save**
1. Add 1 regular unit (not SHS)
2. Save
3. Check unit in Inventory
4. Verify status:
   - [ ] Status = "available" (can be sold immediately)

#### Test Group 4: SHS (Expected Stock)
**Location**: New Batch Modal → SHS Toggle

**Test 4.1: Add SHS Unit**
1. In row 1, toggle "SHS" switch to ON
2. Verify:
   - [ ] Switch highlights blue
   - [ ] IMEI field disappears
   - [ ] Shows: "No IMEI — expected stock"

**Test 4.2: SHS Status on Save**
1. Add SHS unit, set BP: "60"
2. Save batch
3. Check unit status
4. Verify:
   - [ ] Status = "incoming" (awaiting delivery from supplier)
   - [ ] Batch marked: "1 SHS expected"

#### Test Group 5: CSV Paste Import
**Location**: New Batch Modal → "Paste CSV" Button

**Test 5.1: Open CSV Import Dialog**
1. Click "Paste CSV" button
2. Verify modal opens with:
   - [ ] Title: "Paste from Spreadsheet"
   - [ ] Format guide shown
   - [ ] Large textarea for input
   - [ ] Example rows visible

**Test 5.2: Paste Valid CSV**
1. Copy from spreadsheet:
   ```
   Apple iPhone 14 128GB, 359108096724237, 250, Black, MHL,
   Samsung Galaxy S21 128GB, 350220437101229, 120, Grey, NIHAL,
   ```
2. Paste into textarea
3. Click "Import 2 Rows"
4. Verify:
   - [ ] Dialog closes
   - [ ] 2 new rows added to batch
   - [ ] Data correctly parsed:
     - Model: "Apple iPhone 14 128GB"
     - IMEI: "359108096724237"
     - BP: "250"
     - Colour: "Black"
     - Supplier: "MHL"

**Test 5.3: Handle Invalid CSV**
1. Try pasting: "Invalid, format, data,"
2. Verify:
   - [ ] Shows "0 Rows" in import button
   - [ ] Button disabled or grayed out
   - [ ] No rows added on click

#### Test Group 6: Totals & Summary
**Location**: New Batch Modal → Bottom Section

**Test 6.1: Calculate Unit Totals**
1. Add:
   - Row 1: iPhone (BP: 450)
   - Row 2: Samsung (BP: 300)
2. Look at footer
3. Verify shows:
   - [ ] "2 units"
   - [ ] "£750" (total BP value)

**Test 6.2: Show SHS Count**
1. Add 2 regular units
2. Add 1 SHS unit
3. Verify footer shows:
   - [ ] "2 units"
   - [ ] "+1 SHS expected" (blue badge)
   - [ ] "£X" (only regular unit BP)

---

### 3. ScanInModal.tsx - Barcode Scanning (31 tests)

#### Test Group 1: Scan Entry
**Location**: Stock In Page → "Add Single Unit" or Scan Modal

**Test 1.1: Manual IMEI Entry**
1. Open Scan Modal
2. In manual entry field, type: "359108096724237"
3. Click "Next"
4. Verify:
   - [ ] Modal moves to form stage
   - [ ] IMEI displays in header
   - [ ] Shows: "IMEI: 359108096724237"

**Test 1.2: Validate 14-Digit IMEI**
1. Type: "35910809672423" (14 digits)
2. Verify:
   - [ ] "Next" button enables (not grayed out)
   - [ ] Shows "14 digits ✓"

**Test 1.3: Validate 15-Digit IMEI**
1. Type: "359108096724237" (15 digits)
2. Verify:
   - [ ] Button enabled
   - [ ] Shows "15 digits ✓"

**Test 1.4: Reject Insufficient Digits**
1. Type: "35910809672" (11 digits)
2. Verify:
   - [ ] "Next" button disabled
   - [ ] Shows: "need 3 more"
   - [ ] Cannot proceed

**Test 1.5: Filter Non-Numeric Characters**
1. Type: "3591-0809B-672423-7"
2. Field shows: "359108096724237" (only digits)
3. Verify:
   - [ ] Non-numeric filtered automatically
   - [ ] No manual deletion needed

#### Test Group 2: Barcode Parsing (Auto-Population)
**Location**: Scan Modal → Form Stage

**Test 2.1: Extract Model from Barcode**
1. Type barcode label text: "SAMSUNG S21 FE 5G Grade A Memory 128GB 359108096724237"
2. Click "Next"
3. Verify form pre-filled:
   - [ ] Model: "SAMSUNG S21 FE 5G" (or similar)
   - [ ] Grade: "A" (selected)
   - [ ] Storage: "128GB"
   - [ ] IMEI: "359108096724237"

**Test 2.2: Extract Grade**
1. Barcode with "Grade B":
   - Barcode text: "iPhone 15 Grade B Memory 256GB 359108096724237"
2. Parse and verify:
   - [ ] Grade button "B" highlighted
   - [ ] Other grades not selected

**Test 2.3: Extract Storage**
1. Barcode: "iPad Pro Memory 512GB 359108096724237"
2. Verify storage field shows:
   - [ ] "512GB" auto-filled

**Test 2.4: Handle Incomplete Barcode**
1. Just IMEI: "359108096724237"
2. Parse
3. Verify:
   - [ ] IMEI fills
   - [ ] Model/Grade/Storage blank (must enter manually)

#### Test Group 3: Unit Form Completion
**Location**: Scan Modal → Form Stage

**Test 3.1: Enter Model (Required)**
1. Clear model field
2. Try to save
3. Verify:
   - [ ] Error: "Model is required"
   - [ ] Cannot save

**Test 3.2: Select Colour (Required)**
1. Click colour button, e.g., "Black"
2. Verify:
   - [ ] Button highlights black background/white text
   - [ ] Selection persists

**Test 3.3: Enter Buy Price (Required)**
1. Enter: "450"
2. Verify:
   - [ ] Number field accepts decimal (450.99)
   - [ ] Validates as currency

**Test 3.4: Enter Storage (Optional)**
1. Leave blank → [ ] Saves successfully
2. Enter "256GB" → [ ] Shows "256GB"

**Test 3.5: Select Grade**
1. Available options: A, B, C, Refurbished, Unknown
2. Click "A" → [ ] Highlights
3. Click "Refurbished" → [ ] Switches selection
4. Verify only ONE selected at a time

**Test 3.6: Enter Supplier (Optional)**
1. Type: "MHL"
2. Verify:
   - [ ] Autocomplete shows "MHL"
   - [ ] Can select from known suppliers
   - [ ] Can enter new supplier name

**Test 3.7: Add Notes (Optional)**
1. Type: "Box included, charger included"
2. Verify:
   - [ ] Accepts free-text entry
   - [ ] Saves with unit

#### Test Group 4: Unit Saving
**Location**: Scan Modal → Form → Save Button

**Test 4.1: Save Complete Unit**
1. Fill all required fields:
   - Model: "iPhone 15 Pro"
   - IMEI: "359108096724237"
   - BP: "450"
   - Colour: "Black"
2. Click "Save to Stock"
3. Verify:
   - [ ] Modal shows "Saved!" with checkmark
   - [ ] Unit appears in Inventory
   - [ ] Status = "available"

**Test 4.2: Trigger New Stock Notification**
1. Save a unit
2. Check notification toast (top-center)
3. Verify:
   - [ ] Notification shows: "📦 New Stock Added"
   - [ ] Model name displayed
   - [ ] Toast disappears after timeout

**Test 4.3: Detect Duplicate IMEI**
1. Try scanning/entering an IMEI that exists
2. Click "Save"
3. Verify error:
   - [ ] "IMEI 359108096724237 already exists in database"
   - [ ] Unit not saved

**Test 4.4: Reset Form After Save**
1. Save first unit
2. Modal resets for next scan
3. Verify:
   - [ ] All fields cleared
   - [ ] Returns to scan stage
   - [ ] Ready for next unit

---

### 4. ReturnsPage.tsx - Return Processing (39 tests)

#### Test Group 1: Return Type Selection
**Location**: Returns Page → Process Return Modal

**Test 1.1: Display Return Options**
1. Click on any sold unit to process return
2. Modal opens showing 3 options:
   - [ ] Back to Inventory (emerald button)
   - [ ] Return to Supplier (orange button)
   - [ ] Send for Repair (blue button)

**Test 1.2: Select "Back to Inventory"**
1. Click "Back to Inventory" button
2. Verify:
   - [ ] Button highlights with checkmark
   - [ ] Description shows: "Unit is resaleable — restore to available stock"
   - [ ] Warning message shows: "restored to available stock and sale data cleared"

**Test 1.3: Select "Return to Supplier"**
1. Click "Return to Supplier"
2. Verify:
   - [ ] Button highlights
   - [ ] Description: "Send back to supplier — unit will be removed from stock"
   - [ ] WARNING message: "Unit will be PERMANENTLY DELETED from inventory"

**Test 1.4: Select "Send for Repair"**
1. Click "Send for Repair"
2. Verify:
   - [ ] Button highlights
   - [ ] Description: "Unit needs repair before resale"

#### Test Group 2: Warranty Status Display
**Location**: Returns Modal → Warranty Alert Box

**Test 2.1: Active Warranty Display**
1. Open return modal for recently sold unit
2. Verify warranty box shows:
   - [ ] Green background (emerald)
   - [ ] Checkmark icon
   - [ ] "Warranty Active"
   - [ ] "X days remaining (Expires DATE)"

**Test 2.2: Expired Warranty Display**
1. Open return for old sold unit (>30 days)
2. Verify warranty box shows:
   - [ ] Red background
   - [ ] Warning icon
   - [ ] "Warranty Expired"
   - [ ] "X days ago"

#### Test Group 3: Return Processing
**Location**: Returns Modal → Return Reason Field

**Test 3.1: Require Return Reason**
1. Select return type
2. Don't enter reason
3. Click "Confirm Return"
4. Verify:
   - [ ] Button disabled (grayed out)
   - [ ] Error: "Please enter a return reason"

**Test 3.2: Accept Return Reason**
1. Enter reason: "Customer changed mind"
2. Click button
3. Verify:
   - [ ] Button enables
   - [ ] Can proceed

**Test 3.3: Process "Back to Inventory" Return**
1. Select "Back to Inventory"
2. Enter reason: "Never opened, wrong color ordered"
3. Click "Confirm Return"
4. Verify:
   - [ ] Modal closes
   - [ ] Success message appears
   - [ ] Unit moves to "Back to Inventory" tab
   - [ ] Unit status = "available"
   - [ ] Sale data cleared

**Test 3.4: Process "Return to Supplier" Return**
1. Select "Return to Supplier"
2. Enter reason: "Faulty screen"
3. Click "Confirm Return"
4. Verify:
   - [ ] Modal closes
   - [ ] Unit REMOVED from inventory
   - [ ] No longer appears anywhere
   - [ ] Notification shown

**Test 3.5: Process "Repair" Return**
1. Select "Send for Repair"
2. Enter reason: "Screen replacement needed"
3. Click "Confirm Return"
4. Verify:
   - [ ] Unit moves to "Repair" tab
   - [ ] Unit status = "returned"
   - [ ] Return type = "repair"

#### Test Group 4: Return Filtering & Search
**Location**: Returns Page → Filter Tabs

**Test 4.1: View All Returns**
1. Click "All Returns" tab
2. Verify:
   - [ ] Shows all returned units
   - [ ] Count badge shows total
   - [ ] Mix of inventory, supplier, repair units

**Test 4.2: Filter by Back to Inventory**
1. Click "Back to Inventory" tab
2. Verify:
   - [ ] Shows only inventory returns
   - [ ] Count matches inventory returns
   - [ ] Others hidden

**Test 4.3: Filter by Repair**
1. Click "Repair" tab
2. Verify:
   - [ ] Shows only repair units
   - [ ] Blue styling consistent
   - [ ] Wrench icon shown

**Test 4.4: Filter by Supplier Returns**
1. Click "To Supplier" tab
2. Verify:
   - [ ] Shows supplier returns (should be none if working correctly)
   - [ ] Orange styling

**Test 4.5: Search Returns by Model**
1. Type in search: "iPhone"
2. Verify:
   - [ ] Only iPhones show
   - [ ] Samsung/other hidden

**Test 4.6: Search by Return Reason**
1. Type in search: "Customer"
2. Verify:
   - [ ] Shows returns with "Customer changed mind"
   - [ ] Other reasons filtered

#### Test Group 5: Return Counts & Summary
**Location**: Returns Page → Summary Cards

**Test 5.1: Total Returns Card**
1. Verify card shows:
   - [ ] "Total Returns" label
   - [ ] Numeric count
   - [ ] Grey styling

**Test 5.2: To Inventory Card**
1. Verify shows:
   - [ ] Count of inventory returns
   - [ ] Green styling
   - [ ] Package icon

**Test 5.3: Repair Card**
1. Verify shows:
   - [ ] Count of repair units
   - [ ] Blue styling
   - [ ] Wrench icon

**Test 5.4: To Supplier Card**
1. Verify shows:
   - [ ] Count (should be 0 if deletes work)
   - [ ] Orange styling
   - [ ] Arrow icon

---

## P1 High Priority Components - Manual Testing

### 5. Inventory.tsx - Stock Management (23 tests)

#### Test Group 1: Search & Filter
**Location**: Inventory Page

**Test 1.1: Search by Model**
1. Type "iPhone" in search
2. Verify only iPhones display

**Test 1.2: Search by IMEI**
1. Type first 8 digits of IMEI
2. Verify matching unit appears

**Test 1.3: Filter by Category**
1. Open filter panel (click filter icon)
2. Select "iPhone"
3. Verify only iPhones shown

**Test 1.4: Filter by Status**
1. Select status: "available"
2. Verify only available units shown

**Test 1.5: Filter by Supplier**
1. Select supplier: "MHL"
2. Verify only MHL units shown

**Test 1.6: Sort by Newest**
1. Select sort: "Newest First"
2. Verify units ordered by dateIn (newest first)

**Test 1.7: Sort by Highest Value**
1. Select: "Highest Value"
2. Verify units sorted by buyPrice descending

#### Test Group 2: Display & Pagination
**Location**: Inventory Page

**Test 2.1: Display Stock Summary**
1. Verify top shows:
   - [ ] "X available"
   - [ ] "£X total value"
   - [ ] "X total units"

**Test 2.2: Change Page Size**
1. Select "50 / page"
2. Verify 50 units per page (or fewer if less than 50 total)

**Test 2.3: Pagination Controls**
1. See "pg 1/2" if multiple pages
2. Navigate to page 2
3. Verify page updates

---

## P2 Medium Priority Components - Manual Testing

### 6. NotificationToast.tsx (P2)

#### Test 1: Display Notifications
1. Perform action that triggers notification (sell, return, etc.)
2. Verify toast appears at bottom-right (or top-center)
3. Verify displays:
   - [ ] Icon (shopping bag for sold)
   - [ ] Title ("✅ Unit Sold!")
   - [ ] Model name
   - [ ] Profit/loss amount
   - [ ] Dismiss button (X)

#### Test 2: Notification Types
Test each type appears with correct styling:
- **Sold** (green): ✓ Profit: amount
- **Loss** (red): ⚠ Loss: amount
- **New Stock** (blue): 📦 badge
- **Return** (amber): ↩️ badge
- **SHS** (purple): 🚚 badge

#### Test 3: Dismiss
1. Click X button
2. Verify notification closes
3. Unit marked as read

#### Test 4: Multiple Notifications
1. Generate multiple notifications
2. Verify all display in stack
3. Limited to 10 visible max

---

### 7. CollapsibleSection.tsx (P2)

#### Test 1: Toggle Open/Close
1. Click section header
2. Verify content expands
3. Click again
4. Verify content collapses

#### Test 2: Default Open
1. Some sections open by default
2. Verify content visible on load

#### Test 3: Accent Colors
1. Verify left border color matches accent prop
2. Check different colors display correctly

---

## P3 Low Priority Components - Manual Testing

### 8. CopyImei.tsx (P3)

#### Test 1: Display IMEI
1. Verify IMEI shows with truncation (first 10 digits + "...")
2. Full IMEI available on hover/click

#### Test 2: Copy to Clipboard
1. Click copy button
2. Paste somewhere (text editor)
3. Verify full IMEI pastes correctly

#### Test 3: Visual Feedback
1. After copying, button shows checkmark or success color
2. Feedback disappears after 2 seconds

---

### 9. ErrorBoundary.tsx (P3)

#### Test 1: Catch Errors
1. Trigger JavaScript error in child component
2. Verify error boundary catches it
3. Shows fallback UI (not blank screen)

#### Test 2: Error Message
1. Verify user-friendly error message shown
2. Not technical error details

#### Test 3: Recovery
1. Navigate away and back
2. Verify component recovers and works

---

### 10. Dashboard.tsx (P3)

#### Test 1: Display Metrics
1. Verify shows:
   - [ ] Total inventory value (£X)
   - [ ] Available units count
   - [ ] Total units count

#### Test 2: Oldest Units
1. Verify lists units sorted by dateIn
2. Shows days in inventory
3. Oldest highlighted (red/warning color)

#### Test 3: Quick Actions
1. Verify buttons/links to main pages
2. Sell, Buy, Returns, etc.

---

## Test Execution Checklist

### Pre-Test
- [ ] Clear browser cache
- [ ] Close other tabs
- [ ] Check network is stable
- [ ] Ensure mock data loaded
- [ ] Open browser console (F12)

### During Tests
- [ ] Document any UI inconsistencies
- [ ] Check for console errors
- [ ] Test on mobile view (DevTools)
- [ ] Verify responsive design
- [ ] Test with keyboard navigation

### Post-Test
- [ ] Close modals properly
- [ ] Check database state matches UI
- [ ] Verify no data loss
- [ ] Check notification service still works
- [ ] Close modal windows

### Browser Testing Checklist
- [ ] **Desktop Chrome**: ✓ (1920x1080)
- [ ] **Desktop Firefox**: ✓
- [ ] **Mobile Chrome**: ✓ (375x667)
- [ ] **Tablet**: ✓ (768x1024)
- [ ] **Safari**: ✓ (if available)

---

## Bug Reporting Template

### When you find a bug:

```
COMPONENT: [e.g., SellPage]
TEST CASE: [e.g., Test 2.4: Loss Sale Identification]
SEVERITY: [Critical/High/Medium/Low]

STEPS TO REPRODUCE:
1. [First step]
2. [Second step]
3. [etc.]

EXPECTED RESULT:
[What should happen]

ACTUAL RESULT:
[What actually happens]

SCREENSHOTS:
[If applicable, attach screenshot]

BROWSER: [Chrome/Firefox/Safari]
SCREEN SIZE: [Desktop/Mobile/Tablet]
TIMESTAMP: [When it occurred]

ADDITIONAL NOTES:
[Any other relevant info]
```

---

## Test Pass/Fail Summary Template

| Component | P0/P1/P2/P3 | Tests | Passed | Failed | % Pass |
|-----------|-------------|-------|--------|--------|---------|
| SellPage | P0 | 36 | | | |
| NewBatchModal | P0 | 34 | | | |
| ScanInModal | P0 | 31 | | | |
| ReturnsPage | P0 | 39 | | | |
| notificationService | P0 | 15 | | | |
| Inventory | P1 | 23 | | | |
| NotificationToast | P2 | 29 | | | |
| CollapsibleSection | P2 | [tests] | | | |
| CopyImei | P3 | [tests] | | | |
| ErrorBoundary | P3 | [tests] | | | |
| Dashboard | P3 | [tests] | | | |
| **TOTAL** | | **239** | | | |

---

## Success Criteria

✅ **All P0 tests passing** (Critical components)
✅ **85%+ of P1 tests passing** (High priority)
✅ **80%+ of P2 tests passing** (Medium priority)
✅ **75%+ of P3 tests passing** (Low priority)
✅ **No console errors during testing**
✅ **All notifications trigger correctly**
✅ **Financial calculations verified accurate**
✅ **IMEI validation working reliably**
✅ **Database state consistent with UI**

---

**Last Updated**: May 2026  
**Next Review**: June 2026  
**Owner**: QA Team

