import React, { useState, useEffect } from 'react';
import { 
  Plus, 
  MapPin, 
  Globe, 
  Mail, 
  ExternalLink,
  ChevronRight,
  MoreVertical,
  Briefcase
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { dbService } from '../lib/dbService';
import { Supplier } from '../types';

export default function Suppliers() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [newSupplier, setNewSupplier] = useState({ name: '', portal: 'Website' as any, contactEmail: '', websiteUrl: '' });

  useEffect(() => {
    return dbService.subscribeToCollection('suppliers', setSuppliers);
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = `sup_${Date.now()}`;
    await dbService.create('suppliers', id, newSupplier);
    setIsAdding(false);
    setNewSupplier({ name: '', portal: 'Website', contactEmail: '', websiteUrl: '' });
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-4xl font-bold tracking-tighter uppercase font-display">Origins</h2>
          <div className="h-px w-24 bg-black mt-2" />
        </div>
        <button 
          onClick={() => setIsAdding(true)}
          className="flex items-center gap-3 px-8 py-3 bg-black text-white rounded-none text-xs font-bold uppercase tracking-[0.2em] hover:bg-gray-800 transition-all active:scale-95"
        >
          <Plus size={18} strokeWidth={3} />
          Register Partner
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {suppliers.map((supplier) => (
          <motion.div 
            layout
            key={supplier.id}
            className="bg-white border border-gray-200 rounded-none p-8 hover:border-gray-400 transition-all group relative cursor-pointer shadow-sm text-black"
          >
            <div className="flex justify-between items-start mb-8">
              <div className="w-14 h-14 bg-gray-50 border border-gray-200 rounded-none flex items-center justify-center group-hover:bg-gray-100 transition-all">
                <Briefcase className="text-gray-500 group-hover:text-black" size={24} />
              </div>
              <button className="text-gray-800 hover:text-black transition-colors">
                <MoreVertical size={20} />
              </button>
            </div>
            
            <div className="space-y-6">
              <div>
                <h3 className="text-xl font-bold tracking-tight uppercase font-display">{supplier.name}</h3>
                <span className="text-[9px] text-gray-600 font-mono uppercase tracking-[0.3em] font-bold mt-1 inline-block">{supplier.portal} SOURCE CHANNEL</span>
              </div>

              <div className="space-y-3 border-t border-gray-200 pt-6">
                <div className="flex items-center gap-4 text-[11px] text-gray-500 font-mono uppercase tracking-wider">
                  <Mail size={14} className="text-gray-800" />
                  <span className="truncate">{supplier.contactEmail || 'SECURE_COMMS_ONLY'}</span>
                </div>
                <div className="flex items-center gap-4 text-[11px] text-gray-500 font-mono uppercase tracking-wider">
                  <Globe size={14} className="text-gray-800" />
                  <span className="truncate">{supplier.websiteUrl ? new URL(supplier.websiteUrl).hostname : 'DIRECT_ACCESS'}</span>
                </div>
              </div>

              <div className="pt-6 flex gap-3">
                <button className="flex-1 bg-gray-50 hover:bg-black text-black hover:text-white text-[10px] font-bold uppercase tracking-widest py-3 rounded-none border border-gray-200 transition-all flex items-center justify-center gap-2">
                  Query Logs
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          </motion.div>
        ))}

        {suppliers.length === 0 && !isAdding && (
          <div className="col-span-full py-20 text-center border-2 border-dashed border-gray-200 rounded-2xl">
            <p className="text-gray-500 font-mono text-sm italic">NO SUPPLIERS CONFIGURED IN REGISTRY</p>
          </div>
        )}
      </div>

      <AnimatePresence>
        {isAdding && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-white/80 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white border border-gray-200 rounded-none p-12 max-w-xl w-full shadow-2xl border-t-8 border-t-black text-black"
            >
              <h3 className="text-4xl font-bold tracking-tighter uppercase font-display mb-10">Network Onboarding</h3>
              <form onSubmit={handleAdd} className="space-y-8">
                <div className="space-y-2">
                  <label className="text-[10px] text-gray-600 font-mono uppercase tracking-[0.2em] font-bold">Partner Identity</label>
                  <input 
                    required
                    value={newSupplier.name}
                    onChange={e => setNewSupplier({...newSupplier, name: e.target.value})}
                    type="text" 
                    className="w-full bg-gray-50 border border-gray-200 rounded-none py-4 px-5 focus:outline-none focus:border-black focus:bg-white transition-all font-light text-black"
                    placeholder="ENTER REGISTERED NAME"
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-8">
                  <div className="space-y-2">
                    <label className="text-[10px] text-gray-600 font-mono uppercase tracking-[0.2em] font-bold">Protocol</label>
                    <select 
                      value={newSupplier.portal}
                      onChange={e => setNewSupplier({...newSupplier, portal: e.target.value as any})}
                      className="w-full bg-gray-50 border border-gray-200 rounded-none py-4 px-5 focus:outline-none focus:border-black focus:bg-white transition-all appearance-none font-light uppercase text-xs tracking-widest text-black"
                    >
                      <option className="bg-white">Website</option>
                      <option className="bg-white">eBay</option>
                      <option className="bg-white">Direct</option>
                      <option className="bg-white">Other</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] text-gray-600 font-mono uppercase tracking-[0.2em] font-bold">Secure Contact</label>
                    <input 
                      value={newSupplier.contactEmail}
                      onChange={e => setNewSupplier({...newSupplier, contactEmail: e.target.value})}
                      type="email" 
                      className="w-full bg-gray-50 border border-gray-200 rounded-none py-4 px-5 focus:outline-none focus:border-black focus:bg-white transition-all font-light text-black"
                      placeholder="EMAIL@ENDPOINT"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] text-gray-600 font-mono uppercase tracking-[0.2em] font-bold">Reference Link</label>
                  <input 
                    value={newSupplier.websiteUrl}
                    onChange={e => setNewSupplier({...newSupplier, websiteUrl: e.target.value})}
                    type="url" 
                    className="w-full bg-gray-50 border border-gray-200 rounded-none py-4 px-5 focus:outline-none focus:border-black focus:bg-white transition-all font-light text-black"
                    placeholder="HTTPS://REPOSITORY.ENDPOINT"
                  />
                </div>

                <div className="pt-10 flex gap-6">
                  <button 
                    type="button"
                    onClick={() => setIsAdding(false)}
                    className="flex-1 py-4 px-6 rounded-none border border-gray-200 font-bold uppercase tracking-widest text-[11px] hover:bg-gray-50 transition-all text-black"
                  >
                    Abort
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 py-4 px-6 rounded-none bg-black text-white font-bold uppercase tracking-widest text-[11px] hover:bg-gray-800 transition-all active:scale-[0.98]"
                  >
                    Establish Link
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
