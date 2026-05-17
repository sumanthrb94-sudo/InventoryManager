/**
 * SkuListingEditor — SKU-level marketplace listing editor.
 *
 * The user's mental model: ONE listing per marketplace per SKU. If we have 50
 * iPhone 17 Pro Max 256GB Black units we post a single Amazon listing and let
 * the marketplace decrement the quantity as units sell.
 *
 * Persistence-wise we still write `listingSites` onto each available unit
 * (so derived SKU state — see `deriveSkuListing` — collapses back to the
 * same set) but the EDITOR works at the SKU level: pick the marketplaces,
 * we apply them to every available unit in the group in one bulk write.
 *
 * Style mirrors `SkuOverlayModal.tsx` — centered modal, monospace meta,
 * black/emerald palette, ESC + outside-click to close.
 */
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, Tag, X } from 'lucide-react';
import type { InventoryUnit, ListingSite } from '../types';
import { LISTING_SITES, listingSiteLabel } from '../lib/platforms';
// Service layer — wraps dbService.setSkuListingSites + audit-log emission so
// every listing change goes through the same code path.
import { setSkuListings } from '../services';

interface Props {
  /** Pretty label for the header — e.g. "Samsung A32 5G 64GB Black". */
  skuLabel: string;
  /** Every unit in this SKU group (all statuses). The editor itself only
   *  writes to the available subset; the rest are passed in so the count
   *  shown in the footer matches the parent's grouping. */
  units: InventoryUnit[];
  /** Current sites — typically the union returned by `deriveSkuListing`.
   *  Used to seed the checkbox grid. */
  current: ListingSite[];
  onClose: () => void;
  /** Fired after a successful save. Parent is expected to close the modal
   *  and refresh whatever derivation feeds the group row. */
  onSaved: () => void;
}

export default function SkuListingEditor({ skuLabel, units, current, onClose, onSaved }: Props) {
  const availableUnits = units.filter(u => u.status === 'available');
  const availableCount = availableUnits.length;

  const [selected, setSelected] = useState<ListingSite[]>(() => [...current]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedFlag, setSavedFlag] = useState(false);

  // Close on Escape — matches SkuOverlayModal UX
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toggle = (site: ListingSite) => {
    setSelected(prev =>
      prev.includes(site) ? prev.filter(s => s !== site) : [...prev, site],
    );
  };

  const handleSave = async () => {
    if (availableCount === 0) {
      setError('No available units in this SKU to update.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await setSkuListings({
        units: availableUnits,
        listingSites: selected,
        skuLabel,
      });
      if (!res.ok) {
        setError(res.message || 'Save failed — please try again.');
        setSaving(false);
        return;
      }

      setSavedFlag(true);
      // Brief confirmation flash, then hand control back to the parent which
      // closes the modal + refreshes its derivation.
      setTimeout(() => {
        setSavedFlag(false);
        onSaved();
      }, 600);
    } catch (err: any) {
      setError(err?.message || 'Save failed — please try again.');
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[300] bg-black/50 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.97, y: 12 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.97, y: 12 }}
          transition={{ duration: 0.15 }}
          onClick={e => e.stopPropagation()}
          className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[92vh] flex flex-col overflow-hidden"
          style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
        >
          {/* Header — emerald gradient + monospace eyebrow (matches SkuOverlayModal) */}
          <div className="flex-shrink-0 flex items-center justify-between px-5 py-3 border-b border-gray-200 bg-gradient-to-r from-emerald-50 to-white">
            <div className="min-w-0">
              <p className="text-[8px] font-mono uppercase tracking-[0.3em] text-emerald-700/80 flex items-center gap-1.5">
                <Tag size={9} /> Listings
              </p>
              <h2 className="text-base sm:text-lg font-bold tracking-tight truncate">
                {skuLabel}
              </h2>
              <p className="text-[10px] text-gray-500 font-mono mt-0.5">
                {availableCount} unit{availableCount === 1 ? '' : 's'} · ESC or click outside to close
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 text-gray-500 hover:text-black hover:bg-gray-100 rounded-lg transition-all"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>

          {/* Body — checkbox grid */}
          <div className="flex-1 overflow-y-auto p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-3">
              Marketplaces
            </p>
            <div className="grid grid-cols-2 gap-2">
              {LISTING_SITES.map(site => {
                const active = selected.includes(site);
                return (
                  <button
                    key={site}
                    type="button"
                    onClick={() => toggle(site)}
                    className={`px-3 py-2.5 rounded-xl border text-sm font-bold transition-all flex items-center justify-between gap-2 ${
                      active
                        ? 'bg-black text-white border-black'
                        : 'bg-gray-50 text-gray-700 border-gray-200 hover:border-gray-400'
                    }`}
                  >
                    <span className="truncate">{listingSiteLabel(site)}</span>
                    {active ? (
                      <CheckCircle2 size={14} className="flex-shrink-0 text-emerald-300" />
                    ) : (
                      <span className="w-3.5 h-3.5 rounded-full border border-gray-300 flex-shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>

            {error && (
              <div className="mt-4 flex items-center gap-2 text-[10px] text-rose-600 font-mono bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-rose-500" />
                {error}
              </div>
            )}
          </div>

          {/* Footer — apply-to-count + primary action */}
          <div className="flex-shrink-0 px-5 py-3 border-t border-gray-200 bg-gray-50">
            <div className="flex items-center justify-between gap-3 mb-3">
              <p className="text-[10px] font-mono uppercase tracking-widest text-gray-500">
                Apply to {availableCount} available unit{availableCount === 1 ? '' : 's'}
              </p>
              <p className="text-[10px] font-mono uppercase tracking-widest text-gray-400">
                {selected.length === 0 ? 'No marketplaces' : `${selected.length} selected`}
              </p>
            </div>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || savedFlag}
              className="w-full py-3 bg-black text-white rounded-xl text-[11px] font-bold uppercase tracking-widest hover:bg-emerald-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {savedFlag
                ? <><CheckCircle2 size={14} /> Saved</>
                : saving
                  ? 'Saving…'
                  : 'Save listing assignments'}
            </button>
            <p className="mt-3 text-[9px] text-gray-400 font-mono leading-relaxed">
              Marketplaces apply to the SKU. We list one per marketplace; quantity decrements automatically as units sell.
            </p>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
