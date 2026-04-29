import { useState, useEffect } from 'react';
import { 
  Plus, 
  Filter, 
  MoreHorizontal, 
  Search,
  ExternalLink,
  Edit2,
  Trash2,
  Hash,
  Truck
} from 'lucide-react';
import { motion } from 'motion/react';
import { dbService } from '../lib/dbService';
import { Device, Supplier, Batch } from '../types';

export default function Inventory() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    const unsubDevices = dbService.subscribeToCollection('devices', setDevices);
    const unsubSuppliers = dbService.subscribeToCollection('suppliers', setSuppliers);
    const unsubBatches = dbService.subscribeToCollection('batches', setBatches);
    return () => {
      unsubDevices();
      unsubSuppliers();
      unsubBatches();
    };
  }, []);

  const filteredDevices = devices.filter(d => 
    d.imei.toLowerCase().includes(searchTerm.toLowerCase()) ||
    d.model.toLowerCase().includes(searchTerm.toLowerCase()) ||
    d.brand.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-4xl font-bold tracking-tighter uppercase font-display">Repository</h2>
          <div className="h-px w-24 bg-white mt-2" />
        </div>
        <div className="flex items-center gap-4">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-600" size={16} />
            <input 
              type="text" 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search hardware..."
              className="bg-white/[0.03] border border-white/10 rounded-none py-2.5 pl-12 pr-4 text-xs font-mono uppercase tracking-widest focus:outline-none focus:border-white/40 transition-all w-72"
            />
          </div>
          <button className="flex items-center gap-2 px-6 py-2.5 bg-black border border-white/10 rounded-none text-[10px] font-bold uppercase tracking-[0.2em] hover:bg-white hover:text-black transition-all">
            <Filter size={14} />
            Schema Filter
          </button>
        </div>
      </div>

      <div className="bg-black border border-white/5 rounded-none overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-white/10 text-[9px] text-gray-600 uppercase tracking-[0.3em] font-mono bg-white/[0.01]">
              <th className="px-8 py-5 font-bold">Hardware Specification</th>
              <th className="px-8 py-5 font-bold">Identity</th>
              <th className="px-8 py-5 font-bold">Origin / Control</th>
              <th className="px-8 py-5 font-bold font-display">Status</th>
              <th className="px-8 py-5 font-bold">Valuation</th>
              <th className="px-8 py-5 font-bold text-right">Operations</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {filteredDevices.map((device) => (
              <tr key={device.id} className="group hover:bg-white/[0.03] transition-all cursor-default">
                <td className="px-8 py-6">
                  <div>
                    <p className="text-sm font-bold tracking-tight uppercase font-display">{device.model}</p>
                    <p className="text-[10px] text-gray-600 font-mono uppercase mt-1">{device.brand} // {device.condition}</p>
                  </div>
                </td>
                <td className="px-8 py-6 font-mono text-xs text-gray-500 tabular-nums">
                  {device.imei}
                </td>
                <td className="px-8 py-6">
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-mono flex items-center gap-2 group-hover:text-white transition-colors uppercase tracking-widest">
                      <Hash size={12} className="text-gray-700" />
                      {batches.find(b => b.id === device.batchId)?.supplierRef || 'SYSTEM_GEN'}
                    </span>
                    <span className="text-[9px] text-gray-600 uppercase flex items-center gap-2 tracking-[0.2em] font-mono">
                      <Truck size={10} className="text-gray-800" />
                      {suppliers.find(s => s.id === device.supplierId)?.name || 'INTERNAL'}
                    </span>
                  </div>
                </td>
                <td className="px-8 py-6">
                  <StatusBadge status={device.status} />
                </td>
                <td className="px-8 py-6">
                  <span className="text-sm font-bold font-mono tracking-tighter tabular-nums">${device.purchasePrice}</span>
                </td>
                <td className="px-8 py-6 text-right">
                  <div className="flex items-center justify-end gap-3 opacity-0 group-hover:opacity-100 transition-all transform translate-x-2 group-hover:translate-x-0">
                    <button className="p-2.5 bg-white/5 hover:bg-white text-gray-400 hover:text-black rounded-none transition-all">
                      <Edit2 size={14} />
                    </button>
                    <button className="p-2.5 bg-white/5 hover:bg-white text-gray-400 hover:text-black rounded-none transition-all">
                      <MoreHorizontal size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filteredDevices.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-gray-500 font-mono text-xs italic">
                  No compatible hardware matching your query
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: any = {
    available: 'bg-white text-black border-white',
    sold: 'bg-black text-white border-white/20',
    returned: 'bg-black text-gray-400 border-white/10 italic',
    lost: 'bg-red-900 border-red-500 text-white',
  };

  return (
    <span className={`px-3 py-1 font-mono font-bold text-[9px] uppercase border tracking-[0.1em] ${styles[status] || 'bg-black text-gray-600'}`}>
      {status}
    </span>
  );
}
