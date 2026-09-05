/**
 * Deleted Units — what left inventory, who removed it, when and why.
 *
 * The unit documents themselves are gone; these are the tombstones written
 * before each delete (services/deletedUnitArchive.ts). The collection is
 * append-only and no client role can delete from it, so this page is a
 * read-and-export surface by design — there is deliberately nothing here that
 * edits or removes a record.
 *
 * TWO THINGS THIS SCREEN HAS TO SAY OUT LOUD, or it will be misread:
 *
 *   1. The archive starts on the day it shipped. "No record" means "not
 *      recorded", NOT "never deleted" — 516 earlier deletions were never
 *      captured and are not being back-filled. The empty state says so.
 *   2. A VOID record is one whose archive write landed but whose delete then
 *      failed, so the unit is still in stock. It is kept (append-only) but
 *      must never be read as a deletion, so it is labelled and excluded from
 *      the headline count.
 */
import React, { useMemo, useState } from 'react';
import { Search, Download, Trash2, AlertTriangle, ShieldCheck } from 'lucide-react';
import { useInventoryStore, useLazyCollection } from '../lib/inventoryStore';
import { usePagedRows } from './PaginationBar';
import PaginationBar from './PaginationBar';
import { downloadCsv } from '../lib/csv';
import { formatDeletionDate } from '../lib/deletedUnitLookup';
import type { DeletedUnitRecord } from '../types';

/** Free text, so it may be blank or punctuation — see the archive's own note. */
function readableReason(reason: string | undefined): string {
  const r = (reason || '').trim();
  return /[a-z0-9]/i.test(r) ? r : '(no reason recorded)';
}

export default function DeletedUnitsPage() {
  // Opened here and only here: the archive grows by a document per deletion
  // and no other screen reads it whole.
  useLazyCollection('deletedUnits');
  const { deletedUnits } = useInventoryStore();
  const [q, setQ] = useState('');

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const matches = (r: DeletedUnitRecord) => {
      if (!needle) return true;
      return [r.imei, r.model, r.storage, r.colour, r.grade, r.supplierName, r.reason, r.deletedBy]
        .some(v => (v || '').toString().toLowerCase().includes(needle));
    };
    return [...deletedUnits]
      .filter(matches)
      .sort((a, b) => (b.deletedAt || '').localeCompare(a.deletedAt || ''));
  }, [deletedUnits, q]);

  const liveCount = useMemo(() => deletedUnits.filter(r => !r.voided).length, [deletedUnits]);
  const voidCount = deletedUnits.length - liveCount;
  const { page, setPage, totalPages, paged, total } = usePagedRows<DeletedUnitRecord>(rows);

  const exportCsv = () => {
    // Built from `rows`, so the export is exactly what the operator filtered
    // to — a CSV that ignores the search box is the classic way an export
    // gets quietly mistrusted.
    downloadCsv(
      `deleted-units-${new Date().toISOString().slice(0, 10)}.csv`,
      rows.map(r => ({
        'Deleted At': r.deletedAt || '',
        'Deleted By': r.deletedBy || '',
        'IMEI': r.imei || '',
        'Model': r.model || '',
        'Storage': r.storage || '',
        'Colour': r.colour || '',
        'Grade': r.grade || '',
        'Supplier': r.supplierName || '',
        'Buy Price': r.buyPrice ?? '',
        'Status When Deleted': r.status || '',
        'Date In': r.dateIn || '',
        'Reason': r.reason || '',
        'Source': r.source || '',
        'Voided': r.voided ? 'YES' : '',
        'Void Reason': r.voidedReason || '',
      })),
    );
  };

  return (
    <div className="space-y-4">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-[9px] font-mono uppercase tracking-widest text-slate-400">
              Append-only · nobody can delete this log
            </p>
            <h2 className="text-sm font-bold tracking-tight flex items-center gap-2">
              <Trash2 size={14} className="text-rose-600" /> Deleted Units · {liveCount}
            </h2>
            <p className="text-[10px] text-slate-500 mt-1 font-mono">
              Every unit removed from inventory since the archive went live, with who removed it and why.
            </p>
          </div>
          <button
            onClick={exportCsv}
            disabled={rows.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 text-white text-[10px] font-bold uppercase tracking-widest hover:bg-slate-700 transition-all disabled:opacity-40"
          >
            <Download size={12} /> Export CSV
          </button>
        </div>

        <div className="mt-4 relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search IMEI, model, supplier, reason, who deleted it…"
            className="w-full border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-[12px] focus:outline-none focus:border-slate-900 transition-all"
          />
        </div>

        {voidCount > 0 && (
          <p className="mt-2 text-[10px] font-mono text-amber-700 flex items-center gap-1.5">
            <AlertTriangle size={11} />
            {voidCount} void record{voidCount === 1 ? '' : 's'} — the archive was written but the delete
            failed, so those units are still in stock. Kept for the audit trail, not counted above.
          </p>
        )}
      </div>

      {/* ── Table ──────────────────────────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden">
        {total === 0 ? (
          <div className="py-16 px-6 text-center space-y-2">
            <ShieldCheck size={26} className="mx-auto text-slate-300" />
            <p className="text-[11px] font-bold text-slate-600">
              {deletedUnits.length === 0 ? 'No deletions recorded yet' : 'Nothing matches that search'}
            </p>
            {deletedUnits.length === 0 && (
              <p className="text-[10px] font-mono text-slate-400 max-w-md mx-auto leading-relaxed">
                The archive records deletions from the day it went live. Units removed before then were
                never captured and do not appear here — an empty list means "nothing recorded", not
                "nothing deleted".
              </p>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] border-separate border-spacing-0">
              <thead>
                <tr className="text-[9px] font-bold uppercase tracking-widest text-slate-500 bg-slate-50">
                  <th className="px-3 py-2 text-left border-b border-slate-200">Deleted</th>
                  <th className="px-3 py-2 text-left border-b border-slate-200">IMEI</th>
                  <th className="px-3 py-2 text-left border-b border-slate-200">Model</th>
                  <th className="px-3 py-2 text-left border-b border-slate-200">Supplier</th>
                  <th className="px-3 py-2 text-right border-b border-slate-200 w-20">BP (£)</th>
                  <th className="px-3 py-2 text-left border-b border-slate-200">Reason</th>
                  <th className="px-3 py-2 text-left border-b border-slate-200">By</th>
                </tr>
              </thead>
              <tbody>
                {paged.map(r => (
                  <tr
                    key={r.id}
                    className={`transition-colors ${r.voided ? 'bg-amber-50/50' : 'bg-white hover:bg-slate-50'}`}
                  >
                    <td className="px-3 py-1.5 border-b border-slate-100 whitespace-nowrap font-mono text-slate-600">
                      {formatDeletionDate(r.deletedAt)}
                      {r.voided && (
                        <span className="ml-1.5 text-[9px] font-bold uppercase tracking-widest text-amber-700"
                          title={r.voidedReason || 'The delete failed after the record was written'}>
                          void
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 border-b border-slate-100 font-mono text-slate-900">
                      {r.imei || <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-3 py-1.5 border-b border-slate-100 text-slate-700">
                      {r.model || '—'}
                      {(r.storage || r.colour || r.grade) && (
                        <span className="text-slate-400 font-mono text-[10px]">
                          {' · '}{[r.storage, r.colour, r.grade].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 border-b border-slate-100 text-slate-600">
                      {r.supplierName || '—'}
                    </td>
                    <td className="px-3 py-1.5 border-b border-slate-100 text-right font-mono text-slate-700">
                      {r.buyPrice != null ? Number(r.buyPrice).toFixed(2) : '—'}
                    </td>
                    <td className="px-3 py-1.5 border-b border-slate-100 text-slate-600">
                      <span className={readableReason(r.reason) === '(no reason recorded)' ? 'text-slate-400 italic' : ''}>
                        {readableReason(r.reason)}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 border-b border-slate-100 font-mono text-slate-500">
                      {r.deletedBy || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-3 py-2">
              <PaginationBar
                page={page} totalPages={totalPages} total={total}
                onPage={setPage} itemLabel="deletions"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
