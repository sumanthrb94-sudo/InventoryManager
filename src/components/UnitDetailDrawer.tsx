import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X, Cpu, Package, Truck, ShoppingBag, Tag,
  Star, MapPin, CheckCircle2, AlertCircle,
  Edit3, Save, ShieldCheck, ExternalLink
} from 'lucide-react';
import { InventoryUnit, OperationalFlag } from '../types';
import { dbService } from '../lib/dbService';
import { validateIMEI, formatIMEI } from '../lib/imeiUtils';

const PLATFORMS = ['eBay', 'Amazon', 'OnBuy', 'Backmarket', 'Other'] as const;

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  available: { label: 'Available',  color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200' },
  sold:      { label: 'Sold',       color: 'text-gray-500',    bg: 'bg-gray-100 border-gray-200' },
  reserved:  { label: 'Reserved',   color: 'text-amber-700',   bg: 'bg-amber-50 border-amber-200' },
  returned:  { label: 'Returned',   color: 'text-orange-700',  bg: 'bg-orange-50 border-orange-200' },
  lost:      { label: 'Lost',       color: 'text-red-700',     bg: 'bg-red-50 border-red-200' },
};

interface Props {
  unit: InventoryUnit;
  supplierName: string;
  onClose: () => void;
}

export default function UnitDetailDrawer({ unit, supplierName, onClose }: Props) {
  const [tab, setTab]           = useState<'detail' | 'actions'>('detail');
  const [notes, setNotes]       = useState(unit.notes || '');
  const [salePrice, setSalePrice] = useState<string>(unit.salePrice?.toString() || '');
  const [platform, setPlatform] = useState(unit.salePlatform || 'eBay');
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState(false);

  const imeiDigits = unit.imei.replace(/\D/g, '');
  const imeiValid  = imeiDigits.length === 15 ? validateIMEI(unit.imei) : null;
  const statusCfg  = STATUS_CONFIG[unit.status] || STATUS_CONFIG.available;

  const timeline = [
    {
      icon: <Truck size={14} />,
      label: 'Received from Supplier',
      value: supplierName,
      date: unit.dateIn,
      done: true,
    },
    {
      icon: <Package size={14} />,
      label: 'In Office Stock',
      value: `Buy price: £${unit.buyPrice}`,
      date: unit.dateIn,
      done: true,
    },
    {
      icon: <ShoppingBag size={14} />,
      label: 'Listed on Platform',
      value: unit.platformListed ? (unit.salePlatform || 'Active listing') : 'Not yet listed',
      date: null,
      done: unit.platformListed,
    },
    {
      icon: <CheckCircle2 size={14} />,
      label: 'Sold',
      value: unit.salePrice ? `£${unit.salePrice} via ${unit.salePlatform}` : 'Pending',
      date: unit.saleDate || (unit.status === 'sold' ? unit.dateIn : null),
      done: unit.status === 'sold',
    },
  ];

  const toggleFlag = async (flag: OperationalFlag) => {
    const flags = unit.flags.includes(flag)
      ? unit.flags.filter(f => f !== flag)
      : [...unit.flags, flag];
    await dbService.update('inventoryUnits', unit.id, { flags });
  };

  const toggleListed = async () => {
    await dbService.update('inventoryUnits', unit.id, {
      platformListed: !unit.platformListed,
    });
  };

  const markSold = async () => {
    if (!salePrice) return;
    setSaving(true);
    await dbService.update('inventoryUnits', unit.id, {
      status: 'sold',
      salePrice: parseFloat(salePrice),
      salePlatform: platform,
      saleDate: new Date().toISOString().split('T')[0],
      platformListed: false,
    });
    setSaving(false);
    setSaved(true);
  };

  const saveNotes = async () => {
    setSaving(true);
    await dbService.update('inventoryUnits', unit.id, { notes });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-6 bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 60, opacity: 0 }}
        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        onClick={e => e.stopPropagation()}
        className="bg-white w-full md:max-w-lg rounded-t-3xl md:rounded-2xl overflow-hidden shadow-2xl max-h-[90vh] flex flex-col"
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-gray-100">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1.5">
                <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border font-mono uppercase ${statusCfg.bg} ${statusCfg.color}`}>
                  {statusCfg.label}
                </span>
                <span className="text-[9px] text-gray-400 font-mono uppercase tracking-widest">{unit.category}</span>
              </div>
              <h2 className="text-base font-bold tracking-tight leading-tight">{unit.model}</h2>
              <p className="text-xs text-gray-500 mt-0.5">{unit.colour} · {unit.brand}</p>
            </div>
            <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-black transition-all flex-shrink-0">
              <X size={18} />
            </button>
          </div>

          {/* IMEI chip — centrepiece */}
          <div className="mt-4 bg-gray-950 rounded-2xl px-5 py-4 flex items-center justify-between">
            <div>
              <p className="text-[9px] text-gray-500 font-mono uppercase tracking-widest mb-1">IMEI / Serial</p>
              <p className="text-white font-mono text-sm font-bold tracking-wider">
                {unit.imei ? formatIMEI(unit.imei) : '— Not recorded —'}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1">
              {unit.imei && imeiValid !== null ? (
                <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full font-mono flex items-center gap-1 ${
                  imeiValid ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                }`}>
                  {imeiValid ? <ShieldCheck size={10} /> : <AlertCircle size={10} />}
                  {imeiValid ? 'Valid' : 'Invalid'}
                </span>
              ) : unit.imei ? (
                <span className="text-[9px] font-bold px-2 py-0.5 rounded-full font-mono flex items-center gap-1 bg-gray-100 text-gray-500">
                  <ShieldCheck size={10} />
                  Serial
                </span>
              ) : null}
              <Cpu size={20} className="text-gray-600" />
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 px-6">
          {(['detail', 'actions'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`py-3 mr-6 text-[11px] font-bold uppercase tracking-widest border-b-2 transition-all ${
                tab === t ? 'border-black text-black' : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              {t === 'detail' ? 'Lifecycle' : 'Quick Actions'}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto">
          {tab === 'detail' && (
            <div className="p-6 space-y-6">
              {/* Timeline */}
              <div className="space-y-0">
                {timeline.map((step, i) => (
                  <div key={i} className="flex gap-4 relative">
                    {/* Connector line */}
                    {i < timeline.length - 1 && (
                      <div className={`absolute left-5 top-10 w-px h-8 ${step.done ? 'bg-black' : 'bg-gray-200'}`} />
                    )}
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                      step.done ? 'bg-black text-white' : 'bg-gray-100 text-gray-400'
                    }`}>
                      {step.icon}
                    </div>
                    <div className="flex-1 pb-8">
                      <p className={`text-xs font-bold ${step.done ? 'text-black' : 'text-gray-400'}`}>{step.label}</p>
                      <p className="text-[10px] text-gray-500 font-mono mt-0.5">{step.value}</p>
                      {step.date && (
                        <p className="text-[9px] text-gray-400 font-mono mt-0.5">
                          {new Date(step.date).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Key details grid */}
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Buy Price',    value: `£${unit.buyPrice}` },
                  { label: 'Supplier',     value: supplierName || '—' },
                  { label: 'Date In',      value: new Date(unit.dateIn).toLocaleDateString('en-GB') },
                  { label: 'Platform Qty', value: unit.platformListed ? 'Listed (1)' : 'Unlisted (0)' },
                  ...(unit.salePrice ? [{ label: 'Sale Price', value: `£${unit.salePrice}` }] : []),
                  ...(unit.salePlatform ? [{ label: 'Sold Via', value: unit.salePlatform }] : []),
                ].map(d => (
                  <div key={d.label} className="bg-gray-50 rounded-xl p-3">
                    <p className="text-[9px] text-gray-400 font-mono uppercase tracking-widest">{d.label}</p>
                    <p className="text-sm font-bold mt-0.5">{d.value}</p>
                  </div>
                ))}
              </div>

              {/* Flags */}
              {unit.flags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {unit.flags.map(f => (
                    <span key={f} className="text-[10px] font-mono bg-gray-100 px-3 py-1.5 rounded-full text-gray-700 flex items-center gap-1.5">
                      <Tag size={10} />
                      {f === 'top10' ? 'Top 10' : f === 'officeOnly' ? 'Office Only' : f === 'supplierHasStock' ? 'Supplier Stock' : 'Sold'}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'actions' && (
            <div className="p-6 space-y-5">
              {/* Platform listing toggle */}
              {unit.status !== 'sold' && (
                <div className="bg-gray-50 rounded-2xl p-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-3">Platform Listing</p>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-bold">{unit.platformListed ? 'Listed — Qty 1' : 'Not Listed — Qty 0'}</p>
                      <p className="text-[10px] text-gray-400 font-mono mt-0.5">eBay / Amazon / OnBuy / Backmarket</p>
                    </div>
                    <button
                      onClick={toggleListed}
                      className={`px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all ${
                        unit.platformListed
                          ? 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                          : 'bg-black text-white hover:bg-gray-800'
                      }`}
                    >
                      {unit.platformListed ? 'Set Qty 0' : 'Set Qty 1'}
                    </button>
                  </div>
                </div>
              )}

              {/* Mark as sold */}
              {unit.status !== 'sold' && (
                <div className="bg-gray-50 rounded-2xl p-4 space-y-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Mark as Sold</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[9px] text-gray-400 font-mono uppercase">Sale Price (£)</label>
                      <input
                        type="number"
                        value={salePrice}
                        onChange={e => setSalePrice(e.target.value)}
                        placeholder="0.00"
                        className="w-full mt-1 bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:border-black"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] text-gray-400 font-mono uppercase">Platform</label>
                      <select
                        value={platform}
                        onChange={e => setPlatform(e.target.value)}
                        className="w-full mt-1 bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:border-black"
                      >
                        {PLATFORMS.map(p => <option key={p}>{p}</option>)}
                      </select>
                    </div>
                  </div>
                  <button
                    onClick={markSold}
                    disabled={saving || !salePrice || saved}
                    className="w-full py-2.5 bg-black text-white rounded-xl text-[11px] font-bold uppercase tracking-widest hover:bg-gray-800 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {saved ? <><CheckCircle2 size={14} /> Marked Sold!</> : saving ? 'Saving...' : <><ShoppingBag size={14} /> Mark as Sold</>}
                  </button>
                </div>
              )}

              {/* Flags */}
              <div className="bg-gray-50 rounded-2xl p-4 space-y-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Operational Flags</p>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { flag: 'top10' as OperationalFlag,          icon: <Star size={12} />,         label: 'Top 10' },
                    { flag: 'officeOnly' as OperationalFlag,     icon: <MapPin size={12} />,       label: 'Office Only' },
                    { flag: 'supplierHasStock' as OperationalFlag, icon: <Truck size={12} />,      label: 'Supplier Stock' },
                  ]).map(({ flag, icon, label }) => {
                    const active = unit.flags.includes(flag);
                    return (
                      <button
                        key={flag}
                        onClick={() => toggleFlag(flag)}
                        className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-wider border transition-all ${
                          active ? 'bg-black text-white border-black' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                        }`}
                      >
                        {icon} {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Notes */}
              <div className="bg-gray-50 rounded-2xl p-4 space-y-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Notes</p>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Screen crack, box missing, refurb grade B..."
                  rows={3}
                  className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:border-black resize-none"
                />
                <button
                  onClick={saveNotes}
                  disabled={saving}
                  className="flex items-center gap-2 px-4 py-2 bg-black text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-gray-800 transition-all disabled:opacity-50"
                >
                  {saved ? <CheckCircle2 size={12} /> : <Save size={12} />}
                  {saved ? 'Saved!' : 'Save Notes'}
                </button>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
