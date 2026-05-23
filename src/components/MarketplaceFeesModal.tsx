/**
 * MarketplaceFeesModal — operator-facing editor for the per-marketplace
 * fee schedule that drives every Sale GP / Commission / NP calculation
 * across the app and the Excel report. Backed by the Firestore
 * `marketplaceFees` collection: one doc per Marketplace (id = enum value).
 *
 * Saving writes each marketplace's doc; the inventoryStore subscription
 * picks the change up and pushes it into the platforms.ts live cache, so
 * runtime calcs + the Excel Formulas tab + the per-marketplace SALES
 * tabs all update without a reload.
 */
import React, { useMemo, useState } from 'react';
import { X, CheckCircle2, RotateCcw, AlertCircle, Calculator } from 'lucide-react';
import { motion } from 'motion/react';
import { dbService } from '../lib/dbService';
import { useInventoryStore } from '../lib/inventoryStore';
import { resetMarketplaceFees, applyMarketplaceFeeOverrides, getAllMarketplaceFees } from '../lib/platforms';
import { MARKETPLACES, type Marketplace, type MarketplaceFee } from '../types';

interface Props {
  onClose: () => void;
}

type FieldKey =
  | 'commissionPct' | 'commissionReductionPct' | 'fixedFee' | 'postage'
  | 'marginTaxDivisor' | 'payPalKlarnaPct' | 'rofPct' | 'vatPct' | 'promoPct';

interface FieldDef {
  key: FieldKey;
  label: string;
  suffix: string;          // '%' or '£' or 'x'
  hint?: string;
}

// Per-marketplace ordered field list. Only the fields each platform
// actually uses appear in its column — keeps the editor narrow + reads
// the same as the master file's per-sheet formulas.
const FIELDS_BY_MARKETPLACE: Record<Marketplace, FieldDef[]> = {
  AMAZON: [
    { key: 'commissionPct',    label: 'Commission',          suffix: '%' },
    { key: 'postage',          label: 'Postage',             suffix: '£' },
    { key: 'marginTaxDivisor', label: 'Margin Tax divisor',  suffix: 'x', hint: '(SP − BP) / N' },
  ],
  BM: [
    { key: 'commissionPct',    label: 'Commission',          suffix: '%' },
    { key: 'payPalKlarnaPct',  label: 'PayPal / Klarna',     suffix: '%' },
    { key: 'postage',          label: 'Postage',             suffix: '£' },
    { key: 'marginTaxDivisor', label: 'Margin Tax divisor',  suffix: 'x', hint: '(SP − BP) / N' },
  ],
  EBAY: [
    { key: 'commissionPct',          label: 'Commission',           suffix: '%' },
    { key: 'commissionReductionPct', label: 'Commission reduction', suffix: '%', hint: 'discount on the commission' },
    { key: 'fixedFee',                label: 'Fixed fee (FVF)',     suffix: '£' },
    { key: 'rofPct',                  label: 'ROF',                 suffix: '%' },
    { key: 'vatPct',                  label: 'VAT on fees bundle',  suffix: '%' },
    { key: 'postage',                 label: 'Postage (default)',   suffix: '£' },
    { key: 'promoPct',                label: 'Promo deduction (NP)',suffix: '%' },
  ],
  ONBUY: [
    { key: 'commissionPct',    label: 'Commission',         suffix: '%' },
    { key: 'vatPct',           label: 'VAT (on MAR VAT)',   suffix: '%' },
    { key: 'postage',          label: 'Postage',            suffix: '£' },
    { key: 'marginTaxDivisor', label: 'Margin Tax divisor', suffix: 'x', hint: '(SP − BP) / N' },
  ],
};

const MARKETPLACE_TONE: Record<Marketplace, string> = {
  AMAZON: 'border-orange-300 bg-orange-50',
  BM:     'border-emerald-300 bg-emerald-50',
  EBAY:   'border-yellow-300 bg-yellow-50',
  ONBUY:  'border-blue-300 bg-blue-50',
};

export default function MarketplaceFeesModal({ onClose }: Props) {
  const { fees } = useInventoryStore();

  // Working copy keyed [marketplace][field] = string (so partial typing
  // doesn't fight against parseFloat). Initialised from the live cache.
  const [draft, setDraft] = useState<Record<Marketplace, Record<string, string>>>(() => {
    const out = {} as Record<Marketplace, Record<string, string>>;
    for (const m of MARKETPLACES) {
      const row: Record<string, string> = {};
      for (const f of FIELDS_BY_MARKETPLACE[m]) {
        const v = (fees[m] as any)[f.key];
        row[f.key] = v == null ? '' : String(v);
      }
      out[m] = row;
    }
    return out;
  });

  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [error,  setError]  = useState('');

  const setField = (m: Marketplace, key: string, value: string) => {
    setDraft(prev => ({ ...prev, [m]: { ...prev[m], [key]: value } }));
    setSaved(false);
    setError('');
  };

  // Compose the patch we'll write to Firestore (one doc per marketplace).
  const patches = useMemo(() => {
    const out: Partial<Record<Marketplace, Partial<MarketplaceFee>>> = {};
    for (const m of MARKETPLACES) {
      const row: Partial<MarketplaceFee> = { marketplace: m };
      for (const f of FIELDS_BY_MARKETPLACE[m]) {
        const raw = (draft[m][f.key] ?? '').trim();
        if (raw === '') continue;
        const n = Number(raw);
        if (!Number.isFinite(n)) continue;
        (row as any)[f.key] = n;
      }
      out[m] = row;
    }
    return out;
  }, [draft]);

  const handleSave = async () => {
    // Validate — every visible field must parse as a finite number ≥ 0.
    for (const m of MARKETPLACES) {
      for (const f of FIELDS_BY_MARKETPLACE[m]) {
        const raw = (draft[m][f.key] ?? '').trim();
        if (raw === '') { setError(`${m} · ${f.label} can't be empty`); return; }
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0) {
          setError(`${m} · ${f.label} must be a number ≥ 0`); return;
        }
      }
    }

    setSaving(true);
    setError('');
    try {
      // Optimistic local cache update so any open Sell/Sales grid recomputes
      // immediately, even before the Firestore round-trip completes.
      applyMarketplaceFeeOverrides(patches);
      // Persist per-marketplace doc — id = marketplace enum value so
      // re-saves overwrite cleanly.
      for (const m of MARKETPLACES) {
        const payload = patches[m];
        if (!payload) continue;
        await dbService.update('marketplaceFees', m, payload);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e: any) {
      setError(`Save failed: ${e?.message ?? e}`);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (!confirm('Reset every marketplace fee to its baked-in default? Saved Firestore values will stay until you press Save.')) return;
    resetMarketplaceFees();
    // Reload the draft from the freshly-reset cache.
    const freshAll = getAllMarketplaceFees();
    const next = {} as Record<Marketplace, Record<string, string>>;
    for (const m of MARKETPLACES) {
      const row: Record<string, string> = {};
      for (const f of FIELDS_BY_MARKETPLACE[m]) {
        const v = (freshAll[m] as any)[f.key];
        row[f.key] = v == null ? '' : String(v);
      }
      next[m] = row;
    }
    setDraft(next);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 md:p-4 bg-black/50 backdrop-blur-sm">
      <motion.div
        initial={{ scale: 0.97, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-3xl shadow-2xl w-full max-w-5xl flex flex-col"
        style={{ maxHeight: 'calc(100dvh - 24px)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center">
              <Calculator size={16} />
            </div>
            <div>
              <p className="text-[9px] font-mono uppercase tracking-widest text-slate-400">Sales Formulas</p>
              <h3 className="text-sm font-bold">Marketplace Fees</h3>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <p className="text-[11px] font-mono text-slate-500 leading-relaxed">
            Edits here flow through every Commission / Margin Tax / GP / NP calculation in the app and the
            Excel report. Each marketplace stores one doc in <span className="font-bold">marketplaceFees</span>
            (id = enum value). Leave a field at its current value to keep using the existing rate.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {MARKETPLACES.map(m => (
              <div key={m} className={`border-2 rounded-2xl p-4 ${MARKETPLACE_TONE[m]}`}>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-3">{m}</p>
                <div className="space-y-2">
                  {FIELDS_BY_MARKETPLACE[m].map(f => (
                    <div key={f.key} className="flex items-center gap-2">
                      <label className="text-[10px] font-mono text-slate-600 flex-1 min-w-0 truncate" title={f.hint}>
                        {f.label}
                        {f.hint && <span className="text-slate-400 ml-1">· {f.hint}</span>}
                      </label>
                      <div className="relative w-28 flex-shrink-0">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={draft[m][f.key] ?? ''}
                          onChange={e => setField(m, f.key, e.target.value)}
                          className="w-full pr-7 pl-2 py-1.5 text-[11px] font-mono bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900 text-right"
                        />
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-mono text-slate-400 pointer-events-none">
                          {f.suffix}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {error && (
            <div className="flex items-center gap-2 text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
              <AlertCircle size={14} />
              <p className="text-[11px] font-mono">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 px-6 py-4 border-t border-slate-100 flex items-center gap-3">
          <button
            onClick={handleReset}
            className="flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 text-slate-600 text-[10px] font-bold uppercase tracking-widest hover:bg-slate-50"
          >
            <RotateCcw size={12} /> Reset to defaults
          </button>
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-[10px] font-bold uppercase tracking-widest hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 text-white text-[10px] font-bold uppercase tracking-widest hover:bg-slate-700 disabled:opacity-50"
          >
            <CheckCircle2 size={12} />
            {saving ? 'Saving…' : saved ? 'Saved' : 'Save fees'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
