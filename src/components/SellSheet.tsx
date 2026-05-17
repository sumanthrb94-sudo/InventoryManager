/**
 * SellSheet — sold-IMEI Excel-style spreadsheet view for the Sell tab.
 *
 * Replaces the legacy SellPage with the same design language as BuySheet:
 * one row per sold IMEI (sales collection + legacy in-app sold units),
 * sticky header, frozen IMEI/Order column, inline edit on SP/Marketplace/
 * Order#/Notes, status/date/marketplace filter chips, CSV export, and a
 * detail panel that shows the full live-recomputed financial breakdown
 * plus matching supplier WhatsApp quotes for context.
 *
 * The available-stock and SHS flows still live here as pinned sections so
 * ops can flip a unit to Sold or backfill a late IMEI without leaving the
 * page.
 */
import React, { useState, useMemo, useEffect } from 'react';
import {
  Search, ShoppingCart, ChevronDown, ChevronUp, ChevronsUpDown,
  Filter, X, MoreHorizontal, Download, AlertCircle, Eye,
  MessageCircle, Sparkles, Layers, PackageCheck, Truck, Plus,
  TrendingUp, TrendingDown,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { dbService } from '../lib/dbService';
import {
  InventoryUnit, Sale, Marketplace, SupplierWhatsappUpdate,
} from '../types';
import { useInventoryStore } from '../lib/inventoryStore';
import { recomputeSale } from '../lib/recomputeSale';
import {
  marketplaceFromListingSite, listingSiteLabel, MARKETPLACES,
} from '../lib/platforms';
import { fmtDateForUser, useUserRegion } from '../lib/userLocale';
import { manualShsUnitsFrom } from '../lib/shsCount';
import CopyImei from './CopyImei';
import SellOrderModal from './SellOrderModal';
import EnterImeiModal from './EnterImeiModal';

// ── Types ────────────────────────────────────────────────────────────────────

type DateScope = 'today' | 'week' | 'month' | 'all';
type SortKey =
  | 'saleDate' | 'model' | 'storage' | 'colour' | 'buyPrice' | 'salePrice'
  | 'grossProfit' | 'gpPercent' | 'marketplace' | 'supplier' | 'orderNumber';
type SortDir = 'asc' | 'desc';

const MARKETPLACE_TONE: Record<Marketplace, string> = {
  AMAZON:  'bg-orange-100 text-orange-700  border-orange-200',
  BM:      'bg-emerald-100 text-emerald-700 border-emerald-200',
  EBAY:    'bg-yellow-100 text-yellow-700  border-yellow-200',
  ONBUY:   'bg-blue-100 text-blue-700      border-blue-200',
  PROJECT: 'bg-violet-100 text-violet-700  border-violet-200',
};

const fmtGBP = (n: number | undefined | null): string => {
  if (n == null || Number.isNaN(n)) return '—';
  const sign = n < 0 ? '-' : '';
  return `${sign}£${Math.abs(n).toFixed(2)}`;
};

/** Convert a sold InventoryUnit into a Sale row so it can be displayed
 *  alongside docs from the sales collection. Mirrors the legacy helper. */
function inventoryUnitToSale(u: InventoryUnit): Sale {
  const marketplace: Marketplace =
    (marketplaceFromListingSite(u.salePlatform || '') as Marketplace | undefined) ?? 'EBAY';
  const sp = u.salePrice ?? 0;
  const bp = u.buyPrice ?? 0;
  return {
    id: u.id,
    marketplace,
    orderNumber: u.saleOrderId || '',
    sku: u.sku,
    imei: u.imei,
    unitId: u.id,
    supplierId: u.supplierId,
    supplierName: u.supplierName,
    saleDate: (u.saleDate || u.updatedAt?.split?.('T')?.[0] || '') as string,
    quantity: 1,
    buyPrice: bp,
    salePrice: sp,
    paymentMode: undefined,
    spMinusBp: sp - bp,
    marginalTax: 0,
    commission: 0,
    postage: u.postageCost ?? 0,
    grossProfit: 0,
    gpPercent: 0,
    comments: u.notes || undefined,
    importBatchId: 'inapp',
    sourceFile: 'inapp-sell-flow',
    sourceRow: 0,
    importedAt: u.updatedAt ?? u.createdAt,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
    ownerId: u.ownerId,
  };
}

interface Props {}

// ── Component ────────────────────────────────────────────────────────────────

export default function SellSheet(_props: Props) {
  const { units, suppliers, sales, whatsappFeed } = useInventoryStore();
  const region = useUserRegion();

  const supplierMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of suppliers) m[s.id] = s.name;
    return m;
  }, [suppliers]);

  // ── Filters / sort / search ───────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [dateScope, setDateScope] = useState<DateScope>('month');
  const [marketplaceFilter, setMarketplaceFilter] = useState<Set<Marketplace>>(new Set());
  const [supplierFilter, setSupplierFilter] = useState<Set<string>>(new Set());
  const [profitFilter, setProfitFilter] = useState<'all' | 'profit' | 'loss'>('all');
  const [showFilterDrawer, setShowFilterDrawer] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'saleDate', dir: 'desc' });

  // ── Modals ────────────────────────────────────────────────────────────────
  const [sellOrderUnit, setSellOrderUnit] = useState<InventoryUnit | null>(null);
  const [sellOrderIsSHS, setSellOrderIsSHS] = useState(false);
  const [enterImeiUnit, setEnterImeiUnit] = useState<InventoryUnit | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  // ── Detail panel + inline edit ────────────────────────────────────────────
  const [activeSale, setActiveSale] = useState<Sale | null>(null);
  const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null);
  const [rowMenuId, setRowMenuId] = useState<string | null>(null);

  useEffect(() => {
    if (!rowMenuId) return;
    const close = () => setRowMenuId(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [rowMenuId]);

  // ── Unit indexes ──────────────────────────────────────────────────────────
  const inStock = useMemo(() => units.filter(u => u.status === 'available'), [units]);
  const manualShs = useMemo(() => manualShsUnitsFrom(units), [units]);
  // Sold SHS units still waiting for the supplier's IMEI.
  const awaitingImei = useMemo(
    () => units.filter(u => u.status === 'sold' && !u.imei).sort((a, b) => (b.saleDate || '').localeCompare(a.saleDate || '')),
    [units],
  );

  // ── Sold rows ─────────────────────────────────────────────────────────────
  // Merge sales collection + legacy in-app sold units; recompute financials
  // live so they stay in sync with the current MARKETPLACE_FEES.
  const allSold = useMemo<Sale[]>(() => {
    const merged: Sale[] = [];
    const seenIds = new Set<string>();
    const seenKeys = new Set<string>();
    for (const s of sales) {
      const fresh = recomputeSale(s);
      merged.push(fresh);
      seenIds.add(s.id);
      if (fresh.orderNumber) seenKeys.add(`${fresh.marketplace}__${fresh.orderNumber}`);
    }
    for (const u of units) {
      if (u.status !== 'sold' || u.salePrice == null) continue;
      if (seenIds.has(u.id)) continue;
      const candidate = inventoryUnitToSale(u);
      const dedupeKey = candidate.orderNumber ? `${candidate.marketplace}__${candidate.orderNumber}` : '';
      if (dedupeKey && seenKeys.has(dedupeKey)) continue;
      merged.push(recomputeSale(candidate));
    }
    return merged;
  }, [sales, units]);

  // ── Date-scoped subset ────────────────────────────────────────────────────
  const scopedSold = useMemo<Sale[]>(() => {
    if (dateScope === 'all') return allSold;
    const today = new Date().toISOString().split('T')[0];
    const monthStart = (() => {
      const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
    })();
    const weekAgo = (() => {
      const d = new Date(Date.now() - 7 * 86_400_000); return d.toISOString().split('T')[0];
    })();
    const lo =
      dateScope === 'today' ? today :
      dateScope === 'week'  ? weekAgo :
      monthStart;
    return allSold.filter(s => {
      const d = (s.saleDate || '').split('T')[0];
      return d >= lo && d <= today;
    });
  }, [allSold, dateScope]);

  // ── Apply filters + sort to scoped subset ────────────────────────────────
  const filtered = useMemo<Sale[]>(() => {
    const q = search.trim().toLowerCase();
    const out = scopedSold.filter(s => {
      if (marketplaceFilter.size > 0 && !marketplaceFilter.has(s.marketplace)) return false;
      if (supplierFilter.size > 0) {
        const sn = supplierMap[s.supplierId || ''] || s.supplierName || 'Unassigned';
        if (!supplierFilter.has(sn)) return false;
      }
      if (profitFilter === 'profit' && (s.grossProfit ?? 0) <= 0) return false;
      if (profitFilter === 'loss'   && (s.grossProfit ?? 0) >= 0) return false;
      if (q) {
        const u = (s.unitId && units.find(x => x.id === s.unitId)) || undefined;
        const hay = [
          s.imei, s.orderNumber, s.sku, s.marketplace, s.supplierName,
          u?.model, u?.colour, u?.storage,
          supplierMap[s.supplierId || ''],
        ].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const mult = sort.dir === 'asc' ? 1 : -1;
    const get = (s: Sale): string | number => {
      const u = (s.unitId && units.find(x => x.id === s.unitId)) || undefined;
      switch (sort.key) {
        case 'saleDate':    return s.saleDate || '';
        case 'model':       return (u?.model || '').toLowerCase();
        case 'storage':     return (u?.storage || '').toLowerCase();
        case 'colour':      return (u?.colour || '').toLowerCase();
        case 'buyPrice':    return s.buyPrice ?? 0;
        case 'salePrice':   return s.salePrice ?? 0;
        case 'grossProfit': return s.grossProfit ?? 0;
        case 'gpPercent':   return s.gpPercent ?? 0;
        case 'marketplace': return s.marketplace;
        case 'supplier':    return (supplierMap[s.supplierId || ''] || s.supplierName || '').toLowerCase();
        case 'orderNumber': return s.orderNumber || '';
        default:            return '';
      }
    };
    return out.sort((a, b) => {
      const av = get(a); const bv = get(b);
      if (av < bv) return -1 * mult;
      if (av > bv) return  1 * mult;
      return 0;
    });
  }, [scopedSold, search, marketplaceFilter, supplierFilter, profitFilter, supplierMap, units, sort]);

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    const monthStart = (() => {
      const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
    })();
    let todayCount = 0, todayRevenue = 0, todayGP = 0;
    let monthCount = 0, monthRevenue = 0, monthGP = 0;
    let allCount = 0, allGP = 0;
    let lossCount = 0;
    for (const s of allSold) {
      allCount++;
      allGP += s.grossProfit ?? 0;
      if ((s.grossProfit ?? 0) < 0) lossCount++;
      const d = (s.saleDate || '').split('T')[0];
      if (d === today) {
        todayCount++; todayRevenue += s.salePrice ?? 0; todayGP += s.grossProfit ?? 0;
      }
      if (d >= monthStart && d <= today) {
        monthCount++; monthRevenue += s.salePrice ?? 0; monthGP += s.grossProfit ?? 0;
      }
    }
    return {
      todayCount, todayRevenue, todayGP,
      monthCount, monthRevenue, monthGP,
      allCount, allGP, lossCount,
      avgGpPct: allCount > 0
        ? allSold.reduce((sum, s) => sum + (s.gpPercent ?? 0), 0) / allCount
        : 0,
      awaitingImei: awaitingImei.length,
    };
  }, [allSold, awaitingImei]);

  // ── Filter chip option lists ──────────────────────────────────────────────
  const supplierOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of allSold) {
      const sn = supplierMap[s.supplierId || ''] || s.supplierName || 'Unassigned';
      set.add(sn);
    }
    return Array.from(set).sort();
  }, [allSold, supplierMap]);

  // ── WhatsApp quote lookup ─────────────────────────────────────────────────
  const findQuotes = (model: string | undefined | null): SupplierWhatsappUpdate[] => {
    const needle = String(model || '').toLowerCase().split(/\s+/).filter(w => w.length >= 3);
    if (needle.length === 0) return [];
    return whatsappFeed.filter(q => needle.some(t => (q.rawText || '').toLowerCase().includes(t)));
  };

  // ── CSV export ────────────────────────────────────────────────────────────
  const handleExportCsv = () => {
    const rows = filtered.map(s => {
      const u = (s.unitId && units.find(x => x.id === s.unitId)) || undefined;
      return {
        'Sale Date':   s.saleDate || '',
        'Marketplace': s.marketplace,
        'Order #':     s.orderNumber || '',
        'IMEI':        s.imei || '',
        'Model':       u?.model || '',
        'Storage':     u?.storage || '',
        'Colour':      u?.colour || '',
        'Supplier':    supplierMap[s.supplierId || ''] || s.supplierName || '',
        'BP':          s.buyPrice ?? 0,
        'SP':          s.salePrice ?? 0,
        'Commission':  (s.commission ?? 0).toFixed(2),
        'Postage':     (s.postage ?? 0).toFixed(2),
        'GP':          (s.grossProfit ?? 0).toFixed(2),
        'GP %':        (s.gpPercent ?? 0).toFixed(2),
      };
    });
    downloadCsv('sell_imei_sheet.csv', rows);
  };

  // ── Inline edit save ──────────────────────────────────────────────────────
  const saveCell = async (s: Sale, field: string, value: any) => {
    const patch: Record<string, any> = { [field]: value };
    if (field === 'salePrice' || field === 'buyPrice' || field === 'marketplace' || field === 'postage') {
      // Re-derive so the row's GP/commission stays consistent on next render.
      const next = recomputeSale({ ...s, ...patch });
      Object.assign(patch, {
        spMinusBp: next.spMinusBp,
        marginalTax: next.marginalTax,
        commission: next.commission,
        grossProfit: next.grossProfit,
        gpPercent: next.gpPercent,
        netProfit: next.netProfit,
        totalCom: next.totalCom,
        rof: next.rof,
        fvf: next.fvf,
      });
    }
    try { await dbService.update('sales', s.id, patch); } finally { setEditingCell(null); }
  };

  return (
    <div className="space-y-4">

      {/* ── Header ────────────────────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center gap-4">
          <div className="flex-1 min-w-0">
            <h2 className="text-xl sm:text-2xl font-bold tracking-tighter uppercase font-display flex items-center gap-2">
              <Layers size={20} className="text-slate-700" />
              Sell Sheet
              <span className="text-[10px] font-mono uppercase tracking-widest text-slate-400 font-normal">· IMEI-keyed</span>
            </h2>
            <p className="text-[10px] text-slate-400 font-mono uppercase tracking-widest mt-1">
              One row per sold IMEI · live GP recompute · inline editable · WhatsApp quotes in detail panel
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setPickerOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 text-white text-[10px] font-bold uppercase tracking-widest hover:bg-slate-700 transition-all"
            >
              <Plus size={12} /> Record Sale
            </button>
            <button
              onClick={handleExportCsv}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-slate-700 text-[10px] font-bold uppercase tracking-widest hover:bg-slate-50 transition-all"
            >
              <Download size={12} /> Export CSV
            </button>
          </div>
        </div>

        {/* KPI tiles */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-4">
          <KpiTile
            label="Sold Today"
            value={kpis.todayCount}
            sub={fmtGBP(kpis.todayRevenue)}
            tone="emerald"
            onClick={() => setDateScope('today')}
            active={dateScope === 'today'}
          />
          <KpiTile
            label="This Month"
            value={kpis.monthCount}
            sub={fmtGBP(kpis.monthRevenue)}
            tone="blue"
            onClick={() => setDateScope('month')}
            active={dateScope === 'month'}
          />
          <KpiTile
            label="All-time Sold"
            value={kpis.allCount}
            sub={fmtGBP(kpis.allGP) + ' GP'}
            tone="slate"
            onClick={() => setDateScope('all')}
            active={dateScope === 'all'}
          />
          <KpiTile
            label="Avg GP %"
            value={`${kpis.avgGpPct.toFixed(1)}%`}
            sub={kpis.lossCount > 0 ? `${kpis.lossCount} loss-making` : 'all profitable'}
            tone={kpis.avgGpPct >= 0 ? 'emerald' : 'rose'}
          />
          <KpiTile
            label="Awaiting IMEI"
            value={kpis.awaitingImei}
            sub="SHS dispatched"
            tone="amber"
          />
        </div>
      </div>

      {/* ── Awaiting IMEI pinned section (sold SHS, no IMEI yet) ──────── */}
      {awaitingImei.length > 0 && (
        <AwaitingImeiSection
          units={awaitingImei}
          supplierMap={supplierMap}
          onBackfill={u => setEnterImeiUnit(u)}
        />
      )}

      {/* ── Filter bar ────────────────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden">
        <div className="flex flex-col gap-2 p-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1 min-w-0">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search IMEI, order #, model, supplier…"
                className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[12px] focus:outline-none focus:border-slate-900 focus:bg-white transition-all"
              />
            </div>
            <button
              onClick={() => setShowFilterDrawer(s => !s)}
              className={`flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all border
                ${marketplaceFilter.size + supplierFilter.size > 0 || profitFilter !== 'all'
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-200 hover:border-slate-400'}`}
            >
              <Filter size={12} /> Filters
              {(marketplaceFilter.size + supplierFilter.size + (profitFilter === 'all' ? 0 : 1)) > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded-full bg-white/20 text-[9px]">
                  {marketplaceFilter.size + supplierFilter.size + (profitFilter === 'all' ? 0 : 1)}
                </span>
              )}
            </button>
          </div>

          {/* Date scope pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            {([
              ['today', 'Today',      kpis.todayCount],
              ['week',  'Last 7d',    allSold.filter(s => {
                const sevenAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().split('T')[0];
                return (s.saleDate || '').split('T')[0] >= sevenAgo;
              }).length],
              ['month', 'This Month', kpis.monthCount],
              ['all',   'All Time',   kpis.allCount],
            ] as Array<[DateScope, string, number]>).map(([id, label, n]) => (
              <button
                key={id}
                onClick={() => setDateScope(id)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest border transition-all flex-shrink-0
                  ${dateScope === id
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'}`}
              >
                {label}
                <span className={`text-[9px] font-mono px-1 rounded ${dateScope === id ? 'bg-white/20' : 'bg-slate-100 text-slate-500'}`}>
                  {n}
                </span>
              </button>
            ))}
            {(marketplaceFilter.size + supplierFilter.size > 0 || profitFilter !== 'all' || search) && (
              <button
                onClick={() => {
                  setMarketplaceFilter(new Set()); setSupplierFilter(new Set()); setProfitFilter('all'); setSearch('');
                }}
                className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest text-slate-500 hover:text-rose-600 transition-all flex-shrink-0"
              >
                <X size={11} /> Reset
              </button>
            )}
          </div>

          <AnimatePresence>
            {showFilterDrawer && (
              <motion.div
                initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 pb-1 border-t border-slate-100">
                  <FilterChipsGroup
                    label="Marketplace"
                    options={MARKETPLACES as unknown as string[]}
                    selected={new Set(Array.from(marketplaceFilter))}
                    onToggle={name => {
                      const next = new Set(marketplaceFilter);
                      const mp = name as Marketplace;
                      if (next.has(mp)) next.delete(mp); else next.add(mp);
                      setMarketplaceFilter(next);
                    }}
                  />
                  <FilterChipsGroup
                    label="Supplier"
                    options={supplierOptions}
                    selected={supplierFilter}
                    onToggle={name => {
                      const next = new Set(supplierFilter);
                      if (next.has(name)) next.delete(name); else next.add(name);
                      setSupplierFilter(next);
                    }}
                  />
                  <div>
                    <p className="text-[9px] font-mono uppercase tracking-widest text-slate-500 mb-1.5">Profitability</p>
                    <div className="flex gap-1">
                      {(['all', 'profit', 'loss'] as const).map(p => (
                        <button
                          key={p}
                          onClick={() => setProfitFilter(p)}
                          className={`px-2 py-1 rounded-md text-[10px] font-mono border transition-all
                            ${profitFilter === p
                              ? 'bg-slate-900 text-white border-slate-900'
                              : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'}`}
                        >
                          {p === 'all' ? 'All' : p === 'profit' ? 'Profit' : 'Loss'}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="px-4 py-1.5 border-t border-slate-100 bg-slate-50/50 text-[9px] font-mono uppercase tracking-widest text-slate-500 flex items-center justify-between">
          <span>
            Showing <span className="text-slate-900 font-bold">{filtered.length.toLocaleString()}</span> of {allSold.length.toLocaleString()} sales
          </span>
          <span className="hidden sm:inline">
            GP: <span className={`font-bold ${filtered.reduce((s, x) => s + (x.grossProfit ?? 0), 0) >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
              {fmtGBP(filtered.reduce((s, x) => s + (x.grossProfit ?? 0), 0))}
            </span>
          </span>
        </div>
      </div>

      {/* ── The sheet ────────────────────────────────────────────────── */}
      <Sheet
        rows={filtered}
        units={units}
        supplierMap={supplierMap}
        sort={sort}
        onSort={setSort}
        activeId={activeSale?.id ?? null}
        onSelect={s => setActiveSale(s)}
        editingCell={editingCell}
        onEdit={(id, field) => setEditingCell({ id, field })}
        onCancelEdit={() => setEditingCell(null)}
        onSaveCell={saveCell}
        rowMenuId={rowMenuId}
        setRowMenuId={setRowMenuId}
        region={region}
      />

      {/* ── Detail panel ────────────────────────────────────────────── */}
      <AnimatePresence>
        {activeSale && (
          <DetailPanel
            sale={activeSale}
            unit={(activeSale.unitId && units.find(x => x.id === activeSale.unitId)) || undefined}
            supplierName={supplierMap[activeSale.supplierId || ''] || activeSale.supplierName || '—'}
            quotes={findQuotes(activeSale.unitId ? units.find(x => x.id === activeSale.unitId)?.model : undefined)}
            region={region}
            onClose={() => setActiveSale(null)}
          />
        )}
      </AnimatePresence>

      {/* ── Modals ──────────────────────────────────────────────────── */}
      <AnimatePresence>
        {sellOrderUnit && (
          <SellOrderModal
            unit={sellOrderUnit}
            isSHS={sellOrderIsSHS}
            onClose={() => { setSellOrderUnit(null); setSellOrderIsSHS(false); }}
            onSaved={() => { setSellOrderUnit(null); setSellOrderIsSHS(false); }}
          />
        )}
        {enterImeiUnit && (
          <EnterImeiModal
            unit={enterImeiUnit}
            onClose={() => setEnterImeiUnit(null)}
            onSaved={() => setEnterImeiUnit(null)}
          />
        )}
        {pickerOpen && (
          <SellUnitPicker
            units={inStock}
            shsUnits={manualShs}
            supplierMap={supplierMap}
            onClose={() => setPickerOpen(false)}
            onPick={(u, isSHS) => {
              setPickerOpen(false);
              setSellOrderUnit(u);
              setSellOrderIsSHS(isSHS);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ── KPI tile ─────────────────────────────────────────────────────────────────
function KpiTile({
  label, value, sub, tone, active, onClick,
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone: 'slate' | 'emerald' | 'amber' | 'blue' | 'rose';
  active?: boolean;
  onClick?: () => void;
}) {
  const tones: Record<string, string> = {
    slate:   'bg-slate-50 border-slate-200 text-slate-700',
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    amber:   'bg-amber-50 border-amber-200 text-amber-700',
    blue:    'bg-blue-50 border-blue-200 text-blue-700',
    rose:    'bg-rose-50 border-rose-200 text-rose-700',
  };
  const cls = `text-left rounded-xl border px-3 py-2.5 transition-all ${tones[tone]} ${onClick ? 'hover:shadow-sm cursor-pointer' : 'cursor-default'} ${active ? 'ring-2 ring-slate-900/10 shadow-sm' : ''}`;
  const inner = (
    <>
      <p className="text-[8px] font-mono uppercase tracking-widest opacity-80">{label}</p>
      <p className="text-xl font-bold leading-tight tabular-nums mt-0.5">{value}</p>
      {sub && <p className="text-[9px] font-mono mt-0.5 opacity-70">{sub}</p>}
    </>
  );
  if (onClick) return <button onClick={onClick} className={cls}>{inner}</button>;
  return <div className={cls}>{inner}</div>;
}

function FilterChipsGroup({
  label, options, selected, onToggle,
}: {
  label: string;
  options: string[];
  selected: Set<string>;
  onToggle: (v: string) => void;
}) {
  return (
    <div>
      <p className="text-[9px] font-mono uppercase tracking-widest text-slate-500 mb-1.5">{label}</p>
      <div className="flex flex-wrap gap-1">
        {options.length === 0 ? (
          <span className="text-[10px] font-mono text-slate-400">No options</span>
        ) : (
          options.map(o => {
            const on = selected.has(o);
            return (
              <button
                key={o}
                onClick={() => onToggle(o)}
                className={`px-2 py-1 rounded-md text-[10px] font-mono border transition-all
                  ${on
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'}`}
              >
                {o}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── Sheet ────────────────────────────────────────────────────────────────────
function Sheet({
  rows, units, supplierMap, sort, onSort,
  activeId, onSelect, editingCell, onEdit, onCancelEdit, onSaveCell,
  rowMenuId, setRowMenuId, region,
}: {
  rows: Sale[];
  units: InventoryUnit[];
  supplierMap: Record<string, string>;
  sort: { key: SortKey; dir: SortDir };
  onSort: (s: { key: SortKey; dir: SortDir }) => void;
  activeId: string | null;
  onSelect: (s: Sale) => void;
  editingCell: { id: string; field: string } | null;
  onEdit: (id: string, field: string) => void;
  onCancelEdit: () => void;
  onSaveCell: (s: Sale, field: string, value: any) => Promise<void>;
  rowMenuId: string | null;
  setRowMenuId: (id: string | null) => void;
  region: 'uk' | 'india' | 'admin' | 'both';
}) {
  const toggleSort = (k: SortKey) => onSort({ key: k, dir: sort.key === k && sort.dir === 'desc' ? 'asc' : 'desc' });

  if (rows.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-3xl p-12 text-center text-slate-400">
        <Sparkles size={28} className="mx-auto" />
        <p className="text-[11px] font-mono uppercase tracking-widest mt-2">No sales match these filters</p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden">
      <div className="overflow-auto max-h-[calc(100vh-420px)] custom-scrollbar">
        <table className="w-full text-[11px] border-separate border-spacing-0" style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
          <thead>
            <tr className="text-[9px] font-bold uppercase tracking-widest text-slate-500 bg-slate-50">
              <Th sticky leftPx={0} k="orderNumber" sort={sort} onSort={toggleSort} width="180px">Order · IMEI</Th>
              <Th k="saleDate"    sort={sort} onSort={toggleSort} width="110px">Sold</Th>
              <Th k="marketplace" sort={sort} onSort={toggleSort} width="110px">Marketplace</Th>
              <Th k="model"       sort={sort} onSort={toggleSort} width="260px">Model</Th>
              <Th k="storage"     sort={sort} onSort={toggleSort} width="80px">Storage</Th>
              <Th k="colour"      sort={sort} onSort={toggleSort} width="120px">Colour</Th>
              <Th k="buyPrice"    sort={sort} onSort={toggleSort} width="80px"  align="right">BP</Th>
              <Th k="salePrice"   sort={sort} onSort={toggleSort} width="80px"  align="right">SP</Th>
              <Th                 sort={sort} onSort={undefined}   width="80px"  align="right">Comm.</Th>
              <Th k="grossProfit" sort={sort} onSort={toggleSort} width="80px"  align="right">GP</Th>
              <Th k="gpPercent"   sort={sort} onSort={toggleSort} width="70px"  align="right">GP %</Th>
              <Th k="supplier"    sort={sort} onSort={toggleSort} width="120px">Supplier</Th>
              <Th                 sort={sort} onSort={undefined}   width="60px"><span className="sr-only">Actions</span></Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s, idx) => {
              const u = (s.unitId && units.find(x => x.id === s.unitId)) || undefined;
              const supplierName = supplierMap[s.supplierId || ''] || s.supplierName || '—';
              const isActive = s.id === activeId;
              const isAlt = idx % 2 === 1;
              const rowBg = isActive
                ? 'bg-indigo-50'
                : isAlt
                  ? 'bg-slate-50/40 hover:bg-slate-100/60'
                  : 'bg-white hover:bg-slate-50';
              const gp = s.grossProfit ?? 0;
              const gpTone = gp > 0 ? 'text-emerald-700' : gp < 0 ? 'text-rose-700' : 'text-slate-600';
              const mpTone = MARKETPLACE_TONE[s.marketplace] || 'bg-slate-100 text-slate-600 border-slate-200';

              return (
                <tr key={s.id} className={`${rowBg} transition-colors cursor-default group`}>
                  {/* Frozen Order/IMEI cell */}
                  <Td sticky leftPx={0} className={`${rowBg} border-r border-slate-200`}>
                    <div className="flex flex-col gap-0.5">
                      <button
                        onClick={() => onSelect(s)}
                        className="text-left font-bold text-slate-900 hover:text-indigo-700 truncate max-w-full text-[11px]"
                        title={s.orderNumber || ''}
                      >
                        {s.orderNumber || <span className="text-slate-300 italic font-normal">(no order #)</span>}
                      </button>
                      {s.imei
                        ? <CopyImei imei={s.imei} truncate={15} />
                        : <span className="inline-flex items-center gap-1 text-amber-600 text-[9px] font-mono">
                            <AlertCircle size={9} /> awaiting IMEI
                          </span>
                      }
                    </div>
                  </Td>

                  <Td><span className="text-slate-700">{fmtDateForUser(s.saleDate || '', region) || s.saleDate || '—'}</span></Td>

                  {/* Marketplace — inline editable */}
                  <Td>
                    <InlineEditableSelect
                      editing={editingCell?.id === s.id && editingCell?.field === 'marketplace'}
                      onActivate={() => onEdit(s.id, 'marketplace')}
                      onCommit={async v => { await onSaveCell(s, 'marketplace', v); }}
                      onCancel={onCancelEdit}
                      value={s.marketplace}
                      options={MARKETPLACES as unknown as string[]}
                      display={
                        <span className={`inline-flex items-center text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded border ${mpTone}`}>
                          {s.marketplace}
                        </span>
                      }
                    />
                  </Td>

                  <Td>
                    <button
                      onClick={() => onSelect(s)}
                      className="text-left font-bold text-slate-900 hover:text-indigo-700 truncate max-w-full"
                      title={u?.model || ''}
                    >
                      <span className="truncate">{u?.model || s.sku || '—'}</span>
                    </button>
                  </Td>
                  <Td><span className="text-slate-600">{u?.storage || '—'}</span></Td>
                  <Td><span className="text-slate-600 truncate">{u?.colour || '—'}</span></Td>

                  <Td align="right">
                    <InlineEditableCell
                      editing={editingCell?.id === s.id && editingCell?.field === 'buyPrice'}
                      onActivate={() => onEdit(s.id, 'buyPrice')}
                      onCommit={async v => { await onSaveCell(s, 'buyPrice', Number(v) || 0); }}
                      onCancel={onCancelEdit}
                      initialValue={String(s.buyPrice ?? 0)}
                      display={<span className="text-slate-700">£{(s.buyPrice ?? 0).toFixed(0)}</span>}
                      align="right"
                      type="number"
                    />
                  </Td>

                  <Td align="right">
                    <InlineEditableCell
                      editing={editingCell?.id === s.id && editingCell?.field === 'salePrice'}
                      onActivate={() => onEdit(s.id, 'salePrice')}
                      onCommit={async v => { await onSaveCell(s, 'salePrice', Number(v) || 0); }}
                      onCancel={onCancelEdit}
                      initialValue={String(s.salePrice ?? 0)}
                      display={<span className="font-bold text-slate-900">£{(s.salePrice ?? 0).toFixed(0)}</span>}
                      align="right"
                      type="number"
                    />
                  </Td>

                  <Td align="right"><span className="text-slate-500">{fmtGBP(s.commission ?? 0)}</span></Td>
                  <Td align="right">
                    <span className={`font-bold ${gpTone} inline-flex items-center gap-1 justify-end`}>
                      {gp > 0 ? <TrendingUp size={9} /> : gp < 0 ? <TrendingDown size={9} /> : null}
                      {fmtGBP(gp)}
                    </span>
                  </Td>
                  <Td align="right"><span className={gpTone}>{(s.gpPercent ?? 0).toFixed(1)}%</span></Td>
                  <Td><span className="text-slate-700 truncate">{supplierName}</span></Td>

                  <Td>
                    <div className="relative" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => setRowMenuId(rowMenuId === s.id ? null : s.id)}
                        className="opacity-30 group-hover:opacity-100 p-1 rounded hover:bg-slate-200 text-slate-600 transition-all"
                      >
                        <MoreHorizontal size={13} />
                      </button>
                      {rowMenuId === s.id && (
                        <div className="absolute right-0 mt-1 w-44 bg-white border border-slate-200 rounded-lg shadow-xl z-20 py-1">
                          <button
                            onClick={() => { setRowMenuId(null); onSelect(s); }}
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-[10px] text-slate-700 hover:bg-slate-50"
                          >
                            <Eye size={11} /> View detail
                          </button>
                          {s.imei && (
                            <button
                              onClick={() => { setRowMenuId(null); try { navigator.clipboard.writeText(s.imei!); } catch {} }}
                              className="w-full flex items-center gap-2 px-3 py-1.5 text-[10px] text-slate-700 hover:bg-slate-50"
                            >
                              <Sparkles size={11} /> Copy IMEI
                            </button>
                          )}
                          {s.orderNumber && (
                            <button
                              onClick={() => { setRowMenuId(null); try { navigator.clipboard.writeText(s.orderNumber); } catch {} }}
                              className="w-full flex items-center gap-2 px-3 py-1.5 text-[10px] text-slate-700 hover:bg-slate-50"
                            >
                              <Sparkles size={11} /> Copy Order #
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Table cell building blocks ───────────────────────────────────────────────
function Th({
  children, k, sort, onSort, sticky, leftPx, width, align,
}: {
  children: React.ReactNode;
  k?: SortKey;
  sort: { key: SortKey; dir: SortDir };
  onSort?: (k: SortKey) => void;
  sticky?: boolean;
  leftPx?: number;
  width?: string;
  align?: 'left' | 'right';
}) {
  const active = k && sort.key === k;
  const cls = `text-${align ?? 'left'} px-3 py-2.5 sticky top-0 z-10 bg-slate-50 border-b border-slate-200 font-bold ${
    sticky ? 'z-20 border-r border-slate-200' : ''
  }`;
  const style: React.CSSProperties = {
    minWidth: width, width,
    ...(sticky ? { left: `${leftPx ?? 0}px` } : {}),
  };
  return (
    <th className={cls} style={style}>
      {k && onSort ? (
        <button onClick={() => onSort(k)} className="inline-flex items-center gap-1 hover:text-slate-900 transition-colors">
          {children}
          {active ? (sort.dir === 'desc' ? <ChevronDown size={10} /> : <ChevronUp size={10} />) : <ChevronsUpDown size={10} className="opacity-40" />}
        </button>
      ) : children}
    </th>
  );
}

function Td({
  children, sticky, leftPx, align, className,
}: {
  children: React.ReactNode;
  sticky?: boolean;
  leftPx?: number;
  align?: 'left' | 'right';
  className?: string;
}) {
  const style: React.CSSProperties = sticky ? { left: `${leftPx ?? 0}px`, position: 'sticky' as const, zIndex: 5 } : {};
  return (
    <td
      className={`text-${align ?? 'left'} px-3 py-1.5 border-b border-slate-100 align-middle ${className ?? ''}`}
      style={style}
    >
      {children}
    </td>
  );
}

function InlineEditableCell({
  editing, onActivate, onCommit, onCancel, initialValue, display, align, type,
}: {
  editing: boolean;
  onActivate: () => void;
  onCommit: (v: string) => Promise<void>;
  onCancel: () => void;
  initialValue: string;
  display: React.ReactNode;
  align?: 'left' | 'right';
  type?: 'text' | 'number';
}) {
  const [val, setVal] = useState(initialValue);
  const inputRef = React.useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) { setVal(initialValue); setTimeout(() => inputRef.current?.focus(), 0); } }, [editing, initialValue]);
  if (!editing) {
    return (
      <button
        onDoubleClick={onActivate}
        className={`block w-full text-${align ?? 'left'} cursor-text hover:bg-slate-100/80 rounded px-1 -mx-1`}
        title="Double-click to edit"
      >{display}</button>
    );
  }
  return (
    <input
      ref={inputRef}
      type={type ?? 'text'}
      value={val}
      onChange={e => setVal(e.target.value)}
      onKeyDown={async e => {
        if (e.key === 'Enter') await onCommit(val);
        else if (e.key === 'Escape') onCancel();
      }}
      onBlur={async () => { await onCommit(val); }}
      className={`w-full text-${align ?? 'left'} bg-white border border-indigo-500 rounded px-1.5 py-0.5 text-[11px] focus:outline-none font-mono`}
    />
  );
}

function InlineEditableSelect({
  editing, onActivate, onCommit, onCancel, value, options, display,
}: {
  editing: boolean;
  onActivate: () => void;
  onCommit: (v: string) => Promise<void>;
  onCancel: () => void;
  value: string;
  options: string[];
  display: React.ReactNode;
}) {
  if (!editing) {
    return (
      <button
        onDoubleClick={onActivate}
        className="block w-full text-left cursor-pointer hover:bg-slate-100/80 rounded px-1 -mx-1"
        title="Double-click to change"
      >{display}</button>
    );
  }
  return (
    <select
      autoFocus
      defaultValue={value}
      onChange={async e => { await onCommit(e.target.value); }}
      onBlur={onCancel}
      onKeyDown={e => { if (e.key === 'Escape') onCancel(); }}
      className="w-full bg-white border border-indigo-500 rounded px-1 py-0.5 text-[10px] focus:outline-none"
    >
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

// ── Awaiting IMEI pinned section ────────────────────────────────────────────
function AwaitingImeiSection({
  units, supplierMap, onBackfill,
}: {
  units: InventoryUnit[];
  supplierMap: Record<string, string>;
  onBackfill: (u: InventoryUnit) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="bg-gradient-to-br from-orange-50/60 to-amber-50/30 border border-orange-100 rounded-3xl shadow-sm overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-5 py-3 hover:bg-orange-100/40 transition-colors"
      >
        <div className="w-7 h-7 rounded-lg bg-orange-200 text-orange-700 flex items-center justify-center flex-shrink-0">
          <PackageCheck size={14} />
        </div>
        <div className="flex-1 text-left min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-widest text-orange-900">Awaiting IMEI · Supplier Dispatch</p>
          <p className="text-[9px] font-mono text-orange-700/70 mt-0.5">Sale recorded · IMEI to be confirmed from the supplier invoice</p>
        </div>
        <span className="text-[10px] font-mono bg-orange-200 text-orange-800 px-2 py-0.5 rounded-full">{units.length}</span>
        {open ? <ChevronUp size={14} className="text-orange-700" /> : <ChevronDown size={14} className="text-orange-700" />}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="bg-white/60 border-t border-orange-100 divide-y divide-orange-50">
              {units.map(u => (
                <div key={u.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-orange-50/60 transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-bold text-slate-900 truncate">{u.model}</p>
                    <p className="text-[9px] text-slate-500 font-mono mt-0.5 truncate">
                      {u.colour}{u.storage ? ` · ${u.storage}` : ''} · {supplierMap[u.supplierId] || '—'} · sold {u.saleDate || '—'}
                    </p>
                  </div>
                  {u.salePrice != null && <span className="text-sm font-bold text-emerald-700">£{u.salePrice}</span>}
                  <button
                    onClick={() => onBackfill(u)}
                    className="flex items-center gap-1 px-3 py-1.5 bg-orange-500 text-white text-[9px] font-bold uppercase tracking-widest rounded-lg hover:bg-orange-600 transition-all"
                  >
                    <PackageCheck size={11} /> Backfill IMEI
                  </button>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Detail Panel ─────────────────────────────────────────────────────────────
function DetailPanel({
  sale, unit, supplierName, quotes, region, onClose,
}: {
  sale: Sale;
  unit: InventoryUnit | undefined;
  supplierName: string;
  quotes: SupplierWhatsappUpdate[];
  region: 'uk' | 'india' | 'admin' | 'both';
  onClose: () => void;
}) {
  const gp = sale.grossProfit ?? 0;
  const gpTone = gp > 0 ? 'text-emerald-700' : gp < 0 ? 'text-rose-700' : 'text-slate-700';
  const mpTone = MARKETPLACE_TONE[sale.marketplace] || 'bg-slate-100 text-slate-700 border-slate-200';
  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-sm" onClick={onClose} />
      <motion.aside initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 320 }}
        className="fixed inset-y-0 right-0 z-50 w-full sm:w-[480px] bg-white border-l border-slate-200 shadow-2xl flex flex-col">
        <div className="flex items-start gap-3 p-5 border-b border-slate-100">
          <div className="flex-1 min-w-0">
            <p className="text-[9px] font-mono uppercase tracking-widest text-slate-400">Order</p>
            <p className="text-sm font-bold tracking-tight text-slate-900 mt-1">{sale.orderNumber || '—'}</p>
            {sale.imei && <div className="mt-1"><CopyImei imei={sale.imei} truncate={24} /></div>}
            <p className="text-base font-bold tracking-tight text-slate-900 mt-2 leading-snug">{unit?.model || sale.sku || '—'}</p>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className={`inline-flex items-center text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded border ${mpTone}`}>
                {sale.marketplace}
              </span>
              {sale.saleDate && <span className="text-[9px] font-mono text-slate-500">{fmtDateForUser(sale.saleDate, region) || sale.saleDate}</span>}
              {unit?.storage && <span className="text-[9px] font-mono text-slate-500">{unit.storage}</span>}
              {unit?.colour && <span className="text-[9px] font-mono text-slate-500">{unit.colour}</span>}
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-900 transition-all flex-shrink-0">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Financial breakdown — live recompute */}
          <DetailSection title="Financials" badge="Live recompute">
            <Field k="Sale Price"   v={fmtGBP(sale.salePrice ?? 0)} />
            <Field k="Buy Price"    v={fmtGBP(sale.buyPrice ?? 0)} />
            <Field k="SP - BP"      v={fmtGBP(sale.spMinusBp ?? 0)} />
            <Field k="Commission"   v={`-${fmtGBP(sale.commission ?? 0).replace('£', '£')}`} />
            {typeof sale.payPalKlarnaCom === 'number' && sale.payPalKlarnaCom > 0 && (
              <Field k="PayPal/Klarna" v={`-${fmtGBP(sale.payPalKlarnaCom)}`} />
            )}
            {typeof sale.rof === 'number' && sale.rof > 0 && <Field k="ROF" v={`-${fmtGBP(sale.rof)}`} />}
            {typeof sale.fvf === 'number' && sale.fvf > 0 && <Field k="FVF" v={`-${fmtGBP(sale.fvf)}`} />}
            {typeof sale.vat20 === 'number' && sale.vat20 > 0 && <Field k="VAT 20%" v={`-${fmtGBP(sale.vat20)}`} />}
            <Field k="Postage"      v={`-${fmtGBP(sale.postage ?? 0)}`} />
            <div className="h-px bg-slate-200 my-1.5" />
            <Field k="Gross Profit" v={fmtGBP(gp)} highlight={gp >= 0 ? 'good' : 'bad'} />
            <Field k="GP %"         v={`${(sale.gpPercent ?? 0).toFixed(1)}%`} />
            {typeof sale.netProfit === 'number' && (
              <Field k="Net Profit (post-promo)" v={fmtGBP(sale.netProfit)} highlight={sale.netProfit >= 0 ? 'good' : 'bad'} />
            )}
          </DetailSection>

          <DetailSection title="Source">
            <Field k="Supplier"  v={supplierName} />
            {sale.paymentMode && <Field k="Payment Mode" v={sale.paymentMode} />}
            {sale.sourceFile  && <Field k="Source File"  v={sale.sourceFile} />}
            {sale.importBatchId && <Field k="Batch"      v={sale.importBatchId.slice(0, 12)} />}
          </DetailSection>

          {quotes.length > 0 && (
            <DetailSection title="Supplier WhatsApp Quotes" badge={`${quotes.length} match${quotes.length === 1 ? '' : 'es'}`}>
              <div className="space-y-2">
                {quotes.slice(0, 8).map(q => (
                  <div key={q.id} className="flex items-start gap-2 p-2.5 rounded-lg bg-emerald-50 border border-emerald-100">
                    <MessageCircle size={11} className="text-emerald-600 mt-0.5 flex-shrink-0" />
                    <p className="flex-1 text-[10px] font-mono text-slate-700 leading-relaxed whitespace-pre-wrap break-words">
                      {q.rawText}
                    </p>
                    {q.priceText && <span className="text-[11px] font-bold text-emerald-800 flex-shrink-0">{q.priceText}</span>}
                  </div>
                ))}
              </div>
            </DetailSection>
          )}

          {sale.comments && (
            <DetailSection title="Comments">
              <p className="text-[11px] font-mono text-slate-700 whitespace-pre-wrap leading-relaxed">{sale.comments}</p>
            </DetailSection>
          )}
        </div>
      </motion.aside>
    </>
  );
}

function DetailSection({ title, badge, children }: { title: string; badge?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl p-3.5 border bg-slate-50/60 border-slate-100">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">{title}</p>
        {badge && <span className="text-[8px] font-mono text-slate-400 px-1.5 py-0.5 bg-white border border-slate-100 rounded">{badge}</span>}
      </div>
      <div className="space-y-1.5">{children}</div>
    </section>
  );
}

function Field({ k, v, highlight }: { k: string; v: string; highlight?: 'good' | 'bad' }) {
  const tone = highlight === 'good' ? 'text-emerald-700 font-bold'
             : highlight === 'bad'  ? 'text-rose-700 font-bold'
             : 'text-slate-900';
  return (
    <div className="flex items-center justify-between gap-3 text-[11px]">
      <span className="text-slate-400 font-mono text-[10px] uppercase tracking-widest">{k}</span>
      <span className={`font-medium tabular-nums text-right ${tone}`}>{v}</span>
    </div>
  );
}

// ── Sell unit picker (modal for "Record Sale" entrypoint) ────────────────────
function SellUnitPicker({
  units, shsUnits, supplierMap, onClose, onPick,
}: {
  units: InventoryUnit[];
  shsUnits: InventoryUnit[];
  supplierMap: Record<string, string>;
  onClose: () => void;
  onPick: (u: InventoryUnit, isSHS: boolean) => void;
}) {
  const [search, setSearch] = useState('');
  const filteredAvailable = units.filter(u => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (u.model || '').toLowerCase().includes(q)
        || (u.imei || '').toLowerCase().includes(q)
        || (supplierMap[u.supplierId] || '').toLowerCase().includes(q);
  }).slice(0, 100);
  const filteredShs = shsUnits.filter(u => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (u.model || '').toLowerCase().includes(q)
        || (supplierMap[u.supplierId] || '').toLowerCase().includes(q);
  }).slice(0, 50);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <motion.div initial={{ scale: 0.97, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-3xl w-full max-w-lg shadow-2xl flex flex-col" style={{ maxHeight: 'calc(100dvh - 32px)' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center"><ShoppingCart size={16} /></div>
            <div>
              <p className="text-[9px] font-mono uppercase tracking-widest text-slate-400">Pick a unit</p>
              <h3 className="text-sm font-bold">Record a sale</h3>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400"><X size={16} /></button>
        </div>
        <div className="p-4 border-b border-slate-100">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              autoFocus
              type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search by model, IMEI, supplier…"
              className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[12px] focus:outline-none focus:border-slate-900 focus:bg-white"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
          {filteredAvailable.length === 0 && filteredShs.length === 0 && (
            <p className="p-8 text-center text-[11px] font-mono text-slate-400">No matches.</p>
          )}
          {filteredAvailable.length > 0 && (
            <>
              <div className="px-4 py-1.5 bg-emerald-50/50 border-b border-emerald-100">
                <p className="text-[9px] font-bold uppercase tracking-widest text-emerald-700">In Stock · {filteredAvailable.length}</p>
              </div>
              {filteredAvailable.map(u => (
                <button key={u.id} onClick={() => onPick(u, false)}
                  className="w-full text-left flex items-center gap-3 px-4 py-2.5 hover:bg-emerald-50/40 transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-bold text-slate-900 truncate">{u.model}</p>
                    <p className="text-[9px] text-slate-500 font-mono mt-0.5 truncate">
                      {u.imei || '(no IMEI)'} · {u.colour}{u.storage ? ` · ${u.storage}` : ''} · {supplierMap[u.supplierId] || '—'}
                    </p>
                  </div>
                  <span className="text-sm font-bold text-slate-800 flex-shrink-0">£{u.buyPrice}</span>
                </button>
              ))}
            </>
          )}
          {filteredShs.length > 0 && (
            <>
              <div className="px-4 py-1.5 bg-amber-50/50 border-b border-amber-100">
                <p className="text-[9px] font-bold uppercase tracking-widest text-amber-700">SHS · Supplier-direct · {filteredShs.length}</p>
              </div>
              {filteredShs.map(u => (
                <button key={u.id} onClick={() => onPick(u, true)}
                  className="w-full text-left flex items-center gap-3 px-4 py-2.5 hover:bg-amber-50/40 transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-bold text-slate-900 truncate flex items-center gap-2">
                      {u.model}
                      <Truck size={11} className="text-amber-600" />
                    </p>
                    <p className="text-[9px] text-slate-500 font-mono mt-0.5 truncate">
                      Supplier holds · {supplierMap[u.supplierId] || '—'}
                    </p>
                  </div>
                  <span className="text-sm font-bold text-slate-800 flex-shrink-0">£{u.buyPrice}</span>
                </button>
              ))}
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function downloadCsv(filename: string, rows: Array<Record<string, any>>) {
  if (rows.length === 0) {
    const blob = new Blob(['(no rows)\n'], { type: 'text/csv' });
    triggerDownload(filename, blob);
    return;
  }
  const headers = Object.keys(rows[0]);
  const esc = (v: any) => {
    const s = v == null ? '' : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.join(','), ...rows.map(r => headers.map(h => esc(r[h])).join(','))];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(filename, blob);
}

function triggerDownload(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
