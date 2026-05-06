# SOP-002: Add Stock and List via SHS
## Individual Item Entry and E-Commerce Platform Listing

**SOP ID:** SOP-002  
**Version:** 1.0  
**Last Updated:** 2026-05-06  
**Duration:** 2-5 minutes per item  
**Frequency:** As items arrive in warehouse  
**Difficulty Level:** ⭐⭐⭐ (Intermediate)

---

## 📌 Purpose

Add individual inventory items to the system and immediately list them on e-commerce platforms (eBay, Amazon, OnBuy, Backmarket) to make them available for sale.

**When to Use:**
- Single items arrive in warehouse
- Items need immediate listing
- Custom items with specific details
- Test items before bulk import

**Expected Outcome:**
- Item added to inventory with status "AVAILABLE"
- Item listed on selected platform(s)
- Item visible to customers for purchase
- Profit calculation applied automatically

---

## 📋 Prerequisites

✅ Physical item received and inspected  
✅ Unit ID assigned and labeled  
✅ Buy price determined  
✅ Selling strategy decided (which platform)  
✅ Item condition documented  
✅ User role: Inventory Manager or Sales Staff  

---

## 🔄 Step-by-Step Procedure

### STEP 1: Access Item Entry Form

**Navigate to Add Item Page:**

1. Login to InventoryManager dashboard
2. Click **"Add New Item"** button (top right)
   - OR: Menu → **Inventory** → **Add Item**
   - OR: Quick action: Press `Ctrl + N`

3. Form loads with blank fields

---

### STEP 2: Enter Basic Item Information

**Required Fields:**

```
┌─────────────────────────────────────────────────────┐
│        ADD NEW INVENTORY ITEM                       │
├─────────────────────────────────────────────────────┤
│                                                     │
│ BASIC INFORMATION                                  │
│                                                     │
│ Unit ID *                                          │
│ [________________] (e.g., UNIT-12345)             │
│                                                     │
│ Product Name *                                     │
│ [________________] (e.g., iPhone 13 Pro)          │
│                                                     │
│ Brand *                                            │
│ [Apple▼] (dropdown menu)                          │
│ • Apple                                            │
│ • Samsung                                          │
│ • Google                                           │
│ • OnePlus                                          │
│                                                     │
│ Model *                                            │
│ [________________] (e.g., 256GB Space Grey)       │
│                                                     │
│ Condition *                                        │
│ [Excellent▼] (dropdown menu)                      │
│ • Excellent (Like New)                            │
│ • Very Good (Minor marks)                         │
│ • Good (Light scratches)                          │
│ • Fair (Noticeable wear)                          │
│                                                     │
│ Supplier/Source *                                  │
│ [Supplier-A▼] (dropdown menu)                     │
│                                                     │
│ Notes/Description                                  │
│ [________________] (Optional)                      │
│ [Include box, cables, etc.]                       │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**Field Descriptions:**

| Field | Example | Notes |
|-------|---------|-------|
| **Unit ID** | UNIT-12345 | Must be unique, no spaces |
| **Product Name** | iPhone 13 Pro | Use standard product name |
| **Brand** | Apple | Select from dropdown |
| **Model** | 256GB Space Grey | Include storage and color |
| **Condition** | Excellent | Choose closest match |
| **Supplier** | Supplier-A | Where item came from |
| **Notes** | Includes box and charger | Optional details |

**Validation:**
- [ ] Unit ID is unique (no duplicates)
- [ ] Product name is standard terminology
- [ ] Brand selected from dropdown
- [ ] Model includes storage and color
- [ ] Condition accurately reflects item state
- [ ] Supplier is registered in system

---

### STEP 3: Enter Pricing Information

**Price Fields:**

```
┌─────────────────────────────────────────────────────┐
│        PRICING INFORMATION                          │
├─────────────────────────────────────────────────────┤
│                                                     │
│ Buy Price * (What you paid)                        │
│ £ [________________] (e.g., 400.00)                │
│                                                     │
│ Target Postage Cost                                │
│ £ [________________] (Default: £8.00)              │
│                                                     │
│ Estimated Selling Platform *                       │
│ ○ eBay (Commission: 12.8% + £0.30)                │
│ ○ Amazon (Commission: 8%)                         │
│ ○ OnBuy (Commission: 9%)                          │
│ ○ Backmarket (Commission: 10%)                    │
│ ○ Multiple Platforms                              │
│                                                     │
│ Suggested Selling Price                            │
│ £ [________________] (Will calculate below)        │
│                                                     │
│ Estimated Profit                                   │
│ £ [________________] (Auto-calculated)             │
│ Formula: SP - BP - Platform Fee - Postage         │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**Pricing Strategy Guide:**

**For eBay:**
- Commission: 12.8% + £0.30
- Example: Buy £400 → Sell £500
  - Fee = (500 × 0.128) + 0.30 = £64.30
  - Profit = 500 - 400 - 64.30 - 8 = **£27.70**

**For Amazon:**
- Commission: 8% (flat)
- Example: Buy £400 → Sell £500
  - Fee = 500 × 0.08 = £40.00
  - Profit = 500 - 400 - 40 - 8 = **£52.00**

**For OnBuy:**
- Commission: 9% (flat)
- Example: Buy £400 → Sell £500
  - Fee = 500 × 0.09 = £45.00
  - Profit = 500 - 400 - 45 - 8 = **£47.00**

**For Backmarket:**
- Commission: 10% (flat)
- Example: Buy £400 → Sell £500
  - Fee = 500 × 0.10 = £50.00
  - Profit = 500 - 400 - 50 - 8 = **£42.00**

**Profit Target Guidelines:**
- Minimum profit: £10 per item
- Target profit margin: 15-25%
- Premium items: 10-15% margin acceptable
- Clearance items: 5-10% margin acceptable

---

### STEP 4: Select Selling Platform(s)

**Single vs. Multiple Platforms:**

**Option A: Single Platform**
```
Estimated Selling Platform *
○ eBay (Commission: 12.8% + £0.30)
```
- Best for: Premium items, unique listings
- Advantage: Focus on one platform
- Disadvantage: Limited customer reach

**Option B: Multiple Platforms**
```
Estimated Selling Platform *
☑ eBay (Commission: 12.8% + £0.30)
☑ Amazon (Commission: 8%)
☑ OnBuy (Commission: 9%)
☐ Backmarket (Commission: 10%)
```
- Best for: Popular items, bulk listings
- Advantage: Maximum customer reach
- Disadvantage: Must manage across platforms

---

### STEP 5: Enter Listing Details (SHS Integration)

**Platform-Specific Details:**

```
┌─────────────────────────────────────────────────────┐
│        LISTING DETAILS (SHS SETUP)                  │
├─────────────────────────────────────────────────────┤
│                                                     │
│ EBAY LISTING                                       │
│ ☑ List on eBay                                     │
│                                                     │
│ eBay Category *                                    │
│ [Mobile Phones & Accessories▼]                     │
│                                                     │
│ Listing Title *                                    │
│ [iPhone 13 Pro 256GB Space Grey Excellent...]      │
│ Length: 80 characters max                          │
│                                                     │
│ Description *                                      │
│ [_____________________]                            │
│ • Excellent condition                              │
│ • Includes original box                            │
│ • Never dropped                                    │
│ • Full warranty                                    │
│                                                     │
│ Starting Price / BIN Price *                       │
│ £ [500.00]                                         │
│                                                     │
│ Quantity Available *                               │
│ [1] (usually 1 for mobile phones)                 │
│                                                     │
│ ─────────────────────────────────────────────────│
│                                                     │
│ AMAZON LISTING                                     │
│ ☑ List on Amazon                                   │
│                                                     │
│ ASIN (Amazon Product Code) *                       │
│ [B08________________]                              │
│                                                     │
│ Listing Price *                                    │
│ £ [500.00]                                         │
│                                                     │
│ Condition *                                        │
│ [Like New▼]                                        │
│                                                     │
│ ─────────────────────────────────────────────────│
│                                                     │
│ ONBUY LISTING                                      │
│ ☑ List on OnBuy                                    │
│                                                     │
│ Category *                                         │
│ [Mobile Phones▼]                                   │
│                                                     │
│ Price *                                            │
│ £ [500.00]                                         │
│                                                     │
│ ─────────────────────────────────────────────────│
│                                                     │
│ BACKMARKET LISTING                                 │
│ ☐ List on Backmarket                               │
│ (Backmarket specializes in refurbished)           │
│                                                     │
│ Grade *                                            │
│ [Excellent▼]                                       │
│                                                     │
│ Price *                                            │
│ £ [500.00]                                         │
│                                                     │
│ Warranty *                                         │
│ [None▼] [6 Months▼] [12 Months▼]                 │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

### STEP 6: Review and Confirm

**Review Summary:**

```
┌─────────────────────────────────────────────────────┐
│        REVIEW ITEM DETAILS                          │
├─────────────────────────────────────────────────────┤
│                                                     │
│ ITEM SUMMARY                                       │
│ ┌─────────────────────────────────────────────────┐│
│ │ Unit ID: UNIT-12345                            ││
│ │ Product: iPhone 13 Pro                         ││
│ │ Buy Price: £400.00                             ││
│ │ Condition: Excellent                           ││
│ └─────────────────────────────────────────────────┘│
│                                                     │
│ SELLING PRICES & PROFIT                           │
│ ┌─────────────────────────────────────────────────┐│
│ │ Platform    | Price  | Fee    | Profit         ││
│ │─────────────────────────────────────────────────││
│ │ eBay        | £500   | £64.30 | £27.70         ││
│ │ Amazon      | £500   | £40.00 | £52.00         ││
│ │ OnBuy       | £500   | £45.00 | £47.00         ││
│ │─────────────────────────────────────────────────││
│ │ Total Listed on: 3 platforms                   ││
│ └─────────────────────────────────────────────────┘│
│                                                     │
│ VERIFICATION CHECKLIST                            │
│ ☑ Unit ID is unique                              │
│ ☑ Buy price accurate                             │
│ ☑ Platforms selected                             │
│ ☑ Prices competitive                             │
│ ☑ Profit targets met                             │
│ ☑ Listing details complete                       │
│                                                     │
│ [Cancel]  [Save as Draft]  [List Item]           │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**Before Clicking "List Item":**
- [ ] All required fields are filled
- [ ] Prices are competitive and profitable
- [ ] Item condition is accurately described
- [ ] At least one platform selected
- [ ] No spelling errors in title/description

---

### STEP 7: Confirm Listing

**Click "List Item" Button**

System will:
1. Validate all information
2. Calculate platform fees and profit
3. Create item in inventory (Status: AVAILABLE)
4. Submit listings to selected platforms
5. Update stock count
6. Display confirmation

**Success Screen:**

```
┌─────────────────────────────────────────────────────┐
│  ✅ ITEM LISTED SUCCESSFULLY                        │
├─────────────────────────────────────────────────────┤
│                                                     │
│ UNIT-12345: iPhone 13 Pro 256GB Space Grey        │
│                                                     │
│ Status: AVAILABLE (Ready for Sale)                │
│ Inventory Added: Yes                              │
│                                                     │
│ Platform Listings:                                │
│ ✅ eBay - Listed (Price: £500.00)               │
│ ✅ Amazon - Listed (Price: £500.00)             │
│ ✅ OnBuy - Listed (Price: £500.00)              │
│                                                     │
│ Profit Summary:                                   │
│ • Buy Price: £400.00                             │
│ • Average Selling Price: £500.00                 │
│ • Average Platform Fee: £49.77                   │
│ • Average Postage: £8.00                         │
│ • Average Net Profit: £42.23                     │
│                                                     │
│ [View Item Details]  [Add Another Item]          │
│ [Back to Inventory]                              │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

## ⚠️ Common Issues & Troubleshooting

### Issue 1: "Unit ID Already Exists"
**Symptom:** Error when trying to save  
**Cause:** Unit ID has been used before  
**Solution:**
1. Generate a new unique Unit ID
2. Check inventory for existing items
3. Edit form and try again

### Issue 2: "Invalid Price Format"
**Symptom:** System rejects the price you entered  
**Cause:** Price format incorrect (e.g., £500,00 instead of £500.00)  
**Solution:**
1. Use format: £XXX.XX
2. No commas in numbers
3. Always include £ symbol
4. Maximum 2 decimal places

### Issue 3: "Platform Listing Failed"
**Symptom:** Item saved but not listed on eBay/Amazon/etc.  
**Cause:** Platform API connection issue or invalid listing details  
**Solution:**
1. Check internet connection
2. Verify listing details are complete
3. Check platform requirements (ASIN for Amazon)
4. Contact IT support if problem persists
5. Can re-submit listing later

### Issue 4: "Negative Profit Warning"
**Symptom:** System warns that profit is negative  
**Cause:** Selling price is too low compared to costs  
**Solution:**
1. Increase selling price
2. Verify buy price is correct
3. Check postage cost assumption
4. Consider platform fees in calculation
5. Only proceed if intentional (clearance sale)

### Issue 5: "Missing Required Field"
**Symptom:** Cannot save item, form shows error  
**Cause:** Required field is blank (marked with *)  
**Solution:**
1. Review form for red error messages
2. Fill in all required fields:
   - Unit ID
   - Product Name
   - Brand
   - Model
   - Condition
   - Buy Price
   - At least one platform selected
3. Try saving again

---

## ✅ Verification Checklist

After listing item, verify:

**In Inventory System:**
- [ ] Item appears with "AVAILABLE" status
- [ ] Buy price is correct
- [ ] Unit ID is unique and searchable
- [ ] Item description is accurate
- [ ] Condition is properly documented

**On E-Commerce Platforms:**
- [ ] Item visible on selected platforms
- [ ] Listing price matches what you set
- [ ] Product images uploaded (if required)
- [ ] Title and description are correct
- [ ] Item shows as available for purchase

**Profit Calculation:**
- [ ] Platform fee calculated correctly
- [ ] Net profit is acceptable (minimum £10)
- [ ] Profit margin meets targets (15-25%)
- [ ] Postage cost is realistic

---

## 📊 Example: Complete Item Listing

### Item Details:
- Unit ID: UNIT-12345
- Product: iPhone 13 Pro
- Model: 256GB Space Grey
- Condition: Excellent
- Buy Price: £400.00

### Listing Details:
- Platform: eBay + Amazon + OnBuy
- eBay Price: £500.00
- Amazon Price: £510.00
- OnBuy Price: £505.00

### Profit Calculation:
| Platform | Price | Fee | Postage | Profit |
|----------|-------|-----|---------|--------|
| eBay | £500 | £64.30 | £8 | £27.70 |
| Amazon | £510 | £40.80 | £8 | £61.20 |
| OnBuy | £505 | £45.45 | £8 | £51.55 |

---

## 🔗 Next Steps

1. **Proceed to SOP-003** when item sells (Update Sell Order)
2. **Continue adding items** as they arrive
3. **Monitor listings** using the dashboard
4. **Adjust prices** if items don't sell within target time

---

## 📞 Support Contact

**For Pricing Questions:**
- Contact: Sales Manager
- Email: sales@company.com
- Hours: Monday-Friday, 9 AM - 5 PM

**For Listing Issues:**
- Contact: Platform Support Specialist
- Email: platforms@company.com

**For Technical Issues:**
- Contact: IT Support
- Ticket: support.company.com

---

## 📝 Sign-Off

**Completed By:** _________________ (Name)  
**Date:** _________________ (Date)  
**Supervisor:** _________________ (Name)  
**Date:** _________________ (Date)

---

**🎓 You have successfully completed SOP-002!**  
**Next: Open SOP_3_UPDATE_SELL_ORDER.md**
