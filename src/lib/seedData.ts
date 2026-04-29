type SeedInventory = {
  suppliers: any[];
  units: any[];
};

function isCollectionEmpty(key: string): boolean {
  return !localStorage.getItem(key);
}

export async function seedDefaultInventoryData() {
  if (typeof window === 'undefined') return;

  if (!isCollectionEmpty('nexus_db_suppliers') || !isCollectionEmpty('nexus_db_inventoryUnits')) {
    return;
  }

  const seedModule = (await import('../../og_inventory_import.json')) as { default: SeedInventory };
  const seed = seedModule.default;

  if (!seed?.suppliers?.length || !seed?.units?.length) return;

  localStorage.setItem('nexus_db_suppliers', JSON.stringify(seed.suppliers));
  localStorage.setItem('nexus_db_inventoryUnits', JSON.stringify(seed.units));
}
