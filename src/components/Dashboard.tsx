import { useState, useEffect } from 'react';
import { 
  TrendingUp, 
  Package, 
  CircleDollarSign, 
  AlertCircle,
  Smartphone,
  ArrowUpRight,
  ArrowDownRight
} from 'lucide-react';
import { motion } from 'motion/react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { dbService } from '../lib/dbService';
import { Device, Order, Batch } from '../types';

const data = [
  { name: 'Mon', sales: 4000 },
  { name: 'Tue', sales: 3000 },
  { name: 'Wed', sales: 2000 },
  { name: 'Thu', sales: 2780 },
  { name: 'Fri', sales: 1890 },
  { name: 'Sat', sales: 2390 },
  { name: 'Sun', sales: 3490 },
];

export default function Dashboard() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);

  useEffect(() => {
    const unsubDevices = dbService.subscribeToCollection('devices', setDevices);
    const unsubOrders = dbService.subscribeToCollection('orders', setOrders);
    const unsubBatches = dbService.subscribeToCollection('batches', setBatches);
    return () => {
      unsubDevices();
      unsubOrders();
      unsubBatches();
    };
  }, []);

  const totalInv = devices.length;
  const inStock = devices.filter(d => d.status === 'available').length;
  const soldCount = devices.filter(d => d.status === 'sold').length;
  const totalRevenue = orders.reduce((acc, o) => acc + o.totalAmount, 0);

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col gap-2">
        <h2 className="text-4xl font-bold tracking-tighter uppercase font-display">Logistics Hub</h2>
        <div className="h-px w-24 bg-white" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard 
          label="Total Inventory" 
          value={totalInv.toString()} 
          subValue={`${inStock} in stock`}
          icon={<Package size={20} />} 
          trend="+12%" 
          trendUp={true}
        />
        <StatCard 
          label="Total Revenue" 
          value={`$${totalRevenue.toLocaleString()}`} 
          subValue="Last 30 days"
          icon={<CircleDollarSign size={20} />} 
          trend="+8.2%" 
          trendUp={true}
        />
        <StatCard 
          label="Devices Sold" 
          value={soldCount.toString()} 
          subValue="Direct & Portals"
          icon={<Smartphone size={20} />} 
          trend="+24%" 
          trendUp={true}
        />
        <StatCard 
          label="Active Batches" 
          value={batches.filter(b => b.status !== 'completed').length.toString()} 
          subValue="Processing now"
          icon={<TrendingUp size={20} />} 
          trend="-2%" 
          trendUp={false}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-black border border-white/5 rounded-none p-8">
          <div className="flex items-center justify-between mb-10">
            <h3 className="font-bold uppercase tracking-widest text-[11px] text-gray-400">Yield Analysis</h3>
            <select className="bg-transparent border border-white/10 rounded-none text-[10px] font-mono uppercase px-3 py-1.5 outline-none hover:border-white/40 transition-colors">
              <option className="bg-black">T + 7 Days</option>
              <option className="bg-black">T + 30 Days</option>
            </select>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data}>
                <defs>
                  <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ffffff" stopOpacity={0.1}/>
                    <stop offset="95%" stopColor="#ffffff" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                <XAxis 
                  dataKey="name" 
                  stroke="#ffffff50" 
                  fontSize={10} 
                  tickLine={false} 
                  axisLine={false} 
                />
                <YAxis 
                  stroke="#ffffff50" 
                  fontSize={10} 
                  tickLine={false} 
                  axisLine={false} 
                  tickFormatter={(val) => `$${val}`}
                />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#1A1A1A', border: '1px solid #ffffff10', borderRadius: '8px' }}
                  itemStyle={{ color: '#fff' }}
                />
                <Area 
                  type="monotone" 
                  dataKey="sales" 
                  stroke="#ffffff" 
                  fillOpacity={1} 
                  fill="url(#colorSales)" 
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-black border border-white/5 rounded-none p-8">
          <h3 className="font-bold uppercase tracking-widest text-[11px] text-gray-400 mb-10">System Events</h3>
          <div className="space-y-8">
            {batches.slice(0, 5).map((batch, i) => (
              <ActivityItem 
                key={batch.id}
                title={`New Batch Recieved: ${batch.supplierRef || 'N/A'}`}
                time="2 hours ago"
                description={`${batch.itemCount} devices added to inventory`}
              />
            ))}
            {batches.length === 0 && (
              <div className="text-gray-500 text-sm text-center py-12">
                No recent activity recorded
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, subValue, icon, trend, trendUp }: any) {
  return (
    <div className="bg-black border border-white/5 rounded-none p-8 flex flex-col justify-between group hover:border-white/20 transition-all cursor-crosshair">
      <div className="flex items-center justify-between mb-6">
        <div className="p-3 bg-white/5 rounded-none text-gray-500 group-hover:text-white group-hover:bg-white/10 transition-all">
          {icon}
        </div>
        <div className={`flex items-center gap-1.5 text-[10px] font-mono font-bold ${trendUp ? 'text-white' : 'text-gray-500'}`}>
          {trendUp ? <ArrowUpRight size={14} strokeWidth={3} /> : <ArrowDownRight size={14} strokeWidth={3} />}
          {trend}
        </div>
      </div>
      <div>
        <p className="text-gray-600 text-[9px] uppercase tracking-[0.2em] font-mono mb-2">{label}</p>
        <div className="flex items-baseline gap-3">
          <h4 className="text-4xl font-bold tracking-tighter font-display">{value}</h4>
          <span className="text-[9px] text-gray-700 font-mono italic uppercase">{subValue}</span>
        </div>
      </div>
    </div>
  );
}

function ActivityItem({ title, time, description }: any) {
  return (
    <div className="flex gap-4 group cursor-pointer">
      <div className="w-1.5 h-1.5 mt-1.5 rounded-full bg-white flex-shrink-0 group-hover:scale-150 transition-transform" />
      <div className="flex-1 space-y-1">
        <p className="text-sm font-medium leading-none">{title}</p>
        <p className="text-xs text-gray-500">{description}</p>
        <p className="text-[10px] text-gray-600 font-mono uppercase">{time}</p>
      </div>
    </div>
  );
}
