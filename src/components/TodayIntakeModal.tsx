import React, { useMemo, useState } from 'react';
import { X, ChevronDown, Edit2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
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
  const [expandedUnitId, setExpandedUnitId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [editingNotes, setEditingNotes] = useState<string | null>(null);
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
        className="bg-white rounded-2xl w-full max-w-5xl shadow-2xl flex flex-col"
        style={{ maxHeight: '90vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-bold">Today's Intake</h2>
            <p className="text-xs text-gray-500 font-mono mt-1">{units.length} units • £{totalBP.toLocaleString()}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg transition-all">
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
              {units.map((u, idx) => {
                const supplierName = supplierMap[u.supplierId] || 'Unknown';
                const isExpanded = expandedUnitId === u.id;
                const displayNotes = notes[u.id] ?? (u.internalNotes || '');

                return (
                  <div key={u.id} className="hover:bg-gray-50 transition-all">
                    {/* Main Row */}
                    <button
                      onClick={() => setExpandedUnitId(isExpanded ? null : u.id)}
                      className="w-full px-6 py-3 flex items-center gap-4 text-left hover:bg-gray-50"
                    >
                      {/* Unit Number */}
                      <div className="w-6 h-6 rounded bg-emerald-100 text-emerald-700 font-bold text-xs flex items-center justify-center flex-shrink-0">
                        {idx + 1}
                      </div>

                      {/* Main Info - Brand, Model, Storage, Colour, Batch, BP */}
                      <div className="flex-1 flex items-center gap-6 min-w-0">
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-gray-900 truncate">{u.model}</p>
                          {u.colour && (
                            <p className="text-xs text-gray-500 font-mono mt-0.5">{u.colour}</p>
                          )}
                        </div>
                        {u.storage && (
                          <span className="text-xs text-gray-600 font-mono px-2 py-1 bg-gray-100 rounded whitespace-nowrap">
                            {u.storage}
                          </span>
                        )}
                        {u.batchId && (
                          <span className="text-xs text-gray-600 font-mono whitespace-nowrap">
                            {u.batchId === 'master_batch' ? 'Master' : u.batchId}
                          </span>
                        )}
                      </div>

                      {/* Price */}
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-bold text-gray-900">£{u.buyPrice}</p>
                      </div>

                      {/* Expand Arrow */}
                      <motion.div
                        animate={{ rotate: isExpanded ? 180 : 0 }}
                        className="text-gray-400 flex-shrink-0"
                      >
                        <ChevronDown size={16} />
                      </motion.div>
                    </button>

                    {/* Expanded Details */}
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="bg-gray-50 px-6 py-3 border-t border-gray-100 space-y-2"
                        >
                          {/* IMEI & Supplier */}
                          <div className="flex items-center gap-6">
                            <div>
                              <p className="text-[10px] text-gray-500 font-mono uppercase tracking-widest mb-1">IMEI</p>
                              {u.imei ? (
                                <CopyImei imei={u.imei} truncate={14} />
                              ) : (
                                <p className="text-xs text-gray-400">—</p>
                              )}
                            </div>
                            <div>
                              <p className="text-[10px] text-gray-500 font-mono uppercase tracking-widest mb-1">Supplier</p>
                              <p className="text-xs text-gray-700">{supplierName}</p>
                            </div>
                          </div>

                          {/* Notes Section */}
                          <div className="pt-2 border-t border-gray-200">
                            <div className="flex items-center gap-2 mb-2">
                              <p className="text-[10px] text-gray-500 font-mono uppercase tracking-widest">Notes</p>
                              <button
                                onClick={() => setEditingNotes(editingNotes === u.id ? null : u.id)}
                                className="p-1 hover:bg-white rounded transition-all"
                                title="Edit notes"
                              >
                                <Edit2 size={12} className="text-gray-400" />
                              </button>
                            </div>

                            {editingNotes === u.id ? (
                              <div className="flex gap-2">
                                <textarea
                                  value={notes[u.id] ?? (u.internalNotes || '')}
                                  onChange={(e) => setNotes(prev => ({ ...prev, [u.id]: e.target.value }))}
                                  placeholder="Add notes..."
                                  className="flex-1 text-xs p-2 border border-emerald-200 rounded font-mono focus:outline-none focus:ring-1 focus:ring-emerald-500 resize-none"
                                  rows={2}
                                />
                                <button
                                  onClick={() => handleSaveNotes(u.id, notes[u.id] ?? (u.internalNotes || ''))}
                                  disabled={saving}
                                  className="px-3 py-2 bg-emerald-600 text-white text-xs font-bold rounded hover:bg-emerald-700 transition-all disabled:opacity-50 whitespace-nowrap"
                                >
                                  {saving ? 'Saving...' : 'Save'}
                                </button>
                              </div>
                            ) : (
                              <p className="text-xs text-gray-600 font-mono">
                                {displayNotes || <span className="text-gray-400">—</span>}
                              </p>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-200 bg-gray-50">
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
