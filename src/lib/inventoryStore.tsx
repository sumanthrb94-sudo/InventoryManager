import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { dbService } from './dbService';
import {
  InventoryUnit,
  Supplier,
  Sale,
  InventoryAggregate,
  AccessoryStock,
  AccessoryStockEvent,
  SupplierWhatsappUpdate,
  ImportBatch,
} from '../types';
import type { ModelSeed } from './deviceCatalog';
import { parseBrandModelStorage, looksLikeSku } from './modelStorage';
import { buildCatalogIndex } from './modelReconciliation';

/** Read-time model/brand/storage/sku normalisation for one raw
 *  `inventoryUnits` doc. Exported as a pure function so it's testable
 *  without mounting the store/Firestore.
 *
 *  Only re-derives from `rawModel` when the CURRENTLY STORED model still
 *  looks like a raw SKU code (`looksLikeSku`) — once a model is already a
 *  clean, human-confirmed name, it must never be silently rewritten again,
 *  no matter how normalizeOperatorSku's recognised SKU shapes change in
 *  the future. A parser tweak used to change what's displayed for every
 *  unit in the app simultaneously; this gate is what stops that. Units
 *  still genuinely stuck with a raw SKU keep getting live-cleaned as
 *  before — the permanent fix path for those is the SkuReconciliation
 *  admin tool, not this hook. */
export function deriveUnitFields(item: any): any {
  if (!item.model) return item;
  const rawModel = item.model;
  if (!looksLikeSku(rawModel)) return { ...item, rawModel };

  const parsed = parseBrandModelStorage(rawModel);
  const cleanModel = parsed.model || rawModel;
  const cleanBrand = (item.brand && item.brand !== 'Other') ? item.brand : (parsed.brand !== 'Other' ? parsed.brand : '');
  const cleanStorage = item.storage || parsed.storage;
  const expectedSku = [cleanBrand, cleanModel, cleanStorage].filter(Boolean).join(' ');

  return {
    ...item,
    model: cleanModel,
    rawModel,
    brand: cleanBrand,
    storage: cleanStorage,
    sku: expectedSku || item.sku,
  };
}

/** Same idea as `deriveUnitFields`, for one raw `sales` doc. No-IMEI sales
 *  (accessories) are out of scope entirely — checked first, unchanged from
 *  before this gate existed. */
export function deriveSaleFields(item: any): any {
  // No-IMEI sales (accessories — chargers, SIM pins, cables) carry a
  // literal SKU with no phone brand/model/storage to extract. Running
  // it through parseBrandModelStorage anyway mangled real accessory
  // SKUs (e.g. "USB-C-20W" → "C-20W"), breaking every downstream
  // lookup keyed on the exact SKU (accessoryStock matching included).
  // Only device sales (IMEI present) get the phone-SKU humanisation.
  if (!item.imei) return item;
  const rawModel = item.model || item.sku;
  if (!rawModel) return item;
  if (!looksLikeSku(rawModel)) return item;

  const parsed = parseBrandModelStorage(rawModel);
  const cleanModel = parsed.model || rawModel;
  const brand = parsed.brand !== 'Other' ? parsed.brand : '';
  const expectedSku = [brand, cleanModel, parsed.storage].filter(Boolean).join(' ');

  return {
    ...item,
    model: cleanModel,
    sku: expectedSku || item.sku,
  };
}

interface Store {
  loaded: boolean;
  units: InventoryUnit[];
  suppliers: Supplier[];
  // ── NEW master-file feeds ───────────────────────
  sales: Sale[];
  aggregates: InventoryAggregate[];
  /** No-IMEI accessory quantity pools (chargers, SIM pins, cables) — one
   *  doc per SKU, never per physical unit. See AccessoryStock in types.ts. */
  accessoryStock: AccessoryStock[];
  /** Transaction ledger behind accessoryStock's running quantity — one row
   *  per topup/sale/adjustment/return/restore. See AccessoryStockEvent. */
  accessoryStockEvents: AccessoryStockEvent[];
  whatsappFeed: SupplierWhatsappUpdate[];
  importBatches: ImportBatch[];
  /** Admin-curated model catalog seeds — one doc per row in the
   *  `models` Firestore collection. Surfaced here so DeviceComboBox in
   *  Add Stock + Bulk Order + the admin Reconciliation tool all read
   *  from one live source instead of each subscribing independently. */
  models: ModelSeed[];
  /** `models` indexed by bucket key → the admin's chosen spelling
   *  (see `buildCatalogIndex` in modelReconciliation.ts). A derived
   *  layer, NOT baked into `units`/`sales` themselves — deliberately kept
   *  separate so a screen can look up "does this model have an admin-
   *  confirmed canonical name" for DISPLAY without that lookup ever being
   *  able to silently overwrite the unit's own stored `model` field (the
   *  exact failure mode Fix 1 above exists to prevent). Consumers call
   *  `canonicaliseModel(model, brand, catalogIndex)` themselves. */
  catalogIndex: Map<string, string>;
}

const Ctx = createContext<Store>({
  loaded: false,
  units: [],
  suppliers: [],
  sales: [],
  aggregates: [],
  accessoryStock: [],
  accessoryStockEvents: [],
  whatsappFeed: [],
  importBatches: [],
  models: [],
  catalogIndex: new Map(),
});

export function InventoryStoreProvider({ children }: { children: React.ReactNode }) {
  const [units, setUnits]                 = useState<InventoryUnit[]>([]);
  const [suppliers, setSuppliers]         = useState<Supplier[]>([]);
  const [sales, setSales]                 = useState<Sale[]>([]);
  const [aggregates, setAggregates]       = useState<InventoryAggregate[]>([]);
  const [accessoryStock, setAccessoryStock] = useState<AccessoryStock[]>([]);
  const [accessoryStockEvents, setAccessoryStockEvents] = useState<AccessoryStockEvent[]>([]);
  const [whatsappFeed, setWhatsappFeed]   = useState<SupplierWhatsappUpdate[]>([]);
  const [importBatches, setImportBatches] = useState<ImportBatch[]>([]);
  const [models, setModels]               = useState<ModelSeed[]>([]);
  const [loaded, setLoaded]               = useState(false);
  const catalogIndex = useMemo(() => buildCatalogIndex(models), [models]);

  useEffect(() => {
    let unitsReady = false;
    let salesReady = false;
    let aggregatesReady = false;

    const markLoaded = () => {
      if (unitsReady && salesReady && aggregatesReady) setLoaded(true);
    };

    // Fallback: match the existing 15s convention so the UI never stalls
    // forever if a master-file collection happens to be empty/offline.
    const timeout = setTimeout(() => setLoaded(true), 15000);

    const u = dbService.subscribeToCollection('inventoryUnits', (data: any[]) => {
      setUnits(data.map(deriveUnitFields));
      if (!unitsReady) { unitsReady = true; markLoaded(); }
    });
    const s = dbService.subscribeToCollection('suppliers', data => {
      setSuppliers(data);
    });
    const sl = dbService.subscribeToCollection('sales', (data: any[]) => {
      setSales(data.map(deriveSaleFields));
      if (!salesReady) { salesReady = true; markLoaded(); }
    });
    const ag = dbService.subscribeToCollection('inventoryAggregates', (data: any[]) => {
      setAggregates(data);
      if (!aggregatesReady) { aggregatesReady = true; markLoaded(); }
    });
    const acc = dbService.subscribeToCollection('accessoryStock', (data: any[]) => {
      setAccessoryStock(data);
    });
    const accEv = dbService.subscribeToCollection('accessoryStockEvents', (data: any[]) => {
      setAccessoryStockEvents(data);
    });
    const wa = dbService.subscribeToCollection('supplierWhatsappUpdates', data => {
      setWhatsappFeed(data);
    });
    const ib = dbService.subscribeToCollection('importBatches', data => {
      setImportBatches(data);
    });
    const md = dbService.subscribeToCollection('models', data => {
      setModels(data as ModelSeed[]);
    });

    return () => {
      clearTimeout(timeout);
      u();
      s();
      sl();
      ag();
      acc();
      accEv();
      wa();
      ib();
      md();
    };
  }, []);

  return (
    <Ctx.Provider
      value={{
        loaded,
        units,
        suppliers,
        sales,
        aggregates,
        accessoryStock,
        accessoryStockEvents,
        whatsappFeed,
        importBatches,
        models,
        catalogIndex,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useInventoryStore(): Store {
  return useContext(Ctx);
}
