import React, { createContext, useContext, useState, useEffect } from 'react';
import { dbService } from './dbService';
import {
  InventoryUnit,
  Supplier,
  Sale,
  InventoryAggregate,
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
  whatsappFeed: [],
  importBatches: [],
  models: [],
});

export function InventoryStoreProvider({ children }: { children: React.ReactNode }) {
  const [units, setUnits]                 = useState<InventoryUnit[]>([]);
  const [suppliers, setSuppliers]         = useState<Supplier[]>([]);
  const [sales, setSales]                 = useState<Sale[]>([]);
  const [aggregates, setAggregates]       = useState<InventoryAggregate[]>([]);
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
        const expectedSku = [item.brand, item.model, item.storage].filter(Boolean).join(' ');
        return expectedSku && item.sku !== expectedSku ? { ...item, sku: expectedSku } : item;
      });
      setUnits(unified);
      if (!unitsReady) { unitsReady = true; markLoaded(); }
    });
    const s = dbService.subscribeToCollection('suppliers', data => {
      setSuppliers(data);
    });
    const sl = dbService.subscribeToCollection('sales', (data: any[]) => {
      const unified = data.map(item => {
        if (!item.model) return item;
        const parsed = parseBrandModelStorage(item.model);
        const brand = parsed.brand !== 'Other' ? parsed.brand : '';
        const expectedSku = [brand, item.model, parsed.storage].filter(Boolean).join(' ');
        return expectedSku && item.sku !== expectedSku ? { ...item, sku: expectedSku } : item;
      });
      setSales(unified);
      if (!salesReady) { salesReady = true; markLoaded(); }
    });
    const ag = dbService.subscribeToCollection('inventoryAggregates', (data: any[]) => {
      setAggregates(data);
      if (!aggregatesReady) { aggregatesReady = true; markLoaded(); }
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
