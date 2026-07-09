# Returns Workflow — Production-Hardened Implementation

This diagram shows the complete returns lifecycle we implemented, including the Tech-QC → CRM hand-off, atomic transaction wrapping, and role-based gating.

```mermaid
flowchart TD
    A["Unit sold<br/>status = 'sold'"] --> B{"Return initiated?"}

    B -->|"Standard flow"| C["Tech / QC Intake<br/>recordReturnQc()"]
    B -->|"Shortcut"| D["Quick Repair<br/>quickRepair()"]

    C --> C1["Unit stays 'sold'"]
    C --> C2["Set pendingCrmReview = true"]
    C --> C3["Capture customerComments<br/>technicianComments, returnDate"]
    C1 & C2 & C3 --> E["Pending CRM Review queue"]

    E --> F["CRM finalises return<br/>processReturn()"]

    F --> G{"Choose return type"}

    G -->|"returned_to_inventory + refund"| H["Refund workflow"]
    G -->|"returned_to_inventory + replacement"| I["Replacement workflow"]
    G -->|"repair"| J["Repair workflow"]

    subgraph "Atomic Transaction"
        direction TB
        T1["Re-read returning unit"]
        T2{"Status still 'sold'?"}
        T3["Re-read replacement unit (if any)"]
        T4{"Replacement still 'available'?"}
        T5["Update returning unit"]
        T6["Update replacement unit (if chosen)"]
        T7["Void linked sale(s)"]

        T1 --> T2
        T2 -->|No| T8["Abort: unit_not_sold"]
        T2 -->|Yes| T3
        T3 --> T4
        T4 -->|No| T9["Abort: replacement_not_available"]
        T4 -->|Yes / N/A| T5
        T5 --> T6
        T6 --> T7
    end

    H --> T1
    I --> T1
    J --> T1

    H --> H1["Returning unit:<br/>status = 'available'<br/>returnOutcome = 'refund'<br/>clear salePrice/saleDate/salePlatform/saleOrderId<br/>snapshot returnLegCost"]
    H --> H2["Linked sale:<br/>voidedAt, voidOutcome = 'refund'"]

    I --> I1["Returning unit:<br/>replacedByUnitId = replacement.id<br/>status = 'available'"]
    I --> I2["Replacement unit:<br/>status = 'sold'<br/>replacementForUnitId = returning.id<br/>copy sale fields from original"]
    I --> I3["Linked sale:<br/>voidedAt, voidOutcome = 'replacement'"]

    J --> J1["Returning unit:<br/>status = 'returned'<br/>returnType = 'repair'"]
    J --> J2["Linked sale:<br/>voidedAt, voidOutcome = 'repair'"]

    J1 --> K["Repair queue"]
    K --> L["Repair complete<br/>completeRepair()"]
    L --> L1["status = 'available'<br/>returnType = 'returned_to_inventory'<br/>add 'repaired_unit' flag"]

    style A fill:#e1f5e1
    style E fill:#fff3cd
    style K fill:#fff3cd
    style H1 fill:#d4edda
    style I2 fill:#d4edda
    style L1 fill:#d4edda
    style T8 fill:#f8d7da
    style T9 fill:#f8d7da
```

## Role gating

| Action | Who can do it |
|--------|---------------|
| Read returns data | Any signed-in team member |
| Update return/void fields (`status='returned'`, `returnType`, `voidOutcome`, etc.) | **Returns managers** or **admins** |
| Normal stock/sale edits that don't touch return fields | Any signed-in team member |
| Hard delete on `inventoryUnits` / `sales` | Admins only |

## Key code paths

| Function | File | Purpose |
|----------|------|---------|
| `recordReturnQc()` | `src/services/returnsService.ts` | Tech-QC intake, sends unit to CRM queue |
| `processReturn()` | `src/services/returnsService.ts` | CRM finalise: refund, replacement, or repair |
| `quickRepair()` | `src/services/returnsService.ts` | One-click send-to-repair, bypasses QC |
| `completeRepair()` | `src/services/returnsService.ts` | Mark repaired unit as available |
| `dbService.runTransaction()` | `src/lib/dbService.ts` | Atomic Firestore transaction wrapper |
| `querySalesByUnitId()` / `querySalesByImei()` | `src/lib/dbService.ts` | Targeted sale lookups |
| `isReturnsManager()` | `src/lib/firebase.ts` + `firestore.rules` | Role check |
