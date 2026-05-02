/**
 * PLATFORMS — single source of truth for all 4 listing sites.
 * Import this wherever you need platform names, colors, or commission rates.
 */

export const PLATFORM_LIST = ['eBay', 'Amazon', 'OnBuy', 'Backmarket'] as const;
export type Platform = typeof PLATFORM_LIST[number];

export interface PlatformConfig {
  name: Platform;
  /** Approximate commission % taken by the platform */
  commission: number;
  /** Tailwind badge classes */
  badge: string;
  /** Tailwind ring/border accent */
  accent: string;
  /** Hex brand color for charts */
  hex: string;
}

export const PLATFORMS: Record<Platform, PlatformConfig> = {
  eBay: {
    name: 'eBay',
    // 12.8% Final Value Fee on total (incl. postage) + £0.30/order fixed — UK phones category 2024/25
    commission: 12.8,
    badge: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    accent: 'border-yellow-400',
    hex: '#f59e0b',
  },
  Amazon: {
    name: 'Amazon',
    // 8% Referral Fee — UK phones & electronics category 2024/25
    commission: 8.0,
    badge: 'bg-orange-100 text-orange-800 border-orange-200',
    accent: 'border-orange-400',
    hex: '#f97316',
  },
  OnBuy: {
    name: 'OnBuy',
    // 9% standard Boost plan commission — UK 2024/25
    commission: 9.0,
    badge: 'bg-blue-100 text-blue-800 border-blue-200',
    accent: 'border-blue-400',
    hex: '#3b82f6',
  },
  Backmarket: {
    name: 'Backmarket',
    // ~10% for refurbished smartphones — varies 6–12% by grade
    commission: 10.0,
    badge: 'bg-green-100 text-green-800 border-green-200',
    accent: 'border-green-400',
    hex: '#10b981',
  },
};

/** Quick badge lookup — falls back gracefully for unknown platforms */
export function platformBadge(name: string): string {
  return PLATFORMS[name as Platform]?.badge ?? 'bg-gray-100 text-gray-600 border-gray-200';
}

/** Commission % for a platform */
export function platformCommission(name: string): number {
  return PLATFORMS[name as Platform]?.commission ?? 0;
}

/** Commission amount in £ */
export function platformCommissionAmt(name: string, salePrice: number): number {
  return +(salePrice * platformCommission(name) / 100).toFixed(2);
}
