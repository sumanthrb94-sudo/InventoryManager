# SOP-003: Update Sell Order
## Record and Process Customer Sales

**SOP ID:** SOP-003  
**Version:** 1.0  
**Last Updated:** 2026-05-06  
**Duration:** 1-3 minutes per order  
**Frequency:** Real-time as orders received  
**Difficulty Level:** ⭐ (Beginner)

---

## 📌 Purpose

Record customer sales when items are sold on e-commerce platforms and update inventory status to track sold items and profit generated.

**When to Use:**
- Customer purchases item on eBay/Amazon/OnBuy/Backmarket
- Order confirmation received from platform
- Item needs to be marked as "SOLD" in system
- Profit needs to be recorded

**Expected Outcome:**
- Item status changes from "AVAILABLE" to "SOLD"
- Sale price and platform recorded
- Profit automatically calculated
- Stock count updated
- Order ready for shipping preparation

---

## 📋 Prerequisites

✅ Item listed and available for sale (from SOP-002)  
✅ Customer order confirmation received  
✅ Sale price confirmed from platform  
✅ Platform identified (eBay, Amazon, OnBuy, Backmarket)  
✅ User role: Sales Staff or Inventory Manager  

---

## 🔄 Step-by-Step Procedure

### STEP 1: Receive Order Notification

**Order Arrival:**

Orders can arrive in two ways:

**Method A: Automatic Platform Sync**
- System monitors platforms automatically
- New orders appear in **"Pending Orders"** dashboard
- No manual action needed (automatic)

**Method B: Manual Order Entry**
- You receive order via email
- Need to manually enter order details
- Click **"New Order"** button

**Navigate to Orders:**

1. Login to InventoryManager dashboard
2. Click **"Sales"** or **"Orders"** menu
3. Select **"Pending Orders"** tab
4. View list of orders awaiting processing

```
┌──────────────────────────────────────────────────┐
│        PENDING ORDERS DASHBOARD                  │
├──────────────────────────────────────────────────┤
│                                                  │
│ [New Order] [Refresh] [Filter: All▼] [Search]  │
│                                                  │
│ Order ID | Unit ID | Platform | Amount | Status│
├──────────────────────────────────────────────────┤
│ ORD-001  | UNIT-12345 | eBay | £500 | ⏳ PENDING│
│ ORD-002  | UNIT-67890 | Amazon | £510 | ⏳ PENDING│
│ ORD-003  | UNIT-54321 | OnBuy | £495 | ⏳ PENDING│
│                                                  │
│ [Show Details] [Process Order] [Reject]         │
│                                                  │
└──────────────────────────────────────────────────┘
```

---

### STEP 2: Select Order to Process

**Click on Order:**

```
┌──────────────────────────────────────────────────┐
│      ORDER DETAILS - ORD-001                     │
├──────────────────────────────────────────────────┤
│                                                  │
│ ORDER INFORMATION                               │
│ ┌──────────────────────────────────────────────┐│
│ │ Order ID: ORD-001                           ││
│ │ Date: 2026-05-06, 14:32 UTC                ││
│ │ Platform: eBay                              ││
│ │ Customer: John Smith                        ││
│ │ Buyer Rating: ★★★★★ (150 reviews)         ││
│ │ Status: PENDING                             ││
│ └──────────────────────────────────────────────┘│
│                                                  │
│ ITEM DETAILS                                    │
│ ┌──────────────────────────────────────────────┐│
│ │ Unit ID: UNIT-12345                         ││
│ │ Product: iPhone 13 Pro                      ││
│ │ Model: 256GB Space Grey                     ││
│ │ Condition: Excellent                        ││
│ │ Buy Price: £400.00                          ││
│ │ Buy Date: 2026-04-15                        ││
│ └──────────────────────────────────────────────┘│
│                                                  │
│ SALE INFORMATION                                │
│ ┌──────────────────────────────────────────────┐│
│ │ Sale Price: £500.00                         ││
│ │ Platform Fee: £64.30 (12.8% + £0.30)       ││
│ │ Postage Cost: £8.00 (Default)               ││
│ │ Net Profit: £27.70                          ││
│ │ Profit Margin: 5.5%                         ││
│ └──────────────────────────────────────────────┘│
│                                                  │
│ CUSTOMER INFORMATION                            │
│ ┌──────────────────────────────────────────────┐│
│ │ Buyer: John Smith                           ││
│ │ Location: London, UK                        ││
│ │ Postage Address:                            ││
│ │ 123 Main Street                             ││
│ │ London, UK, W1A 1AA                         ││
│ │ Phone: +44 (0)123 456 7890                 ││
│ └──────────────────────────────────────────────┘│
│                                                  │
│ [Cancel] [Confirm Sale] [Request Cancellation] │
│                                                  │
└──────────────────────────────────────────────────┘
```

---

### STEP 3: Verify Order Details

**Before confirming, verify:**

**Item Information:**
- [ ] Unit ID matches the listing
- [ ] Product name is correct
- [ ] Model/specification is correct
- [ ] Condition is as advertised

**Sale Information:**
- [ ] Sale price matches platform listing
- [ ] Platform fee calculated correctly
- [ ] Postage cost is realistic (adjust if needed)
- [ ] Profit is acceptable (minimum £10)

**Customer Information:**
- [ ] Shipping address is complete
- [ ] Customer has good feedback rating
- [ ] No red flags or duplicate orders

---

### STEP 4: Adjust Details if Needed

**If Postage Cost Different:**

```
POSTAGE COST ADJUSTMENT

Default Postage: £8.00
☑ Use Default
☐ Override: £ [________] (enter custom amount)

Reason for Override:
☐ Royal Mail Special Delivery (£12.00)
☐ International Shipping (£25.00)
☐ Express Delivery (£15.00)
☐ Customer Requested: ___________
```

**If Sale Price Different:**

```
SALE PRICE ADJUSTMENT

Listed Price: £500.00
☑ Use Listed Price
☐ Override: £ [________] (if negotiated)

Note: This will recalculate platform fee and profit
```

**Profit Recalculation Example:**

If you override postage to £12.00:
- Original: £500 - £400 - £64.30 - £8 = £27.70
- Updated: £500 - £400 - £64.30 - £12 = £23.70
- Difference: -£4.00

---

### STEP 5: Confirm Sale

**Click "Confirm Sale" Button**

System will:
1. Validate all information
2. Update item status to "SOLD"
3. Calculate final profit
4. Remove from available inventory
5. Create sale record
6. Generate picking slip for warehouse

**Confirmation Screen:**

```
┌──────────────────────────────────────────────────┐
│  ✅ ORDER CONFIRMED - READY TO SHIP              │
├──────────────────────────────────────────────────┤
│                                                  │
│ Order ID: ORD-001                               │
│ Unit ID: UNIT-12345                             │
│ Product: iPhone 13 Pro 256GB Space Grey         │
│                                                  │
│ FINAL PROFIT SUMMARY                            │
│ ┌──────────────────────────────────────────────┐│
│ │ Sale Price:        £500.00                  ││
│ │ Buy Price:         £400.00                  ││
│ │ Platform Fee:      £64.30                   ││
│ │ Postage Cost:      £8.00                    ││
│ │ ────────────────────────────────────────────││
│ │ NET PROFIT:        £27.70                   ││
│ │ PROFIT MARGIN:     5.5%                     ││
│ └──────────────────────────────────────────────┘│
│                                                  │
│ INVENTORY UPDATE                                │
│ • Status: AVAILABLE → SOLD                      │
│ • Available Units: 5 → 4                        │
│ • Sold Units: 10 → 11                          │
│                                                  │
│ PICKING SLIP GENERATED                          │
│ [📄 View Picking Slip]  [🖨 Print]              │
│                                                  │
│ NEXT STEPS                                      │
│ 1. Prepare item for shipment                    │
│ 2. Generate shipping label                      │
│ 3. Pack and ship to customer                    │
│ 4. Update tracking when shipped                 │
│                                                  │
│ [Back to Orders]  [New Order]                   │
│                                                  │
└──────────────────────────────────────────────────┘
```

---

### STEP 6: Generate Picking Slip

**Picking Slip Purpose:**
- Instructions for warehouse staff to locate and prepare item
- Includes item details, customer address, handling notes
- Attached to package before shipping

**Picking Slip Format:**

```
╔════════════════════════════════════════════╗
║           PICKING SLIP - ORD-001           ║
║                                            ║
║ Unit ID: UNIT-12345                        ║
║ Product: iPhone 13 Pro 256GB Space Grey    ║
║                                            ║
║ LOCATION IN WAREHOUSE: Shelf A-12          ║
║                                            ║
║ CUSTOMER DETAILS:                          ║
║ John Smith                                 ║
║ 123 Main Street                            ║
║ London, UK, W1A 1AA                        ║
║ Phone: +44 (0)123 456 7890                 ║
║                                            ║
║ POSTAGE METHOD:                            ║
║ Royal Mail Signed For (£8.00)              ║
║                                            ║
║ HANDLING INSTRUCTIONS:                     ║
║ ✓ Item in excellent condition              ║
║ ✓ Includes original box                    ║
║ ✓ Includes charger and cables              ║
║ ✓ Bubble wrap carefully                    ║
║ ✓ Include thank you note                   ║
║                                            ║
║ Print this slip and attach to package      ║
║                                            ║
╚════════════════════════════════════════════╝
```

**Actions:**
- [ ] Print picking slip
- [ ] Attach to item
- [ ] Hand to warehouse staff
- [ ] Monitor shipment status

---

## ⚠️ Common Issues & Troubleshooting

### Issue 1: "Order Not Showing in System"
**Symptom:** Cannot find order in pending orders list  
**Cause:** Order hasn't synced from platform yet  
**Solution:**
1. Refresh the page (F5)
2. Wait 5-10 minutes for platform sync
3. Check if order is on the actual platform
4. Try manual entry if order exists
5. Contact platform support if issue persists

### Issue 2: "Unit ID Not Found"
**Symptom:** Error "UNIT-12345 doesn't exist in inventory"  
**Cause:** Item hasn't been added to inventory yet (SOP-002 not completed)  
**Solution:**
1. Cancel this order
2. Add item to inventory first (SOP-002)
3. Re-process order after item added

### Issue 3: "Negative Profit Warning"
**Symptom:** System warns profit is negative  
**Cause:** Costs exceed selling price  
**Solution:**
1. Verify sale price is correct
2. Check postage cost assumption
3. Verify platform fee calculation
4. If loss is acceptable (clearance), confirm to proceed
5. If error, request order cancellation

### Issue 4: "Duplicate Order"
**Symptom:** Error "This order already processed"  
**Cause:** Order was already confirmed earlier  
**Solution:**
1. Check order history
2. Search for existing order record
3. Do not re-process same order
4. Contact manager if unsure

### Issue 5: "Platform Fee Mismatch"
**Symptom:** Platform fee shown differently than expected  
**Cause:** Platform rates may have changed or item category affects fee  
**Solution:**
1. Check current platform fee rates
2. eBay: 12.8% + £0.30
3. Amazon: 8%
4. OnBuy: 9%
5. Backmarket: 10%
6. Contact system admin if still incorrect

---

## ✅ Verification Checklist

After confirming sale, verify:

**In System:**
- [ ] Item status changed to "SOLD"
- [ ] Order shows in "Confirmed Orders" list
- [ ] Profit calculated correctly
- [ ] Stock count decreased by 1
- [ ] Order date/time recorded

**In Inventory Dashboard:**
- [ ] Available units count decreased
- [ ] Sold units count increased
- [ ] Item no longer appears in "Available" list
- [ ] Item appears in "Sold" or "Order Fulfilled" list

**Picking Slip:**
- [ ] Generated successfully
- [ ] All item details correct
- [ ] Customer address correct
- [ ] Printed and ready for warehouse

---

## 📊 Example: Complete Order Processing

### Order Details:
- Order ID: ORD-001
- Unit ID: UNIT-12345
- Platform: eBay
- Customer: John Smith

### Item Details:
- Product: iPhone 13 Pro
- Model: 256GB Space Grey
- Buy Price: £400.00
- Condition: Excellent

### Sale Details:
- Sale Price: £500.00
- Platform Fee: (500 × 0.128) + 0.30 = £64.30
- Postage: £8.00
- Net Profit: 500 - 400 - 64.30 - 8 = **£27.70**

### Status Update:
- Before: AVAILABLE (in inventory)
- After: SOLD (awaiting shipment)
- Profit Recorded: £27.70
- Daily Profit Total: +£27.70

---

## 🔗 Next Steps

1. **Prepare for Shipment:**
   - Use picking slip to locate item
   - Verify condition matches listing
   - Pack securely with protective materials
   - Add thank you note

2. **Generate Shipping Label:**
   - Use picking slip address
   - Select postage method per order
   - Print label and attach to package

3. **Update Tracking:**
   - Once shipped, enter tracking number
   - Customer receives tracking details
   - Monitor delivery status

4. **If Item Returns:**
   - Proceed to SOP-004: Update Return Order

---

## 📊 Daily Order Summary

**End of Day Reporting:**

```
DAILY SALES SUMMARY - 2026-05-06

Orders Processed:     12
Total Sales Value:    £6,450.00
Total Fees:          £547.50
Total Profits:        £892.50

Platform Breakdown:
• eBay:     5 orders, £2,500 sales, £280 profit
• Amazon:   4 orders, £2,100 sales, £310 profit
• OnBuy:    2 orders, £950 sales, £172 profit
• Backmarket: 1 order, £900 sales, £130 profit

Average Profit per Order: £74.38
Best Performing Item: iPhone 13 Pro (£120 profit)
Slowest Item: Samsung A12 (£8 profit)
```

---

## 📞 Support Contact

**For Order Questions:**
- Contact: Sales Manager
- Email: sales@company.com
- Hours: Monday-Friday, 9 AM - 5 PM

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

**🎓 You have successfully completed SOP-003!**  
**Next: Open SOP_4_UPDATE_RETURN_ORDERS.md**
