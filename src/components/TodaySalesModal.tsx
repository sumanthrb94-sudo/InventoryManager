import React, { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { motion } from 'motion/react';
import { InventoryUnit } from '../types';
import { useInventoryStore } from '../lib/inventoryStore';
import { dbService } from '../lib/dbService';
import CopyImei from './CopyImei';
import { PLATFORM_LIST } from '../lib/platforms';

interface Props {
  units: InventoryUnit[];
  onClose: () => void;
}

export default function TodaySalesModal({ units, onClose }: Props) {
  const { suppliers } = useInventoryStore();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [editingNotes, setEditingNotes] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const supplierMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const s of suppliers) map[s.id] = s.name;
    return map;
  }, [suppliers]);

  const totalRevenue = units.reduce((s, u) => s + (u.salePrice || 0), 0);

  const handleSaveNotes = async (unitId: string, noteText: string) => {
    setSaving(true);
    try {
      await dbService.update('inventoryUnits', unitId, { internalNotes: noteText });
      setNotes(prev => ({ ...prev, [unitId]: noteText }));
      setEditingNotes(null);
    } catch (err) {
      console.error('Failed to save notes:', err);
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    { key: 'unit', label: '#', width: 'w-12' },
    { key: 'model', label: 'Model', width: 'w-32' },
    { key: 'colour', label: 'Colour', width: 'w-28' },
    { key: 'storage', label: 'Storage', width: 'w-24' },
    { key: 'bp', label: 'Buy Price', width: 'w-24' },
    { key: 'sp', label: 'Sale Price', width: 'w-24' },
    { key: 'platform', label: 'Platform', width: 'w-28' },
    { key: 'orderId', label: 'Order ID', width: 'w-32' },
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
        className="bg-white rounded-2xl w-full max-w-7xl shadow-2xl flex flex-col"
        style={{ maxHeight: '90vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-300 bg-gray-50">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Today's Sales</h2>
            <p className="text-xs text-gray-600 font-mono mt-1">
              {units.length} units · £{totalRevenue.toLocaleString()} revenue · £{totalProfit.toLocaleString()} profit
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
              <p className="text-sm font-mono">No sales recorded today</p>
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
                      <td className="px-4 py-3 text-xs font-mono font-bold text-gray-900">£{u.buyPrice.toFixed(2)}</td>
                      <td className="px-4 py-3 text-xs font-mono font-bold text-emerald-600">
                        £{(u.salePrice || 0).toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-xs font-semibold">
                        <span className={`px-2 py-1 rounded-lg ${
                          u.salePlatform === 'eBay' ? 'bg-yellow-100 text-yellow-800' :
                          u.salePlatform === 'Amazon' ? 'bg-orange-100 text-orange-800' :
                          u.salePlatform === 'OnBuy' ? 'bg-blue-100 text-blue-800' :
                          u.salePlatform === 'Backmarket' ? 'bg-green-100 text-green-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {u.salePlatform || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs font-mono text-gray-700">{u.saleOrderId || '—'}</td>
                    </tr>
                  ))}
              </tbody>

              {/* Footer Summary */}
              <tfoot className="sticky bottom-0 bg-gray-100 border-t border-gray-300">
                <tr>
                  <td colSpan={4} className="px-4 py-3 text-xs font-bold text-gray-700">TOTAL</td>
                  <td className="px-4 py-3 text-xs font-mono font-bold text-gray-900">
                    £{units.reduce((s, u) => s + u.buyPrice, 0).toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-xs font-mono font-bold text-emerald-600">
                    £{totalRevenue.toFixed(2)}
                  </td>
                  <td colSpan={3} className="px-4 py-3" />
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
