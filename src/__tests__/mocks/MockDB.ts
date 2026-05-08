import { InventoryUnit } from '../../types';
import { generateMockSeedData, getMockDataStats } from '../fixtures/seedMockData';

export class MockDB {
  private units: Map<string, InventoryUnit> = new Map();

  create(id: string, unit: InventoryUnit) {
    this.units.set(id, { ...unit });
  }

  read(id: string): InventoryUnit | undefined {
    const unit = this.units.get(id);
    return unit ? { ...unit } : undefined;
  }

  update(id: string, patch: Partial<InventoryUnit>) {
    const unit = this.units.get(id);
    if (unit) {
      this.units.set(id, { ...unit, ...patch });
    }
    return this.read(id);
  }

  getAll(): InventoryUnit[] {
    return Array.from(this.units.values());
  }

  clear() {
    this.units.clear();
  }

  loadSeedData() {
    const seedUnits = generateMockSeedData();
    seedUnits.forEach(unit => {
      this.units.set(unit.id, unit);
    });
    return seedUnits;
  }

  getStats() {
    return getMockDataStats(this.getAll());
  }

  // Helper methods for easier API testing
  getUnits(filters?: {
    status?: string;
    model?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): InventoryUnit[] {
    let results = this.getAll();

    if (filters?.status) {
      results = results.filter(u => u.status === filters.status);
    }

    if (filters?.model) {
      results = results.filter(u => u.model?.toLowerCase().includes(filters.model.toLowerCase()));
    }

    if (filters?.search) {
      const searchLower = filters.search.toLowerCase();
      results = results.filter(
        u =>
          u.model?.toLowerCase().includes(searchLower) ||
          u.imei?.toLowerCase().includes(searchLower) ||
          u.colour?.toLowerCase().includes(searchLower)
      );
    }

    const offset = filters?.offset || 0;
    const limit = filters?.limit || 500;

    return results.slice(offset, offset + limit);
  }

  getUnitById(id: string): InventoryUnit | undefined {
    return this.read(id);
  }

  createUnit(unit: Partial<InventoryUnit>): InventoryUnit {
    const id = unit.id || Math.random().toString(36).substring(2, 11);
    const newUnit: InventoryUnit = {
      id,
      imei: unit.imei || '',
      model: unit.model || 'Unknown',
      brand: unit.brand || 'Unknown',
      category: unit.category || 'phone',
      colour: unit.colour || 'Unknown',
      buyPrice: unit.buyPrice || 0,
      dateIn: unit.dateIn || new Date().toISOString().split('T')[0],
      supplierId: unit.supplierId || 'unknown',
      batchId: unit.batchId || 'unknown',
      status: (unit.status as any) || 'available',
      flags: unit.flags || [],
      notes: unit.notes || '',
      platformListed: unit.platformListed || false,
      listingSites: unit.listingSites || [],
      ownerId: unit.ownerId || 'shared',
      createdAt: unit.createdAt || new Date().toISOString(),
      updatedAt: unit.updatedAt || new Date().toISOString(),
      // Optional sale data
      ...(unit.salePrice && { salePrice: unit.salePrice }),
      ...(unit.salePlatform && { salePlatform: unit.salePlatform }),
      ...(unit.saleDate && { saleDate: unit.saleDate }),
      ...(unit.postageCost && { postageCost: unit.postageCost }),
      ...(unit.platformFee && { platformFee: unit.platformFee }),
      ...(unit.profit !== undefined && { profit: unit.profit }),
      ...(unit.returnType && { returnType: unit.returnType }),
      ...(unit.returnReason && { returnReason: unit.returnReason }),
    };
    this.create(id, newUnit);
    return newUnit;
  }

  updateUnit(id: string, patch: Partial<InventoryUnit>): InventoryUnit | undefined {
    return this.update(id, patch);
  }

  getSuppliers() {
    const suppliers = new Map<string, { id: string; name: string; createdAt: string }>();
    this.getAll().forEach(unit => {
      if (unit.supplierId && !suppliers.has(unit.supplierId)) {
        suppliers.set(unit.supplierId, {
          id: unit.supplierId,
          name: `Supplier ${unit.supplierId}`,
          createdAt: new Date().toISOString(),
        });
      }
    });
    return Array.from(suppliers.values());
  }

  getSupplierById(id: string) {
    const suppliers = this.getSuppliers();
    return suppliers.find(s => s.id === id);
  }

  createSupplier(supplier: { id?: string; name: string; createdAt?: string }) {
    const id = supplier.id || Math.random().toString(36).substring(2, 11);
    return {
      id,
      name: supplier.name,
      createdAt: supplier.createdAt || new Date().toISOString(),
    };
  }

  reset() {
    this.clear();
  }
}
