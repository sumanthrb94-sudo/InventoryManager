/**
 * ReconciliationDashboard — cross-reference inventoryUnits ↔ sales to detect
 * orphans, phantom SHS placeholders, and mismatches. Surfaces a daily sanity
 * check so the operator can answer:
 *   - "Do all sold units have matching sales?"
 *   - "Do all sales have matching inventory units?"
 *   - "Are there phantom SHS placeholders that should be cleaned up?"
 *   - "Which units came from orphan sales vs normal stock entry?"
 *
 * Triggered from BuySheet's action row or as a standalone view. Read-only
 * (no Firestore writes) — purely diagnostic.
 */
import React, { useMemo } from 'react';
import {
  X, AlertTriangle, CheckCircle2, Link2, Unlink,
  Package, Truck, TrendingUp, AlertOctagon,
  Search,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useInventoryStore } from '../lib/inventoryStore';
import { useIsAdmin } from '../lib/useIsAdmin';

type HealthStatus = 'healthy' | 'warning' | 'critical';

interface ReconRow {
  imei: string;
  model: string;
  unitStatus: string;
  hasSale: boolean;
  hasUnit: boolean;
  isPhantomShs: boolean;
  isOrphanSale: boolean;
  source: string;
}

export default function ReconciliationDashboard({ onClose }: { onClose: () => void }) {
  const { units, sales, aggregates } = useInventoryStore();
  const isAdmin = useIsAdmin();

  // ── Build cross-reference ────────────────────────────────────────────────
  const reconRows = useMemo<ReconRow[]>(() => {
    const rows: ReconRow[] = [];
    const salesByImei = new Map<string, typeof sales[0]>();
    for (const s of sales) {
      const key = (s.imei || '').trim().toUpperCase();
      if (key && !salesByImei.has(key)) salesByImei.set(key, s);
    }

    // Every inventory unit
    for (const u of units) {
      const imei = (u.imei || '').trim().toUpperCase();
      const hasSale = imei ? salesByImei.has(imei) : false;
      const isPhantomShs =
        u.status === 'incoming'
        && (u.id || '').startsWith('shs_')
        && !hasSale;
      rows.push({
        imei: u.imei || u.id || '—',
        model: u.model || '—',
        unitStatus: u.status || 'unknown',
        hasSale,
        hasUnit: true,
        isPhantomShs,
        isOrphanSale: false,
        source: u.importBatchId ? `import:${u.importBatchId?.slice(0, 12)}` : (u.batchId ? `batch:${u.batchId?.slice(0, 12)}` : 'manual'),
      });
    }

    // Every sale without a matching unit (orphan sales)
    for (const s of sales) {
      if (s.voidedAt) continue;
      const imei = (s.imei || '').trim().toUpperCase();
      if (!imei) continue;
      const unit = rows.find(r => r.imei.toUpperCase() === imei);
      if (!unit) {
        rows.push({
          imei: s.imei || '—',
          model: s.sku || '—',
          unitStatus: 'no-unit',
          hasSale: true,
          hasUnit: false,
          isPhantomShs: false,
          isOrphanSale: true,
          source: s.importBatchId ? `sale-import:${s.importBatchId?.slice(0, 12)}` : 'manual-sale',
        });
      }
    }

    return rows;
  }, [units, sales]);

  // ── Compute health metrics ───────────────────────────────────────────────
  const metrics = useMemo(() => {
    const soldUnits = reconRows.filter(r => r.unitStatus === 'sold');
    const soldWithoutSale = soldUnits.filter(r => !r.hasSale);
    const orphanSales = reconRows.filter(r => r.isOrphanSale);
    const phantomShs = reconRows.filter(r => r.isPhantomShs);
    const availableUnits = reconRows.filter(r => r.unitStatus === 'available');
    const incomingUnits = reconRows.filter(r => r.unitStatus === 'incoming');
    const returnedUnits = reconRows.filter(r => r.unitStatus === 'returned');

    const orphanCount = orphanSales.length;
    const phantomCount = phantomShs.length;
    const mismatchCount = soldWithoutSale.length;
    const totalHealth: HealthStatus =
      orphanCount > 0 || phantomCount > 0 || mismatchCount > 0 ? 'critical' :
      orphanCount > 0 || phantomCount > 0 ? 'warning' : 'healthy';

    return {
      totalUnits: units.length,
      totalSales: sales.length,
      totalAggregates: aggregates.length,
      soldUnits: soldUnits.length,
      soldWithoutSale: soldWithoutSale.length,
      orphanSales: orphanCount,
      phantomShs: phantomCount,
      availableUnits: availableUnits.length,
      incomingUnits: incomingUnits.length,
      returnedUnits: returnedUnits.length,
      totalHealth,
      healthyPercent: reconRows.length > 0
        ? Math.round(((reconRows.length - orphanCount - phantomCount - mismatchCount) / reconRows.length) * 100)
        : 100,
    };
  }, [reconRows, units.length, sales.length, aggregates.length]);

  // ── Filter state ─────────────────────────────────────────────────────────
  const [filter, setFilter] = React.useState<'all' | 'orphans' | 'phantoms' | 'mismatches' | 'healthy'>('all');
  const [search, setSearch] = React.useState('');

  const filteredRows = useMemo(() => {
    let rows = reconRows;
    if (filter === 'orphans') rows = rows.filter(r => r.isOrphanSale);
    else if (filter === 'phantoms') rows = rows.filter(r => r.isPhantomShs);
    else if (filter === 'mismatches') rows = rows.filter(r => r.unitStatus === 'sold' && !r.hasSale);
    else if (filter === 'healthy') rows = rows.filter(r => !r.isOrphanSale && !r.isPhantomShs && !(r.unitStatus === 'sold' && !r.hasSale));
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(r =>
        r.imei.toLowerCase().includes(q) ||
        r.model.toLowerCase().includes(q) ||
        r.source.toLowerCase().includes(q)
      );
    }
    return rows;
  }, [reconRows, filter, search]);

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm p-0 md:p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0 }}
        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        onClick={e => e.stopPropagation()}
        className="bg-white w-full md:max-w-5xl rounded-t-3xl md:rounded-3xl shadow-2xl flex flex-col overflow-hidden"
        style={{ maxHeight: 'calc(100dvh - 24px)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100 flex-shrink-0">
          <div className="min-w-0">
            <h3 className="text-sm font-bold tracking-tight flex items-center gap-2">
              <Link2 size={16} className="text-slate-500" />
              Reconciliation Dashboard
            </h3>
            <p className="text-[10px] font-mono text-slate-400 mt-0.5">
              Cross-reference inventory ↔ sales · {metrics.healthyPercent}% healthy
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-4">
          {/* Health banner */}
          <HealthBanner metrics={metrics} />

          {/* KPI tiles */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <KpiTile
              icon={<Package size={14} />}
              label="Office Stock"
              value={metrics.availableUnits}
              tone="emerald"
            />
            <KpiTile
              icon={<Truck size={14} />}
              label="SHS Incoming"
              value={metrics.incomingUnits}
              tone="amber"
            />
            <KpiTile
              icon={<TrendingUp size={14} />}
              label="Sold"
              value={metrics.soldUnits}
              tone="blue"
            />
            <KpiTile
              icon={<AlertOctagon size={14} />}
              label="Returned"
              value={metrics.returnedUnits}
              tone="rose"
            />
          </div>

          {/* Issue tiles */}
          {(metrics.orphanSales > 0 || metrics.phantomShs > 0 || metrics.soldWithoutSale > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              {metrics.orphanSales > 0 && (
                <IssueTile
                  icon={<Unlink size={14} />}
                  label="Orphan Sales"
                  value={metrics.orphanSales}
                  desc="Sales with no matching inventory unit"
                  tone="rose"
                  onClick={() => setFilter('orphans')}
                />
              )}
              {metrics.phantomShs > 0 && (
                <IssueTile
                  icon={<AlertTriangle size={14} />}
                  label="Phantom SHS"
                  value={metrics.phantomShs}
                  desc="SHS placeholders never received or sold"
                  tone="amber"
                  onClick={() => setFilter('phantoms')}
                />
              )}
              {metrics.soldWithoutSale > 0 && (
                <IssueTile
                  icon={<AlertOctagon size={14} />}
                  label="Sold w/o Sale"
                  value={metrics.soldWithoutSale}
                  desc="Units marked sold but no sale doc linked"
                  tone="rose"
                  onClick={() => setFilter('mismatches')}
                />
              )}
            </div>
          )}

          {/* Filter + search */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-0">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search IMEI, model, source…"
                className="w-full pl-8 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-[11px] focus:outline-none focus:border-slate-900"
              />
            </div>
            <FilterPill label="All" count={reconRows.length} active={filter === 'all'} onClick={() => setFilter('all')} />
            <FilterPill label="Orphans" count={reconRows.filter(r => r.isOrphanSale).length} active={filter === 'orphans'} onClick={() => setFilter('orphans')} tone="rose" />
            <FilterPill label="Phantoms" count={reconRows.filter(r => r.isPhantomShs).length} active={filter === 'phantoms'} onClick={() => setFilter('phantoms')} tone="amber" />
            <FilterPill label="Mismatches" count={reconRows.filter(r => r.unitStatus === 'sold' && !r.hasSale).length} active={filter === 'mismatches'} onClick={() => setFilter('mismatches')} tone="rose" />
            <FilterPill label="Healthy" count={reconRows.filter(r => !r.isOrphanSale && !r.isPhantomShs && !(r.unitStatus === 'sold' && !r.hasSale)).length} active={filter === 'healthy'} onClick={() => setFilter('healthy')} tone="emerald" />
          </div>

          {/* Data table */}
          <div className="border border-slate-200 rounded-2xl overflow-hidden">
            <table className="w-full text-[11px] border-separate border-spacing-0">
              <thead>
                <tr className="text-[9px] font-bold uppercase tracking-widest text-slate-500 bg-slate-50">
                  <th className="px-3 py-2 text-left border-b border-slate-200">IMEI / ID</th>
                  <th className="px-3 py-2 text-left border-b border-slate-200">Model</th>
                  <th className="px-3 py-2 text-left border-b border-slate-200">Status</th>
                  <th className="px-3 py-2 text-center border-b border-slate-200">Has Sale</th>
                  <th className="px-3 py-2 text-center border-b border-slate-200">Has Unit</th>
                  <th className="px-3 py-2 text-left border-b border-slate-200">Issue</th>
                  <th className="px-3 py-2 text-left border-b border-slate-200">Source</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-slate-400 font-mono text-[11px]">
                      {filter === 'all' ? 'No data — import some stock and sales first' : 'No rows match the current filter'}
                    </td>
                  </tr>
                ) : (
                  filteredRows.slice(0, 200).map((row, idx) => {
                    const issue = row.isOrphanSale ? 'Orphan Sale' :
                      row.isPhantomShs ? 'Phantom SHS' :
                      row.unitStatus === 'sold' && !row.hasSale ? 'Sold w/o Sale' : 'OK';
                    const issueTone = issue === 'OK' ? 'text-emerald-700 bg-emerald-50' :
                      issue === 'Phantom SHS' ? 'text-amber-700 bg-amber-50' :
                      'text-rose-700 bg-rose-50';
                    const statusTone = row.unitStatus === 'available' ? 'text-emerald-700 bg-emerald-50 border-emerald-200' :
                      row.unitStatus === 'sold' ? 'text-blue-700 bg-blue-50 border-blue-200' :
                      row.unitStatus === 'incoming' ? 'text-amber-700 bg-amber-50 border-amber-200' :
                      row.unitStatus === 'returned' ? 'text-rose-700 bg-rose-50 border-rose-200' :
                      'text-slate-600 bg-slate-100 border-slate-200';
                    return (
                      <tr key={`${row.imei}-${idx}`} className={idx % 2 === 1 ? 'bg-slate-50/40' : 'bg-white'}>
                        <td className="px-3 py-1.5 border-b border-slate-100 font-mono text-slate-700 truncate max-w-[140px]" title={row.imei}>
                          {row.imei}
                        </td>
                        <td className="px-3 py-1.5 border-b border-slate-100 text-slate-700 truncate max-w-[180px]" title={row.model}>
                          {row.model}
                        </td>
                        <td className="px-3 py-1.5 border-b border-slate-100">
                          <span className={`inline-flex items-center gap-1 text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded border ${statusTone}`}>
                            {row.unitStatus}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 border-b border-slate-100 text-center">
                          {row.hasSale
                            ? <CheckCircle2 size={12} className="text-emerald-500 inline" />
                            : <span className="text-slate-300">—</span>
                          }
                        </td>
                        <td className="px-3 py-1.5 border-b border-slate-100 text-center">
                          {row.hasUnit
                            ? <CheckCircle2 size={12} className="text-emerald-500 inline" />
                            : <span className="text-slate-300">—</span>
                          }
                        </td>
                        <td className="px-3 py-1.5 border-b border-slate-100">
                          <span className={`inline-flex items-center gap-1 text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded ${issueTone}`}>
                            {issue}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 border-b border-slate-100 text-slate-500 font-mono text-[9px] truncate max-w-[120px]">
                          {row.source}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
            {filteredRows.length > 200 && (
              <p className="px-3 py-2 text-[9px] font-mono text-slate-400 text-center border-t border-slate-100">
                Showing 200 of {filteredRows.length} rows — use filters to narrow
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 flex items-center justify-between gap-2 px-5 py-3 border-t border-slate-100 bg-slate-50/60">
          <p className="text-[9px] font-mono text-slate-400">
            {isAdmin ? 'Admin view — full diagnostics' : 'Employee view — read-only'}
          </p>
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-[10px] font-bold uppercase tracking-widest hover:bg-slate-700"
          >
            Close
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function HealthBanner({ metrics }: { metrics: { totalHealth: HealthStatus; healthyPercent: number; totalUnits: number; totalSales: number } }) {
  const { totalHealth, healthyPercent, totalUnits, totalSales } = metrics;
  const bg = totalHealth === 'healthy' ? 'bg-emerald-50 border-emerald-200' :
    totalHealth === 'warning' ? 'bg-amber-50 border-amber-200' :
    'bg-rose-50 border-rose-200';
  const text = totalHealth === 'healthy' ? 'text-emerald-900' :
    totalHealth === 'warning' ? 'text-amber-900' :
    'text-rose-900';
  const Icon = totalHealth === 'healthy' ? CheckCircle2 :
    totalHealth === 'warning' ? AlertTriangle :
    AlertOctagon;

  return (
    <div className={`${bg} border rounded-2xl p-4 flex items-start gap-3`}>
      <Icon size={22} className={`flex-shrink-0 mt-0.5 ${totalHealth === 'healthy' ? 'text-emerald-600' : totalHealth === 'warning' ? 'text-amber-600' : 'text-rose-600'}`} />
      <div className="flex-1 min-w-0">
        <p className={`text-[13px] font-bold ${text}`}>
          {totalHealth === 'healthy' ? 'All clear — inventory and sales are in sync'
            : totalHealth === 'warning' ? 'Minor issues detected — review recommended'
            : 'Critical issues found — immediate action required'}
        </p>
        <p className="text-[11px] text-slate-600 mt-1">
          {totalUnits.toLocaleString()} inventory units · {totalSales.toLocaleString()} sales · {healthyPercent}% reconciled
        </p>
      </div>
      <div className="flex-shrink-0">
        <div className={`w-12 h-12 rounded-full border-4 ${totalHealth === 'healthy' ? 'border-emerald-400' : totalHealth === 'warning' ? 'border-amber-400' : 'border-rose-400'} flex items-center justify-center`}>
          <span className={`text-[13px] font-bold ${text}`}>{healthyPercent}%</span>
        </div>
      </div>
    </div>
  );
}

function KpiTile({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: string }) {
  const tones: Record<string, string> = {
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    amber: 'bg-amber-50 border-amber-200 text-amber-800',
    blue: 'bg-blue-50 border-blue-200 text-blue-800',
    rose: 'bg-rose-50 border-rose-200 text-rose-800',
  };
  return (
    <div className={`${tones[tone]} border rounded-xl p-3 flex items-center gap-3`}>
      <span className="text-slate-500">{icon}</span>
      <div>
        <p className="text-lg font-bold leading-none">{value.toLocaleString()}</p>
        <p className="text-[9px] font-mono uppercase tracking-widest opacity-70 mt-1">{label}</p>
      </div>
    </div>
  );
}

function IssueTile({ icon, label, value, desc, tone, onClick }: {
  icon: React.ReactNode; label: string; value: number; desc: string;
  tone: string; onClick: () => void;
}) {
  const tones: Record<string, string> = {
    rose: 'bg-rose-50 border-rose-200 hover:border-rose-400',
    amber: 'bg-amber-50 border-amber-200 hover:border-amber-400',
  };
  return (
    <button
      onClick={onClick}
      className={`${tones[tone]} border rounded-xl p-3 text-left transition-all cursor-pointer w-full`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-slate-500">{icon}</span>
        <span className="text-[11px] font-bold text-slate-800">{label}</span>
        <span className="ml-auto text-lg font-bold text-slate-900">{value}</span>
      </div>
      <p className="text-[9px] font-mono text-slate-500">{desc}</p>
      <p className="text-[8px] font-mono text-slate-400 mt-1 uppercase tracking-wider">Click to filter</p>
    </button>
  );
}

function FilterPill({ label, count, active, onClick, tone }: {
  label: string; count: number; active: boolean; onClick: () => void; tone?: string;
}) {
  const base = 'px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest border transition-all flex-shrink-0';
  const activeCls = tone === 'rose'
    ? 'bg-rose-600 text-white border-rose-600'
    : tone === 'amber'
    ? 'bg-amber-600 text-white border-amber-600'
    : tone === 'emerald'
    ? 'bg-emerald-600 text-white border-emerald-600'
    : 'bg-slate-900 text-white border-slate-900';
  const inactiveCls = 'bg-white text-slate-600 border-slate-200 hover:border-slate-400';
  return (
    <button onClick={onClick} className={`${base} ${active ? activeCls : inactiveCls}`}>
      {label} <span className={`ml-1 ${active ? 'opacity-70' : 'text-slate-400'}`}>{count}</span>
    </button>
  );
}
