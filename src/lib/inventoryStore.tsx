import React, { createContext, useContext, useState, useEffect } from 'react';
import { dbService } from './dbService';
import {
  InventoryUnit,
  Supplier,
  Sale,
  InventoryAggregate,
  AccessoryStock,
  SupplierWhatsappUpdate,
  ImportBatch,
} from '../types';
import type { ModelSeed } from './deviceCatalog';
import { parseBrandModelStorage } from './modelStorage';

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
  whatsappFeed: SupplierWhatsappUpdate[];
  importBatches: ImportBatch[];
  /** Admin-curated model catalog seeds — one doc per row in the
   *  `models` Firestore collection. Surfaced here so DeviceComboBox in
   *  Add Stock + Bulk Order + the admin Reconciliation tool all read
   *  from one live source instead of each subscribing independently. */
  models: ModelSeed[];
}

const Ctx = createContext<Store>({
  loaded: false,
  units: [],
  suppliers: [],
  sales: [],
  aggregates: [],
  accessoryStock: [],
  whatsappFeed: [],
  importBatches: [],
  models: [],
});

export function InventoryStoreProvider({ children }: { children: React.ReactNode }) {
  const [units, setUnits]                 = useState<InventoryUnit[]>([]);
  const [suppliers, setSuppliers]         = useState<Supplier[]>([]);
  const [sales, setSales]                 = useState<Sale[]>([]);
  const [aggregates, setAggregates]       = useState<InventoryAggregate[]>([]);
  const [accessoryStock, setAccessoryStock] = useState<AccessoryStock[]>([]);
  const [whatsappFeed, setWhatsappFeed]   = useState<SupplierWhatsappUpdate[]>([]);
  const [importBatches, setImportBatches] = useState<ImportBatch[]>([]);
  const [models, setModels]               = useState<ModelSeed[]>([]);
  const [loaded, setLoaded]               = useState(false);

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
      const unified = data.map(item => {
        if (!item.model) return item;
        const rawModel = item.model;
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
          sku: expectedSku || item.sku
        };
      });
      setUnits(unified);
      if (!unitsReady) { unitsReady = true; markLoaded(); }
    });
    const s = dbService.subscribeToCollection('suppliers', data => {
      setSuppliers(data);
    });
    const sl = dbService.subscribeToCollection('sales', (data: any[]) => {
      const unified = data.map(item => {
        const rawModel = item.model || item.sku;
        if (!rawModel) return item;
        const parsed = parseBrandModelStorage(rawModel);
        const cleanModel = parsed.model || rawModel;
        const brand = parsed.brand !== 'Other' ? parsed.brand : '';
        const expectedSku = [brand, cleanModel, parsed.storage].filter(Boolean).join(' ');
        
        return {
          ...item,
          model: cleanModel,
          sku: expectedSku || item.sku
        };
      });
      setSales(unified);
      if (!salesReady) { salesReady = true; markLoaded(); }
    });
    const ag = dbService.subscribeToCollection('inventoryAggregates', (data: any[]) => {
      setAggregates(data);
      if (!aggregatesReady) { aggregatesReady = true; markLoaded(); }
    });
    const acc = dbService.subscribeToCollection('accessoryStock', (data: any[]) => {
      setAccessoryStock(data);
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
        whatsappFeed,
        importBatches,
        models,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useInventoryStore(): Store {
  return useContext(Ctx);
}
