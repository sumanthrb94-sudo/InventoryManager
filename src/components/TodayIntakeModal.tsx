import React, { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { motion } from 'motion/react';
import { InventoryUnit } from '../types';
import { useInventoryStore } from '../lib/inventoryStore';
import { dbService } from '../lib/dbService';
import CopyImei from './CopyImei';

interface Props {
  units: InventoryUnit[];
  onClose: () => void;
}

export default function TodayIntakeModal({ units, onClose }: Props) {
  const { suppliers } = useInventoryStore();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const supplierMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const s of suppliers) map[s.id] = s.name;
    return map;
  }, [suppliers]);

  const totalBP = units.reduce((s, u) => s + u.buyPrice, 0);

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
    { key: 'batch', label: 'Batch', width: 'w-32' },
    { key: 'imei', label: 'IMEI', width: 'w-40' },
    { key: 'supplier', label: 'Supplier', width: 'w-32' },
    { key: 'price', label: 'Price', width: 'w-24' },
    { key: 'notes', label: 'Notes', width: 'flex-1' },
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
            <h2 className="text-lg font-bold text-gray-900">Today's Intake</h2>
            <p className="text-xs text-gray-600 font-mono mt-1">{units.length} units • £{totalBP.toLocaleString()}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-lg transition-all">
            <X size={20} className="text-gray-600" />
          </button>
        </div>

        {/* Table Content */}
        <div className="flex-1 overflow-auto">
          {units.length === 0 ? (
            <div className="py-16 flex flex-col items-center gap-2 text-gray-400">
              <p className="text-sm font-mono">No units received today</p>
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
                {units.map((u, idx) => {
                  const supplierName = supplierMap[u.supplierId] || 'Unknown';

                  return (
                    <tr key={u.id} className="border-b border-gray-200 hover:bg-emerald-50 transition-colors">
                      {/* Unit # */}
                      <td className="px-4 py-3 text-xs font-bold text-gray-700 bg-emerald-100/50">
                        {idx + 1}
                      </td>

                      {/* Model */}
                      <td className="px-4 py-3 text-sm font-semibold text-gray-900 max-w-xs truncate">
                        {u.model}
                      </td>

                      {/* Colour */}
                      <td className="px-4 py-3 text-xs text-gray-600 font-mono">
                        {u.colour || '—'}
                      </td>

                      {/* Storage */}
                      <td className="px-4 py-3 text-xs text-gray-600 font-mono">
                        {u.storage || '—'}
                      </td>

                      {/* Batch */}
                      <td className="px-4 py-3 text-xs text-gray-600 font-mono">
                        {u.batchId ? (u.batchId === 'master_batch' ? 'Master' : u.batchId) : '—'}
                      </td>

                      {/* IMEI */}
                      <td className="px-4 py-3 text-xs">
                        {u.imei ? (
                          <CopyImei imei={u.imei} truncate={14} />
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>

                      {/* Supplier */}
                      <td className="px-4 py-3 text-xs text-gray-600 max-w-xs truncate">
                        {supplierName}
                      </td>

                      {/* Price */}
                      <td className="px-4 py-3 text-sm font-bold text-gray-900">
                        £{u.buyPrice}
                      </td>

                      {/* Notes */}
                      <td className="px-4 py-3 text-xs">
                        <div className="flex gap-2 items-center">
                          <input
                            type="text"
                            value={notes[u.id] ?? (u.internalNotes || '')}
                            onChange={(e) => setNotes(prev => ({ ...prev, [u.id]: e.target.value }))}
                            onBlur={() => {
                              const currentValue = notes[u.id] ?? (u.internalNotes || '');
                              if (currentValue !== (u.internalNotes || '')) {
                                handleSaveNotes(u.id, currentValue);
                              }
                            }}
                            placeholder="Add notes..."
                            className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded font-mono focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-300"
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-300 bg-gray-50">
          <button
            onClick={onClose}
            className="w-full py-2 bg-emerald-600 text-white rounded-lg text-sm font-bold hover:bg-emerald-700 transition-all"
          >
            Close
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
