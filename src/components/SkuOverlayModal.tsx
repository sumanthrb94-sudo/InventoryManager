import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Copy, Check, Download } from 'lucide-react';
import type { InventoryUnit } from '../types';
import { parseBrandModelStorage } from '../lib/modelStorage';

interface Props {
  /** When non-null the overlay renders. Null = hidden. */
  selection: {
    seriesKey: string;     // display title, e.g. "iPhone 17 Pro Max 128GB"
    model: string;         // raw model used for filtering
    storage?: string;
  } | null;
  units: InventoryUnit[];
  onClose: () => void;
}

const COLUMNS: { key: string; label: string; width: number; align?: 'left' | 'right' }[] = [
  { key: 'dateIn',       label: 'Date In',       width: 100 },
  { key: 'age',          label: 'Age',           width: 70,  align: 'right' },
  { key: 'imei',         label: 'IMEI',          width: 170 },
  { key: 'model',        label: 'Model',         width: 220 },
  { key: 'storage',      label: 'Storage',       width: 80  },
  { key: 'colour',       label: 'Colour',        width: 130 },
  { key: 'supplierName', label: 'Supplier',      width: 130 },
  { key: 'buyPrice',     label: 'BP',            width: 70,  align: 'right' },
  { key: 'status',       label: 'Status',        width: 100 },
  { key: 'marketplace',  label: 'Marketplace',   width: 110 },
  { key: 'salePrice',    label: 'Sale Price',    width: 90,  align: 'right' },
  { key: 'saleDate',     label: 'Sale Date',     width: 100 },
  { key: 'notes',        label: 'Notes',         width: 220 },
];

/** Days since the unit landed in stock — drives the Age pill against the
 *  operator's 30-day supplier-return window. */
function daysSinceDateIn(iso: string | undefined, now: Date = new Date()): number | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  const days = Math.floor((now.getTime() - d.getTime()) / 86400000);
  return days < 0 ? 0 : days;
}

function ageBucket(days: number): 'within' | 'ageing' | 'cold' {
  if (days <= 30) return 'within';
  if (days <= 60) return 'ageing';
  return 'cold';
}

function format(u: InventoryUnit, key: string): string {
  if (key === 'age') {
    const d = daysSinceDateIn(u.dateIn);
    return d == null ? '' : `${d}d`;
  }
  const v = (u as any)[key];
  if (v == null || v === '') return '';
  if (key === 'buyPrice' || key === 'salePrice') {
    return `£${Number(v).toFixed(2)}`;
  }
  if (key === 'status') return String(v).replace(/_/g, ' ').toUpperCase();
  if (key === 'marketplace') {
    return String(u.marketplace ?? u.salePlatform ?? '').trim();
  }
  return String(v);
}

export default function SkuOverlayModal({ selection, units, onClose }: Props) {
  const [copied, setCopied] = useState(false);

  // Filter units matching the selected (model, storage) — prefer pre-split
  // fields on the doc but fall back to runtime parsing for legacy data.
  const rows = useMemo(() => {
    if (!selection) return [];
    const wantModel   = selection.model.toLowerCase().trim();
    const wantStorage = (selection.storage || '').toUpperCase().trim();
    return units.filter(u => {
      const parsed = parseBrandModelStorage(u.model || '');
      const model   = (u as any).model && (parsed.model || u.model);
      const storage = (u.storage || parsed.storage || '').toUpperCase();
      const modelOk = (model || '').toLowerCase().includes(wantModel) ||
                      wantModel.includes((model || '').toLowerCase());
      const storageOk = wantStorage === '' || storage === wantStorage;
      return modelOk && storageOk;
    }).sort((a, b) => {
      // Newest first by dateIn
      const da = new Date(a.dateIn || 0).getTime();
      const db = new Date(b.dateIn || 0).getTime();
      return db - da;
    });
  }, [selection, units]);

  // Close on Escape
  useEffect(() => {
    if (!selection) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selection, onClose]);

  const copyToClipboard = async () => {
    // Tab-separated, header + rows — paste into Excel as-is.
    const header = COLUMNS.map(c => c.label).join('\t');
    const body = rows.map(u => COLUMNS.map(c => format(u, c.key)).join('\t')).join('\n');
    try {
      await navigator.clipboard.writeText(`${header}\n${body}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.warn('[SkuOverlayModal] clipboard write failed:', err);
    }
  };

  const downloadCsv = () => {
    const escape = (s: string) =>
      /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    const header = COLUMNS.map(c => escape(c.label)).join(',');
    const body = rows.map(u => COLUMNS.map(c => escape(format(u, c.key))).join(',')).join('\n');
    const blob = new Blob([`${header}\n${body}\n`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(selection?.seriesKey || 'units').replace(/[^a-z0-9]+/gi, '_')}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <AnimatePresence>
      {selection && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[300] bg-black/50 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.97, y: 12 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.97, y: 12 }}
            transition={{ duration: 0.15 }}
            onClick={e => e.stopPropagation()}
            className="bg-white rounded-2xl shadow-2xl w-full max-w-[1400px] max-h-[92vh] flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="flex-shrink-0 flex items-center justify-between px-5 py-3 border-b border-gray-200 bg-gradient-to-r from-emerald-50 to-white">
              <div className="min-w-0">
                <p className="text-[8px] font-mono uppercase tracking-[0.3em] text-emerald-700/80">SKU detail · Excel view</p>
                <h2 className="text-base sm:text-lg font-bold tracking-tight truncate">
                  {selection.seriesKey}
                </h2>
                <p className="text-[10px] text-gray-500 font-mono mt-0.5">
                  {rows.length} unit{rows.length === 1 ? '' : 's'} · click row to inspect · ESC or click outside to close
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={copyToClipboard}
                  disabled={rows.length === 0}
                  className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 hover:border-gray-400 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all disabled:opacity-40"
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
                <button
                  onClick={downloadCsv}
                  disabled={rows.length === 0}
                  className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 hover:border-gray-400 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all disabled:opacity-40"
                >
                  <Download size={12} /> CSV
                </button>
                <button
                  onClick={onClose}
                  className="p-1.5 text-gray-500 hover:text-black hover:bg-gray-100 rounded-lg transition-all"
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Excel-style grid */}
            <div className="flex-1 overflow-auto">
              {rows.length === 0 ? (
                <div className="h-full flex items-center justify-center text-gray-400 text-sm font-mono py-20">
                  No units match this SKU.
                </div>
              ) : (
                <table className="w-full border-collapse" style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11 }}>
                  <thead className="sticky top-0 z-10 bg-gray-100 shadow-sm">
                    <tr>
                      <th className="sticky left-0 z-20 bg-gray-100 px-2 py-2 text-left text-[9px] font-bold uppercase tracking-widest text-gray-500 border-b border-r border-gray-200" style={{ width: 40 }}>#</th>
                      {COLUMNS.map(c => (
                        <th
                          key={c.key}
                          className="px-3 py-2 text-[9px] font-bold uppercase tracking-widest text-gray-500 border-b border-r border-gray-200"
                          style={{ width: c.width, textAlign: c.align ?? 'left' }}
                        >
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((u, i) => (
                      <tr
                        key={u.id}
                        className="hover:bg-emerald-50/60 transition-colors"
                      >
                        <td className="sticky left-0 z-10 bg-white hover:bg-emerald-50/60 px-2 py-1.5 text-gray-400 border-b border-r border-gray-100 text-[10px]" style={{ width: 40 }}>
                          {i + 1}
                        </td>
                        {COLUMNS.map(c => {
                          const val = format(u, c.key);
                          if (c.key === 'age') {
                            const d = daysSinceDateIn(u.dateIn);
                            if (d == null) {
                              return (
                                <td
                                  key={c.key}
                                  className="px-3 py-1.5 border-b border-r border-gray-100 text-gray-300"
                                  style={{ maxWidth: c.width, textAlign: c.align ?? 'left' }}
                                >—</td>
                              );
                            }
                            const bucket = ageBucket(d);
                            const pillTone =
                              bucket === 'within' ? 'bg-emerald-100 text-emerald-700' :
                              bucket === 'ageing' ? 'bg-amber-100 text-amber-700'    :
                                                    'bg-gray-100 text-gray-600';
                            const tip =
                              bucket === 'within' ? `${d} days — within 30-day supplier return window` :
                              bucket === 'ageing' ? `${d} days — past 30-day window, ageing`           :
                                                    `${d} days — old stock`;
                            return (
                              <td
                                key={c.key}
                                className="px-3 py-1.5 border-b border-r border-gray-100"
                                style={{ maxWidth: c.width, textAlign: c.align ?? 'left' }}
                                title={tip}
                              >
                                <span className={`inline-flex items-center text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded ${pillTone}`}>
                                  {d}d
                                </span>
                              </td>
                            );
                          }
                          const tone =
                            c.key === 'status' && /sold/i.test(val) ? 'text-rose-600' :
                            c.key === 'status' && /(available|fba|ready)/i.test(val) ? 'text-emerald-700' :
                            'text-gray-800';
                          return (
                            <td
                              key={c.key}
                              className={`px-3 py-1.5 border-b border-r border-gray-100 truncate ${tone}`}
                              style={{ maxWidth: c.width, textAlign: c.align ?? 'left' }}
                              title={val}
                            >
                              {val}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Footer */}
            <div className="flex-shrink-0 px-5 py-2.5 border-t border-gray-200 bg-gray-50 flex items-center justify-between">
              <p className="text-[9px] font-mono uppercase tracking-widest text-gray-500">
                {rows.length} row{rows.length === 1 ? '' : 's'}
                {rows.length > 0 && (() => {
                  const total = rows.reduce((s, u) => s + (u.buyPrice || 0), 0);
                  return <> · stock value £{total.toLocaleString('en-GB', { maximumFractionDigits: 0 })}</>;
                })()}
              </p>
              <p className="hidden sm:block text-[9px] font-mono text-gray-400">
                Tab-separated copy is Excel-pasteable
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
