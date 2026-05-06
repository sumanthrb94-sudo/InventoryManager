# Standard Operating Procedures (SOPs) - InventoryManager
## Employee Training & Operational Guidelines

**Last Updated:** 2026-05-06  
**Version:** 1.0  
**Organization:** MOBILEPHONEMARKET  

---

## 📋 Overview

This documentation provides step-by-step Standard Operating Procedures for all major inventory management workflows. Follow these procedures exactly to ensure consistency, accuracy, and data integrity across the platform.

---

## 🔄 SOP Segments

### 1. **SOP-001: Add Batch Stock**
**Purpose:** Import multiple inventory items in bulk  
**Duration:** 5-10 minutes per batch  
**Frequency:** Daily (multiple times)  
**Key Process:** Load mock data → Add units → Set initial status  

**Files:**
- SOP_1_ADD_BATCH_STOCK.md
- Includes: File format requirements, validation steps, error recovery

---

### 2. **SOP-002: Add Stock and List via SHS**
**Purpose:** Add individual stock items and list them on e-commerce platforms  
**Duration:** 2-5 minutes per item  
**Frequency:** As items arrive in warehouse  
**Key Process:** Add unit → Configure for platform → Set listing details → Publish  

**Files:**
- SOP_2_ADD_STOCK_AND_LIST_VIA_SHS.md
- Includes: Platform selection, pricing strategy, listing optimization

---

### 3. **SOP-003: Update Sell Order**
**Purpose:** Record and track sales across platforms  
**Duration:** 1-3 minutes per order  
**Frequency:** Real-time as orders are received  
**Key Process:** Receive order → Update status → Generate pick slip → Mark sold  

**Files:**
- SOP_3_UPDATE_SELL_ORDER.md
- Includes: Order receipt, status transitions, profit calculation

---

### 4. **SOP-004: Update Return Orders**
**Purpose:** Process returns and manage inventory stock adjustments  
**Duration:** 5-10 minutes per return  
**Frequency:** As returns arrive  
**Key Process:** Receive return → Inspect unit → Update status → Restock in inventory  

**Files:**
- SOP_4_UPDATE_RETURN_ORDERS.md
- Includes: Return reasons, inspection criteria, stock management

---

## 📊 Process Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    INVENTORY LIFECYCLE                       │
└─────────────────────────────────────────────────────────────┘

  ┌─────────────────┐
  │  Add Batch Stock│ ←─────── SOP-001
  │  (File Import)  │
  └────────┬────────┘
           │
           ▼
  ┌─────────────────────┐
  │ Add Stock & List    │ ←─────── SOP-002
  │ (Individual Items)  │
  └────────┬────────────┘
           │
           ├─────────────────────────────────────┐
           │                                     │
           ▼                                     ▼
  ┌──────────────────┐              ┌──────────────────┐
  │  Status: SOLD    │              │ Status: AVAILABLE│
  │                  │              │                  │
  │ Update Sell Order│ ←─ SOP-003   │ (Awaiting Sale)  │
  │ (Record Purchase)│              └──────────────────┘
  └────────┬─────────┘
           │
           ├─────────────────────────────────────┐
           │                                     │
           ▼                                     ▼
  ┌──────────────────┐              ┌──────────────────┐
  │  Delivered to    │              │  Customer Return │
  │  Customer        │              │  Received        │
  └────────┬─────────┘              └────────┬─────────┘
           │                                  │
           │                                  ▼
           │                        ┌──────────────────┐
           │                        │ Update Return    │
           │                        │ Order ←─ SOP-004 │
           │                        │ (Inspect, Relist)│
           │                        └────────┬─────────┘
           │                                  │
           └──────────────┬───────────────────┘
                          │
                          ▼
                ┌──────────────────────┐
                │  Back in Inventory   │
                │  (Available for Sale)│
                │  Stock Count ↑       │
                └──────────────────────┘
```

---

## 🔐 Access Requirements

**Roles with Access:**
- ✅ Inventory Manager
- ✅ Warehouse Staff
- ✅ Sales Operations
- ✅ Admin

**Required Permissions:**
- Create new inventory items
- Edit inventory items
- View stock levels
- Create sales orders
- Process returns
- Edit unit status
- View transaction history

---

## ✅ Training Checklist

Before using these procedures, ensure you have:

- [ ] Read all 4 SOP documents completely
- [ ] Accessed the training environment
- [ ] Created a test batch to practice with
- [ ] Verified your account permissions
- [ ] Understood the platform commission rates
- [ ] Reviewed error handling procedures
- [ ] Passed the quiz (if applicable)

---

## 📱 Key Concepts to Remember

### Stock Status Flow
```
AVAILABLE → SOLD → DELIVERED/RETURNED → (If Returned) → AVAILABLE
```

### Important Notes

1. **Stock Deletion:** Units are NEVER deleted from the system. Returned items go back to "AVAILABLE" status, not deleted.

2. **Profit Calculation:** Platform commission is automatically calculated during sell order creation:
   - eBay: 12.8% + £0.30
   - Amazon: 8%
   - OnBuy: 9%
   - Backmarket: 10%

3. **Batch Upload:** All items in a batch must have valid data. Invalid items will be flagged and can be edited before import.

4. **Return Process:** All returns must be inspected and graded before returning to available inventory.

---

## 🆘 Support & Escalation

**For Questions or Issues:**
1. Check the Troubleshooting section in each SOP
2. Contact your Inventory Manager
3. Escalate to System Admin if needed

**Common Issues:**
- ❌ "Duplicate item" error → Check if unit already exists
- ❌ "Invalid platform" → Verify platform selection
- ❌ "Low stock alert" → Batch add more units
- ❌ "Commission mismatch" → Platform rates may have changed

---

## 📋 SOP Index

| SOP ID | Title | Duration | Frequency |
|--------|-------|----------|-----------|
| SOP-001 | Add Batch Stock | 5-10 min | Multiple daily |
| SOP-002 | Add Stock & List | 2-5 min | As items arrive |
| SOP-003 | Update Sell Order | 1-3 min | Real-time |
| SOP-004 | Update Return Order | 5-10 min | As returns arrive |

---

## 📝 Revision History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0 | 2026-05-06 | Initial SOP documentation | System Admin |

---

## 🎓 Quick Start Guide

**First Time User? Start Here:**

1. **Read** → SOP_OVERVIEW.md (this file)
2. **Learn** → SOP-001: Add Batch Stock (foundational)
3. **Practice** → Use training environment with sample data
4. **Apply** → Follow SOP-002 for first real item
5. **Master** → Complete SOP-003 and SOP-004

**Experienced Users:**
- Jump to specific SOP as needed
- Use troubleshooting sections for issues
- Reference quick checklists for verification

---

**Next Steps:** Open SOP_1_ADD_BATCH_STOCK.md to begin
