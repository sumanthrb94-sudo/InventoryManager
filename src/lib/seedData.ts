type SeedInventory = {
  suppliers: Array<Record<string, any>>;
  units: Array<Record<string, any>>;
};

type StoredUnit = Record<string, any>;

function parseStoredCollection<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function hasDuplicateIds(units: StoredUnit[]): boolean {
  const seen = new Set<string>();
  for (const unit of units) {
    if (!unit?.id) continue;
    if (seen.has(unit.id)) return true;
    seen.add(unit.id);
  }
  return false;
}

function inferBrand(model: string, fallbackBrand?: string) {
  const m = model.toUpperCase();
  if (m.includes('IPHONE') || m.includes('IPAD') || m.includes('APPLE WATCH') || m.includes('IWATCH') || m.includes('WATCH')) {
    return 'Apple';
  }
  if (m.includes('SAMSUNG') || m.includes('GALAXY')) {
    return 'Samsung';
  }
  return fallbackBrand || 'Other';
}

function inferCategory(model: string, fallbackCategory?: string) {
  const m = model.toUpperCase();
  if (m.includes('IPAD')) return 'iPad';
  if (m.includes('IPHONE')) return 'iPhone';
  if (m.includes('APPLE WATCH') || m.includes('IWATCH') || m.includes('WATCH ULTRA') || m.includes('WATCH SE') || m.includes('WATCH')) return 'Apple Watch';
  if (m.includes('GALAXY TAB') || m.includes('TAB A') || m.includes('TAB S') || m.includes('TAB')) return 'Tablet';
  if (m.includes('SAMSUNG') || m.includes('GALAXY')) {
    if (m.includes(' A') || /\bA\d{2}\b/.test(m) || /\bA\d{3}\b/.test(m)) return 'Samsung A Series';
    return 'Samsung S Series';
  }
  return fallbackCategory || 'Other';
}

function inferColour(model: string, fallbackColour?: string) {
  if (fallbackColour && fallbackColour !== 'Unknown') return fallbackColour;

  const upper = model.toUpperCase();
  const colours = [
    'NATURAL TITANIUM', 'BLACK TITANIUM', 'WHITE TITANIUM', 'BLUE TITANIUM', 'DESERT TITANIUM',
    'PACIFIC BLUE', 'SIERRA BLUE', 'ALPINE GREEN', 'SPACE GREY', 'SPACE GRAY', 'GRAPHITE',
    'STARLIGHT', 'MIDNIGHT', 'BLACKNBLUE', 'BLACK', 'WHITE', 'BLUE', 'GOLD', 'SILVER',
    'ROSE GOLD', 'ROSE', 'RED', 'GREEN', 'YELLOW', 'PURPLE', 'CORAL', 'MINT', 'PINK', 'TEAL',
    'ORANGE', 'CREAM', 'LAVENDER', 'PHANTOM BLACK', 'PHANTOM WHITE', 'PHANTOM SILVER',
  ];

  for (const colour of colours) {
    if (upper.includes(colour)) {
      if (colour === 'SPACE GREY' || colour === 'SPACE GRAY') return 'Space Grey';
      if (colour === 'BLACKNBLUE') return 'Black';
      return colour.charAt(0) + colour.slice(1).toLowerCase();
    }
  }

  return fallbackColour || 'Unknown';
}

function normaliseUnits(units: StoredUnit[]) {
  const deduped = new Map<string, StoredUnit>();

  for (const raw of units) {
    if (!raw || !raw.id) continue;
    const model = String(raw.model || '').trim();
    const category = inferCategory(model, raw.category);
    const brand = inferBrand(model, raw.brand);
    const isSold = raw.status === 'sold';
    const saleDate = raw.saleDate || (isSold ? raw.dateIn : undefined);

    deduped.set(raw.id, {
      ...raw,
      model,
      brand,
      category,
      colour: inferColour(model, raw.colour),
      status: isSold ? 'sold' : raw.status || 'available',
      platformListed: isSold ? false : Boolean(raw.platformListed),
      ...(isSold && saleDate ? { saleDate } : {}),
    });
  }

  return Array.from(deduped.values());
}

export async function seedDefaultInventoryData() {
  if (typeof window === 'undefined') return;

  const existingSuppliers = parseStoredCollection<Record<string, any>>('nexus_db_suppliers');
  const existingUnits = parseStoredCollection<StoredUnit>('nexus_db_inventoryUnits');
  const hasExistingData = existingSuppliers.length > 0 && existingUnits.length > 0;

  if (hasExistingData && !hasDuplicateIds(existingUnits)) {
    return;
  }

  const seedModule = (await import('../../imported_inventory.json')) as { default: SeedInventory };
  const seed = seedModule.default;

  if (!seed?.suppliers?.length || !seed?.units?.length) return;

  const suppliers = seed.suppliers.map(supplier => ({ ...supplier }));
  const units = normaliseUnits(seed.units);

  localStorage.setItem('nexus_db_suppliers', JSON.stringify(suppliers));
  localStorage.setItem('nexus_db_inventoryUnits', JSON.stringify(units));
}
