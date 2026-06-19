import React, { useState, useEffect, useMemo } from 'react';
import {
  TrendingUp, TrendingDown, Package, CircleDollarSign,
  ChevronRight, Truck, ShoppingBag, FileSpreadsheet, Upload,
  ShieldCheck, ExternalLink, RefreshCw, Database, Archive, Store, FileClock,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { dbService } from '../lib/dbService';
import { isAdmin } from '../lib/firebase';
import { fmtDateTimeForUser, useUserRegion } from '../lib/userLocale';
import { useInventoryStore } from '../lib/inventoryStore';
import { recomputeSale } from '../lib/recomputeSale';
import { InventoryUnit, Supplier, MARKETPLACES } from '../types';
import CopyImei from './CopyImei';
import PeriodicInventory from './PeriodicInventory';
import CollapsibleSection from './CollapsibleSection';



export interface NavAction {
  tab: 'inventory' | 'suppliers' | 'scan' | 'calendar' | 'sales';
  filters?: {
    status?: string;
    model?: string;
    search?: string;
    supplierId?: string;
  };
}

interface Props {
  user?: User | null;
  onNavigate: (action: NavAction) => void;
  onOpenImport?: () => void;
  onOpenMasterData?: () => void;
}

export default function Dashboard({ user, onNavigate, onOpenImport, onOpenMasterData }: Props) {
  // Master Data button prefers the dedicated `onOpenMasterData` handler
  // (Admin → Master Data sub-tab) and falls back to the legacy import modal.
  const handleOpenMasterData = () => (onOpenMasterData ?? onOpenImport)?.();
  const { units, suppliers, sales, aggregates, importBatches } = useInventoryStore();
  const showAdminPanel = isAdmin(user);
  const region = useUserRegion();

  // Sales aren't in the store — pull them directly so we can detect a
  // completely empty database (no units AND no sales) for the first-run CTA.
  const [salesCount, setSalesCount] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    dbService.readAll('sales')
      .then(rows => { if (!cancelled) setSalesCount(Array.isArray(rows) ? rows.length : 0); })
      .catch(() => { if (!cancelled) setSalesCount(0); });
    return () => { cancelled = true; };
  }, [units.length]);

  const isEmptyDb = units.length === 0 && (salesCount ?? 0) === 0;

  // ── Admin KPIs ────────────────────────────────────────────────────────────
  // Latest import batch (by importedAt) + total Firestore doc counts across
  // the core collections. Read-only — no server-side gating.
  const [adminKpis, setAdminKpis] = useState<{
    lastBatch: { sourceFile?: string; rowCount?: number; importedAt?: string } | null;
    totalDocs: number;
    breakdown: { units: number; aggregates: number; sales: number; suppliers: number };
  } | null>(null);

  useEffect(() => {
    if (!showAdminPanel) return;
    let cancelled = false;
    (async () => {
      try {
        const [batches, aggregates, sales, suppliersRows, unitsRows] = await Promise.all([
          dbService.readAll('importBatches').catch(() => []),
          dbService.readAll('inventoryAggregates').catch(() => []),
          dbService.readAll('sales').catch(() => []),
          dbService.readAll('suppliers').catch(() => []),
          dbService.readAll('inventoryUnits').catch(() => []),
        ]);
        if (cancelled) return;
        const toMillis = (v: any): number => {
          if (!v) return 0;
          if (typeof v === 'string') return new Date(v).getTime() || 0;
          if (typeof v?.toMillis === 'function') return v.toMillis();
          if (typeof v?.seconds === 'number') return v.seconds * 1000;
          return 0;
        };
        const latest = [...batches].sort((a, b) => toMillis(b.importedAt) - toMillis(a.importedAt))[0];
        const lastBatch = latest ? {
          sourceFile: latest.sourceFile,
          rowCount: latest.rowCount,
          importedAt: latest.importedAt && typeof latest.importedAt === 'string'
            ? latest.importedAt
            : (toMillis(latest.importedAt) ? new Date(toMillis(latest.importedAt)).toISOString() : undefined),
        } : null;
        const breakdown = {
          units: unitsRows.length,
          aggregates: aggregates.length,
          sales: sales.length,
          suppliers: suppliersRows.length,
        };
        setAdminKpis({
          lastBatch,
          totalDocs: breakdown.units + breakdown.aggregates + breakdown.sales + breakdown.suppliers,
          breakdown,
        });
      } catch {
        if (!cancelled) setAdminKpis({ lastBatch: null, totalDocs: 0, breakdown: { units: 0, aggregates: 0, sales: 0, suppliers: 0 } });
      }
    })();
    return () => { cancelled = true; };
  }, [showAdminPanel, units.length]);

  const available    = units.filter(u => u.status === 'available');
  const sold         = units.filter(u => u.status === 'sold');
  const returned     = units.filter(u => u.status === 'returned');
  const incoming     = units.filter(u => u.status === 'incoming');
  // Available-only value: matches the "Office Stock" count shown in the KPI card
  const totalValue   = available.reduce((sum, u) => sum + u.buyPrice, 0);
  const top10Units   = available.filter(u => u.flags.includes('top10'));
  const today        = new Date().toISOString().split('T')[0];
  const yesterday    = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const todayArrivals = units.filter(u => u.dateIn === today);
  const todaySold    = sold.filter(u => (u.saleDate || u.dateIn) === today);
  const yesterdaySold = sold.filter(u => (u.saleDate || '') === yesterday || (u.dateIn === yesterday && !u.saleDate));

  const categoryData = useMemo(() => {
    const map: Record<string, number> = {};
    for (const u of available) map[u.category] = (map[u.category] || 0) + 1;
    return Object.entries(map).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  }, [available]);

  const topModels = useMemo(() => {
    const map: Record<string, { count: number; value: number }> = {};
    for (const u of available) {
      if (!map[u.model]) map[u.model] = { count: 0, value: 0 };
      map[u.model].count++;
      map[u.model].value += u.buyPrice;
    }
    return Object.entries(map).map(([model, d]) => ({ model, ...d }))
      .sort((a, b) => b.count - a.count).slice(0, 10);
  }, [available]);

  const top10Sold = useMemo(() => {
    const map: Record<string, { count: number; revenue: number }> = {};
    for (const u of sold) {
      if (!map[u.model]) map[u.model] = { count: 0, revenue: 0 };
      map[u.model].count++;
      map[u.model].revenue += (u.salePrice || 0);
    }
    return Object.entries(map).map(([model, d]) => ({ model, ...d }))
      .sort((a, b) => b.count - a.count).slice(0, 10);
  }, [sold]);

  const seriesModels = useMemo(() => {
    const map: Record<string, { count: number; value: number; category: string; seriesName: string; shortSymbol: string; searchTerm: string }> = {};
    for (const u of available) {
      const mLower = u.model.toLowerCase();
      let seriesName = u.model;
      let shortSymbol = u.model.substring(0, 3).toUpperCase();
      let searchTerm = u.model;

      if (mLower.includes('iphone')) {
        const numMatch = u.model.match(/\d+/);
        const num = numMatch ? numMatch[0] : '';
        seriesName = `Apple ${num} Series`;
        shortSymbol = `a${num}`;
        searchTerm = `iPhone ${num}`;
      } else if (mLower.includes('galaxy s')) {
        const numMatch = u.model.match(/s\d+/i);
        const num = numMatch ? numMatch[0].toUpperCase() : 'S';
        seriesName = `Samsung ${num} Series`;
        shortSymbol = `S${num.replace('S', '')}`;
        searchTerm = `Galaxy ${num}`;
      } else if (mLower.includes('galaxy a')) {
        const numMatch = u.model.match(/a\d+/i);
        const num = numMatch ? numMatch[0].toUpperCase() : 'A';
        seriesName = `Samsung ${num} Series`;
        shortSymbol = `S${num.replace('A', '')}`;
        searchTerm = `Galaxy ${num}`;
      } else if (mLower.includes('galaxy z')) {
        const isFold = mLower.includes('fold');
        const isFlip = mLower.includes('flip');
        const numMatch = u.model.match(/\d+/);
        const num = numMatch ? numMatch[0] : '';
        const type = isFold ? 'Fold' : isFlip ? 'Flip' : 'Z';
        seriesName = `Samsung Z ${type} ${num} Series`;
        shortSymbol = `S${isFold ? 'Fd' : isFlip ? 'Fp' : 'Z'}${num}`;
        searchTerm = `Galaxy Z ${type} ${num}`;
      } else if (mLower.includes('pixel')) {
        const numMatch = u.model.match(/\d+/);
        const num = numMatch ? numMatch[0] : '';
        seriesName = `Google ${num} Series`;
        shortSymbol = `G${num}`;
        searchTerm = `Pixel ${num}`;
      } else if (mLower.includes('ipad')) {
        if (mLower.includes('pro')) { seriesName = 'Apple iPad Pro Series'; shortSymbol = 'aPP'; searchTerm = 'iPad Pro'; }
        else if (mLower.includes('air')) { seriesName = 'Apple iPad Air Series'; shortSymbol = 'aPA'; searchTerm = 'iPad Air'; }
        else if (mLower.includes('mini')) { seriesName = 'Apple iPad Mini Series'; shortSymbol = 'aPM'; searchTerm = 'iPad Mini'; }
        else { seriesName = 'Apple iPad Series'; shortSymbol = 'aPd'; searchTerm = 'iPad'; }
      } else if (mLower.includes('watch')) {
        if (mLower.includes('apple')) {
          const numMatch = u.model.match(/\d+/);
          if (mLower.includes('ultra')) { seriesName = 'Apple Watch Ultra'; shortSymbol = 'aWU'; searchTerm = 'Watch Ultra'; }
          else if (mLower.includes('se')) { seriesName = 'Apple Watch SE'; shortSymbol = 'aWS'; searchTerm = 'Watch SE'; }
          else { seriesName = `Apple Watch ${numMatch ? numMatch[0] : ''} Series`; shortSymbol = `aW${numMatch ? numMatch[0] : ''}`; searchTerm = `Watch Series ${numMatch ? numMatch[0] : ''}`; }
        } else if (mLower.includes('galaxy')) {
          const numMatch = u.model.match(/\d+/);
          seriesName = `Samsung Watch ${numMatch ? numMatch[0] : ''} Series`; shortSymbol = `sW${numMatch ? numMatch[0] : ''}`; searchTerm = `Galaxy Watch ${numMatch ? numMatch[0] : ''}`;
        }
      } else if (mLower.includes('macbook')) {
        if (mLower.includes('pro')) { seriesName = 'Apple MacBook Pro Series'; shortSymbol = 'aBP'; searchTerm = 'MacBook Pro'; }
        else if (mLower.includes('air')) { seriesName = 'Apple MacBook Air Series'; shortSymbol = 'aBA'; searchTerm = 'MacBook Air'; }
        else { seriesName = 'Apple MacBook Series'; shortSymbol = 'aMB'; searchTerm = 'MacBook'; }
      } else if (mLower.includes('airpods')) {
        if (mLower.includes('pro')) { seriesName = 'Apple AirPods Pro'; shortSymbol = 'aPP'; searchTerm = 'AirPods Pro'; }
        else if (mLower.includes('max')) { seriesName = 'Apple AirPods Max'; shortSymbol = 'aPM'; searchTerm = 'AirPods Max'; }
        else { seriesName = 'Apple AirPods Series'; shortSymbol = 'aAP'; searchTerm = 'AirPods'; }
      } else {
        const parts = u.model.split(' ');
        seriesName = `${parts[0] || ''} ${parts[1] || ''} Series`.trim();
        searchTerm = parts.slice(0, 2).join(' ');
      }

      if (!map[seriesName]) map[seriesName] = { count: 0, value: 0, category: u.category || 'Other', seriesName, shortSymbol, searchTerm };
      map[seriesName].count++;
      map[seriesName].value += u.buyPrice;
    }
    return Object.values(map).sort((a, b) => b.count - a.count);
  }, [available]);


  // Aged Inventory (Longest unsold)
  const oldestUnits = useMemo(() => {
    return [...available]
      .filter(u => u.dateIn)
      .sort((a, b) => new Date(a.dateIn).getTime() - new Date(b.dateIn).getTime())
      .slice(0, 10)
      .map(u => {
        const daysOld = Math.floor((new Date().getTime() - new Date(u.dateIn).getTime()) / (1000 * 3600 * 24));
        return { ...u, daysOld };
      });
  }, [available]);

  // Platform breakdown of sales
  const platformSales = useMemo(() => {
    const map: Record<string, number> = {};
    for (const u of sold) {
      const p = u.salePlatform || 'Unknown';
      map[p] = (map[p] || 0) + 1;
    }
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [sold]);

  const PLATFORM_COLORS: Record<string, string> = {
    eBay:'bg-yellow-100 text-yellow-800', Amazon:'bg-orange-100 text-orange-800',
    OnBuy:'bg-blue-100 text-blue-800', Backmarket:'bg-green-100 text-green-800',
  };

  // ── Master-data KPIs (sourced from sales / aggregates / importBatches) ────
  // Live-recompute every active sale so GP figures reflect current
  // MARKETPLACE_FEES, not whatever was stored at import time. Voided
  // sales are filtered out here — they shouldn't inflate the
  // dashboard's "Sold This Month" KPI or revenue/GP totals (Sell
  // screen's allSold does the same; see SellSheet.tsx for the matching
  // convention).
  const liveSales = useMemo(() => sales.filter(s => !s.voidedAt).map(recomputeSale), [sales]);

  // Stock-on-Hand: available units, summed at buy price; week-over-week delta
  // approximated by comparing units that arrived (dateIn) before "a week ago"
  // — anything older was on hand last week.
  const stockOnHand = useMemo(() => {
    const weekAgoStr = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
    const value = available.reduce((s, u) => s + (u.buyPrice || 0), 0);
    const lastWeek = available.filter(u => u.dateIn && u.dateIn <= weekAgoStr).length;
    const delta = available.length - lastWeek;
    return { count: available.length, value, delta };
  }, [available]);

  // SHS Pending: count of incoming units + count of inventoryAggregates whose
  // quantityText is the literal "SHS". Total qty sums numeric quantities where
  // available (incoming = 1 per row; aggregates use quantityNum or fallback 1).
  const shsPending = useMemo(() => {
    const incomingCount = incoming.length;
    const shsAggregates = aggregates.filter(a => (a.quantityText || '').toUpperCase() === 'SHS');
    const aggregateCount = shsAggregates.length;
    const totalQty = incomingCount + shsAggregates.reduce((s, a) => s + (a.quantityNum || 1), 0);
    return { count: incomingCount + aggregateCount, totalQty, incomingCount, aggregateCount };
  }, [incoming, aggregates]);

  // Sold This Month: sales whose saleDate is in the current calendar month.
  const soldThisMonth = useMemo(() => {
    const now = new Date();
    const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const inMonth = liveSales.filter(s => (s.saleDate || '').startsWith(monthPrefix));
    const revenue = inMonth.reduce((sum, s) => sum + (s.salePrice || 0), 0);
    const gp = inMonth.reduce((sum, s) => sum + (s.grossProfit || 0), 0);
    const avgGpPct = inMonth.length
      ? inMonth.reduce((sum, s) => sum + (s.gpPercent || 0), 0) / inMonth.length
      : 0;
    return { count: inMonth.length, revenue, gp, avgGpPct };
  }, [liveSales]);

  // Sales by Marketplace — last 30 days, one bar per canonical marketplace.
  const marketplaceLast30 = useMemo(() => {
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const counts: Record<string, number> = {};
    for (const mk of MARKETPLACES) counts[mk] = 0;
    for (const s of liveSales) {
      if (s.saleDate && s.saleDate >= cutoff) counts[s.marketplace] = (counts[s.marketplace] || 0) + 1;
    }
    return MARKETPLACES.map(mk => ({ marketplace: mk, count: counts[mk] || 0 }));
  }, [liveSales]);

  // Last Import — top importBatch by importedAt desc.
  const lastImport = useMemo(() => {
    const toMillis = (v: any): number => {
      if (!v) return 0;
      if (typeof v === 'string') return new Date(v).getTime() || 0;
      if (typeof v?.toMillis === 'function') return v.toMillis();
      if (typeof v?.seconds === 'number') return v.seconds * 1000;
      return 0;
    };
    const latest = [...importBatches].sort((a, b) => toMillis(b.importedAt) - toMillis(a.importedAt))[0];
    if (!latest) return null;
    const ms = toMillis(latest.importedAt);
    return {
      sourceFile: latest.sourceFile || '—',
      rowCount: latest.rowCount || 0,
      timestamp: ms ? (fmtDateTimeForUser(new Date(ms), region) || '—') : '—',
    };
  }, [importBatches, region]);

  const MARKETPLACE_HEX: Record<string, string> = {
    AMAZON: '#f97316',
    BM:     '#10b981',
    EBAY:   '#f59e0b',
    ONBUY:  '#3b82f6',
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold tracking-tighter uppercase font-display">Operations Hub</h2>
          <p className="text-[8px] sm:text-[10px] text-gray-400 font-mono uppercase tracking-widest mt-1">
            {new Date().toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric' })}
          </p>
        </div>

      </div>

      {/* Admin-only operational panel */}
      {showAdminPanel && (
        <section
          aria-label="Admin dashboard"
          className="bg-black text-white rounded-3xl border border-black shadow-xl p-5 md:p-6"
        >
          <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-2xl bg-white/10 border border-white/15 flex items-center justify-center flex-shrink-0">
                <ShieldCheck size={16} className="text-emerald-300" />
              </div>
              <div className="min-w-0">
                <p className="text-[9px] md:text-[10px] font-mono uppercase tracking-[0.35em] text-emerald-300/90">Admin</p>
                <h3 className="text-base md:text-lg font-bold tracking-tighter font-display leading-tight truncate">
                  {user?.email}
                </h3>
              </div>
            </div>
            <a
              href="https://console.firebase.google.com/"
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest bg-white/10 hover:bg-white/20 rounded-xl px-3 py-2 transition-all"
            >
              <ExternalLink size={11} /> Firebase Auth
            </a>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
            <AdminKpi
              label="Last Import"
              value={adminKpis?.lastBatch
                ? (adminKpis.lastBatch.sourceFile?.split('/').pop() || '—')
                : '—'}
              sub={adminKpis?.lastBatch?.importedAt
                ? (fmtDateTimeForUser(adminKpis.lastBatch.importedAt, region) || 'No imports yet')
                : 'No imports yet'}
            />
            <AdminKpi
              label="Batch Rows"
              value={adminKpis?.lastBatch?.rowCount?.toLocaleString() ?? '—'}
              sub="In latest import"
            />
            <AdminKpi
              label="Total Docs"
              value={adminKpis?.totalDocs?.toLocaleString() ?? '—'}
              sub={adminKpis
                ? `${adminKpis.breakdown.units}u · ${adminKpis.breakdown.sales}s · ${adminKpis.breakdown.suppliers}sp`
                : 'Across collections'}
            />
            <AdminKpi
              label="Integrity"
              value={adminKpis ? (adminKpis.totalDocs > 0 ? 'OK' : 'Empty') : '—'}
              sub={adminKpis?.breakdown.aggregates
                ? `${adminKpis.breakdown.aggregates} aggregates`
                : 'No aggregates'}
            />
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleOpenMasterData}
              className="inline-flex items-center gap-2 bg-white text-black rounded-xl px-3.5 py-2 text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-300 transition-all"
            >
              <RefreshCw size={11} /> Re-load Master Data
            </button>
            <button
              type="button"
              onClick={() => onNavigate({ tab: 'inventory', filters: { status: 'available' } })}
              className="inline-flex items-center gap-2 bg-white/10 hover:bg-white/20 rounded-xl px-3.5 py-2 text-[10px] font-bold uppercase tracking-widest transition-all"
            >
              <Database size={11} /> Inspect Units
            </button>
          </div>
        </section>
      )}

      {/* Master-data KPI cards — sourced from sales / aggregates / importBatches */}
      {!isEmptyDb && (
        <section aria-label="Master data KPIs" className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
          {/* Stock on Hand */}
          <MasterKpiCard
            icon={<Archive size={15} />}
            label="Stock on Hand"
            value={stockOnHand.count.toLocaleString()}
            sub={`£${stockOnHand.value.toLocaleString()} BP`}
            delta={stockOnHand.delta}
            deltaLabel="vs last week"
            accent="bg-emerald-50 border-emerald-100 text-emerald-900"
            iconBg="bg-emerald-100 text-emerald-700"
            onClick={() => onNavigate({ tab: 'inventory', filters: { status: 'available' } })}
          />

          {/* SHS Pending */}
          <MasterKpiCard
            icon={<Truck size={15} />}
            label="SHS Pending"
            value={shsPending.count.toLocaleString()}
            sub={`Qty ${shsPending.totalQty.toLocaleString()} · ${shsPending.incomingCount} units + ${shsPending.aggregateCount} agg`}
            accent="bg-blue-50 border-blue-100 text-blue-900"
            iconBg="bg-blue-100 text-blue-700"
            onClick={() => onNavigate({ tab: 'inventory', filters: { status: 'incoming' } })}
          />

          {/* Sold This Month */}
          <MasterKpiCard
            icon={<ShoppingBag size={15} />}
            label="Sold This Month"
            value={`£${Math.round(soldThisMonth.revenue).toLocaleString()}`}
            sub={`${soldThisMonth.count} sales · GP £${Math.round(soldThisMonth.gp).toLocaleString()} · ${soldThisMonth.avgGpPct.toFixed(1)}%`}
            accent="bg-amber-50 border-amber-100 text-amber-900"
            iconBg="bg-amber-100 text-amber-700"
            onClick={() => onNavigate({ tab: 'sales' })}
          />

          {/* Sales by Marketplace (mini bar chart) */}
          <div className="bg-white border border-gray-100 rounded-3xl p-4 shadow-sm md:col-span-2 xl:col-span-1">
            <div className="flex items-center justify-between mb-2">
              <div className="w-8 h-8 bg-violet-100 text-violet-700 rounded-xl flex items-center justify-center">
                <Store size={15} />
              </div>
              <span className="text-[8px] font-mono uppercase tracking-widest text-gray-400">30d</span>
            </div>
            <p className="text-[8px] text-gray-400 uppercase tracking-widest font-mono">By Marketplace</p>
            <p className="text-lg font-bold tracking-tighter font-display mt-0.5">
              {marketplaceLast30.reduce((s, m) => s + m.count, 0)} <span className="text-[10px] text-gray-400 font-mono font-normal">sales</span>
            </p>
            <div className="h-14 mt-1.5">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={marketplaceLast30} margin={{ top: 2, right: 0, bottom: 0, left: -28 }} barSize={14}>
                  <XAxis dataKey="marketplace" fontSize={7} tickLine={false} axisLine={false} stroke="#aaa" interval={0} />
                  <YAxis hide />
                  <Tooltip
                    contentStyle={{ borderRadius: 10, fontSize: 10, border: '1px solid #e5e7eb', padding: '4px 8px' }}
                    formatter={(v: number) => [`${v}`, 'Sales']}
                  />
                  <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                    {marketplaceLast30.map(m => (
                      <Cell key={m.marketplace} fill={MARKETPLACE_HEX[m.marketplace] || '#6b7280'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Last Import */}
          <MasterKpiCard
            icon={<FileClock size={15} />}
            label="Last Import"
            value={lastImport ? (lastImport.sourceFile.split('/').pop() || lastImport.sourceFile) : '—'}
            sub={lastImport ? `${lastImport.rowCount.toLocaleString()} rows · ${lastImport.timestamp}` : 'No imports yet'}
            accent="bg-gray-50 border-gray-100 text-gray-900"
            iconBg="bg-gray-200 text-gray-700"
            onClick={() => onOpenImport?.()}
            valueClassName="text-sm md:text-base truncate"
          />
        </section>
      )}

      {/* First-run CTA — only when DB is completely empty */}
      {isEmptyDb && (
        <button
          type="button"
          onClick={() => onOpenImport?.()}
          className="w-full text-left bg-gradient-to-br from-slate-900 via-slate-800 to-black text-white rounded-3xl border border-slate-800 shadow-xl p-6 md:p-8 hover:shadow-2xl hover:from-black hover:to-slate-900 active:scale-[0.995] transition-all group"
        >
          <div className="flex items-start gap-4 md:gap-6">
            <div className="w-12 h-12 md:w-14 md:h-14 rounded-2xl bg-white/10 border border-white/15 flex items-center justify-center flex-shrink-0 group-hover:bg-white/20 transition-all">
              <FileSpreadsheet size={24} className="text-white"/>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[9px] md:text-[10px] font-mono uppercase tracking-[0.35em] text-emerald-300/90 mb-1.5">Get Started</p>
              <h3 className="text-xl md:text-3xl font-bold tracking-tighter font-display leading-tight">Load Master Data</h3>
              <p className="text-[11px] md:text-sm text-slate-300 font-mono mt-2 leading-relaxed">
                Drop INVENTORY_REPORT_*.xlsx or SALES_REPORT_*.xlsx to populate the app
              </p>

              <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div className="flex items-center gap-3 bg-white/5 border border-dashed border-white/20 rounded-2xl px-4 py-3 group-hover:border-white/40 transition-all">
                  <Upload size={16} className="text-emerald-300 flex-shrink-0"/>
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold leading-tight">INVENTORY_REPORT</p>
                    <p className="text-[9px] text-slate-400 font-mono mt-0.5">Stock workbook</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 bg-white/5 border border-dashed border-white/20 rounded-2xl px-4 py-3 group-hover:border-white/40 transition-all">
                  <Upload size={16} className="text-emerald-300 flex-shrink-0"/>
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold leading-tight">SALES_REPORT</p>
                    <p className="text-[9px] text-slate-400 font-mono mt-0.5">Sales workbook</p>
                  </div>
                </div>
              </div>

              <div className="mt-5 inline-flex items-center gap-2 text-[10px] md:text-[11px] font-bold uppercase tracking-widest text-white bg-white/10 group-hover:bg-white/20 rounded-xl px-3.5 py-2 transition-all">
                <FileSpreadsheet size={12}/> Open Importer
                <ChevronRight size={13} className="group-hover:translate-x-0.5 transition-transform"/>
              </div>
            </div>
          </div>
        </button>
      )}

      {/* Periodic Inventory Table — Office Stock + SHS dashboards mounted
          side-by-side so the operator can compare both at once. Each
          instance has its own view tabs (Stock / By Supplier / Out of
          Stock), its own supplier filter, and independent click state. On
          narrow viewports the SHS panel stacks below office. */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <PeriodicInventory
          units={units}
          scope="office"
          onNavigate={(search) => onNavigate({ tab: 'inventory', filters: { search, status: 'available' } })}
        />
        <PeriodicInventory
          units={units}
          scope="shs"
          onNavigate={(search) => onNavigate({ tab: 'inventory', filters: { search, status: 'incoming' } })}
        />
      </div>

      {/* KPI Cards — ALL CLICKABLE */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <KPICard
          label="Office Stock" value={available.length}
          sub="Units available" icon={<Package size={16}/>}
          badge={todayArrivals.length > 0 ? `+${todayArrivals.length} today` : undefined}
          onClick={() => onNavigate({ tab:'inventory', filters:{ status:'available' } })}
        />
        <KPICard
          label="Stock Value" value={`£${totalValue.toLocaleString()}`}
          sub="At buy price" icon={<CircleDollarSign size={16}/>}
          onClick={() => onNavigate({ tab:'inventory', filters:{ status:'available' } })}
        />
        <KPICard
          label="Sold Total" value={sold.length}
          sub={`${todaySold.length} sold today`} icon={<ShoppingBag size={16}/>}
          onClick={() => onNavigate({ tab:'inventory', filters:{ status:'sold' } })}
        />
        <KPICard
          label="Returned" value={returned.length}
          sub="Back in pipeline" icon={<TrendingUp size={16}/>}
          onClick={() => onNavigate({ tab:'inventory', filters:{ status:'returned' } })}
        />
        <KPICard
          label="Incoming (SHS)" value={incoming.length}
          sub={incoming.length > 0 ? "Expected stock" : "No pending stock"} icon={<Truck size={16}/>}
          badge={incoming.length > 0 ? "Pending" : undefined}
          onClick={() => onNavigate({ tab:'inventory', filters:{ status:'incoming' } })}
          accent={incoming.length > 0 ? "bg-blue-50 border-blue-100 text-blue-900" : undefined}
        />
      </div>

      {/* Expected Stock (SHS) */}
      <CollapsibleSection
        title="Expected Stock (SHS)"
        count={incoming.length}
        accent="border-l-blue-500"
        defaultOpen={false}
      >
        {incoming.length === 0 ? (
          <div className="py-8 flex flex-col items-center gap-2 text-gray-300">
            <Truck size={32} />
            <p className="text-xs font-mono">No expected stock (SHS)</p>
            <p className="text-[10px] text-gray-400 font-mono">Add SHS from Buy Stock → Add Supplier Delivery</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {incoming.slice(0, 20).map(u => (
              <div key={u.id} className="flex items-center gap-3 px-4 py-3">
                <div className="w-2 h-2 rounded-full bg-blue-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold truncate">{u.model}</p>
                  <p className="text-[9px] text-gray-400 font-mono">{u.supplierName || 'Unknown supplier'} · £{u.buyPrice} BP</p>
                </div>
                <span className="text-[8px] bg-blue-100 text-blue-700 font-bold px-2 py-0.5 rounded-full uppercase tracking-wide">SHS</span>
              </div>
            ))}
            {incoming.length > 20 && (
              <p className="text-[9px] text-gray-400 font-mono text-center py-2">+{incoming.length - 20} more expected</p>
            )}
          </div>
        )}
      </CollapsibleSection>

      {/* Yesterday's Sales */}
      <CollapsibleSection
        title="Yesterday's Sales"
        count={yesterdaySold.length}
        meta={yesterdaySold.length > 0 ? `£${yesterdaySold.reduce((s,u)=>s+(u.salePrice||0),0).toLocaleString()}` : undefined}
        accent="border-l-gray-700"
        defaultOpen={false}
      >
        <div className="bg-gradient-to-br from-gray-900 to-gray-800 p-4 text-white">
          <p className="text-[9px] text-gray-500 font-mono mb-3">{new Date(Date.now()-86400000).toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'short'})}</p>
          {yesterdaySold.length === 0 ? (
            <p className="text-[10px] text-gray-500 font-mono">No sales recorded for yesterday.</p>
          ) : (
            <div className="space-y-1.5">
              {yesterdaySold.slice(0, 5).map(u => (
                <button key={u.id}
                  onClick={() => onNavigate({ tab:'inventory', filters:{ search: u.imei } })}
                  className="w-full flex items-center justify-between bg-white/5 hover:bg-white/10 rounded-lg px-3 py-2 transition-all text-left"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-bold truncate">{u.model}</p>
                    <p className="text-[9px] text-gray-400 font-mono">{u.colour} · {u.salePlatform || 'Unknown platform'}</p>
                  </div>
                  <span className="text-sm font-bold text-green-400 ml-2 flex-shrink-0">£{(u.salePrice || 0).toLocaleString()}</span>
                </button>
              ))}
              {yesterdaySold.length > 5 && (
                <p className="text-[9px] text-gray-500 font-mono text-center pt-1">+{yesterdaySold.length - 5} more sold yesterday</p>
              )}
            </div>
          )}
        </div>
      </CollapsibleSection>

      {/* Top 10 Sold Products */}
      {top10Sold.length > 0 && (
        <CollapsibleSection
          title="Top 10 Sold Products"
          meta="All time · by volume"
          accent="border-l-emerald-500"
          defaultOpen={false}
        >
          <div className="divide-y divide-gray-50">
            {top10Sold.map((m, i) => (
              <button key={m.model}
                onClick={() => onNavigate({ tab:'inventory', filters:{ search: m.model, status:'sold' } })}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-all text-left group"
              >
                <span className={`text-[10px] font-mono w-5 flex-shrink-0 font-bold ${i < 3 ? 'text-amber-500' : 'text-gray-400'}`}>{String(i+1).padStart(2,'0')}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold truncate">{m.model}</p>
                  <p className="text-[9px] text-gray-400 font-mono">£{m.revenue.toLocaleString()} revenue</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xl font-bold font-display leading-tight text-green-600">{m.count}</p>
                  <p className="text-[8px] text-gray-400 font-mono">sold</p>
                </div>
                <ChevronRight size={14} className="text-gray-300 group-hover:text-black transition-all flex-shrink-0"/>
              </button>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Sales by Platform */}
      {platformSales.length > 0 && (
        <CollapsibleSection title="Sales by Platform" count={sold.length} accent="border-l-blue-400" defaultOpen={false}>
          <div className="p-4 flex flex-wrap gap-2">
            {platformSales.map(([p, c]) => (
              <span key={p} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold font-mono ${PLATFORM_COLORS[p] || 'bg-gray-100 text-gray-700'}`}>
                {p} · {c} sold
              </span>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Suppliers clickable */}
      <button
        onClick={() => onNavigate({ tab:'suppliers' })}
        className="w-full bg-white rounded-3xl border border-gray-100 shadow-sm px-4 py-3.5 flex items-center justify-between hover:bg-gray-50 transition-all"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-gray-100 rounded-xl flex items-center justify-center">
            <Truck size={15} className="text-gray-600"/>
          </div>
          <div className="text-left">
            <p className="text-sm font-bold">{suppliers.length} Suppliers</p>
            <p className="text-[10px] text-gray-400 font-mono">View order history & details</p>
          </div>
        </div>
        <ChevronRight size={16} className="text-gray-400"/>
      </button>

      {/* Stock by Category chart */}
      {categoryData.length > 0 && (
        <CollapsibleSection title="Stock by Category" count={available.length} accent="border-l-purple-400" defaultOpen={false}>
          <div className="p-4">
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={categoryData} barSize={22}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#00000010" vertical={false}/>
                  <XAxis dataKey="name" fontSize={8} tickLine={false} axisLine={false} stroke="#00000050"
                    tickFormatter={n => n.replace('Samsung ','S.').replace('Apple Watch','Watch')}/>
                  <YAxis fontSize={8} tickLine={false} axisLine={false} stroke="#00000050"/>
                  <Tooltip contentStyle={{ borderRadius:8, fontSize:11, border:'1px solid #e5e7eb' }} cursor={{ fill:'#f9fafb' }}/>
                  <Bar dataKey="count" name="Units" radius={[4,4,0,0]}>
                    {categoryData.map((_, i) => <Cell key={i} fill={i===0?'#000':i===1?'#374151':i===2?'#6b7280':'#9ca3af'}/>)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              {categoryData.map(c => (
                <button key={c.name} onClick={() => onNavigate({ tab:'inventory', filters:{ search: c.name } })}
                  className="text-[9px] font-bold font-mono bg-gray-100 hover:bg-black hover:text-white px-2.5 py-1 rounded-full transition-all">
                  {c.name.replace('Samsung ','')} · {c.count}
                </button>
              ))}
            </div>
          </div>
        </CollapsibleSection>
      )}

      {/* Top Models — Office Stock */}
      {topModels.length > 0 && (
        <CollapsibleSection title="Top Models · Office Stock" count={topModels.length} accent="border-l-gray-500" defaultOpen={false}>
          <div className="divide-y divide-gray-50">
            {topModels.map((m, i) => (
              <button key={m.model}
                onClick={() => onNavigate({ tab:'inventory', filters:{ search: m.model, status:'available' } })}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-all text-left group"
              >
                <span className="text-[10px] font-mono text-gray-400 w-5 flex-shrink-0">{String(i+1).padStart(2,'0')}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold truncate">{m.model}</p>
                  <p className="text-[9px] text-gray-400 font-mono">£{m.value.toLocaleString()} value</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xl font-bold font-display leading-tight">{m.count}</p>
                  <p className="text-[8px] text-gray-400 font-mono">in stock</p>
                </div>
                <ChevronRight size={14} className="text-gray-300 group-hover:text-black transition-all flex-shrink-0"/>
              </button>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Oldest Unsold Stock */}
      {oldestUnits.length > 0 && (
        <CollapsibleSection
          title="Oldest Unsold Stock"
          count={oldestUnits.length}
          meta={oldestUnits[0] ? `${oldestUnits[0].daysOld}d oldest` : undefined}
          accent="border-l-orange-400"
          defaultOpen={false}
        >
          <div className="divide-y divide-gray-50">
            {oldestUnits.map(u => {
              const supplier = suppliers.find(s => s.id === u.supplierId);
              return (
                <button key={u.id}
                  onClick={() => onNavigate({ tab:'inventory', filters:{ search: u.imei } })}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-all text-left group"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold truncate">{u.model}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[9px] text-gray-400 font-mono">{u.colour}</span>
                      <span className="text-[9px] text-gray-300">·</span>
                      <CopyImei imei={u.imei} truncate={10} />
                      <span className="text-[9px] text-gray-300">·</span>
                      <span className="text-[9px] text-gray-400 font-mono">{supplier?.name || 'Unknown'}</span>
                      <span className="text-[9px] text-gray-300">·</span>
                      <span className="text-[9px] text-gray-400 font-mono">{u.batchId === 'master_batch' ? 'Master' : (u.batchId || 'Default')}</span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xl font-bold font-display leading-tight text-orange-600">{u.daysOld}</p>
                    <p className="text-[8px] text-gray-400 font-mono">days</p>
                  </div>
                  <ChevronRight size={14} className="text-gray-300 group-hover:text-black transition-all flex-shrink-0"/>
                </button>
              );
            })}
          </div>
        </CollapsibleSection>
      )}

      {/* placeholder removed — periodic table now at top */}

      {/* Legacy empty state replaced by the "Load Master Data" hero CTA at the
          top of the dashboard, which is rendered only when the DB is empty. */}
    </div>
  );
}

function KPICard({ label, value, sub, icon, badge, onClick, accent }: {
  label: string; value: number | string; sub?: string;
  icon: React.ReactNode; badge?: string; onClick: () => void; accent?: string;
}) {
  return (
    <button onClick={onClick}
      className={`${accent || 'bg-white border-gray-100'} border rounded-3xl p-4 shadow-sm text-left hover:shadow-md active:scale-[0.98] transition-all group w-full`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="w-8 h-8 bg-gray-100 rounded-xl flex items-center justify-center text-gray-600 group-hover:bg-black group-hover:text-white transition-all">
          {icon}
        </div>
        {badge && <span className="text-[8px] bg-blue-500 text-white px-2 py-0.5 rounded-full font-mono font-bold">{badge}</span>}
        <ChevronRight size={13} className="text-gray-300 group-hover:text-black transition-all"/>
      </div>
      <p className="text-[8px] text-gray-400 uppercase tracking-widest font-mono">{label}</p>
      <p className="text-2xl font-bold tracking-tighter font-display mt-0.5">{value}</p>
      {sub && <p className="text-[9px] text-gray-400 font-mono mt-0.5">{sub}</p>}
    </button>
  );
}

function MasterKpiCard({ icon, label, value, sub, delta, deltaLabel, accent, iconBg, onClick, valueClassName }: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
  delta?: number;
  deltaLabel?: string;
  accent?: string;
  iconBg?: string;
  onClick?: () => void;
  valueClassName?: string;
}) {
  const showDelta = typeof delta === 'number' && delta !== 0;
  const positive = (delta || 0) >= 0;
  const Tag: any = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      className={`${accent || 'bg-white border-gray-100'} border rounded-3xl p-4 shadow-sm text-left transition-all w-full ${onClick ? 'hover:shadow-md active:scale-[0.98] group' : ''}`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${iconBg || 'bg-gray-100 text-gray-700'}`}>
          {icon}
        </div>
        {showDelta && (
          <span className={`flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full font-mono ${positive ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
            {positive ? <TrendingUp size={9} /> : <TrendingDown size={9} />}
            {positive ? '+' : ''}{delta}
          </span>
        )}
        {onClick && <ChevronRight size={13} className="text-gray-300 group-hover:text-black transition-all" />}
      </div>
      <p className="text-[8px] uppercase tracking-widest font-mono opacity-70">{label}</p>
      <p className={`font-bold tracking-tighter font-display mt-0.5 ${valueClassName || 'text-2xl'}`} title={String(value)}>{value}</p>
      {sub && <p className="text-[9px] font-mono mt-0.5 opacity-70 truncate" title={sub}>{sub}</p>}
      {showDelta && deltaLabel && <p className="text-[8px] font-mono opacity-50 mt-0.5">{deltaLabel}</p>}
    </Tag>
  );
}

function AdminKpi({ label, value, sub }: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl px-3 py-3">
      <p className="text-[8px] font-mono uppercase tracking-[0.3em] text-emerald-300/80">{label}</p>
      <p className="text-lg md:text-xl font-bold tracking-tighter font-display mt-1 leading-tight truncate" title={String(value)}>
        {value}
      </p>
      {sub && <p className="text-[9px] text-slate-400 font-mono mt-0.5 truncate" title={sub}>{sub}</p>}
    </div>
  );
}
