import { useState, useEffect } from 'react';
import { 
  ShoppingBag, 
  ExternalLink, 
  Calendar, 
  User,
  Plus,
  ArrowUpRight,
  Monitor
} from 'lucide-react';
import { motion } from 'motion/react';
import { dbService } from '../lib/dbService';
import { Order, Device } from '../types';

export default function Sales() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);

  useEffect(() => {
    const unsubOrders = dbService.subscribeToCollection('orders', setOrders);
    const unsubDevices = dbService.subscribeToCollection('devices', setDevices);
    return () => {
      unsubOrders();
      unsubDevices();
    };
  }, []);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-4xl font-bold tracking-tighter uppercase font-display">Revenue</h2>
          <div className="h-px w-24 bg-white mt-2" />
        </div>
        <div className="flex items-center gap-6">
          <div className="flex -space-x-3">
            {['E', 'A', 'D', 'S'].map(i => (
              <div key={i} className="w-10 h-10 rounded-none border border-white/20 bg-black flex items-center justify-center text-[11px] font-bold font-mono group hover:bg-white hover:text-black transition-all cursor-crosshair">
                {i}
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-500 font-mono uppercase tracking-[0.2em] font-bold">Portals Connected</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <MetricCard label="eBay Total" value="$12,450" change="+14%" icon="E" />
        <MetricCard label="Direct Sales" value="$4,200" change="+2.4%" icon="D" />
        <MetricCard label="Amazon" value="$8,900" change="+22%" icon="A" />
        <MetricCard label="Swappa" value="$1,100" change="-5%" icon="S" />
      </div>

      <div className="bg-black border border-white/5 rounded-none overflow-hidden">
        <div className="p-8 border-b border-white/5 flex items-center justify-between bg-white/[0.01]">
          <h3 className="font-bold uppercase tracking-widest text-[11px] text-gray-500">Transaction Stream</h3>
          <button className="text-[10px] font-bold uppercase tracking-widest text-gray-600 hover:text-white flex items-center gap-2 transition-colors">
            Export Ledger
            <ExternalLink size={14} />
          </button>
        </div>
        
        <div className="divide-y divide-white/5">
          {orders.map((order) => (
            <div key={order.id} className="p-8 hover:bg-white/[0.03] transition-all flex flex-col md:flex-row gap-8 md:items-center group">
              <div className="flex items-center gap-6 min-w-[240px]">
                <div className="w-12 h-12 rounded-none bg-white/[0.03] border border-white/10 flex items-center justify-center font-bold text-xs group-hover:bg-white group-hover:text-black transition-all">
                  {order.platform[0]}
                </div>
                <div>
                  <p className="text-sm font-bold font-display tracking-tight uppercase">{order.platformOrderId}</p>
                  <p className="text-[9px] text-gray-600 font-mono uppercase tracking-[0.2em] font-bold mt-1 text-nowrap">{order.platform} SYSTEM ID</p>
                </div>
              </div>

              <div className="flex-1 grid grid-cols-2 md:grid-cols-3 gap-10">
                <div className="space-y-2">
                  <div className="flex items-center gap-3 text-[9px] text-gray-600 uppercase font-mono font-bold tracking-widest">
                    <User size={12} className="text-gray-800" />
                    Counterparty
                  </div>
                  <p className="text-xs font-bold uppercase tracking-wide truncate">{order.customerName || 'ANONYMOUS'}</p>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-3 text-[9px] text-gray-600 uppercase font-mono font-bold tracking-widest">
                    <ShoppingBag size={12} className="text-gray-800" />
                    Unit Allocation
                  </div>
                  <p className="text-xs font-bold uppercase tracking-wide">{order.deviceIds.length} SHIPPED</p>
                </div>
                <div className="space-y-2 hidden md:block">
                  <div className="flex items-center gap-3 text-[9px] text-gray-600 uppercase font-mono font-bold tracking-widest">
                    <Calendar size={12} className="text-gray-800" />
                    Timestamp
                  </div>
                  <p className="text-xs font-bold uppercase tracking-wide">{(order.date as any)?.toDate?.().toLocaleDateString() || 'UNTRACKED'}</p>
                </div>
              </div>

              <div className="flex items-center justify-between md:justify-end gap-16 w-full md:w-auto mt-6 md:mt-0">
                <div className="text-right">
                  <p className="text-2xl font-bold tracking-tighter tabular-nums">${order.totalAmount}</p>
                  <p className="text-[9px] text-white font-mono uppercase tracking-[0.3em] font-bold mt-1">Confirmed</p>
                </div>
                <button className="p-3 bg-white/5 hover:bg-white text-gray-500 hover:text-black transition-all border border-transparent hover:border-white">
                  <ArrowUpRight size={20} strokeWidth={3} />
                </button>
              </div>
            </div>
          ))}

          {orders.length === 0 && (
            <div className="px-6 py-20 text-center text-gray-500 font-mono text-xs italic">
              NO ORDERS TRANSACTION DETECTED ON RECORDED CHANNELS
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value, change, icon }: any) {
  const isUp = change.startsWith('+');
  return (
    <div className="bg-black border border-white/5 rounded-none p-6 flex flex-col justify-between hover:border-white/20 transition-all cursor-pointer group">
      <div className="flex items-center justify-between mb-6">
        <div className="w-10 h-10 rounded-none bg-white/[0.03] border border-white/10 flex items-center justify-center font-bold text-xs text-gray-500 group-hover:bg-white group-hover:text-black transition-all">
          {icon}
        </div>
        <div className={`text-[10px] font-mono font-bold tracking-widest ${isUp ? 'text-white' : 'text-gray-500'}`}>
          {change}
        </div>
      </div>
      <div>
        <p className="text-[9px] text-gray-600 uppercase tracking-[0.3em] font-mono mb-2 font-bold">{label}</p>
        <p className="text-3xl font-bold tracking-tighter font-display">{value}</p>
      </div>
    </div>
  );
}
