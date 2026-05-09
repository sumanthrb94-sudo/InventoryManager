import React, { useMemo } from 'react';
import { X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { InventoryUnit } from '../types';
import { useInventoryStore } from '../lib/inventoryStore';
import CopyImei from './CopyImei';

interface Props {
  units: InventoryUnit[];
  onClose: () => void;
}

export default function TodayIntakeModal({ units, onClose }: Props) {
  const { suppliers } = useInventoryStore();

  const supplierMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const s of suppliers) map[s.id] = s.name;
    return map;
  }, [suppliers]);

  const totalBP = units.reduce((s, u) => s + u.buyPrice, 0);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[95] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-white rounded-2xl w-full max-w-3xl shadow-2xl flex flex-col"
        style={{ maxHeight: '90vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-xl font-bold tracking-tight">Today's Intake</h2>
            <p className="text-sm text-gray-500 font-mono mt-1">
              {units.length} units · £{totalBP.toLocaleString()} total
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-all"
            aria-label="Close"
          >
            <X size={20} className="text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {units.length === 0 ? (
            <div className="py-16 flex flex-col items-center gap-2 text-gray-400">
              <p className="text-sm font-mono">No units received today</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {units.map(u => {
                const supplierName = supplierMap[u.supplierId] || 'Unknown Supplier';
                const hasIMEI = !!u.imei;

                return (
                  <div
                    key={u.id}
                    className="px-6 py-4 hover:bg-gray-50 transition-all flex items-start gap-4"
                  >
                    <div className="flex-1 min-w-0">
                      {/* Top row: IMEI and model */}
                      <div className="flex items-start gap-2 mb-2">
                        {hasIMEI ? (
                          <CopyImei imei={u.imei} truncate={12} />
                        ) : (
                          <span className="text-xs text-gray-400 font-mono">No IMEI</span>
                        )}
                      </div>

                      {/* Model name */}
                      <p className="text-sm font-semibold text-gray-900 mb-2">{u.model}</p>

                      {/* Specs row */}
                      <div className="flex items-center gap-2 flex-wrap mb-2">
                        {u.colour && (
                          <span className="text-xs text-gray-600 font-mono bg-gray-100 px-2 py-1 rounded">
                            {u.colour}
                          </span>
                        )}
                        {u.storage && (
                          <span className="text-xs text-gray-600 font-mono bg-gray-100 px-2 py-1 rounded">
                            {u.storage}
                          </span>
                        )}
                        {u.grade && (
                          <span className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded font-mono font-bold">
                            {u.grade}
                          </span>
                        )}
                      </div>

                      {/* Batch and Supplier info */}
                      <div className="text-xs text-gray-500 font-mono space-y-0.5">
                        {u.batchId && (
                          <p>
                            Batch:{' '}
                            <span className="text-gray-700 font-bold">
                              {u.batchId === 'master_batch' ? 'Master Batch' : u.batchId}
                            </span>
                          </p>
                        )}
                        <p>
                          Supplier: <span className="text-gray-700 font-bold">{supplierName}</span>
                        </p>
                      </div>
                    </div>

                    {/* Right side: Price */}
                    <div className="flex items-center gap-4 flex-shrink-0 text-right">
                      <div>
                        <p className="text-sm font-bold text-gray-900">£{u.buyPrice}</p>
                        <p className="text-xs text-gray-500">Buy Price</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2 border border-gray-300 rounded-lg text-sm font-bold text-gray-700 hover:bg-gray-100 transition-all"
          >
            Close
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
