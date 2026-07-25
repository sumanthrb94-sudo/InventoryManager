/**
 * Condition grades — the ONLY values any intake path may offer.
 *
 * Order and casing match what the operator sees in Add Stock, which is
 * the highest-volume intake path and therefore where most existing data
 * came from. AddStockManualModal and BulkOrderModal each used to carry a
 * private copy of this list that differed from here by casing
 * ('Brand new' vs 'Brand New'), so the same grade written from two
 * screens would not group together in any report.
 */
export const GRADE_OPTIONS = ['A', 'B', 'C', 'ONU', 'Brand new'] as const;
export const STORAGE_OPTIONS = ['16GB', '32GB', '64GB', '128GB', '256GB', '512GB', '1TB', 'Not Applicable'] as const;

/**
 * SIM configurations — confirmed against the live Add Stock dropdown.
 * The UI additionally offers an "Other" escape hatch that accepts free
 * text (see FormSelects.SimTypeSelectCompact), so these are the presets,
 * not a closed set.
 */
export const SIM_TYPE_OPTIONS = ['Physical SIM', 'Physical SIM + eSIM', 'Dual Physical SIM', 'Not Applicable'] as const;

export type Grade = typeof GRADE_OPTIONS[number];
export type Storage = typeof STORAGE_OPTIONS[number];
export type SimType = typeof SIM_TYPE_OPTIONS[number];
