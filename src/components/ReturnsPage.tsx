import React, { useState, useMemo } from 'react';
import {
  RefreshCw, Search, ArrowUpRight, Wrench, PackageCheck,
  ChevronDown, ChevronUp, X, CheckCircle2, AlertCircle, ShieldAlert, ShieldCheck, Truck
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { dbService } from '../lib/dbService';
import { InventoryUnit, ReturnCategory } from '../types';
import { useInventoryStore } from '../lib/inventoryStore';
import { notificationService } from '../lib/notificationService';
import CopyImei from './CopyImei';
import { getWarrantyStatus } from '../lib/warrantyUtils';
import { parseBrandModelStorage } from '../lib/modelStorage';

/** Mirror of the deriveSku helper in StockInPage — prefer pre-split fields,
 *  fall back to parsing the legacy single-string `model` at runtime so
 *  legacy docs collapse correctly without a re-import. */
function deriveSku(u: InventoryUnit): { brand: string; model: string; storage?: string } {
  if (u.brand && u.storage) {
    return { brand: u.brand, model: u.model, storage: u.storage };
  }
  const p = parseBrandModelStorage(u.model || '');
  return {
    brand: u.brand || p.brand,
    model: p.model || u.model,
    storage: u.storage || p.storage,
  };
}

type FilterTab = 'all' | ReturnCategory;

const RETURN_TYPES: { key: FilterTab; label: string; icon: React.ReactNode; color: string }[] = [
  { key: 'all',                   label: 'All Returns',       icon: <RefreshCw size={14} />,    color: 'bg-gray-100 text-gray-700 border-gray-200' },
  { key: 'returned_to_inventory', label: 'Back to Inventory', icon: <PackageCheck size={14} />, color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  { key: 'returned_to_supplier',  label: 'To Supplier',       icon: <ArrowUpRight size={14} />, color: 'bg-orange-100 text-orange-700 border-orange-200' },
  { key: 'repair',                label: 'Repair',            icon: <Wrench size={14} />,       color: 'bg-blue-100 text-blue-700 border-blue-200' },
];

const ICON_MAP: Record<FilterTab, React.ReactNode> = {
  all:                   <RefreshCw size={14} className="text-gray-500" />,
  returned_to_inventory: <PackageCheck size={14} className="text-emerald-600" />,
  returned_to_supplier:  <ArrowUpRight size={14} className="text-orange-600" />,
  repair:                <Wrench size={14} className="text-blue-600" />,
};

const BG_MAP: Record<FilterTab, string> = {
  all:                   'bg-gray-100',
  returned_to_inventory: 'bg-emerald-100',
  returned_to_supplier:  'bg-orange-100',
  repair:                'bg-blue-100',
};

// ── Quick Repair Modal (fast send to repair) ──────────────────────────────────
function QuickRepairModal({
  unit,
  onClose,
  onSaved,
}: {
  unit: InventoryUnit;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSendToRepair = async () => {
    setSaving(true);
    try {
      await dbService.update('inventoryUnits', unit.id, {
        status: 'returned',
        returnType: 'repair',
        returnDate: new Date().toISOString().split('T')[0],
        returnReason: 'Unit sent for repair',
        salePrice: null,
        saleDate: null,
        salePlatform: null,
        saleOrderId: null,
        postageCost: null,
        platformListed: false,
        listingSites: [],
      });

      notificationService.addNotification('return_processed', unit);
      onSaved();
      onClose();
    } catch {
      setError('Failed to save. Please try again.');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 md:p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-3xl overflow-hidden w-full max-w-sm shadow-2xl flex flex-col" style={{ maxHeight: 'calc(100dvh - 24px)' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <p className="text-[9px] font-mono uppercase tracking-widest text-gray-400">Send for Repair</p>
            <h3 className="text-sm font-bold truncate mt-0.5 max-w-[240px]">{unit.model}</h3>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-xl transition-all"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Info */}
          <div className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-xl p-4">
            <Wrench size={16} className="text-blue-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-bold text-blue-900 mb-1">Unit Sent for Repair</p>
              <p className="text-[9px] text-blue-800 font-mono leading-relaxed">
                Unit status will be set to <strong>Repair</strong>. Once repaired and tested, mark it as <strong>Ready to Ship</strong> to restore to inventory.
              </p>
            </div>
          </div>

          {/* Unit Details */}
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-[8px] font-mono uppercase tracking-widest text-gray-500">Model</p>
                <p className="text-xs font-bold mt-1 truncate">{unit.model}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-[8px] font-mono uppercase tracking-widest text-gray-500">Buy Price</p>
                <p className="text-xs font-bold mt-1">£{unit.buyPrice}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-[8px] font-mono uppercase tracking-widest text-gray-500">Sale Price</p>
                <p className="text-xs font-bold mt-1">£{unit.salePrice || '—'}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-[8px] font-mono uppercase tracking-widest text-gray-500">Platform</p>
                <p className="text-xs font-bold mt-1 truncate">{unit.salePlatform || '—'}</p>
              </div>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <AlertCircle size={14} />
              <p className="text-xs font-mono">{error}</p>
            </div>
          )}
        </div>

        <div className="flex-shrink-0 px-6 py-4 border-t border-gray-100 flex gap-3 bg-white">
          <button onClick={onClose}
            className="flex-1 py-3 border border-gray-200 rounded-xl text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:bg-gray-50 transition-all">
            Cancel
          </button>
          <button onClick={handleSendToRepair} disabled={saving}
            className="flex-1 py-3 bg-blue-600 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-blue-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
            {saving ? 'Saving…' : <><Wrench size={13} /> Send to Repair</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Ready to Ship Modal (for repair units) ──────────────────────────────────
function ReadyToShipModal({
  unit,
  onClose,
  onSaved,
}: {
  unit: InventoryUnit;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleMoveToInventory = async () => {
    setSaving(true);
    try {
      await dbService.update('inventoryUnits', unit.id, {
        status: 'available',
        returnType: 'returned_to_inventory',
        repairedAt: new Date().toISOString().split('T')[0],
        flags: [...(unit.flags || []), 'repaired_unit'],
      });

      notificationService.addNotification('unit_repaired', unit);
      onSaved();
      onClose();
    } catch {
      setError('Failed to save. Please try again.');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 md:p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-3xl overflow-hidden w-full max-w-sm shadow-2xl flex flex-col" style={{ maxHeight: 'calc(100dvh - 24px)' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <p className="text-[9px] font-mono uppercase tracking-widest text-gray-400">Mark as Ready</p>
            <h3 className="text-sm font-bold truncate mt-0.5 max-w-[240px]">{unit.model}</h3>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-xl transition-all"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Disclaimer */}
          <div className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-xl p-4">
            <AlertCircle size={16} className="text-blue-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-bold text-blue-900 mb-1">Returned Category Disclaimer</p>
              <p className="text-[9px] text-blue-800 font-mono leading-relaxed">
                This unit is under the <strong>Returned Category</strong>. It has been tested and repaired. Mark as ready to restore to available inventory for resale.
              </p>
            </div>
          </div>

          {/* Unit Details */}
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-[8px] font-mono uppercase tracking-widest text-gray-500">Model</p>
                <p className="text-xs font-bold mt-1">{unit.model}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-[8px] font-mono uppercase tracking-widest text-gray-500">Buy Price</p>
                <p className="text-xs font-bold mt-1">£{unit.buyPrice}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-[8px] font-mono uppercase tracking-widest text-gray-500">Colour</p>
                <p className="text-xs font-bold mt-1">{unit.colour || '—'}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-[8px] font-mono uppercase tracking-widest text-gray-500">Status</p>
                <p className="text-xs font-bold mt-1 text-blue-600">Under Repair</p>
              </div>
            </div>
          </div>

          {/* Return Reason */}
          {unit.returnReason && (
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-[8px] font-mono uppercase tracking-widest text-gray-500">Return Reason</p>
              <p className="text-xs text-gray-700 mt-1">{unit.returnReason}</p>
            </div>
          )}

          {/* Confirmation */}
          <div className="flex items-start gap-2 bg-emerald-50 border border-emerald-200 rounded-xl p-3">
            <CheckCircle2 size={13} className="text-emerald-600 flex-shrink-0 mt-0.5" />
            <p className="text-[9px] text-emerald-700 font-mono leading-relaxed">
              After clicking below, this unit will be restored to <strong>available</strong> inventory and ready for resale.
            </p>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <AlertCircle size={14} />
              <p className="text-xs font-mono">{error}</p>
            </div>
          )}
        </div>

        <div className="flex-shrink-0 px-6 py-4 border-t border-gray-100 flex gap-3 bg-white">
          <button onClick={onClose}
            className="flex-1 py-3 border border-gray-200 rounded-xl text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:bg-gray-50 transition-all">
            Cancel
          </button>
          <button onClick={handleMoveToInventory} disabled={saving}
            className="flex-1 py-3 bg-blue-600 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-blue-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
            {saving ? 'Saving…' : <><Truck size={13} /> Ready to Ship</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Process Return Modal ─────────────────────────────────────────────────────
function ProcessReturnModal({
  unit,
  onClose,
  onSaved,
}: {
  unit: InventoryUnit;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [returnType, setReturnType] = useState<ReturnCategory>('returned_to_inventory');
  const [reason, setReason] = useState('');
  const [returnDate, setReturnDate] = useState(new Date().toISOString().split('T')[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const warranty = useMemo(() => getWarrantyStatus(unit.saleDate), [unit.saleDate]);

  const handleSave = async () => {
    if (!reason.trim()) { setError('Please enter a return reason.'); return; }
    setSaving(true);
    try {
      if (returnType === 'returned_to_supplier') {
        // Unit goes back to supplier — remove from inventory entirely
        await dbService.delete('inventoryUnits', unit.id);
      } else {
        const newStatus = returnType === 'returned_to_inventory' ? 'available' : 'returned';
        await dbService.update('inventoryUnits', unit.id, {
          status: newStatus,
          returnType,
          returnDate,
          returnReason: reason.trim(),
          // Always clear sale data on any return — prevents ghost sale records
          salePrice: null,
          saleDate: null,
          salePlatform: null,
          saleOrderId: null,
          postageCost: null,
          ...(returnType === 'returned_to_inventory' ? {
            platformListed: false,
            listingSites: [],
          } : {}),
        });
      }

      // Trigger return_processed notification
      notificationService.addNotification('return_processed', unit);

      onSaved();
      onClose();
    } catch {
      setError('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const OPTION_LABELS: Record<ReturnCategory, { label: string; desc: string; color: string }> = {
    returned_to_inventory: { label: 'Back to Inventory', desc: 'Unit is resaleable — restore to available stock', color: 'border-emerald-300 bg-emerald-50 text-emerald-800' },
    returned_to_supplier:  { label: 'Return to Supplier', desc: 'Send back to supplier — unit will be removed from stock', color: 'border-orange-300 bg-orange-50 text-orange-800' },
    repair:                { label: 'Send for Repair', desc: 'Unit needs repair before resale', color: 'border-blue-300 bg-blue-50 text-blue-800' },
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 md:p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-3xl overflow-hidden w-full max-w-sm shadow-2xl flex flex-col" style={{ maxHeight: 'calc(100dvh - 24px)' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <p className="text-[9px] font-mono uppercase tracking-widest text-gray-400">Process Return</p>
            <h3 className="text-sm font-bold truncate mt-0.5 max-w-[240px]">{unit.model}</h3>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-xl transition-all"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {/* Warranty Alert - Compact */}
          {unit.saleDate && (
            <div className={`flex items-center gap-2 p-2 rounded-lg border text-[9px] ${warranty.isExpired ? 'bg-red-50 border-red-200 text-red-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700'}`}>
              {warranty.isExpired ? <ShieldAlert size={14} className="flex-shrink-0" /> : <ShieldCheck size={14} className="flex-shrink-0" />}
              <span className="font-bold">{warranty.isExpired ? 'Warranty Expired' : 'Warranty Active'} • {warranty.isExpired ? `${Math.abs(warranty.daysLeft)}d ago` : `${warranty.daysLeft}d left`}</span>
            </div>
          )}

          {/* Return Type */}
          <div>
            <label className="text-[9px] font-bold uppercase tracking-widest text-gray-400 block mb-2">Return Destination *</label>
            <div className="space-y-2">
              {(Object.keys(OPTION_LABELS) as ReturnCategory[]).map(key => (
                <button key={key} onClick={() => setReturnType(key)}
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border-2 transition-all text-left ${
                    returnType === key ? OPTION_LABELS[key].color + ' border-current' : 'border-gray-200 hover:border-gray-300'
                  }`}>
                  <div>
                    <p className="text-xs font-bold">{OPTION_LABELS[key].label}</p>
                    <p className="text-[9px] font-mono text-gray-500 mt-0.5">{OPTION_LABELS[key].desc}</p>
                  </div>
                  {returnType === key && <CheckCircle2 size={16} />}
                </button>
              ))}
            </div>
          </div>

          {/* Return Date */}
          <div>
            <label className="text-[9px] font-bold uppercase tracking-widest text-gray-400 block mb-1.5">Return Date</label>
            <input type="date" value={returnDate} onChange={e => setReturnDate(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:border-black transition-all" />
          </div>

          {/* Reason */}
          <div>
            <label className="text-[9px] font-bold uppercase tracking-widest text-gray-400 block mb-1.5">Return Reason *</label>
            <input value={reason} onChange={e => { setReason(e.target.value); setError(''); }}
              placeholder="e.g. Customer changed mind, Faulty screen, Wrong item sent"
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-black transition-all" />
          </div>

          {returnType === 'returned_to_inventory' && (
            <div className="flex items-start gap-2 bg-emerald-50 border border-emerald-200 rounded-xl p-3">
              <PackageCheck size={13} className="text-emerald-600 flex-shrink-0 mt-0.5" />
              <p className="text-[9px] text-emerald-700 font-mono leading-relaxed">
                Unit will be restored to <strong>available</strong> stock and sale data cleared. Inspect condition before relisting.
              </p>
            </div>
          )}
          {returnType === 'returned_to_supplier' && (
            <div className="flex items-start gap-2 bg-orange-50 border border-orange-200 rounded-xl p-3">
              <ArrowUpRight size={13} className="text-orange-600 flex-shrink-0 mt-0.5" />
              <p className="text-[9px] text-orange-700 font-mono leading-relaxed">
                Unit will be <strong>permanently deleted</strong> from inventory. This cannot be undone — the unit is gone from your stock.
              </p>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <AlertCircle size={14} />
              <p className="text-xs font-mono">{error}</p>
            </div>
          )}
        </div>

        <div className="flex-shrink-0 px-6 py-4 border-t border-gray-100 flex gap-3 bg-white">
          <button onClick={onClose}
            className="flex-1 py-3 border border-gray-200 rounded-xl text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:bg-gray-50 transition-all">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 py-3 bg-black text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-gray-800 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
            {saving ? 'Saving…' : <><CheckCircle2 size={13} /> Confirm Return</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main ReturnsPage ─────────────────────────────────────────────────────────
export default function ReturnsPage() {
  const { units }                   = useInventoryStore();
  const [search, setSearch]         = useState('');
  const [filter, setFilter]         = useState<FilterTab>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [processing, setProcessing] = useState<InventoryUnit | null>(null);
  const [readyToShip, setReadyToShip] = useState<InventoryUnit | null>(null);
  const [quickRepairUnit, setQuickRepairUnit] = useState<InventoryUnit | null>(null);
  const [showPickerModal, setShowPickerModal] = useState(false);
  const [showQuickRepairPickerModal, setShowQuickRepairPickerModal] = useState(false);
  const [savedFlag, setSavedFlag]   = useState(false);

  // Returned = status 'returned' OR units that came back to available via returnType
  const returned = useMemo(() =>
    units.filter(u => u.status === 'returned' || (u.returnType && u.status === 'available')),
    [units]);

  // Sold units eligible to be returned (have a sale record)
  const sold = useMemo(() => units.filter(u => u.status === 'sold'), [units]);

  const getCategory = (u: InventoryUnit): ReturnCategory =>
    u.returnType || 'returned_to_inventory';

  const withCategory = useMemo(() =>
    returned.map(u => ({ ...u, returnCategory: getCategory(u) })),
    [returned]);

  const filtered = useMemo(() => {
    let list = filter === 'all' ? withCategory : withCategory.filter(u => u.returnCategory === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(u =>
        u.model.toLowerCase().includes(q) ||
        (u.imei || '').includes(q) ||
        (u.returnReason || u.notes || '').toLowerCase().includes(q)
      );
    }
    return list.sort((a, b) => {
      const da = a.returnDate || a.dateIn;
      const db = b.returnDate || b.dateIn;
      return new Date(db).getTime() - new Date(da).getTime();
    });
  }, [withCategory, filter, search]);

  // Group by (brand, model, storage, colour, returnType) so 5× "S21 GREY 128GB
  // returned_to_inventory" collapses into one expandable row. `returnType` is
  // PART of the key by design — returned-to-inventory and returned-to-supplier
  // for the same SKU are operationally different and must stay separate.
  const groupedReturns = useMemo(() => {
    const map = new Map<string, {
      key: string;
      sku: { brand: string; model: string; storage?: string };
      colour: string;
      returnType: ReturnCategory;
      units: (InventoryUnit & { returnCategory: ReturnCategory })[];
    }>();
    for (const u of filtered) {
      const sku = deriveSku(u);
      const colour = u.colour && u.colour !== 'Unknown' ? u.colour : '';
      const returnType = u.returnCategory;
      const key = `${sku.brand}|${sku.model}|${sku.storage || ''}|${colour}|${returnType}`;
      const g = map.get(key);
      if (g) g.units.push(u);
      else map.set(key, { key, sku, colour, returnType, units: [u] });
    }
    return Array.from(map.values()).sort((a, b) => {
      // Sort by latest activity in the group, newest first.
      const aDate = a.units.reduce((acc, u) => {
        const d = u.returnDate || u.dateIn;
        return d > acc ? d : acc;
      }, '');
      const bDate = b.units.reduce((acc, u) => {
        const d = u.returnDate || u.dateIn;
        return d > acc ? d : acc;
      }, '');
      return bDate.localeCompare(aDate);
    });
  }, [filtered]);

  const counts = useMemo(() => ({
    all:                   returned.length,
    returned_to_inventory: withCategory.filter(u => u.returnCategory === 'returned_to_inventory').length,
    returned_to_supplier:  withCategory.filter(u => u.returnCategory === 'returned_to_supplier').length,
    repair:                withCategory.filter(u => u.returnCategory === 'repair').length,
  }), [withCategory, returned]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold tracking-tighter uppercase font-display flex items-center gap-3">
          <span className="w-8 h-8 bg-orange-100 rounded-lg flex items-center justify-center">
            <RefreshCw size={16} className="text-orange-600" />
          </span>
          Returns
        </h2>
        <p className="text-[10px] text-gray-400 font-mono uppercase tracking-widest mt-1">
          Back to Inventory · Return to Supplier · Repair
        </p>
      </div>

      {savedFlag && (
        <div className="flex items-center gap-3 bg-emerald-600 text-white px-4 py-3 rounded-xl">
          <CheckCircle2 size={16} />
          <p className="text-sm font-bold">Return processed successfully.</p>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div className="bg-gray-50 border border-gray-200 rounded-3xl p-4">
          <p className="text-[9px] font-mono uppercase tracking-widest text-gray-500">Total Returns</p>
          <p className="text-3xl font-bold font-display mt-1">{returned.length}</p>
          <p className="text-[9px] text-gray-400 font-mono">all time</p>
        </div>
        <div className="bg-emerald-50 border border-emerald-100 rounded-3xl p-4">
          <p className="text-[9px] font-mono uppercase tracking-widest text-emerald-600">To Inventory</p>
          <p className="text-3xl font-bold font-display mt-1 text-emerald-700">{counts.returned_to_inventory}</p>
          <p className="text-[9px] text-emerald-400 font-mono">units</p>
        </div>
        <div className="bg-blue-50 border border-blue-100 rounded-3xl p-4">
          <p className="text-[9px] font-mono uppercase tracking-widest text-blue-600">Repair</p>
          <p className="text-3xl font-bold font-display mt-1 text-blue-700">{counts.repair}</p>
          <p className="text-[9px] text-blue-400 font-mono">units</p>
        </div>
        <div className="bg-orange-50 border border-orange-100 rounded-3xl p-4">
          <p className="text-[9px] font-mono uppercase tracking-widest text-orange-600">To Supplier</p>
          <p className="text-3xl font-bold font-display mt-1 text-orange-700">{counts.returned_to_supplier}</p>
          <p className="text-[9px] text-orange-400 font-mono">units</p>
        </div>
      </div>

      {/* Return Buttons */}
      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => setShowQuickRepairPickerModal(true)}
          disabled={withCategory.filter(u => u.returnCategory === 'repair').length === 0}
          className="py-3 bg-blue-600 text-white rounded-3xl font-bold uppercase tracking-widest text-sm hover:bg-blue-700 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
          <Truck size={16} />
          Mark Repaired
        </button>
        <button onClick={() => setShowPickerModal(true)}
          disabled={sold.length === 0}
          className="py-3 bg-black text-white rounded-3xl font-bold uppercase tracking-widest text-sm hover:bg-gray-800 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
          <RefreshCw size={16} />
          Create Return
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {RETURN_TYPES.map(rt => (
          <button key={rt.key} onClick={() => setFilter(rt.key)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-[10px] font-bold uppercase tracking-widest transition-all ${
              filter === rt.key ? 'bg-black text-white border-black' : `${rt.color} hover:opacity-80`
            }`}>
            {rt.icon}
            {rt.label}
            <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[8px] ${filter === rt.key ? 'bg-white/20 text-white' : 'bg-black/10'}`}>
              {counts[rt.key]}
            </span>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by model, IMEI or return reason…"
          className="w-full pl-10 pr-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-black transition-all" />
      </div>

      {/* List */}
      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
            {filter === 'all' ? 'All Returns' : RETURN_TYPES.find(r => r.key === filter)?.label}
          </p>
          <span className="text-[9px] font-mono text-gray-400">{filtered.length} records</span>
        </div>
        {filtered.length === 0 ? (
          <div className="py-12 flex flex-col items-center gap-2 text-gray-300">
            <RefreshCw size={32} />
            <p className="text-xs font-mono">No returns in this category</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {/* SKU-grouped rows — one row per (brand, model, storage, colour,
                returnType) bucket. returnType is part of the key so
                returned_to_inventory and returned_to_supplier for the same
                SKU stay in separate rows. Expand to see per-IMEI children
                where the per-unit Update/inspect workflow stays available. */}
            {groupedReturns.map(group => {
              const isOpen = expandedId === group.key;
              const cat = group.returnType as FilterTab;
              const qty = group.units.length;
              const totalBP = group.units.reduce((s, u) => s + (u.buyPrice || 0), 0);
              const latestDate = group.units.reduce((acc, u) => {
                const d = u.returnDate || u.dateIn;
                return d > acc ? d : acc;
              }, '');
              const titleParts = [
                group.sku.brand,
                group.sku.model,
                group.sku.storage,
                group.colour || null,
              ].filter(Boolean);
              return (
                <div key={group.key}>
                  <button
                    type="button"
                    onClick={() => setExpandedId(isOpen ? null : group.key)}
                    className="w-full text-left flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-all"
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${BG_MAP[cat]}`}>
                      {ICON_MAP[cat]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-xs font-bold truncate">{titleParts.join(' · ')}</p>
                        {qty > 1 && (
                          <span className="text-[9px] font-bold text-gray-700 bg-gray-100 px-1.5 py-0.5 rounded font-mono flex-shrink-0">
                            ×{qty}
                          </span>
                        )}
                        <span className="text-[8px] font-bold uppercase tracking-widest text-gray-500 font-mono flex-shrink-0">
                          {(group.returnType || '').replace(/_/g, ' ')}
                        </span>
                      </div>
                      <p className="text-[9px] text-gray-400 font-mono mt-0.5">
                        {qty} unit{qty === 1 ? '' : 's'} · latest {latestDate || '—'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-sm font-bold">£{totalBP.toLocaleString()}</span>
                      <span className="p-1.5 text-gray-400">
                        {isOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                      </span>
                    </div>
                  </button>
                  <AnimatePresence>
                    {isOpen && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden bg-gray-50 border-t border-gray-100">
                        <div className="divide-y divide-gray-100">
                          {group.units.map(u => (
                            <div key={u.id} className="px-5 py-3">
                              <div className="flex items-center gap-2 mb-2">
                                <CopyImei imei={u.imei} truncate={12} />
                                <span className="text-[9px] text-gray-400 font-mono">{u.returnDate || u.dateIn}</span>
                                <span className="text-[9px] text-gray-500 font-mono ml-auto">£{u.buyPrice}</span>
                              </div>
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                {[
                                  { label: 'Sale Price',   value: u.salePrice ? `£${u.salePrice}` : '—' },
                                  { label: 'Platform',     value: u.salePlatform || '—' },
                                  { label: 'Batch',        value: u.batchId === 'master_batch' ? 'Master' : (u.batchId || 'Default') },
                                  { label: 'Status',       value: u.status },
                                ].map(f => (
                                  <div key={f.label}>
                                    <p className="text-[8px] text-gray-400 font-mono uppercase tracking-widest">{f.label}</p>
                                    <p className="text-[10px] font-bold mt-0.5 capitalize">{f.value}</p>
                                  </div>
                                ))}
                              </div>
                              {(u.returnReason || u.notes) && (
                                <div className="mt-2">
                                  <p className="text-[8px] text-gray-400 font-mono uppercase tracking-widest">Return Reason</p>
                                  <p className="text-[10px] mt-0.5 text-gray-700">{u.returnReason || u.notes}</p>
                                </div>
                              )}
                            </div>
                          ))}
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

      {showQuickRepairPickerModal && withCategory.filter(u => u.returnCategory === 'repair').length > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[65] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          onClick={() => setShowQuickRepairPickerModal(false)}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className="bg-white rounded-3xl overflow-hidden w-full max-w-md shadow-2xl flex flex-col"
            style={{ maxHeight: '80vh' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
              <div>
                <p className="text-[9px] font-mono uppercase tracking-widest text-gray-400">Mark Repaired</p>
                <h3 className="text-sm font-bold truncate mt-0.5">Select Unit to Restore</h3>
              </div>
              <button onClick={() => setShowQuickRepairPickerModal(false)} className="p-2 hover:bg-gray-100 rounded-xl transition-all">
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <RepairUnitPicker units={withCategory.filter(u => u.returnCategory === 'repair')} onSelect={u => {
                setQuickRepairUnit(u);
                setShowQuickRepairPickerModal(false);
              }} />
            </div>
          </motion.div>
        </motion.div>
      )}

      {showPickerModal && sold.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[65] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          onClick={() => setShowPickerModal(false)}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className="bg-white rounded-3xl overflow-hidden w-full max-w-md shadow-2xl flex flex-col"
            style={{ maxHeight: '80vh' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
              <div>
                <p className="text-[9px] font-mono uppercase tracking-widest text-gray-400">Select Unit</p>
                <h3 className="text-sm font-bold truncate mt-0.5">Find Unit to Return</h3>
              </div>
              <button onClick={() => setShowPickerModal(false)} className="p-2 hover:bg-gray-100 rounded-xl transition-all">
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <SoldUnitPicker units={sold} onSelect={u => {
                setProcessing(u);
                setShowPickerModal(false);
              }} />
            </div>
          </motion.div>
        </motion.div>
      )}

      <AnimatePresence>
        {processing && (
          <ProcessReturnModal
            unit={processing}
            onClose={() => setProcessing(null)}
            onSaved={() => {
              setProcessing(null);
              setSavedFlag(true);
              setTimeout(() => setSavedFlag(false), 3000);
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {readyToShip && (
          <ReadyToShipModal
            unit={readyToShip}
            onClose={() => setReadyToShip(null)}
            onSaved={() => {
              setReadyToShip(null);
              setSavedFlag(true);
              setTimeout(() => setSavedFlag(false), 3000);
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {quickRepairUnit && (
          <QuickRepairModal
            unit={quickRepairUnit}
            onClose={() => setQuickRepairUnit(null)}
            onSaved={() => {
              setQuickRepairUnit(null);
              setSavedFlag(true);
              setTimeout(() => setSavedFlag(false), 3000);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Sold unit picker (search + select to process return) ─────────────────────
function SoldUnitPicker({ units, onSelect }: { units: InventoryUnit[]; onSelect: (u: InventoryUnit) => void }) {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const ITEMS_PER_PAGE = 8;

  const { sorted, filtered } = useMemo(() => {
    let sorted = [...units].sort((a, b) => {
      const da = a.saleDate || a.dateIn;
      const db = b.saleDate || b.dateIn;
      return new Date(db).getTime() - new Date(da).getTime();
    });

    let result = sorted;
    if (q.trim()) {
      const s = q.toLowerCase();
      result = sorted.filter(u =>
        u.model.toLowerCase().includes(s) ||
        (u.imei || '').includes(s) ||
        (u.saleOrderId || '').toLowerCase().includes(s)
      );
    }

    return { sorted, filtered: result };
  }, [units, q]);

  const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
  const validPage = Math.min(page, Math.max(1, totalPages));
  const start = (validPage - 1) * ITEMS_PER_PAGE;
  const paginatedItems = filtered.slice(start, start + ITEMS_PER_PAGE);

  const handlePrevPage = () => setPage(p => Math.max(1, p - 1));
  const handleNextPage = () => setPage(p => Math.min(totalPages, p + 1));

  const handleSearch = (value: string) => {
    setQ(value);
    setPage(1);
  };

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={q} onChange={e => handleSearch(e.target.value)}
          placeholder="Search sold units by model, IMEI or order number…"
          className="w-full pl-9 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-black transition-all" />
      </div>
      {filtered.length > 0 && (
        <>
          <div className="border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-50">
            {paginatedItems.map(u => {
              const isSHS = u.batchId?.startsWith('shs_') || u.notes?.includes('SHS');
              return (
              <button key={u.id} onClick={() => { onSelect(u); setQ(''); setPage(1); }}
                className={`w-full flex items-center justify-between px-4 py-3 transition-all text-left ${isSHS ? 'bg-orange-50/60 hover:bg-orange-50' : 'hover:bg-gray-50'}`}>
                <div className="min-w-0">
                  <p className="text-xs font-bold truncate">{u.model}</p>
                  <p className="text-[9px] text-gray-400 font-mono mt-0.5">
                    {(u.imei || '').slice(0, 10)}{u.imei && u.imei.length > 10 ? '…' : ''} · {u.salePlatform || '—'} · Order: {u.saleOrderId || '—'}
                  </p>
                </div>
                <span className="text-xs font-bold text-orange-600 ml-3 flex-shrink-0">Return →</span>
              </button>
            );
            })}
          </div>

          {/* Pagination controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl">
              <button
                onClick={handlePrevPage}
                disabled={validPage === 1}
                className="p-1.5 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-all text-gray-400"
                title="Previous page"
              >
                <ChevronDown size={14} className="rotate-90" />
              </button>
              <span className="text-[9px] font-mono text-gray-500">
                Page {validPage} of {totalPages}
              </span>
              <button
                onClick={handleNextPage}
                disabled={validPage === totalPages}
                className="p-1.5 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-all text-gray-400"
                title="Next page"
              >
                <ChevronUp size={14} className="rotate-90" />
              </button>
            </div>
          )}
        </>
      )}
      {q.trim() && filtered.length === 0 && (
        <p className="text-[10px] text-gray-400 font-mono text-center py-2">No sold units match "{q}"</p>
      )}
    </div>
  );
}

// ── Repair unit picker (for selecting repair units to mark as ready) ─────────
function RepairUnitPicker({ units, onSelect }: { units: InventoryUnit[]; onSelect: (u: InventoryUnit) => void }) {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const ITEMS_PER_PAGE = 8;

  const { sorted, filtered } = useMemo(() => {
    let sorted = [...units].sort((a, b) => {
      const da = a.returnDate || a.dateIn;
      const db = b.returnDate || b.dateIn;
      return new Date(db).getTime() - new Date(da).getTime();
    });

    let result = sorted;
    if (q.trim()) {
      const s = q.toLowerCase();
      result = sorted.filter(u =>
        u.model.toLowerCase().includes(s) ||
        (u.imei || '').includes(s) ||
        (u.returnReason || '').toLowerCase().includes(s)
      );
    }

    return { sorted, filtered: result };
  }, [units, q]);

  const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
  const validPage = Math.min(page, Math.max(1, totalPages));
  const start = (validPage - 1) * ITEMS_PER_PAGE;
  const paginatedItems = filtered.slice(start, start + ITEMS_PER_PAGE);

  const handlePrevPage = () => setPage(p => Math.max(1, p - 1));
  const handleNextPage = () => setPage(p => Math.min(totalPages, p + 1));

  const handleSearch = (value: string) => {
    setQ(value);
    setPage(1);
  };

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={q} onChange={e => handleSearch(e.target.value)}
          placeholder="Search repair units by model, IMEI or reason…"
          className="w-full pl-9 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-black transition-all" />
      </div>
      {filtered.length > 0 && (
        <>
          <div className="border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-50">
            {paginatedItems.map(u => (
              <button key={u.id} onClick={() => { onSelect(u); setQ(''); setPage(1); }}
                className="w-full flex items-center justify-between px-4 py-3 transition-all text-left bg-blue-50/40 hover:bg-blue-50">
                <div className="min-w-0">
                  <p className="text-xs font-bold truncate">{u.model}</p>
                  <p className="text-[9px] text-gray-400 font-mono mt-0.5">
                    {(u.imei || '').slice(0, 10)}{u.imei && u.imei.length > 10 ? '…' : ''} · {u.returnDate || u.dateIn}
                  </p>
                  {u.returnReason && (
                    <p className="text-[8px] text-gray-500 mt-0.5">{u.returnReason}</p>
                  )}
                </div>
                <span className="text-xs font-bold text-blue-600 ml-3 flex-shrink-0">Mark →</span>
              </button>
            ))}
          </div>

          {/* Pagination controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl">
              <button
                onClick={handlePrevPage}
                disabled={validPage === 1}
                className="p-1.5 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-all text-gray-400"
                title="Previous page"
              >
                <ChevronDown size={14} className="rotate-90" />
              </button>
              <span className="text-[9px] font-mono text-gray-500">
                Page {validPage} of {totalPages}
              </span>
              <button
                onClick={handleNextPage}
                disabled={validPage === totalPages}
                className="p-1.5 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-all text-gray-400"
                title="Next page"
              >
                <ChevronUp size={14} className="rotate-90" />
              </button>
            </div>
          )}
        </>
      )}
      {q.trim() && filtered.length === 0 && (
        <p className="text-[10px] text-gray-400 font-mono text-center py-2">No repair units match "{q}"</p>
      )}
    </div>
  );
}
