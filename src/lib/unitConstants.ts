export const GRADE_OPTIONS = ['A', 'B', 'C', 'Brand New', 'ONU'] as const;
export const STORAGE_OPTIONS = ['32GB', '64GB', '128GB', '256GB', '512GB', '1TB'] as const;

// SimType options — placeholder until the client confirms the canonical
// dropdown list. The UI surfaces this on every stock-intake path.
export const SIM_TYPE_OPTIONS = ['Physical SIM', 'eSIM', 'Dual SIM', 'Not Applicable'] as const;

export type Grade = typeof GRADE_OPTIONS[number];
export type Storage = typeof STORAGE_OPTIONS[number];
export type SimType = typeof SIM_TYPE_OPTIONS[number];
