/**
 * SellSheet — sell-side dashboard for the Sell tab.
 *
 * Mirrors the Buy screen's design language but driven by sale rows:
 *   - Action row: Record Sale · Schema · Export CSV
 *   - 5 clickable KPI tiles: Sold Today · This Month · All-time Sold ·
 *     Avg GP % · Awaiting IMEI
 *   - Sell Intelligence panel (Hot This Week / Top Earners / Push These /
 *     Platform Revenue) — same component the Buy tab used
 *   - Filter panel (search + date scope pills + marketplace / supplier chips)
 *   - Always-on inline Excel sheet with the columns the client cares about:
 *     Sell Date · IMEI · Model · Storage · Colour · Supplier · BP · SP ·
 *     Platform · Postage · Commission · GP · GP %
 *   - Pinned 'Awaiting IMEI' section for sold SHS units missing serials
 *   - KPI overlay modal for focused subset views
 *
 * Every row passes through recomputeSale so Commission / GP / GP% / Net
 * stay in sync with the current MARKETPLACE_FEES table. Inline edits on
 * SP / Platform / Postage write back and re-compute the derived columns.
 */
import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Search, ShoppingCart, ChevronDown, ChevronUp, ChevronsUpDown,
  Filter, X, AlertCircle, Plus, Info, Sparkles, FileSpreadsheet,
  TrendingUp, TrendingDown, PackageCheck, Truck, ChevronRight, Layers, List,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { dbService } from '../lib/dbService';
import {
  InventoryUnit, Sale, Marketplace,
} from '../types';
import { useInventoryStore } from '../lib/inventoryStore';
import { recomputeSale } from '../lib/recomputeSale';
import { downloadSalesWorkbook } from '../lib/clientReport';
import {
  marketplaceFromListingSite, MARKETPLACES,
} from '../lib/platforms';
import { fmtDateForUser, useUserRegion } from '../lib/userLocale';
import { manualShsUnitsFrom } from '../lib/shsCount';
import CopyImei from './CopyImei';
import IntelligencePanel from './IntelligencePanel';
import PeriodicInventory from './PeriodicInventory';
import SellOrderModal from './SellOrderModal';
import EnterImeiModal from './EnterImeiModal';

// ── Types ────────────────────────────────────────────────────────────────────

type KpiId = 'today' | 'month' | 'all' | 'gpPct' | 'awaiting';
type DateScope = 'today' | 'week' | 'month' | 'all';
type SortKey =
  | 'saleDate' | 'model' | 'storage' | 'colour' | 'buyPrice' | 'salePrice'
  | 'grossProfit' | 'gpPercent' | 'marketplace' | 'supplier' | 'postage' | 'commission';
type SortDir = 'asc' | 'desc';

interface Props {}

type MarketplaceGroupModel = { label: string; units: number; revenue: number; gp: number };
type MarketplaceGroup = {
  mp: Marketplace;
  orders: number;
  units: number;
  revenue: number;
  gp: number;
  byModel: Map<string, MarketplaceGroupModel>;
};

const MARKETPLACE_TONE: Record<Marketplace, string> = {
  AMAZON:  'bg-orange-100 text-orange-700  border-orange-200',
  BM:      'bg-emerald-100 text-emerald-700 border-emerald-200',
  EBAY:    'bg-yellow-100 text-yellow-700  border-yellow-200',
  ONBUY:   'bg-blue-100 text-blue-700      border-blue-200',
};

const fmtGBP = (n: number | undefined | null, decimals = 2): string => {
  if (n == null || Number.isNaN(n)) return '—';
  const sign = n < 0 ? '-' : '';
  return `${sign}£${Math.abs(n).toFixed(decimals)}`;
};

const todayStr = () => new Date().toISOString().split('T')[0];

/** Synthesise a Sale row from a legacy in-app sold unit so it can live in
 *  the same merged list as docs from the sales collection. */
function inventoryUnitToSale(u: InventoryUnit): Sale {
  const marketplace: Marketplace =
    (marketplaceFromListingSite(u.salePlatform || '') as Marketplace | undefined) ?? 'EBAY';
  const sp = u.salePrice ?? 0;
  const bp = u.buyPrice ?? 0;
  return {
    id: u.id, marketplace,
    orderNumber: u.saleOrderId || '',
    sku: u.sku, imei: u.imei, unitId: u.id,
    supplierId: u.supplierId, supplierName: u.supplierName,
    saleDate: (u.saleDate || u.updatedAt?.split?.('T')?.[0] || '') as string,
    quantity: 1, buyPrice: bp, salePrice: sp,
    spMinusBp: sp - bp, marginalTax: 0, commission: 0,
    postage: u.postageCost ?? 0, grossProfit: 0, gpPercent: 0,
    comments: u.notes || undefined,
    importBatchId: 'inapp', sourceFile: 'inapp-sell-flow', sourceRow: 0,
    importedAt: u.updatedAt ?? u.createdAt,
    createdAt: u.createdAt, updatedAt: u.updatedAt,
    ownerId: u.ownerId,
  };
}

// ── Component ────────────────────────────────────────────────────────────────

export default function SellSheet(_props: Props) {
  const { units, suppliers, sales } = useInventoryStore();
  const region = useUserRegion();

  const supplierMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of suppliers) m[s.id] = s.name;
    return m;
  }, [suppliers]);

  // ── Filters / sort ────────────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [dateScope, setDateScope] = useState<DateScope>('month');
  const [marketplaceFilter, setMarketplaceFilter] = useState<Set<Marketplace>>(new Set());
  const [supplierFilter, setSupplierFilter] = useState<Set<string>>(new Set());
  const [showFilterDrawer, setShowFilterDrawer] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'saleDate', dir: 'desc' });

  // ── Modals + overlay ──────────────────────────────────────────────────────
  const [overlay, setOverlay] = useState<KpiId | null>(null);
  const [sellOrderUnit, setSellOrderUnit] = useState<InventoryUnit | null>(null);
  const [sellOrderIsSHS, setSellOrderIsSHS] = useState(false);
  const [enterImeiUnit, setEnterImeiUnit] = useState<InventoryUnit | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [showSchemaHelp, setShowSchemaHelp] = useState(false);
  // ── Indexes ───────────────────────────────────────────────────────────────
  // Sellable inventory — `status='available'` plus the defensive fallback
  // for units that were processed as "Back to Inventory" but whose status
  // didn't flip due to a write race / stale cache. Same widening as the
  // Buy screen's office-stock filter — keeps the two surfaces consistent.
  const inStock = useMemo(() => units.filter(u =>
    u.status === 'available' ||
    (u.returnType === 'returned_to_inventory' && u.status !== 'sold')
  ), [units]);
  const manualShs = useMemo(() => manualShsUnitsFrom(units), [units]);
  const awaitingImei = useMemo(
    () => units.filter(u => u.status === 'sold' && !u.imei)
      .sort((a, b) => (b.saleDate || '').localeCompare(a.saleDate || '')),
    [units],
  );

  // Merge sales collection + legacy in-app sold units, recompute live.
  // Dedupe in three layers so the same physical sale can't appear twice:
  //   1. doc id  — sales doc and a legacy unit-derived doc share an id
  //   2. unitId  — recordSale stamps sale.unitId; if any sale already links
  //                to this unit, the unit-derived candidate is redundant
  //   3. composite (marketplace, orderNumber) — natural dedupe key
  // Layer 2 was missing and caused a real bug: when salePlatform on a unit
  // was the canonical Marketplace enum ('AMAZON') but the listing-site
  // mapper only knew pretty names ('Amazon'), the unit-derived candidate
  // silently resolved to the 'EBAY' fallback. The composite key then
  // mismatched the sale doc (AMAZON__order vs EBAY__order) so dedupe missed
  // and Amazon sales appeared twice.
  const allSold = useMemo<Sale[]>(() => {
    // Build a quick lookup of returned units (returnType set) so we can
    // suppress legacy data where the sale doc itself wasn't voided. Going
    // forward ProcessReturnModal stamps voidedAt on the sale, but old
    // returns processed before that wiring still need to be excluded.
    const returnedUnits = new Set<string>();
    for (const u of units) if (u.returnType) returnedUnits.add(u.id);

    const merged: Sale[] = [];
    const seenIds = new Set<string>();
    const seenUnitIds = new Set<string>();
    const seenKeys = new Set<string>();
    for (const s of sales) {
      // Skip voided sales — a returned sale didn't actually earn us
      // anything, so it's hidden from every Sell-side surface (revenue,
      // GP, Avg GP%, row count). Voided sales live in Returns instead.
      if (s.voidedAt) continue;
      if (s.unitId && returnedUnits.has(s.unitId)) continue;
      const fresh = recomputeSale(s);
      merged.push(fresh);
      seenIds.add(s.id);
      if (fresh.unitId) seenUnitIds.add(fresh.unitId);
      if (fresh.orderNumber) seenKeys.add(`${fresh.marketplace}__${fresh.orderNumber}`);
    }
    for (const u of units) {
      if (u.status !== 'sold' || u.salePrice == null) continue;
      if (u.returnType) continue;        // defense: returned units never count as sold
      if (seenIds.has(u.id)) continue;
      if (seenUnitIds.has(u.id)) continue;
      const candidate = inventoryUnitToSale(u);
      const dedupeKey = candidate.orderNumber ? `${candidate.marketplace}__${candidate.orderNumber}` : '';
      if (dedupeKey && seenKeys.has(dedupeKey)) continue;
      merged.push(recomputeSale(candidate));
    }
    return merged;
  }, [sales, units]);

  // Separate stream of voided sales — used for the 'returned this period'
  // chip on each Sold tile (informational, never counted as sold).
  const voidedSales = useMemo<Array<{ voidedAt: string; sale: Sale }>>(() => {
    const out: Array<{ voidedAt: string; sale: Sale }> = [];
    // Sales explicitly flagged voided on the doc
    for (const s of sales) {
      if (s.voidedAt) out.push({ voidedAt: s.voidedAt, sale: s });
    }
    // Fallback for legacy returns: unit has returnType but the sale doc
    // wasn't patched. Use unit.returnDate as the event date.
    const seen = new Set<string>(out.map(x => x.sale.id));
    for (const u of units) {
      if (!u.returnType || !u.returnDate) continue;
      const match = sales.find(s => s.unitId === u.id);
      if (match && !seen.has(match.id)) {
        out.push({ voidedAt: u.returnDate, sale: match });
        seen.add(match.id);
      }
    }
    return out;
  }, [sales, units]);

  // ── Date-scoped subset ────────────────────────────────────────────────────
  const scopedSold = useMemo<Sale[]>(() => {
    if (dateScope === 'all') return allSold;
    const today = todayStr();
    const monthStart = (() => {
      const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
    })();
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().split('T')[0];
    const lo = dateScope === 'today' ? today : dateScope === 'week' ? weekAgo : monthStart;
    return allSold.filter(s => {
      const d = (s.saleDate || '').split('T')[0];
      return d >= lo && d <= today;
    });
  }, [allSold, dateScope]);

  // ── Apply panel filters + sort to a list ──────────────────────────────────
  const applyFilters = (base: Sale[]): Sale[] => {
    const q = search.trim().toLowerCase();
    return base.filter(s => {
      if (marketplaceFilter.size > 0 && !marketplaceFilter.has(s.marketplace)) return false;
      if (supplierFilter.size > 0) {
        const sn = supplierMap[s.supplierId || ''] || s.supplierName || 'Unassigned';
        if (!supplierFilter.has(sn)) return false;
      }
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
  };
  const sortSales = (list: Sale[]): Sale[] => {
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
        case 'postage':     return s.postage ?? 0;
        case 'commission':  return s.commission ?? 0;
        default:            return '';
      }
    };
    return [...list].sort((a, b) => {
      const av = get(a); const bv = get(b);
      if (av < bv) return -1 * mult;
      if (av > bv) return  1 * mult;
      return 0;
    });
  };

  // ── Inline rows = scoped + panel-filtered + sorted ────────────────────────
  const inlineRows = useMemo(
    () => sortSales(applyFilters(scopedSold)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scopedSold, search, marketplaceFilter, supplierFilter, supplierMap, sort, units],
  );

  // ── KPIs ──────────────────────────────────────────────────────────────────
  // allSold already excludes voided sales (the soft-delete filter in the
  // useMemo above), so every counter here naturally reflects ACTIVE revenue
  // only — what actually stayed sold. Returns are surfaced as a separate
  // 'returned this period' badge sourced from `voidedSales`, counted by
  // when the return happened (not by the original sale date).
  const kpis = useMemo(() => {
    const today = todayStr();
    const monthStart = (() => {
      const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
    })();
    let todayCount = 0, todayRevenue = 0, todayGP = 0;
    let monthCount = 0, monthRevenue = 0, monthGP = 0;
    let allCount = 0, allGP = 0;
    let lossCount = 0;
    let gpPctSum = 0;
    for (const s of allSold) {
      allCount++;
      allGP += s.grossProfit ?? 0;
      gpPctSum += s.gpPercent ?? 0;
      if ((s.grossProfit ?? 0) < 0) lossCount++;
      const d = (s.saleDate || '').split('T')[0];
      if (d === today) { todayCount++; todayRevenue += s.salePrice ?? 0; todayGP += s.grossProfit ?? 0; }
      if (d >= monthStart && d <= today) { monthCount++; monthRevenue += s.salePrice ?? 0; monthGP += s.grossProfit ?? 0; }
    }
    // Return chips count EVENTS — every return processed adds one, even if
    // the same physical unit was returned twice. A unit cycled through
    // sold → returned → re-sold → returned reads as 2 sales (both count in
    // sold-today, both legitimately earned then unearned revenue) AND 2
    // returns processed. Reflects the operator's actual workload, not a
    // deduped unit-level snapshot (the Returns page already shows that).
    let todayReturned = 0, monthReturned = 0, allReturned = 0;
    for (const v of voidedSales) {
      allReturned++;
      const d = v.voidedAt.split('T')[0];
      if (d === today) todayReturned++;
      if (d >= monthStart && d <= today) monthReturned++;
    }
    return {
      todayCount, todayRevenue, todayGP, todayReturned,
      monthCount, monthRevenue, monthGP, monthReturned,
      allCount, allGP, allReturned, lossCount,
      avgGpPct: allCount > 0 ? gpPctSum / allCount : 0,
      awaitingImei: awaitingImei.length,
    };
  }, [allSold, voidedSales, awaitingImei]);

  // ── Filter chip options ───────────────────────────────────────────────────
  const supplierOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of allSold) {
      const sn = supplierMap[s.supplierId || ''] || s.supplierName || 'Unassigned';
      set.add(sn);
    }
    return Array.from(set).sort();
  }, [allSold, supplierMap]);

  // ── Overlay rows when a KPI tile is opened ────────────────────────────────
  const overlayRows = useMemo<Sale[]>(() => {
    if (!overlay) return [];
    const today = todayStr();
    const monthStart = (() => {
      const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
    })();
    let base: Sale[];
    switch (overlay) {
      case 'today':     base = allSold.filter(s => (s.saleDate || '').startsWith(today)); break;
      case 'month':     base = allSold.filter(s => (s.saleDate || '') >= monthStart && (s.saleDate || '') <= today); break;
      case 'all':       base = allSold; break;
      case 'gpPct':     base = allSold; break; // sorted by GP% via gpSortOverride below
      case 'awaiting':  base = []; break; // Awaiting IMEI surfaces units, not sales
      default:          base = [];
    }
    // Avg GP% overlay always opens with rows sorted GP% desc — best/worst
    // performers surface immediately. User can still re-sort by clicking a
    // column header inside the overlay (gpSortOverride is one-shot per open).
    const sorted = sortSales(applyFilters(base));
    if (overlay === 'gpPct') {
      return [...sorted].sort((a, b) => (b.gpPercent ?? 0) - (a.gpPercent ?? 0));
    }
    return sorted;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlay, allSold, search, marketplaceFilter, supplierFilter, supplierMap, sort, units]);

  // ── Sales Report — multi-sheet xlsx mirroring the master file ─────────────
  // Sheet 1: ALL  → 22-column unified flat view (buy schema + sale fields).
  // Sheets 2-5:    AMAZON / BM / EBAY / ONBUY, each in the operator's
  //                exact master-file shape (headers + cell-level Excel
  //                formulas via excelFormulaFor). Four platforms only per
  //                ops convention "we sell in 4 platforms only".
  // Voided sales are excluded — they don't represent realised revenue and
  // the void path keeps the original Sale doc for audit only.
  const handleSalesReport = () => {
    const active = sales.filter(s => !s.voidedAt);
    void downloadSalesWorkbook({ sales: active, units, supplierMap });
  };

  // ── Inline cell save (re-recompute GP/comm/postage in the same patch) ─────
  const saveCell = async (s: Sale, field: string, value: any) => {
    const patch: Record<string, any> = { [field]: value };
    if (field === 'salePrice' || field === 'buyPrice' || field === 'marketplace' || field === 'postage') {
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
    try { await dbService.update('sales', s.id, patch); } catch (err) { console.error(err); }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* ── Header card: action row + KPI tiles ───────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm">
        <div className="flex items-center gap-2 flex-wrap justify-end mb-4">
          <button
            onClick={() => setPickerOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 text-white text-[10px] font-bold uppercase tracking-widest hover:bg-slate-700 transition-all"
          >
            <Plus size={12} /> Record Sale
          </button>
          <button
            onClick={() => setShowSchemaHelp(s => !s)}
            title="Sell schema reference"
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all border ${
              showSchemaHelp ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
            }`}
          >
            <Info size={12} /> Schema
          </button>
          <button
            onClick={handleSalesReport}
            title="Download a unified Sales Report (buy schema + sale fields, one row per non-voided sale)"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 text-white text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-700 transition-all"
          >
            <FileSpreadsheet size={12} /> Sales Report
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {/* Each Sold tile shows only the active (non-voided) count as the
              headline — returned sales never inflate revenue / GP. The
              'returned this period' chip below is informational only. */}
          <BigKpiTile
            label="Sold Today"
            value={kpis.todayCount}
            sub={fmtGBP(kpis.todayRevenue, 0)}
            footer={fmtGBP(kpis.todayGP, 0) + ' GP'}
            returnChip={kpis.todayReturned > 0 ? `↻ ${kpis.todayReturned} ${kpis.todayReturned === 1 ? 'return' : 'returns'} processed today` : undefined}
            tone="emerald"
            onClick={() => setOverlay('today')}
          />
          <BigKpiTile
            label="This Month"
            value={kpis.monthCount}
            sub={fmtGBP(kpis.monthRevenue, 0)}
            footer={fmtGBP(kpis.monthGP, 0) + ' GP'}
            returnChip={kpis.monthReturned > 0 ? `↻ ${kpis.monthReturned} ${kpis.monthReturned === 1 ? 'return' : 'returns'} processed this month` : undefined}
            tone="blue"
            onClick={() => setOverlay('month')}
          />
          <BigKpiTile
            label="All-time Sold"
            value={kpis.allCount}
            sub={fmtGBP(kpis.allGP, 0) + ' GP'}
            footer={kpis.lossCount > 0 ? `${kpis.lossCount} loss-making` : 'all profitable'}
            returnChip={kpis.allReturned > 0 ? `↻ ${kpis.allReturned} ${kpis.allReturned === 1 ? 'return' : 'returns'} processed lifetime` : undefined}
            tone="slate"
            onClick={() => setOverlay('all')}
          />
          <BigKpiTile
            label="Avg GP %"
            value={`${kpis.avgGpPct.toFixed(1)}%`}
            sub={kpis.avgGpPct >= 20 ? 'healthy' : kpis.avgGpPct >= 10 ? 'fair' : 'thin'}
            footer={kpis.allReturned > 0 ? 'voided sales excluded' : undefined}
            tone={kpis.avgGpPct >= 20 ? 'emerald' : kpis.avgGpPct >= 10 ? 'amber' : 'rose'}
            onClick={() => setOverlay('gpPct')}
          />
          <BigKpiTile
            label="Awaiting IMEI"
            value={kpis.awaitingImei}
            sub="SHS dispatched · backfill below"
            tone="amber"
            onClick={() => setOverlay('awaiting')}
          />
        </div>
      </div>

      {/* ── Sell Intelligence panel — Hot This Week / Top Earners / etc ─── */}
      <IntelligencePanel units={units} sales={sales} mode="sell" />

      {/* ── Periodic table — same component the dashboard uses, scoped to
          live inventory. First word of every model is treated as the brand
          (Apple / Samsung / Acme), middle words as the model name, the
          trailing GB / TB token as storage. */}
      <PeriodicInventory units={units} />

      {/* ── Awaiting IMEI pinned section ─────────────────────────────────── */}
      {awaitingImei.length > 0 && (
        <AwaitingImeiSection
          units={awaitingImei}
          supplierMap={supplierMap}
          onBackfill={u => setEnterImeiUnit(u)}
        />
      )}

      {/* ── Schema help card ──────────────────────────────────────────────── */}
      <AnimatePresence>
        {showSchemaHelp && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <SchemaHelpCard onClose={() => setShowSchemaHelp(false)} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Filter panel ──────────────────────────────────────────────────── */}
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
                ${marketplaceFilter.size + supplierFilter.size > 0
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-200 hover:border-slate-400'}`}
            >
              <Filter size={12} /> Filters
              {(marketplaceFilter.size + supplierFilter.size) > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded-full bg-white/20 text-[9px]">
                  {marketplaceFilter.size + supplierFilter.size}
                </span>
              )}
            </button>
          </div>

          {/* Date scope pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            {([
              ['today', 'Today',      kpis.todayCount],
              ['week',  'Last 7d',    allSold.filter(s => (s.saleDate || '').split('T')[0] >= new Date(Date.now() - 7 * 86_400_000).toISOString().split('T')[0]).length],
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
            {(marketplaceFilter.size + supplierFilter.size > 0 || search) && (
              <button
                onClick={() => { setMarketplaceFilter(new Set()); setSupplierFilter(new Set()); setSearch(''); }}
                className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest text-slate-500 hover:text-rose-600 transition-all flex-shrink-0"
              >
                <X size={11} /> Reset
              </button>
            )}
          </div>

          {/* Filter drawer — marketplace + supplier */}
          <AnimatePresence>
            {showFilterDrawer && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 pb-1 border-t border-slate-100">
                  <FilterChipsGroup
                    label="Platform"
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
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="px-4 py-1.5 border-t border-slate-100 bg-slate-50/50 text-[9px] font-mono uppercase tracking-widest text-slate-500 flex items-center justify-between">
          <span>
            Showing <span className="text-slate-900 font-bold">{inlineRows.length.toLocaleString()}</span> of {allSold.length.toLocaleString()} sales
          </span>
          <span className="hidden sm:inline">
            GP: <span className={`font-bold ${inlineRows.reduce((s, x) => s + (x.grossProfit ?? 0), 0) >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
              {fmtGBP(inlineRows.reduce((s, x) => s + (x.grossProfit ?? 0), 0), 0)}
            </span>
          </span>
        </div>
      </div>

      {/* ── Always-on inline Excel sheet ──────────────────────────────────── */}
      <InlineSheet
        rows={inlineRows}
        sort={sort}
        onSort={setSort}
        supplierMap={supplierMap}
        units={units}
        region={region}
        onSaveCell={saveCell}
      />

      {/* ── KPI overlay modal ─────────────────────────────────────────────── */}
      <AnimatePresence>
        {overlay && (
          <SellExcelOverlay
            title={titleFor(overlay)}
            rows={overlay === 'awaiting' ? [] : overlayRows}
            awaitingUnits={overlay === 'awaiting' ? awaitingImei : []}
            sort={sort}
            onSort={setSort}
            supplierMap={supplierMap}
            units={units}
            region={region}
            onClose={() => setOverlay(null)}
            onSaveCell={saveCell}
            onBackfillImei={u => { setOverlay(null); setEnterImeiUnit(u); }}
          />
        )}
      </AnimatePresence>

      {/* ── Modals ────────────────────────────────────────────────────────── */}
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
            onPick={(u, isSHS) => { setPickerOpen(false); setSellOrderUnit(u); setSellOrderIsSHS(isSHS); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ── KPI tile ─────────────────────────────────────────────────────────────────
function BigKpiTile({
  label, value, sub, footer, returnChip, tone, onClick,
}: {
  label: string;
  value: string | number;
  sub?: string;
  footer?: string;
  /** Optional rose-toned chip rendered above the sub line. Used on the
   *  Sold KPIs to surface 'X returned this period' without inflating the
   *  headline number (returned sales = no sale = excluded from value). */
  returnChip?: string;
  tone: 'emerald' | 'blue' | 'amber' | 'slate' | 'rose';
  onClick?: () => void;
}) {
  const tones: Record<string, string> = {
    emerald: 'bg-gradient-to-br from-emerald-50 to-emerald-100/50 border-emerald-200 text-emerald-800 hover:from-emerald-100 hover:to-emerald-100',
    blue:    'bg-gradient-to-br from-blue-50 to-blue-100/50 border-blue-200 text-blue-800 hover:from-blue-100 hover:to-blue-100',
    amber:   'bg-gradient-to-br from-amber-50 to-amber-100/50 border-amber-200 text-amber-800 hover:from-amber-100 hover:to-amber-100',
    slate:   'bg-gradient-to-br from-slate-50 to-slate-100/50 border-slate-200 text-slate-800 hover:from-slate-100 hover:to-slate-100',
    rose:    'bg-gradient-to-br from-rose-50 to-rose-100/50 border-rose-200 text-rose-800 hover:from-rose-100 hover:to-rose-100',
  };
  const Inner = (
    <>
      <p className="text-[10px] font-bold uppercase tracking-widest opacity-80">{label}</p>
      <p className="text-3xl font-bold tabular-nums mt-2 leading-tight">{value}</p>
      {returnChip && (
        <span className="inline-flex items-center mt-1.5 text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 border border-rose-200">
          {returnChip}
        </span>
      )}
      {sub    && <p className="text-[10px] font-mono opacity-80 mt-1">{sub}</p>}
      {footer && <p className="text-[9px]  font-mono opacity-60 mt-0.5">{footer}</p>}
    </>
  );
  if (onClick) {
    return (
      <button
        onClick={onClick}
        className={`text-left rounded-2xl border px-4 py-4 transition-all hover:shadow-sm active:scale-[0.98] cursor-pointer ${tones[tone]}`}
      >
        {Inner}
      </button>
    );
  }
  return <div className={`text-left rounded-2xl border px-4 py-4 cursor-default ${tones[tone]}`}>{Inner}</div>;
}

// ── Filter chips ─────────────────────────────────────────────────────────────
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
        ) : options.map(o => {
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
        })}
      </div>
    </div>
  );
}

// ── Inline Excel sheet (always-on) ───────────────────────────────────────────
function InlineSheet({
  rows, sort, onSort, supplierMap, units, region, onSaveCell,
}: {
  rows: Sale[];
  sort: { key: SortKey; dir: SortDir };
  onSort: (s: { key: SortKey; dir: SortDir }) => void;
  supplierMap: Record<string, string>;
  units: InventoryUnit[];
  region: 'uk' | 'india' | 'admin' | 'both';
  onSaveCell: (s: Sale, field: string, value: any) => Promise<void>;
}) {
  const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null);
  const toggleSort = (k: SortKey) => onSort({ key: k, dir: sort.key === k && sort.dir === 'desc' ? 'asc' : 'desc' });

  if (rows.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-3xl p-12 text-center text-slate-400">
        <Sparkles size={28} className="mx-auto" />
        <p className="text-[11px] font-mono uppercase tracking-widest mt-2">No sales match this filter</p>
        <p className="text-[10px] font-mono mt-1 text-slate-500">Try the date pills, or use Record Sale above</p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden">
      <div className="overflow-auto max-h-[calc(100vh-440px)] custom-scrollbar">
        <SheetTable
          rows={rows}
          supplierMap={supplierMap}
          units={units}
          region={region}
          sort={sort}
          toggleSort={toggleSort}
          editingCell={editingCell}
          setEditingCell={setEditingCell}
          onSaveCell={onSaveCell}
        />
      </div>
      <div className="px-5 py-2 border-t border-slate-100 bg-slate-50/60 text-[9px] font-mono uppercase tracking-widest text-slate-500">
        Click column headers to sort · double-click SP / Platform / Postage to edit · GP / Commission recompute live
      </div>
    </div>
  );
}

// ── KPI overlay modal ───────────────────────────────────────────────────────
function SellExcelOverlay({
  title, rows, awaitingUnits, sort, onSort, supplierMap, units, region,
  onClose, onSaveCell, onBackfillImei,
}: {
  title: string;
  rows: Sale[];
  awaitingUnits: InventoryUnit[];
  sort: { key: SortKey; dir: SortDir };
  onSort: (s: { key: SortKey; dir: SortDir }) => void;
  supplierMap: Record<string, string>;
  units: InventoryUnit[];
  region: 'uk' | 'india' | 'admin' | 'both';
  onClose: () => void;
  onSaveCell: (s: Sale, field: string, value: any) => Promise<void>;
  onBackfillImei: (u: InventoryUnit) => void;
}) {
  const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null);
  const toggleSort = (k: SortKey) => onSort({ key: k, dir: sort.key === k && sort.dir === 'desc' ? 'asc' : 'desc' });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  /** View modes:
   *    grouped  — rows collapsed by marketplace (AMAZON / BM / EBAY /
   *               ONBUY / PROJECT). Default per the client's request:
   *               sales-by-channel is the read they actually want, the
   *               1,778-row flat list is for editing. Each marketplace
   *               row expands to a top-models breakdown.
   *    detailed — original per-sale grid, kept for cell-by-cell edits. */
  const [viewMode, setViewMode] = useState<'grouped' | 'detailed'>('grouped');
  const [expandedMps, setExpandedMps] = useState<Set<string>>(new Set());
  const toggleExpand = (mp: string) => setExpandedMps(prev => {
    const next = new Set(prev);
    next.has(mp) ? next.delete(mp) : next.add(mp);
    return next;
  });

  const totals = useMemo(() => {
    const revenue = rows.reduce((s, x) => s + (x.salePrice ?? 0), 0);
    const gp      = rows.reduce((s, x) => s + (x.grossProfit ?? 0), 0);
    return { revenue, gp };
  }, [rows]);

  /** Sales rolled up per marketplace. Within each marketplace we also
   *  break down by model — the operator's most natural drill ("what
   *  sells on Amazon vs eBay?"). Models are resolved from the linked
   *  inventoryUnit when present, falling back to the SKU string so a
   *  sale doc with no IMEI match still shows up. */
  const unitById = useMemo(() => {
    const m = new Map<string, InventoryUnit>();
    for (const u of units) if (u.id) m.set(u.id, u);
    return m;
  }, [units]);

  const grouped = useMemo<MarketplaceGroup[]>(() => {
    const map = new Map<Marketplace, MarketplaceGroup>();
    for (const s of rows) {
      const mp = s.marketplace;
      let g = map.get(mp);
      if (!g) {
        g = { mp, orders: 0, units: 0, revenue: 0, gp: 0, byModel: new Map() };
        map.set(mp, g);
      }
      g.orders++;
      g.units += s.quantity || 1;
      g.revenue += s.salePrice || 0;
      g.gp += s.grossProfit || 0;
      const linked = s.unitId ? unitById.get(s.unitId) : undefined;
      const modelLabel = (linked?.model || s.sku || '—').trim() || '—';
      let row = g.byModel.get(modelLabel);
      if (!row) row = { label: modelLabel, units: 0, revenue: 0, gp: 0 };
      row.units += s.quantity || 1;
      row.revenue += s.salePrice || 0;
      row.gp += s.grossProfit || 0;
      g.byModel.set(modelLabel, row);
    }
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
  }, [rows, unitById]);

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm p-0 md:p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        exit={{ y: 30, opacity: 0 }} transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        onClick={e => e.stopPropagation()}
        className="bg-white w-full md:max-w-6xl rounded-t-3xl md:rounded-3xl shadow-2xl flex flex-col overflow-hidden"
        style={{ maxHeight: 'calc(100dvh - 24px)' }}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100 flex-shrink-0">
          <div className="min-w-0">
            <h3 className="text-sm font-bold tracking-tight truncate">{title}</h3>
            <p className="text-[10px] font-mono text-slate-400 mt-0.5">
              {(rows.length + awaitingUnits.length).toLocaleString()} {rows.length + awaitingUnits.length === 1 ? 'row' : 'rows'}
              {rows.length > 0 && (
                <> · {grouped.length} {grouped.length === 1 ? 'channel' : 'channels'} · Revenue {fmtGBP(totals.revenue, 0)} · GP <span className={totals.gp >= 0 ? 'text-emerald-700' : 'text-rose-700'}>{fmtGBP(totals.gp, 0)}</span></>
              )}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            {rows.length > 0 && awaitingUnits.length === 0 && (
              <div className="inline-flex rounded-xl bg-slate-100 p-0.5 text-[9px] font-bold uppercase tracking-widest">
                <button
                  onClick={() => setViewMode('grouped')}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg transition-all ${viewMode === 'grouped' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                  title="Group sales by marketplace"
                >
                  <Layers size={10} /> Grouped
                </button>
                <button
                  onClick={() => setViewMode('detailed')}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg transition-all ${viewMode === 'detailed' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                  title="Show one row per sale"
                >
                  <List size={10} /> Detailed
                </button>
              </div>
            )}
            <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          {awaitingUnits.length > 0 ? (
            <div className="divide-y divide-amber-100">
              {awaitingUnits.map(u => (
                <div key={u.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-amber-50/60">
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-bold text-slate-900 truncate">{u.model}</p>
                    <p className="text-[9px] text-slate-500 font-mono mt-0.5 truncate">
                      {u.colour}{u.storage ? ` · ${u.storage}` : ''} · {supplierMap[u.supplierId] || '—'} · sold {u.saleDate || '—'}
                    </p>
                  </div>
                  {u.salePrice != null && <span className="text-sm font-bold text-emerald-700">£{u.salePrice}</span>}
                  <button
                    onClick={() => onBackfillImei(u)}
                    className="flex items-center gap-1 px-3 py-1.5 bg-orange-500 text-white text-[9px] font-bold uppercase tracking-widest rounded-lg hover:bg-orange-600 transition-all"
                  >
                    <PackageCheck size={11} /> Backfill IMEI
                  </button>
                </div>
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="py-16 flex flex-col items-center gap-2 text-slate-400">
              <Sparkles size={28} />
              <p className="text-[11px] font-mono uppercase tracking-widest">No sales in this view</p>
            </div>
          ) : viewMode === 'grouped' ? (
            <ul className="divide-y divide-slate-100" style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
              {grouped.map(g => {
                const open = expandedMps.has(g.mp);
                const tone = MARKETPLACE_TONE[g.mp];
                const models = (Array.from(g.byModel.values()) as MarketplaceGroupModel[])
                  .sort((a, b) => b.revenue - a.revenue || b.units - a.units);
                return (
                  <li key={g.mp}>
                    <button
                      onClick={() => toggleExpand(g.mp)}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors"
                    >
                      <span className={`flex-shrink-0 w-5 h-5 inline-flex items-center justify-center rounded-md text-slate-400 transition-transform ${open ? 'rotate-90 text-slate-700' : ''}`}>
                        <ChevronRight size={13} />
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="flex items-center gap-2">
                          <span className={`inline-flex items-center text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded border ${tone}`}>
                            {g.mp}
                          </span>
                          <span className="text-[10px] font-mono text-slate-400 truncate">
                            {models.length} {models.length === 1 ? 'model' : 'models'}
                          </span>
                        </span>
                        <span className="block text-[9px] font-mono text-slate-500 mt-1">
                          {g.orders.toLocaleString()} {g.orders === 1 ? 'order' : 'orders'}
                          {' · '}
                          {g.units.toLocaleString()} units
                          {' · GP '}
                          <span className={g.gp >= 0 ? 'text-emerald-700 font-bold' : 'text-rose-700 font-bold'}>{fmtGBP(g.gp, 0)}</span>
                        </span>
                      </span>
                      <span className="flex-shrink-0 text-right">
                        <span className="block text-[12px] font-bold text-slate-900">{fmtGBP(g.revenue, 0)}</span>
                        <span className="block text-[8px] font-mono uppercase tracking-widest text-slate-400 mt-0.5">Revenue</span>
                      </span>
                    </button>
                    <AnimatePresence initial={false}>
                      {open && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.18 }}
                          className="overflow-hidden bg-slate-50/60"
                        >
                          <table className="w-full text-[10px]">
                            <thead className="text-[8px] font-bold uppercase tracking-widest text-slate-400">
                              <tr>
                                <th className="text-left pl-10 pr-2 py-1.5">Model · SKU</th>
                                <th className="text-right px-2 py-1.5 w-16">Units</th>
                                <th className="text-right px-2 py-1.5 w-24">Revenue</th>
                                <th className="text-right pr-4 pl-2 py-1.5 w-24">GP</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200/70">
                              {models.map(m => (
                                <tr key={m.label} className="hover:bg-white/60">
                                  <td className="pl-10 pr-2 py-1.5 truncate max-w-0">
                                    <span className="text-slate-700 truncate block" title={m.label}>{m.label}</span>
                                  </td>
                                  <td className="text-right px-2 py-1.5 font-mono text-slate-700">{m.units}</td>
                                  <td className="text-right px-2 py-1.5 font-mono text-slate-900 font-bold">{fmtGBP(m.revenue, 0)}</td>
                                  <td className={`text-right pr-4 pl-2 py-1.5 font-mono font-bold ${m.gp >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{fmtGBP(m.gp, 0)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </li>
                );
              })}
            </ul>
          ) : (
            <SheetTable
              rows={rows}
              supplierMap={supplierMap}
              units={units}
              region={region}
              sort={sort}
              toggleSort={toggleSort}
              editingCell={editingCell}
              setEditingCell={setEditingCell}
              onSaveCell={onSaveCell}
            />
          )}
        </div>

        <div className="px-5 py-2 border-t border-slate-100 bg-slate-50/60 flex-shrink-0 text-[9px] font-mono uppercase tracking-widest text-slate-500 flex items-center justify-between">
          <span>Double-click cells to edit · ESC to close</span>
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 text-[10px] font-bold uppercase tracking-widest hover:bg-white"
          >Close</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Sheet table (shared by InlineSheet + SellExcelOverlay) ──────────────────
function SheetTable({
  rows, supplierMap, units, region, sort, toggleSort,
  editingCell, setEditingCell, onSaveCell,
}: {
  rows: Sale[];
  supplierMap: Record<string, string>;
  units: InventoryUnit[];
  region: 'uk' | 'india' | 'admin' | 'both';
  sort: { key: SortKey; dir: SortDir };
  toggleSort: (k: SortKey) => void;
  editingCell: { id: string; field: string } | null;
  setEditingCell: (c: { id: string; field: string } | null) => void;
  onSaveCell: (s: Sale, field: string, value: any) => Promise<void>;
}) {
  return (
    <table className="w-full text-[11px] border-separate border-spacing-0" style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
      <thead>
        <tr className="text-[9px] font-bold uppercase tracking-widest text-slate-500 bg-slate-50">
          <Th k="saleDate"   sort={sort} onSort={toggleSort} width="105px" sticky leftPx={0}>Sell Date</Th>
          <Th k=""           sort={sort} onSort={undefined}  width="160px">IMEI</Th>
          <Th k="model"      sort={sort} onSort={toggleSort} width="240px">Model</Th>
          <Th k="storage"    sort={sort} onSort={toggleSort} width="80px">Storage</Th>
          <Th k="colour"     sort={sort} onSort={toggleSort} width="110px">Colour</Th>
          <Th k="supplier"   sort={sort} onSort={toggleSort} width="120px">Supplier</Th>
          <Th k="buyPrice"   sort={sort} onSort={toggleSort} width="70px"  align="right">BP</Th>
          <Th k="salePrice"  sort={sort} onSort={toggleSort} width="75px"  align="right">SP</Th>
          <Th k="marketplace"sort={sort} onSort={toggleSort} width="105px">Platform</Th>
          <Th k="postage"    sort={sort} onSort={toggleSort} width="75px"  align="right">Postage</Th>
          <Th k="commission" sort={sort} onSort={toggleSort} width="80px"  align="right">Comm.</Th>
          <Th k="grossProfit"sort={sort} onSort={toggleSort} width="80px"  align="right">GP</Th>
          <Th k="gpPercent"  sort={sort} onSort={toggleSort} width="70px"  align="right">GP %</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((s, idx) => {
          const u = (s.unitId && units.find(x => x.id === s.unitId)) || undefined;
          const supplierName = supplierMap[s.supplierId || ''] || s.supplierName || '—';
          const isAlt = idx % 2 === 1;
          // Flagged sales (red rows from the operator's source workbook) win
          // over the zebra stripe — the operator's signal is what matters.
          const rowBg = s.flagged
            ? 'bg-rose-50 hover:bg-rose-100/70'
            : isAlt ? 'bg-slate-50/40 hover:bg-slate-100/60' : 'bg-white hover:bg-slate-50';
          const gp = s.grossProfit ?? 0;
          const gpTone = gp > 0 ? 'text-emerald-700' : gp < 0 ? 'text-rose-700' : 'text-slate-600';
          const mpTone = MARKETPLACE_TONE[s.marketplace] || 'bg-slate-100 text-slate-600 border-slate-200';
          const dateTone = s.flagged ? 'text-rose-700 font-semibold' : 'text-slate-700';

          return (
            <tr
              key={s.id}
              className={`${rowBg} transition-colors group`}
              title={s.flagged ? 'Flagged on the source Sales Report (red row)' : undefined}
            >
              <Td sticky leftPx={0} className={`${rowBg} border-r border-slate-200`}>
                <span className={dateTone}>{fmtDateForUser(s.saleDate || '', region) || s.saleDate || '—'}</span>
              </Td>
              <Td>
                {s.imei
                  ? <CopyImei imei={s.imei} truncate={15} />
                  : <span className="inline-flex items-center gap-1 text-amber-600 text-[9px] font-mono">
                      <AlertCircle size={9} /> awaiting IMEI
                    </span>
                }
              </Td>
              <Td>
                <span className="font-bold text-slate-900 truncate max-w-[210px]" title={u?.model || ''}>
                  {u?.model || s.sku || '—'}
                </span>
              </Td>
              <Td><span className="text-slate-600">{u?.storage || '—'}</span></Td>
              <Td><span className="text-slate-600 truncate">{u?.colour || '—'}</span></Td>
              <Td><span className="text-slate-700 truncate" title={supplierName}>{supplierName}</span></Td>
              <Td align="right"><span className="text-slate-700">£{(s.buyPrice ?? 0).toFixed(0)}</span></Td>
              <Td align="right">
                <InlineEditableCell
                  editing={editingCell?.id === s.id && editingCell?.field === 'salePrice'}
                  onActivate={() => setEditingCell({ id: s.id, field: 'salePrice' })}
                  onCommit={async v => { await onSaveCell(s, 'salePrice', Number(v) || 0); setEditingCell(null); }}
                  onCancel={() => setEditingCell(null)}
                  initialValue={String(s.salePrice ?? 0)}
                  display={<span className="font-bold text-slate-900">£{(s.salePrice ?? 0).toFixed(0)}</span>}
                  align="right" type="number"
                />
              </Td>
              <Td>
                <InlineEditableSelect
                  editing={editingCell?.id === s.id && editingCell?.field === 'marketplace'}
                  onActivate={() => setEditingCell({ id: s.id, field: 'marketplace' })}
                  onCommit={async v => { await onSaveCell(s, 'marketplace', v); setEditingCell(null); }}
                  onCancel={() => setEditingCell(null)}
                  value={s.marketplace}
                  options={MARKETPLACES as unknown as string[]}
                  display={
                    <span className={`inline-flex items-center text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded border ${mpTone}`}>
                      {s.marketplace}
                    </span>
                  }
                />
              </Td>
              <Td align="right">
                <InlineEditableCell
                  editing={editingCell?.id === s.id && editingCell?.field === 'postage'}
                  onActivate={() => setEditingCell({ id: s.id, field: 'postage' })}
                  onCommit={async v => { await onSaveCell(s, 'postage', Number(v) || 0); setEditingCell(null); }}
                  onCancel={() => setEditingCell(null)}
                  initialValue={String(s.postage ?? 0)}
                  display={<span className="text-slate-500">{fmtGBP(s.postage ?? 0)}</span>}
                  align="right" type="number"
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
            </tr>
          );
        })}
      </tbody>
    </table>
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
          <p className="text-[9px] font-mono text-orange-700/70 mt-0.5">Sale recorded · IMEI to be confirmed from supplier invoice</p>
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

// ── Sell unit picker (Record Sale entry-point) ──────────────────────────────
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
      <motion.div
        initial={{ scale: 0.97, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-3xl w-full max-w-lg shadow-2xl flex flex-col"
        style={{ maxHeight: 'calc(100dvh - 32px)' }}
      >
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
              autoFocus type="text" value={search} onChange={e => setSearch(e.target.value)}
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

// ── Schema help card ────────────────────────────────────────────────────────
function SchemaHelpCard({ onClose }: { onClose: () => void }) {
  const fields: Array<{ col: string; field: string; note: string; tone: 'derived' | 'edit' | 'core' }> = [
    { col: '1',  field: 'Sell Date',  note: 'Set on Record Sale; editable in row',                                   tone: 'core'    },
    { col: '2',  field: 'IMEI',       note: 'From the unit being sold (SHS units may show "awaiting" until backfill)', tone: 'core' },
    { col: '3',  field: 'Model',      note: 'Read-only — from the linked inventory unit',                            tone: 'core'    },
    { col: '4',  field: 'Storage',    note: 'Read-only — from the linked unit',                                      tone: 'core'    },
    { col: '5',  field: 'Colour',     note: 'Read-only — from the linked unit',                                      tone: 'core'    },
    { col: '6',  field: 'Supplier',   note: 'Read-only — from the linked unit',                                      tone: 'core'    },
    { col: '7',  field: 'BP',         note: 'Buy price snapshot at time of sale',                                    tone: 'core'    },
    { col: '8',  field: 'SP',         note: 'Sale price · double-click cell to edit',                                tone: 'edit'    },
    { col: '9',  field: 'Platform',   note: 'AMAZON / BM / EBAY / ONBUY · double-click to change',                   tone: 'edit'    },
    { col: '10', field: 'Postage',    note: 'Override per row · default from platform fee schedule',                 tone: 'edit'    },
    { col: '11', field: 'Commission', note: 'Auto-computed from platform fee table on every SP/Platform change',     tone: 'derived' },
    { col: '12', field: 'GP',         note: 'Gross Profit = SP − BP − Commission − Postage − Marginal Tax',          tone: 'derived' },
    { col: '13', field: 'GP %',       note: 'GP ÷ SP × 100',                                                          tone: 'derived' },
  ];
  const toneFor = (t: 'derived' | 'edit' | 'core') =>
    t === 'edit'    ? { dot: 'bg-emerald-500', text: 'text-emerald-700', bg: 'bg-emerald-50', label: 'Inline edit' }
    : t === 'derived'? { dot: 'bg-blue-500',    text: 'text-blue-700',    bg: 'bg-blue-50',    label: 'Auto-computed' }
    :                  { dot: 'bg-slate-400',   text: 'text-slate-600',   bg: 'bg-slate-50',   label: 'From unit' };

  return (
    <div className="bg-indigo-50/40 border border-indigo-100 rounded-3xl p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-indigo-900 flex items-center gap-2">
            <Info size={14} /> Sell Schema · 13 columns
          </p>
          <p className="text-[10px] font-mono text-indigo-700/70 mt-1">
            Editable: SP / Platform / Postage. Commission / GP / GP% recompute via the marketplace fee table on every edit.
          </p>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-indigo-100 text-indigo-600 transition-all">
          <X size={14} />
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {fields.map(f => {
          const t = toneFor(f.tone);
          return (
            <div key={f.field} className="flex items-start gap-3 bg-white border border-indigo-100 rounded-xl px-3 py-2.5">
              <span className="text-[10px] font-mono text-indigo-400 w-5 text-center flex-shrink-0">{f.col}</span>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-bold text-slate-900 truncate">{f.field}</p>
                <p className="text-[10px] text-slate-500 font-mono mt-0.5 leading-snug">{f.note}</p>
              </div>
              <span className={`inline-flex items-center gap-1 text-[8px] font-bold uppercase tracking-widest ${t.text} ${t.bg} px-1.5 py-0.5 rounded border border-current/10 flex-shrink-0`}>
                <span className={`w-1.5 h-1.5 rounded-full ${t.dot}`} /> {t.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Table cells ──────────────────────────────────────────────────────────────
function Th({
  children, k, sort, onSort, sticky, leftPx, width, align,
}: {
  children: React.ReactNode;
  k?: SortKey | '';
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
        <button onClick={() => onSort(k as SortKey)} className="inline-flex items-center gap-1 hover:text-slate-900 transition-colors">
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
  const inputRef = useRef<HTMLInputElement>(null);
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
  editing, onActivate, onCommit, onCancel, value, options, display, formatLabel,
}: {
  editing: boolean;
  onActivate: () => void;
  onCommit: (v: string) => Promise<void>;
  onCancel: () => void;
  value: string;
  options: string[];
  display: React.ReactNode;
  formatLabel?: (v: string) => string;
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
      {options.map(o => <option key={o} value={o}>{formatLabel ? formatLabel(o) : (o || '—')}</option>)}
    </select>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function titleFor(kpi: KpiId): string {
  switch (kpi) {
    case 'today':    return 'Sold Today';
    case 'month':    return 'Sold This Month';
    case 'all':      return 'All Sales';
    case 'gpPct':    return 'Avg GP % · ranked by margin';
    case 'awaiting': return 'Awaiting IMEI';
  }
}

