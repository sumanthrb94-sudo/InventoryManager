import React, { useMemo } from 'react';
import { InventoryUnit, Sale } from '../types';
import { recomputeSale } from '../lib/recomputeSale';

interface Props {
  units: InventoryUnit[];
  /** Sales doc collection. Margin Leaders (and any other GP-aware signal)
   *  computes from recomputeSale(s).grossProfit so the numbers match the
   *  master SALES_REPORT formulas per marketplace. When omitted the
   *  margin signal falls back to a raw SP-BP-£8 estimate clearly labelled
   *  "Margin" (not "Profit"). */
  sales?: Sale[];
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

function buildSignals(units: InventoryUnit[], sales: Sale[] | undefined, mode: 'buy' | 'sell'): Signal[] {
  const now    = Date.now();
  const cut14  = now - 14 * MS;
  const cut7   = now - 7  * MS;

  const avail  = units.filter(u => u.status === 'available');
  // Sold-unit window for velocity / margin signals. Filter out units
  // whose currently-set returnDate is on/after the sale date — those
  // units belong to a returned cycle, not a fresh sale, even though
  // their unit-side status='sold' may have been re-flipped by a
  // subsequent record-sale that didn't clear returnType. Without this
  // a unit that went sold → returned → re-sold appears twice in the
  // 14-day window if both sale dates land in it.
  const isReturnedCycle = (u: InventoryUnit, saleDateIso?: string): boolean => {
    if (!u.returnType || !u.returnDate) return false;
    if (!saleDateIso) return true;
    return u.returnDate >= saleDateIso;
  };
  const s14    = units.filter(u => u.status === 'sold' && u.saleDate && !isReturnedCycle(u, u.saleDate) && new Date(u.saleDate).getTime() >= cut14);
  const s7     = units.filter(u => u.status === 'sold' && u.saleDate && !isReturnedCycle(u, u.saleDate) && new Date(u.saleDate).getTime() >= cut7);

  // ── velocity: sold count per model ─────────────────────────────────────────
  const vel14: Record<string, number> = {};
  const vel7:  Record<string, number> = {};
  for (const u of s14) vel14[u.model] = (vel14[u.model] || 0) + 1;
  for (const u of s7)  vel7[u.model]  = (vel7[u.model]  || 0) + 1;

  // ── GP per model (sold 14d) — master-aligned via recomputeSale ─────────────
  // Joins each sold unit to its Sale doc (by unitId) and pulls the
  // marketplace-correct GP. When no Sale doc matches (legacy data) falls
  // back to a coarse SP-BP-£8 estimate so the card still renders. The
  // panel labels this "Margin Leaders" which reads correctly either way.
  const salesByUnit = new Map<string, Sale>();
  if (sales) for (const s of sales) {
    if (!s.voidedAt && s.unitId) salesByUnit.set(s.unitId, s);
  }
  const pAcc: Record<string, { profitSum: number; bpSum: number; n: number }> = {};
  for (const u of s14) {
    if (!u.salePrice) continue;
    const linkedSale = salesByUnit.get(u.id);
    const p = linkedSale
      ? recomputeSale(linkedSale).grossProfit
      : u.salePrice - u.buyPrice - (u.postageCost ?? 8);
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
    .slice(0, 12)
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

  // 2. VELOCITY (14-day window): top sellers by volume — the long-window
  //    'Fast Movers' card. Sell-mode reuses this as 'Hot This Week' below.
  const velRows: Row[] = Object.entries(mode === 'sell' ? vel7 : vel14)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 12)
    .map(([m, v]) => ({
      name:    label(m),
      primary: `${v} sold`,
      sub:     mode === 'sell' ? '7 days' : `${(v / 14).toFixed(1)}/day`,
    }));

  // 2b. VELOCITY (7-day window): 'This Week Trending Sold' for the Buy tab.
  //     Separate from velRows so the Buy dashboard can surface both the
  //     long-view fast movers (14d) and the short-view trending (7d).
  const trendingRows: Row[] = Object.entries(vel7)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 12)
    .map(([m, v]) => ({
      name:    label(m),
      primary: `${v} sold`,
      sub:     '7 days',
    }));

  // 3. MARGIN LEADERS
  const marginRows: Row[] = Object.entries(pAcc)
    .map(([m, { profitSum, bpSum, n }]) => ({
      model: m,
      avg:   Math.round(profitSum / n),
      pct:   Math.round((profitSum / bpSum) * 100),
    }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 12)
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
    .slice(0, 12)
    .map(({ model, avg, n }) => ({
      name:    label(model),
      primary: `${avg}d avg`,
      sub:     `${n} unit${n !== 1 ? 's' : ''}`,
      alert:   avg >= 45,
    }));

  // 5. PLATFORM REVENUE
  const platRows: Row[] = Object.entries(platRev)
    .sort(([, a], [, b]) => b.rev - a.rev)
    .slice(0, 12)
    .map(([plat, { rev, n }]) => ({
      name:    plat,
      primary: `£${rev.toLocaleString()}`,
      sub:     `${n} sold`,
    }));

  // 6. STOCK DEPTH — most-stocked models in the office, sorted by
  //    available count desc. Sub-line carries the BP cash tied up
  //    in each bucket so the operator sees "high count + high
  //    capital lock" at a glance. Same per-model depth + buyPrice
  //    sum that StockOverlayModal's grouped table aggregates, just
  //    surfaced at the dashboard level.
  const bpByModel: Record<string, number> = {};
  for (const u of avail) bpByModel[u.model] = (bpByModel[u.model] || 0) + (u.buyPrice || 0);
  const depthRows: Row[] = Object.entries(depth)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 12)
    .map(([m, count]) => ({
      name:    label(m),
      primary: `× ${count}`,
      sub:     `£${Math.round(bpByModel[m] || 0).toLocaleString()} BP value`,
    }));

  // ── assemble per mode ────────────────────────────────────────────────────────

  if (mode === 'buy') {
    return [
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
        label: 'Old Stock Alerts',
        hint:  'Oldest in office · ≥14 days',
        color: '#f59e0b',
        rows:  agingRows,
        empty: 'Stock moving well',
      },
      {
        key:   'trending',
        label: 'This Week Trending Sold',
        hint:  'Most-sold models · last 7 days',
        color: '#ef4444',
        rows:  trendingRows,
        empty: 'No sales this week yet',
      },
      {
        key:   'depth',
        label: 'Stock Depth',
        hint:  'By quantity · highest first',
        color: '#6366f1',
        rows:  depthRows,
        empty: 'No office stock',
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
    {
      key:   'depth',
      label: 'Stock Depth',
      hint:  'By quantity · highest first',
      color: '#6366f1',
      rows:  depthRows,
      empty: 'No office stock',
    },
  ];
}

// ── Sub-components ─────────────────────────────────────────────────────────────

/** Solid colour palette per signal. The original card design used
 *  semi-transparent rgba pastels keyed off the same hex used as the
 *  accent — operator reported the result was washed-out and hard to
 *  read in office lighting. Replaced with fully-opaque Tailwind-100
 *  tints + 300-level borders + 700-level header text so each card is
 *  unmistakeably its own colour at a glance and the typography is at
 *  comfortable reading sizes. */
type Palette = { bg: string; border: string; header: string; accent: string };
const PALETTE: Record<string, Palette> = {
  '#ef4444': { bg: '#fee2e2', border: '#fca5a5', header: '#b91c1c', accent: '#dc2626' }, // red
  '#10b981': { bg: '#d1fae5', border: '#6ee7b7', header: '#047857', accent: '#059669' }, // emerald
  '#8b5cf6': { bg: '#ede9fe', border: '#c4b5fd', header: '#6d28d9', accent: '#7c3aed' }, // violet
  '#f59e0b': { bg: '#fef3c7', border: '#fcd34d', header: '#b45309', accent: '#d97706' }, // amber
  '#38bdf8': { bg: '#e0f2fe', border: '#7dd3fc', header: '#0369a1', accent: '#0284c7' }, // sky
  '#6366f1': { bg: '#e0e7ff', border: '#a5b4fc', header: '#4338ca', accent: '#4f46e5' }, // indigo
};
const FALLBACK_PALETTE: Palette = { bg: '#f1f5f9', border: '#cbd5e1', header: '#334155', accent: '#475569' };

const SignalCard: React.FC<{ sig: Signal }> = ({ sig }) => {
  const p = PALETTE[sig.color] || FALLBACK_PALETTE;

  return (
    <div style={{
      background: p.bg,
      borderRadius: 14,
      border: `1px solid ${p.border}`,
      borderTop: `4px solid ${sig.color}`,
      padding: '14px 14px 12px',
      display: 'flex',
      flexDirection: 'column',
      gap: 0,
      minWidth: 0,
    }}>
      {/* Header */}
      <div style={{ marginBottom: 10 }}>
        <p style={{
          fontSize: 13, fontWeight: 800, letterSpacing: '0.08em',
          color: p.header, fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          textTransform: 'uppercase', lineHeight: 1.1,
        }}>
          {sig.label}
        </p>
        <p style={{
          fontSize: 11, color: p.accent, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          marginTop: 4, opacity: 0.9,
        }}>
          {sig.hint}
        </p>
      </div>

      {/* Divider — solid colour from the palette, not a generic grey */}
      <div style={{ height: 1, background: p.border, marginBottom: 10, opacity: 0.7 }} />

      {/* Rows */}
      {sig.rows.length === 0 ? (
        <p style={{
          fontSize: 12, color: p.accent, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontStyle: 'italic', lineHeight: 1.4, opacity: 0.7,
        }}>
          {sig.empty}
        </p>
      ) : (
        // Fixed 4-row viewport per card — each row is ~46px (13px name
        // + 11px sub + 10px padding) plus 10px gap, so 218px shows four
        // rows cleanly. Anything beyond scrolls inside the card, same
        // pattern as the Stock Alerts columns. Keeps all five cards
        // the same height regardless of how deep each signal's list
        // runs.
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 10,
          maxHeight: 218, overflowY: 'auto', paddingRight: 2,
        }}>
          {sig.rows.map((row, i) => (
            <div key={i} style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 10,
              paddingBottom: 10,
              borderBottom: i < sig.rows.length - 1 ? `1px solid ${p.border}` : 'none',
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{
                  fontSize: 13, fontWeight: 700, color: '#0f172a',
                  lineHeight: 1.3, marginBottom: 4,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'normal',
                  wordBreak: 'break-word',
                }}>
                  {row.name}
                </p>
                <p style={{
                  fontSize: 11,
                  color: '#475569',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  lineHeight: 1.4,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {row.sub}
                </p>
              </div>
              <div style={{
                textAlign: 'right',
                flexShrink: 0,
                minWidth: 'max-content',
                marginLeft: 8,
              }}>
                <p style={{
                  fontSize: 13, fontWeight: 900, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  color: row.alert ? '#b91c1c' : p.header,
                  lineHeight: 1.2,
                  padding: '5px 10px',
                  backgroundColor: row.alert ? '#fecaca' : 'rgba(255,255,255,0.7)',
                  border: `1px solid ${row.alert ? '#fca5a5' : p.border}`,
                  borderRadius: 8,
                  whiteSpace: 'nowrap',
                }}>
                  {row.primary}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ── Main component ─────────────────────────────────────────────────────────────

export default function IntelligencePanel({ units, sales, mode }: Props) {
  const signals = useMemo(() => buildSignals(units, sales, mode), [units, sales, mode]);

  const hasAnyData = signals.some(s => s.rows.length > 0);
  if (!hasAnyData) return null;

  const title = mode === 'buy'
    ? 'Buy Intelligence · Restock & Profit Signals'
    : 'Sell Intelligence · Demand & Margin Signals';

  return (
    <div style={{ background: '#ffffff', borderRadius: 16, padding: '14px 14px 12px', overflow: 'hidden', border: '1px solid #e2e8f0' }}>
      {/* Panel header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <p style={{
          fontSize: 11, fontWeight: 800, letterSpacing: '0.14em',
          color: '#334155', fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          textTransform: 'uppercase',
        }}>
          {title}
        </p>
        <p style={{
          fontSize: 10, color: '#64748b',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          flexShrink: 0,
        }}>
          14-day window
        </p>
      </div>

      {/* Signal cards — auto-fit means the panel scales from 5 cards
          on desktop (each gets a generous min-width of 190px) down to
          1-2 cards per row on a phone without horizontal scrolling. */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
        gap: 10,
      }}>
        {signals.map(sig => (
          <SignalCard key={sig.key} sig={sig} />
        ))}
      </div>
    </div>
  );
}
