/**
 * Services barrel — single import surface for every business-rule-aware
 * writer. UI components should import from here so the routing layer can be
 * swapped without touching consumers.
 */
export * from './inventoryService';
export * from './salesService';
export * from './listingService';
export * from './returnsService';
