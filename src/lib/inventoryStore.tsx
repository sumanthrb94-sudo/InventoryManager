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

/**
 * Master switch for the display-time model-catalog override (Dashboard's
 * Top Models / Top Sold, and the periodic table's tiles). When on, the
 * admin's `models` catalog is the authority on how a model name is
 * DISPLAYED, so two units of the same model spelled differently collapse
 * under the operator's chosen spelling.
 *
 * ON. It was switched off for one day (2026-07-31) because the catalog
 * itself was not fit to be an authority: most rows carried a blank brand
 * with the brand word fused into an ALL-CAPS model string ("APPLE IPHONE
 * 12"), courtesy of a hardcoded `brand=""` on the "+ Add" pill. With the
 * override on, those rows won — a unit stored as "iPhone 12" rendered as
 * "APPLE IPHONE 12" — and where a model existed twice ("IPHONE 14" and
 * "APPLE IPHONE 14") whichever Firestore returned first won, making the
 * displayed name arbitrary between loads.
 *
 * Both causes are now fixed: the write paths split the brand out, and the
 * existing rows were repaired via `normaliseModelCatalog` (Admin →
 * Configuration → "Model catalog brand split"), which the operator ran.
 *
 * If model names ever look wrong across Dashboard / the periodic table
 * again, flipping this to `false` is the one-line way to rule the catalog
 * in or out: off means every screen falls back to each unit's own stored
 * model, because an empty index makes `canonicaliseModel` pass through.
 */
export const CATALOG_DISPLAY_OVERRIDE_ENABLED = true;

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
    // The STORED sku wins. This used to read `expectedSku || item.sku`,
    // which overwrote the operator's real SKU with one synthesised from
    // brand + model + storage — so a unit whose model was still a raw code
    // had its provenance destroyed at read time: "AW SE 3-40-MN" (an Apple
    // Watch SE 3, 40mm, Midnight — the ONLY record of what the marketplace
    // actually sold) was replaced by the model fragment "3-40-MN".
    //
    // That is exactly backwards. The synthesised string is a display
    // convenience; the stored one is the source data every decoder needs,
    // and it is the only place storage / colour survive for a unit created
    // from a sale. Synthesise only to fill a genuine blank.
    sku: item.sku || expectedSku,
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
  // An empty index makes every canonicaliseModel() call fall through to the
  // unit's own stored model — i.e. exactly the pre-override behaviour — so
  // the switch needs no changes at any consumer.
  const catalogIndex = useMemo(
    () => (CATALOG_DISPLAY_OVERRIDE_ENABLED ? buildCatalogIndex(models) : new Map<string, string>()),
    [models],
  );

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
