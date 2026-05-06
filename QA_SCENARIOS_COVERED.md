# QA Test Scenarios Covered by 150-Unit Mock Dataset

## Dataset Overview
- **Total Units**: 150
- **Suppliers**: 5 (IMAX, TechSource, Global Trade, Apex, Prime Electronics)
- **Products**: 6 categories across 24 different models
- **Status Distribution**:
  - Available: 104 units (69%)
  - Sold: 30 units (20%)
  - SHS/Incoming: 12 units (8%)
  - Returned/Repair: 4 units (3%)

---

## Platform Commission Testing

### eBay (12.8% + £0.30)
- **Test Units**: Multiple iPhones, iPads, Samsung devices, Tablets
- **Profit Scenarios**:
  - High markup: iPhone 15 Pro sold at £1,099 (BP £850) = £177.93 profit
  - Normal markup: iPhone 14 sold at £529 (BP £550) = Loss scenario
  - Medium markup: Various Galaxy S devices

### Amazon (8% fee)
- **Test Units**: iPad Pro, Galaxy S24 Ultra, iPhones
- **Scenarios**:
  - Profit: iPad Air sold at £649 (BP £600) = £38.58 net profit
  - Premium pricing: Galaxy S24 Ultra sold at £1,099 (BP £1,020)

### OnBuy (9% fee)
- **Test Units**: iPhone 13, Galaxy S24
- **Price Points**: Standard markup testing

### Backmarket (10% fee)
- **Test Units**: iPad Pro, Galaxy A54, Tablets
- **Specialization**: Budget device testing

---

## Profit/Loss Scenario Testing

### Profitable Sales (20+ units)
- iPhone 15 Pro: BP £850, Sold £1,099 ✓ Profit
- iPad Pro: BP £850, Sold £899 ✓ Profit
- Galaxy S24 Ultra: BP £1,020, Sold £1,099 ✓ Profit

### Loss Scenarios (5+ units)
- iPhone 15: BP £720, Sold £699 ✗ Loss
- iPhone 14: BP £550, Sold £529 ✗ Loss  
- iPhone 13: BP £450, Sold £499 ✗ Loss (with fees exceeds sale price)
- Galaxy A34: BP £280, Sold £199 ✗ Loss

**Notification Testing**: Loss sales trigger RED loss_sell notification with warning sound

---

## Inventory Status Transitions

### Available Stock (104 units)
- Ready for listing on platforms
- Various colors and storage options
- 66 units actively listed on 1-2 platforms
- Top 10 focus items flagged for priority

### Sold Units (30 units)
- Distributed across all platforms
- Multiple sales dates (April 25 - May 4)
- Complete sale records with:
  - Sale price
  - Platform
  - Order ID (platform-specific format)
  - Postage cost
  - Timestamp

### SHS/Incoming (12 units)
- Supplier holding stock (IMAX, TechSource, etc.)
- Expected delivery dates
- No IMEI yet (waiting for dispatch)
- shs_received notification trigger testing

### Returned/Repair (4 units)
- return_processed notification testing
- Return types covered:
  - returned_to_inventory (customer changed mind)
  - returned_to_supplier (defect)
  - repair (screen issue, battery issue)
- Return reasons tracked

---

## Product Category Coverage

| Category | Count | Scenarios | Key Models |
|----------|-------|-----------|-----------|
| iPhone | 52 | Flagship + budget, multiple generations | 15 Pro Max, 15 Pro, 15, 14 Pro, 14, 13 |
| iPad | 35 | Pro, Air, standard, Mini - full range | iPad Pro 12.9, Air, 10th Gen, Mini |
| Samsung S Series | 27 | Flagship testing, premium pricing | S24 Ultra, S24+, S24, S23 |
| Samsung A Series | 17 | Mid-range, budget scenarios | A54, A34, A24 |
| Tablet | 12 | Android tablet scenarios | Tab S9 Ultra, Tab S9, Tab A |
| Apple Watch | 7 | Wearables, small margins | Series 9, SE |

---

## Production Readiness Features

✓ **Data Integrity**: Consistent field names and types
✓ **IMEI Generation**: Valid 15-digit IMEI for available units
✓ **SHS Handling**: Empty IMEI for incoming units
✓ **Timestamps**: ISO 8601 format for all dates
✓ **Supplier IDs**: Consistent references across units
✓ **Owner Field**: All units marked "shared" for demo
✓ **Flags**: Top 10 focus items flagged appropriately
✓ **Platform References**: eBay, Amazon, OnBuy, Backmarket only
✓ **Return Data**: Complete return type, date, and reason fields
✓ **Status Values**: Only valid statuses (available, sold, incoming, returned)

---

## Recommended QA Test Plan Using This Data

### Day 1: Basic Functionality
- [ ] Load mock data via reset screen
- [ ] Verify 150 units appear across all views
- [ ] Check supplier data loads correctly
- [ ] Confirm status distribution in dashboard

### Day 2: Platform Commission Testing
- [ ] Record 5 sales on eBay → verify 12.8% + £0.30 calculation
- [ ] Record 5 sales on Amazon → verify 8% calculation
- [ ] Record sales on OnBuy, Backmarket → verify commissions
- [ ] Verify net profit calculations in sold history

### Day 3: Loss/Profit Scenarios
- [ ] Create new sale at loss → verify RED color, notification
- [ ] Create profitable sale → verify GREEN color, notification
- [ ] Check notification center shows all 5 types with icons
- [ ] Verify sounds are different for loss vs profit

### Day 4: Return Processing
- [ ] Process 5 different returns
- [ ] Verify return_processed notifications
- [ ] Test all return types (inventory, supplier, repair)
- [ ] Check units properly restored to available if applicable

### Day 5: SHS & Incoming
- [ ] Add 10 new SHS units
- [ ] Verify shs_received notifications
- [ ] Process SHS received with IMEI
- [ ] Confirm units move to available status

### Day 6: Inventory Reconciliation
- [ ] Check listing sync status for all models
- [ ] Verify oversell warnings trigger
- [ ] Test quick-list suggestions for unlisted units
- [ ] Reconcile physical vs platform count

### Day 7: Reporting & Analytics
- [ ] Run daily sales report
- [ ] Check weekly profit/loss breakdown
- [ ] Verify reorder alerts show correctly
- [ ] Confirm sell-through % calculations
- [ ] Check average sell time calculations

---

## Data Generation Command

To regenerate fresh mock data:
```bash
python3 generate-mock-data.py > mock-data-150.json
```

This will create a new randomized dataset while maintaining:
- Same structure and field coverage
- Same proportion distributions (69% available, 20% sold, etc.)
- Realistic price variations
- All test scenarios covered
