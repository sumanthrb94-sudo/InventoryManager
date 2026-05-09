import React, { useState, useMemo } from 'react';
import { X, Check, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { InventoryUnit, ListingSite } from '../types';
import { dbService } from '../lib/dbService';
import { useInventoryStore } from '../lib/inventoryStore';
import CopyImei from './CopyImei';

interface Props {
  seriesKey: string;
  searchTerm: string;
  units: InventoryUnit[];
  onClose: () => void;
}

const LISTING_SITES: ListingSite[] = ['eBay', 'Amazon', 'OnBuy', 'Backmarket'];

export default function ViewAllUnitsModal({ seriesKey, searchTerm, units, onClose }: Props) {
  const { suppliers } = useInventoryStore();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState('');
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

  const handleSelectAll = () => {
    if (selected.size === displayUnits.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(displayUnits.map(u => u.id)));
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
        className="bg-white rounded-3xl w-full max-w-4xl shadow-2xl flex flex-col"
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
        <div className="flex-1 overflow-y-auto">
          {/* Bulk actions for In Stock tab */}
          {activeTab === 'in-stock' && inStock.length > 0 && (
            <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 space-y-3">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={selected.size === inStock.length && inStock.length > 0}
                  onChange={handleSelectAll}
                  className="w-4 h-4 rounded border-gray-300"
                />
                <span className="text-sm font-medium text-gray-900">
                  {selected.size === 0 ? 'Select all' : `${selected.size} selected`}
                </span>
              </div>

              {selected.size > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-gray-600 font-mono uppercase tracking-widest">Update Listing Sites</p>
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
            {displayUnits.length === 0 ? (
              <div className="py-16 flex flex-col items-center gap-2 text-gray-400">
                <p className="text-sm font-mono">No units in this category</p>
              </div>
            ) : (
              displayUnits.map(u => {
                const isSHS = activeTab === 'shs';
                const hasIMEI = !!u.imei;
                const supplierName = supplierMap[u.supplierId] || 'Unknown Supplier';

                return (
                  <div
                    key={u.id}
                    className={`px-6 py-3 transition-all ${
                      isSHS ? 'bg-orange-50/60 hover:bg-orange-50' : 'hover:bg-gray-50'
                    } flex items-center gap-3`}
                  >
                    {activeTab === 'in-stock' && (
                      <input
                        type="checkbox"
                        checked={selected.has(u.id)}
                        onChange={() => handleToggleSelect(u.id)}
                        className="w-4 h-4 rounded border-gray-300 flex-shrink-0"
                      />
                    )}

                    <div className="flex-1 min-w-0">
                      {/* Top row: IMEI and model */}
                      <div className="flex items-start gap-2 mb-1">
                        {hasIMEI ? (
                          <CopyImei imei={u.imei} truncate={12} />
                        ) : isSHS ? (
                          <span className="text-xs italic text-amber-600 font-mono">
                            IMEI will be updated while marking sold
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400 font-mono">No IMEI</span>
                        )}
                      </div>

                      {/* Model name */}
                      <p className="text-sm font-semibold text-gray-900 mb-1">{u.model}</p>

                      {/* Specs row */}
                      <div className="flex items-center gap-2 flex-wrap mb-2">
                        {u.colour && (
                          <span className="text-xs text-gray-600 font-mono">{u.colour}</span>
                        )}
                        {u.storage && (
                          <span className="text-xs text-gray-600 font-mono">{u.storage}</span>
                        )}
                        {u.grade && (
                          <span className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded font-mono font-bold">
                            {u.grade}
                          </span>
                        )}
                      </div>

                      {/* Batch and Supplier info */}
                      <div className="text-xs text-gray-500 font-mono space-y-0.5">
                        {u.batchId && (
                          <p>Batch: <span className="text-gray-700 font-bold">{u.batchId === 'master_batch' ? 'Master Batch' : u.batchId}</span></p>
                        )}
                        <p>Supplier: <span className="text-gray-700 font-bold">{supplierName}</span></p>
                      </div>
                    </div>

                    {/* Right side: Price and listing sites */}
                    <div className="flex items-center gap-4 flex-shrink-0 text-right">
                      <div>
                        <p className="text-sm font-bold text-gray-900">£{u.buyPrice}</p>
                        <p className="text-xs text-gray-500">Buy Price</p>
                      </div>
                      {u.listingSites && u.listingSites.length > 0 && (
                        <div className="flex gap-1 flex-col items-end">
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
                );
              })
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
