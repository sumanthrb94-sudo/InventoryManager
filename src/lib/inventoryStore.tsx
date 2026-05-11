import React, { createContext, useContext, useState, useEffect } from 'react';
import { dbService } from './dbService';
import { InventoryUnit, Supplier } from '../types';
import seedData from './clientSeedData.json';

interface Store {
  units: InventoryUnit[];
  suppliers: Supplier[];
  loaded: boolean;
}

const Ctx = createContext<Store>({ units: [], suppliers: [], loaded: false });

// DEMO MODE: while auth is bypassed we can't read Firestore (rules require
// auth). Seed the store from the bundled clientSeedData.json immediately
// so the UI has data to show. The Firestore subscription below will
// override this seed once/if real auth resolves and reads start working.
const SEED_UNITS = (seedData as any).units as InventoryUnit[];
const SEED_SUPPLIERS = (seedData as any).suppliers as Supplier[];

export function InventoryStoreProvider({ children }: { children: React.ReactNode }) {
  const [units, setUnits]         = useState<InventoryUnit[]>(SEED_UNITS);
  const [suppliers, setSuppliers] = useState<Supplier[]>(SEED_SUPPLIERS);
  const [loaded, setLoaded]       = useState(true);

  useEffect(() => {
    const timeout = setTimeout(() => setLoaded(true), 15000);

    const u = dbService.subscribeToCollection('inventoryUnits', data => {
      // Only replace seed data if Firestore returned a non-empty list —
      // an empty/denied response shouldn't wipe out the demo data.
      if (data && data.length > 0) setUnits(data);
      setLoaded(true);
    });
    const s = dbService.subscribeToCollection('suppliers', data => {
      if (data && data.length > 0) setSuppliers(data);
      setLoaded(true);
    });

    return () => { clearTimeout(timeout); u(); s(); };
  }, []);

  return <Ctx.Provider value={{ units, suppliers, loaded }}>{children}</Ctx.Provider>;
}

export function useInventoryStore(): Store {
  return useContext(Ctx);
}
