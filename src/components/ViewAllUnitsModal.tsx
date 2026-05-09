import React, { useState, useMemo } from 'react';
import { X } from 'lucide-react';
import { motion } from 'motion/react';
import { InventoryUnit } from '../types';
import { useInventoryStore } from '../lib/inventoryStore';
import CopyImei from './CopyImei';

interface Props {
  seriesKey: string;
  searchTerm: string;
  units: InventoryUnit[];
  onClose: () => void;
}

export default function ViewAllUnitsModal({ seriesKey, searchTerm, units, onClose }: Props) {
  const { suppliers } = useInventoryStore();
  const [activeTab, setActiveTab] = useState<'in-stock' | 'shs' | 'sold'>('in-stock');

  const supplierMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const s of suppliers) map[s.id] = s.name;
    return map;
  }, [suppliers]);

  const filtered = useMemo(() => {
    const q = searchTerm.toLowerCase();
    return units.filter(u =>
      u.model.toLowerCase().includes(q) ||
      (u.imei || '').toLowerCase().includes(q) ||
      u.colour?.toLowerCase().includes(q) ||
      u.storage?.toLowerCase().includes(q),
    );
  }, [units, searchTerm]);

  const inStock = filtered.filter(u => u.status === 'available');
  const shs = filtered.filter(u => u.status === 'incoming');
  const sold = filtered.filter(u => u.status === 'sold');

  const displayUnits = activeTab === 'in-stock' ? inStock : activeTab === 'shs' ? shs : sold;

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
        className="bg-white rounded-3xl overflow-hidden w-full max-w-4xl shadow-2xl flex flex-col overflow-hidden"
        style={{ maxHeight: '90vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-xl font-bold tracking-tight">{seriesKey}</h2>
            <p className="text-sm text-gray-500 font-mono mt-1">
              {filtered.length} total · {inStock.length} in stock {shs.length > 0 ? `· ${shs.length} SHS` : ''} {sold.length > 0 ? `· ${sold.length} sold` : ''}
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

        {/* Tabs */}
        <div className="flex border-b border-gray-100 bg-white px-6">
          <button
            onClick={() => setActiveTab('in-stock')}
            className={`py-3 px-4 text-sm font-bold border-b-2 transition-all ${
              activeTab === 'in-stock'
                ? 'border-emerald-500 text-emerald-700'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            In Stock ({inStock.length})
          </button>
          {shs.length > 0 && (
            <button
              onClick={() => setActiveTab('shs')}
              className={`py-3 px-4 text-sm font-bold border-b-2 transition-all ${
                activeTab === 'shs'
                  ? 'border-amber-500 text-amber-700'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              SHS ({shs.length})
            </button>
          )}
          {sold.length > 0 && (
            <button
              onClick={() => setActiveTab('sold')}
              className={`py-3 px-4 text-sm font-bold border-b-2 transition-all ${
                activeTab === 'sold'
                  ? 'border-blue-500 text-blue-700'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              Sold ({sold.length})
            </button>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          {displayUnits.length === 0 ? (
            <div className="py-16 flex flex-col items-center gap-2 text-gray-400">
              <p className="text-sm font-mono">No units in this category</p>
            </div>
          ) : (
            <table className="w-full border-collapse">
              {/* Table Header */}
              <thead className="sticky top-0 bg-gray-100 border-b border-gray-300 z-10">
                <tr>
                  <th className="w-12 px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wide border-r border-gray-300">#</th>
                  <th className="w-32 px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wide border-r border-gray-300">Model</th>
                  <th className="w-28 px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wide border-r border-gray-300">Colour</th>
                  <th className="w-24 px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wide border-r border-gray-300">Storage</th>
                  <th className="w-20 px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wide border-r border-gray-300">Grade</th>
                  <th className="w-40 px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wide border-r border-gray-300">IMEI</th>
                  <th className="w-32 px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wide border-r border-gray-300">Supplier</th>
                  <th className="w-24 px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wide border-r border-gray-300">Buy Price</th>
                  <th className="w-32 px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wide">Batch</th>
                </tr>
              </thead>

              {/* Table Body */}
              <tbody>
                {displayUnits.map((u, idx) => (
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
                    <td className="px-4 py-3 text-xs font-mono text-gray-700">{u.batchId === 'master_batch' ? 'Master' : (u.batchId || '—')}</td>
                  </tr>
                ))}
              </tbody>

              {/* Footer Summary */}
              <tfoot className="sticky bottom-0 bg-gray-100 border-t border-gray-300">
                <tr>
                  <td colSpan={7} className="px-4 py-3 text-xs font-bold text-gray-700">TOTAL</td>
                  <td className="px-4 py-3 text-xs font-mono font-bold text-gray-900">
                    £{displayUnits.reduce((s, u) => s + u.buyPrice, 0).toFixed(2)}
                  </td>
                  <td className="px-4 py-3" />
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-300 bg-gray-50">
          <button
            onClick={onClose}
            className="w-full py-2 bg-blue-600 text-white rounded-xl text-sm font-bold uppercase tracking-widest hover:bg-blue-700 transition-all"
          >
            Close
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
