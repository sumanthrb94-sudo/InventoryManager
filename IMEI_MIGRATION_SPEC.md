# INVENTORY MANAGER — IMEI-Based System Migration
## Complete Technical Specification for AI Agent Implementation

---

## 1. EXECUTIVE SUMMARY

**Current Problem:** The app uses auto-generated IDs (`unit_${timestamp}_${random}`) and fake IMEIs (`PENDING_abc123`, `SHS_xyz789`). There is NO real IMEI tracking, making it impossible to distinguish individual physical units.

**Required Solution:** Make **IMEI the primary unique identifier** for every physical device. One IMEI = One Unit. No exceptions.

**KEY PRINCIPLE:** Every physical device has a unique IMEI. The database must enforce this at the schema level.

---

## 2. SUPABASE SCHEMA CHANGES (Execute First)

### 2.1 Add Unique Constraint on IMEI

Execute these SQL commands in Supabase SQL Editor:

```sql
-- Allow NULL for SHS (incoming) stock only
ALTER TABLE inventory_units 
ADD CONSTRAINT unique_imei UNIQUE (imei);

-- Index for fast lookups
CREATE INDEX idx_imei_lookup ON inventory_units (imei) 
WHERE imei IS NOT NULL;
```

### 2.2 Update ID Generation Strategy

Keep existing `id` column as UUID but add `imei` as UNIQUE and NOT NULL for non-SHS stock:

```sql
-- Make IMEI required for all non-incoming stock
ALTER TABLE inventory_units 
ADD CONSTRAINT check_imei_for_stock 
CHECK (
  (status = 'incoming' AND imei IS NULL) OR 
  (status != 'incoming' AND imei IS NOT NULL AND LENGTH(imei) >= 14)
);
```

**WARNING:** Before applying constraints, clean existing data:

```sql
-- Remove fake IMEIs first
DELETE FROM inventory_units 
WHERE imei LIKE 'PENDING_%' OR imei LIKE 'SHS_%';
```

---

## 3. FILE-BY-FILE IMPLEMENTATION

### 3.1 types.ts

Update `InventoryUnit` interface:

```typescript
export interface InventoryUnit {
  id: string;                    // Keep: auto-generated UUID
  imei: string;                  // CHANGE: REQUIRED, real 14-15 digit IMEI
  model: string;
  brand: string;
  category: DeviceCategory;
  colour: string;
  storage?: string;
  conditionGrade?: ConditionGrade;
  buyPrice: number;
  dateIn: string;
  supplierId: string;
  supplierName?: string;         // Virtual field (not in DB)
  batchId?: string;
  status: DeviceStatus;          // 'available' | 'sold' | 'incoming' | 'returned'
  flags: OperationalFlag[];
  notes: string;
  platformListed: boolean;
  listingSites?: ListingSite[];
  salePrice?: number;
  saleDate?: string;
  salePlatform?: string;
  saleOrderId?: string;
  customerName?: string;
  postageCost?: number;
  returnType?: ReturnCategory;
  returnDate?: string;
  returnReason?: string;
  ownerId: string;
  createdAt: any;
  updatedAt?: any;
}
```

### 3.2 dbService.ts

Add these methods to the `dbService` object:

```typescript
async getByImei(imei: string): Promise<any | null> {
  const { data, error } = await supabase
    .from('inventory_units')
    .select('*')
    .eq('imei', imei)
    .single();
  if (error) return null;
  return data ? dbToApp(data) : null;
},

async updateByImei(imei: string, data: any) {
  const timestamp = nowIso();
  const current = [...(cachedData['inventoryUnits'] || [])];
  const idx = current.findIndex(item => item.imei === imei);
  const updated = idx >= 0
    ? { ...current[idx], ...data, imei, updatedAt: timestamp }
    : { ...data, imei, updatedAt: timestamp };

  if (idx >= 0) current[idx] = updated;
  cachedData['inventoryUnits'] = current;
  emit('inventoryUnits', current);

  const { error } = await supabase
    .from('inventory_units')
    .update(appToDb(updated))
    .eq('imei', imei);
  if (error) console.warn(`Supabase updateByImei [${imei}]:`, error.message);
},

async imeiExists(imei: string): Promise<boolean> {
  if (!imei || imei.length < 14) return false;
  const { data } = await supabase
    .from('inventory_units')
    .select('imei')
    .eq('imei', imei)
    .single();
  return !!data;
},
```

### 3.3 NewBatchModal.tsx (Major Rewrite)

#### A. Change BatchRow Interface

```typescript
interface BatchRow {
  id: string;
  model: string;
  imei: string;           // NEW: Real IMEI, required
  buyPrice: string;
  colour: string;         // CHANGE: Single colour per unit
  supplierName: string;
  notes: string;
  isSHS: boolean;
}
```

#### B. Remove Functions

Delete these functions entirely:
- `parseColourStr()`
- `unitCount()`
- `colourPreview()`

**Reason:** Each row = one physical unit = one IMEI. No quantity expansion needed.

#### C. Validation Logic

```typescript
const validRows = rows.filter(r => {
  if (!r.model.trim()) return false;
  if (r.isSHS) return true;  // SHS doesn't need IMEI yet
  
  // REAL STOCK: IMEI is mandatory
  if (!r.imei.trim() || r.imei.replace(/\D/g, '').length < 14) {
    setError(`Row ${r.model}: IMEI required (14-15 digits)`);
    return false;
  }
  if (!r.buyPrice || isNaN(parseFloat(r.buyPrice))) {
    setError(`Row ${r.model}: Buy price required`);
    return false;
  }
  return true;
});

// Check IMEI uniqueness against database
for (const r of validRows.filter(r => !r.isSHS)) {
  const cleanImei = r.imei.replace(/\D/g, '');
  const exists = await dbService.imeiExists(cleanImei);
  if (exists) {
    setError(`IMEI ${cleanImei} already exists in database`);
    setSaving(false);
    return;
  }
}
```

#### D. Unit Creation Logic

```typescript
for (const r of validRows) {
  const supplierId = supCache[r.supplierName.trim().toUpperCase()] || '';
  const category = detectCategory(r.model);
  const brand = detectBrand(category);
  const bp = parseFloat(r.buyPrice) || 0;
  
  if (r.isSHS) {
    // SHS: No IMEI yet, use temporary ID
    const tempId = `shs_${Date.now()}_${uid()}`;
    await dbService.create('inventoryUnits', tempId, {
      imei: null,              // NULL for SHS
      model: r.model.trim(),
      brand, category,
      colour: 'Unknown',
      buyPrice: bp,
      dateIn: date,
      supplierId,
      batchId,
      status: 'incoming',
      flags: [],
      notes: `SHS — Expected stock`,
      platformListed: false,
      listingSites: [],
      ownerId: 'shared',
      createdAt: new Date().toISOString(),
    });
  } else {
    // REAL STOCK: Use IMEI as the ID
    const cleanImei = r.imei.replace(/\D/g, '');
    await dbService.create('inventoryUnits', cleanImei, {
      id: cleanImei,           // ID = IMEI
      imei: cleanImei,         // Real IMEI
      model: r.model.trim(),
      brand, category,
      colour: r.colour || 'Unknown',
      buyPrice: bp,
      dateIn: date,
      supplierId,
      batchId,
      status: 'available',
      flags: [],
      notes: r.notes || '',
      platformListed: false,
      listingSites: [],
      ownerId: 'shared',
      createdAt: new Date().toISOString(),
    });
  }
}
```

#### E. UI Layout Change

New row layout (1 row = 1 unit):

```
| Model (3 cols) | IMEI (3 cols) | Price (2 cols) | Colour (2 cols) | Supplier (2 cols) |
```

### 3.4 SellPage.tsx

#### A. Search Logic

```typescript
const filtered = useMemo(() => {
  if (!search.trim()) return inStock.slice(0, 80);
  const q = search.trim();
  
  // PRIMARY: Exact IMEI match
  const exactImei = inStock.find(u => u.imei === q);
  if (exactImei) return [exactImei];
  
  // SECONDARY: Partial IMEI or model search
  const qLower = q.toLowerCase();
  return inStock.filter(u =>
    u.imei?.includes(q) ||
    u.model.toLowerCase().includes(qLower)
  );
}, [inStock, search]);
```

#### B. Display Update

```tsx
<div className="flex items-center gap-3">
  <div className="w-2 h-2 rounded-full bg-emerald-400" />
  <div className="flex-1">
    <p className="text-xs font-bold">{u.model}</p>
    <p className="text-[9px] font-mono text-gray-400">
      IMEI: {u.imei}
      {u.colour && ` · ${u.colour}`}
    </p>
  </div>
</div>
```

#### C. Save Logic

```typescript
await dbService.updateByImei(unit.imei, {
  status: 'sold',
  salePrice: Number(sp),
  salePlatform: platform,
  saleOrderId: orderId.trim(),
  saleDate,
  postageCost: postageNum,
});
```

### 3.5 ReturnsPage.tsx

#### A. Search Logic

```typescript
const filtered = useMemo(() => {
  let sorted = [...sold].sort(...);
  if (!q.trim()) return sorted.slice(0, 8);
  
  // Exact IMEI match first
  const exact = sorted.find(u => u.imei === q.trim());
  if (exact) return [exact];
  
  // Partial search
  const s = q.toLowerCase();
  return sorted.filter(u =>
    u.imei?.includes(q) ||
    u.model.toLowerCase().includes(s)
  ).slice(0, 8);
}, [sold, q]);
```

#### B. Save Logic

```typescript
await dbService.updateByImei(unit.imei, {
  status: newStatus,
  returnType,
  returnDate,
  returnReason: reason.trim(),
  salePrice: null,
  saleDate: null,
  salePlatform: null,
  saleOrderId: null,
  postageCost: null,
});
```

### 3.6 import_excel.cjs

```javascript
columnMap: {
  // ... existing columns ...
  imei: ['IMEI', 'IMEI/Serial', 'Serial', 'S/N', 'Serial Number'],
}

// In unit creation:
const cleanImei = (rawImei || '').replace(/\D/g, '');
const unitId = cleanImei.length >= 14 ? cleanImei : buildUnitId(...);

const unit = {
  id: unitId,
  imei: cleanImei.length >= 14 ? cleanImei : `PENDING_${random}`,
  // ... rest
};
```

---

## 4. UI CHANGES SUMMARY

| Screen | Old Behavior | New Behavior |
|--------|-------------|-------------|
| **Add Stock** | Model + Qty + Colours (e.g. "BLACK 3 GREY 1") | Model + IMEI + Price + Colour (1 row = 1 physical unit) |
| **SHS** | Model only, auto-generated fake IMEI | Model + Price, IMEI is NULL, status = incoming |
| **Sell** | Browse list of all available models | Search IMEI → exact match → select unit → sell |
| **Return** | Browse list of all sold items | Search IMEI → exact match → select unit → process return |

---

## 5. MIGRATION STEPS

1. Backup database before any changes
2. Run SQL schema changes (Section 2) in Supabase SQL Editor
3. Clean existing fake IMEIs: `DELETE FROM inventory_units WHERE imei LIKE 'PENDING_%' OR imei LIKE 'SHS_%'`
4. Update `types.ts` with new `InventoryUnit` interface
5. Update `dbService.ts` with IMEI methods (getByImei, updateByImei, imeiExists)
6. Rewrite `NewBatchModal.tsx` (major changes in Sections 3.3A-E)
7. Update `SellPage.tsx` search and display logic
8. Update `ReturnsPage.tsx` search and save logic
9. Update `import_excel.cjs` to handle IMEI column
10. Test with sample data (add stock → sell → return)
11. Deploy to production

---

## 6. VALIDATION RULES

| Rule | Error Message |
|------|--------------|
| IMEI < 14 digits | "IMEI must be 14-15 digits" |
| Duplicate IMEI | "IMEI already exists in stock" |
| Empty IMEI (non-SHS) | "IMEI is required for stock" |
| Invalid IMEI format | "IMEI must contain only numbers" |

---

## 7. EXAMPLE DATA FLOW

### 7.1 Adding Stock

```
User Input:
  Model: Apple iPhone 14 128GB
  IMEI: 123456789012345
  Buy Price: 255
  Colour: Black
  Supplier: MHL

Database Result:
  id: 123456789012345
  imei: 123456789012345
  status: available
```

### 7.2 Selling

```
User searches: 123456789012345
System finds exact IMEI match
User enters:
  Sale Price: 450
  Platform: eBay
  Order: 12-34567-89012

Database Result:
  status: sold
  sale_price: 450
  sale_platform: eBay
```

### 7.3 Returning

```
User searches: 123456789012345
System finds sold unit
User selects:
  Return Type: Back to Inventory
  Reason: Customer changed mind

Database Result:
  status: available
  return_type: returned_to_inventory
  sale_price: NULL (cleared)
  sale_platform: NULL (cleared)
```

---

## 8. CRITICAL NOTES

**IMEI = Primary Key:** Every physical device MUST have a unique IMEI. No two units can share the same IMEI.

**SHS Exception:** SHS (incoming/expected) stock is the ONLY case where IMEI can be NULL. When stock arrives, update with real IMEI.

**One Row = One Unit:** In the Add Stock modal, each row represents exactly one physical device. No quantity expansion.

**Search Priority:** Always search by exact IMEI match first. Only fall back to partial/model search if no exact match.

**Database Integrity:** The `unique_imei` constraint at the database level prevents duplicates even if UI validation fails.

**Migration Risk:** Existing data with fake IMEIs (`PENDING_*`, `SHS_*`) must be cleaned before applying constraints.

---

*End of Specification*

**Generated:** January 2026
**Project:** MOBILEPHONEMARKET Inventory Manager
**Status:** Production Ready Specification
