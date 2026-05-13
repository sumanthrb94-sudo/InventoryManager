import React, { useMemo, useState } from 'react';
import { ChevronLeft, AlertTriangle, Check } from 'lucide-react';
import { motion } from 'motion/react';
import { InventoryUnit } from '../../types';
import { GRADE_OPTIONS, STORAGE_OPTIONS } from '../../lib/unitConstants';

interface Props {
  units: InventoryUnit[];
  batchId: string;
  onSubmit: () => Promise<void>;
  onBack: () => void;
  /** Push edits back to the parent flow so onSubmit sees the latest. */
  onUnitsChange?: (next: InventoryUnit[]) => void;
  error: string;
}

// Common colour set — kept in sync with DetailForm.
const COLOUR_OPTIONS = [
  'Black','White','Blue','Green','Red','Pink','Purple','Yellow',
  'Gold','Silver','Graphite','Starlight','Midnight','Natural Titanium',
  'Black Titanium','White Titanium','Phantom Black','Phantom White',
  'Space Grey','Sierra Blue','Alpine Green','Coral','Mint','Cream',
  'Lavender','Desert Titanium','Pacific Blue','Rose Gold','Other',
];

const normaliseImei = (s: string) => (s || '').replace(/\D/g, '');

/**
 * Excel-style editable review. Every IMEI / colour / storage / grade /
 * buy-price cell is editable in place so the operator can fix anything
 * OCR (or a typo) got wrong before committing.
 */
export default function ReviewScreen({ units, batchId, onSubmit, onBack, onUnitsChange, error }: Props) {
  const [submitting, setSubmitting] = useState(false);

  const totalValue = useMemo(
    () => units.reduce((sum, u) => sum + (u.buyPrice || 0), 0),
    [units],
  );

  // Surface within-batch IMEI clashes — block submit if any.
  const duplicateImeis = useMemo(() => {
    const seen = new Map<string, number>();
    for (const u of units) {
      const k = normaliseImei(u.imei);
      if (k && k.length >= 14) seen.set(k, (seen.get(k) || 0) + 1);
    }
    return new Set(
      Array.from(seen.entries())
        .filter(([, n]) => n > 1)
        .map(([k]) => k),
    );
  }, [units]);

  const missingModelRows = useMemo(
    () => units.filter(u => !u.model || !u.model.trim()).length,
    [units],
  );
  const blockingError = duplicateImeis.size > 0
    ? `${duplicateImeis.size} duplicate IMEI${duplicateImeis.size > 1 ? 's' : ''} within batch — fix before saving.`
    : missingModelRows > 0
    ? `${missingModelRows} row${missingModelRows > 1 ? 's' : ''} missing a model.`
    : '';

  const updateUnit = (idx: number, patch: Partial<InventoryUnit>) => {
    if (!onUnitsChange) return;
    const next = units.slice();
    next[idx] = { ...next[idx], ...patch } as InventoryUnit;
    onUnitsChange(next);
  };

  const handleConfirm = async () => {
    if (blockingError || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        <div className="p-4 bg-blue-50 rounded-xl border border-blue-200">
          <p className="text-[10px] font-bold uppercase tracking-widest text-blue-700 mb-1">Total Units</p>
          <p className="text-2xl font-bold text-blue-900">{units.length}</p>
        </div>
        <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-200">
          <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-700 mb-1">Total Value</p>
          <p className="text-2xl font-bold text-emerald-900">£{totalValue.toFixed(2)}</p>
        </div>
        <div className="p-4 bg-purple-50 rounded-xl border border-purple-200">
          <p className="text-[10px] font-bold uppercase tracking-widest text-purple-700 mb-1">Batch ID</p>
          <p className="text-sm font-mono font-bold text-purple-900 truncate">{batchId}</p>
        </div>
      </div>

      <div className="flex items-start gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg">
        <p className="text-[11px] text-slate-600">
          <span className="font-bold">Excel-style review.</span> Every cell is editable — fix any IMEI, colour,
          storage, grade, or buy price before saving. Duplicate IMEIs within the batch are highlighted in red.
        </p>
      </div>

      {/* Units table */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 text-xs sm:text-sm bg-white">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
            <tr>
              <th className="px-2 sm:px-3 py-2 text-left font-bold text-gray-700 w-10">#</th>
              <th className="px-2 sm:px-3 py-2 text-left font-bold text-gray-700">IMEI</th>
              <th className="px-2 sm:px-3 py-2 text-left font-bold text-gray-700">Model</th>
              <th className="px-2 sm:px-3 py-2 text-left font-bold text-gray-700">Colour</th>
              <th className="px-2 sm:px-3 py-2 text-left font-bold text-gray-700">Storage</th>
              <th className="px-2 sm:px-3 py-2 text-left font-bold text-gray-700">Grade</th>
              <th className="px-2 sm:px-3 py-2 text-right font-bold text-gray-700">Buy Price</th>
              <th className="px-2 sm:px-3 py-2 text-left font-bold text-gray-700">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {units.map((unit, idx) => {
              const imeiDigits = normaliseImei(unit.imei);
              const isDuplicate = imeiDigits.length >= 14 && duplicateImeis.has(imeiDigits);
              const missingModel = !unit.model || !unit.model.trim();
              return (
                <tr key={unit.id} className={isDuplicate ? 'bg-red-50' : missingModel ? 'bg-amber-50' : 'hover:bg-gray-50'}>
                  <td className="px-2 sm:px-3 py-1.5 text-gray-500 font-mono text-[11px]">
                    {String(idx + 1).padStart(2, '0')}
                  </td>
                  <td className="px-2 sm:px-3 py-1.5">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={unit.imei || ''}
                      onChange={e => updateUnit(idx, { imei: e.target.value.replace(/\D/g, '').slice(0, 20) })}
                      placeholder="14-15 digits"
                      className={`w-44 sm:w-52 px-2 py-1 text-[11px] font-mono rounded border focus:outline-none focus:ring-1 ${
                        isDuplicate
                          ? 'border-red-400 bg-red-50 focus:ring-red-500'
                          : 'border-transparent hover:border-gray-200 bg-transparent focus:border-blue-400 focus:bg-white focus:ring-blue-400'
                      }`}
                      title={isDuplicate ? 'Duplicate within batch' : ''}
                    />
                  </td>
                  <td className="px-2 sm:px-3 py-1.5">
                    <input
                      type="text"
                      value={unit.model || ''}
                      onChange={e => updateUnit(idx, { model: e.target.value })}
                      className={`w-40 sm:w-48 px-2 py-1 text-[11px] rounded border focus:outline-none focus:ring-1 ${
                        missingModel
                          ? 'border-amber-400 bg-amber-50 focus:ring-amber-500'
                          : 'border-transparent hover:border-gray-200 bg-transparent focus:border-blue-400 focus:bg-white focus:ring-blue-400'
                      }`}
                    />
                  </td>
                  <td className="px-2 sm:px-3 py-1.5">
                    <select
                      value={unit.colour || ''}
                      onChange={e => updateUnit(idx, { colour: e.target.value })}
                      className="w-32 px-2 py-1 text-[11px] rounded border border-transparent hover:border-gray-200 bg-transparent focus:outline-none focus:border-blue-400 focus:bg-white focus:ring-1 focus:ring-blue-400"
                    >
                      <option value="">—</option>
                      {COLOUR_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </td>
                  <td className="px-2 sm:px-3 py-1.5">
                    <select
                      value={unit.storage || ''}
                      onChange={e => updateUnit(idx, { storage: e.target.value || undefined } as any)}
                      className="w-24 px-2 py-1 text-[11px] rounded border border-transparent hover:border-gray-200 bg-transparent focus:outline-none focus:border-blue-400 focus:bg-white focus:ring-1 focus:ring-blue-400"
                    >
                      <option value="">—</option>
                      {STORAGE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td className="px-2 sm:px-3 py-1.5">
                    <select
                      value={unit.grade || ''}
                      onChange={e => updateUnit(idx, { grade: e.target.value || undefined } as any)}
                      className="w-20 px-2 py-1 text-[11px] rounded border border-transparent hover:border-gray-200 bg-transparent focus:outline-none focus:border-blue-400 focus:bg-white focus:ring-1 focus:ring-blue-400"
                    >
                      <option value="">—</option>
                      {GRADE_OPTIONS.map(g => <option key={g} value={g}>{g}</option>)}
                    </select>
                  </td>
                  <td className="px-2 sm:px-3 py-1.5 text-right">
                    <div className="inline-flex items-center gap-1">
                      <span className="text-gray-400 text-[11px]">£</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={unit.buyPrice ?? 0}
                        onChange={e => updateUnit(idx, { buyPrice: parseFloat(e.target.value) || 0 })}
                        className="w-20 px-2 py-1 text-right text-[11px] font-mono rounded border border-transparent hover:border-gray-200 bg-transparent focus:outline-none focus:border-blue-400 focus:bg-white focus:ring-1 focus:ring-blue-400"
                      />
                    </div>
                  </td>
                  <td className="px-2 sm:px-3 py-1.5">
                    <input
                      type="text"
                      value={unit.notes || ''}
                      onChange={e => updateUnit(idx, { notes: e.target.value })}
                      placeholder="—"
                      className="w-40 px-2 py-1 text-[11px] rounded border border-transparent hover:border-gray-200 bg-transparent focus:outline-none focus:border-blue-400 focus:bg-white focus:ring-1 focus:ring-blue-400"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="bg-gray-50 border-t border-gray-200 sticky bottom-0">
            <tr>
              <td colSpan={6} className="px-3 py-2 text-[11px] font-bold text-gray-700 text-right">
                TOTAL · {units.length} units
              </td>
              <td className="px-3 py-2 text-right text-[11px] font-mono font-bold text-gray-900">
                £{totalValue.toFixed(2)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {blockingError && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
          <AlertTriangle size={14} className="text-red-600 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-red-700">{blockingError}</p>
        </div>
      )}
      {error && !blockingError && (
        <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>
      )}

      {/* Action buttons */}
      <div className="flex gap-3 pt-4">
        <button
          onClick={onBack}
          disabled={submitting}
          className="flex-1 py-3 border border-gray-300 rounded-lg text-sm font-semibold hover:bg-gray-50 transition flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <ChevronLeft size={16} />
          Back to Edit
        </button>
        <button
          onClick={handleConfirm}
          disabled={!!blockingError || submitting}
          className="flex-1 py-3 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 transition flex items-center justify-center gap-2 disabled:bg-gray-300 disabled:cursor-not-allowed"
        >
          {submitting
            ? 'Saving…'
            : <><Check size={16} /> Confirm & Add to Stock ({units.length})</>}
        </button>
      </div>
    </motion.div>
  );
}
