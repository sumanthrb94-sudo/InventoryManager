import React, { useMemo, useState } from 'react';
import { X, ChevronUp, ChevronDown } from 'lucide-react';
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
  // Default to most-recent first across the app — overridable via column header.
  const [sortKey, setSortKey] = useState<string>('dateIn');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const supplierMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const s of suppliers) map[s.id] = s.name;
    return map;
  }, [suppliers]);

  const columns = [
    { key: 'unit', label: '#', width: 'w-12', sortable: false },
    { key: 'model', label: 'Model', width: 'w-36', sortable: true },
    { key: 'colour', label: 'Colour', width: 'w-28', sortable: true },
    { key: 'storage', label: 'Storage', width: 'w-24', sortable: true },
    { key: 'grade', label: 'Grade', width: 'w-20', sortable: true },
    { key: 'imei', label: 'IMEI', width: 'w-40', sortable: true },
    { key: 'supplier', label: 'Supplier', width: 'w-32', sortable: true },
    { key: 'bp', label: 'Buy Price', width: 'w-24', sortable: true },
    { key: 'dateIn', label: 'Date In', width: 'w-24', sortable: true },
  ];

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortOrder('asc');
    }
  };

  const sortedUnits = useMemo(() => {
    if (!sortKey) return units;
    const sorted = [...units];
    sorted.sort((a, b) => {
      let aVal: any = '';
      let bVal: any = '';

      if (sortKey === 'model') { aVal = a.model; bVal = b.model; }
      else if (sortKey === 'colour') { aVal = a.colour || ''; bVal = b.colour || ''; }
      else if (sortKey === 'storage') { aVal = a.storage || ''; bVal = b.storage || ''; }
      else if (sortKey === 'grade') { aVal = a.grade || ''; bVal = b.grade || ''; }
      else if (sortKey === 'imei') { aVal = a.imei || ''; bVal = b.imei || ''; }
      else if (sortKey === 'supplier') {
        aVal = supplierMap[a.supplierId] || '';
        bVal = supplierMap[b.supplierId] || '';
      }
      else if (sortKey === 'bp') { aVal = a.buyPrice; bVal = b.buyPrice; }
      else if (sortKey === 'dateIn') { aVal = a.dateIn || ''; bVal = b.dateIn || ''; }

      if (typeof aVal === 'string') {
        const cmp = aVal.localeCompare(bVal);
        return sortOrder === 'asc' ? cmp : -cmp;
      } else {
        return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
      }
    });
    return sorted;
  }, [sortKey, sortOrder, units, supplierMap]);

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
                      onClick={() => col.sortable && handleSort(col.key)}
                      className={`${col.width} px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wide border-r border-gray-300 last:border-r-0 ${
                        col.sortable ? 'cursor-pointer hover:bg-gray-200 transition-colors' : ''
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        {col.label}
                        {col.sortable && sortKey === col.key && (
                          sortOrder === 'asc'
                            ? <ChevronUp size={13} className="text-gray-500" />
                            : <ChevronDown size={13} className="text-gray-500" />
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>

              {/* Table Body */}
              <tbody>
                {sortedUnits.map((u, idx) => (
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
