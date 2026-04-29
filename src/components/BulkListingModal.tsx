import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { CheckCircle2, ChevronRight, Layers3, Package, X } from 'lucide-react';
import { dbService } from '../lib/dbService';
import { buildModelSummaries } from '../lib/modelSummaries';
import { InventoryUnit } from '../types';

const LISTING_SITES = ['eBay', 'Amazon', 'OnBuy', 'Backmarket', 'Other'] as const;

interface Props {
  onClose: () => void;
}

export default function BulkListingModal({ onClose }: Props) {
  const [units, setUnits] = useState<InventoryUnit[]>([]);
  const [selectedModelKey, setSelectedModelKey] = useState('');
  const [selectedImeis, setSelectedImeis] = useState<Set<string>>(new Set());
  const [selectedSites, setSelectedSites] = useState<string[]>(['eBay']);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const unsub = dbService.subscribeToCollection('inventoryUnits', setUnits);
    return unsub;
  }, []);

  const summaries = useMemo(
    () => buildModelSummaries(units).sort((a, b) => {
      if (b.totalAvailable !== a.totalAvailable) return b.totalAvailable - a.totalAvailable;
      return a.model.localeCompare(b.model);
    }),
    [units]
  );

  const selectedSummary = useMemo(
    () => summaries.find(summary => `${summary.brand}||${summary.model}` === selectedModelKey) || null,
    [summaries, selectedModelKey]
  );

  const modelUnits = useMemo(
    () => selectedSummary ? selectedSummary.variants.flatMap(v => v.units) : [],
    [selectedSummary]
  );

  useEffect(() => {
    if (!summaries.length) {
      setSelectedModelKey('');
      setSelectedImeis(new Set());
      return;
    }

    const nextKey = selectedModelKey && summaries.some(summary => `${summary.brand}||${summary.model}` === selectedModelKey)
      ? selectedModelKey
      : `${summaries[0].brand}||${summaries[0].model}`;

    setSelectedModelKey(nextKey);
  }, [summaries, selectedModelKey]);

  useEffect(() => {
    if (!modelUnits.length) {
      setSelectedImeis(new Set());
      return;
    }

    setSelectedImeis(new Set(modelUnits.filter(unit => unit.status !== 'sold').map(unit => unit.id)));
  }, [modelUnits, selectedModelKey]);

  const toggleImeis = (unitId: string) => {
    setSelectedImeis(prev => {
      const next = new Set(prev);
      if (next.has(unitId)) next.delete(unitId);
      else next.add(unitId);
      return next;
    });
  };

  const toggleSite = (site: string) => {
    setSelectedSites(prev => prev.includes(site) ? prev.filter(value => value !== site) : [...prev, site]);
  };

  const save = async () => {
    if (!selectedSummary || selectedImeis.size === 0 || selectedSites.length === 0) return;

    setSaving(true);
    const updates = modelUnits
      .filter(unit => selectedImeis.has(unit.id))
      .map(unit => ({
        collection: 'inventoryUnits',
        id: unit.id,
        data: {
          ...unit,
          listingSites: selectedSites,
          platformListed: true,
        },
      }));

    await dbService.bulkCreate(updates);
    setSaving(false);
    onClose();
  };

  const selectedUnits = modelUnits.filter(unit => selectedImeis.has(unit.id));

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-6 bg-black/45 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 60, opacity: 0 }}
        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        onClick={e => e.stopPropagation()}
        className="bg-white w-full md:max-w-2xl rounded-t-3xl md:rounded-2xl overflow-hidden shadow-2xl max-h-[92vh] flex flex-col"
      >
        <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Layers3 size={14} className="text-gray-500" />
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Bulk Listing</p>
            </div>
            <h2 className="text-lg font-bold tracking-tight">Select model, IMEIs and listing sites</h2>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-black transition-all">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {summaries.length === 0 ? (
            <div className="py-16 flex flex-col items-center gap-3 border-2 border-dashed border-gray-200 rounded-2xl">
              <Package size={40} className="text-gray-300" />
              <p className="text-gray-400 font-mono text-sm text-center px-4">No inventory found.</p>
            </div>
          ) : (
            <>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Model</label>
                <select
                  value={selectedModelKey}
                  onChange={e => setSelectedModelKey(e.target.value)}
                  className="w-full mt-1 bg-white border border-gray-200 rounded-xl px-3 py-3 text-sm font-mono focus:outline-none focus:border-black"
                >
                  {summaries.map(summary => {
                    const key = `${summary.brand}||${summary.model}`;
                    return (
                      <option key={key} value={key}>
                        {summary.model} · {summary.totalAvailable} available · {summary.variants.reduce((sum, variant) => sum + variant.units.length, 0)} total
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Listing Sites</label>
                  <span className="text-[9px] text-gray-400 font-mono">{selectedSites.length} selected</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {LISTING_SITES.map(site => {
                    const active = selectedSites.includes(site);
                    return (
                      <button
                        key={site}
                        onClick={() => toggleSite(site)}
                        className={`px-3 py-2.5 rounded-xl border text-sm font-bold transition-all ${
                          active ? 'bg-black text-white border-black' : 'bg-gray-50 text-gray-700 border-gray-200 hover:border-gray-400'
                        }`}
                      >
                        {site}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">IMEIs</label>
                  <span className="text-[9px] text-gray-400 font-mono">{selectedImeis.size} selected</span>
                </div>

                <div className="space-y-2">
                  {selectedSummary?.variants.map(variant => (
                    <div key={variant.colour} className="rounded-2xl border border-gray-100 overflow-hidden">
                      <div className="px-3 py-2 bg-gray-50 flex items-center justify-between">
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">{variant.colour}</p>
                          <p className="text-[9px] text-gray-400 font-mono">{variant.units.length} units</p>
                        </div>
                      </div>
                      <div className="divide-y divide-gray-50">
                        {variant.units.map(unit => {
                          const active = selectedImeis.has(unit.id);
                          const sold = unit.status === 'sold';
                          return (
                            <button
                              key={unit.id}
                              onClick={() => !sold && toggleImeis(unit.id)}
                              disabled={sold}
                              className={`w-full px-3 py-3 flex items-center justify-between gap-3 text-left transition-all ${
                                sold ? 'opacity-45 cursor-not-allowed bg-gray-50' : 'hover:bg-gray-50'
                              }`}
                            >
                              <div className="min-w-0">
                                <p className="text-sm font-bold font-mono tracking-wider truncate">{unit.imei}</p>
                                <p className="text-[9px] text-gray-400 font-mono uppercase tracking-widest">
                                  {unit.status} · £{unit.buyPrice}
                                </p>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                {active ? (
                                  <CheckCircle2 size={16} className="text-emerald-600" />
                                ) : (
                                  <div className="w-4 h-4 rounded-full border border-gray-300" />
                                )}
                                <ChevronRight size={14} className="text-gray-300" />
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="px-5 py-4 border-t border-gray-100 bg-white">
          <div className="flex items-center justify-between gap-3 mb-3">
            <p className="text-[10px] text-gray-500 font-mono uppercase tracking-widest">
              {selectedUnits.length} units ready
            </p>
            <p className="text-[10px] text-gray-500 font-mono uppercase tracking-widest">
              {selectedSites.join(' / ') || 'No site selected'}
            </p>
          </div>
          <button
            onClick={save}
            disabled={saving || selectedImeis.size === 0 || selectedSites.length === 0}
            className="w-full py-3.5 bg-black text-white rounded-xl text-sm font-bold uppercase tracking-widest hover:bg-gray-800 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving ? 'Saving...' : 'Save Listing Sites'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
