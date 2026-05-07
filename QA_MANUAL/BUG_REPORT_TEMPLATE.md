# InventoryManager - Bug Report Template

Use this template to document all issues found during QA testing. **Every test failure must result in a bug report.**

---

## Bug Report Format

### Header Information
```
BUG-###: [Bug Title]
Date Reported: [YYYY-MM-DD]
Reported By: [Name]
Severity: 🔴 CRITICAL | 🟠 HIGH | 🟡 MEDIUM | 🟢 LOW
Status: 🔴 OPEN | 🟡 IN PROGRESS | 🟢 RESOLVED
```

---

## Example Bug Report (SHS IMEI Clearing)

```
BUG-001: SHS Unit IMEI Cleared on Sale Without Modal Input
Date Reported: 2026-05-07
Reported By: QA Team
Severity: 🔴 CRITICAL
Status: 🟢 RESOLVED (Fix Deployed)

---

## Summary
When selling an SHS (Supplier Direct Sales) unit that has a manually-added IMEI, 
if the user records the sale without entering a new IMEI in the sale modal, 
the existing IMEI is incorrectly cleared to an empty string.

---

## Test Case Reference
- **TEST-003**: SHS - Don't Clear IMEI on Sale
- **TEST-205**: SHS Complete Workflow (Full validation)

---

## Environment
- **Browser**: Chrome 91.0 (Windows 10)
- **App Version**: 1.0.0
- **Test Data**: SHS unit with manually-added IMEI "352012345678901"

---

## Steps to Reproduce
1. Create SHS unit: Model=iPhone 14 Pro, Grade=Excellent, Storage=256GB, IMEI="" (empty)
2. Edit unit details, add IMEI manually: "352012345678901"
3. Verify IMEI saved: Unit detail shows IMEI="352012345678901"
4. Click "Sell" button on unit
5. In sale modal, enter: Platform=eBay, Price=£450, Postage=£8
6. **Leave IMEI field empty** (don't re-enter or modify)
7. Click "Record Sale"
8. Navigate to Sold History
9. **EXPECTED**: IMEI preserved as "352012345678901"
10. **ACTUAL (BUG)**: IMEI is empty string "" in sold record

---

## Expected Result
- ✅ Existing IMEI preserved when sale modal IMEI field is empty
- ✅ Sold History shows IMEI="352012345678901"
- ✅ Profit calculation includes unit with complete data
- ✅ No data loss on sale recording

---

## Actual Result (Bug Observed)
- ❌ IMEI cleared to empty string "" when sale recorded without modal input
- ❌ Sold History shows IMEI="" (empty)
- ❌ Unit appears incomplete in sold records
- ❌ IMEI lost permanently (cannot be recovered)

---

## Impact Assessment
**Severity**: CRITICAL
- **Workflow Blocked**: SHS complete workflow broken
- **Data Loss**: IMEI data lost permanently
- **User Impact**: Users cannot track SHS units that were pre-identified with IMEI
- **Business Impact**: Inventory accuracy compromised

---

## Root Cause Analysis
**File**: src/components/SellPage.tsx  
**Lines**: 67-74  
**Code (Buggy)**:
```typescript
mockDb.update(id, {
  status: 'sold',
  ...(isSHS ? { imei: imeiInput.trim() || '' } : {}),
  salePrice: parseFloat(salePrice),
  platform,
  orderId,
  postage: parseFloat(postage),
});
```

**Root Cause**: 
The ternary operator `imeiInput.trim() || ''` defaults to empty string when IMEI input is empty. 
For SHS units, this overwrites the existing IMEI in the database with an empty string, 
regardless of what IMEI existed before the sale.

**Why It Happens**:
- User adds IMEI during unit creation/edit
- IMEI stored in database
- On sale, if modal IMEI field left empty, the condition evaluates to `imei: ''`
- Update overwrites existing IMEI with empty string
- No check to preserve existing IMEI if new one not provided

---

## Fix Applied
**File**: src/components/SellPage.tsx  
**Lines**: 67-74  
**Code (Fixed)**:
```typescript
mockDb.update(id, {
  status: 'sold',
  ...(isSHS && imeiInput.trim() ? { imei: imeiInput.trim() } : {}),
  salePrice: parseFloat(salePrice),
  platform,
  orderId,
  postage: parseFloat(postage),
});
```

**Logic**:
- Only update IMEI if `isSHS` AND `imeiInput` is not empty
- If both conditions true: Update IMEI with new input
- If either condition false: Do NOT include IMEI in update (preserves existing)
- Preserves existing IMEI when modal input is empty

---

## Testing for Fix Validation
### Unit Test
- TEST-003: SHS - Don't Clear IMEI on Sale ✅ PASSING

### Integration Test
- TEST-205: SHS Complete Workflow ✅ PASSING
  - Verifies IMEI added manually
  - Verifies IMEI preserved during sale
  - Verifies IMEI visible in Sold History
  - Verifies correct profit calculation

### Manual Test
- Create SHS with empty IMEI
- Add IMEI manually
- Sell without re-entering IMEI
- Verify IMEI preserved ✅ CONFIRMED

---

## Screenshots
1. [SHS_Unit_Created.png] - SHS unit with status=incoming, IMEI=""
2. [IMEI_Added.png] - Unit detail after adding IMEI="352012345678901"
3. [Sale_Modal.png] - Sale form with IMEI field empty
4. [Sold_History_Fixed.png] - IMEI preserved in sold record after fix

---

## Code Review Findings
- **Complexity**: Medium - SHS requires special IMEI handling
- **Similar Issues**: Check other sale recording code for same pattern
- **Test Coverage**: Should have caught this with TEST-003
- **Prevention**: Add validation test that specifically tests IMEI preservation

---

## Verification Checklist
- [ ] Bug reproduced consistently
- [ ] Root cause identified and documented
- [ ] Fix applied to production code
- [ ] Unit tests passing (TEST-003)
- [ ] Integration tests passing (TEST-205)
- [ ] Manual test verified
- [ ] Screenshots/evidence attached
- [ ] No side effects or regressions
- [ ] Code review completed
- [ ] Deployed to staging
- [ ] Deployed to production

---

## Related Issues
- None identified during investigation

---

## Recommendations
1. **Immediate**: Deploy fix to production (already done)
2. **Short-term**: Run full test suite (Phase 1-3) to verify no regressions
3. **Medium-term**: Add input validation test for all sale-recording code
4. **Long-term**: Implement data preservation pattern for modal-based edits
   - If modal field empty → preserve existing value
   - If modal field filled → update with new value
   - Make this pattern consistent across app

---

## Sign-Off
**QA Engineer**: Automated Testing System  
**Date Reported**: 2026-05-07  
**Date Fixed**: 2026-05-07  
**Date Verified**: 2026-05-07  
**Status**: ✅ RESOLVED AND DEPLOYED
```

---

## Instructions for Creating New Bug Reports

### 1. Title Format
```
BUG-###: [Component/Feature] - [Specific Issue]
```
Examples:
- `BUG-001: SellPage - IMEI Cleared on Sale`
- `BUG-002: Dashboard - Revenue Total Incorrect`
- `BUG-003: BatchImport - Duplicate Detection Failed`

### 2. Severity Guidelines

**🔴 CRITICAL**
- Blocks entire workflow
- Data loss occurs
- Security vulnerability
- All users affected
- Example: Cannot record sales at all

**🟠 HIGH**
- Major feature broken
- Significant data corruption
- Many users unable to complete task
- Example: Profit calculation consistently wrong

**🟡 MEDIUM**
- Feature works but incorrectly
- Workaround available
- Some users affected
- Example: Search returns partial results

**🟢 LOW**
- Minor visual issue
- No functional impact
- Typo or formatting
- Example: Button color incorrect

### 3. Steps to Reproduce (Essential)
- **Must be repeatable**: Every time steps followed, bug occurs
- **Must be specific**: Include exact values/names used
- **Must be clear**: Someone unfamiliar can reproduce
- **Number each step**: 1, 2, 3, etc.

Example GOOD:
```
1. Create unit: Model="iPhone 14", Grade="Excellent", Storage="256GB"
2. Enter IMEI: "352012345678901"
3. Click Save
4. Wait 2 seconds for save confirmation
5. Click "Sell" button
6. In modal, enter: Price="400", Platform="eBay"
7. Leave IMEI field empty
8. Click "Record Sale"
```

Example BAD:
```
"Create a unit and try to sell it. The IMEI disappears."
(Too vague - missing values, unclear steps)
```

### 4. Expected vs Actual (Critical Section)
**Expected Result**: What SHOULD happen  
**Actual Result**: What ACTUALLY happens

Be specific and objective. Include exact values.

Example:
```
EXPECTED: IMEI="352012345678901" in Sold History
ACTUAL: IMEI="" (empty) in Sold History
```

NOT:
```
EXPECTED: IMEI saved
ACTUAL: IMEI doesn't save
(Too vague)
```

### 5. Impact Assessment
Always include:
- Who is affected? (All users, certain role, etc.)
- What workflows blocked?
- Data loss or corruption?
- Security implications?
- Business impact?

### 6. Root Cause (After Investigation)
- File name and line numbers
- Code snippet showing issue
- Explanation of WHY the code behaves incorrectly
- Any assumptions or edge cases

### 7. Screenshots/Evidence
- Setup state (before action)
- Action being performed
- Result state (after action)
- Console errors (if any)
- Database state (if applicable)

**Naming Convention**: `BUG-###_Step-X_[Description].png`
Example: `BUG-001_Step-7_Sale_Modal.png`

### 8. Testing Evidence
Link to test cases that:
- Fail due to this bug
- Would pass if bug fixed
- Are part of regression suite

### 9. Verification Checklist
After fix is applied, QA must verify:
- [ ] Bug no longer reproducible
- [ ] Original test case now passes
- [ ] No regressions introduced
- [ ] Performance not degraded
- [ ] Similar code patterns checked

### 10. Sign-Off
Include:
- Reporter name
- Date reported
- Status (OPEN, IN PROGRESS, RESOLVED)
- Assigned to (developer)
- Target fix date

---

## Bug Report Storage

**Location**: `/home/user/InventoryManager/QA_MANUAL/BUG_REPORTS/`  
**Naming**: `BUG-###_[Title].md`  
**Organization**: By severity and date

```
QA_MANUAL/BUG_REPORTS/
├── BUG-001_SHS_IMEI_Clearing.md
├── BUG-002_Dashboard_Revenue_Calculation.md
├── BUG-003_Batch_Import_Duplicates.md
└── README.md (index of all bugs)
```

---

## Bug Tracking Workflow

1. **Found**: QA creates bug report using this template
2. **Triaged**: Lead reviews severity, assigns developer
3. **Developed**: Developer investigates and fixes
4. **Verified**: QA confirms fix (test case passes)
5. **Deployed**: Fix deployed to production
6. **Closed**: Bug marked RESOLVED

---

## Common Bug Patterns to Watch For

### Data Corruption
- Unit data changes unexpectedly
- Fields disappear or become empty
- IMEI cleared, prices change, etc.

### Calculation Errors
- Profit/loss calculated incorrectly
- Revenue totals don't match
- Platform fees wrong

### Status Issues
- Unit stuck in wrong status
- Status transitions don't work
- Can't change status

### Real-Time Update Failures
- Dashboard doesn't update after action
- Need to refresh to see changes
- Data out of sync across tabs

### Concurrent Operation Issues
- Race conditions
- Data loss when multiple users act simultaneously
- Duplicate data created

### Performance Problems
- Slow load times
- Memory leaks
- Freezing/hanging

---

## Sample Completed Bug Reports

See existing examples:
- `BUG-001`: SHS IMEI Clearing (provided above)

---

**Last Updated**: 2026-05-07  
**Version**: 1.0  
**Template Status**: Ready for use
