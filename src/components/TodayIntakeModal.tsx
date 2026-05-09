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
            <div>
              {/* Table header */}
              <div className="sticky top-0 bg-gray-50 border-b border-gray-200 px-6 py-3 flex items-center gap-4 text-xs font-bold text-gray-600 uppercase tracking-widest">
                <div style={{ flex: '0 0 120px' }}>IMEI</div>
                <div style={{ flex: '1 1 200px' }} className="min-w-0">Model</div>
                <div style={{ flex: '0 0 100px' }}>Colour</div>
                <div style={{ flex: '0 0 100px' }}>Storage</div>
                <div style={{ flex: '0 0 80px' }}>Grade</div>
                <div style={{ flex: '0 0 150px' }}>Batch</div>
                <div style={{ flex: '0 0 150px' }}>Supplier</div>
                <div style={{ flex: '0 0 80px', textAlign: 'right' }}>Price</div>
              </div>

              {/* Table rows */}
              <div className="divide-y divide-gray-100">
                {units.map(u => {
                  const supplierName = supplierMap[u.supplierId] || 'Unknown';
                  const hasIMEI = !!u.imei;

                  return (
                    <div
                      key={u.id}
                      className="px-6 py-3 hover:bg-gray-50 transition-all flex items-center gap-4 text-sm"
                    >
                      <div style={{ flex: '0 0 120px' }} className="truncate">
                        {hasIMEI ? (
                          <CopyImei imei={u.imei} truncate={10} />
                        ) : (
                          <span className="text-xs text-gray-400 font-mono">No IMEI</span>
                        )}
                      </div>

                      <div style={{ flex: '1 1 200px' }} className="min-w-0 truncate font-semibold text-gray-900">
                        {u.model}
                      </div>

                      <div style={{ flex: '0 0 100px' }} className="truncate text-gray-600 font-mono text-xs">
                        {u.colour || '—'}
                      </div>

                      <div style={{ flex: '0 0 100px' }} className="truncate text-gray-600 font-mono text-xs">
                        {u.storage || '—'}
                      </div>

                      <div style={{ flex: '0 0 80px' }} className="truncate">
                        {u.grade ? (
                          <span className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded font-bold inline-block">
                            {u.grade}
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </div>

                      <div style={{ flex: '0 0 150px' }} className="truncate text-gray-600 font-mono text-xs">
                        {u.batchId === 'master_batch' ? 'Master Batch' : u.batchId || '—'}
                      </div>

                      <div style={{ flex: '0 0 150px' }} className="truncate text-gray-600 font-mono text-xs">
                        {supplierName}
                      </div>

                      <div style={{ flex: '0 0 80px', textAlign: 'right' }} className="font-bold text-gray-900">
                        £{u.buyPrice}
                      </div>
                    </div>
                  );
                })}
              </div>
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
