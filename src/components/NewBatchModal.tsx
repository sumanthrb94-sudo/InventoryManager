import React, { useState, useEffect } from 'react';
import { 
  X, 
  Plus, 
  Trash2, 
  Smartphone, 
  Truck, 
  Calendar,
  AlertCircle,
  CheckCircle2,
  Zap,
  Info
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { dbService } from '../lib/dbService';
import { Supplier, Device, Batch } from '../types';

interface NewBatchModalProps {
  onClose: () => void;
}

export default function NewBatchModal({ onClose }: NewBatchModalProps) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(1);
  
  // Batch Info
  const [batchInfo, setBatchInfo] = useState({
    supplierId: '',
    date: new Date().toISOString().split('T')[0],
    supplierRef: '',
    costTotal: 0
  });

  // Devices
  const [devices, setDevices] = useState<{imei: string, model: string, brand: string, purchasePrice: number}[]>([
    { imei: '', model: '', brand: '', purchasePrice: 0 }
  ]);

  useEffect(() => {
    return dbService.subscribeToCollection('suppliers', setSuppliers);
  }, []);

  const addDeviceField = () => {
    setDevices([...devices, { imei: '', model: '', brand: '', purchasePrice: 0 }]);
  };

  const removeDeviceField = (index: number) => {
    setDevices(devices.filter((_, i) => i !== index));
  };

  const updateDevice = (index: number, field: string, value: any) => {
    const newDevices = [...devices];
    (newDevices[index] as any)[field] = value;
    setDevices(newDevices);
  };

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const batchId = `bat_${Date.now()}`;
      
      // 1. Create Batch
      await dbService.create('batches', batchId, {
        ...batchInfo,
        itemCount: devices.length,
        status: 'received'
      });

      // 2. Create Devices
      for (const d of devices) {
        const deviceId = `dev_${Math.random().toString(36).substr(2, 9)}`;
        await dbService.create('devices', deviceId, {
          ...d,
          batchId,
          supplierId: batchInfo.supplierId,
          status: 'available',
          condition: 'New'
        });
      }

      onClose();
    } catch (error) {
      console.error("Batch creation failed", error);
    } finally {
      setLoading(false);
    }
  };

  const smartParse = () => {
    // Simple mock logic for "auto" parsing
    // In real app, this could be a text area where user pastes a list
    const prompt = window.prompt("Paste IMEI list or bill snippets here (Mocked):");
    if (prompt) {
      alert("Nexus Intelligent Parsing would process this text to extract device details automatically.");
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md"
    >
      <motion.div 
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 20, opacity: 0 }}
        className="bg-black border border-white/10 rounded-none w-full max-w-5xl max-h-[90vh] flex flex-col shadow-[0_0_100px_rgba(0,0,0,0.8)] relative overflow-hidden"
      >
        {/* Banner Area */}
        <div className="h-40 bg-black border-b border-white/5 flex items-end p-12 relative overflow-hidden">
           <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 blur-[100px] -mr-32 -mt-32" />
           <button 
             onClick={onClose}
             className="absolute top-8 right-8 p-3 hover:bg-white text-gray-500 hover:text-black transition-all z-10"
           >
             <X size={24} />
           </button>
           <div className="flex items-center gap-6 relative z-10">
             <div className="w-16 h-16 bg-white text-black rounded-none flex items-center justify-center">
               <Zap size={32} strokeWidth={2.5} />
             </div>
             <div>
               <h2 className="text-4xl font-bold tracking-tighter uppercase font-display">Ingest Sequence</h2>
               <p className="text-gray-600 text-[10px] font-mono uppercase tracking-[0.4em] font-bold mt-1">Batch Procurement Protocol</p>
             </div>
           </div>
        </div>

        <div className="flex-1 overflow-y-auto p-12 custom-scrollbar bg-[#020202]">
          {step === 1 ? (
            <div className="space-y-12">
              <div className="grid grid-cols-2 gap-12">
                <div className="space-y-8">
                  <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] font-mono text-gray-500 border-b border-white/5 pb-4 flex items-center gap-3">
                    <Truck size={14} className="text-white" />
                    Origin Verification
                  </h3>
                  <div className="space-y-6">
                    <div className="space-y-2">
                      <label className="text-[9px] text-gray-600 font-mono uppercase font-bold tracking-widest">Select Registered Partner</label>
                      <select 
                        value={batchInfo.supplierId}
                        onChange={e => setBatchInfo({...batchInfo, supplierId: e.target.value})}
                        className="w-full bg-white/[0.03] border border-white/10 rounded-none py-4 px-5 outline-none focus:border-white/40 focus:bg-white/[0.05] transition-all font-light"
                      >
                        <option value="">PARTNER_SELECTION.INIT</option>
                        {suppliers.map(s => (
                          <option key={s.id} value={s.id} className="bg-black">{s.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[9px] text-gray-600 font-mono uppercase font-bold tracking-widest">Master Reference (Bill #)</label>
                      <input 
                        value={batchInfo.supplierRef}
                        onChange={e => setBatchInfo({...batchInfo, supplierRef: e.target.value})}
                        className="w-full bg-white/[0.03] border border-white/10 rounded-none py-4 px-5 outline-none focus:border-white/40 focus:bg-white/[0.05] transition-all font-light"
                        placeholder="REF_ID_000"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-8">
                  <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] font-mono text-gray-500 border-b border-white/5 pb-4 flex items-center gap-3">
                    <Calendar size={14} className="text-white" />
                    Temporal Meta
                  </h3>
                  <div className="space-y-6">
                    <div className="space-y-2">
                      <label className="text-[9px] text-gray-600 font-mono uppercase font-bold tracking-widest">Ingestion Date</label>
                      <input 
                        type="date"
                        value={batchInfo.date}
                        onChange={e => setBatchInfo({...batchInfo, date: e.target.value})}
                        className="w-full bg-white/[0.03] border border-white/10 rounded-none py-4 px-5 outline-none focus:border-white/40 focus:bg-white/[0.05] transition-all font-light"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[9px] text-gray-600 font-mono uppercase font-bold tracking-widest">Valuation (USD)</label>
                      <input 
                        type="number"
                        value={batchInfo.costTotal}
                        onChange={e => setBatchInfo({...batchInfo, costTotal: Number(e.target.value)})}
                        className="w-full bg-white/[0.03] border border-white/10 rounded-none py-4 px-5 outline-none focus:border-white/40 focus:bg-white/[0.05] transition-all font-light font-mono"
                        placeholder="0.00"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-8 bg-white/[0.02] border border-white/5 rounded-none flex items-start gap-6 border-l-4 border-l-white">
                <Info size={24} className="text-white flex-shrink-0" />
                <p className="text-xs text-gray-500 leading-relaxed font-mono uppercase tracking-wider">
                  SYSTEM_LOG: Batches establish immutable relationship between source channel and digital inventory. 
                  Linking ensures complete provenance and compliance tracking across distributed portals.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-8">
              <div className="flex items-center justify-between border-b border-white/5 pb-6">
                <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] font-mono text-gray-500 flex items-center gap-3">
                  <Smartphone size={14} className="text-white" />
                  Hardware Allocation
                </h3>
                <button 
                  onClick={smartParse}
                  className="text-[10px] font-mono font-bold uppercase tracking-[0.2em] text-white/40 hover:text-white flex items-center gap-2 transition-all group"
                >
                  <AlertCircle size={14} className="group-hover:rotate-12 transition-transform" />
                  Intelligent Parser (Beta)
                </button>
              </div>

              <div className="space-y-4">
                {devices.map((device, idx) => (
                  <motion.div 
                    initial={{ x: -10, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    key={idx} 
                    className="grid grid-cols-12 gap-4 p-5 bg-black border border-white/5 rounded-none group relative hover:border-white/20 transition-all"
                  >
                    <div className="col-span-3">
                      <label className="text-[8px] text-gray-700 font-mono uppercase block mb-1">Identity</label>
                      <input 
                        placeholder="IMEI / SERIAL"
                        value={device.imei}
                        onChange={e => updateDevice(idx, 'imei', e.target.value)}
                        className="w-full bg-transparent border-none text-xs focus:ring-0 placeholder:text-gray-800 font-mono tracking-widest"
                      />
                    </div>
                    <div className="col-span-3">
                      <label className="text-[8px] text-gray-700 font-mono uppercase block mb-1">Specification</label>
                      <input 
                        placeholder="MODEL_TYPE"
                        value={device.model}
                        onChange={e => updateDevice(idx, 'model', e.target.value)}
                        className="w-full bg-transparent border-none text-xs focus:ring-0 placeholder:text-gray-800 uppercase"
                      />
                    </div>
                    <div className="col-span-3">
                      <label className="text-[8px] text-gray-700 font-mono uppercase block mb-1">Manufacturer</label>
                       <input 
                        placeholder="BRAND_ID"
                        value={device.brand}
                        onChange={e => updateDevice(idx, 'brand', e.target.value)}
                        className="w-full bg-transparent border-none text-xs focus:ring-0 placeholder:text-gray-800 uppercase"
                      />
                    </div>
                    <div className="col-span-2">
                       <label className="text-[8px] text-gray-700 font-mono uppercase block mb-1">Valuation</label>
                       <input 
                        type="number"
                        placeholder="0.00"
                        value={device.purchasePrice || ''}
                        onChange={e => updateDevice(idx, 'purchasePrice', Number(e.target.value))}
                        className="w-full bg-transparent border-none text-xs focus:ring-0 placeholder:text-gray-800 font-mono"
                      />
                    </div>
                    <div className="col-span-1 flex justify-end items-center">
                      <button 
                        onClick={() => removeDeviceField(idx)}
                        className="p-2 hover:bg-red-500 hover:text-white transition-all opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </motion.div>
                ))}
              </div>

              <button 
                onClick={addDeviceField}
                className="w-full py-8 border-2 border-dashed border-white/5 rounded-none text-gray-600 font-bold uppercase tracking-[0.3em] text-[10px] hover:text-white hover:border-white/20 hover:bg-white/[0.02] transition-all flex items-center justify-center gap-3 active:scale-[0.99]"
              >
                <Plus size={18} strokeWidth={3} />
                Append Resource Node
              </button>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="p-12 border-t border-white/10 flex justify-between items-center bg-black">
           <div className="flex items-center gap-3">
             {[1, 2].map(i => (
               <div 
                 key={i} 
                 className={`w-10 h-1 transition-all ${step === i ? 'bg-white' : 'bg-white/10'}`} 
               />
             ))}
           </div>
           <div className="flex gap-6">
             {step === 2 && (
               <button 
                 onClick={() => setStep(1)}
                 className="px-10 py-4 rounded-none border border-white/10 font-bold uppercase tracking-widest text-[11px] hover:bg-white/5 transition-all"
               >
                 Go Back
               </button>
             )}
             <button 
               onClick={() => {
                 if (step === 1) {
                   if (!batchInfo.supplierId) return alert("Select a supplier origin");
                   setStep(2);
                 } else {
                    handleSubmit();
                 }
               }}
               disabled={loading}
               className="px-12 py-4 rounded-none bg-white text-black font-bold uppercase tracking-widest text-[11px] hover:bg-gray-200 transition-all disabled:opacity-50 flex items-center gap-3 active:scale-[0.98]"
             >
               {loading ? 'Executing...' : step === 1 ? 'Configure' : 'Finalize Commit'}
               {!loading && <CheckCircle2 size={18} strokeWidth={3} />}
             </button>
           </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
