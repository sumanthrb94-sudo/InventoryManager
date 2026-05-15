// Admin · Data Management.
//
// One control panel for destructive / data-loading operations. Surfaces
// existing tools (Excel import, mock seeder, full reset) plus a new
// hard-delete-by-IMEI tool that lets an operator permanently remove a
// single unit from the database — the SHS active/inactive flow handles
// the routine archive case, so this is reserved for true cleanup
// (test rows, duplicates, mistyped IMEIs that won't sync).

import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  FileSpreadsheet, Database, Trash2, AlertTriangle,
  Search, ShieldAlert, CheckCircle2, Loader2,
} from 'lucide-react';
import { dbService } from '../../lib/dbService';
import { useInventoryStore } from '../../lib/inventoryStore';
import { logInventoryEvent } from '../../lib/inventoryEvents';
import ImportModal from '../ImportModal';
import LoadMockDataModal from '../LoadMockDataModal';
import ResetDataModal from '../ResetDataModal';

const normaliseImei = (s: string) => (s || '').replace(/\D/g, '');

export default function DataManagementPage() {
  const { units, suppliers } = useInventoryStore();

  const [showImport, setShowImport] = useState(false);
  const [showMock, setShowMock]     = useState(false);
  const [showReset, setShowReset]   = useState(false);

  // Hard delete state
  const [search, setSearch] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [lastDeleted, setLastDeleted] = useState<string | null>(null);
  const [error, setError] = useState('');

  // DB stats — high-level health summary so an admin can sanity-check
  // before doing anything destructive.
  const stats = useMemo(() => {
    const byStatus: Record<string, number> = {};
    let inactiveSHS = 0;
    for (const u of units) {
      byStatus[u.status] = (byStatus[u.status] || 0) + 1;
      if (u.status === 'incoming' && u.active === false) inactiveSHS++;
    }
    return {
      total: units.length,
      available: byStatus.available || 0,
      sold: byStatus.sold || 0,
      incoming: byStatus.incoming || 0,
      returned: byStatus.returned || 0,
      inactiveSHS,
      suppliers: suppliers.length,
    };
  }, [units, suppliers]);

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    const qDigits = normaliseImei(q);
    return units
      .filter(u => {
        if (qDigits && normaliseImei(u.imei).includes(qDigits)) return true;
        if (u.model.toLowerCase().includes(q)) return true;
        if (u.id.toLowerCase().includes(q)) return true;
        return false;
      })
      .slice(0, 25);
  }, [search, units]);

  const handleHardDelete = async (unitId: string) => {
    setError('');
    setDeletingId(unitId);
    try {
      await dbService.delete('inventoryUnits', unitId);
      try {
        await logInventoryEvent({
          type: 'unit_deleted',
          message: `Unit ${unitId} hard-deleted via Admin · Data Management`,
          unitId,
        });
      } catch {
        // Event logging is best-effort — don't fail the delete on it.
      }
      setLastDeleted(unitId);
      setConfirmDeleteId(null);
    } catch (err: any) {
      setError(err?.message || 'Hard delete failed — check Firestore connection');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h2 className="text-xl sm:text-2xl font-bold tracking-tighter uppercase font-display flex items-center gap-3">
          <span className="w-8 h-8 bg-slate-900 text-white rounded-lg flex items-center justify-center flex-shrink-0">
            <Database size={16} />
          </span>
          Data Management
        </h2>
        <p className="text-[10px] text-gray-400 font-mono uppercase tracking-widest mt-1">
          Import · Mock data · Reset · Hard delete · Master controls
        </p>
      </div>

      {/* DB stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total Units',  value: stats.total,      tone: 'bg-slate-50 border-slate-200 text-slate-900' },
          { label: 'Available',    value: stats.available,  tone: 'bg-emerald-50 border-emerald-200 text-emerald-900' },
          { label: 'Sold',         value: stats.sold,       tone: 'bg-blue-50 border-blue-200 text-blue-900' },
          { label: 'Incoming SHS', value: stats.incoming,   tone: 'bg-amber-50 border-amber-200 text-amber-900' },
          { label: 'Returned',     value: stats.returned,   tone: 'bg-orange-50 border-orange-200 text-orange-900' },
          { label: 'Inactive SHS', value: stats.inactiveSHS,tone: 'bg-gray-50 border-gray-200 text-gray-900' },
          { label: 'Suppliers',    value: stats.suppliers,  tone: 'bg-purple-50 border-purple-200 text-purple-900' },
        ].map(s => (
          <div key={s.label} className={`px-4 py-3 rounded-xl border ${s.tone}`}>
            <p className="text-[9px] font-mono uppercase tracking-widest opacity-70">{s.label}</p>
            <p className="text-2xl font-bold leading-tight mt-0.5 tabular-nums">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Bulk data ops */}
      <section className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Bulk Data Ops</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-gray-100">
          <ActionCard
            icon={<FileSpreadsheet size={18} />}
            iconBg="bg-blue-100 text-blue-700"
            title="Import Excel"
            description="Bulk import inventory from an .xlsx file. Existing rows can be updated by IMEI."
            action="Open Importer"
            actionTone="bg-blue-600 hover:bg-blue-700 text-white"
            onClick={() => setShowImport(true)}
          />
          <ActionCard
            icon={<Database size={18} />}
            iconBg="bg-emerald-100 text-emerald-700"
            title="Load Mock Data"
            description="Seed the database with a curated sample inventory for demos and QA."
            action="Open Loader"
            actionTone="bg-emerald-600 hover:bg-emerald-700 text-white"
            onClick={() => setShowMock(true)}
          />
          <ActionCard
            icon={<Trash2 size={18} />}
            iconBg="bg-red-100 text-red-700"
            title="Reset All Data"
            description="Permanently wipe every collection from Firestore. Use before re-seeding."
            action="Open Reset"
            actionTone="bg-red-600 hover:bg-red-700 text-white"
            danger
            onClick={() => setShowReset(true)}
          />
        </div>
      </section>

      {/* Hard delete unit */}
      <section className="bg-white rounded-2xl border border-red-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-red-100 bg-red-50 flex items-start gap-3">
          <ShieldAlert size={16} className="text-red-600 mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-red-900 uppercase tracking-tight">Hard Delete Unit</p>
            <p className="text-[10px] text-red-700 font-mono mt-0.5 leading-relaxed">
              Permanent · Cannot be undone · Bypasses the SHS active/inactive flow.
              Use only for test rows, duplicates, or mistyped IMEIs that need to leave the DB.
            </p>
          </div>
        </div>

        <div className="p-5 space-y-4">
          <div className="relative">
            <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={e => { setSearch(e.target.value); setError(''); }}
              placeholder="Search by IMEI, model, or unit ID…"
              className="w-full pl-10 pr-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-red-500 transition-all"
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
              <AlertTriangle size={14} className="text-red-600 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-red-700">{error}</p>
            </div>
          )}

          {lastDeleted && (
            <div className="flex items-start gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
              <CheckCircle2 size={14} className="text-emerald-600 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-emerald-700">
                Unit <span className="font-mono font-bold">{lastDeleted}</span> deleted from database.
              </p>
            </div>
          )}

          {search.trim() && searchResults.length === 0 && (
            <p className="text-xs text-gray-400 font-mono py-4 text-center">No matching units.</p>
          )}

          {searchResults.length > 0 && (
            <div className="border border-gray-200 rounded-xl divide-y divide-gray-100 overflow-hidden">
              {searchResults.map(u => {
                const isConfirming = confirmDeleteId === u.id;
                const isDeleting = deletingId === u.id;
                return (
                  <div key={u.id} className="px-4 py-3 flex items-center gap-3 hover:bg-gray-50">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-xs font-bold truncate">{u.model}</p>
                        <span className={`text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded font-mono flex-shrink-0 ${
                          u.status === 'available' ? 'bg-emerald-100 text-emerald-700' :
                          u.status === 'sold'      ? 'bg-blue-100 text-blue-700' :
                          u.status === 'incoming'  ? (u.active === false ? 'bg-gray-200 text-gray-600' : 'bg-amber-100 text-amber-700') :
                          u.status === 'returned'  ? 'bg-orange-100 text-orange-700' :
                          'bg-gray-100 text-gray-600'
                        }`}>
                          {u.status === 'incoming' && u.active === false ? 'inactive' : u.status}
                        </span>
                      </div>
                      <p className="text-[10px] text-gray-500 font-mono mt-0.5 truncate">
                        <span className="font-bold">{u.imei || u.id}</span>
                        {u.colour ? ` · ${u.colour}` : ''}
                        {(u as any).storage ? ` · ${(u as any).storage}` : ''}
                        {u.dateIn ? ` · ${u.dateIn}` : ''}
                      </p>
                    </div>

                    {!isConfirming ? (
                      <button
                        type="button"
                        onClick={() => { setConfirmDeleteId(u.id); setLastDeleted(null); }}
                        className="flex-shrink-0 px-3 py-1.5 border border-red-200 text-red-700 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-red-50 transition-all flex items-center gap-1.5"
                      >
                        <Trash2 size={11} /> Delete
                      </button>
                    ) : (
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          disabled={isDeleting}
                          className="px-3 py-1.5 border border-gray-200 rounded-lg text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => handleHardDelete(u.id)}
                          disabled={isDeleting}
                          className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-red-700 transition-all disabled:opacity-50 flex items-center gap-1.5"
                        >
                          {isDeleting
                            ? <><Loader2 size={11} className="animate-spin" /> Deleting…</>
                            : <><Trash2 size={11} /> Confirm</>
                          }
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <AnimatePresence>
        {showImport && <ImportModal onClose={() => setShowImport(false)} />}
        {showMock && <LoadMockDataModal onClose={() => setShowMock(false)} />}
        {showReset && <ResetDataModal onClose={() => setShowReset(false)} />}
      </AnimatePresence>
    </div>
  );
}

interface ActionCardProps {
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  description: string;
  action: string;
  actionTone: string;
  danger?: boolean;
  onClick: () => void;
}

function ActionCard({ icon, iconBg, title, description, action, actionTone, danger, onClick }: ActionCardProps) {
  return (
    <div className={`p-5 flex flex-col gap-3 ${danger ? 'bg-red-50/30' : ''}`}>
      <div className="flex items-start gap-3">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${iconBg}`}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-900">{title}</p>
          <p className="text-[10px] text-gray-500 font-mono mt-1 leading-relaxed">{description}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={onClick}
        className={`mt-auto py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all ${actionTone}`}
      >
        {action}
      </button>
    </div>
  );
}
