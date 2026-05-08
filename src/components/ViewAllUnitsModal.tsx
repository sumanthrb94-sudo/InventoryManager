import React, { useState, useMemo } from 'react';
import { X, Check, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { InventoryUnit, ListingSite } from '../types';
import { dbService } from '../lib/dbService';

interface Props {
  seriesKey: string;
  searchTerm: string;
  units: InventoryUnit[];
  onClose: () => void;
}

const LISTING_SITES: ListingSite[] = ['eBay', 'Amazon', 'OnBuy', 'Backmarket'];

export default function ViewAllUnitsModal({ seriesKey, searchTerm, units, onClose }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState('');
  const [listingSiteFilter, setListingSiteFilter] = useState<ListingSite | 'all'>('all');

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

  const handleSelectAll = () => {
    if (selected.size === inStock.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(inStock.map(u => u.id)));
    }
  };

  const handleToggleSelect = (id: string) => {
    const newSelected = new Set(selected);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelected(newSelected);
  };

  const handleUpdateListingSites = async (site: ListingSite, add: boolean) => {
    if (selected.size === 0) return;
    setUpdating(true);
    setUpdateError('');
    try {
      const selectedUnits = inStock.filter(u => selected.has(u.id));
      for (const unit of selectedUnits) {
        const currentSites = unit.listingSites || [];
        const newSites = add
          ? [...new Set([...currentSites, site])]
          : currentSites.filter(s => s !== site);
        await dbService.update('inventoryUnits', unit.id, { listingSites: newSites });
      }
      setSelected(new Set());
    } catch (err: any) {
      setUpdateError(err?.message || 'Failed to update listing sites');
    } finally {
      setUpdating(false);
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
        className="bg-white rounded-2xl w-full max-w-4xl shadow-2xl flex flex-col"
        style={{ maxHeight: '90vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-xl font-bold tracking-tight">{seriesKey}</h2>
            <p className="text-sm text-gray-500 font-mono mt-1">
              {filtered.length} total · {inStock.length} in stock {shs.length > 0 ? `· ${shs.length} SHS` : ''}
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
          {/* Stats */}
          <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-gray-500 font-mono uppercase tracking-widest">In Stock</p>
                <p className="text-2xl font-bold mt-1 text-emerald-700">{inStock.length}</p>
              </div>
              {shs.length > 0 && (
                <div>
                  <p className="text-xs text-gray-500 font-mono uppercase tracking-widest">SHS</p>
                  <p className="text-2xl font-bold mt-1 text-amber-700">{shs.length}</p>
                </div>
              )}
              {sold.length > 0 && (
                <div>
                  <p className="text-xs text-gray-500 font-mono uppercase tracking-widest">Sold</p>
                  <p className="text-2xl font-bold mt-1 text-blue-700">{sold.length}</p>
                </div>
              )}
            </div>
          </div>

          {/* Bulk actions */}
          {inStock.length > 0 && (
            <div className="px-6 py-4 border-b border-gray-100 bg-white space-y-3">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={selected.size === inStock.length && inStock.length > 0}
                  onChange={handleSelectAll}
                  className="w-4 h-4 rounded border-gray-300"
                />
                <span className="text-sm font-medium">
                  {selected.size === 0 ? 'Select all' : `${selected.size} selected`}
                </span>
              </div>

              {selected.size > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-gray-600 font-mono">UPDATE LISTING SITES</p>
                  <div className="flex gap-2 flex-wrap">
                    {LISTING_SITES.map(site => (
                      <button
                        key={site}
                        disabled={updating}
                        onClick={() => handleUpdateListingSites(site, true)}
                        className="px-3 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg text-xs font-bold hover:bg-blue-100 transition-all disabled:opacity-50 flex items-center gap-1"
                      >
                        {updating ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <Check size={12} />
                        )}
                        Add to {site}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {updateError && (
                <p className="text-xs text-red-600 font-mono">{updateError}</p>
              )}
            </div>
          )}

          {/* Units list */}
          <div className="divide-y divide-gray-100">
            {inStock.length === 0 ? (
              <div className="py-16 flex flex-col items-center gap-2 text-gray-400">
                <p className="text-sm font-mono">No units in stock</p>
              </div>
            ) : (
              inStock.map(u => (
                <div key={u.id} className="px-6 py-3 hover:bg-gray-50 transition-all flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={selected.has(u.id)}
                    onChange={() => handleToggleSelect(u.id)}
                    className="w-4 h-4 rounded border-gray-300"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-gray-400">{u.imei?.slice(-4)}</span>
                    </div>
                    <p className="text-sm font-semibold text-gray-900">{u.model}</p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {u.colour && (
                        <span className="text-xs text-gray-600 font-mono">{u.colour}</span>
                      )}
                      {u.storage && (
                        <span className="text-xs text-gray-600 font-mono">{u.storage}</span>
                      )}
                      {u.grade && (
                        <span className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded font-mono">
                          {u.grade}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-4 flex-shrink-0 text-right">
                    <div>
                      <p className="text-sm font-bold text-gray-900">£{u.buyPrice}</p>
                      <p className="text-xs text-gray-500">Buy Price</p>
                    </div>
                    {u.listingSites && u.listingSites.length > 0 && (
                      <div className="flex gap-1">
                        {u.listingSites.map(site => (
                          <span
                            key={site}
                            className="text-xs bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded font-mono font-bold"
                          >
                            {site}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
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
