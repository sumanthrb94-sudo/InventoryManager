import React, { useState } from 'react';
import { X, Database, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { motion } from 'motion/react';
import { collection, getDocs, writeBatch } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { dbService, toCamel } from '../lib/dbService';
import seedData from '../lib/clientSeedData.json';

interface Props { onClose: () => void; }

const COLLECTIONS = [
  'inventoryUnits',
  'suppliers',
  'inventoryEvents',
  'activeListings',
  'dailyUpdates',
  'sourceDocuments',
];

const rawUnits = seedData.units as any[];
const rawSuppliers = seedData.suppliers as any[];

function toAppObj(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [toCamel(k), v])
  );
}

const appUnits = rawUnits.map(toAppObj);
const appSuppliers = rawSuppliers.map(toAppObj);

const available = appUnits.filter((u: any) => u.status === 'available').length;
const incoming = appUnits.filter((u: any) => u.status === 'incoming').length;
const sold = appUnits.filter((u: any) => u.status === 'sold').length;

export default function LoadMockDataModal({ onClose }: Props) {
  const [confirmed, setConfirmed] = useState(false);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [stage, setStage] = useState<'clear' | 'loading'>('clear');

  const addLog = (msg: string) => setLog(prev => [...prev, msg]);

  const handleLoadMockData = async () => {
    setRunning(true);
    setError('');
    try {
      // Stage 1: Clear all collections
      setStage('clear');
      for (const col of COLLECTIONS) {
        addLog(`Clearing ${col}…`);
        const snap = await getDocs(collection(db, col));
        if (snap.empty) {
          addLog(`  ↳ already empty`);
          continue;
        }
        const BATCH_SIZE = 400;
        let batch = writeBatch(db);
        let count = 0;
        for (const docSnap of snap.docs) {
          batch.delete(docSnap.ref);
          count++;
          if (count % BATCH_SIZE === 0) {
            await batch.commit();
            batch = writeBatch(db);
          }
        }
        if (count % BATCH_SIZE !== 0) await batch.commit();
        addLog(`  ↳ deleted ${snap.size} documents`);
      }
      addLog('All collections cleared.');

      // Stage 2: Load mock data
      setStage('loading');
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

      addLog(`\nSeeding ${appSuppliers.length} suppliers + ${appUnits.length} units…`);

      await dbService.bulkCreate(entries, (done, total) => {
        if (done % 20 === 0 || done === total) {
          addLog(`Inserted ${done} / ${total}…`);
        }
      });

      addLog(`✓ Done! ${available} available · ${incoming} SHS · ${sold} sold`);
      setDone(true);
    } catch (err: any) {
      setError(err?.message || 'Failed to load mock data');
      setRunning(false);
    }
  };

  const handleReload = () => {
    window.location.href = window.location.origin + '?t=' + Date.now();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={!running ? onClose : undefined}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-blue-100 bg-blue-50">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-600 text-white rounded-xl flex items-center justify-center">
              <Database size={15} />
            </div>
            <div>
              <p className="text-sm font-bold text-blue-900">Load Mock Data</p>
              <p className="text-[9px] text-blue-500 font-mono uppercase tracking-widest">Test Environment</p>
            </div>
          </div>
          {!running && (
            <button onClick={onClose} className="p-2 hover:bg-blue-100 rounded-xl text-blue-400 transition-all">
              <X size={15} />
            </button>
          )}
        </div>

        <div className="p-5 space-y-4">
          {!done ? (
            <>
              <div className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
                <AlertTriangle size={16} className="text-blue-500 mt-0.5 flex-shrink-0" />
                <div className="space-y-1">
                  <p className="text-xs font-bold text-blue-900">Load {appUnits.length} test units</p>
                  <p className="text-[9px] text-blue-700 font-mono leading-relaxed">
                    This will clear all current data and load sample inventory for testing.
                    <br /><strong>Your current data will be permanently deleted.</strong>
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-2 text-center">
                  <p className="text-lg font-bold text-emerald-700">{available}</p>
                  <p className="text-[8px] text-emerald-500 font-mono uppercase">Available</p>
                </div>
                <div className="bg-amber-50 border border-amber-100 rounded-lg p-2 text-center">
                  <p className="text-lg font-bold text-amber-700">{incoming}</p>
                  <p className="text-[8px] text-amber-500 font-mono uppercase">SHS</p>
                </div>
                <div className="bg-gray-50 border border-gray-100 rounded-lg p-2 text-center">
                  <p className="text-lg font-bold text-gray-600">{sold}</p>
                  <p className="text-[8px] text-gray-400 font-mono uppercase">Sold</p>
                </div>
              </div>

              {log.length > 0 && (
                <div className="bg-gray-50 rounded-xl p-3 max-h-40 overflow-y-auto space-y-0.5">
                  {log.map((l, i) => (
                    <p key={i} className="text-[9px] font-mono text-gray-600">{l}</p>
                  ))}
                </div>
              )}

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                  <p className="text-[10px] text-red-600 font-mono">{error}</p>
                </div>
              )}

              {!running && (
                <label className="flex items-center gap-3 cursor-pointer select-none">
                  <div
                    onClick={() => setConfirmed(c => !c)}
                    className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all flex-shrink-0 ${
                      confirmed ? 'bg-blue-600 border-blue-600' : 'border-gray-300 bg-white'
                    }`}
                  >
                    {confirmed && <CheckCircle2 size={12} className="text-white" />}
                  </div>
                  <span className="text-xs text-gray-700 font-medium">
                    I understand this will delete all current inventory data
                  </span>
                </label>
              )}

              <div className="flex gap-3">
                {!running && (
                  <button onClick={onClose}
                    className="flex-1 py-2.5 border border-gray-200 rounded-xl text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:bg-gray-50 transition-all">
                    Cancel
                  </button>
                )}
                <button
                  onClick={handleLoadMockData}
                  disabled={!confirmed || running}
                  className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-blue-700 transition-all disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  {running
                    ? <><div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> {stage === 'clear' ? 'Clearing…' : 'Loading…'}</>
                    : <><Database size={12} /> Load Mock Data</>
                  }
                </button>
              </div>
            </>
          ) : (
            <div className="py-4 space-y-4 text-center">
              <CheckCircle2 className="mx-auto text-emerald-600" size={40} />
              <div>
                <p className="text-sm font-bold">Mock data loaded!</p>
                <p className="text-xs text-gray-500 mt-1 font-mono">
                  {appUnits.length} units · {appSuppliers.length} suppliers
                </p>
              </div>
              {log.length > 0 && (
                <div className="bg-gray-50 rounded-xl p-3 max-h-32 overflow-y-auto text-left">
                  {log.map((l, i) => (
                    <p key={i} className="text-[9px] font-mono text-gray-600">{l}</p>
                  ))}
                </div>
              )}
              <button
                onClick={handleReload}
                className="w-full py-3 bg-black text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-gray-800 transition-all flex items-center justify-center gap-2"
              >
                <RefreshCw size={13} /> Reload App
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
