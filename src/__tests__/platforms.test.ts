import { describe, it, expect } from 'vitest';
import {
  PLATFORM_LIST,
  PLATFORMS,
  DEFAULT_POSTAGE_COST,
  platformBadge,
  platformCommission,
  platformFixedFee,
  platformTotalFee,
  platformCommissionAmt,
  calcNetProfit,
} from '../lib/platforms';

describe('PLATFORM_LIST', () => {
  it('contains exactly the 4 supported platforms', () => {
    expect(PLATFORM_LIST).toEqual(['eBay', 'Amazon', 'OnBuy', 'Backmarket']);
  });

  it('every platform in the list has a config entry', () => {
    for (const name of PLATFORM_LIST) {
      expect(PLATFORMS[name]).toBeDefined();
      expect(PLATFORMS[name].name).toBe(name);
    }
  });
});

describe('platformCommission', () => {
  it('returns the correct commission for each platform', () => {
    expect(platformCommission('eBay')).toBe(12.8);
    expect(platformCommission('Amazon')).toBe(8.0);
    expect(platformCommission('OnBuy')).toBe(9.0);
    expect(platformCommission('Backmarket')).toBe(10.0);
  });

  it('returns 0 for unknown platforms', () => {
    expect(platformCommission('Etsy')).toBe(0);
    expect(platformCommission('')).toBe(0);
  });
});

describe('platformFixedFee', () => {
  it('returns the per-order fixed fee for each platform', () => {
    expect(platformFixedFee('eBay')).toBe(0.30);
    expect(platformFixedFee('Amazon')).toBe(0);
    expect(platformFixedFee('OnBuy')).toBe(0);
    expect(platformFixedFee('Backmarket')).toBe(0);
  });

  it('returns 0 for unknown platforms', () => {
    expect(platformFixedFee('Unknown')).toBe(0);
  });
});

describe('platformBadge', () => {
  it('returns the platform-specific badge classes', () => {
    expect(platformBadge('eBay')).toContain('yellow');
    expect(platformBadge('Amazon')).toContain('orange');
    expect(platformBadge('OnBuy')).toContain('blue');
    expect(platformBadge('Backmarket')).toContain('green');
  });

  it('falls back to neutral gray for unknown platforms', () => {
    expect(platformBadge('Etsy')).toContain('gray');
  });
});

describe('platformTotalFee', () => {
  it('combines percentage commission and fixed fee', () => {
    // eBay: 12.8% of 500 + £0.30 = 64.00 + 0.30 = 64.30
    expect(platformTotalFee('eBay', 500)).toBe(64.30);
  });

  it('returns just commission when fixed fee is 0', () => {
    // Amazon: 8% of 500 = 40
    expect(platformTotalFee('Amazon', 500)).toBe(40);
  });

  it('rounds to 2 decimal places', () => {
    // OnBuy: 9% of 333 = 29.97
    expect(platformTotalFee('OnBuy', 333)).toBe(29.97);
  });

  it('returns 0 for unknown platform with no sale', () => {
    expect(platformTotalFee('Unknown', 0)).toBe(0);
  });

  it('returns 0 for unknown platform regardless of sale price', () => {
    expect(platformTotalFee('Unknown', 1000)).toBe(0);
  });
});

describe('platformCommissionAmt', () => {
  it('returns percentage-only commission (no fixed fee)', () => {
    expect(platformCommissionAmt('eBay', 500)).toBe(64);
    expect(platformCommissionAmt('Amazon', 500)).toBe(40);
  });

  it('returns 0 for free sale price', () => {
    expect(platformCommissionAmt('eBay', 0)).toBe(0);
  });
});

describe('calcNetProfit', () => {
  it('calculates net profit using default postage of £8', () => {
    // eBay sale at 500, bought for 300:
    //   fee = 500 * 0.128 + 0.30 = 64.30
    //   net = 500 - 300 - 64.30 - 8 = 127.70
    expect(calcNetProfit(500, 300, 'eBay')).toBe(127.70);
  });

  it('uses provided postage cost when supplied', () => {
    // eBay sale at 500, bought for 300, postage 12:
    //   net = 500 - 300 - 64.30 - 12 = 123.70
    expect(calcNetProfit(500, 300, 'eBay', 12)).toBe(123.70);
  });

  it('returns negative when fees + postage exceed margin', () => {
    // eBay sale at 100, bought for 95, default postage 8:
    //   fee = 100 * 0.128 + 0.30 = 13.10
    //   net = 100 - 95 - 13.10 - 8 = -16.10
    expect(calcNetProfit(100, 95, 'eBay')).toBe(-16.10);
  });

  it('handles zero postage', () => {
    expect(calcNetProfit(500, 300, 'Amazon', 0)).toBe(160); // 500 - 300 - 40 - 0
  });

  it('uses 0 commission when platform is unknown', () => {
    // Unknown platform: no fee, no fixed fee. Net = SP - BP - 0 - postage
    expect(calcNetProfit(500, 300, 'Etsy', 0)).toBe(200);
  });

  it('exposes DEFAULT_POSTAGE_COST = 8 as the default', () => {
    expect(DEFAULT_POSTAGE_COST).toBe(8);
  });
});
