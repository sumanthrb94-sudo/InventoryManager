# SOP-001: Add Batch Stock
## Bulk Import of Inventory Items

**SOP ID:** SOP-001  
**Version:** 1.0  
**Last Updated:** 2026-05-06  
**Duration:** 5-10 minutes per batch  
**Frequency:** Multiple times daily  
**Difficulty Level:** ⭐⭐ (Beginner-Intermediate)

---

## 📌 Purpose

Import multiple inventory items into the system at once using a batch file. This is the primary method for loading stock when items arrive from suppliers or warehouses.

**When to Use:**
- Warehouse receives new stock shipment
- Multiple items need to be added simultaneously
- Daily stock replenishment
- Recovering from system backup

**Expected Outcome:**
- All items added to inventory with status "AVAILABLE"
- Unit counts updated
- Ready for listing on e-commerce platforms

---

## 📋 Prerequisites

✅ Access to InventoryManager dashboard  
✅ Batch file ready (CSV or Excel format)  
✅ All items validated and inspected physically  
✅ Supplier/warehouse information documented  
✅ User role: Inventory Manager or Admin  

---

## 🔄 Step-by-Step Procedure

### STEP 1: Prepare Batch File

**File Format:** CSV or Excel (.csv, .xlsx)

**Required Columns:**
```
Unit ID | Product Name | Brand | Model | Buy Price | Supplier | Status
```

**Example Data:**
```
UNIT-001 | iPhone 13 | Apple | 128GB Black | £400 | Supplier A | AVAILABLE
UNIT-002 | iPhone 13 | Apple | 256GB White | £450 | Supplier B | AVAILABLE
UNIT-003 | Samsung S21 | Samsung | 128GB Grey | £350 | Supplier A | AVAILABLE
UNIT-004 | Galaxy Tab | Samsung | 64GB Blue | £200 | Supplier C | AVAILABLE
```

**Data Validation Checklist:**
- [ ] All Unit IDs are unique
- [ ] Product names are spelled correctly
- [ ] Brand names match system database
- [ ] Buy prices are in pounds (£) format
- [ ] All suppliers are registered in system
- [ ] Status is set to "AVAILABLE"
- [ ] No duplicate entries
- [ ] File size under 10MB

---

### STEP 2: Access the Dashboard

1. **Open InventoryManager** in your web browser
   - URL: `https://inventory.company.com`

2. **Login** with your credentials
   - Username: Your email address
   - Password: Your secure password

3. **Navigate to Import Section**
   - Click menu: **Inventory** → **Stock Management** → **Batch Import**
   - OR click the **"Sample Data"** button on home dashboard

---

### STEP 3: Upload Batch File

**Visual Guide:**

```
┌──────────────────────────────────┐
│     BATCH IMPORT DIALOG          │
├──────────────────────────────────┤
│                                  │
│  📁 Select File to Import        │
│  ┌──────────────────────────────┐│
│  │ [Choose File] [Browse...]    ││
│  └──────────────────────────────┘│
│                                  │
│  📊 Preview                      │
│  ┌──────────────────────────────┐│
│  │ 4 items ready to import      ││
│  │ ✅ UNIT-001: iPhone 13      ││
│  │ ✅ UNIT-002: iPhone 13      ││
│  │ ✅ UNIT-003: Samsung S21    ││
│  │ ✅ UNIT-004: Galaxy Tab     ││
│  └──────────────────────────────┘│
│                                  │
│  ⚠️ Warnings: None              │
│                                  │
│  [Cancel]  [Import]             │
└──────────────────────────────────┘
```

**Instructions:**

1. Click the **"Choose File"** button
2. Select your prepared batch file from your computer
3. System will validate the file automatically
4. Review the preview:
   - Green checkmarks ✅ = Valid entries
   - Red X marks ❌ = Invalid entries (review before importing)
5. If warnings appear:
   - Read the warning message
   - Correct the issue in your file
   - Re-upload the corrected file
6. Click **"Import"** button to proceed

---

### STEP 4: Verify Batch Import

**After clicking Import:**

```
┌──────────────────────────────────┐
│    IMPORT IN PROGRESS            │
├──────────────────────────────────┤
│                                  │
│  Processing: 4/4 items          │
│  ████████████████░░░░░ 75%      │
│                                  │
│  ✅ UNIT-001: Imported          │
│  ✅ UNIT-002: Imported          │
│  ✅ UNIT-003: Imported          │
│  ⏳ UNIT-004: Importing...      │
│                                  │
│  Estimated time: 10 seconds     │
└──────────────────────────────────┘
```

**Do NOT close the browser during import!**

---

### STEP 5: Confirm Success

**Success Screen:**

```
┌──────────────────────────────────┐
│  ✅ IMPORT SUCCESSFUL            │
├──────────────────────────────────┤
│                                  │
│  4 items imported successfully  │
│                                  │
│  Summary:                        │
│  • Total Units Added: 4         │
│  • Total Value: £1,400.00       │
│  • Average Buy Price: £350.00   │
│                                  │
│  Status Breakdown:              │
│  • AVAILABLE: 4 units           │
│  • INCOMING: 0 units            │
│  • SOLD: 0 units                │
│                                  │
│  [View Import Report]           │
│  [Add More Items]               │
│  [Back to Inventory]            │
└──────────────────────────────────┘
```

**Verify the following:**
- [ ] All items show as "Imported" with ✅
- [ ] Total count matches expected quantity
- [ ] Total value is correct
- [ ] All statuses are "AVAILABLE"

---

### STEP 6: View Imported Items

1. Click **"Back to Inventory"** button
2. Navigate to **Stock Dashboard**
3. Verify all items appear in the list:
   - Filter by Status: "AVAILABLE"
   - Search by Unit ID or Product Name
   - Check Buy Price values

**Inventory View Example:**

```
┌──────────────────────────────────────────────────────────┐
│ INVENTORY STOCK LIST                                     │
├──────────────────────────────────────────────────────────┤
│                                                          │
│ [Status Filter: AVAILABLE▼] [Search: ___________]      │
│                                                          │
│ Unit ID  | Product      | Brand    | Buy Price | Status│
├──────────────────────────────────────────────────────────┤
│ UNIT-001 | iPhone 13    | Apple    | £400.00   | ✅    │
│ UNIT-002 | iPhone 13    | Apple    | £450.00   | ✅    │
│ UNIT-003 | Samsung S21  | Samsung  | £350.00   | ✅    │
│ UNIT-004 | Galaxy Tab   | Samsung  | £200.00   | ✅    │
└──────────────────────────────────────────────────────────┘
```

---

## ⚠️ Common Issues & Troubleshooting

### Issue 1: "Duplicate Unit ID"
**Symptom:** Error message appears: "Unit ID already exists"  
**Cause:** One or more Unit IDs are already in the system  
**Solution:**
1. Generate new unique Unit IDs
2. Check existing inventory for similar items
3. Contact Inventory Manager if unsure
4. Re-upload corrected file

### Issue 2: "Invalid File Format"
**Symptom:** System cannot read your file  
**Cause:** File is in wrong format (PDF, Word, etc.)  
**Solution:**
1. Ensure file is .csv or .xlsx format
2. Save file in correct format
3. Re-upload the file

### Issue 3: "Missing Required Field"
**Symptom:** Error: "Column 'Product Name' is missing"  
**Cause:** CSV file missing required column headers  
**Solution:**
1. Add missing column to your file
2. Ensure headers match exactly:
   - Unit ID
   - Product Name
   - Brand
   - Model
   - Buy Price
   - Supplier
   - Status
3. Re-upload corrected file

### Issue 4: "Invalid Price Format"
**Symptom:** Error: "UNIT-001 has invalid price"  
**Cause:** Price not in correct format (e.g., £400.50 vs 400.50)  
**Solution:**
1. Ensure all prices include £ symbol
2. Use decimal format: £400.50 (not £400,50)
3. No commas in numbers
4. Re-upload corrected file

### Issue 5: "Import Stuck at 100%"
**Symptom:** Progress bar reaches 100% but doesn't show success screen  
**Cause:** Server processing delay or network issue  
**Solution:**
1. Wait 30 seconds (server may still be processing)
2. DO NOT close browser
3. If still stuck after 1 minute, refresh page
4. Check inventory to see if items were imported
5. Contact IT support if issue persists

---

## ✅ Verification Checklist

After completing the import, verify:

**In System:**
- [ ] All items show "AVAILABLE" status
- [ ] Unit IDs are correct and unique
- [ ] Product names are spelled correctly
- [ ] Buy prices are accurate to 2 decimal places
- [ ] Supplier names match records
- [ ] Stock count increased by correct amount

**Before Next Step:**
- [ ] No error messages appear
- [ ] All items visible in inventory list
- [ ] Status is not stuck (not showing "IMPORTING")
- [ ] Can search for items by Unit ID

---

## 📊 Example: Complete Batch Import

### Before Import:
- Inventory Count: 10 units
- Total Value: £3,500.00

### Import Data:
```
UNIT-101,iPhone 13,Apple,128GB Black,£400.00,Supplier-A,AVAILABLE
UNIT-102,iPhone 13,Apple,256GB White,£450.00,Supplier-B,AVAILABLE
UNIT-103,Samsung S21,Samsung,128GB Grey,£350.00,Supplier-A,AVAILABLE
UNIT-104,Galaxy Tab,Samsung,64GB Blue,£200.00,Supplier-C,AVAILABLE
```

### After Import:
- Inventory Count: 14 units (+4)
- Total Value: £4,900.00 (+£1,400.00)
- All new items status: AVAILABLE
- All items ready for listing

---

## 🔗 Next Steps

1. **Proceed to SOP-002** to list items on e-commerce platforms
2. **Monitor stock levels** using the dashboard
3. **Prepare next batch** while items are being listed

---

## 📞 Support Contact

**For Issues:**
- Contact: Inventory Manager
- Email: inventory@company.com
- Phone: +44 (0)123 456 7890
- Hours: Monday-Friday, 9 AM - 5 PM

**For Technical Issues:**
- Contact: IT Support
- Email: support@company.com
- Ticket Portal: support.company.com

---

## 📝 Sign-Off

**Completed By:** _________________ (Name)  
**Date:** _________________ (Date)  
**Supervisor:** _________________ (Name)  
**Date:** _________________ (Date)

---

**🎓 You have successfully completed SOP-001!**  
**Next: Open SOP_2_ADD_STOCK_AND_LIST_VIA_SHS.md**
