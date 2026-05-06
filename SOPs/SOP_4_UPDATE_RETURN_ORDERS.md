# SOP-004: Update Return Orders
## Process Returns and Manage Stock Adjustments

**SOP ID:** SOP-004  
**Version:** 1.0  
**Last Updated:** 2026-05-06  
**Duration:** 5-10 minutes per return  
**Frequency:** As returns arrive from customers  
**Difficulty Level:** ⭐⭐⭐ (Intermediate)

---

## 📌 Purpose

Process customer returns, inspect items, and restore them to inventory without deletion. Items are NEVER removed from the system - they transition back to "AVAILABLE" status for re-listing and resale.

**When to Use:**
- Customer returns sold item
- Item arrives back at warehouse
- Need to inspect condition
- Stock adjustment required

**Expected Outcome:**
- Return recorded in system
- Item inspected and graded
- Status changed to "AVAILABLE" (not deleted)
- Item ready for re-listing
- Return reason documented

**Key Principle:** ✅ **Items are RESTORED, not DELETED**

---

## 📋 Prerequisites

✅ Item was previously sold (status "SOLD")  
✅ Return authorization received from platform  
✅ Item physically received from customer  
✅ User role: Returns Manager or Inventory Manager  
✅ Inspection area prepared  

---

## 🔄 Step-by-Step Procedure

### STEP 1: Receive Return Notification

**How Returns Arrive:**

**Method A: Platform Return Request**
- Customer initiates return on platform
- System notifies InventoryManager
- Return appears in **"Pending Returns"** dashboard

**Method B: Physical Return Received**
- Item arrives at warehouse
- Packaged with return slip
- Manual entry in system

**Navigate to Returns:**

1. Login to InventoryManager dashboard
2. Click **"Returns"** or **"Sales"** menu
3. Select **"Pending Returns"** tab
4. View list of returns awaiting inspection

```
┌──────────────────────────────────────────────────┐
│        PENDING RETURNS DASHBOARD                 │
├──────────────────────────────────────────────────┤
│                                                  │
│ [New Return] [Refresh] [Filter: All▼] [Search] │
│                                                  │
│ Return ID | Unit ID | Reason | Status | Days    │
├──────────────────────────────────────────────────┤
│ RET-001   | UNIT-12345 | Defective | ⏳ PENDING| 2  │
│ RET-002   | UNIT-67890 | Changed Mind| ⏳ PENDING| 5│
│ RET-003   | UNIT-54321 | Wrong Item| ⏳ PENDING| 1  │
│                                                  │
│ [Show Details] [Inspect Return] [Reject]        │
│                                                  │
└──────────────────────────────────────────────────┘
```

---

### STEP 2: Review Return Request

**Click on Return to View Details:**

```
┌──────────────────────────────────────────────────┐
│      RETURN REQUEST - RET-001                    │
├──────────────────────────────────────────────────┤
│                                                  │
│ RETURN INFORMATION                              │
│ ┌──────────────────────────────────────────────┐│
│ │ Return ID: RET-001                          ││
│ │ Original Order: ORD-001                     ││
│ │ Return Date Received: 2026-05-04, 10:15    ││
│ │ Customer: John Smith                        ││
│ │ Return Reason: Item defective               ││
│ │ Days Since Sale: 2 days                     ││
│ │ Within Return Window: YES (14 days)         ││
│ │ Return Status: PENDING INSPECTION           ││
│ └──────────────────────────────────────────────┘│
│                                                  │
│ ORIGINAL SALE INFORMATION                       │
│ ┌──────────────────────────────────────────────┐│
│ │ Unit ID: UNIT-12345                         ││
│ │ Product: iPhone 13 Pro                      ││
│ │ Model: 256GB Space Grey                     ││
│ │ Original Condition: Excellent               ││
│ │ Sale Price: £500.00                         ││
│ │ Profit Recorded: £27.70                     ││
│ │ Postage Paid: £8.00 (Royal Mail Signed)    ││
│ └──────────────────────────────────────────────┘│
│                                                  │
│ RETURN REASON                                   │
│ ┌──────────────────────────────────────────────┐│
│ │ Reason: Item defective                      ││
│ │ Details: Not holding charge, won't turn on ││
│ │ Inspection Status: PENDING                  ││
│ └──────────────────────────────────────────────┘│
│                                                  │
│ NEXT STEP: Inspect Item                         │
│ [Start Inspection]                              │
│                                                  │
└──────────────────────────────────────────────────┘
```

**Review Checklist:**
- [ ] Return received within allowed window (typically 14-30 days)
- [ ] Return reason is documented
- [ ] Original sale information matches
- [ ] Customer has good feedback (less likely to dispute)
- [ ] Unit ID is correct

---

### STEP 3: Physically Inspect Item

**Inspection Location:** Designated returns/QA area

**Inspection Checklist:**

```
┌──────────────────────────────────────────────────┐
│        ITEM INSPECTION FORM                      │
├──────────────────────────────────────────────────┤
│                                                  │
│ PHYSICAL CONDITION ASSESSMENT                   │
│                                                  │
│ Power On Test:                                  │
│ ☐ Yes, powers on normally                       │
│ ☐ Yes, but requires restart                     │
│ ☐ No, won't power on (DEFECTIVE)                │
│ ☐ No battery, unable to test                    │
│                                                  │
│ Display Condition:                              │
│ ☐ Perfect, no marks                             │
│ ☐ Minimal marks, not visible from distance      │
│ ☐ Light scratches on edge                       │
│ ☐ Visible cracks or damage (DEFECTIVE)          │
│                                                  │
│ Body/Frame:                                     │
│ ☐ Pristine, no damage                           │
│ ☐ Minor corner wear                             │
│ ☐ Noticeable scratches or dents                 │
│ ☐ Major damage - bent or cracked (DEFECTIVE)   │
│                                                  │
│ Buttons/Ports:                                  │
│ ☐ All responsive and working                    │
│ ☐ Slight sticking but functional                │
│ ☐ One button not responsive                     │
│ ☐ Charging port damaged (DEFECTIVE)             │
│                                                  │
│ Accessories Included:                           │
│ ☑ Original charger                              │
│ ☑ USB cable                                     │
│ ☑ Original box                                  │
│ ☐ Screen protector                              │
│ ☐ Case                                          │
│                                                  │
│ OVERALL ASSESSMENT                              │
│                                                  │
│ Can Item Be Re-Listed?                          │
│ ○ YES - Restore to available inventory          │
│ ○ YES - But at reduced grade (Fine/Good)        │
│ ○ NO - Defective, mark as damaged/parts         │
│                                                  │
│ Notes:                                          │
│ [_____________________________________]         │
│                                                  │
│ Inspected By: _________________ Date: _____    │
│                                                  │
└──────────────────────────────────────────────────┘
```

**Condition Grading Scale:**

| Grade | Description | Can Re-List? | Actions |
|-------|-------------|--------------|---------|
| **Excellent** | No visible damage, works perfectly | ✅ Yes | Restore to AVAILABLE |
| **Very Good** | Minor marks, fully functional | ✅ Yes | Restore, reduce price 5% |
| **Good** | Light scratches, works perfectly | ✅ Yes | Restore, reduce price 10% |
| **Fair** | Noticeable wear, fully functional | ✅ Yes | Restore, reduce price 20% |
| **Defective** | Not working or major damage | ❌ No | Mark as PARTS/DAMAGED |

---

### STEP 4: Record Inspection Results

**In InventoryManager System:**

```
┌──────────────────────────────────────────────────┐
│    INSPECTION RESULTS - RET-001                  │
├──────────────────────────────────────────────────┤
│                                                  │
│ INSPECTION OUTCOME                              │
│                                                  │
│ Item Condition Found:                           │
│ ○ Excellent - No damage                         │
│ ○ Very Good - Minor marks                       │
│ ○ Good - Light scratches                        │
│ ○ Fair - Noticeable wear                        │
│ ☑ Defective - Not working                       │
│                                                  │
│ DECISION                                        │
│                                                  │
│ Item Fate:                                      │
│ ○ Return to AVAILABLE inventory                 │
│ ○ Grade as: Very Good (reduce price 5%)        │
│ ☑ Mark as PARTS/DAMAGED (not for resale)       │
│                                                  │
│ REFUND DECISION                                 │
│                                                  │
│ Refund to Customer:                             │
│ ○ YES - Full refund (Condition: Excellent)     │
│ ○ YES - Partial refund (Condition: Fair/Good)  │
│ ☑ NO - Item defective per customer, refund     │
│        handled by platform                      │
│                                                  │
│ INVENTORY ADJUSTMENT                            │
│                                                  │
│ Current Status: SOLD                            │
│ New Status: DEFECTIVE (parts for repair)        │
│ Stock Change: -1 AVAILABLE, +1 DEFECTIVE       │
│                                                  │
│ PROFIT ADJUSTMENT                               │
│                                                  │
│ Original Profit: £27.70 (keep in records)       │
│ Return Loss: -£27.70 (sale voided)              │
│ Net Impact: £0.00 (return processed)            │
│                                                  │
│ Notes:                                          │
│ Item not holding charge, suspected battery or  │
│ power management issue. Suitable for parts      │
│ recovery or repair by technician.               │
│                                                  │
│ [Cancel] [Confirm Inspection] [Request Info]   │
│                                                  │
└──────────────────────────────────────────────────┘
```

---

### STEP 5: Confirm Return Processing

**Click "Confirm Inspection" Button**

System will:
1. Update item status based on condition
2. Adjust inventory counts
3. Process refund (if applicable)
4. Record return reason and details
5. Generate return report

---

### STEP 6: Stock Restoration (If Applicable)

**If Item Passes Inspection:**

```
┌──────────────────────────────────────────────────┐
│  ✅ ITEM RESTORED TO INVENTORY                   │
├──────────────────────────────────────────────────┤
│                                                  │
│ Return ID: RET-001                              │
│ Unit ID: UNIT-12345                             │
│ Product: iPhone 13 Pro 256GB Space Grey         │
│                                                  │
│ INVENTORY ADJUSTMENT COMPLETED                  │
│                                                  │
│ Status Change:                                  │
│ • From: SOLD (sold to customer)                 │
│ • To: AVAILABLE (back in inventory)             │
│                                                  │
│ Stock Count Update:                             │
│ • Sold Units: 11 → 10                           │
│ • Available Units: 4 → 5                        │
│ • Total Inventory: 14 units (unchanged)         │
│                                                  │
│ IMPORTANT: ✅ ITEM NOT DELETED                  │
│            ✅ STOCK NOT REMOVED                 │
│            ✅ FULL HISTORY PRESERVED            │
│                                                  │
│ NEXT STEPS                                      │
│ 1. Re-list item on platforms                    │
│ 2. Adjust price if condition changed            │
│ 3. Update inventory dashboard                   │
│ 4. Monitor for sale                             │
│                                                  │
│ [Re-List Item]  [View Item Details]  [Done]    │
│                                                  │
└──────────────────────────────────────────────────┘
```

**Stock Adjustment Logic:**

```
INVENTORY FLOW - RETURNS PROCESS

BEFORE RETURN:
┌─────────────┐
│ Item Status │ = SOLD
│ Buy Price   │ = £400.00
│ Sold Price  │ = £500.00
│ Profit      │ = £27.70 (recorded)
└─────────────┘

CUSTOMER RETURNS → INSPECTION

OUTCOME A: Item Condition - Excellent
┌─────────────────────────┐
│ Action: RESTORE          │
│ New Status: AVAILABLE    │
│ Stock Change: +1         │
│ Re-list: YES             │
│ Selling Price: £500      │
│ Profit Impact: £0 (sale  │
│                removed)  │
└─────────────────────────┘

OUTCOME B: Item Condition - Good
┌─────────────────────────┐
│ Action: RESTORE+GRADE    │
│ New Status: AVAILABLE    │
│ Stock Change: +1         │
│ Re-list: YES             │
│ Selling Price: £450      │
│ (reduced 10%)            │
│ Profit Impact: £0 (sale  │
│                removed)  │
└─────────────────────────┘

OUTCOME C: Item Defective
┌─────────────────────────┐
│ Action: MARK DEFECTIVE   │
│ New Status: PARTS        │
│ Stock Change: +1         │
│ Re-list: NO              │
│ Selling Price: N/A       │
│ Profit Impact: -£27.70   │
│                (loss)    │
└─────────────────────────┘

AFTER RETURN PROCESS:
┌─────────────────────┐
│ Total Items: SAME   │
│ (14 before = 14     │
│  after)             │
│                     │
│ Status Changed      │
│ SOLD → AVAILABLE    │
│ (or DEFECTIVE)      │
│                     │
│ NO ITEMS DELETED    │
│ FULL AUDIT TRAIL    │
└─────────────────────┘
```

---

## ⚠️ Common Issues & Troubleshooting

### Issue 1: "Customer Disputes Return"
**Symptom:** Customer claims item was defective when received  
**Cause:** Item condition differs from description or test results  
**Solution:**
1. Review inspection results carefully
2. Document all photos/notes
3. Compare to original condition report
4. Contact platform's resolution center
5. May need escalation to higher authority
6. Decide: Process refund or contest claim

### Issue 2: "Missing Accessories"
**Symptom:** Item returned without charger or original box  
**Cause:** Customer kept or lost accessories  
**Solution:**
1. Document what's missing
2. Deduct from refund or don't accept return
3. Options:
   - Reject return (customer keeps item)
   - Accept return, reduce refund by missing items value
   - Accept return, re-list with note "accessories missing"
4. Update return notes

### Issue 3: "Item Condition Worse Than Expected"
**Symptom:** Item has damage not mentioned in return reason  
**Cause:** Hidden damage or customer misrepresented condition  
**Solution:**
1. Document damage with photos
2. Note discrepancy between claim and reality
3. Inspect more carefully
4. If major damage: Mark as PARTS/DAMAGED
5. If minor: Reduce grade and re-list

### Issue 4: "Can't Power On Item"
**Symptom:** Battery dead, won't test without charger  
**Cause:** Customer didn't charge before return or battery failure  
**Solution:**
1. Charge item for 30 minutes using standard charger
2. Retry power-on test
3. If still won't power on: Mark DEFECTIVE
4. Document charging attempts
5. Note if charger was not included

### Issue 5: "Return Authorization Already Processed"
**Symptom:** System says return already completed  
**Cause:** Return was already processed by someone else  
**Solution:**
1. Check return history
2. Look for duplicate return entries
3. Verify if item is already restored
4. Don't process twice
5. Mark as duplicate and cancel

---

## ✅ Verification Checklist

After processing return, verify:

**Return Recorded:**
- [ ] Return ID assigned and visible
- [ ] Return reason documented
- [ ] Inspection results recorded
- [ ] Date and time stamped
- [ ] Inspected by person identified

**Inventory Updated:**
- [ ] Item status changed from SOLD to AVAILABLE (or DEFECTIVE)
- [ ] Stock count accurate
- [ ] Item searchable in inventory
- [ ] Item no longer shows as "SOLD"
- [ ] Item appears in "AVAILABLE" list (if applicable)

**System Records:**
- [ ] Original sale still in history (not deleted)
- [ ] Return noted in item timeline
- [ ] Profit/loss accurately recorded
- [ ] Refund status updated
- [ ] Audit trail complete

**Physical Item:**
- [ ] Inspection label attached
- [ ] Condition notes visible
- [ ] Stored in correct location
- [ ] Ready for re-listing or repair

---

## 📊 Example: Complete Return Process

### Original Sale:
- Order ID: ORD-001
- Unit ID: UNIT-12345
- Product: iPhone 13 Pro 256GB Space Grey
- Sale Price: £500.00
- Profit: £27.70
- Status: SOLD

### Return Received:
- Return ID: RET-001
- Reason: Defective (won't power on)
- Days Since Sale: 2
- Condition Found: Defective

### Inspection Results:
- Power Test: Failed (won't turn on)
- Display: No visible damage
- Body: Excellent condition
- Accessories: All included
- **Verdict: DEFECTIVE**

### Inventory Adjustment:
- Status: SOLD → DEFECTIVE (PARTS)
- Available Stock: 4 → 4 (unchanged)
- Defective Stock: 0 → 1
- Total Items: 14 (unchanged)

### Profit Impact:
- Original Sale Profit: +£27.70
- Return Loss: -£27.70
- Net Monthly Profit: Adjusted accordingly

---

## 📋 Return Categories

**Category A: Acceptable Returns (Restore to AVAILABLE)**
- Item in excellent condition
- Customer changed mind
- Wrong size/color ordered
- Restocking fee may apply
- Re-list at original or reduced price

**Category B: Partial Damage (Restore as GOOD/FAIR)**
- Light scratches or marks
- Minor functional issues fixed
- Still marketable
- Grade down and reduce price 5-20%
- Re-list with updated condition

**Category C: Defective Items (Mark as PARTS)**
- Won't power on
- Major damage or cracks
- Water damage
- Not safely resellable
- Store for parts/repair/recycling
- Do NOT re-list as available

---

## 🔗 Next Steps

After return processing:

1. **If Item Restored to AVAILABLE:**
   - Re-list on platforms (follow SOP-002)
   - May reduce price based on new condition
   - Market as "refurbished" or "second chance"

2. **If Item Marked as DEFECTIVE:**
   - Store in dedicated repair area
   - Assess repair cost vs. value
   - Decide: repair for resale or recycle
   - Do NOT re-list until repaired

3. **Monitor Refunds:**
   - Ensure customer received refund
   - Check payment confirmation
   - Follow up if customer disputes

---

## 📞 Support Contact

**For Return Questions:**
- Contact: Returns Manager
- Email: returns@company.com
- Hours: Monday-Friday, 9 AM - 5 PM

**For Platform Disputes:**
- Contact: Platform Resolution Specialist
- Email: disputes@company.com

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

## 📌 KEY REMINDERS

✅ **ITEMS ARE NEVER DELETED**
- They change status (SOLD → AVAILABLE)
- Full history is preserved
- Audit trail remains complete
- Supports legal/warranty requirements

✅ **STOCK COUNT NEVER DECREASES**
- Return processes transition items
- SOLD units → AVAILABLE units
- Total inventory remains constant
- Accurate financial tracking

✅ **PROFIT RECORDS PRESERVED**
- Original sale profit recorded
- Return loss documented
- Monthly/annual P&L accurate
- Historical data intact

---

**🎓 You have successfully completed SOP-004!**  
**Congratulations! You have completed all 4 SOPs.**

**📊 Next Phase: Advanced Operations**
- Multi-platform analytics
- Profit optimization strategies
- Bulk return processing
- Supplier management
