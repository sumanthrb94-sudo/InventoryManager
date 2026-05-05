import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { CheckCircle2, AlertCircle, Database } from 'lucide-react';
import seedData from '../lib/clientSeedData.json';

export default function DataSeedPage() {
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [log, setLog]       = useState<string[]>([]);
  const [error, setError]   = useState('');

  const addLog = (msg: string) => setLog(prev => [...prev, msg]);

  const handleSeed = async () => {
    setStatus('running');
    setLog([]);
    setError('');
    try {
      // 1. Wipe existing data
      addLog('Clearing existing inventory units…');
      const { error: delErr } = await supabase.from('inventory_units').delete().neq('id', '__none__');
      if (delErr) throw new Error('Clear units: ' + delErr.message);

      addLog('Clearing existing suppliers…');
      const { error: delSupErr } = await supabase.from('suppliers').delete().neq('id', '__none__');
      if (delSupErr) throw new Error('Clear suppliers: ' + delSupErr.message);

      // 2. Insert suppliers
      addLog(`Inserting ${seedData.suppliers.length} suppliers…`);
      const { error: supErr } = await supabase.from('suppliers').upsert(
        seedData.suppliers.map((s: any) => ({ ...s, created_at: new Date().toISOString() }))
      );
      if (supErr) throw new Error('Suppliers: ' + supErr.message);

      // 3. Insert units in chunks of 50
      const CHUNK = 50;
      const units = seedData.units as any[];
      let done = 0;
      for (let i = 0; i < units.length; i += CHUNK) {
        const chunk = units.slice(i, i + CHUNK);
        const { error: uErr } = await supabase.from('inventory_units').insert(chunk);
        if (uErr) throw new Error(`Units chunk ${i}: ${uErr.message}`);
        done += chunk.length;
        addLog(`Inserted ${done} / ${units.length} units…`);
      }

      addLog('✓ Done! Reload the app to see your data.');
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
            <h1 className="text-lg font-bold uppercase tracking-tight">Load Client Data</h1>
            <p className="text-[10px] text-gray-400 font-mono">
              {(seedData.units as any[]).length} units · {seedData.suppliers.length} suppliers
            </p>
          </div>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-800 font-mono">
          ⚠ This will DELETE all existing inventory data and replace it with the client dataset. Cannot be undone.
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
            <p className="text-xs font-bold text-emerald-700">Data loaded successfully. Reload the app.</p>
          </div>
        ) : (
          <button
            onClick={handleSeed}
            disabled={status === 'running'}
            className="w-full py-4 bg-black text-white rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-gray-800 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {status === 'running'
              ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Loading…</>
              : 'Load Client Data into Supabase'}
          </button>
        )}

        {status === 'done' && (
          <button
            onClick={() => window.location.reload()}
            className="w-full py-3 border border-gray-200 rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-gray-50 transition-all"
          >
            Reload App
          </button>
        )}
      </div>
    </div>
  );
}
