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


/**
 * Snap a grade string to the canonical option, ignoring case and padding.
 *
 * Grades arrive from four places — three intake screens and the bulk
 * importer — and for a while two of them wrote 'Brand new' while the
 * constant said 'Brand New'. Firestore treats those as different values,
 * so one grade showed up twice in every breakdown. Normalising on the way
 * in means the split can't reopen; migrations/normaliseGradeCasing.ts
 * repairs the rows written before this existed.
 *
 * Returns the input trimmed but otherwise untouched when it matches no
 * option — an operator's genuine free-text grade is not ours to rewrite.
 */
export function normaliseGrade(raw: string | undefined | null): string {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  const match = GRADE_OPTIONS.find(g => g.toLowerCase() === value.toLowerCase());
  return match ?? value;
}

/** Same treatment for SIM type, which has the same multi-screen exposure. */
export function normaliseSimType(raw: string | undefined | null): string {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  const match = SIM_TYPE_OPTIONS.find(s => s.toLowerCase() === value.toLowerCase());
  return match ?? value;
}
