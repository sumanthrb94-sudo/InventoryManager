import React, { createContext, useContext, useState, useEffect } from 'react';
import { dbService } from './dbService';
import { InventoryUnit, Supplier } from '../types';

interface Store {
  units: InventoryUnit[];
  suppliers: Supplier[];
  deletedUnits: InventoryUnit[];
  loaded: boolean;
}

const Ctx = createContext<Store>({ units: [], suppliers: [], deletedUnits: [], loaded: false });

export function InventoryStoreProvider({ children }: { children: React.ReactNode }) {
  const [units, setUnits]                 = useState<InventoryUnit[]>([]);
  const [suppliers, setSuppliers]         = useState<Supplier[]>([]);
  const [deletedUnits, setDeletedUnits]   = useState<InventoryUnit[]>([]);
  const [loaded, setLoaded]               = useState(false);

  useEffect(() => {
    let unitsReady = false;
    let suppliersReady = false;

    const markLoaded = () => {
      if (unitsReady && suppliersReady) setLoaded(true);
    };

    const timeout = setTimeout(() => setLoaded(true), 15000);

    const u = dbService.subscribeToCollection('inventoryUnits', data => {
      setUnits(data);
      if (!unitsReady) { unitsReady = true; markLoaded(); }
    });
    const s = dbService.subscribeToCollection('suppliers', data => {
      setSuppliers(data);
      if (!suppliersReady) { suppliersReady = true; markLoaded(); }
    });
    const d = dbService.subscribeToCollection(
      'inventoryUnits',
      setDeletedUnits,
      { deletedOnly: true },
    );

    return () => { clearTimeout(timeout); u(); s(); d(); };
  }, []);

  return <Ctx.Provider value={{ units, suppliers, deletedUnits, loaded }}>{children}</Ctx.Provider>;
}

export function useInventoryStore(): Store {
  return useContext(Ctx);
}
