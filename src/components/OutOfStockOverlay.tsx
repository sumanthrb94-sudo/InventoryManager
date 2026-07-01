/**
 * OutOfStockOverlay — fullscreen view of SKU buckets that went out of stock
 * within the last 72 hours.
 *
 * A bucket is "out of stock" when it currently has zero available units but
 * has sold at least one unit. Because the app does not persist the exact
 * moment a SKU hit zero stock, the 72-hour window uses the latest sale date
 * in the bucket as the closest available proxy.
 */
import React from 'react';
import { motion } from 'motion/react';
import { X, PackageX, AlertTriangle, PackageCheck } from 'lucide-react';

export type OutOfStockBucket = {
  key: string;
  label: string;
  suppliers: Set<string>;
  available: number;
  sold: number;
  lastSold: string;
  latestBp: number;
};

interface Props {
  buckets: OutOfStockBucket[];
  onClose: () => void;
}

export default function OutOfStockOverlay({ buckets, onClose }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[70] flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm p-0 md:p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        exit={{ y: 30, opacity: 0 }} transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        onClick={e => e.stopPropagation()}
        className="bg-white w-full md:max-w-4xl rounded-t-3xl md:rounded-3xl shadow-2xl flex flex-col overflow-hidden"
        style={{ maxHeight: 'calc(100dvh - 24px)' }}
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-rose-100 bg-rose-50 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-2xl bg-rose-100 text-rose-700 flex items-center justify-center flex-shrink-0">
              <PackageX size={16} />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold tracking-tight text-rose-900">Out of Stock · Last 72 Hours</h3>
              <p className="text-[10px] font-mono text-rose-700/70 mt-0.5">
                {buckets.length === 0
                  ? 'No SKU buckets went out of stock in the last 72 hours'
                  : `${buckets.length} SKU bucket(s) sold out recently · reorder candidates`}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-rose-100 text-rose-700 flex-shrink-0">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {buckets.length === 0 ? (
            <div className="py-16 flex flex-col items-center gap-2 text-slate-400">
              <PackageCheck size={28} className="text-emerald-500" />
              <p className="text-[11px] font-mono uppercase tracking-widest">Nothing sold out recently</p>
              <p className="text-[10px] font-mono text-slate-400">All SKUs still have available stock or no recent sales</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {buckets.map(b => (
                <div key={b.key} className="px-5 py-3 hover:bg-slate-50 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-[13px] text-slate-900 truncate">{b.label}</span>
                        <span className="inline-flex items-center gap-1 text-[8px] font-bold uppercase px-1.5 py-0.5 rounded border bg-rose-100 text-rose-700 border-rose-200">
                          <AlertTriangle size={8} /> Out of Stock
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-2 flex-wrap text-[10px] font-mono text-slate-500">
                        <span>{b.sold} sold{b.lastSold ? ` · last ${b.lastSold}` : ''}</span>
                        <span>·</span>
                        <span>{[...b.suppliers].slice(0, 3).join(' / ') || '—'}</span>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      {b.latestBp > 0 && (
                        <p className="text-[12px] font-mono font-bold text-slate-700">£{b.latestBp}</p>
                      )}
                      <p className="text-[9px] font-mono text-slate-400 mt-0.5">last BP</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
