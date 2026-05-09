import React, { useMemo } from 'react';
import { X } from 'lucide-react';
import { motion } from 'motion/react';
import { InventoryUnit } from '../types';
import { useInventoryStore } from '../lib/inventoryStore';
import CopyImei from './CopyImei';

interface Props {
  units: InventoryUnit[];
  onClose: () => void;
}

export default function InStockModal({ units, onClose }: Props) {
  const { suppliers } = useInventoryStore();

  const supplierMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const s of suppliers) map[s.id] = s.name;
    return map;
  }, [suppliers]);

  const totalBP = units.reduce((s, u) => s + u.buyPrice, 0);

  const columns = [
    { key: 'unit', label: '#', width: 'w-12' },
    { key: 'model', label: 'Model', width: 'w-36' },
    { key: 'colour', label: 'Colour', width: 'w-28' },
    { key: 'storage', label: 'Storage', width: 'w-24' },
    { key: 'grade', label: 'Grade', width: 'w-20' },
    { key: 'imei', label: 'IMEI', width: 'w-40' },
    { key: 'supplier', label: 'Supplier', width: 'w-32' },
    { key: 'bp', label: 'Buy Price', width: 'w-24' },
    { key: 'dateIn', label: 'Date In', width: 'w-24' },
  ];

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
        className="bg-white rounded-3xl overflow-hidden w-full max-w-7xl shadow-2xl flex flex-col"
        style={{ maxHeight: '90vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-300 bg-gray-50">
          <div>
            <h2 className="text-lg font-bold text-gray-900">In Stock · Office</h2>
            <p className="text-xs text-gray-600 font-mono mt-1">
              {units.length} units · £{totalBP.toLocaleString()} total buy value
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-lg transition-all">
            <X size={20} className="text-gray-600" />
          </button>
        </div>

        {/* Table Content */}
        <div className="flex-1 overflow-auto">
          {units.length === 0 ? (
            <div className="py-16 flex flex-col items-center gap-2 text-gray-400">
              <p className="text-sm font-mono">No units in stock</p>
            </div>
          ) : (
            <table className="w-full border-collapse">
              {/* Table Header */}
              <thead className="sticky top-0 bg-gray-100 border-b border-gray-300 z-10">
                <tr>
                  {columns.map(col => (
                    <th
                      key={col.key}
                      className={`${col.width} px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wide border-r border-gray-300 last:border-r-0`}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>

              {/* Table Body */}
              <tbody>
                {units.map((u, idx) => (
                  <tr key={u.id} className="border-b border-gray-200 hover:bg-gray-50">
                    <td className="px-4 py-3 text-xs font-mono text-gray-500">{idx + 1}</td>
                    <td className="px-4 py-3 text-xs font-bold text-gray-900 truncate">{u.model}</td>
                    <td className="px-4 py-3 text-xs text-gray-700">{u.colour || '—'}</td>
                    <td className="px-4 py-3 text-xs text-gray-700">{u.storage || '—'}</td>
                    <td className="px-4 py-3 text-xs text-gray-700 font-semibold">{u.grade || '—'}</td>
                    <td className="px-4 py-3 text-xs font-mono text-gray-700">
                      {u.imei ? (
                        <span className="flex items-center gap-2">
                          {u.imei.slice(-6)}
                          <CopyImei imei={u.imei} />
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-700">{supplierMap[u.supplierId] || '—'}</td>
                    <td className="px-4 py-3 text-xs font-mono font-bold text-gray-900">£{u.buyPrice.toFixed(2)}</td>
                    <td className="px-4 py-3 text-xs font-mono text-gray-700">{u.dateIn || '—'}</td>
                  </tr>
                ))}
              </tbody>

              {/* Footer Summary */}
              <tfoot className="sticky bottom-0 bg-gray-100 border-t border-gray-300">
                <tr>
                  <td colSpan={7} className="px-4 py-3 text-xs font-bold text-gray-700">TOTAL</td>
                  <td className="px-4 py-3 text-xs font-mono font-bold text-gray-900">
                    £{totalBP.toFixed(2)}
                  </td>
                  <td className="px-4 py-3" />
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
