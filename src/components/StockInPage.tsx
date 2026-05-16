import React, { useState, useMemo, useEffect } from 'react';
import {
  PackagePlus, Search, Plus, CheckCircle2, Clock,
  ChevronDown, ChevronUp, Truck, PackageCheck, AlertCircle, MoreVertical, Trash2,
  Inbox,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { dbService } from '../lib/dbService';
import { notificationService } from '../lib/notificationService';
import { InventoryUnit, InventoryAggregate, Supplier } from '../types';
import { useInventoryStore } from '../lib/inventoryStore';
import { parseBrandModelStorage } from '../lib/modelStorage';
import CopyImei from './CopyImei';
import CollapsibleSection from './CollapsibleSection';
import ReceiveSHSModal from './ReceiveSHSModal';
import AddSHSModal from './AddSHSModal';
import AddDeliveryModal from './AddDeliveryModal';
import ScanInModal from './ScanInModal';
import IntelligencePanel from './IntelligencePanel';
import TodayIntakeModal from './TodayIntakeModal';
import { StockIntakeFlow } from './StockIntakeFlow';

interface Props {
  onOpenBatch: () => void;
  /** Optional callback that opens the global ImportModal — used by the
   *  "IMPORT" button in the top-right header. */
  onOpenImport?: () => void;
}

/** Resolve a unit's SKU using pre-split fields when present, otherwise
 *  parse the legacy single-string `model` column at runtime. Used as the
 *  grouping key for the Recent Stock In list so 6× "SAMSUNG S21 128GB"
 *  collapses into one row. */
function deriveSku(u: InventoryUnit): { brand: string; model: string; storage?: string; series?: string } {
  if (u.brand && u.storage) {
    return { brand: u.brand, model: u.model, storage: u.storage };
  }
  const p = parseBrandModelStorage(u.model || '');
  return {
    brand: u.brand || p.brand,
    model: p.model || u.model,
    storage: u.storage || p.storage,
    series: p.series,
  };
}

export default function StockInPage({ onOpenBatch, onOpenImport: _onOpenImport }: Props) {
  const { units, suppliers }        = useInventoryStore();
  const [search, setSearch]         = useState('');
  // `expandedId` is now a GROUP key, not a per-IMEI id — when a SKU group is
  // expanded we render the nested per-unit child rows underneath.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [receivingUnit, setReceivingUnit] = useState<InventoryUnit | null>(null);
  const [showAddSHS, setShowAddSHS]       = useState(false);
  const [showAddDelivery, setShowAddDelivery] = useState(false);
  const [showScanUnit, setShowScanUnit] = useState(false);
  const [showTodayIntake, setShowTodayIntake] = useState(false);
  const [showStockIntakeFlow, setShowStockIntakeFlow] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  // Live subscription to inventoryAggregates so SHS roll-up rows (which the
  // master-file parser emits with quantityText='SHS') are visible here even
  // though they aren't synthesised into the per-unit `units` array.
  const [aggregates, setAggregates] = useState<InventoryAggregate[]>([]);

  useEffect(() => {
    const unsub = dbService.subscribeToCollection('inventoryAggregates', setAggregates);
    return () => { unsub(); };
  }, []);

  const today = new Date().toISOString().split('T')[0];

  const handleDeletePendingSHSGroup = async (groupUnits: InventoryUnit[]) => {
    const sample = groupUnits[0];
    const qty = groupUnits.length;
    const label = qty === 1 ? `"${sample.model}"` : `${qty} × "${sample.model}"`;
    if (!window.confirm(`Delete ${label} from database? This action cannot be undone.`)) {
      return;
    }
    try {
      await Promise.all(groupUnits.map(u => dbService.delete('inventoryUnits', u.id)));
      notificationService.addNotification('shs_removed', sample, undefined, qty);
      setOpenMenuId(null);
    } catch (err) {
      console.error('Failed to delete pending SHS group:', err);
    }
  };

  const supplierMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of suppliers) m[s.id] = s.name;
    return m;
  }, [suppliers]);

  // Pending SHS — incoming units, sorted by dateIn desc
  const pendingSHS = useMemo(() =>
    [...units]
      .filter(u => u.status === 'incoming')
      .sort((a, b) => new Date(b.dateIn).getTime() - new Date(a.dateIn).getTime()),
    [units],
  );

  // SHS aggregates — the master-file INVENTORY-sheet roll-up rows whose
  // QUANTITY column is the literal "SHS". These represent stock the supplier
  // holds for us; we haven't received it yet.
  const shsAggregates = useMemo(() =>
    aggregates.filter(a => (a.quantityText || '').toUpperCase() === 'SHS'),
    [aggregates],
  );

  const shsTotal = pendingSHS.length + shsAggregates.length;

  // Group identical pending SHS units to avoid sequential duplicate rows
  const pendingSHSGroups = useMemo(() => {
    const map = new Map<string, InventoryUnit[]>();
    for (const u of pendingSHS) {
      const key = [
        u.model,
        u.colour || '',
        (u as any).storage || '',
        u.supplierId || '',
        u.batchId || '',
        u.buyPrice,
        u.dateIn,
        u.notes || '',
      ].join('|');
      const arr = map.get(key);
      if (arr) arr.push(u);
      else map.set(key, [u]);
    }
    return Array.from(map.values());
  }, [pendingSHS]);

  // Regular stock list (non-incoming), sorted newest first
  const allSorted = useMemo(() =>
    [...units]
      .filter(u => u.dateIn && u.status !== 'incoming')
      .sort((a, b) => new Date(b.dateIn).getTime() - new Date(a.dateIn).getTime()),
    [units],
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return allSorted.slice(0, 50);
    const q = search.toLowerCase();
    return allSorted.filter(u =>
      u.model.toLowerCase().includes(q) ||
      (u.imei || '').toLowerCase().includes(q) ||
      (u.buyPrice + '').includes(q) ||
      (supplierMap[u.supplierId] || '').toLowerCase().includes(q),
    );
  }, [allSorted, search, supplierMap]);

  // Group identical units in the recent-stock list so 6× "Samsung S21 128GB"
  // collapses to a single expandable row instead of stacking 6 duplicates.
  // Key: (brand, model, storage, colour, status) — status keeps available
  // and sold variants of the same SKU in separate groups.
  const recentStockGroups = useMemo(() => {
    const map = new Map<string, { key: string; sku: { brand: string; model: string; storage?: string; series?: string }; units: InventoryUnit[] }>();
    for (const u of filtered) {
      const sku = deriveSku(u);
      const key = `${sku.brand}|${sku.model}|${sku.storage || ''}|${u.colour || ''}|${u.status}`;
      const g = map.get(key);
      if (g) g.units.push(u);
      else map.set(key, { key, sku, units: [u] });
    }
    return Array.from(map.values()).sort((a, b) =>
      b.units.length - a.units.length || a.sku.model.localeCompare(b.sku.model),
    );
  }, [filtered]);

  const todayIn  = units.filter(u => u.dateIn === today && u.status !== 'incoming');
  const totalBP  = todayIn.reduce((s, u) => s + u.buyPrice, 0);

  // ───────────────── Pending IMEIs ─────────────────
  // Physical units in office, not sold, not yet listed on a marketplace.
  // Source: inventoryUnits with status='available' and !platformListed —
  // these are the ~280 rows that came in from the IMEI NUMBERS master
  // sheet with a blank STATUS column.
  const pendingImeis = useMemo(() =>
    units.filter(u => u.status === 'available' && !u.platformListed),
    [units],
  );

  // Group by SKU (brand, model, storage, colour) — mirrors the Recent Stock
  // In grouping pattern so 14× "iPhone 15 Pro 256GB Natural Titanium"
  // collapses to one expandable row.
  const pendingImeiGroups = useMemo(() => {
    const map = new Map<string, {
      key: string;
      sku: { brand: string; model: string; storage?: string; series?: string };
      colour: string;
      units: InventoryUnit[];
    }>();
    for (const u of pendingImeis) {
      const sku = deriveSku(u);
      const colour = u.colour && u.colour !== 'Unknown' ? u.colour : '';
      const key = `${sku.brand}|${sku.model}|${sku.storage || ''}|${colour}`;
      const g = map.get(key);
      if (g) g.units.push(u);
      else map.set(key, { key, sku, colour, units: [u] });
    }
    return Array.from(map.values()).sort((a, b) =>
      b.units.length - a.units.length || a.sku.model.localeCompare(b.sku.model),
    );
  }, [pendingImeis]);

  // KPIs for the Pending IMEIs strip
  const pendingKpis = useMemo(() => {
    const total = pendingImeis.length;
    const tiedCapital = pendingImeis.reduce((s, u) => s + (u.buyPrice || 0), 0);
    const now = Date.now();
    const daysSince = (iso: string) => {
      const t = new Date(iso || 0).getTime();
      if (!t) return 0;
      return Math.floor((now - t) / 86_400_000);
    };
    const oldestDays = pendingImeis.reduce((max, u) => {
      const d = daysSince(u.dateIn);
      return d > max ? d : max;
    }, 0);
    const staleCount = pendingImeis.filter(u => daysSince(u.dateIn) > 30).length;

    // Supplier distribution — stacked bar segments, count per supplier
    const bySupplier: Record<string, number> = {};
    for (const u of pendingImeis) {
      const name = supplierMap[u.supplierId] || u.supplierName || 'Unassigned';
      bySupplier[name] = (bySupplier[name] || 0) + 1;
    }
    const supplierBreakdown = Object.entries(bySupplier)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6); // keep mini-bar readable

    return { total, tiedCapital, oldestDays, staleCount, supplierBreakdown, daysSince };
  }, [pendingImeis, supplierMap]);

  // Stable colour palette for the supplier mini stacked bar
  const SUPPLIER_TONES = [
    'bg-emerald-500', 'bg-blue-500', 'bg-amber-500', 'bg-violet-500',
    'bg-rose-500', 'bg-cyan-500',
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h2 className="text-xl sm:text-2xl font-bold tracking-tighter uppercase font-display flex items-center gap-3">
          <span className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center flex-shrink-0">
            <PackagePlus size={16} className="text-emerald-700" />
          </span>
          Stock In
        </h2>
        <p className="text-[10px] text-gray-400 font-mono uppercase tracking-widest mt-1">
          Record incoming stock · Model · IMEI · Buy Price
        </p>
      </div>

      {/* Compact dashboard */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3 bg-gradient-to-r from-gray-50 to-white border border-gray-100 rounded-xl p-4">
        {/* KPI Row (responsive) */}
        <div className="flex items-center gap-3 flex-1 min-w-0 overflow-x-auto md:overflow-visible pb-2 md:pb-0">
          {/* Today's Intake */}
          <button
            onClick={() => setShowTodayIntake(true)}
            disabled={todayIn.length === 0}
            className="flex items-center gap-3 px-5 py-3 bg-emerald-50 border border-emerald-100 rounded-lg hover:bg-emerald-100 transition-all disabled:opacity-50 disabled:cursor-default flex-shrink-0"
          >
            <div className="text-center">
              <p className="text-[8px] font-mono uppercase tracking-widest text-emerald-600">Intake</p>
              <p className="text-2xl font-bold text-emerald-700 leading-tight">{todayIn.length}</p>
            </div>
          </button>

          {/* Today's Spend */}
          <div className="flex items-center gap-3 px-5 py-3 bg-blue-50 border border-blue-100 rounded-lg flex-shrink-0">
            <div className="text-center">
              <p className="text-[8px] font-mono uppercase tracking-widest text-blue-600">Spend</p>
              <p className="text-xl font-bold text-blue-700 leading-tight">£{totalBP.toLocaleString()}</p>
            </div>
          </div>

          {/* Pending SHS — includes both per-unit incoming placeholders and
              INVENTORY-sheet aggregate roll-up rows flagged as SHS. */}
          <div className="flex items-center gap-3 px-5 py-3 bg-amber-50 border border-amber-100 rounded-lg flex-shrink-0">
            <div className="text-center">
              <p className="text-[8px] font-mono uppercase tracking-widest text-amber-600">SHS</p>
              <p className="text-2xl font-bold text-amber-700 leading-tight">{shsTotal}</p>
            </div>
          </div>
        </div>

        {/* Divider (hidden on mobile) */}
        <div className="hidden md:block w-px h-12 bg-gray-200 mx-2 flex-shrink-0" />

        {/* Action Buttons Row */}
        <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
          {/* Add Stock (New Flow) */}
          <button
            onClick={() => setShowStockIntakeFlow(true)}
            className="flex items-center justify-center sm:justify-start gap-2 px-4 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-lg hover:from-blue-700 hover:to-blue-800 transition-all active:scale-95 shadow-md whitespace-nowrap"
          >
            <Plus size={16} />
            <span className="text-[9px] font-bold uppercase tracking-widest">Add Stock (New)</span>
          </button>

          {/* Log SHS Order */}
          <button
            onClick={() => setShowAddSHS(true)}
            className="flex items-center justify-center sm:justify-start gap-2 px-4 py-3 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-all active:scale-95 whitespace-nowrap"
          >
            <Truck size={16} />
            <span className="text-[9px] font-bold uppercase tracking-widest">SHS Order</span>
          </button>
        </div>
      </div>

      {/* Intelligence panel */}
      <IntelligencePanel units={units} mode="buy" />

      {/* Supplier Has Stock (SHS) — INVENTORY-sheet aggregates whose QUANTITY
          column is the literal "SHS". These are rolled-up model+supplier rows
          (no IMEI yet) representing stock the supplier holds for us. */}
      {shsAggregates.length > 0 && (
        <CollapsibleSection
          title="Supplier Has Stock (SHS)"
          count={shsAggregates.length}
          accent="border-l-orange-500"
          defaultOpen={true}
        >
          <div className="divide-y divide-orange-50">
            {shsAggregates.map(a => {
              const supplierName = a.supplierIds && a.supplierIds.length > 0
                ? (supplierMap[a.supplierIds[0]] || a.supplierIds[0])
                : '—';
              const qty = a.quantityNum ?? '—';
              return (
                <div key={a.id} className="flex items-center gap-3 px-4 py-3 hover:bg-orange-50/50 transition-all">
                  <div className="w-8 h-8 rounded-lg bg-orange-100 flex items-center justify-center flex-shrink-0">
                    <Truck size={14} className="text-orange-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-bold truncate">{a.model}</p>
                      <span className="text-[9px] font-bold text-orange-700 bg-orange-100 px-1.5 py-0.5 rounded font-mono flex-shrink-0">
                        SHS
                      </span>
                      {typeof qty === 'number' && (
                        <span className="text-[9px] font-bold text-orange-700 bg-orange-50 px-1.5 py-0.5 rounded font-mono flex-shrink-0">
                          ×{qty}
                        </span>
                      )}
                    </div>
                    <p className="text-[9px] text-gray-400 font-mono mt-0.5">
                      {(a as any).storage ? `${(a as any).storage} · ` : ''}
                      {supplierName}
                      {a.coloursRaw ? ` · ${a.coloursRaw}` : ''}
                    </p>
                    {a.notes && (
                      <p className="text-[8px] text-orange-600 font-mono mt-0.5 truncate">{a.notes}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {typeof a.buyPrice === 'number' && (
                      <span className="text-sm font-bold">£{a.buyPrice}</span>
                    )}
                    <button
                      type="button"
                      disabled
                      title="Receive flow will be wired up in a follow-up"
                      className="px-3 py-1.5 bg-orange-400 text-white text-[9px] font-bold uppercase tracking-widest rounded-lg opacity-60 cursor-not-allowed flex items-center gap-1"
                    >
                      <PackageCheck size={11} /> Receive into stock
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </CollapsibleSection>
      )}

      {/* Pending SHS section */}
      {pendingSHS.length > 0 && (
        <CollapsibleSection
          title="Pending SHS — Awaiting Delivery"
          count={pendingSHS.length}
          accent="border-l-amber-500"
          defaultOpen={false}
        >
          <div className="divide-y divide-amber-50">
            {pendingSHSGroups.map(group => {
              const u = group[0];
              const qty = group.length;
              return (
                <div key={u.id} className="flex items-center gap-3 px-4 py-3 hover:bg-amber-50/50 transition-all">
                  <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
                    <Truck size={14} className="text-amber-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-bold truncate">{u.model}</p>
                      {qty > 1 && (
                        <span className="text-[9px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded font-mono flex-shrink-0">
                          ×{qty}
                        </span>
                      )}
                    </div>
                    <p className="text-[9px] text-gray-400 font-mono mt-0.5">
                      {u.colour && u.colour !== 'Unknown' ? `${u.colour} · ` : ''}
                      {supplierMap[u.supplierId] || '—'} · {u.batchId === 'master_batch' ? 'Master' : (u.batchId || 'Default')} · {u.dateIn}
                    </p>
                    {u.notes && (
                      <p className="text-[8px] text-amber-600 font-mono mt-0.5 truncate">{u.notes}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-sm font-bold">
                      £{u.buyPrice}
                      {qty > 1 && <span className="text-[9px] text-gray-400 font-mono ml-1">/ £{(u.buyPrice * qty).toLocaleString()}</span>}
                    </span>
                    <button
                      onClick={() => setReceivingUnit(u)}
                      className="px-3 py-1.5 bg-amber-500 text-white text-[9px] font-bold uppercase tracking-widest rounded-lg hover:bg-amber-600 transition-all flex items-center gap-1"
                    >
                      <PackageCheck size={11} /> Receive
                    </button>

                    {/* Options Menu */}
                    <div className="relative">
                      <button
                        onClick={() => setOpenMenuId(openMenuId === u.id ? null : u.id)}
                        className="p-2 hover:bg-gray-100 rounded-lg transition-all text-gray-500"
                        title="More options"
                      >
                        <MoreVertical size={14} />
                      </button>

                      {/* Dropdown Menu */}
                      {openMenuId === u.id && (
                        <div className="absolute right-0 mt-1 w-44 bg-white border border-gray-200 rounded-lg shadow-lg z-10">
                          <button
                            onClick={() => handleDeletePendingSHSGroup(group)}
                            className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2 transition-all rounded-lg m-1"
                          >
                            <Trash2 size={14} /> Delete {qty > 1 ? `all ${qty}` : 'from DB'}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </CollapsibleSection>
      )}

      {/* ───────────────── Pending IMEIs · In Office · Awaiting Listing ─────────────────
          Physical units already in office (status='available') that have NOT
          been listed on a marketplace yet (!platformListed). These are the
          rows from the IMEI NUMBERS sheet whose STATUS column was blank.
          One row per SKU group with a count + chevron — expand to see IMEIs. */}
      {pendingImeis.length > 0 && (
        <CollapsibleSection
          title="Pending IMEIs · In Office · Awaiting Listing"
          count={pendingImeis.length}
          accent="border-l-indigo-500"
          defaultOpen={true}
        >
          <p className="px-4 pt-3 pb-2 text-[10px] text-gray-500 font-mono">
            Physical units received, not yet sold or listed on a marketplace.
          </p>

          {/* KPI strip */}
          <div className="px-4 pb-3 grid grid-cols-2 md:grid-cols-4 gap-2">
            <div className="bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2">
              <p className="text-[8px] font-mono uppercase tracking-widest text-indigo-600">Total Pending</p>
              <p className="text-xl font-bold text-indigo-700 leading-tight">{pendingKpis.total}</p>
            </div>
            <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
              <p className="text-[8px] font-mono uppercase tracking-widest text-blue-600">Tied-Up Capital</p>
              <p className="text-xl font-bold text-blue-700 leading-tight">
                £{pendingKpis.tiedCapital.toLocaleString('en-GB', { maximumFractionDigits: 0 })}
              </p>
            </div>
            <div className={`border rounded-lg px-3 py-2 ${pendingKpis.oldestDays > 30 ? 'bg-amber-50 border-amber-100' : 'bg-gray-50 border-gray-100'}`}>
              <p className={`text-[8px] font-mono uppercase tracking-widest ${pendingKpis.oldestDays > 30 ? 'text-amber-600' : 'text-gray-500'}`}>
                Oldest Pending
              </p>
              <p className={`text-xl font-bold leading-tight ${pendingKpis.oldestDays > 30 ? 'text-amber-700' : 'text-gray-700'}`}>
                {pendingKpis.oldestDays}d
                {pendingKpis.staleCount > 0 && (
                  <span className="text-[9px] font-mono text-amber-600 ml-2">
                    {pendingKpis.staleCount} stale
                  </span>
                )}
              </p>
            </div>
            <div className="bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
              <p className="text-[8px] font-mono uppercase tracking-widest text-gray-500 mb-1.5">By Supplier</p>
              {pendingKpis.supplierBreakdown.length === 0 ? (
                <p className="text-[10px] font-mono text-gray-400">—</p>
              ) : (
                <>
                  <div className="flex h-2 w-full rounded overflow-hidden bg-gray-100">
                    {pendingKpis.supplierBreakdown.map(([name, n], i) => (
                      <div
                        key={name}
                        className={SUPPLIER_TONES[i % SUPPLIER_TONES.length]}
                        style={{ width: `${(n / pendingKpis.total) * 100}%` }}
                        title={`${name} — ${n}`}
                      />
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1.5">
                    {pendingKpis.supplierBreakdown.slice(0, 3).map(([name, n], i) => (
                      <span key={name} className="flex items-center gap-1 text-[8px] font-mono text-gray-600">
                        <span className={`w-1.5 h-1.5 rounded-sm ${SUPPLIER_TONES[i % SUPPLIER_TONES.length]}`} />
                        {name} <span className="text-gray-400">{n}</span>
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Excel-style header row — matches IMEI NUMBERS sheet column order */}
          <div
            className="px-4 py-2 grid items-center gap-2 bg-gray-100 border-y border-gray-200 text-[9px] font-bold uppercase tracking-widest text-gray-500"
            style={{
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              gridTemplateColumns: '90px 1.6fr 70px 130px 100px 80px 1fr',
            }}
          >
            <span>Stock In</span>
            <span>Model · Storage</span>
            <span>Colour</span>
            <span>Supplier</span>
            <span>Marketplace</span>
            <span className="text-right">BP / Days</span>
            <span>Notes</span>
          </div>

          {/* SKU group rows — each group is collapsible; child rows show IMEI */}
          <div className="divide-y divide-gray-100">
            {pendingImeiGroups.map(group => {
              const groupKey = `pending-${group.key}`;
              const isOpen = expandedId === groupKey;
              const head = group.units[0];
              const qty = group.units.length;
              const groupOldestDays = group.units.reduce((max, u) => {
                const d = pendingKpis.daysSince(u.dateIn);
                return d > max ? d : max;
              }, 0);
              const groupBP = group.units.reduce((s, u) => s + (u.buyPrice || 0), 0);
              const stale = groupOldestDays > 30;
              const titleParts = [
                group.sku.brand,
                group.sku.model,
                group.sku.storage,
                group.colour || null,
              ].filter(Boolean);
              return (
                <div key={groupKey}>
                  <button
                    type="button"
                    onClick={() => setExpandedId(isOpen ? null : groupKey)}
                    className="w-full text-left flex items-center gap-3 px-4 py-3 hover:bg-indigo-50/50 transition-all"
                  >
                    <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center flex-shrink-0">
                      <Inbox size={14} className="text-indigo-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-xs font-bold truncate">{titleParts.join(' · ')}</p>
                        <span className="text-[9px] font-bold text-indigo-700 bg-indigo-100 px-1.5 py-0.5 rounded font-mono flex-shrink-0">
                          ×{qty}
                        </span>
                        {stale && (
                          <span
                            className="flex items-center gap-1 text-[8px] font-bold uppercase tracking-widest text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded font-mono flex-shrink-0"
                            title={`${groupOldestDays} days since stock in — flagged as stale`}
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> Stale
                          </span>
                        )}
                      </div>
                      <p className="text-[9px] text-gray-400 font-mono mt-0.5">
                        {qty} unit{qty === 1 ? '' : 's'} · oldest {groupOldestDays}d · {supplierMap[head.supplierId] || head.supplierName || '—'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-sm font-bold">£{groupBP.toLocaleString()}</span>
                      <span className="p-1.5 text-gray-400">
                        {isOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                      </span>
                    </div>
                  </button>

                  <AnimatePresence>
                    {isOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden bg-gray-50 border-t border-gray-100"
                      >
                        <div
                          className="divide-y divide-gray-100"
                          style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
                        >
                          {group.units
                            .slice()
                            .sort((a, b) => new Date(a.dateIn || 0).getTime() - new Date(b.dateIn || 0).getTime())
                            .map(u => {
                              const days = pendingKpis.daysSince(u.dateIn);
                              const rowStale = days > 30;
                              const marketplace = (u.marketplace || '').trim();
                              return (
                                <div
                                  key={u.id}
                                  className="px-4 py-1.5 grid items-center gap-2 hover:bg-white transition-colors text-[10px] text-gray-700"
                                  style={{ gridTemplateColumns: '90px 1.6fr 70px 130px 100px 80px 1fr' }}
                                >
                                  <span className="text-gray-500">{u.dateIn || '—'}</span>
                                  <span className="flex items-center gap-2 min-w-0">
                                    <CopyImei imei={u.imei} truncate={14} />
                                    <span className="text-gray-400">·</span>
                                    <span className="text-gray-600 truncate">
                                      {[group.sku.model, group.sku.storage].filter(Boolean).join(' ')}
                                    </span>
                                  </span>
                                  <span className="text-gray-600 truncate">{u.colour || '—'}</span>
                                  <span className="text-gray-600 truncate">
                                    {supplierMap[u.supplierId] || u.supplierName || '—'}
                                  </span>
                                  <span className={`truncate ${marketplace ? 'text-gray-700' : 'text-gray-300'}`}>
                                    {marketplace || '—'}
                                  </span>
                                  <span className="text-right">
                                    <span className="font-bold text-gray-800">£{u.buyPrice}</span>
                                    <span className={`block text-[8px] font-mono ${rowStale ? 'text-amber-600' : 'text-gray-400'}`}>
                                      {days}d{rowStale && ' ●'}
                                    </span>
                                  </span>
                                  <span className="text-gray-500 truncate" title={u.notes || ''}>
                                    {u.notes || ''}
                                  </span>
                                </div>
                              );
                            })}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </CollapsibleSection>
      )}

      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by model, IMEI or buy price…"
          className="w-full pl-10 pr-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-black transition-all"
        />
      </div>

      {/* Recent stock (non-SHS) — grouped by SKU (brand+model+storage+colour+status)
          so importing 6 identical Samsung S21 128GBs collapses to a single
          expandable row instead of stacking 6 duplicates. Search runs BEFORE
          grouping so IMEI substrings still match groups that contain them. */}
      <CollapsibleSection
        title="Recent Stock In"
        count={filtered.length}
        accent="border-l-emerald-500"
        defaultOpen={false}
      >
        {filtered.length === 0 ? (
          <div className="py-12 flex flex-col items-center gap-2 text-gray-300">
            <PackagePlus size={32} />
            <p className="text-xs font-mono">No stock records yet</p>
          </div>
        ) : (
          <>
            <div className="px-4 py-2 text-[9px] text-gray-400 font-mono uppercase tracking-widest border-b border-gray-50">
              {filtered.length} units across {recentStockGroups.length} SKUs
            </div>
            <div className="divide-y divide-gray-50">
              {recentStockGroups.map(group => {
                const isOpen = expandedId === group.key;
                const head = group.units[0];
                const isSHS = head.batchId?.startsWith('shs_') || head.notes?.includes('SHS');
                const qty = group.units.length;
                const latestDateIn = group.units.reduce(
                  (acc, u) => (u.dateIn > acc ? u.dateIn : acc),
                  group.units[0].dateIn,
                );
                const titleParts = [
                  group.sku.brand,
                  group.sku.model,
                  group.sku.storage,
                  head.colour && head.colour !== 'Unknown' ? head.colour : null,
                ].filter(Boolean);
                return (
                  <div key={group.key}>
                    <button
                      type="button"
                      onClick={() => setExpandedId(isOpen ? null : group.key)}
                      className={`w-full text-left flex items-center gap-3 px-4 py-3 transition-all ${
                        isSHS ? 'bg-orange-50/60 hover:bg-orange-50' : 'hover:bg-gray-50'
                      }`}
                    >
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${latestDateIn === today ? 'bg-emerald-100' : 'bg-gray-100'}`}>
                        {latestDateIn === today
                          ? <CheckCircle2 size={14} className="text-emerald-600" />
                          : <Clock size={14} className="text-gray-400" />
                        }
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-xs font-bold truncate">{titleParts.join(' · ')}</p>
                          {head.status !== 'available' && (
                            <span className="text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded font-mono bg-gray-100 text-gray-600">
                              {head.status}
                            </span>
                          )}
                        </div>
                        <p className="text-[9px] text-gray-400 font-mono mt-0.5">
                          {qty} unit{qty === 1 ? '' : 's'} · latest {latestDateIn}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-sm font-bold">£{head.buyPrice}</span>
                        <span className="p-1.5 text-gray-400">
                          {isOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                        </span>
                      </div>
                    </button>
                    <AnimatePresence>
                      {isOpen && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden bg-gray-50 border-t border-gray-100"
                        >
                          <div className="divide-y divide-gray-100">
                            {group.units.map(u => (
                              <div key={u.id} className="px-5 py-2.5 flex items-center gap-3">
                                <div className="flex-1 min-w-0">
                                  <p className="text-[10px] font-mono text-gray-700 flex items-center gap-2 flex-wrap">
                                    <CopyImei imei={u.imei} truncate={14} />
                                    <span className="text-gray-400">·</span>
                                    <span className="text-gray-500">{supplierMap[u.supplierId] || '—'}</span>
                                    <span className="text-gray-400">·</span>
                                    <span className="text-gray-500">{u.dateIn}</span>
                                    <span className="text-gray-400">·</span>
                                    <span className="text-gray-500">{u.status}</span>
                                  </p>
                                  <p className="text-[8px] text-gray-400 font-mono mt-0.5">
                                    Batch: {u.batchId === 'master_batch' ? 'Master' : (u.batchId || 'Default')}
                                    {(u as any).storage ? ` · Storage: ${(u as any).storage}` : ''}
                                    {u.colour ? ` · Colour: ${u.colour}` : ''}
                                  </p>
                                </div>
                                <span className="text-[11px] font-bold font-mono">£{u.buyPrice}</span>
                              </div>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </CollapsibleSection>

      {/* Modals */}
      <AnimatePresence>
        {showAddDelivery && (
          <AddDeliveryModal
            onSelectSingle={() => {
              setShowAddDelivery(false);
              setShowScanUnit(true);
            }}
            onSelectBatch={() => {
              setShowAddDelivery(false);
              onOpenBatch();
            }}
            onClose={() => setShowAddDelivery(false)}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showScanUnit && <ScanInModal onClose={() => setShowScanUnit(false)} />}
      </AnimatePresence>
      <AnimatePresence>
        {showAddSHS && <AddSHSModal onClose={() => setShowAddSHS(false)} />}
      </AnimatePresence>
      <AnimatePresence>
        {receivingUnit && (
          <ReceiveSHSModal unit={receivingUnit} onClose={() => setReceivingUnit(null)} />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showTodayIntake && (
          <TodayIntakeModal units={todayIn} onClose={() => setShowTodayIntake(false)} />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showStockIntakeFlow && (
          <StockIntakeFlow onClose={() => setShowStockIntakeFlow(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}
