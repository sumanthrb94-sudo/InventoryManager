/**
 * capital.ts — where the money is, and what it earned.
 *
 * The existing analytics answer operational questions: what sold, what is
 * sitting, which model moves fastest. They are all counts. A CEO's questions
 * are the same shapes in POUNDS, and two of them the app could not answer at
 * all:
 *
 *   How much cash is trapped in stock, and how old is it?
 *     Aged stock existed as "12 units over 90 days" — twelve £600 phones and
 *     twelve £90 phones are the same number on that tile, and a very
 *     different problem.
 *
 *   Which supplier actually makes money?
 *     Supplier performance summed gross profit on sales that stuck. It did
 *     not subtract what came back. A supplier with great margins and a 20%
 *     return rate can be the worst one you have, and nothing showed it.
 *
 * Everything here is derived. Nothing is stored, so these are lenses over
 * the same units and sales every other screen reads.
 */
import type { InventoryUnit, Sale } from '../types';

const DAY = 86_400_000;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Stock still on the books — what capital is actually committed to. */
const isHeld = (u: InventoryUnit) =>
  u.status === 'available' || u.status === 'incoming';

export interface AgeBucket {
  label: string;
  minDays: number;
  maxDays: number;
  units: number;
  /** Buy-price capital sitting in this bucket. */
  value: number;
  /** Share of total held capital, 0-100. */
  share: number;
}

const BUCKETS: Array<{ label: string; min: number; max: number }> = [
  { label: '0–30 days', min: 0, max: 30 },
  { label: '31–60 days', min: 31, max: 60 },
  { label: '61–90 days', min: 61, max: 90 },
  { label: '90+ days', min: 91, max: Infinity },
];

export interface CapitalPosition {
  totalUnits: number;
  totalValue: number;
  officeValue: number;
  /** Supplier-held: committed but not yet in our hands. */
  shsValue: number;
  buckets: AgeBucket[];
  /** Capital in stock older than 90 days — the write-down conversation. */
  agedValue: number;
  agedShare: number;
}

/**
 * Capital tied up in held stock, bucketed by age.
 *
 * Age runs from `dateIn`. A unit with no readable date lands in the oldest
 * bucket rather than being dropped — undated stock is more likely to be
 * forgotten stock, and silently excluding it would understate exactly the
 * number this exists to surface.
 */
export function capitalPosition(units: InventoryUnit[], now: number): CapitalPosition {
  const held = units.filter(isHeld);
  const totalValue = r2(held.reduce((a, u) => a + (u.buyPrice ?? 0), 0));

  const rows = BUCKETS.map(b => ({ ...b, units: 0, value: 0 }));
  for (const u of held) {
    const t = u.dateIn ? new Date(u.dateIn).getTime() : NaN;
    const days = Number.isFinite(t) ? Math.floor((now - t) / DAY) : Infinity;
    const bucket = rows.find(b => days >= b.min && days <= b.max) ?? rows[rows.length - 1];
    bucket.units += 1;
    bucket.value += u.buyPrice ?? 0;
  }

  const aged = rows[rows.length - 1];
  return {
    totalUnits: held.length,
    totalValue,
    officeValue: r2(held.filter(u => u.status === 'available').reduce((a, u) => a + (u.buyPrice ?? 0), 0)),
    shsValue: r2(held.filter(u => u.status === 'incoming').reduce((a, u) => a + (u.buyPrice ?? 0), 0)),
    buckets: rows.map(b => ({
      label: b.label,
      minDays: b.min,
      maxDays: b.max,
      units: b.units,
      value: r2(b.value),
      share: totalValue > 0 ? r2((b.value / totalValue) * 100) : 0,
    })),
    agedValue: r2(aged.value),
    agedShare: totalValue > 0 ? r2((aged.value / totalValue) * 100) : 0,
  };
}

export interface SupplierPerformance {
  supplier: string;
  unitsSold: number;
  revenue: number;
  cost: number;
  /** Gross profit on sales that stuck. */
  grossProfit: number;
  returned: number;
  /** Returned ÷ sold, 0-100. The number that changes what you buy. */
  returnRate: number;
  /** Revenue reversed by returns. */
  returnedRevenue: number;
  /** GP after returns are taken back out. */
  netProfit: number;
  /** Net profit as a share of revenue that stuck, 0-100. */
  netMargin: number;
  /** Capital currently held in this supplier's stock. */
  heldValue: number;
}

/**
 * Per-supplier profitability, with returns subtracted.
 *
 * A voided sale is one that came back. Counting its gross profit — which the
 * existing supplier tile does by summing GP over all sales — credits a
 * supplier for revenue that was refunded. Here a void removes the profit AND
 * increments the return rate, so a supplier who ships poor stock stops
 * looking profitable.
 */
export function supplierPerformance(
  units: InventoryUnit[],
  sales: Sale[],
  now: number,
): SupplierPerformance[] {
  const rows = new Map<string, SupplierPerformance>();
  const blank = (supplier: string): SupplierPerformance => ({
    supplier, unitsSold: 0, revenue: 0, cost: 0, grossProfit: 0,
    returned: 0, returnRate: 0, returnedRevenue: 0,
    netProfit: 0, netMargin: 0, heldValue: 0,
  });
  const get = (name: string) => {
    const key = name.trim() || 'Unattributed';
    if (!rows.has(key)) rows.set(key, blank(key));
    return rows.get(key)!;
  };

  for (const s of sales) {
    const row = get(s.supplierName ?? '');
    if (s.voidedAt) {
      row.returned += 1;
      row.returnedRevenue += s.salePrice ?? 0;
      continue;
    }
    row.unitsSold += 1;
    row.revenue += s.salePrice ?? 0;
    row.cost += s.buyPrice ?? 0;
    row.grossProfit += s.grossProfit ?? ((s.salePrice ?? 0) - (s.buyPrice ?? 0));
  }

  for (const u of units.filter(isHeld)) {
    get(u.supplierName ?? '').heldValue += u.buyPrice ?? 0;
  }

  return [...rows.values()]
    .map(r => {
      const attempted = r.unitsSold + r.returned;
      return {
        ...r,
        revenue: r2(r.revenue),
        cost: r2(r.cost),
        grossProfit: r2(r.grossProfit),
        returnedRevenue: r2(r.returnedRevenue),
        heldValue: r2(r.heldValue),
        returnRate: attempted > 0 ? r2((r.returned / attempted) * 100) : 0,
        // Returns cost more than the lost margin — the stock came back and
        // the postage went both ways — but postage loss lives on the return
        // record, not here. This is the conservative floor.
        netProfit: r2(r.grossProfit),
        netMargin: r.revenue > 0 ? r2((r.grossProfit / r.revenue) * 100) : 0,
      };
    })
    .filter(r => r.unitsSold > 0 || r.returned > 0 || r.heldValue > 0)
    .sort((a, b) => b.netProfit - a.netProfit);
}

export interface ModelProfitability {
  model: string;
  unitsSold: number;
  revenue: number;
  grossProfit: number;
  /** Average GP per unit — what one more of these is worth. */
  gpPerUnit: number;
  returned: number;
  returnRate: number;
  /** Units still held, and the capital in them. */
  heldUnits: number;
  heldValue: number;
  /** Median days from stock-in to sale, for sold units. */
  medianDaysToSell: number | null;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : r2((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * Per-model profitability, joined to how long the money was tied up.
 *
 * GP alone ranks a £200-profit phone that takes four months above a £60
 * phone that turns in a week, which is backwards for cash. Days-to-sell sits
 * beside it so the trade is visible.
 */
export function modelProfitability(
  units: InventoryUnit[],
  sales: Sale[],
  now: number,
): ModelProfitability[] {
  const unitByImei = new Map<string, InventoryUnit>();
  for (const u of units) {
    const k = (u.imei || '').trim().toUpperCase();
    if (k) unitByImei.set(k, u);
  }

  const rows = new Map<string, ModelProfitability & { _days: number[] }>();
  const get = (model: string) => {
    const key = model.trim() || '(unnamed)';
    if (!rows.has(key)) {
      rows.set(key, {
        model: key, unitsSold: 0, revenue: 0, grossProfit: 0, gpPerUnit: 0,
        returned: 0, returnRate: 0, heldUnits: 0, heldValue: 0,
        medianDaysToSell: null, _days: [],
      });
    }
    return rows.get(key)!;
  };

  for (const s of sales) {
    const unit = unitByImei.get((s.imei || '').trim().toUpperCase());
    const row = get(unit?.rawModel || unit?.model || s.model || '');
    if (s.voidedAt) { row.returned += 1; continue; }
    row.unitsSold += 1;
    row.revenue += s.salePrice ?? 0;
    row.grossProfit += s.grossProfit ?? ((s.salePrice ?? 0) - (s.buyPrice ?? 0));
    if (unit?.dateIn && s.saleDate) {
      const inMs = new Date(unit.dateIn).getTime();
      const outMs = new Date(s.saleDate).getTime();
      if (Number.isFinite(inMs) && Number.isFinite(outMs) && outMs >= inMs) {
        row._days.push(Math.floor((outMs - inMs) / DAY));
      }
    }
  }

  for (const u of units.filter(isHeld)) {
    const row = get(u.rawModel || u.model || '');
    row.heldUnits += 1;
    row.heldValue += u.buyPrice ?? 0;
  }

  return [...rows.values()]
    .map(({ _days, ...r }) => {
      const attempted = r.unitsSold + r.returned;
      return {
        ...r,
        revenue: r2(r.revenue),
        grossProfit: r2(r.grossProfit),
        heldValue: r2(r.heldValue),
        gpPerUnit: r.unitsSold > 0 ? r2(r.grossProfit / r.unitsSold) : 0,
        returnRate: attempted > 0 ? r2((r.returned / attempted) * 100) : 0,
        medianDaysToSell: median(_days),
      };
    })
    .sort((a, b) => b.grossProfit - a.grossProfit);
}
