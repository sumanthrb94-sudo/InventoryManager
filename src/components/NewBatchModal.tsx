import React, { useState, useEffect, useRef } from 'react';
import { X, Plus, Trash2, Truck, Calendar, CheckCircle2, Camera, ChevronDown, ChevronUp, AlertCircle, FileText } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { dbService } from '../lib/dbService';
import { Supplier, DeviceCategory, ConditionGrade, StockLocation } from '../types';
import { logInventoryEvent } from '../lib/inventoryEvents';

interface Props { onClose: () => void; }

// ── Invoice line (from supplier bill) ─────────────────────────────────────
interface InvoiceLine {
  id: string;
  description: string;   // raw e.g. "Apple iPhone 14 128 gb"
  qty: number;
  unitPrice: number;
}

// ── One physical unit (IMEI entry per phone) ───────────────────────────────
interface UnitRow {
  lineId: string;
  model: string;
  buyPrice: number;
  imei: string;
  colour: string;
  conditionGrade: ConditionGrade;
  notes: string;
  expanded: boolean;
}

const COLOURS = ['Black','White','Silver','Gold','Natural Titanium','Blue Titanium','White Titanium',
  'Black Titanium','Desert Titanium','Phantom Black','Cream','Lavender','Midnight','Starlight',
  'Green','Yellow','Purple','Pink','Blue','Red','Space Grey','Other'];

const uid = () => Math.random().toString(36).slice(2);
const today = () => new Date().toISOString().split('T')[0];

// ── Camera IMEI mini-scanner modal ─────────────────────────────────────────
function CameraScanModal({ onScan, onClose }: { onScan:(v:string)=>void; onClose:()=>void }) {
  const [Scanner, setScanner] = useState<any>(null);
  useEffect(() => {
    import('./IMEIScanner').then(m => setScanner(() => m.default));
  }, []);
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <p className="text-sm font-bold">Scan IMEI</p>
          <button onClick={onClose}><X size={16}/></button>
        </div>
        <div className="p-3">
          {Scanner ? <Scanner onScan={(v:string)=>{ onScan(v.replace(/\D/g,'')); onClose(); }} /> : (
            <p className="text-center text-xs text-gray-400 py-10">Loading camera…</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function NewBatchModal({ onClose }: Props) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [step, setStep] = useState<1|2|3>(1);
  const [loading, setLoading] = useState(false);
  const [scanTarget, setScanTarget] = useState<string|null>(null); // unitRow id being scanned

  // Step 1 — invoice header
  const [info, setInfo] = useState({
    supplierId: '', invoiceNumber: '', date: today(),
    deliveryNote: '', receivedBy: '', notes: '',
  });

  // Step 2 — invoice lines
  const [lines, setLines] = useState<InvoiceLine[]>([
    { id: uid(), description: '', qty: 1, unitPrice: 0 },
  ]);

  // Step 3 — per-unit IMEI rows (generated from lines)
  const [units, setUnits] = useState<UnitRow[]>([]);

  useEffect(() => {
    const u = dbService.subscribeToCollection('suppliers', setSuppliers);
    return u;
  }, []);

  // ── Generate unit rows from invoice lines ──────────────────────────────
  const buildUnits = () => {
    const rows: UnitRow[] = [];
    for (const ln of lines) {
      if (!ln.description.trim() || ln.qty < 1) continue;
      for (let i = 0; i < ln.qty; i++) {
        rows.push({
          lineId: ln.id,
          model: ln.description.trim(),
          buyPrice: ln.unitPrice,
          imei: '',
          colour: 'Black',
          conditionGrade: 'A',
          notes: '',
          expanded: false,
        });
      }
    }
    setUnits(rows);
    setStep(3);
  };

  const updateUnit = (idx: number, patch: Partial<UnitRow>) =>
    setUnits(u => u.map((r, i) => i === idx ? { ...r, ...patch } : r));

  const toggleExpand = (idx: number) =>
    setUnits(u => u.map((r, i) => i === idx ? { ...r, expanded: !r.expanded } : r));

  const lineTotal = lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  const imeiCount = units.filter(u => u.imei.length >= 8).length;
  const totalUnits = units.length;

  // ── Save delivery ──────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!info.supplierId) return alert('Please select a supplier.');
    setLoading(true);
    try {
      const batchId = `bat_${Date.now()}`;
      await dbService.create('batches', batchId, {
        supplierId: info.supplierId,
        invoiceNumber: info.invoiceNumber,
        date: info.date,
        deliveryNote: info.deliveryNote,
        receivedBy: info.receivedBy,
        notes: info.notes,
        totalLines: lines.length,
        totalUnits: units.length,
      });

      for (const u of units) {
        const unitId = `unit_${Date.now()}_${uid()}`;
        await dbService.create('inventoryUnits', unitId, {
          imei: u.imei || `PENDING_${uid()}`,
          model: u.model,
          brand: u.model.toLowerCase().includes('samsung') ? 'Samsung' : 'Apple',
          category: u.model.toLowerCase().includes('ipad') ? 'iPad'
            : u.model.toLowerCase().includes('samsung') ? 'Samsung S Series' : 'iPhone',
          colour: u.colour,
          conditionGrade: u.conditionGrade,
          buyPrice: u.buyPrice,
          dateIn: info.date,
          supplierId: info.supplierId,
          batchId,
          status: 'available',
          flags: [],
          notes: u.imei ? u.notes : `IMEI PENDING — ${u.notes}`,
          platformListed: false,
          listingSites: [],
          ownerId: 'admin',
          createdAt: new Date().toISOString(),
        });
      }

      await logInventoryEvent({
        type: 'batch_created',
        message: `Delivery ${info.invoiceNumber || batchId}: ${units.length} units from invoice`,
        batchId,
        supplierId: info.supplierId,
      });

      onClose();
    } catch (err) {
      console.error('Save failed', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-white/90 backdrop-blur-md">
      <motion.div initial={{ y:20,opacity:0 }} animate={{ y:0,opacity:1 }} exit={{ y:20,opacity:0 }}
        className="bg-white border border-gray-200 rounded-2xl w-full max-w-3xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-200 bg-gray-50 flex-shrink-0">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-black text-white flex items-center justify-center rounded-xl">
              <FileText size={20}/>
            </div>
            <div>
              <h2 className="text-lg font-bold tracking-tight uppercase">Add Stock from Supplier</h2>
              <p className="text-[9px] text-gray-500 font-mono uppercase tracking-widest mt-0.5">
                New Supplier Delivery · Invoice Entry
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-xl transition-all"><X size={18}/></button>
        </div>

        {/* Step tabs */}
        <div className="flex border-b border-gray-200 flex-shrink-0">
          {[
            { n:1, label:'Invoice Details' },
            { n:2, label:'Line Items' },
            { n:3, label:'Scan IMEIs' },
          ].map(s => (
            <button key={s.n}
              onClick={() => s.n < step ? setStep(s.n as 1|2|3) : undefined}
              className={`flex-1 py-3 text-[10px] font-bold uppercase tracking-widest border-b-2 transition-all ${
                step===s.n ? 'border-black text-black' :
                s.n < step ? 'border-transparent text-gray-400 cursor-pointer hover:text-gray-600' :
                'border-transparent text-gray-300 cursor-default'
              }`}>
              {s.n}. {s.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">

          {/* ── STEP 1: Invoice Details ── */}
          {step === 1 && (
            <div className="p-6 space-y-5">
              <div className="grid grid-cols-2 gap-4">
                {/* Supplier */}
                <div className="col-span-2 space-y-1">
                  <label className="text-[9px] font-bold uppercase tracking-widest text-gray-400 flex items-center gap-1">
                    <Truck size={10}/> Supplier *
                  </label>
                  <select value={info.supplierId}
                    onChange={e => setInfo({...info, supplierId: e.target.value})}
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-black transition-all">
                    <option value="">Select supplier…</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>

                {/* Invoice # */}
                <div className="space-y-1">
                  <label className="text-[9px] font-bold uppercase tracking-widest text-gray-400">Invoice # *</label>
                  <input value={info.invoiceNumber}
                    onChange={e => setInfo({...info, invoiceNumber: e.target.value})}
                    placeholder="e.g. 0873"
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:border-black transition-all"/>
                </div>

                {/* Date */}
                <div className="space-y-1">
                  <label className="text-[9px] font-bold uppercase tracking-widest text-gray-400 flex items-center gap-1">
                    <Calendar size={10}/> Delivery Date
                  </label>
                  <input type="date" value={info.date}
                    onChange={e => setInfo({...info, date: e.target.value})}
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:border-black transition-all"/>
                </div>

                {/* Delivery Note */}
                <div className="space-y-1">
                  <label className="text-[9px] font-bold uppercase tracking-widest text-gray-400">Delivery Note</label>
                  <input value={info.deliveryNote}
                    onChange={e => setInfo({...info, deliveryNote: e.target.value})}
                    placeholder="e.g. DN-2211"
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:border-black transition-all"/>
                </div>

                {/* Received By */}
                <div className="space-y-1">
                  <label className="text-[9px] font-bold uppercase tracking-widest text-gray-400">Received By</label>
                  <input value={info.receivedBy}
                    onChange={e => setInfo({...info, receivedBy: e.target.value})}
                    placeholder="Staff name"
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-black transition-all"/>
                </div>

                {/* Notes */}
                <div className="col-span-2 space-y-1">
                  <label className="text-[9px] font-bold uppercase tracking-widest text-gray-400">Delivery Notes</label>
                  <input value={info.notes}
                    onChange={e => setInfo({...info, notes: e.target.value})}
                    placeholder="e.g. All units boxed, chargers included"
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-black transition-all"/>
                </div>
              </div>

              {/* Tip */}
              <div className="flex items-start gap-3 bg-blue-50 border border-blue-100 rounded-xl p-4">
                <AlertCircle size={14} className="text-blue-500 flex-shrink-0 mt-0.5"/>
                <p className="text-[10px] text-blue-700 font-mono leading-relaxed">
                  Enter your supplier's invoice details above. IMEIs are <strong>not required</strong> on the invoice —
                  you'll scan each phone individually in Step 3.
                </p>
              </div>
            </div>
          )}

          {/* ── STEP 2: Invoice Line Items ── */}
          {step === 2 && (
            <div className="p-6 space-y-4">
              <p className="text-[10px] text-gray-500 font-mono">
                Copy the line items from your supplier's invoice. Each line expands into individual units in Step 3.
              </p>

              {/* Column headers */}
              <div className="grid grid-cols-12 gap-2 px-2">
                <div className="col-span-6 text-[8px] font-bold uppercase tracking-widest text-gray-400">Description (from invoice)</div>
                <div className="col-span-2 text-[8px] font-bold uppercase tracking-widest text-gray-400 text-center">Qty</div>
                <div className="col-span-3 text-[8px] font-bold uppercase tracking-widest text-gray-400 text-right">Unit Price (£)</div>
                <div className="col-span-1"/>
              </div>

              {lines.map((ln, i) => (
                <div key={ln.id} className="grid grid-cols-12 gap-2 items-center p-3 bg-gray-50 rounded-xl border border-gray-200">
                  {/* Description */}
                  <div className="col-span-6">
                    <input value={ln.description}
                      onChange={e => setLines(ls => ls.map((l,j) => j===i ? {...l,description:e.target.value} : l))}
                      placeholder="e.g. Apple iPhone 14 128gb"
                      className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-black transition-all"/>
                  </div>
                  {/* Qty */}
                  <div className="col-span-2">
                    <input type="number" min={1} value={ln.qty}
                      onChange={e => setLines(ls => ls.map((l,j) => j===i ? {...l,qty:Math.max(1,Number(e.target.value))} : l))}
                      className="w-full bg-white border border-gray-200 rounded-lg px-2 py-2 text-xs text-center font-mono focus:outline-none focus:border-black transition-all"/>
                  </div>
                  {/* Unit Price */}
                  <div className="col-span-3">
                    <input type="number" min={0} step={0.01} value={ln.unitPrice || ''}
                      onChange={e => setLines(ls => ls.map((l,j) => j===i ? {...l,unitPrice:Number(e.target.value)} : l))}
                      placeholder="0.00"
                      className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono text-right focus:outline-none focus:border-black transition-all"/>
                  </div>
                  {/* Remove */}
                  <div className="col-span-1 flex justify-center">
                    {lines.length > 1 && (
                      <button onClick={() => setLines(ls => ls.filter((_,j) => j!==i))}
                        className="p-1.5 hover:bg-red-50 hover:text-red-500 text-gray-300 rounded-lg transition-all">
                        <Trash2 size={13}/>
                      </button>
                    )}
                  </div>
                </div>
              ))}

              {/* Add line */}
              <button onClick={() => setLines(ls => [...ls, { id:uid(), description:'', qty:1, unitPrice:0 }])}
                className="w-full py-4 border-2 border-dashed border-gray-200 rounded-xl text-[10px] font-bold uppercase tracking-widest text-gray-400 hover:border-black hover:text-black transition-all flex items-center justify-center gap-2">
                <Plus size={13}/> Add Line Item
              </button>

              {/* Invoice total summary */}
              <div className="flex items-center justify-between px-4 py-3 bg-black text-white rounded-xl">
                <span className="text-[10px] font-mono uppercase tracking-widest text-gray-400">
                  {lines.reduce((s,l)=>s+l.qty,0)} units · {lines.length} line{lines.length!==1?'s':''}
                </span>
                <span className="text-base font-bold">£{lineTotal.toLocaleString()}</span>
              </div>
            </div>
          )}

          {/* ── STEP 3: Scan IMEIs ── */}
          {step === 3 && (
            <div className="p-6 space-y-3">
              {/* Progress bar */}
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] text-gray-500 font-mono">
                  {imeiCount} of {totalUnits} IMEIs scanned
                  {imeiCount < totalUnits && <span className="text-amber-600 ml-2">· {totalUnits-imeiCount} pending</span>}
                </p>
                <div className="w-32 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full transition-all"
                    style={{ width: `${totalUnits ? (imeiCount/totalUnits)*100 : 0}%` }}/>
                </div>
              </div>

              {/* Group by invoice line */}
              {lines.map(ln => {
                const lineUnits = units.map((u,i) => ({u,i})).filter(({u}) => u.lineId === ln.id);
                if (!lineUnits.length) return null;
                return (
                  <div key={ln.id} className="border border-gray-200 rounded-xl overflow-hidden">
                    {/* Line header */}
                    <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                      <div>
                        <p className="text-xs font-bold">{ln.description}</p>
                        <p className="text-[9px] text-gray-400 font-mono">
                          {lineUnits.length} unit{lineUnits.length!==1?'s':''} · £{ln.unitPrice} each
                        </p>
                      </div>
                      <span className={`text-[8px] font-bold px-2 py-1 rounded-full ${
                        lineUnits.every(({u})=>u.imei.length>=8)
                          ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                      }`}>
                        {lineUnits.filter(({u})=>u.imei.length>=8).length}/{lineUnits.length} scanned
                      </span>
                    </div>

                    {/* Unit rows */}
                    {lineUnits.map(({u,i}) => (
                      <div key={i} className="border-b border-gray-50 last:border-0">
                        {/* Collapsed row */}
                        <div className="flex items-center gap-3 px-4 py-3">
                          {/* IMEI status dot */}
                          <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                            u.imei.length >= 8 ? 'bg-emerald-400' : 'bg-amber-300'}`}/>
                          {/* IMEI input */}
                          <input
                            value={u.imei}
                            onChange={e => updateUnit(i, { imei: e.target.value.replace(/\D/g,'') })}
                            placeholder="IMEI / Serial number"
                            inputMode="numeric"
                            className={`flex-1 border rounded-lg px-3 py-2 text-xs font-mono focus:outline-none transition-all ${
                              u.imei.length>=8 ? 'border-emerald-200 bg-emerald-50' : 'border-gray-200 bg-white focus:border-black'
                            }`}/>
                          {/* Camera scan */}
                          <button onClick={() => setScanTarget(`${i}`)}
                            className="flex-shrink-0 p-2 bg-black text-white rounded-lg hover:bg-gray-800 transition-all">
                            <Camera size={13}/>
                          </button>
                          {/* Expand for colour/grade */}
                          <button onClick={() => toggleExpand(i)}
                            className="flex-shrink-0 p-2 hover:bg-gray-100 rounded-lg transition-all text-gray-400">
                            {u.expanded ? <ChevronUp size={13}/> : <ChevronDown size={13}/>}
                          </button>
                        </div>

                        {/* Expanded details */}
                        <AnimatePresence>
                          {u.expanded && (
                            <motion.div
                              initial={{ height:0, opacity:0 }}
                              animate={{ height:'auto', opacity:1 }}
                              exit={{ height:0, opacity:0 }}
                              className="overflow-hidden bg-gray-50 border-t border-gray-100">
                              <div className="px-4 py-3 grid grid-cols-3 gap-3">
                                {/* Colour */}
                                <div>
                                  <label className="text-[8px] font-bold uppercase tracking-widest text-gray-400">Colour</label>
                                  <select value={u.colour}
                                    onChange={e => updateUnit(i,{colour:e.target.value})}
                                    className="w-full mt-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-black bg-white">
                                    {COLOURS.map(c => <option key={c}>{c}</option>)}
                                  </select>
                                </div>
                                {/* Grade */}
                                <div>
                                  <label className="text-[8px] font-bold uppercase tracking-widest text-gray-400">Condition</label>
                                  <select value={u.conditionGrade}
                                    onChange={e => updateUnit(i,{conditionGrade:e.target.value as ConditionGrade})}
                                    className="w-full mt-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-black bg-white">
                                    {['A','B','C','D','Unknown'].map(g => <option key={g}>{g}</option>)}
                                  </select>
                                </div>
                                {/* Notes */}
                                <div>
                                  <label className="text-[8px] font-bold uppercase tracking-widest text-gray-400">Notes</label>
                                  <input value={u.notes}
                                    onChange={e => updateUnit(i,{notes:e.target.value})}
                                    placeholder="Box, accessories…"
                                    className="w-full mt-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-black bg-white"/>
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    ))}
                  </div>
                );
              })}

              {/* Notice for pending IMEIs */}
              {imeiCount < totalUnits && (
                <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
                  <AlertCircle size={14} className="text-amber-500 flex-shrink-0 mt-0.5"/>
                  <p className="text-[10px] text-amber-800 font-mono leading-relaxed">
                    {totalUnits-imeiCount} unit{totalUnits-imeiCount!==1?'s':''} saved without IMEI — they'll be marked
                    <strong> IMEI PENDING</strong> in stock. You can update them later by scanning.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex items-center justify-between flex-shrink-0">
          <div className="flex gap-1">
            {[1,2,3].map(i => (
              <div key={i} className={`h-1 rounded-full transition-all ${step===i?'w-8 bg-black':'w-3 bg-gray-300'}`}/>
            ))}
          </div>

          <div className="flex gap-3">
            {step > 1 && (
              <button onClick={() => setStep(s => Math.max(1,s-1) as 1|2|3)}
                className="px-6 py-2.5 border border-gray-200 rounded-xl text-[10px] font-bold uppercase tracking-widest text-gray-600 hover:bg-white transition-all">
                Back
              </button>
            )}
            {step < 3 ? (
              <button
                onClick={() => {
                  if (step===1) {
                    if (!info.supplierId) return alert('Please select a supplier.');
                    if (!info.invoiceNumber.trim()) return alert('Please enter the invoice number.');
                    setStep(2);
                  } else {
                    buildUnits();
                  }
                }}
                className="px-8 py-2.5 bg-black text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-gray-800 transition-all flex items-center gap-2">
                Next →
              </button>
            ) : (
              <button onClick={handleSave} disabled={loading}
                className="px-8 py-2.5 bg-black text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-gray-800 transition-all disabled:opacity-50 flex items-center gap-2">
                {loading ? 'Saving…' : <><CheckCircle2 size={14}/> Save Delivery</>}
              </button>
            )}
          </div>
        </div>
      </motion.div>

      {/* Camera modal */}
      {scanTarget !== null && (
        <CameraScanModal
          onScan={v => {
            const idx = parseInt(scanTarget);
            updateUnit(idx, { imei: v });
            setScanTarget(null);
          }}
          onClose={() => setScanTarget(null)}
        />
      )}
    </motion.div>
  );
}
