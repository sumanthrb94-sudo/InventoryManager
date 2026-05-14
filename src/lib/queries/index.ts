// Barrel for typed query hooks. Each is a thin selector over the
// existing inventoryStore — useInventoryStore is still the
// subscription substrate; these just expose pre-built views.
export { useAvailableUnits }  from './useAvailableUnits';
export { useDeletedUnits }    from './useDeletedUnits';
export { useUnitsBySupplier } from './useUnitsBySupplier';
export { useShsIncoming }     from './useShsIncoming';
export { useRecentlyRemoved } from './useRecentlyRemoved';
export { useUnitByImei }      from './useUnitByImei';
