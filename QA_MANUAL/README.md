# InventoryManager - QA Integration Testing Manual
**Complete Step-by-Step Manual Testing Guide for All 127 Test Cases**

---

## 📋 Document Overview

This manual provides **detailed, step-by-step procedures** for manual QA testing of all 127 integration test cases across 5 major workflows.

### Quick Navigation

| Document | Purpose | Test Count |
|----------|---------|-----------|
| [EXISTING_TESTS.md](./EXISTING_TESTS.md) | 15 current passing tests | 15 |
| [PHASE_1_CRITICAL.md](./PHASE_1_CRITICAL.md) | Error handling & validation | 40 |
| [PHASE_2_IMPORTANT.md](./PHASE_2_IMPORTANT.md) | Search, batch, concurrent ops | 50 |
| [PHASE_3_ENHANCEMENT.md](./PHASE_3_ENHANCEMENT.md) | Warranty, permissions, performance | 22 |
| [TEST_EXECUTION_SHEET.md](./TEST_EXECUTION_SHEET.md) | Tracking & sign-off | - |
| [BUG_REPORT_TEMPLATE.md](./BUG_REPORT_TEMPLATE.md) | Issue documentation | - |

---

## 🚀 Getting Started

### Pre-Test Requirements

#### Environment Setup
- [ ] Fresh browser (clear cache/cookies)
- [ ] Test database with seed data loaded
- [ ] User account with "shared" ownerId access
- [ ] Notifications enabled
- [ ] Sound output available
- [ ] Network connectivity good (5+ Mbps)
- [ ] Browser DevTools open (optional, for debugging)

#### Test Data Setup
```javascript
// Load these before testing:
✓ 5 active suppliers
✓ 20 available units
✓ 10 sold units
✓ 3 SHS units
✓ 2 returned units
```

#### Device Requirements
- **Desktop**: 1920x1080 or larger
- **Mobile**: iOS/Android 12+
- **Browsers**: Chrome, Firefox, Safari (latest)
- **RAM**: 4GB minimum
- **Storage**: 500MB free

---

## 📊 Test Summary by Workflow

### Workflow 1: SHS (Supplier Direct Sales)
- **Tests**: 5 (existing) + 8 (new planned)
- **Time**: ~45 minutes
- **Risk Level**: HIGH
- **Documents**: EXISTING_TESTS.md (lines 1-200)

### Workflow 2: Batch Import
- **Tests**: 4 (existing) + 12 (new planned)
- **Time**: ~60 minutes
- **Risk Level**: HIGH
- **Documents**: EXISTING_TESTS.md (lines 201-400), PHASE_1_CRITICAL.md

### Workflow 3: Barcode Scan
- **Tests**: 2 (existing) + 6 (new planned)
- **Time**: ~30 minutes
- **Risk Level**: MEDIUM
- **Documents**: EXISTING_TESTS.md (lines 401-500)

### Workflow 4: Returns Processing
- **Tests**: 2 (existing) + 10 (new planned)
- **Time**: ~40 minutes
- **Risk Level**: HIGH
- **Documents**: EXISTING_TESTS.md (lines 501-600)

### Workflow 5: Dashboard & Data Accuracy
- **Tests**: 7 (existing) + 25 (new planned)
- **Time**: ~90 minutes
- **Risk Level**: CRITICAL
- **Documents**: EXISTING_TESTS.md (lines 601-800), PHASE_2_IMPORTANT.md

---

## 🎯 Test Execution Order

### Recommended Sequence (Production Grade)

**Day 1: Critical Path (8 hours)**
1. Error Handling & Validation (2 hours)
2. SHS Workflow (1.5 hours)
3. Batch Import (2 hours)
4. Data Consistency (2.5 hours)

**Day 2: Core Features (8 hours)**
1. Financial Accuracy (2 hours)
2. Dashboard Accuracy (2 hours)
3. Return Processing (2 hours)
4. Search & Filtering (2 hours)

**Day 3: Robustness (8 hours)**
1. Concurrent Operations (2 hours)
2. Batch Operations (2 hours)
3. Notifications (2 hours)
4. Performance Testing (2 hours)

**Total Time**: 24 hours (3 days)

---

## 📝 Test Case Format

Each test follows this standardized format:

```markdown
## TEST-###: Test Name
**Workflow**: [Which workflow]
**Priority**: 🔴 HIGH | 🟡 MEDIUM | 🟢 LOW
**Risk Level**: Critical | High | Medium | Low
**Time**: X minutes
**Status**: Not Started | In Progress | ✅ PASSED | ❌ FAILED

### Pre-Conditions
- Condition 1
- Condition 2

### Test Steps
1. Step 1: Action
2. Step 2: Verify
3. Step 3: Confirm

### Expected Results
- Result 1
- Result 2

### Verification Points
□ Visual verification
□ Database check
□ Notification check

### Pass Criteria
All items below must be true:
- [ ] Item 1
- [ ] Item 2

### Failure Recovery
If test fails at step X, do this...

### Notes
Additional context or tips
```

---

## ✅ Sign-Off Requirements

### QA Tester Sign-Off
- [ ] All tests executed in sequence
- [ ] All pass criteria verified
- [ ] No blockers or critical failures
- [ ] All bugs documented with templates
- [ ] Test execution sheet completed
- [ ] Evidence (screenshots) attached

### Team Lead Review
- [ ] Tests executed with tester present
- [ ] Failure root causes identified
- [ ] Risk assessment completed
- [ ] Go/No-go decision made

### Dev Team Sign-Off
- [ ] All failures investigated
- [ ] Bugs triaged and prioritized
- [ ] Fixes planned for critical issues
- [ ] Re-test date scheduled

---

## 🐛 Bug Reporting

**Every failure must include:**
1. Test ID (TEST-###)
2. Exact reproduction steps
3. Expected vs actual result
4. Screenshots/videos
5. Environment details
6. Severity level

See [BUG_REPORT_TEMPLATE.md](./BUG_REPORT_TEMPLATE.md) for detailed format.

---

## 📊 Metrics to Track

### Test Coverage
```
Target: 127 tests
Current: 15 tests ✅
Planned Phase 1: 55 tests (40 new)
Planned Phase 2: 105 tests (50 new)
Planned Phase 3: 127 tests (22 new)
```

### Pass Rate Target
```
Phase 1: 95%+ pass rate
Phase 2: 98%+ pass rate
Phase 3: 99%+ pass rate
```

### Critical Path Duration
```
SHS + Batch + Returns: < 2 hours
Must all be GREEN
```

---

## 🔄 Test Cycles

### Regression Testing (Weekly)
```bash
Run: EXISTING_TESTS.md only (15 tests)
Time: 1-2 hours
Gate: Must pass 100%
```

### Feature Testing (Per Release)
```bash
Run: All applicable phase tests
Time: 24 hours (spread over 3 days)
Gate: Critical tests 100%, others 95%+
```

### Performance Testing (Monthly)
```bash
Run: PHASE_2_IMPORTANT.md (performance tests)
Time: 4 hours
Gate: All must meet performance targets
```

---

## 💾 Test Data Management

### Fresh Start (Each Test Cycle)
1. Clear browser cache/cookies
2. Log out if already logged in
3. Clear localStorage: `localStorage.clear()`
4. Reload page
5. Log back in
6. Verify test data loaded

### Test Data Seed (Required)
```javascript
// Run in browser console before testing:
const testData = {
  suppliers: [
    { id: 'sup_001', name: 'MHL', portal: 'Wholesale' },
    { id: 'sup_002', name: 'NIHAL', portal: 'Wholesale' },
    { id: 'sup_003', name: 'NANAK', portal: 'Wholesale' },
    { id: 'sup_004', name: 'JOSHI', portal: 'Wholesale' },
    { id: 'sup_005', name: 'PATEL', portal: 'Wholesale' },
  ],
  units: [
    // 20 available units with various prices and models
    // 10 sold units with sale history
    // 3 SHS units (status=incoming)
    // 2 returned units
  ]
};
```

---

## 🖼️ Required Screenshots

For each test, capture:

1. **Setup State** - Initial condition
2. **Action Point** - User performing action
3. **Result State** - Final verified state
4. **Data Verification** - Database/console showing data

**Screenshot naming**: `TEST-###_Step-X_[description].png`

Example: `TEST-001_Step-3_SHS_created.png`

---

## 🔍 Verification Methods

### 1. Visual Inspection
- UI elements appear correctly
- Colors/styling match design
- Data displays properly
- No errors visible

### 2. Database Verification
```javascript
// Open browser DevTools → Application → LocalStorage
// Or check in Firestore Console for cloud data
```

### 3. Network Verification
```javascript
// DevTools → Network tab
// Verify API calls made correctly
// Check response status (200 OK)
```

### 4. Console Verification
```javascript
// DevTools → Console
// Look for [Sale], [Notification], [Inventory] logs
// No red error messages
```

---

## ⏱️ Time Estimates

| Phase | Tests | Est. Hours | Per Test |
|-------|-------|-----------|----------|
| **Phase 0 (Current)** | 15 | 3 | 12 min |
| **Phase 1 (Critical)** | 40 | 8 | 12 min |
| **Phase 2 (Important)** | 50 | 10 | 12 min |
| **Phase 3 (Enhancement)** | 22 | 4.5 | 12 min |
| **TOTAL** | 127 | 25.5 hours | 12 min |

**Plus:**
- Bug investigation: +2 hours
- Re-testing fixes: +2 hours
- Documentation: +1 hour
- **Total with overhead: ~30 hours (4 days)**

---

## 🎓 Training Checklist

Before executing tests, ensure:

- [ ] Read this README completely
- [ ] Understand the 5 main workflows
- [ ] Know bug severity levels
- [ ] Practiced with 2-3 test cases
- [ ] Know how to use DevTools
- [ ] Familiar with test data setup
- [ ] Know when to escalate issues
- [ ] Understand pass/fail criteria

---

## 🆘 Support & Escalation

### Questions During Testing?
1. Check the workflow-specific document
2. Check [FAQ.md](./FAQ.md) (if exists)
3. Ask team lead
4. Document in test sheet as "BLOCKED"

### Test Failures?
1. Try once more to reproduce
2. Check if it's environmental (cache, data)
3. Take screenshots
4. Document in [BUG_REPORT_TEMPLATE.md](./BUG_REPORT_TEMPLATE.md)
5. Escalate if critical

### Critical Issues Found?
- [ ] Screenshot evidence attached
- [ ] Steps to reproduce documented
- [ ] Severity marked as CRITICAL
- [ ] Assigned to dev team immediately
- [ ] Halt further testing until resolved

---

## 📁 Folder Structure

```
QA_MANUAL/
├── README.md                          (THIS FILE)
├── EXISTING_TESTS.md                  (15 tests - passing)
├── PHASE_1_CRITICAL.md                (40 tests - priority 1)
├── PHASE_2_IMPORTANT.md               (50 tests - priority 2)
├── PHASE_3_ENHANCEMENT.md             (22 tests - priority 3)
├── TEST_EXECUTION_SHEET.md            (Tracking & sign-off)
├── BUG_REPORT_TEMPLATE.md             (Issue documentation)
├── FAQ.md                             (Common questions)
├── SCREENSHOTS/
│   ├── TEST-001_evidence/
│   ├── TEST-002_evidence/
│   └── ...
└── REPORTS/
    ├── Test_Run_2026-05-07.md
    ├── Test_Run_2026-05-14.md
    └── ...
```

---

## 🚦 Color Coding Guide

- 🔴 **RED** = CRITICAL - Blocks release
- 🟠 **ORANGE** = HIGH - Must fix before release
- 🟡 **YELLOW** = MEDIUM - Fix in next sprint
- 🟢 **GREEN** = LOW - Nice to have

---

## 📞 Contact & Feedback

**Questions about tests?** Create an issue in GitHub
**Found a bug?** Use BUG_REPORT_TEMPLATE.md
**Have suggestions?** Update this README

---

**Last Updated**: 2026-05-07  
**Manual Version**: 1.0  
**Test Coverage**: 127 test cases  
**Status**: Ready for QA Execution
