import React, { createContext, useContext, useState, useEffect } from 'react';
import { dbService } from './dbService';
import {
  InventoryUnit,
  Supplier,
  Sale,
  InventoryAggregate,
  SupplierWhatsappUpdate,
  ImportBatch,
  Marketplace,
  MarketplaceFee,
} from '../types';
import { applyMarketplaceFeeOverrides, subscribeToMarketplaceFees, getAllMarketplaceFees } from './platforms';

interface Store {
  loaded: boolean;
  units: InventoryUnit[];
  suppliers: Supplier[];
  // ── NEW master-file feeds ───────────────────────
  sales: Sale[];
  aggregates: InventoryAggregate[];
  whatsappFeed: SupplierWhatsappUpdate[];
  importBatches: ImportBatch[];
  // Bumps every time the marketplaceFees cache mutates. React-memoised
  // pipelines that depend on getMarketplaceFee (recomputeSale, GP%, the
  // Excel writer's Formulas tab) include this in their deps so they
  // recompute after an edit without each component having to subscribe.
  feesVersion: number;
  fees: Record<Marketplace, MarketplaceFee>;
}

const Ctx = createContext<Store>({
  loaded: false,
  units: [],
  suppliers: [],
  sales: [],
  aggregates: [],
  whatsappFeed: [],
  importBatches: [],
  feesVersion: 0,
  fees: getAllMarketplaceFees(),
});

export function InventoryStoreProvider({ children }: { children: React.ReactNode }) {
  const [units, setUnits]                 = useState<InventoryUnit[]>([]);
  const [suppliers, setSuppliers]         = useState<Supplier[]>([]);
  const [sales, setSales]                 = useState<Sale[]>([]);
  const [aggregates, setAggregates]       = useState<InventoryAggregate[]>([]);
  const [whatsappFeed, setWhatsappFeed]   = useState<SupplierWhatsappUpdate[]>([]);
  const [importBatches, setImportBatches] = useState<ImportBatch[]>([]);
  const [feesVersion, setFeesVersion]     = useState(0);
  const [fees, setFees]                   = useState<Record<Marketplace, MarketplaceFee>>(() => getAllMarketplaceFees());
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

    const u = dbService.subscribeToCollection('inventoryUnits', data => {
      setUnits(data);
      if (!unitsReady) { unitsReady = true; markLoaded(); }
    });
    const s = dbService.subscribeToCollection('suppliers', data => {
      setSuppliers(data);
    });
    const sl = dbService.subscribeToCollection('sales', data => {
      setSales(data);
      if (!salesReady) { salesReady = true; markLoaded(); }
    });
    const ag = dbService.subscribeToCollection('inventoryAggregates', data => {
      setAggregates(data);
      if (!aggregatesReady) { aggregatesReady = true; markLoaded(); }
    });
    const wa = dbService.subscribeToCollection('supplierWhatsappUpdates', data => {
      setWhatsappFeed(data);
    });
    const ib = dbService.subscribeToCollection('importBatches', data => {
      setImportBatches(data);
    });
    // Live marketplace-fee schedule. Each doc id is the Marketplace enum
    // value ('AMAZON' / 'BM' / 'EBAY' / 'ONBUY'); fields mirror the
    // MarketplaceFee shape. Missing docs fall back to defaults — the
    // operator only needs to write the ones they actually override.
    const mf = dbService.subscribeToCollection('marketplaceFees', data => {
      const patch: Partial<Record<Marketplace, Partial<MarketplaceFee>>> = {};
      for (const row of data) {
        const id = (row.id || row.marketplace) as Marketplace;
        if (!id) continue;
        patch[id] = row;
      }
      applyMarketplaceFeeOverrides(patch);
    });
    // The cache subscription bumps the feesVersion counter + republishes
    // the snapshot whenever applyMarketplaceFeeOverrides fires, so any
    // memoised React pipeline that lists `feesVersion` or `fees` in its
    // deps automatically re-fires.
    const unsubFees = subscribeToMarketplaceFees(() => {
      setFeesVersion(v => v + 1);
      setFees(getAllMarketplaceFees());
    });

    return () => {
      clearTimeout(timeout);
      u();
      s();
      sl();
      ag();
      wa();
      ib();
      mf();
      unsubFees();
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
        feesVersion,
        fees,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useInventoryStore(): Store {
  return useContext(Ctx);
}
