/**
 * BulkEditUnitsModal — admin tool under Stock Intake for batch unit operations.
 *
 * Allows operators to paste a list of IMEIs (separated by commas, newlines, or
 * spaces), resolves them live against inventory units, presents a selection
 * review table, and executes bulk deletion with an explicit parameter (RTS or FBA).
 *
 * Security & Audit:
 *   - Strictly admin-gated (isAdmin)
 *   - Calls bulkDeleteUnits in inventoryService which archives each unit
 *     fail-closed to deletedUnits, emits audit events, and posts removal notices.
 */
import React, { useState, useMemo, useEffect } from 'react';
import { motion } from 'motion/react';
import {
  X, Trash2, CheckCircle2, AlertTriangle, AlertCircle,
  Copy, Check, Layers, RotateCcw, Box, Loader2, Sparkles,
} from 'lucide-react';
import { useInventoryStore } from '../lib/inventoryStore';
import { auth, isAdmin } from '../lib/firebase';
import { bulkDeleteUnits, type BulkDeleteUnitsResult } from '../services/inventoryService';
import type { InventoryUnit } from '../types';

interface Props {
  onClose: () => void;
}

export default function BulkEditUnitsModal({ onClose }: Props) {
  const userIsAdmin = isAdmin(auth.currentUser);
  const { units, suppliers } = useInventoryStore();

  const supplierMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of suppliers) m[s.id] = s.name;
    return m;
  }, [suppliers]);

  // Form state
  const [rawInput, setRawInput] = useState('');
  const [selectedAction, setSelectedAction] = useState<'RTS' | 'FBA'>('RTS');
  const [customNote, setCustomNote] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Execution state
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<BulkDeleteUnitsResult | null>(null);
  const [copiedNotFound, setCopiedNotFound] = useState(false);

  // ── 1. Parse IMEIs from text input ─────────────────────────────────────────
  // Supports commas, newlines, tabs, and spaces.
  const parsedImeis = useMemo(() => {
    if (!rawInput.trim()) return [];
    const tokens = rawInput
      .split(/[\s,;\n\r\t]+/)
      .map(s => s.trim())
      .filter(Boolean);
    // Deduplicate while preserving order
    return Array.from(new Set(tokens));
  }, [rawInput]);

  // ── 2. Match against inventory units ───────────────────────────────────────
  const { matchedUnits, soldUnits, notFoundImeis } = useMemo(() => {
    if (parsedImeis.length === 0) {
      return { matchedUnits: [], soldUnits: [], notFoundImeis: [] };
    }

    const unitByImei = new Map<string, InventoryUnit>();
    const unitById = new Map<string, InventoryUnit>();
    for (const u of units) {
      if (u.imei) {
        unitByImei.set(u.imei.trim().toUpperCase(), u);
      }
      if (u.id) {
        unitById.set(u.id.trim().toUpperCase(), u);
      }
    }

    const matched: InventoryUnit[] = [];
    const sold: InventoryUnit[] = [];
    const notFound: string[] = [];
    const seenUnitIds = new Set<string>();

    for (const raw of parsedImeis) {
      const key = raw.toUpperCase();
      const u = unitByImei.get(key) || unitById.get(key);
      if (!u) {
        notFound.push(raw);
      } else if (seenUnitIds.has(u.id)) {
        // already encountered via another token
        continue;
      } else {
        seenUnitIds.add(u.id);
        if (u.status === 'sold') {
          sold.push(u);
        } else {
          matched.push(u);
        }
      }
    }

    return { matchedUnits: matched, soldUnits: sold, notFoundImeis: notFound };
  }, [parsedImeis, units]);

  // Automatically select all matched units when list changes
  useEffect(() => {
    setSelectedIds(new Set(matchedUnits.map(u => u.id)));
  }, [matchedUnits]);

  // Toggle selection
  const handleToggleUnit = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleToggleAll = () => {
    if (selectedIds.size === matchedUnits.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(matchedUnits.map(u => u.id)));
    }
  };

  const handleCopyNotFound = () => {
    if (notFoundImeis.length === 0) return;
    navigator.clipboard.writeText(notFoundImeis.join(', '));
    setCopiedNotFound(true);
    setTimeout(() => setCopiedNotFound(false), 2000);
  };

  // Selected unit objects ready for execution
  const unitsToProcess = useMemo(() => {
    return matchedUnits.filter(u => selectedIds.has(u.id));
  }, [matchedUnits, selectedIds]);

  // ── 3. Execute bulk deletion ───────────────────────────────────────────────
  const handleExecuteDelete = async (actionParam?: 'RTS' | 'FBA') => {
    if (unitsToProcess.length === 0) return;

    const actionToUse = actionParam || selectedAction;
    if (actionParam && actionParam !== selectedAction) {
      setSelectedAction(actionParam);
    }

    const fullReason = customNote.trim()
      ? `${actionToUse} - ${customNote.trim()}`
      : actionToUse;

    const confirmMsg = `Are you sure you want to delete ${unitsToProcess.length} unit(s) with parameter "${fullReason}"?\n\nThis will remove them from active inventory and archive them into deleted records.`;
    if (!window.confirm(confirmMsg)) return;

    setIsProcessing(true);
    setResult(null);

    try {
      const res = await bulkDeleteUnits(unitsToProcess, fullReason);
      setResult(res);
      if (res.ok) {
        // Clear input on complete success
        setRawInput('');
        setSelectedIds(new Set());
      }
    } catch (err: any) {
      alert(err?.message || 'Bulk deletion failed');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center p-3 md:p-6 bg-black/60 backdrop-blur-sm">
      <motion.div
        initial={{ scale: 0.96, opacity: 0, y: 12 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.96, opacity: 0, y: 12 }}
        className="bg-white rounded-3xl w-full max-w-4xl shadow-2xl flex flex-col overflow-hidden border border-slate-100"
        style={{ maxHeight: 'calc(100dvh - 32px)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0 bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-slate-900 text-white flex items-center justify-center shadow-sm">
              <Layers size={18} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-900">Bulk Edit Units</h3>
                <span className="text-[9px] font-mono uppercase tracking-widest px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 font-bold">
                  Admin Only
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Paste comma or newline-separated IMEIs to bulk select and delete with RTS or FBA parameter.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-slate-200/60 text-slate-400 hover:text-slate-700 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Permission guard */}
        {!userIsAdmin ? (
          <div className="p-8 text-center flex flex-col items-center gap-3">
            <AlertTriangle className="text-rose-500" size={36} />
            <h4 className="text-sm font-bold text-slate-900">Admin Permission Required</h4>
            <p className="text-xs text-slate-500 max-w-md">
              Bulk unit deletion operations are restricted to administrators. Please contact an admin if you need to return stock or transfer to FBA.
            </p>
            <button
              onClick={onClose}
              className="mt-3 px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold"
            >
              Close
            </button>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Step 1: Select Removal Parameter (Always visible) */}
            <div className="space-y-3">
              <label className="text-xs font-bold text-slate-800 uppercase tracking-wider block">
                1. Select Removal Parameter
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* RTS Option */}
                <div
                  onClick={() => setSelectedAction('RTS')}
                  className={`cursor-pointer rounded-2xl p-4 border transition-all ${
                    selectedAction === 'RTS'
                      ? 'border-amber-500 bg-amber-50/70 shadow-sm ring-2 ring-amber-400/30'
                      : 'border-slate-200 hover:border-slate-300 bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${selectedAction === 'RTS' ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-600'}`}>
                        <RotateCcw size={16} />
                      </div>
                      <div>
                        <span className="font-bold text-sm text-slate-900 block">RTS (Return to Supplier)</span>
                        <span className="text-[10px] text-amber-700 font-medium">Shows in RTS (72h) tile</span>
                      </div>
                    </div>
                    <input
                      type="radio"
                      name="removalAction"
                      checked={selectedAction === 'RTS'}
                      onChange={() => setSelectedAction('RTS')}
                      className="text-amber-500 focus:ring-amber-400"
                    />
                  </div>
                  <p className="text-[11px] text-slate-600 leading-relaxed mt-2">
                    Removes units from active stock with parameter <span className="font-mono font-bold text-amber-900">RTS</span>. Recorded in removal archives and counts towards the RTS (Last 72h) metric.
                  </p>
                </div>

                {/* FBA Option */}
                <div
                  onClick={() => setSelectedAction('FBA')}
                  className={`cursor-pointer rounded-2xl p-4 border transition-all ${
                    selectedAction === 'FBA'
                      ? 'border-indigo-500 bg-indigo-50/70 shadow-sm ring-2 ring-indigo-400/30'
                      : 'border-slate-200 hover:border-slate-300 bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${selectedAction === 'FBA' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                        <Box size={16} />
                      </div>
                      <div>
                        <span className="font-bold text-sm text-slate-900 block">FBA (Amazon Fulfilment)</span>
                        <span className="text-[10px] text-indigo-700 font-medium">Amazon Stock Transfer</span>
                      </div>
                    </div>
                    <input
                      type="radio"
                      name="removalAction"
                      checked={selectedAction === 'FBA'}
                      onChange={() => setSelectedAction('FBA')}
                      className="text-indigo-600 focus:ring-indigo-500"
                    />
                  </div>
                  <p className="text-[11px] text-slate-600 leading-relaxed mt-2">
                    Removes units from active stock with parameter <span className="font-mono font-bold text-indigo-900">FBA</span>. Recorded as an Amazon fulfilment transfer in the removal log.
                  </p>
                </div>
              </div>

              {/* Optional Reference Note */}
              <div className="pt-1">
                <input
                  type="text"
                  value={customNote}
                  onChange={e => setCustomNote(e.target.value)}
                  placeholder="Optional reference / RMA # / shipment ID (e.g. RMA-9872 or FBA-UK-BATCH-4)..."
                  className="w-full text-xs p-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>
            </div>

            {/* Step 2: Input Area */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                  2. Paste IMEIs
                  {parsedImeis.length > 0 && (
                    <span className="text-[10px] font-mono font-medium text-slate-500 lowercase">
                      ({parsedImeis.length} unique parsed)
                    </span>
                  )}
                </label>
                {rawInput && (
                  <button
                    onClick={() => { setRawInput(''); setResult(null); }}
                    className="text-[11px] font-medium text-slate-400 hover:text-rose-600 transition-colors"
                  >
                    Clear Input
                  </button>
                )}
              </div>
              <textarea
                value={rawInput}
                onChange={e => { setRawInput(e.target.value); setResult(null); }}
                placeholder="Paste IMEIs separated by commas, spaces, or newlines (e.g. 356938035643809, 356938035643810, 354921098765432)..."
                rows={4}
                disabled={isProcessing}
                className="w-full text-xs font-mono p-3 rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent transition-all resize-y placeholder:text-slate-400"
              />
            </div>

            {/* Results / Status Overview Bar */}
            {parsedImeis.length > 0 && (
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 rounded-2xl border border-emerald-200 bg-emerald-50/40">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-800">Ready to Delete</p>
                  <p className="text-2xl font-bold text-emerald-900 mt-1">{matchedUnits.length}</p>
                  <p className="text-[10px] text-emerald-700/80 font-mono mt-0.5">available / incoming</p>
                </div>
                <div className={`p-3 rounded-2xl border ${notFoundImeis.length > 0 ? 'border-amber-200 bg-amber-50/40' : 'border-slate-200 bg-slate-50'}`}>
                  <div className="flex items-center justify-between">
                    <p className={`text-[10px] font-bold uppercase tracking-wider ${notFoundImeis.length > 0 ? 'text-amber-800' : 'text-slate-500'}`}>Not Found</p>
                    {notFoundImeis.length > 0 && (
                      <button
                        onClick={handleCopyNotFound}
                        title="Copy not found IMEIs"
                        className="text-[10px] flex items-center gap-1 font-mono text-amber-700 hover:underline"
                      >
                        {copiedNotFound ? <Check size={10} /> : <Copy size={10} />} Copy
                      </button>
                    )}
                  </div>
                  <p className={`text-2xl font-bold mt-1 ${notFoundImeis.length > 0 ? 'text-amber-900' : 'text-slate-700'}`}>{notFoundImeis.length}</p>
                  <p className="text-[10px] text-slate-500 font-mono mt-0.5">not in active stock</p>
                </div>
                <div className={`p-3 rounded-2xl border ${soldUnits.length > 0 ? 'border-rose-200 bg-rose-50/40' : 'border-slate-200 bg-slate-50'}`}>
                  <p className={`text-[10px] font-bold uppercase tracking-wider ${soldUnits.length > 0 ? 'text-rose-800' : 'text-slate-500'}`}>Already Sold</p>
                  <p className={`text-2xl font-bold mt-1 ${soldUnits.length > 0 ? 'text-rose-900' : 'text-slate-700'}`}>{soldUnits.length}</p>
                  <p className="text-[10px] text-slate-500 font-mono mt-0.5">cannot delete sold</p>
                </div>
              </div>
            )}

            {/* Unmatched Warning Banner */}
            {notFoundImeis.length > 0 && (
              <div className="p-3 rounded-2xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2">
                <AlertCircle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <span className="font-bold">{notFoundImeis.length} IMEI(s) not found in inventory:</span>{' '}
                  <span className="font-mono text-[11px] text-amber-800 break-all">{notFoundImeis.slice(0, 10).join(', ')}{notFoundImeis.length > 10 ? ` ...and ${notFoundImeis.length - 10} more` : ''}</span>
                </div>
              </div>
            )}

            {/* Step 3: Matched Units Table */}
            {matchedUnits.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                    3. Review Units to Delete ({selectedIds.size} of {matchedUnits.length} selected)
                  </label>
                  <button
                    onClick={handleToggleAll}
                    className="text-xs font-medium text-slate-600 hover:text-slate-900 transition-colors"
                  >
                    {selectedIds.size === matchedUnits.length ? 'Deselect All' : 'Select All'}
                  </button>
                </div>

                <div className="border border-slate-200 rounded-2xl overflow-hidden max-h-56 overflow-y-auto shadow-inner">
                  <table className="w-full text-[11px]">
                    <thead className="bg-slate-50 text-[9px] font-mono uppercase tracking-widest text-slate-500 sticky top-0 border-b border-slate-100">
                      <tr>
                        <th className="w-8 px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={selectedIds.size === matchedUnits.length && matchedUnits.length > 0}
                            onChange={handleToggleAll}
                            className="rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                          />
                        </th>
                        <th className="text-left px-3 py-2 font-medium">Model</th>
                        <th className="text-left px-3 py-2 font-medium">IMEI</th>
                        <th className="text-left px-3 py-2 font-medium">Storage / Colour</th>
                        <th className="text-left px-3 py-2 font-medium">Grade</th>
                        <th className="text-left px-3 py-2 font-medium">Supplier</th>
                        <th className="text-right px-3 py-2 font-medium">BP</th>
                        <th className="text-center px-3 py-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {matchedUnits.map(u => {
                        const isSelected = selectedIds.has(u.id);
                        return (
                          <tr
                            key={u.id}
                            onClick={() => handleToggleUnit(u.id)}
                            className={`cursor-pointer transition-colors ${isSelected ? 'bg-slate-50/70 hover:bg-slate-100/60' : 'bg-white opacity-50 hover:opacity-80'}`}
                          >
                            <td className="px-3 py-2 text-center" onClick={e => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => handleToggleUnit(u.id)}
                                className="rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                              />
                            </td>
                            <td className="px-3 py-2 font-medium text-slate-900">{u.model || '—'}</td>
                            <td className="px-3 py-2 font-mono text-slate-600">{u.imei || u.id}</td>
                            <td className="px-3 py-2 text-slate-600">
                              {[u.storage, u.colour].filter(Boolean).join(' · ') || '—'}
                            </td>
                            <td className="px-3 py-2 font-mono text-slate-700">{u.grade || '—'}</td>
                            <td className="px-3 py-2 text-slate-600">
                              {supplierMap[u.supplierId] || u.supplierName || '—'}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-slate-700">
                              {u.buyPrice != null ? `£${u.buyPrice}` : '—'}
                            </td>
                            <td className="px-3 py-2 text-center">
                              <span className={`inline-block px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider ${u.status === 'incoming' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
                                {u.status}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Results Feedback */}
            {result && (
              <div className={`p-4 rounded-2xl border ${result.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-rose-50 border-rose-200 text-rose-900'}`}>
                <div className="flex items-center gap-2">
                  {result.ok ? <CheckCircle2 size={18} className="text-emerald-600" /> : <AlertTriangle size={18} className="text-rose-600" />}
                  <h4 className="font-bold text-xs">
                    {result.ok
                      ? `Successfully deleted ${result.deleted} unit(s) with parameter ${selectedAction}.`
                      : `Partially completed: ${result.deleted} deleted, ${result.failed.length} failed.`}
                  </h4>
                </div>
                {result.failed.length > 0 && (
                  <ul className="mt-2 text-[11px] space-y-1 font-mono">
                    {result.failed.map((f, i) => (
                      <li key={i}>IMEI {f.imei}: {f.error}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        {userIsAdmin && (
          <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between gap-3 bg-slate-50/50 flex-shrink-0">
            <div className="text-xs text-slate-500">
              {matchedUnits.length > 0 ? (
                <span>
                  <strong className="text-slate-900">{unitsToProcess.length}</strong> of {matchedUnits.length} unit{matchedUnits.length === 1 ? '' : 's'} selected
                </span>
              ) : (
                <span>Select parameter & paste IMEIs to begin</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isProcessing}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-200/60 transition-colors"
              >
                {result?.ok ? 'Close' : 'Cancel'}
              </button>

              {/* Action Delete Button (strictly matches selectedAction) */}
              <button
                type="button"
                onClick={() => handleExecuteDelete(selectedAction)}
                disabled={unitsToProcess.length === 0 || isProcessing}
                title={`Delete selected units with parameter ${selectedAction}`}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold text-white transition-all shadow-sm ${
                  unitsToProcess.length === 0 || isProcessing
                    ? 'bg-slate-300 cursor-not-allowed text-slate-500'
                    : selectedAction === 'RTS'
                    ? 'bg-amber-600 hover:bg-amber-700 active:scale-95'
                    : 'bg-indigo-600 hover:bg-indigo-700 active:scale-95'
                }`}
              >
                {isProcessing ? (
                  <>
                    <Loader2 size={13} className="animate-spin" /> Deleting...
                  </>
                ) : selectedAction === 'RTS' ? (
                  <>
                    <RotateCcw size={14} />
                    Delete {unitsToProcess.length} as RTS
                  </>
                ) : (
                  <>
                    <Box size={14} />
                    Delete {unitsToProcess.length} as FBA
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}
