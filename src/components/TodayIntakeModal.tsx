import React, { useMemo, useState } from 'react';
import { X, AlertCircle, TrendingUp, FileText, Save, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { InventoryUnit } from '../types';
import { useInventoryStore } from '../lib/inventoryStore';
import { dbService } from '../lib/dbService';
import CopyImei from './CopyImei';

interface Props {
  units: InventoryUnit[];
  onClose: () => void;
}

interface UnitWithNotes extends InventoryUnit {
  notes?: string;
}

export default function TodayIntakeModal({ units, onClose }: Props) {
  const { suppliers } = useInventoryStore();
  const [expandedUnitId, setExpandedUnitId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  const supplierMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const s of suppliers) map[s.id] = s.name;
    return map;
  }, [suppliers]);

  const totalBP = units.reduce((s, u) => s + u.buyPrice, 0);

  const handleSaveNotes = async (unitId: string, noteText: string) => {
    setSaving(prev => ({ ...prev, [unitId]: true }));
    try {
      await dbService.update('inventoryUnits', unitId, { internalNotes: noteText });
    } catch (err) {
      console.error('Failed to save notes:', err);
    } finally {
      setSaving(prev => ({ ...prev, [unitId]: false }));
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
        className="bg-gradient-to-br from-white to-emerald-50 rounded-3xl w-full max-w-7xl shadow-2xl flex flex-col border border-emerald-100"
        style={{ maxHeight: '90vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-600 to-emerald-700 px-8 py-6 rounded-t-3xl text-white border-b border-emerald-600">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold tracking-tight flex items-center gap-3">
                <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                  <FileText size={20} />
                </div>
                Today's Intake
              </h2>
              <p className="text-emerald-100 font-mono text-sm mt-2">
                {units.length} units · £{totalBP.toLocaleString()} total purchase value
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/10 rounded-lg transition-all"
              aria-label="Close"
            >
              <X size={24} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {units.length === 0 ? (
            <div className="py-16 flex flex-col items-center gap-3 text-gray-400">
              <FileText size={40} className="text-emerald-200" />
              <p className="text-sm font-mono">No units received today</p>
            </div>
          ) : (
            <div className="divide-y divide-emerald-100">
              {units.map((u, idx) => {
                const supplierName = supplierMap[u.supplierId] || 'Unknown';
                const hasIMEI = !!u.imei;
                const isExpanded = expandedUnitId === u.id;
                const hasInsights = (u as any).insights && Object.keys((u as any).insights).length > 0;
                const currentNotes = notes[u.id] ?? (u.internalNotes || '');

                return (
                  <div key={u.id} className="hover:bg-emerald-50/30 transition-all">
                    {/* Main Row - Clickable */}
                    <button
                      onClick={() => setExpandedUnitId(isExpanded ? null : u.id)}
                      className="w-full px-8 py-4 flex items-center gap-4 text-sm text-left hover:bg-emerald-50 transition-all"
                    >
                      {/* Unit Number */}
                      <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 font-bold flex items-center justify-center flex-shrink-0">
                        {idx + 1}
                      </div>

                      {/* IMEI */}
                      <div style={{ flex: '0 0 140px' }} className="truncate">
                        {hasIMEI ? (
                          <CopyImei imei={u.imei} truncate={12} />
                        ) : (
                          <span className="text-xs text-gray-400 font-mono">No IMEI</span>
                        )}
                      </div>

                      {/* Model */}
                      <div style={{ flex: '1 1 280px' }} className="min-w-0 truncate font-semibold text-gray-900">
                        {u.model}
                      </div>

                      {/* Colour */}
                      <div style={{ flex: '0 0 140px' }} className="truncate text-gray-600 font-mono text-xs">
                        {u.colour || '—'}
                      </div>

                      {/* Storage */}
                      <div style={{ flex: '0 0 140px' }} className="truncate text-gray-600 font-mono text-xs">
                        {u.storage || '—'}
                      </div>

                      {/* Grade */}
                      <div style={{ flex: '0 0 100px' }} className="truncate">
                        {u.grade ? (
                          <span className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded font-bold inline-block">
                            {u.grade}
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </div>

                      {/* Batch */}
                      <div style={{ flex: '0 0 180px' }} className="truncate text-gray-600 font-mono text-xs">
                        {u.batchId === 'master_batch' ? 'Master Batch' : u.batchId || '—'}
                      </div>

                      {/* Supplier */}
                      <div style={{ flex: '0 0 200px' }} className="truncate text-gray-600 font-mono text-xs">
                        {supplierName}
                      </div>

                      {/* Price */}
                      <div style={{ flex: '0 0 100px', textAlign: 'right' }} className="font-bold text-emerald-700">
                        £{u.buyPrice}
                      </div>

                      {/* Expand Icon & Indicators */}
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {hasInsights && (
                          <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                            <TrendingUp size={14} className="text-blue-600" />
                          </div>
                        )}
                        <motion.div
                          animate={{ rotate: isExpanded ? 180 : 0 }}
                          transition={{ duration: 0.2 }}
                          className="w-6 h-6 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0"
                        >
                          <span className="text-emerald-700 font-bold">▼</span>
                        </motion.div>
                      </div>
                    </button>

                    {/* Expanded Details */}
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.2 }}
                          className="bg-emerald-50 border-t border-emerald-100 px-8 py-6 space-y-6"
                        >
                          {/* Intelligent Insights */}
                          {hasInsights && (
                            <div className="bg-blue-50 border border-blue-200 rounded-2xl p-6">
                              <div className="flex items-center gap-2 mb-4">
                                <TrendingUp size={18} className="text-blue-600" />
                                <h4 className="font-bold text-blue-900 uppercase tracking-widest text-sm">Intelligence</h4>
                              </div>
                              <div className="space-y-3">
                                {Object.entries((u as any).insights || {}).map(([key, value]: [string, any]) => (
                                  <div key={key} className="flex items-start gap-3">
                                    <AlertCircle size={16} className="text-blue-600 mt-0.5 flex-shrink-0" />
                                    <div>
                                      <p className="text-xs font-bold text-blue-900 uppercase tracking-widest">{key.replace(/_/g, ' ')}</p>
                                      <p className="text-sm text-blue-800 mt-1">{String(value)}</p>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Notes Section */}
                          <div className="bg-white rounded-2xl border border-emerald-200 p-6">
                            <label className="flex items-center gap-2 mb-4">
                              <FileText size={18} className="text-emerald-600" />
                              <span className="font-bold text-emerald-900 uppercase tracking-widest text-sm">Internal Notes</span>
                            </label>
                            <textarea
                              value={currentNotes}
                              onChange={(e) => setNotes(prev => ({ ...prev, [u.id]: e.target.value }))}
                              placeholder="Add notes about this unit..."
                              className="w-full h-24 p-4 border border-emerald-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none font-mono text-sm"
                            />
                            <div className="flex justify-end mt-4">
                              <button
                                onClick={() => handleSaveNotes(u.id, currentNotes)}
                                disabled={saving[u.id]}
                                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-all font-bold text-sm disabled:opacity-50"
                              >
                                {saving[u.id] ? (
                                  <>
                                    <Loader2 size={16} className="animate-spin" />
                                    Saving...
                                  </>
                                ) : (
                                  <>
                                    <Save size={16} />
                                    Save Notes
                                  </>
                                )}
                              </button>
                            </div>
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
        <div className="px-8 py-4 border-t border-emerald-200 bg-gradient-to-r from-emerald-50 to-white rounded-b-3xl flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 bg-gradient-to-r from-emerald-600 to-emerald-700 text-white rounded-xl text-sm font-bold hover:from-emerald-700 hover:to-emerald-800 transition-all"
          >
            Close
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
