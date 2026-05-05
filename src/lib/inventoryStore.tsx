import React, { createContext, useContext, useState, useEffect } from 'react';
import { dbService } from './dbService';
import { InventoryUnit, Supplier } from '../types';

interface Store {
  units: InventoryUnit[];
  suppliers: Supplier[];
  loaded: boolean;
}

const Ctx = createContext<Store>({ units: [], suppliers: [], loaded: false });

export function InventoryStoreProvider({ children }: { children: React.ReactNode }) {
  const [units, setUnits]         = useState<InventoryUnit[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loaded, setLoaded]       = useState(false);

  useEffect(() => {
    let unitsReady = false;
    let suppliersReady = false;

    const markLoaded = () => {
      if (unitsReady && suppliersReady) setLoaded(true);
    };

    // If localStorage was just wiped (seed version mismatch), give seedData up to 20s
    // to repopulate before we bail. If cache exists, 5s is plenty.
    const hasCached = (() => { try { return !!localStorage.getItem('nexus_db_inventoryUnits'); } catch { return false; } })();
    const timeout = setTimeout(() => setLoaded(true), hasCached ? 5000 : 20000);

    const u = dbService.subscribeToCollection('inventoryUnits', data => {
      setUnits(data);
      if (!unitsReady) { unitsReady = true; markLoaded(); }
    });
    const s = dbService.subscribeToCollection('suppliers', data => {
      setSuppliers(data);
      if (!suppliersReady) { suppliersReady = true; markLoaded(); }
    });

    return () => { clearTimeout(timeout); u(); s(); };
  }, []);

  return <Ctx.Provider value={{ units, suppliers, loaded }}>{children}</Ctx.Provider>;
}

export function useInventoryStore(): Store {
  return useContext(Ctx);
}
