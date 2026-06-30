import React, { useState, useEffect, useMemo } from 'react';
import { useInventoryStore } from '../lib/inventoryStore';
import {
  Bell, CheckCircle2, Star, Truck,
  ChevronDown, Clock, Search, ShoppingBag,
  AlertCircle, Package, RefreshCw, ChevronUp,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { dbService } from '../lib/dbService';
import {
  InventoryUnit, OperationalFlag, ActiveListing,
  Sale, Marketplace, MARKETPLACES,
} from '../types';
import { notificationService, Notification } from '../lib/notificationService';
import { marketplaceFromListingSite } from '../lib/platforms';
import { recomputeSale } from '../lib/recomputeSale';
import { fmtDateForUser, useUserRegion } from '../lib/userLocale';
import AddSoldUnitModal from './AddSoldUnitModal';
import EditableCell from './EditableCell';
import { useIsAdmin } from '../lib/useIsAdmin';

const FLAG_CONFIG: Record<OperationalFlag, { label: string; icon: any; style: string; action: string }> = {
  top10: {
    label: 'Top 10 Focus',
    icon: Star,
    style: 'bg-yellow-50 text-yellow-800 border-yellow-200',
    action: 'Prioritise on eBay, Amazon, OnBuy, Backmarket — keep qty at 1',
  },
  supplierHasStock: {
    label: 'Supplier Has Stock',
    icon: Truck,
    style: 'bg-green-50 text-green-800 border-green-200',
    action: 'Supplier holding — list as 1 once confirmed in-hand',
  },
  stockSold: {
    label: 'Stock Sold',
    icon: CheckCircle2,
    style: 'bg-gray-50 text-gray-500 border-gray-200',
    action: 'Set qty to 0 on eBay, Amazon, OnBuy, Backmarket immediately',
  },
};

// ----------------------------------------------------------------------------
// Sold-history grid: column definitions + sortable keys
// ----------------------------------------------------------------------------

type SortKey =
  | 'saleDate' | 'marketplace' | 'orderNumber' | 'model' | 'sku' | 'imei' | 'supplierName'
  | 'quantity' | 'buyPrice' | 'salePrice'
  | 'paymentMode' | 'postage' | 'commission' | 'grossProfit' | 'gpPercent'
  | 'comments';

interface ColDef {
  key: SortKey;
  label: string;
  width: number;
  align?: 'left' | 'right' | 'center';
}

const COLUMNS: ColDef[] = [
  { key: 'saleDate',     label: 'Date',         width: 110 },
  { key: 'marketplace',  label: 'Marketplace',  width: 110 },
  { key: 'orderNumber',  label: 'Order Number', width: 160 },
  { key: 'model',        label: 'Model',        width: 180 },
  { key: 'sku',          label: 'SKU',          width: 140 },
  { key: 'imei',         label: 'IMEI',         width: 160 },
  { key: 'supplierName', label: 'Supplier',     width: 130 },
  { key: 'quantity',     label: 'Qty',          width: 50,  align: 'right' },
  { key: 'buyPrice',     label: 'BP',           width: 80,  align: 'right' },
  { key: 'salePrice',    label: 'SP',           width: 80,  align: 'right' },
  { key: 'paymentMode',  label: 'Payment Mode', width: 110 },
  { key: 'postage',      label: 'Postage',      width: 80,  align: 'right' },
  { key: 'commission',   label: 'Commission',   width: 100, align: 'right' },
  { key: 'grossProfit',  label: 'GP',           width: 90,  align: 'right' },
  { key: 'gpPercent',    label: 'GP%',          width: 70,  align: 'right' },
  { key: 'comments',     label: 'Notes',        width: 220 },
];

const MARKETPLACE_BADGE: Record<Marketplace, string> = {
  AMAZON:  'bg-amber-100  text-amber-800  border-amber-200',
  BM:      'bg-emerald-100 text-emerald-800 border-emerald-200',
  EBAY:    'bg-blue-100   text-blue-800   border-blue-200',
  ONBUY:   'bg-purple-100 text-purple-800 border-purple-200',
};

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function formatDateDdMmmYyyy(iso?: string): string {
  if (!iso) return '';
  // Robust against `yyyy-mm-dd` or full ISO timestamps; avoid TZ drift by
  // splitting on T then on -.
  const datePart = iso.split('T')[0];
  const [y, m, d] = datePart.split('-');
  if (!y || !m || !d) return iso;
  const mi = Math.max(0, Math.min(11, parseInt(m, 10) - 1));
  return `${d.padStart(2,'0')}-${MONTHS[mi]}-${y}`;
}

function fmtGBP(n: number | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  return `£${n.toFixed(2)}`;
}

/** Map a legacy in-app sold inventoryUnit into a Sale-shaped row so the
 *  unified grid can render it alongside imported sales. */
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
    // Derived fields are placeholders — recomputeSale() overwrites them.
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

export default function Sales() {
  const { units, sales }                    = useInventoryStore();
  const region                              = useUserRegion();
  const isAdminUser                         = useIsAdmin();
  const [activeListings, setActiveListings] = useState<ActiveListing[]>([]);
  const [recentNotifications, setRecentNotifications] = useState<Notification[]>([]);
  const [addSoldUnitSale, setAddSoldUnitSale] = useState<Sale | null>(null);

  useEffect(() => {
    const unsub3 = dbService.subscribeToCollection('activeListings', setActiveListings);
    const unsub4 = notificationService.subscribe(setRecentNotifications);
    return () => { unsub3(); unsub4(); };
  }, []);

  const [isTodayStockOpen,    setIsTodayStockOpen]    = useState(true);
  const [isPlatformListOpen,  setIsPlatformListOpen]  = useState(true);
  const [isSoldHistoryOpen,   setIsSoldHistoryOpen]   = useState(true);

  // ────────────────────────────────────────────────────────────────────────
  // Sold-history grid state: search, filter, sort, scope
  // ────────────────────────────────────────────────────────────────────────
  const [soldSearch, setSoldSearch]   = useState('');
  const [marketFilter, setMarketFilter] = useState<'ALL' | Marketplace>('ALL');
  const [sortKey, setSortKey]   = useState<SortKey>('saleDate');
  const [sortDir, setSortDir]   = useState<'asc' | 'desc'>('desc');

  // Scope tabs: today / range (default last 30d) / all-time
  type Scope = 'today' | 'range' | 'all';
  const [scope, setScope] = useState<Scope>('range');

  // Date-range picker — default = last 30 days
  const today = new Date().toISOString().split('T')[0];
  const thirtyDaysAgoISO = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  }, []);
  const [rangeFrom, setRangeFrom] = useState<string>(thirtyDaysAgoISO);
  const [rangeTo,   setRangeTo]   = useState<string>(today);

  // ────────────────────────────────────────────────────────────────────────
  // Source: imported sales + legacy in-app sold units, recomputed live
  // ────────────────────────────────────────────────────────────────────────
  const legacyInAppSales = useMemo<Sale[]>(() => {
    return units
      .filter(u => u.status === 'sold' && (u.salePrice != null || u.saleDate))
      .map(inventoryUnitToSale);
  }, [units]);

  /** Master list: imported sales (1,450) + legacy in-app sold units,
   *  every row passed through recomputeSale() so commission/GP/GP% are
   *  always live with current MARKETPLACE_FEES. */
  const allSales = useMemo<Sale[]>(() => {
    const merged: Sale[] = [];
    const seen = new Set<string>();
    for (const s of sales) {
      merged.push(recomputeSale(s));
      seen.add(s.id);
    }
    for (const s of legacyInAppSales) {
      // Don't double-count if an imported sale and a legacy unit share an id
      if (seen.has(s.id)) continue;
      merged.push(recomputeSale(s));
    }
    return merged;
  }, [sales, legacyInAppSales]);

  // ────────────────────────────────────────────────────────────────────────
  // Apply scope → marketplace filter → search → sort
  // ────────────────────────────────────────────────────────────────────────
  const scopedSales = useMemo<Sale[]>(() => {
    if (scope === 'today') {
      return allSales.filter(s => (s.saleDate || '').split('T')[0] === today);
    }
    if (scope === 'all') return allSales;
    // range
    return allSales.filter(s => {
      const d = (s.saleDate || '').split('T')[0];
      if (!d) return false;
      return d >= rangeFrom && d <= rangeTo;
    });
  }, [allSales, scope, today, rangeFrom, rangeTo]);

  const filteredSales = useMemo<Sale[]>(() => {
    let rows = scopedSales;
    if (marketFilter !== 'ALL') {
      rows = rows.filter(s => s.marketplace === marketFilter);
    }
    const q = soldSearch.trim().toLowerCase();
    if (q) {
      rows = rows.filter(s => {
        const u = s.unitId ? units.find(x => x.id === s.unitId) : undefined;
        const model = (u?.model || s.model || '').toLowerCase();
        return (
          (s.orderNumber  || '').toLowerCase().includes(q) ||
          (s.imei         || '').toLowerCase().includes(q) ||
          (s.sku          || '').toLowerCase().includes(q) ||
          (s.supplierName || '').toLowerCase().includes(q) ||
          model.includes(q)
        );
      });
    }
    return rows;
  }, [scopedSales, marketFilter, soldSearch, units]);

  const sortedSales = useMemo<Sale[]>(() => {
    const rows = [...filteredSales];
    const dir = sortDir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      const av = (a as any)[sortKey];
      const bv = (b as any)[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return  1;   // nulls last
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
    return rows;
  }, [filteredSales, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(k);
      // Numeric / date columns default DESC; text columns default ASC.
      const numericOrDate: SortKey[] = [
        'saleDate', 'quantity', 'buyPrice', 'salePrice',
        'postage', 'commission', 'grossProfit', 'gpPercent',
      ];
      setSortDir(numericOrDate.includes(k) ? 'desc' : 'asc');
    }
  };

  // ────────────────────────────────────────────────────────────────────────
  // KPI footer aggregates
  // ────────────────────────────────────────────────────────────────────────
  const kpi = useMemo(() => {
    const rows = sortedSales;
    const sumSP = rows.reduce((s, r) => s + (r.salePrice  || 0), 0);
    const sumGP = rows.reduce((s, r) => s + (r.grossProfit || 0), 0);
    const avgGpPct = rows.length
      ? rows.reduce((s, r) => s + (r.gpPercent || 0), 0) / rows.length
      : 0;
    return {
      count: rows.length,
      sumSP,
      sumGP,
      avgGpPct,
    };
  }, [sortedSales]);

  // Counts for the "Sold Today" KPI card (driven by the unified `allSales`,
  // so it includes both imported sales and in-app sales).
  const soldTodayCount = useMemo(
    () => allSales.filter(s => (s.saleDate || '').split('T')[0] === today).length,
    [allSales, today]
  );

  // ────────────────────────────────────────────────────────────────────────
  // Operational sections (unchanged): today's intake, platform list, recon
  // ────────────────────────────────────────────────────────────────────────
  const todayUnits = useMemo(() =>
    units.filter(u => u.dateIn === today),
    [units, today]
  );

  const platformList = useMemo(() => {
    const map = new Map<string, { model: string; brand: string; category: string; count: number; flags: OperationalFlag[]; units: InventoryUnit[]; listingSites: string[] }>();
    for (const u of units.filter(u => u.status === 'available')) {
      if (!map.has(u.model)) {
        map.set(u.model, { model: u.model, brand: u.brand, category: u.category, count: 0, flags: [], units: [], listingSites: [] });
      }
      const entry = map.get(u.model)!;
      entry.count++;
      entry.units.push(u);

      if (u.listingSites) {
        for (const site of u.listingSites) {
          if (!entry.listingSites.includes(site)) entry.listingSites.push(site);
        }
      }

      for (const f of u.flags) {
        if (!entry.flags.includes(f)) entry.flags.push(f);
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      const aTop = a.flags.includes('top10') ? 1 : 0;
      const bTop = b.flags.includes('top10') ? 1 : 0;
      return bTop - aTop || b.count - a.count;
    });
  }, [units]);

  const reconciliation = useMemo(() => {
    const physicalStock = new Map<string, number>();
    for (const u of units.filter(u => u.status === 'available')) {
      physicalStock.set(u.model, (physicalStock.get(u.model) || 0) + 1);
    }

    const listedStock = new Map<string, { total: number; platforms: string[] }>();
    for (const l of activeListings) {
      const entry = listedStock.get(l.model) || { total: 0, platforms: [] };
      entry.total += l.quantity;
      entry.platforms.push(l.platform);
      listedStock.set(l.model, entry);
    }

    const results: {
      model: string;
      physical: number;
      listed: number;
      platforms: string[];
      status: 'ok' | 'under' | 'over' | 'none';
      message: string;
    }[] = [];

    const allModels = new Set([...physicalStock.keys(), ...listedStock.keys()]);

    for (const model of allModels) {
      const physical = physicalStock.get(model) || 0;
      const listedObj = listedStock.get(model) || { total: 0, platforms: [] };
      const listed = listedObj.total;

      let status: 'ok' | 'under' | 'over' | 'none' = 'ok';
      let message = 'Listing synced';

      if (listed === 0 && physical > 0) {
        status = 'none';
        message = 'Not listed anywhere';
      } else if (listed < physical) {
        status = 'under';
        message = `${physical - listed} units waiting to be listed`;
      } else if (listed > physical) {
        status = 'over';
        message = 'OVERSELL RISK: Listing qty > Stock';
      }

      results.push({
        model,
        physical,
        listed,
        platforms: listedObj.platforms,
        status,
        message
      });
    }

    return results.sort((a, b) => {
      const priority = { over: 0, none: 1, under: 2, ok: 3 };
      return priority[a.status] - priority[b.status] || b.physical - a.physical;
    });
  }, [units, activeListings]);

  const handleUpdateListing = async (model: string, platform: string, quantity: number) => {
    if (!isAdminUser) return;       // UI gate — non-admin can't change listings
    const listingId = `list_${model.replace(/\s+/g, '_').toLowerCase()}_${platform.toLowerCase()}`;
    if (quantity <= 0) {
      await dbService.delete('activeListings', listingId);
    } else {
      await dbService.create('activeListings', listingId, {
        model,
        platform,
        quantity,
        updatedAt: new Date().toISOString(),
        ownerId: 'shared'
      });
    }
  };

  // ────────────────────────────────────────────────────────────────────────
  // Render
  // ────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-8 pb-12">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tighter uppercase font-display">Daily Update</h2>
          <div className="h-px w-16 bg-black mt-2" />
          <p className="text-xs text-gray-400 font-mono mt-2 uppercase tracking-widest">
            Sales team daily stock briefing ·{' '}
            {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {todayUnits.length > 0 && (
            <span className="bg-black text-white text-[9px] font-bold font-mono px-3 py-1.5 uppercase tracking-widest flex items-center gap-2">
              <Bell size={10} />
              {todayUnits.length} new unit{todayUnits.length > 1 ? 's' : ''} in today
            </span>
          )}
        </div>
      </div>

      {/* Recent Activity Feed */}
      {recentNotifications.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-3xl overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Recent Activity Feed</h3>
            {recentNotifications.some(n => !n.read) && (
              <button
                onClick={() => notificationService.markAllAsRead()}
                className="text-[9px] font-bold text-gray-400 hover:text-black uppercase tracking-widest transition-colors"
              >
                Mark All Read
              </button>
            )}
          </div>
          <div className="divide-y divide-gray-50 max-h-[240px] overflow-y-auto custom-scrollbar">
            {recentNotifications.map(n => {
              const typeConfig: Record<string, { bg: string; icon: any; label: string }> = {
                sold: { bg: 'bg-emerald-100 text-emerald-600', icon: ShoppingBag, label: 'Sold' },
                loss_sell: { bg: 'bg-red-100 text-red-600', icon: AlertCircle, label: 'Loss Sell' },
                new_stock: { bg: 'bg-blue-100 text-blue-600', icon: Package, label: 'New Stock' },
                return_processed: { bg: 'bg-amber-100 text-amber-600', icon: RefreshCw, label: 'Return' },
                shs_received: { bg: 'bg-purple-100 text-purple-600', icon: Truck, label: 'SHS Received' },
              };
              const config = typeConfig[n.type] || typeConfig.new_stock;
              const Icon = config.icon;
              return (
              <div key={n.id} className={`px-6 py-3 flex items-center gap-4 hover:bg-gray-50 transition-all ${!n.read ? 'bg-blue-50/30' : ''}`}>
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${config.bg}`}>
                  <Icon size={14} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold text-black truncate">{n.model}</p>
                    <span className="text-[8px] font-mono text-gray-400 uppercase">
                      {new Date(n.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-[10px] text-gray-500 truncate mt-0.5">{n.message}</p>
                  {n.profitAmount !== undefined && (
                    <p className={`text-[8px] font-bold mt-1 ${n.profitAmount >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {n.profitAmount >= 0 ? '✓ Profit' : '⚠ Loss'}: £{Math.abs(n.profitAmount).toFixed(2)}
                    </p>
                  )}
                </div>
              </div>
            );
            })}
          </div>
        </div>
      )}

      {/* Listing Reconciliation — Critical Insights */}
      <div className="bg-white border border-gray-200 rounded-3xl overflow-hidden shadow-sm">
        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
          <div>
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Inventory Reconciliation</h3>
            <p className="text-[8px] text-gray-400 font-mono uppercase mt-0.5">Physical Stock vs Online Listings</p>
          </div>
          <span className="text-[8px] bg-black text-white px-2 py-1 font-mono uppercase tracking-widest">Live Sync</span>
        </div>

        <div className="divide-y divide-gray-50 max-h-[500px] overflow-y-auto custom-scrollbar">
          {reconciliation.filter(r => r.status !== 'ok').length === 0 ? (
            <div className="px-6 py-12 text-center">
              <CheckCircle2 className="mx-auto text-emerald-500 mb-2" size={24} />
              <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">All listings are perfectly synced</p>
            </div>
          ) : (
            reconciliation.filter(r => r.status !== 'ok').map(item => (
              <div key={item.model} className={`px-6 py-4 flex items-center gap-6 group hover:bg-gray-50 transition-all ${
                item.status === 'over' ? 'bg-red-50/50' : item.status === 'none' ? 'bg-amber-50/30' : ''
              }`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold truncate">{item.model}</p>
                    <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded uppercase font-mono border ${
                      item.status === 'over' ? 'bg-red-100 text-red-700 border-red-200' :
                      item.status === 'none' ? 'bg-amber-100 text-amber-700 border-amber-200' :
                      'bg-blue-100 text-blue-700 border-blue-200'
                    }`}>
                      {item.message}
                    </span>
                  </div>
                  <p className="text-[10px] text-gray-500 font-mono mt-1">
                    Physical: <span className="text-black font-bold">{item.physical}</span> ·
                    Listed: <span className={item.listed > item.physical ? 'text-red-600 font-bold' : 'text-black font-bold'}>{item.listed}</span>
                  </p>
                </div>

                <div className="flex gap-1.5">
                  {['eBay', 'Amazon'].map(site => {
                    const isListedOnSite = item.platforms.includes(site);
                    return (
                      <button
                        key={site}
                        onClick={() => handleUpdateListing(item.model, site, isListedOnSite ? 0 : 1)}
                        className={`text-[9px] font-bold px-3 py-1.5 rounded-lg transition-all uppercase tracking-wider ${
                          isListedOnSite
                            ? 'bg-black text-white hover:bg-gray-800'
                            : 'bg-white border border-gray-200 text-gray-400 hover:border-black hover:text-black'
                        }`}
                      >
                        {isListedOnSite ? `✓ ${site}` : `+ ${site}`}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Quick KPIs for sales team */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white border border-gray-200 shadow-md border-0 ring-1 ring-gray-100 p-5">
          <p className="text-[8px] font-bold text-gray-400 uppercase tracking-widest font-mono mb-2">Available to Sell</p>
          <p className="text-4xl font-bold font-display tracking-tighter">{units.filter(u => u.status === 'available').length}</p>
        </div>
        <div className="bg-white border border-gray-200 shadow-md border-0 ring-1 ring-gray-100 p-5">
          <p className="text-[8px] font-bold text-gray-400 uppercase tracking-widest font-mono mb-2">Top 10 Focus</p>
          <p className="text-4xl font-bold font-display tracking-tighter text-black">
            {units.filter(u => u.status === 'available' && u.flags.includes('top10')).length}
          </p>
        </div>
        <div className="bg-white border border-gray-200 shadow-md border-0 ring-1 ring-gray-100 p-5">
          <p className="text-[8px] font-bold text-gray-400 uppercase tracking-widest font-mono mb-2">Sold Today</p>
          <p className="text-4xl font-bold font-display tracking-tighter text-emerald-600">
            {soldTodayCount}
          </p>
        </div>
        <div className="bg-white border border-gray-200 shadow-md border-0 ring-1 ring-gray-100 p-5 border-l-4 border-l-amber-400">
          <p className="text-[8px] font-bold text-amber-500 uppercase tracking-widest font-mono mb-2">Unlisted Models</p>
          <p className="text-4xl font-bold font-display tracking-tighter text-amber-600">
            {reconciliation.filter(r => r.status === 'none').length}
          </p>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────────
          SOLD HISTORY — Excel-parity grid over `sales` collection
          ───────────────────────────────────────────────────────────────── */}
      <div className="bg-white border border-gray-200 shadow-md border-0 ring-1 ring-gray-100 border-l-4 border-l-emerald-500 overflow-hidden">
        <button
          onClick={() => setIsSoldHistoryOpen(!isSoldHistoryOpen)}
          className="w-full px-6 py-4 border-b border-gray-200 bg-emerald-50 flex items-center justify-between hover:bg-emerald-100 transition-all text-left"
        >
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-emerald-800 flex items-center gap-2">
            <ShoppingBag size={12} /> Sold History — Excel Parity
            <span className="ml-2 bg-emerald-600 text-white text-[8px] px-1.5 py-0.5 rounded-full">
              {sortedSales.length.toLocaleString('en-GB')}
            </span>
            {(() => {
              const flaggedCount = sortedSales.filter(s => s.flagged).length;
              return flaggedCount > 0 ? (
                <span
                  className="bg-rose-100 text-rose-700 border border-rose-200 text-[8px] px-1.5 py-0.5 rounded-full"
                  title="Rows painted red on the source Sales Report (returns / refunds / disputes)"
                >
                  {flaggedCount.toLocaleString('en-GB')} flagged
                </span>
              ) : null;
            })()}
          </h3>
          <ChevronDown size={14} className={`text-emerald-400 transition-transform duration-200 ${isSoldHistoryOpen ? 'rotate-180' : ''}`} />
        </button>

        <AnimatePresence initial={false}>
          {isSoldHistoryOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="overflow-hidden"
            >
              {/* Toolbar: scope tabs · marketplace chips · date range · search */}
              <div className="px-6 py-3 bg-white border-b border-gray-100 flex flex-col gap-3">
                {/* Scope tabs */}
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="inline-flex border border-gray-200 rounded-lg overflow-hidden">
                    {(['today','range','all'] as Scope[]).map(s => (
                      <button
                        key={s}
                        onClick={() => setScope(s)}
                        className={`px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest transition-all ${
                          scope === s
                            ? 'bg-black text-white'
                            : 'bg-white text-gray-500 hover:text-black hover:bg-gray-50'
                        }`}
                      >
                        {s === 'today' ? 'Today' : s === 'range' ? 'Date Range' : 'All Time'}
                      </button>
                    ))}
                  </div>

                  {/* Date range (only shown when range scope is active) */}
                  {scope === 'range' && (
                    <div className="flex items-center gap-2 text-[10px] font-mono">
                      <input
                        type="date"
                        value={rangeFrom}
                        onChange={e => setRangeFrom(e.target.value)}
                        className="bg-gray-50 border border-gray-200 rounded px-2 py-1 text-[10px] font-mono focus:outline-none focus:border-emerald-500"
                      />
                      <span className="text-gray-400">→</span>
                      <input
                        type="date"
                        value={rangeTo}
                        onChange={e => setRangeTo(e.target.value)}
                        className="bg-gray-50 border border-gray-200 rounded px-2 py-1 text-[10px] font-mono focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                  )}
                </div>

                {/* Marketplace filter chip row */}
                <div className="flex items-center gap-2 flex-wrap">
                  {(['ALL', ...MARKETPLACES] as const).map(m => (
                    <button
                      key={m}
                      onClick={() => setMarketFilter(m as any)}
                      className={`text-[9px] font-bold uppercase tracking-widest px-3 py-1 rounded-full border transition-all ${
                        marketFilter === m
                          ? 'bg-black text-white border-black'
                          : 'bg-white text-gray-500 border-gray-200 hover:border-black hover:text-black'
                      }`}
                    >
                      {m === 'ALL' ? 'All' : m}
                    </button>
                  ))}
                  <div className="relative flex-1 min-w-[180px] max-w-md ml-auto">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={12} />
                    <input
                      type="text"
                      placeholder="Search order #, IMEI, SKU, supplier, model…"
                      value={soldSearch}
                      onChange={e => setSoldSearch(e.target.value)}
                      className="w-full bg-gray-50 border border-gray-200 rounded-lg py-1.5 pl-8 pr-3 text-[11px] font-mono focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>
              </div>

              {/* Excel-style grid */}
              <div className="max-h-[640px] overflow-auto custom-scrollbar">
                {sortedSales.length === 0 ? (
                  <div className="px-6 py-16 flex flex-col items-center gap-3 text-gray-300">
                    <ShoppingBag size={36} />
                    <p className="text-[11px] font-mono text-gray-500">
                      {allSales.length === 0
                        ? 'No sales recorded yet'
                        : 'No sales match the current filters'}
                    </p>
                    {allSales.length === 0 && (
                      <p className="text-[10px] font-mono text-gray-400 max-w-xs text-center">
                        Record a sale on the Sell page, or import a sales master file from Master Data.
                      </p>
                    )}
                  </div>
                ) : (
                  <table
                    className="w-full border-collapse"
                    style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11 }}
                  >
                    <thead className="sticky top-0 z-10 bg-gray-100 shadow-sm">
                      <tr>
                        <th
                          className="sticky left-0 z-20 bg-gray-100 px-2 py-2 text-left text-[9px] font-bold uppercase tracking-widest text-gray-500 border-b border-r border-gray-200"
                          style={{ width: 40 }}
                        >
                          #
                        </th>
                        {COLUMNS.map(c => {
                          const isActive = sortKey === c.key;
                          const ArrowIcon = sortDir === 'asc' ? ChevronUp : ChevronDown;
                          return (
                            <th
                              key={c.key}
                              onClick={() => toggleSort(c.key)}
                              className={`px-3 py-2 text-[9px] font-bold uppercase tracking-widest border-b border-r border-gray-200 cursor-pointer select-none transition-colors ${
                                isActive ? 'text-black bg-gray-200' : 'text-gray-500 hover:bg-gray-200'
                              }`}
                              style={{ width: c.width, textAlign: c.align ?? 'left' }}
                              title={`Sort by ${c.label}`}
                            >
                              <span className="inline-flex items-center gap-1">
                                {c.label}
                                {isActive && <ArrowIcon size={10} />}
                              </span>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {sortedSales.map((s, i) => {
                        const isInApp = s.importBatchId === 'inapp';
                        // Resolve linked unit so the row can flag "Replacement"
                        // — set on units chosen as the replacement-out side of
                        // a ProcessReturn cycle (ReturnsPage:1991). Prefer the
                        // explicit unitId; fall back to IMEI for imported sales
                        // that never back-linked.
                        const imeiKey = (s.imei || '').trim().toUpperCase();
                        const linkedUnit =
                          (s.unitId && units.find(x => x.id === s.unitId))
                          || (imeiKey && units.find(x => (x.imei || '').trim().toUpperCase() === imeiKey))
                          || undefined;
                        const isReplacement = !!linkedUnit?.replacementForUnitId;
                        // Operator's red-row flag from the source workbook
                        // wins over the in-app blue tint — these rows need
                        // attention (return / refund / chargeback).
                        const rowTint = s.flagged
                          ? 'bg-rose-50 hover:bg-rose-100/70'
                          : isInApp
                            ? 'bg-blue-50/30 hover:bg-emerald-50/60'
                            : 'hover:bg-emerald-50/60';
                        const indexBg = s.flagged
                          ? 'bg-rose-50 hover:bg-rose-100/70'
                          : 'bg-white hover:bg-emerald-50/60';
                        const tooltip = s.flagged
                          ? 'Flagged on the source Sales Report (red row)'
                          : isInApp
                            ? 'Source: in-app sell flow (legacy unit)'
                            : undefined;
                        return (
                          <tr
                            key={s.id}
                            className={`${rowTint} transition-colors`}
                            title={tooltip}
                          >
                            <td
                              className={`sticky left-0 z-10 ${indexBg} px-2 py-1.5 text-gray-400 border-b border-r border-gray-100 text-[10px]`}
                              style={{ width: 40 }}
                            >
                              {i + 1}
                            </td>
                            {COLUMNS.map(c => {
                              let display: React.ReactNode = '';
                              switch (c.key) {
                                case 'saleDate':
                                  display = s.saleDate
                                    ? (fmtDateForUser(s.saleDate, region) || formatDateDdMmmYyyy(s.saleDate))
                                    : '';
                                  break;
                                case 'marketplace':
                                  display = (
                                    <span
                                      className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border font-mono ${
                                        MARKETPLACE_BADGE[s.marketplace] ?? 'bg-gray-100 text-gray-600 border-gray-200'
                                      }`}
                                    >
                                      {s.marketplace}
                                    </span>
                                  );
                                  break;
                                case 'orderNumber':
                                  display = s.flagged ? (
                                    <span className="inline-flex items-center gap-1">
                                      <EditableCell
                                        value={s.orderNumber ?? ''}
                                        display={<span className="text-rose-700 font-semibold">{s.orderNumber || '—'}</span>}
                                        onSave={async (v) => {
                                          await dbService.update('sales', s.id, { orderNumber: v });
                                        }}
                                      />
                                      <span
                                        className="text-[8px] font-bold uppercase tracking-widest px-1 py-px rounded border bg-rose-100 text-rose-700 border-rose-200"
                                        title="Flagged on the source Sales Report (red row)"
                                      >
                                        Flagged
                                      </span>
                                    </span>
                                  ) : (
                                    <EditableCell
                                      value={s.orderNumber ?? ''}
                                      display={s.orderNumber || '—'}
                                      onSave={async (v) => {
                                        await dbService.update('sales', s.id, { orderNumber: v });
                                      }}
                                    />
                                  );
                                  break;
                                case 'model': {
                                  const u = s.unitId ? units.find(x => x.id === s.unitId) : undefined;
                                  const displayModel = u?.model || s.model || s.sku || '—';
                                  display = (
                                    <span className="font-bold text-gray-900">{displayModel}</span>
                                  );
                                  break;
                                }
                                case 'sku':
                                  display = (
                                    <EditableCell
                                      value={s.sku ?? ''}
                                      display={s.sku || '—'}
                                      onSave={async (v) => {
                                        await dbService.update('sales', s.id, { sku: v });
                                      }}
                                    />
                                  );
                                  break;
                                case 'imei': {
                                  const noInventory = !!s.imei && !linkedUnit;
                                  display = (isReplacement || noInventory) ? (
                                    <span className="inline-flex items-center gap-1">
                                      <span>{s.imei || '—'}</span>
                                      {isReplacement && (
                                        <span
                                          className="text-[8px] font-bold uppercase tracking-widest px-1 py-px rounded border bg-violet-50 text-violet-700 border-violet-200"
                                          title="Shipped as a replacement for another returned unit"
                                        >
                                          Replacement
                                        </span>
                                      )}
                                      {noInventory && (
                                        isAdminUser ? (
                                          <button
                                            type="button"
                                            onClick={() => setAddSoldUnitSale(s)}
                                            className="text-[8px] font-bold uppercase tracking-widest px-1 py-px rounded border bg-amber-50 text-amber-700 border-amber-300 hover:bg-amber-100 cursor-pointer transition-colors"
                                            title="No inventory unit for this IMEI. Click to add it as fresh stock — it will be created already sold and linked to this sale."
                                          >
                                            No Inventory
                                          </button>
                                        ) : (
                                          <span className="text-[8px] font-bold uppercase tracking-widest px-1 py-px rounded border bg-amber-50 text-amber-700 border-amber-300">
                                            No Inventory
                                          </span>
                                        )
                                      )}
                                    </span>
                                  ) : (s.imei || '—');
                                  break;
                                }
                                case 'supplierName':
                                  display = (
                                    <EditableCell
                                      value={s.supplierName ?? ''}
                                      display={s.supplierName || '—'}
                                      onSave={async (v) => {
                                        await dbService.update('sales', s.id, { supplierName: v });
                                      }}
                                    />
                                  );
                                  break;
                                case 'quantity':
                                  display = (
                                    <EditableCell
                                      value={s.quantity ?? ''}
                                      display={String(s.quantity ?? 1)}
                                      type="number"
                                      onSave={async (v) => {
                                        await dbService.update('sales', s.id, { quantity: v === '' ? null : Number(v) });
                                      }}
                                    />
                                  );
                                  break;
                                case 'buyPrice':
                                  display = (
                                    <EditableCell
                                      value={s.buyPrice ?? ''}
                                      display={fmtGBP(s.buyPrice)}
                                      type="number"
                                      onSave={async (v) => {
                                        await dbService.update('sales', s.id, { buyPrice: v === '' ? null : Number(v) });
                                      }}
                                    />
                                  );
                                  break;
                                case 'salePrice':
                                  display = (
                                    <EditableCell
                                      value={s.salePrice ?? ''}
                                      display={fmtGBP(s.salePrice)}
                                      type="number"
                                      onSave={async (v) => {
                                        await dbService.update('sales', s.id, { salePrice: v === '' ? null : Number(v) });
                                      }}
                                    />
                                  );
                                  break;
                                case 'paymentMode':
                                  display = (
                                    <EditableCell
                                      value={s.paymentMode ?? ''}
                                      display={s.marketplace === 'BM' ? (s.paymentMode || '—') : '—'}
                                      onSave={async (v) => {
                                        await dbService.update('sales', s.id, { paymentMode: v });
                                      }}
                                    />
                                  );
                                  break;
                                case 'postage':
                                  display = (
                                    <EditableCell
                                      value={s.postage ?? ''}
                                      display={fmtGBP(s.postage)}
                                      type="number"
                                      onSave={async (v) => {
                                        await dbService.update('sales', s.id, { postage: v === '' ? null : Number(v) });
                                      }}
                                    />
                                  );
                                  break;
                                case 'commission':
                                  display = fmtGBP(s.commission);
                                  break;
                                case 'grossProfit':
                                  display = (
                                    <span className={s.grossProfit < 0 ? 'text-red-600 font-bold' : 'text-emerald-700 font-bold'}>
                                      {fmtGBP(s.grossProfit)}
                                    </span>
                                  );
                                  break;
                                case 'gpPercent': {
                                  // Use the pre-computed gpPercent off the recomputed Sale doc
                                  // so the denominator matches the master sheet per marketplace
                                  // (AMAZON/BM divide by BP; EBAY/ONBUY by SP).
                                  // Manually re-deriving GP/BP here broke eBay + OnBuy rows.
                                  const pct = s.gpPercent ?? 0;
                                  display = (
                                    <span className={pct < 0 ? 'text-red-600 font-bold' : 'text-emerald-700 font-bold'}>
                                      {pct.toFixed(1)}%
                                    </span>
                                  );
                                  break;
                                }
                                case 'comments':
                                  display = (
                                    <EditableCell
                                      value={s.comments ?? ''}
                                      display={s.comments || ''}
                                      onSave={async (v) => {
                                        await dbService.update('sales', s.id, { comments: v });
                                      }}
                                    />
                                  );
                                  break;
                              }
                              const titleStr =
                                c.key === 'marketplace'
                                  ? s.marketplace
                                  : (typeof display === 'string' ? display : '');
                              return (
                                <td
                                  key={c.key}
                                  className="px-3 py-1.5 border-b border-r border-gray-100 truncate text-gray-800"
                                  style={{ maxWidth: c.width, textAlign: c.align ?? 'left' }}
                                  title={titleStr}
                                >
                                  {display}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Footer KPIs */}
              <div className="flex-shrink-0 px-5 py-3 border-t border-gray-200 bg-gray-50 flex items-center justify-between flex-wrap gap-3">
                <p className="text-[9px] font-mono uppercase tracking-widest text-gray-500">
                  {kpi.count.toLocaleString('en-GB')} row{kpi.count === 1 ? '' : 's'}
                  <span className="text-gray-300 mx-2">·</span>
                  <span className="text-blue-700">Blue rows = in-app sales</span>
                </p>
                <div className="flex items-center gap-4 text-[10px] font-mono">
                  <span className="text-gray-500 uppercase tracking-widest">
                    Sum SP:{' '}
                    <span className="text-black font-bold">
                      £{kpi.sumSP.toLocaleString('en-GB', { maximumFractionDigits: 2 })}
                    </span>
                  </span>
                  <span className="text-gray-500 uppercase tracking-widest">
                    Sum GP:{' '}
                    <span className={`font-bold ${kpi.sumGP < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                      £{kpi.sumGP.toLocaleString('en-GB', { maximumFractionDigits: 2 })}
                    </span>
                  </span>
                  <span className="text-gray-500 uppercase tracking-widest">
                    Avg GP%:{' '}
                    <span className={`font-bold ${kpi.avgGpPct < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                      {kpi.avgGpPct.toFixed(1)}%
                    </span>
                  </span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Today's new stock */}
      {todayUnits.length > 0 && (
        <div className="bg-white border border-gray-200 shadow-md border-0 ring-1 ring-gray-100 border-l-4 border-l-black overflow-hidden">
          <button
            onClick={() => setIsTodayStockOpen(!isTodayStockOpen)}
            className="w-full px-6 py-4 border-b border-gray-200 bg-gray-50 flex items-center justify-between hover:bg-gray-100 transition-all text-left"
          >
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-600 flex items-center gap-2">
              <Clock size={12} /> New Stock In Today — List These Now
              <span className="ml-2 bg-black text-white text-[8px] px-1.5 py-0.5 rounded-full">{todayUnits.length}</span>
            </h3>
            <ChevronDown size={14} className={`text-gray-400 transition-transform duration-200 ${isTodayStockOpen ? 'rotate-180' : ''}`} />
          </button>

          <AnimatePresence initial={false}>
            {isTodayStockOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="overflow-hidden"
              >
                <div className="divide-y divide-gray-50">
                  {todayUnits.map(u => (
                    <div key={u.id} className="px-6 py-4 flex items-center gap-6">
                      <div className="flex-1">
                        <p className="text-sm font-bold">{u.model}</p>
                        <p className="text-[10px] text-gray-500 font-mono uppercase">{u.colour} · <span className="text-black font-bold">IMEI: {u.imei || '—'}</span> · £{u.buyPrice}</p>
                      </div>
                      <span className="text-[10px] font-bold bg-black text-white px-3 py-1.5 font-mono uppercase tracking-widest flex-shrink-0">
                        Set Qty: 1 ↑
                      </span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Platform Quantity Reference */}
      <div className="bg-white border border-gray-200 shadow-md border-0 ring-1 ring-gray-100 overflow-hidden">
        <button
          onClick={() => setIsPlatformListOpen(!isPlatformListOpen)}
          className="w-full px-6 py-4 border-b border-gray-200 flex flex-col md:flex-row md:items-center justify-between bg-gray-50 gap-2 hover:bg-gray-100 transition-all text-left"
        >
          <div className="flex items-center gap-2">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Platform Quantity Reference</h3>
            <ChevronDown size={14} className={`text-gray-400 transition-transform duration-200 ${isPlatformListOpen ? 'rotate-180' : ''}`} />
          </div>
          <span className="text-[9px] text-gray-400 font-mono text-left md:text-right">Update daily on eBay / Amazon / OnBuy / Backmarket</span>
        </button>

        <AnimatePresence initial={false}>
          {isPlatformListOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="overflow-hidden"
            >
              <div className="max-w-full overflow-hidden">
                {/* Desktop Table View */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-gray-100 text-[8px] text-gray-400 uppercase tracking-[0.25em] font-mono bg-gray-50">
                        <th className="px-6 py-3 font-bold">Model</th>
                        <th className="px-6 py-3 font-bold">Category</th>
                        <th className="px-6 py-3 font-bold">Flags</th>
                        <th className="px-6 py-3 font-bold">Units Available</th>
                        <th className="px-6 py-3 font-bold">Platform Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {platformList.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-6 py-12 text-center text-gray-400 font-mono text-xs">
                            No phones in stock. Add a supplier delivery first.
                          </td>
                        </tr>
                      ) : platformList.map(item => (
                        <tr key={item.model} className="hover:bg-gray-50 transition-all">
                          <td className="px-6 py-4">
                            <p className="text-xs font-bold">{item.model}</p>
                            <p className="text-[9px] text-gray-400 font-mono uppercase mt-0.5">{item.brand}</p>
                          </td>
                          <td className="px-6 py-4">
                            <span className="text-[9px] font-mono bg-black text-white px-2 py-1 uppercase">{item.category}</span>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex flex-wrap gap-1">
                              {item.flags.map(flag => {
                                const cfg = FLAG_CONFIG[flag];
                                const Icon = cfg.icon;
                                return (
                                  <span key={flag} className={`text-[8px] font-bold uppercase px-1.5 py-0.5 border font-mono flex items-center gap-1 ${cfg.style}`}>
                                    <Icon size={8} />{cfg.label}
                                  </span>
                                );
                              })}
                              {item.flags.length === 0 && <span className="text-[9px] text-gray-300 font-mono">—</span>}
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <span className="text-2xl font-bold font-display tracking-tighter">{item.count}</span>
                          </td>
                          <td className="px-6 py-4">
                            {item.count > 0 ? (
                              <div>
                                <span className="text-[10px] font-bold bg-black text-white px-3 py-1.5 font-mono uppercase tracking-widest">
                                  Set Qty: 1 ✓
                                </span>
                                <p className="text-[8px] text-gray-400 font-mono mt-1 uppercase">
                                  {item.flags.includes('top10') ? FLAG_CONFIG.top10.action : 'In stock — list now'}
                                </p>
                              </div>
                            ) : (
                              <div>
                                <span className="text-[10px] font-bold bg-gray-100 text-gray-500 px-3 py-1.5 font-mono uppercase tracking-widest">
                                  Set Qty: 0 ✗
                                </span>
                                <p className="text-[8px] text-gray-400 font-mono mt-1 uppercase">Out of stock — delist</p>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile Card List View */}
                <div className="md:hidden divide-y divide-gray-50">
                  {platformList.length === 0 ? (
                    <div className="px-6 py-12 text-center text-gray-400 font-mono text-xs">
                      No available stock.
                    </div>
                  ) : platformList.map(item => (
                    <div key={item.model} className="px-6 py-5 space-y-4">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="text-sm font-bold">{item.model}</p>
                          <p className="text-[10px] text-gray-400 font-mono uppercase mt-0.5">{item.brand} · {item.category}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-2xl font-bold font-display tracking-tighter leading-none">{item.count}</p>
                          <p className="text-[8px] text-gray-400 font-mono uppercase mt-1">Available</p>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-1">
                        {item.flags.map(flag => {
                          const cfg = FLAG_CONFIG[flag];
                          const Icon = cfg.icon;
                          return (
                            <span key={flag} className={`text-[8px] font-bold uppercase px-2 py-1 border font-mono flex items-center gap-1 ${cfg.style}`}>
                              <Icon size={8} />{cfg.label}
                            </span>
                          );
                        })}
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-gray-50">
                         <span className={`text-[10px] font-bold px-3 py-2 font-mono uppercase tracking-widest rounded-lg ${item.count > 0 ? 'bg-black text-white' : 'bg-gray-100 text-gray-500'}`}>
                            Set Qty: {item.count > 0 ? '1 ✓' : '0 ✗'}
                         </span>
                         <p className="text-[8px] text-gray-400 font-mono uppercase text-right leading-tight max-w-[120px]">
                            {item.count > 0
                              ? (item.flags.includes('top10') ? FLAG_CONFIG.top10.action : 'List on platforms now')
                              : 'Out of stock — delist everywhere'}
                         </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {addSoldUnitSale && (
          <AddSoldUnitModal
            sale={addSoldUnitSale}
            onClose={() => setAddSoldUnitSale(null)}
            onSaved={() => setAddSoldUnitSale(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
