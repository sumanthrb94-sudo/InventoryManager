export const GRADE_OPTIONS = ['A', 'B', 'C', 'Brand New', 'ONU'] as const;
export const STORAGE_OPTIONS = ['32GB', '64GB', '128GB', '256GB', '512GB', '1TB'] as const;

export type Grade = typeof GRADE_OPTIONS[number];
export type Storage = typeof STORAGE_OPTIONS[number];
