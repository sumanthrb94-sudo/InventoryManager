import React, { useState } from 'react';
import { CheckCircle2, AlertCircle, Database, Clock } from 'lucide-react';
import { dbService, toCamel } from '../lib/dbService';
import seedData from '../lib/clientSeedData.json';

const rawUnits     = seedData.units as any[];
const rawSuppliers = seedData.suppliers as any[];

// Convert snake_case keys to camelCase for Firestore
function toAppObj(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [toCamel(k), v])
  );
}

const appUnits     = rawUnits.map(toAppObj);
const appSuppliers = rawSuppliers.map(toAppObj);

const available = appUnits.filter((u: any) => u.status === 'available').length;
const incoming  = appUnits.filter((u: any) => u.status === 'incoming').length;
const sold      = appUnits.filter((u: any) => u.status === 'sold').length;

export default function DataSeedPage() {
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [log,    setLog]    = useState<string[]>([]);
  const [error,  setError]  = useState('');

  const addLog = (msg: string) => setLog(prev => [...prev, msg]);

  const handleSeed = async () => {
    setStatus('running');
    setLog([]);
    setError('');
    try {
      const entries: Array<{ collection: string; id: string; data: any }> = [
        ...appSuppliers.map((s: any) => ({
          collection: 'suppliers',
          id: s.id,
          data: s,
        })),
        ...appUnits.map((u: any) => ({
          collection: 'inventoryUnits',
          id: u.id || u.imei || `unit_${Math.random().toString(36).slice(2)}`,
          data: u,
        })),
      ];

      addLog(`Seeding ${appSuppliers.length} suppliers + ${appUnits.length} units into Firestore…`);

      await dbService.bulkCreate(entries, (done, total) => {
        if (done % 20 === 0 || done === total) {
          addLog(`Inserted ${done} / ${total}…`);
        }
      });

      addLog(`✓ Done! ${available} available · ${incoming} SHS · ${sold} sold`);
      setStatus('done');
    } catch (err: any) {
      setError(err.message);
      setStatus('error');
    }
  };

  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-black text-white rounded-xl flex items-center justify-center">
            <Database size={18} />
          </div>
          <div>
            <h1 className="text-lg font-bold uppercase tracking-tight">Reload Client Data</h1>
            <p className="text-[10px] text-gray-400 font-mono">
              {appUnits.length} units · {appSuppliers.length} suppliers
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 text-center">
            <p className="text-xl font-bold text-emerald-700">{available}</p>
            <p className="text-[8px] text-emerald-500 font-mono uppercase tracking-widest">Available</p>
          </div>
          <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-center">
            <p className="text-xl font-bold text-amber-700">{incoming}</p>
            <p className="text-[8px] text-amber-500 font-mono uppercase tracking-widest flex items-center justify-center gap-1">
              <Clock size={9} /> SHS
            </p>
          </div>
          <div className="bg-gray-50 border border-gray-100 rounded-xl p-3 text-center">
            <p className="text-xl font-bold text-gray-600">{sold}</p>
            <p className="text-[8px] text-gray-400 font-mono uppercase tracking-widest">Sold</p>
          </div>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-800 font-mono">
          ⚠ This will overwrite matching Firestore documents with the latest client dataset.
          Use Reset Data first to start from a clean slate.
        </div>

        {log.length > 0 && (
          <div className="bg-gray-50 rounded-xl p-4 space-y-1 max-h-48 overflow-y-auto">
            {log.map((l, i) => (
              <p key={i} className="text-[10px] font-mono text-gray-600">{l}</p>
            ))}
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            <AlertCircle size={14} className="text-red-500 mt-0.5 flex-shrink-0" />
            <p className="text-[10px] font-mono text-red-700">{error}</p>
          </div>
        )}

        {status === 'done' ? (
          <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
            <CheckCircle2 size={16} className="text-emerald-600" />
            <p className="text-xs font-bold text-emerald-700">
              {appUnits.length} units loaded — tap Reload to see them.
            </p>
          </div>
        ) : (
          <button
            onClick={handleSeed}
            disabled={status === 'running'}
            className="w-full py-4 bg-black text-white rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-gray-800 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {status === 'running'
              ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Loading…</>
              : `Load ${appUnits.length} Units into Firestore`}
          </button>
        )}

        {status === 'done' && (
          <button
            onClick={() => { window.location.href = '/'; }}
            className="w-full py-3 border border-gray-200 rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-gray-50 transition-all"
          >
            Go to App →
          </button>
        )}
      </div>
    </div>
  );
}
