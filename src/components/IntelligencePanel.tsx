import React, { useMemo } from 'react';
import { InventoryUnit } from '../types';

interface Props {
  units: InventoryUnit[];
  mode: 'buy' | 'sell';
}

interface Row { name: string; primary: string; sub: string; alert?: boolean; }
interface Signal { key: string; label: string; hint: string; color: string; rows: Row[]; empty: string; }

const MS = 86_400_000;

// Strip brand prefix and cap length for card display
function label(model: string, max = 17): string {
  const s = model
    .replace(/^(Apple|Samsung)\s+/i, '')
    .replace(/Galaxy\s+/i, '');
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function buildSignals(units: InventoryUnit[], mode: 'buy' | 'sell'): Signal[] {
  const now    = Date.now();
  const cut14  = now - 14 * MS;
  const cut7   = now - 7  * MS;

  const avail  = units.filter(u => u.status === 'available');
  const s14    = units.filter(u => u.status === 'sold' && u.saleDate && new Date(u.saleDate).getTime() >= cut14);
  const s7     = units.filter(u => u.status === 'sold' && u.saleDate && new Date(u.saleDate).getTime() >= cut7);

  // ── velocity: sold count per model ─────────────────────────────────────────
  const vel14: Record<string, number> = {};
  const vel7:  Record<string, number> = {};
  for (const u of s14) vel14[u.model] = (vel14[u.model] || 0) + 1;
  for (const u of s7)  vel7[u.model]  = (vel7[u.model]  || 0) + 1;

  // ── profit per model (sold 14d) ─────────────────────────────────────────────
  const pAcc: Record<string, { profitSum: number; bpSum: number; n: number }> = {};
  for (const u of s14) {
    if (!u.salePrice) continue;
    const p = u.salePrice - u.buyPrice - (u.postageCost ?? 8);
    if (!pAcc[u.model]) pAcc[u.model] = { profitSum: 0, bpSum: 0, n: 0 };
    pAcc[u.model].profitSum += p;
    pAcc[u.model].bpSum     += u.buyPrice;
    pAcc[u.model].n++;
  }

  // ── stock depth & age per model ─────────────────────────────────────────────
  const depth: Record<string, number>     = {};
  const ages:  Record<string, number[]>   = {};
  const allPerModel: Record<string, InventoryUnit[]> = {};

  for (const u of avail) {
    depth[u.model] = (depth[u.model] || 0) + 1;
    const d = Math.floor((now - new Date(u.dateIn).getTime()) / MS);
    (ages[u.model] = ages[u.model] || []).push(d);
  }

  // ── all units (sold + available) for sell-through calculation ─────────────────
  for (const u of units) {
    if (!allPerModel[u.model]) allPerModel[u.model] = [];
    allPerModel[u.model].push(u);
  }

  // ── sell-through % and average sell time per model ───────────────────────────
  const sellThrough: Record<string, { pct: number; avgDays: number; totalCount: number }> = {};
  const sellTimesPerModel: Record<string, number[]> = {};

  for (const [model, allUnits] of Object.entries(allPerModel)) {
    const soldUnits = allUnits.filter(u => u.status === 'sold');
    const totalUnits = allUnits.length;
    const sellThroughPct = totalUnits > 0 ? Math.round((soldUnits.length / totalUnits) * 100) : 0;

    // Average sell time: from dateIn to saleDate
    const sellTimes: number[] = [];
    for (const u of soldUnits) {
      if (u.dateIn && u.saleDate) {
        const daysToSell = Math.floor((new Date(u.saleDate).getTime() - new Date(u.dateIn).getTime()) / MS);
        sellTimes.push(Math.max(0, daysToSell));
      }
    }

    const avgSellDays = sellTimes.length > 0 ? Math.round(sellTimes.reduce((a, b) => a + b, 0) / sellTimes.length) : 0;
    sellThrough[model] = { pct: sellThroughPct, avgDays: avgSellDays, totalCount: totalUnits };
    sellTimesPerModel[model] = sellTimes;
  }

  // ── platform revenue (sold 14d) ─────────────────────────────────────────────
  const platRev: Record<string, { rev: number; n: number }> = {};
  for (const u of s14) {
    const p = u.salePlatform || 'Other';
    if (!platRev[p]) platRev[p] = { rev: 0, n: 0 };
    platRev[p].rev += u.salePrice || 0;
    platRev[p].n++;
  }

  // ── signal builders ──────────────────────────────────────────────────────────

  // 1. RESTOCK: fast sellers running dry + out of stock alerts
  const restockRows: Row[] = Object.entries(vel14)
    .filter(([m, v]) => {
      const stock = depth[m] || 0;
      // Show if: sold 2+ in 14d AND stock <= 3, OR stock is 0, OR high sell-through
      const st = sellThrough[m];
      return (v >= 2 && stock <= 3) || stock === 0 || (st && st.pct >= 67);
    })
    .sort(([ma, va], [mb, vb]) => {
      const depthA = depth[ma] || 0;
      const depthB = depth[mb] || 0;
      // Prioritize out-of-stock items first
      if ((depthA === 0) !== (depthB === 0)) return (depthA === 0) ? -1 : 1;
      // Then by lowest stock, then by velocity
      return depthA - depthB || vb - va;
    })
    .slice(0, 6)
    .map(([m, v]) => {
      const stock = depth[m] || 0;
      const st = sellThrough[m] || { pct: 0, avgDays: 0, totalCount: 0 };
      const stockStatus = stock === 0 ? 'OUT' : `${stock} left`;

      return {
        name:    label(m),
        primary: stockStatus,  // Stock badge shown prominently on right
        sub:     `sold · ${st.pct}% sell-through · ${st.avgDays}d avg sell`,  // Metrics below
        alert:   stock <= 1,
      };
    });

  // 2. VELOCITY: top sellers by volume
  const velRows: Row[] = Object.entries(mode === 'sell' ? vel7 : vel14)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 4)
    .map(([m, v]) => ({
      name:    label(m),
      primary: `${v} sold`,
      sub:     mode === 'sell' ? '7 days' : `${(v / 14).toFixed(1)}/day`,
    }));

  // 3. MARGIN LEADERS
  const marginRows: Row[] = Object.entries(pAcc)
    .map(([m, { profitSum, bpSum, n }]) => ({
      model: m,
      avg:   Math.round(profitSum / n),
      pct:   Math.round((profitSum / bpSum) * 100),
    }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 4)
    .map(({ model, avg, pct }) => ({
      name:    label(model),
      primary: `£${avg}`,
      sub:     `${pct}% margin`,
    }));

  // 4. AGING STOCK (oldest sitting in office)
  const agingRows: Row[] = Object.entries(ages)
    .map(([m, ds]) => ({
      model: m,
      avg:   Math.round(ds.reduce((s, d) => s + d, 0) / ds.length),
      max:   Math.max(...ds),
      n:     ds.length,
    }))
    .filter(x => x.avg >= 14)
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 4)
    .map(({ model, avg, n }) => ({
      name:    label(model),
      primary: `${avg}d avg`,
      sub:     `${n} unit${n !== 1 ? 's' : ''}`,
      alert:   avg >= 45,
    }));

  // 5. PLATFORM REVENUE
  const platRows: Row[] = Object.entries(platRev)
    .sort(([, a], [, b]) => b.rev - a.rev)
    .slice(0, 4)
    .map(([plat, { rev, n }]) => ({
      name:    plat,
      primary: `£${rev.toLocaleString()}`,
      sub:     `${n} sold`,
    }));

  // ── assemble per mode ────────────────────────────────────────────────────────

  if (mode === 'buy') {
    return [
      {
        key:   'restock',
        label: 'Reorder Alerts',
        hint:  'Fast sellers with low/zero stock · Action required',
        color: '#ef4444',
        rows:  restockRows,
        empty: 'All models well stocked',
      },
      {
        key:   'velocity',
        label: 'Fast Movers',
        hint:  'Top velocity · 14 days',
        color: '#10b981',
        rows:  velRows,
        empty: 'No recent sales yet',
      },
      {
        key:   'margin',
        label: 'Profit Drivers',
        hint:  'Highest net margin',
        color: '#8b5cf6',
        rows:  marginRows,
        empty: 'No sales to measure',
      },
      {
        key:   'aging',
        label: 'Slow Movers',
        hint:  'Avoid over-buying',
        color: '#f59e0b',
        rows:  agingRows,
        empty: 'Stock moving well',
      },
    ];
  }

  return [
    {
      key:   'hot',
      label: 'Hot This Week',
      hint:  'Highest demand · 7 days',
      color: '#ef4444',
      rows:  velRows,
      empty: 'No sales this week yet',
    },
    {
      key:   'earners',
      label: 'Top Earners',
      hint:  'Best net profit · 14d',
      color: '#10b981',
      rows:  marginRows,
      empty: 'No margin data yet',
    },
    {
      key:   'push',
      label: 'Push These',
      hint:  'Oldest stock — sell first',
      color: '#f59e0b',
      rows:  agingRows,
      empty: 'Stock moving well',
    },
    {
      key:   'platforms',
      label: 'Platform Revenue',
      hint:  'Revenue split · 14 days',
      color: '#38bdf8',
      rows:  platRows,
      empty: 'No platform data',
    },
  ];
}

// ── Sub-components ─────────────────────────────────────────────────────────────

const SignalCard: React.FC<{ sig: Signal }> = ({ sig }) => {
  // Map signal colors to light backgrounds and text colors
  const colorMap: Record<string, { bg: string; text: string; textLight: string }> = {
    '#ef4444': { bg: 'bg-red-50 border-red-100', text: 'text-red-600', textLight: 'text-red-500' },
    '#10b981': { bg: 'bg-emerald-50 border-emerald-100', text: 'text-emerald-600', textLight: 'text-emerald-500' },
    '#8b5cf6': { bg: 'bg-purple-50 border-purple-100', text: 'text-purple-600', textLight: 'text-purple-500' },
    '#f59e0b': { bg: 'bg-amber-50 border-amber-100', text: 'text-amber-600', textLight: 'text-amber-500' },
    '#38bdf8': { bg: 'bg-blue-50 border-blue-100', text: 'text-blue-600', textLight: 'text-blue-500' },
  };

  const colors = colorMap[sig.color] || { bg: 'bg-gray-50 border-gray-100', text: 'text-gray-600', textLight: 'text-gray-500' };

  return (
    <div className={`border rounded p-1.5 flex-shrink-0 min-w-fit ${colors.bg}`}>
      {/* Header */}
      <p className={`text-[6px] font-bold uppercase tracking-widest font-mono ${colors.text} mb-0.5`}>
        {sig.label}
      </p>

      {/* Content */}
      {sig.rows.length === 0 ? (
        <p className="text-[6px] text-gray-400 font-mono italic">
          {sig.empty}
        </p>
      ) : (
        <div className="space-y-0">
          {sig.rows.slice(0, 2).map((row, i) => (
            <div key={i} className="flex items-center justify-between gap-1">
              <span className="text-[7px] font-bold text-gray-700 truncate max-w-[100px]">{row.name}</span>
              <span className={`text-[7px] font-bold font-mono whitespace-nowrap ${row.alert ? 'text-red-500' : colors.textLight}`}>
                {row.primary}
              </span>
            </div>
          ))}
          {sig.rows.length > 2 && (
            <p className="text-[5px] text-gray-400 font-mono">+{sig.rows.length - 2}</p>
          )}
        </div>
      )}
    </div>
  );
};

// ── Main component ─────────────────────────────────────────────────────────────

export default function IntelligencePanel({ units, mode }: Props) {
  const signals = useMemo(() => buildSignals(units, mode), [units, mode]);

  const hasAnyData = signals.some(s => s.rows.length > 0);
  if (!hasAnyData) return null;

  const title = mode === 'buy'
    ? 'Buy Intelligence · Restock & Profit Signals'
    : 'Sell Intelligence · Demand & Margin Signals';

  return (
    <div className="bg-white border border-gray-100 rounded-lg p-2">
      {/* Panel header */}
      <div className="flex items-center justify-between mb-2">
        <p className="text-[7px] font-bold uppercase tracking-widest text-gray-500 font-mono">
          {title}
        </p>
        <p className="text-[6px] text-gray-400 font-mono flex-shrink-0">
          14-day
        </p>
      </div>

      {/* Signal cards — horizontal flex */}
      <div className="flex items-center gap-1.5 overflow-x-auto">
        {signals.map(sig => (
          <SignalCard key={sig.key} sig={sig} />
        ))}
      </div>
    </div>
  );
}
