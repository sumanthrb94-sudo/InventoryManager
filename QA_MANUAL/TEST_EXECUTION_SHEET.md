# InventoryManager - Test Execution Sheet
**Tracking & Sign-Off for QA Testing Cycles**

---

## Test Execution Overview

This sheet tracks the execution of all 127 test cases across 5 phases and provides sign-off documentation.

**Current Test Cycle**: [Enter date, e.g., 2026-05-07 to 2026-05-10]  
**QA Tester**: [Enter name]  
**Team Lead**: [Enter name]  
**Date Started**: [YYYY-MM-DD]  
**Date Completed**: [YYYY-MM-DD]

---

## Phase 0: Existing Tests (15 Tests)

### Test Execution Summary

| Test ID | Test Name | Status | Time | Notes |
|---------|-----------|--------|------|-------|
| TEST-001 | Create SHS with incoming status | ⬜ Not Started | 10 min | |
| TEST-002 | Add IMEI to SHS | ⬜ Not Started | 8 min | |
| TEST-003 | Preserve IMEI on sale (BUG FIX) | ⬜ Not Started | 12 min | **CRITICAL** |
| TEST-004 | SHS in Sold History | ⬜ Not Started | 10 min | |
| TEST-005 | Notification with profit | ⬜ Not Started | 8 min | |
| TEST-006 | Batch import | ⬜ Not Started | 10 min | |
| TEST-007 | Filter by category | ⬜ Not Started | 8 min | |
| TEST-008 | Sell independently | ⬜ Not Started | 15 min | |
| TEST-009 | Batch totals | ⬜ Not Started | 8 min | |
| TEST-010 | Barcode auto-populate | ⬜ Not Started | 10 min | |
| TEST-011 | Sell scanned unit | ⬜ Not Started | 8 min | |
| TEST-012 | Return to inventory | ⬜ Not Started | 10 min | |
| TEST-013 | Return to supplier | ⬜ Not Started | 10 min | |
| TEST-014 | Dashboard totals | ⬜ Not Started | 12 min | |
| TEST-015 | Latest sales first | ⬜ Not Started | 10 min | |

**Phase 0 Summary**
- **Total Tests**: 15
- **Target Time**: 2.6 hours
- **Critical Tests**: 1 (TEST-003)
- **Pass Rate Target**: 100%

---

## Phase 1: Critical Tests (40 Tests)

### Section 1.1: Error Handling & Validation (12 Tests)

| Test ID | Test Name | Status | Pass/Fail | Time | Issues |
|---------|-----------|--------|-----------|------|--------|
| TEST-101 | Invalid IMEI (Empty) | ⬜ | — | — | |
| TEST-102 | Invalid IMEI (Too Short) | ⬜ | — | — | |
| TEST-103 | Invalid IMEI (Special Chars) | ⬜ | — | — | |
| TEST-104 | Duplicate IMEI Detection | ⬜ | — | — | |
| TEST-105 | Null/Undefined Fields | ⬜ | — | — | |
| TEST-106 | Batch Import - Invalid CSV | ⬜ | — | — | |
| TEST-107 | Batch Import - Duplicates | ⬜ | — | — | |
| TEST-108 | Sale Price Validation | ⬜ | — | — | |
| TEST-109 | Missing Required Fields | ⬜ | — | — | |
| TEST-110 | Invalid Return Type | ⬜ | — | — | |
| TEST-111 | SHS Status Constraints | ⬜ | — | — | |
| TEST-112 | Unsupported Platform | ⬜ | — | — | |

### Section 1.2: Complex Workflows (10 Tests)

| Test ID | Test Name | Status | Pass/Fail | Time | Issues |
|---------|-----------|--------|-----------|------|--------|
| TEST-201 | Multi-Platform Sales | ⬜ | — | — | |
| TEST-202 | Mixed Status Batch Import | ⬜ | — | — | |
| TEST-203 | Concurrent Operations | ⬜ | — | — | |
| TEST-204 | Return Full Data Cleanup | ⬜ | — | — | |
| TEST-205 | SHS Complete Workflow | ⬜ | — | — | **CRITICAL** |
| TEST-206 | Barcode Auto-Population | ⬜ | — | — | |
| TEST-207 | Batch Category Filter | ⬜ | — | — | |
| TEST-208 | Dashboard Real-Time Update | ⬜ | — | — | |
| TEST-209 | Multiple Suppliers Isolation | ⬜ | — | — | |
| TEST-210 | Edge Case Rounding | ⬜ | — | — | |

### Section 1.3: Data Consistency (8 Tests)

| Test ID | Test Name | Status | Pass/Fail | Time | Issues |
|---------|-----------|--------|-----------|------|--------|
| TEST-301 | Unit Status Integrity | ⬜ | — | — | |
| TEST-302 | Batch Integrity | ⬜ | — | — | |
| TEST-303 | Failed Operations Recovery | ⬜ | — | — | |
| TEST-304 | Inventory Count Accuracy | ⬜ | — | — | |
| TEST-305 | IMEI Uniqueness | ⬜ | — | — | **CRITICAL** |
| TEST-306 | Sale Data Completeness | ⬜ | — | — | |
| TEST-307 | Dashboard Totals Recalc | ⬜ | — | — | |
| TEST-308 | Historical Data Preservation | ⬜ | — | — | |

### Section 1.4: Financial Accuracy (10 Tests)

| Test ID | Test Name | Status | Pass/Fail | Time | Issues |
|---------|-----------|--------|-----------|------|--------|
| TEST-401 | eBay Fee (12.8% + £0.30) | ⬜ | — | — | **CRITICAL** |
| TEST-402 | Amazon Fee (8%) | ⬜ | — | — | **CRITICAL** |
| TEST-403 | OnBuy Fee (9%) | ⬜ | — | — | **CRITICAL** |
| TEST-404 | Backmarket Fee (10%) | ⬜ | — | — | **CRITICAL** |
| TEST-405 | Profit vs Loss Determination | ⬜ | — | — | |
| TEST-406 | Batch Financial Totals | ⬜ | — | — | |
| TEST-407 | Postage Variations | ⬜ | — | — | |
| TEST-408 | Revenue Totals | ⬜ | — | — | |
| TEST-409 | Profit/Loss Breakdown | ⬜ | — | — | |
| TEST-410 | Financial Data Persistence | ⬜ | — | — | |

**Phase 1 Summary**
- **Total Tests**: 40
- **Target Time**: 8 hours
- **Critical Tests**: 7 (TEST-205, 305, 401-404)
- **All Must Pass**: YES (gate for Phase 2)

---

## Phase 2: Important Tests (50 Tests)

### Quick Summary

| Section | Tests | Status | Pass | Fail | Time |
|---------|-------|--------|------|------|------|
| Search & Filtering | 8 | ⬜ | — | — | 1.5 hrs |
| Batch Operations | 8 | ⬜ | — | — | 2 hrs |
| Concurrent Operations | 6 | ⬜ | — | — | 1.5 hrs |
| Dashboard Accuracy | 9 | ⬜ | — | — | 2 hrs |
| Notifications | 7 | ⬜ | — | — | 1.5 hrs |
| Reporting & Analytics | 6 | ⬜ | — | — | 1.5 hrs |
| Advanced Filtering | 6 | ⬜ | — | — | 1.5 hrs |
| Integration Tests | 6 | ⬜ | — | — | 2 hrs |

**Phase 2 Summary**
- **Total Tests**: 50
- **Target Time**: 10 hours
- **Pass Rate Target**: 95%+

---

## Phase 3: Enhancement Tests (22 Tests)

### Quick Summary

| Category | Tests | Status | Pass | Fail | Time |
|----------|-------|--------|------|------|------|
| Warranty | 5 | ⬜ | — | — | 0.75 hrs |
| Permissions | 4 | ⬜ | — | — | 0.75 hrs |
| Performance | 7 | ⬜ | — | — | 1.5 hrs |
| Migration | 3 | ⬜ | — | — | 1 hr |
| API Integration | 3 | ⬜ | — | — | 0.5 hrs |
| Advanced | 2 | ⬜ | — | — | 0.5 hrs |
| Accessibility | 2 | ⬜ | — | — | 0.5 hrs |

**Phase 3 Summary**
- **Total Tests**: 22
- **Target Time**: 4.5 hours
- **Pass Rate Target**: 90%+ (optional features)

---

## Overall Test Results

### Summary Table

| Phase | Tests | Target | Passed | Failed | Pass Rate | Time |
|-------|-------|--------|--------|--------|-----------|------|
| **Phase 0** | 15 | 100% | — | — | — | 2.6h |
| **Phase 1** | 40 | 100% | — | — | — | 8h |
| **Phase 2** | 50 | 95% | — | — | — | 10h |
| **Phase 3** | 22 | 90% | — | — | — | 4.5h |
| **TOTAL** | **127** | **97%** | **—** | **—** | **—** | **24.1h** |

---

## Test Execution Details

### Entry Template for Each Test

```
## TEST-###: [Test Name]

**Date Executed**: [YYYY-MM-DD]  
**Time Spent**: [X min]  
**Status**: ✅ PASSED | ❌ FAILED | ⏭️ SKIPPED  

**Evidence**
- [ ] Screenshots attached: [file names]
- [ ] Console output clean
- [ ] Database verified

**Issues Encountered**
None / [List issues if failed]

**Notes**
[Any additional observations]

**Tester Signature**: [Name], [Time]
```

---

## Test Failure Documentation

### When Test Fails

1. **Do Not Continue** to next test
2. **Document Failure**:
   - Screenshot of failure
   - Steps to reproduce
   - Expected vs actual
3. **Create Bug Report**: Use BUG_REPORT_TEMPLATE.md
4. **Assign Bug ID**: BUG-###
5. **Link to Test**: Add BUG-### reference in test execution sheet
6. **Escalate if Critical**: Notify team lead immediately if CRITICAL severity

### Failure Example

```
## TEST-205: SHS Complete Workflow

Status: ❌ FAILED

Issue: IMEI not preserved on sale
Linked Bug: BUG-002_SHS_IMEI_Clearing
Severity: 🔴 CRITICAL
Screenshot: TEST-205_IMEI_Cleared.png

Root Cause: When selling SHS without re-entering IMEI, existing IMEI cleared
Expected: IMEI preserved in sold record
Actual: IMEI empty string in sold record

Action: Escalated to dev team, awaiting fix
```

---

## Sign-Off Requirements

### QA Tester Sign-Off

**Before submitting test results, verify:**

- [ ] All test cases executed in sequence
- [ ] All test steps followed exactly as written
- [ ] Expected results verified for each test
- [ ] No blockers preventing test execution
- [ ] All bugs documented with templates
- [ ] Screenshots attached for failed tests
- [ ] Test data in consistent state (reset between phases if needed)
- [ ] No untested test cases in report
- [ ] Pass/fail criteria understood and applied consistently

**Tester Name**: ________________  
**Signature**: ________________  
**Date**: ________________  

---

### Team Lead Review

**Before approving test cycle:**

- [ ] All tests executed with tester present or verified
- [ ] Failure root causes identified for all failed tests
- [ ] Risk assessment completed (critical failures documented)
- [ ] Go/No-go decision made:
  - [ ] **GO**: Proceed to next phase or production
  - [ ] **NO-GO**: Halt testing, fix critical issues first
- [ ] Budget/timeline impact assessed
- [ ] Dependencies on other teams identified
- [ ] Sign-off documentation complete

**Lead Name**: ________________  
**Decision**: GO / NO-GO  
**Signature**: ________________  
**Date**: ________________  

---

### Dev Team Sign-Off

**After reviewing failures:**

- [ ] All failures investigated
- [ ] Root causes documented
- [ ] Bugs triaged and prioritized
- [ ] Fixes planned for critical issues
- [ ] Timeline for fixes provided
- [ ] Regression risk assessed
- [ ] Re-test schedule scheduled

**Dev Lead Name**: ________________  
**Target Fix Date**: ________________  
**Signature**: ________________  
**Date**: ________________  

---

## Test Metrics & Reporting

### Metrics to Track

**Coverage**
```
Target: 127 tests
Executed: ___ tests
Blocked: ___ tests (couldn't run)
Skipped: ___ tests (deliberately skipped)

Coverage %: (Executed / Total) × 100 = ___%
Target: ≥ 95%
```

**Pass Rate**
```
Passed: ___ tests
Failed: ___ tests

Pass Rate %: (Passed / Executed) × 100 = ___%
Target Phase 0: 100%
Target Phase 1: 100%
Target Phase 2: ≥ 95%
Target Phase 3: ≥ 90%
```

**Severity Breakdown**
```
🔴 CRITICAL: ___ failures (MUST FIX)
🟠 HIGH: ___ failures (SHOULD FIX)
🟡 MEDIUM: ___ failures (NICE TO FIX)
🟢 LOW: ___ failures (LOWEST PRIORITY)
```

**Time Tracking**
```
Planned: 24.1 hours
Actual: ___ hours
Variance: ___ hours (over/under)

By Phase:
Phase 0: ___ / 2.6h
Phase 1: ___ / 8h
Phase 2: ___ / 10h
Phase 3: ___ / 4.5h
```

---

## Sample Completed Test Execution

```
## TEST-003: SHS - Preserve IMEI on Sale

Date Executed: 2026-05-07  
Time Spent: 12 minutes  
Status: ✅ PASSED

Evidence
- [x] Screenshots attached: TEST-003_Step1_Created.png, TEST-003_Step3_IMEI_Added.png, TEST-003_Step5_Sold.png
- [x] Console output clean (no errors)
- [x] Database verified: IMEI present in sold record

Issues Encountered
None. Bug fix working correctly. IMEI preserved as expected.

Notes
This test validates the critical SHS IMEI preservation bug fix. 
The fix ensures existing IMEI is not cleared when recording sale 
without modal input. Test passes consistently.

Tester Signature: QA Engineer, 10:45 AM
```

---

## Testing Cycle Schedule

### Recommended 3-Day Execution Plan

**Day 1: Critical Path (8 hours)**
- Phase 0 (2.6h): Existing passing tests (regression check)
- Phase 1: Section 1.1 (2h): Error handling
- Phase 1: Section 1.2 (2h): Complex workflows
- Phase 1: Section 1.3 (1.4h): Data consistency

**Day 2: Core Features (8 hours)**
- Phase 1: Section 1.4 (2.5h): Financial accuracy
- Phase 2: Sections 2.1-2.4 (5.5h): Search, batch, concurrent, dashboard

**Day 3: Robustness (8 hours)**
- Phase 2: Sections 2.5-2.8 (4h): Notifications, reporting, filtering, integration
- Phase 3: (4h): Enhancement tests

**Total**: 24 hours over 3 days

---

## Escalation Procedure

### During Test Execution

**If CRITICAL issue found**:
1. Stop current test
2. Document issue fully
3. Create BUG-### report
4. Notify team lead immediately (phone/Slack)
5. Mark test as BLOCKED (waiting for fix)
6. Wait for guidance from lead

**If Phase 1 not 100% pass**:
1. Do NOT proceed to Phase 2
2. All CRITICAL and HIGH severity bugs must be fixed first
3. Re-test failed cases before proceeding
4. Document all fixes and retests

**If multiple failures in single section**:
1. Investigate common root cause
2. Check if issue is environmental (cache, test data, etc.)
3. Report pattern to lead (e.g., "All batch import tests failing")
4. Possible fix: Reset test data, clear cache, restart browser

---

## Test Data Management

### Reset Procedures Between Tests

**Minimal Reset** (between individual tests):
- Just clear the specific unit/batch created in test
- Keep other inventory intact

**Full Reset** (between phases):
```javascript
// Run in browser console before Phase 2
localStorage.clear();
location.reload();
// Log back in
// Reimport baseline test data if needed
```

**Complete Fresh Start** (before Phase 0):
1. Clear all browser cache/cookies
2. Log out completely
3. Close all browser tabs
4. Restart browser
5. Log in fresh
6. Load test data seed

---

## Report Distribution

### After test cycle completes:

1. **Summary Report**: Share with stakeholders
   - Pass rate, critical issues, timeline impact
   - Recommended go/no-go decision

2. **Detailed Report**: Store in repo
   - Full test execution sheet
   - All bug reports
   - Screenshots and evidence
   - Sign-offs

3. **Next Steps Document**: Recommend actions
   - Priority fixes needed
   - Re-test schedule
   - Confidence level for production

---

## Appendix: Test Status Legend

| Symbol | Meaning | Action |
|--------|---------|--------|
| ⬜ | Not Started | Execute test |
| 🟨 | In Progress | Continue/complete |
| ✅ | PASSED | Document pass |
| ❌ | FAILED | Create bug report |
| ⏭️ | SKIPPED | Document reason |
| 🔴 | BLOCKED | Wait for resolution |

---

## Document History

| Date | Version | Author | Changes |
|------|---------|--------|---------|
| 2026-05-07 | 1.0 | QA Team | Initial creation |
| | | | |
| | | | |

---

**Status**: Ready for Test Execution  
**Last Updated**: 2026-05-07  
**Next Review**: After first complete test cycle
