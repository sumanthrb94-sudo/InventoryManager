# QA Test Strategy - InventoryManager
**Amazon Lead QA Standards Applied**

## Project Overview
- **Framework**: React + TypeScript + Vitest
- **Components**: 34 React components
- **Testing Tool**: Vitest + React Testing Library
- **Coverage Target**: 80%+ for critical paths

---

## Component Categories & Test Priority

### 🔴 CRITICAL (P0) - Financial & Data Integrity
1. **SellPage.tsx** - Sale transactions, profit/loss calculations
2. **ReturnsPage.tsx** - Return processing, inventory restoration
3. **NewBatchModal.tsx** - Batch creation, IMEI validation
4. **ScanInModal.tsx** - IMEI scanning, data auto-population
5. **notificationService.ts** - Notification triggers for loss/sales/returns

### 🟡 HIGH (P1) - Core Features
1. **Inventory.tsx** - Stock listing, filtering, search
2. **StockInPage.tsx** - Stock intake, batch display
3. **Sales.tsx** - Sold history, financial breakdown
4. **Dashboard.tsx** - KPIs, oldest units tracking
5. **NotificationBell.tsx** - Notification center

### 🟢 MEDIUM (P2) - UI Components
1. **UnitDetailDrawer.tsx** - Unit details display
2. **AddDeliveryModal.tsx** - Mode selection
3. **EditUnitModal.tsx** - Unit editing
4. **CollapsibleSection.tsx** - Expandable sections
5. **NotificationToast.tsx** - Toast notifications

### 🔵 LOW (P3) - Utilities & Support
1. **CopyImei.tsx** - IMEI copying
2. **IMEIScanner.tsx** - Scanner component
3. **ErrorBoundary.tsx** - Error handling
4. Reporting pages (Analytics, Calendar, etc.)

---

## Test Case Categories

### 1. Unit Tests
- **Input validation** (model name, price, IMEI format)
- **Calculations** (profit/loss, platform fees, commissions)
- **State management** (useState hooks, state transitions)
- **Edge cases** (null values, empty strings, zero amounts)

### 2. Integration Tests
- **Component interactions** (parent-child data flow)
- **Modal workflows** (open → fill → save → close)
- **Navigation** (tab switching, page transitions)
- **Notification triggers** (sale logged → notification fires)

### 3. Functional Tests
- **User workflows** (complete sale from start to finish)
- **CRUD operations** (create, read, update, delete units)
- **Search & filtering** (model name, IMEI, supplier)
- **Batch operations** (add units to batch, display batch info)

### 4. Business Logic Tests
- **Platform commission calculations** (eBay 12.8%, Amazon 8%, OnBuy 9%, Backmarket 10%)
- **Profit/loss determination** (sale price - BP - fee - postage)
- **Batch tracking** (master_batch vs custom batches)
- **Notification routing** (loss_sell → red alert sound, sold → green chime)

### 5. Error Handling Tests
- **Duplicate IMEI detection**
- **Missing required fields** (model, price, colour)
- **Invalid formats** (IMEI length, price format)
- **Database errors** (Firestore failures)
- **Network failures** (offline scenarios)

### 6. Regression Tests
- **Loss notifications trigger correctly** ✓ (Fixed)
- **Return notifications trigger correctly** ✓ (Fixed)
- **Batch information displays everywhere** ✓ (Fixed)
- **Platform fees show with percentage** ✓ (Fixed)
- **Sold history shows BP and fees** ✓ (Fixed)

---

## Critical Test Scenarios

### Financial Accuracy
```typescript
Test: "Loss Sale Calculation"
Input: BP=£450, Sale=£400, Platform=eBay, Postage=£8
Expected: Profit = £400 - £450 - £12.54 - £8 = -£70.54 (LOSS)
Verify: 
  - Red banner shown ✓
  - Alert sound played ✓
  - Negative amount displayed ✓
```

### Batch Integration
```typescript
Test: "Unit Batch Tracking"
Input: Add unit to custom batch "INV-2061" from "MHL" supplier
Expected:
  - Unit.batchId = "INV-2061" ✓
  - Unit.supplierId = "sup_xxxxx" ✓
  - Display shows "Batch: INV-2061" everywhere ✓
```

### Notification Routing
```typescript
Test: "All Notification Types"
Scenarios:
  - Profit sale: Green banner + success chime (2869) ✓
  - Loss sale: Red banner + alert sound (2372) ✓
  - Return: Amber banner + refresh sound (2811) ✓
  - New stock: Blue banner + notification (2354) ✓
  - SHS received: Purple banner + chime (2892) ✓
```

### IMEI Validation
```typescript
Test: "IMEI Format Validation"
Valid: 14-15 digits OR alphanumeric serial ≥8 chars
Invalid Cases:
  - 13 digits (too short)
  - 16 digits (too long)
  - 5 chars alpha (too short)
  - Empty string
```

---

## Test Setup Configuration

### Installation Required
```bash
npm install --save-dev @testing-library/react @testing-library/jest-dom @testing-library/user-event
npm install --save-dev @vitest/ui
npm install --save-dev jsdom
```

### Vitest Config Update
```typescript
// vite.config.ts
test: {
  globals: true,
  environment: 'jsdom',
  setupFiles: ['src/__tests__/setup.ts'],
  include: ['src/__tests__/**/*.test.ts', 'src/**/*.test.tsx'],
  coverage: {
    provider: 'v8',
    reporter: ['text', 'html'],
    include: ['src/components/**/*.tsx', 'src/lib/**/*.ts'],
    exclude: ['src/lib/firebase.ts', 'src/lib/supabase.ts'],
    lines: 80,
    statements: 80,
    functions: 80,
    branches: 75,
  },
}
```

---

## Test File Structure
```
src/__tests__/
├── setup.ts
├── mocks/
│   ├── firebase.ts
│   └── notificationService.ts
├── components/
│   ├── SellPage.test.tsx (P0)
│   ├── NewBatchModal.test.tsx (P0)
│   ├── ScanInModal.test.tsx (P0)
│   ├── Inventory.test.tsx (P1)
│   └── ...
└── lib/
    ├── dbService.test.ts
    ├── notificationService.test.ts
    └── calculateProfit.test.ts
```

---

## Acceptance Criteria

### Code Coverage
- **Critical components (P0)**: 90%+ coverage
- **High priority (P1)**: 85%+ coverage
- **Medium priority (P2)**: 80%+ coverage
- **Overall**: 80%+ coverage minimum

### Quality Gates
- ✅ All P0 tests passing
- ✅ No console errors in tests
- ✅ No warnings about unhandled promises
- ✅ All async operations properly waited
- ✅ Mocks properly cleaned up between tests

### Performance
- ✅ Test suite runs in < 30 seconds
- ✅ Individual test < 500ms
- ✅ No memory leaks detected

---

## Implementation Priority

### Phase 1 (Week 1) - Setup & P0 Tests
1. Install dependencies
2. Create test setup file
3. Create mocks for Firebase & services
4. Write tests for: SellPage, NewBatchModal, ScanInModal, notificationService

### Phase 2 (Week 2) - P1 Tests
1. Inventory.tsx
2. StockInPage.tsx
3. Sales.tsx
4. ReturnsPage.tsx

### Phase 3 (Week 3) - P2 Tests & Utilities
1. Dashboard.tsx
2. NotificationBell.tsx
3. UnitDetailDrawer.tsx
4. Helper components

### Phase 4 (Week 4) - Integration & E2E
1. Complete user workflows
2. Cross-component interactions
3. Performance testing
4. Final coverage report

---

## Test Naming Convention
```typescript
describe('ComponentName', () => {
  describe('Feature: Calculate Profit', () => {
    it('should calculate profit correctly for profitable sale', () => {})
    it('should return negative amount for loss sale', () => {})
    it('should handle platform fee calculation', () => {})
    it('should handle edge case: zero sale price', () => {})
  })

  describe('User Interactions', () => {
    it('should open modal when button clicked', () => {})
    it('should close modal on cancel', () => {})
    it('should submit form with valid data', () => {})
    it('should show error for invalid IMEI', () => {})
  })

  describe('Error Handling', () => {
    it('should catch and handle Firebase errors', () => {})
    it('should display user-friendly error message', () => {})
  })
})
```

---

## Success Metrics
- ✅ 0 critical bugs in tests
- ✅ All financial calculations verified
- ✅ All notifications trigger correctly
- ✅ All CRUD operations tested
- ✅ All edge cases covered
- ✅ 80%+ code coverage achieved
- ✅ All tests pass in CI/CD pipeline

---

**Status**: Ready for Implementation
**Last Updated**: May 6, 2026
