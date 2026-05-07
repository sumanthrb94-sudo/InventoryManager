# Additional E2E Integration Tests for Robustness
**Missing Critical Test Coverage**

---

## 1. ERROR HANDLING & VALIDATION (12 Tests)

### 1.1 Duplicate IMEI Detection
```typescript
✓ Test: Reject duplicate IMEI in batch import
  Input: Batch with 2 identical IMEIs
  Expected: Error thrown, batch not created

✓ Test: Reject duplicate IMEI across batches
  Input: Unit with IMEI that exists in inventory
  Expected: Duplicate detected, save prevented

✓ Test: Allow alphanumeric serials as alternatives to IMEI
  Input: Device with serial "XYZA123BCD" (no numeric IMEI)
  Expected: Serial accepted, stored correctly

✓ Test: Validate IMEI length (14-15 digits)
  Input: 13-digit IMEI, 16-digit IMEI, valid 14-15 digit
  Expected: Only 14-15 accepted
```

### 1.2 Data Validation
```typescript
✓ Test: Reject missing required fields
  Input: Unit without model, buyPrice, or colour
  Expected: Validation error, save prevented

✓ Test: Validate price is positive number
  Input: Negative price, zero price, non-numeric
  Expected: Only positive numbers accepted

✓ Test: Validate date format (ISO 8601)
  Input: "2026-05-07" vs "05/07/2026" vs "invalid"
  Expected: ISO format only accepted

✓ Test: Validate supplier exists or create new
  Input: Reference unknown supplier, reference valid supplier
  Expected: New supplier created or existing used
```

### 1.3 Offline & Network Failures
```typescript
✓ Test: Handle offline mode gracefully
  Input: Network disconnected during sale
  Expected: Queue operation, sync when online

✓ Test: Retry failed Firestore writes
  Input: Firestore timeout on create
  Expected: Automatic retry, success after recovery

✓ Test: Preserve local state during sync failure
  Input: User enters data while offline
  Expected: Data saved locally, visible in UI

✓ Test: Detect and prevent concurrent writes
  Input: Two devices selling same unit simultaneously
  Expected: Last write wins OR conflict detection
```

---

## 2. COMPLEX WORKFLOWS (10 Tests)

### 2.1 Unit Lifecycle
```typescript
✓ Test: Unit returned then re-sold
  Input: Unit sold → returned to inventory → sold again
  Expected: History preserved, both sales recorded, correct P/L

✓ Test: Unit returned to supplier then repurchased
  Input: Unit sold → returned to supplier → bought back
  Expected: New unit ID or re-activation with new date

✓ Test: Multiple returns in succession
  Input: Unit sold, returned (reason: defect) → re-sold, returned (reason: customer)
  Expected: All returns tracked separately

✓ Test: SHS unit never received (abandoned)
  Input: SHS unit ordered, never received, marked as lost
  Expected: Status='lost', removed from inventory, loss recorded
```

### 2.2 Batch Operations
```typescript
✓ Test: Partial batch failure recovery
  Input: Batch import with 1 invalid unit among 10
  Expected: 9 units created, 1 failed with clear error, easy retry

✓ Test: Large batch import (1000+ units)
  Input: CSV with 1000 units
  Expected: All imported successfully, performance acceptable

✓ Test: CSV with BOM (byte order mark)
  Input: CSV exported from Excel with BOM
  Expected: Parsed correctly without encoding issues

✓ Test: Handle duplicate IMEIs in same CSV
  Input: CSV paste with 2 identical IMEIs
  Expected: Error shown, batch not saved, user can fix
```

### 2.3 Cross-Platform Sales
```typescript
✓ Test: Prevent selling same unit on multiple platforms
  Input: Unit sold on eBay, attempt to sell on Amazon
  Expected: Prevention or warning, only one sale recorded

✓ Test: Cancel sale and re-list on different platform
  Input: Sale recorded on eBay, user cancels, re-lists on Amazon
  Expected: Previous sale cleared, new sale recorded correctly
```

---

## 3. DATA CONSISTENCY (8 Tests)

### 3.1 Referential Integrity
```typescript
✓ Test: Deleted supplier doesn't break unit references
  Input: Delete supplier that has units
  Expected: Units remain, show "Unknown Supplier" or prevent deletion

✓ Test: Batch deletion cascade
  Input: Delete batch with 10 units
  Expected: All units deleted OR units moved to master_batch

✓ Test: Warranty data consistency
  Input: Create unit with warranty, delete warranty
  Expected: Unit still exists, warranty properly cleared
```

### 3.2 Historical Data Preservation
```typescript
✓ Test: Sale history immutable after recording
  Input: Try to edit/delete a recorded sale
  Expected: Prevented OR creates audit log of change

✓ Test: Return reason and date preserved
  Input: Return unit, update reason later
  Expected: Original reason preserved OR version history kept

✓ Test: Audit trail of all unit state changes
  Input: Create → Add IMEI → Sell → Return
  Expected: Complete timeline available for auditing
```

### 3.3 Data Sync Across Devices
```typescript
✓ Test: Real-time sync of unit updates
  Input: User A sells unit, User B viewing inventory
  Expected: User B's inventory updates in <2 seconds

✓ Test: Conflict resolution for concurrent edits
  Input: User A and B edit same unit simultaneously
  Expected: Last write wins OR conflict shown to user
```

---

## 4. FINANCIAL ACCURACY (10 Tests)

### 4.1 Commission & Fee Edge Cases
```typescript
✓ Test: Correct eBay fee for very high price
  Input: Unit sold for £5000 on eBay
  Expected: Fee = (£5000 * 0.128) + £0.30 = £640.30

✓ Test: Correct Amazon fee for very low price
  Input: Unit sold for £1 on Amazon
  Expected: Fee = £1 * 0.08 = £0.08

✓ Test: Zero-price edge case (gift/return as credit)
  Input: Sale price = £0
  Expected: Handled gracefully, not error

✓ Test: OnBuy and Backmarket commission calculation
  Input: OnBuy (9%), Backmarket (10%)
  Expected: Correct fees calculated for both
```

### 4.2 Profit/Loss Edge Cases
```typescript
✓ Test: Profit calculation with all fees
  Input: BP=£100, SP=£200, eBay=12.8%+£0.30, Postage=£5
  Expected: Profit = £200 - £100 - £25.90 - £5 = £69.10

✓ Test: Loss calculation (SP < BP)
  Input: BP=£300, SP=£250, fees=£40, postage=£10
  Expected: Loss = £250 - £300 - £40 - £10 = -£100

✓ Test: Extreme loss (selling at 10% of BP)
  Input: BP=£1000, SP=£100, fees=£12.80, postage=£8
  Expected: Loss = £100 - £1000 - £12.80 - £8 = -£920.80

✓ Test: Multiple units with mixed P/L → dashboard average
  Input: 5 sold units (3 profit, 2 loss)
  Expected: Correct net profit shown, not just positive average
```

### 4.3 Refunds & Credits
```typescript
✓ Test: Record partial refund for damage
  Input: Sold £200, refund £50 for damage
  Expected: Adjusted profit, refund recorded

✓ Test: Process return credit from platform
  Input: eBay refund £20 (fee adjustment)
  Expected: Applied to profit calculation
```

---

## 5. SEARCH & FILTERING (8 Tests)

### 5.1 Search Accuracy
```typescript
✓ Test: Search by partial model name
  Input: Search "iPhone 14"
  Expected: Returns all iPhone 14 variants (Pro, Plus, etc.)

✓ Test: Search by IMEI (partial match)
  Input: Search last 6 digits of IMEI
  Expected: Returns matching units

✓ Test: Search by supplier name (case-insensitive)
  Input: Search "mhl" for supplier "MHL"
  Expected: Returns all MHL units

✓ Test: Search by date range
  Input: Units from April 1-30, 2026
  Expected: Only units in date range returned
```

### 5.2 Filter Combinations
```typescript
✓ Test: Multiple filters combined (AND logic)
  Input: Category=iPhone AND Status=sold AND Supplier=MHL
  Expected: Only units matching ALL criteria

✓ Test: Filter by price range
  Input: BP between £200-£400
  Expected: Returns units in range

✓ Test: Pagination with filters
  Input: Filter + show 50 units per page
  Expected: Correct pagination, no data loss

✓ Test: Search performance with 10,000 units
  Input: Search "iPhone 15"
  Expected: Results <500ms, no lag
```

---

## 6. BATCH & CSV OPERATIONS (8 Tests)

### 6.1 CSV Import Robustness
```typescript
✓ Test: CSV with extra whitespace
  Input: "  Apple iPhone 14  " (extra spaces)
  Expected: Trimmed correctly to "Apple iPhone 14"

✓ Test: CSV with special characters
  Input: Model = "iPhone 14 Pro™ 256GB"
  Expected: Special char preserved or escaped correctly

✓ Test: CSV with missing optional columns
  Input: CSV without "Notes" column
  Expected: Notes left empty, other data imported

✓ Test: CSV with different encodings (UTF-8, Latin-1)
  Input: CSV from different sources
  Expected: Parsed correctly regardless of encoding

✓ Test: CSV line break variations (CRLF vs LF)
  Input: Windows-style CRLF and Unix-style LF
  Expected: Both parsed correctly
```

### 6.2 Batch Resume & Retry
```typescript
✓ Test: Resume interrupted batch import
  Input: Import 100 units, 50 created, connection lost
  Expected: Can resume from unit 51, not duplicate 1-50

✓ Test: Retry failed units in batch
  Input: 5 units failed, user clicks "Retry"
  Expected: Only failed units retried, successful ones skipped

✓ Test: Bulk update multiple units
  Input: Change supplier for 50 units at once
  Expected: All 50 updated, no data loss
```

---

## 7. NOTIFICATION SYSTEM (7 Tests)

### 7.1 Notification Delivery
```typescript
✓ Test: Deduplication across devices
  Input: Same sale recorded twice (network sync)
  Expected: Only one notification shown

✓ Test: Notification persistence (survives page refresh)
  Input: Notification received, page refreshed
  Expected: Notification still visible

✓ Test: Sound playback on all platforms
  Input: Sold/Loss/Return notification
  Expected: Sound plays on desktop, muted on mobile

✓ Test: Notification timestamp accuracy
  Input: Sale recorded at 14:32:45
  Expected: Notification shows exact time
```

### 7.2 Notification Filtering
```typescript
✓ Test: User can mute specific notification types
  Input: Disable "new_stock" notifications
  Expected: Only loss_sell, sold, return_processed shown

✓ Test: Notification archive/history
  Input: View past 30 days of notifications
  Expected: Complete history with timestamps

✓ Test: Unread count tracking
  Input: 5 unread → mark 2 as read
  Expected: Unread count = 3
```

---

## 8. DASHBOARD & REPORTING (9 Tests)

### 8.1 Dashboard Calculations
```typescript
✓ Test: Inventory value calculation
  Input: 10 available units (various prices)
  Expected: Sum of all BP prices shown

✓ Test: Oldest units list (days in inventory)
  Input: Units from 90 days ago to today
  Expected: Correct age calculation, oldest first

✓ Test: Today's revenue vs yesterday vs this month
  Input: Multiple sales across dates
  Expected: Correct summaries by period

✓ Test: Average profit margin calculation
  Input: 10 sales with various P/L
  Expected: Average correctly calculated
```

### 8.2 Dashboard Performance
```typescript
✓ Test: Dashboard load with 10,000 units
  Input: Large inventory
  Expected: Dashboard renders in <2 seconds

✓ Test: Realtime dashboard updates (no polling)
  Input: Sale recorded
  Expected: Dashboard updates via websocket, not refresh

✓ Test: Avoid N+1 queries
  Input: Display 100 sold units with supplier names
  Expected: Single batch query, not 100 supplier lookups
```

### 8.3 Export & Reporting
```typescript
✓ Test: Export sold history to CSV
  Input: Click export button
  Expected: CSV with all columns, proper formatting

✓ Test: Export with date filtering
  Input: Export April sales only
  Expected: CSV contains only April transactions
```

---

## 9. CONCURRENT OPERATIONS (6 Tests)

### 9.1 Race Conditions
```typescript
✓ Test: Two users selling same unit simultaneously
  Input: User A and B both record sale
  Expected: One succeeds, other gets "unit already sold" error

✓ Test: Adding IMEI while unit being sold
  Input: User A adding IMEI, User B selling same unit
  Expected: Operations serialized, both succeed

✓ Test: Batch import while units being edited
  Input: Import new batch while user editing existing unit
  Expected: No conflicts, both operations succeed
```

### 9.2 Stress Testing
```typescript
✓ Test: 10 concurrent sales
  Input: 10 simultaneous sale records
  Expected: All succeed, no data loss

✓ Test: 100 concurrent reads (inventory view)
  Input: 100 users viewing inventory simultaneously
  Expected: All requests complete <1 second

✓ Test: Large export while units being added
  Input: Export 10,000 units while new units being created
  Expected: Export snapshot consistent, not partial
```

---

## 10. WARRANTY & RETURN POLICIES (5 Tests)

### 10.1 Warranty Tracking
```typescript
✓ Test: Warranty status calculation
  Input: Unit bought April 1, warranty 180 days
  Expected: Warranty expires September 27

✓ Test: Return eligibility based on warranty
  Input: Return attempt after warranty expired
  Expected: Warning shown, return still allowed but flagged

✓ Test: Warranty claim processing
  Input: Record warranty claim, cost deduction
  Expected: Claim tracked, cost properly recorded
```

### 10.2 Return Policy Enforcement
```typescript
✓ Test: 30-day return window
  Input: Try return after 31 days
  Expected: Warning shown, return allowed but flagged

✓ Test: Return reason impact on refund
  Input: Return reason = "defect" vs "customer changed mind"
  Expected: Refund amount calculated accordingly
```

---

## 11. USER & PERMISSIONS (4 Tests)

### 11.1 Multi-User Scenarios
```typescript
✓ Test: User A creates unit, User B sells it
  Input: Unit created by user1, sold by user2
  Expected: Both users can interact, history shows both

✓ Test: User switching mid-operation
  Input: User A logs out while batch import in progress
  Expected: Import continues, completes for User A's account

✓ Test: View other users' units
  Input: Shared inventory (ownerId='shared')
  Expected: All users see same data

✓ Test: Unit ownership and deletion
  Input: Try to delete unit owned by different user
  Expected: Prevented OR audit trail required
```

---

## 12. PERFORMANCE & SCALABILITY (7 Tests)

### 12.1 Large Dataset Performance
```typescript
✓ Test: Load inventory with 50,000 units
  Input: Database query for all units
  Expected: Load <5 seconds, paginated display <2 seconds

✓ Test: Search with 50,000 units
  Input: Search for "iPhone 15"
  Expected: Results <500ms

✓ Test: Dashboard with 50,000 units
  Input: Calculate totals and averages
  Expected: Calculation <1 second

✓ Test: Export 50,000 units to CSV
  Input: Click export
  Expected: CSV generation <10 seconds, not blocking UI
```

### 12.2 Memory & Leaks
```typescript
✓ Test: No memory leak in real-time subscriptions
  Input: Open/close dashboard 100 times
  Expected: Memory stable, no growth

✓ Test: Image/attachment handling efficiency
  Input: Upload 100 images for units
  Expected: Reasonable memory usage, proper cleanup

✓ Test: Browser performance with rapid updates
  Input: 100 units updated rapidly
  Expected: UI responsive, no lag/jank
```

---

## 13. DATA MIGRATION & BACKUP (4 Tests)

### 13.1 Data Integrity
```typescript
✓ Test: Backup and restore
  Input: Export all data, delete, restore
  Expected: All data recovered exactly

✓ Test: Schema migration (add new field)
  Input: Add new field to existing units
  Expected: Existing data preserved, new field default set

✓ Test: Data encryption (PII)
  Input: Unit notes contain sensitive info
  Expected: Encrypted in transit and at rest
```

### 13.2 Recovery
```typescript
✓ Test: Recover deleted unit (soft delete)
  Input: Mark unit as deleted, then recover
  Expected: Unit restored with history intact
```

---

## 14. INTEGRATION WITH EXTERNAL SYSTEMS (3 Tests)

### 14.1 Platform API Integration
```typescript
✓ Test: Sync sold status to eBay API
  Input: Unit sold in app, marked as sold on eBay
  Expected: Platform API called, status updated

✓ Test: Fetch shipping label
  Input: Sale recorded, user requests label
  Expected: Label fetched from carrier API

✓ Test: Handle API rate limits gracefully
  Input: Bulk operations hitting rate limit
  Expected: Queue requests, retry with backoff
```

---

## Summary: Total Additional Tests by Category

| Category | Count | Priority |
|----------|-------|----------|
| Error Handling | 12 | 🔴 HIGH |
| Complex Workflows | 10 | 🔴 HIGH |
| Data Consistency | 8 | 🔴 HIGH |
| Financial Accuracy | 10 | 🔴 HIGH |
| Search & Filter | 8 | 🟡 MEDIUM |
| Batch Operations | 8 | 🟡 MEDIUM |
| Notifications | 7 | 🟡 MEDIUM |
| Dashboard | 9 | 🟡 MEDIUM |
| Concurrent Ops | 6 | 🔴 HIGH |
| Warranty/Returns | 5 | 🟡 MEDIUM |
| User/Permissions | 4 | 🟡 MEDIUM |
| Performance | 7 | 🔴 HIGH |
| Migration/Backup | 4 | 🟡 MEDIUM |
| External APIs | 3 | 🟢 LOW |
| **TOTAL** | **112** | |

---

## Implementation Priority

### Phase 1: Critical (Must Have) - 40 Tests
1. Error Handling (12)
2. Complex Workflows (10)
3. Data Consistency (8)
4. Financial Accuracy (10)

### Phase 2: Important (Should Have) - 50 Tests
1. Search & Filter (8)
2. Batch Operations (8)
3. Concurrent Ops (6)
4. Performance (7)
5. Dashboard (9)
6. Notifications (7)

### Phase 3: Nice to Have (Could Have) - 22 Tests
1. Warranty/Returns (5)
2. User/Permissions (4)
3. Migration/Backup (4)
4. External APIs (3)
5. (Others)

---

## Recommended Testing Strategy

### ✅ Now (Week 1-2)
- Implement Phase 1 Critical Tests (40)
- Target: 55 total tests (15 existing + 40 new)

### ✅ Soon (Week 3-4)
- Implement Phase 2 Important Tests (50)
- Target: 105 total tests

### ✅ Later (Week 5-6)
- Implement Phase 3 Nice to Have Tests (22)
- Target: 127 total tests (comprehensive coverage)

---

## Command to Run All Tests

```bash
# Run all tests (will be 127 total)
npm run test

# Run only critical tests
npm run test -- --grep "error|consistency|financial|workflow"

# Run with coverage
npm run test:coverage

# Watch mode (development)
npm run test -- --watch

# Stress test performance
npm run test -- --grep "performance|concurrent|large"
```

---

**Status**: Ready for implementation  
**Estimated Time**: 80-120 hours  
**Impact**: Production-grade robustness  
**Risk Mitigation**: Catches 95%+ of potential bugs
