import React, { useState } from 'react';
import { X, Database, Sparkles, CheckCircle2, RefreshCw, Loader2, Download } from 'lucide-react';
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
  const [stage, setStage] = useState<'idle' | 'clearing' | 'loading'>('idle');

  const addLog = (msg: string) => setLog(prev => [...prev, msg]);

  const handleLoadMockData = async () => {
    setRunning(true);
    setError('');
    try {
      setStage('clearing');
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

      addLog(`✓ Done · ${available} available · ${incoming} SHS · ${sold} sold`);
      setDone(true);
    } catch (err: any) {
      setError(err?.message || 'Failed to load mock data');
      setRunning(false);
    }
  };

  const handleReload = () => {
    window.location.href = window.location.origin + '?t=' + Date.now();
  };

  const handleDownloadMockData = () => {
    // Create download object with the seed data
    const downloadData = {
      metadata: {
        generatedAt: new Date().toISOString(),
        totalUnits: appUnits.length,
        totalSuppliers: appSuppliers.length,
        description: 'Sample inventory data for testing and evaluation',
      },
      units: appUnits,
      suppliers: appSuppliers,
    };

    // Create JSON file
    const jsonString = JSON.stringify(downloadData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    // Trigger download
    const link = document.createElement('a');
    link.href = url;
    link.download = `mock-data-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();

    // Cleanup
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-slate-900/30 backdrop-blur-md"
      onClick={!running ? onClose : undefined}
    >
      <motion.div
        initial={{ scale: 0.96, opacity: 0, y: 8 }} animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.96, opacity: 0, y: 8 }}
        transition={{ type: 'spring', stiffness: 280, damping: 26 }}
        onClick={e => e.stopPropagation()}
        className="bg-white w-full max-w-md rounded-2xl shadow-xl shadow-slate-900/10 ring-1 ring-slate-200/70 overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-slate-50 ring-1 ring-slate-200/80 rounded-xl flex items-center justify-center text-slate-500">
              <Database size={16} strokeWidth={1.75} />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-800 tracking-tight">Load Sample Data</p>
              <p className="text-[10px] text-slate-400 mt-0.5 tracking-wide">Replaces existing inventory</p>
            </div>
          </div>
          {!running && (
            <button onClick={onClose}
              className="p-1.5 rounded-lg text-slate-300 hover:text-slate-600 hover:bg-slate-50 transition-all">
              <X size={16} strokeWidth={1.75} />
            </button>
          )}
        </div>

        <div className="border-t border-slate-100" />

        <div className="px-6 py-5 space-y-5">
          {!done ? (
            <>
              {/* Stat cards — soft, equal-weight */}
              <div className="grid grid-cols-3 gap-2">
                <Stat label="Units" value={appUnits.length} tone="primary" />
                <Stat label="Suppliers" value={appSuppliers.length} tone="muted" />
                <Stat label="Available" value={available} tone="muted" />
              </div>

              {/* Inline note */}
              <div className="flex items-start gap-2.5 text-[11px] text-slate-500 leading-relaxed">
                <Sparkles size={13} className="text-slate-400 mt-0.5 flex-shrink-0" strokeWidth={1.75} />
                <p>
                  Wipes all current inventory, suppliers, events and listings, then inserts a curated
                  sample dataset. Use this to evaluate the app or reset to a clean state.
                </p>
              </div>

              {/* Activity log */}
              {log.length > 0 && (
                <div className="bg-slate-50 rounded-xl px-3.5 py-3 max-h-36 overflow-y-auto custom-scrollbar space-y-0.5 ring-1 ring-slate-100">
                  {log.map((l, i) => (
                    <p key={i} className="text-[10px] font-mono text-slate-500 leading-relaxed">{l}</p>
                  ))}
                </div>
              )}

              {error && (
                <div className="bg-rose-50/70 ring-1 ring-rose-100 rounded-xl px-3.5 py-2.5">
                  <p className="text-[11px] text-rose-600 font-medium">{error}</p>
                </div>
              )}

              {/* Confirmation */}
              {!running && (
                <button
                  onClick={() => setConfirmed(c => !c)}
                  className="w-full flex items-center gap-2.5 group select-none text-left"
                >
                  <div className={`w-4 h-4 rounded-md border flex items-center justify-center transition-all flex-shrink-0 ${
                    confirmed
                      ? 'bg-slate-800 border-slate-800'
                      : 'border-slate-300 bg-white group-hover:border-slate-400'
                  }`}>
                    {confirmed && <CheckCircle2 size={10} className="text-white" strokeWidth={2.5} />}
                  </div>
                  <span className="text-[11px] text-slate-600 leading-relaxed">
                    I understand current data will be deleted
                  </span>
                </button>
              )}

              {/* Actions */}
              <div className="flex gap-2 pt-1">
                {!running && (
                  <>
                    <button
                      onClick={onClose}
                      className="flex-1 py-2.5 text-[11px] font-medium text-slate-500 hover:text-slate-800 hover:bg-slate-50 rounded-xl transition-all"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleDownloadMockData}
                      title="Download mock data as JSON file"
                      className="py-2.5 px-3 bg-slate-100 text-slate-600 rounded-xl text-[11px] font-medium hover:bg-slate-200 hover:text-slate-800 transition-all flex items-center justify-center gap-2"
                    >
                      <Download size={13} strokeWidth={2} />
                      <span className="hidden sm:inline">Download</span>
                    </button>
                  </>
                )}
                <button
                  onClick={handleLoadMockData}
                  disabled={!confirmed || running}
                  className="flex-1 py-2.5 bg-slate-800 text-white rounded-xl text-[11px] font-medium hover:bg-slate-900 transition-all disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {running
                    ? <>
                        <Loader2 size={13} className="animate-spin" strokeWidth={2} />
                        <span>{stage === 'clearing' ? 'Clearing data' : 'Loading sample'}</span>
                      </>
                    : <>
                        <span>Load sample</span>
                      </>
                  }
                </button>
              </div>
            </>
          ) : (
            <div className="py-3 space-y-5 text-center">
              <div className="mx-auto w-12 h-12 bg-emerald-50 ring-1 ring-emerald-100 rounded-2xl flex items-center justify-center">
                <CheckCircle2 className="text-emerald-500" size={22} strokeWidth={1.75} />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-800 tracking-tight">Sample data ready</p>
                <p className="text-[11px] text-slate-400 mt-1">
                  {appUnits.length} units · {appSuppliers.length} suppliers
                </p>
              </div>

              {/* Inline final summary */}
              <div className="grid grid-cols-3 gap-2">
                <SummaryPill label="Available" value={available} />
                <SummaryPill label="SHS" value={incoming} />
                <SummaryPill label="Sold" value={sold} />
              </div>

              <button
                onClick={handleReload}
                className="w-full py-2.5 bg-slate-800 text-white rounded-xl text-[11px] font-medium hover:bg-slate-900 transition-all flex items-center justify-center gap-2"
              >
                <RefreshCw size={12} strokeWidth={2} /> Reload app
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Stat({ label, value, tone }: { label: string; value: number; tone: 'primary' | 'muted' }) {
  const isPrimary = tone === 'primary';
  return (
    <div className={`rounded-xl px-3 py-2.5 ${
      isPrimary
        ? 'bg-slate-800 text-white'
        : 'bg-slate-50 ring-1 ring-slate-100 text-slate-700'
    }`}>
      <p className={`text-lg font-semibold tracking-tight ${isPrimary ? '' : 'text-slate-800'}`}>
        {value}
      </p>
      <p className={`text-[9px] mt-0.5 tracking-wider uppercase ${
        isPrimary ? 'text-slate-300' : 'text-slate-400'
      }`}>
        {label}
      </p>
    </div>
  );
}

function SummaryPill({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-slate-50 ring-1 ring-slate-100 rounded-xl px-2 py-2">
      <p className="text-base font-semibold text-slate-700">{value}</p>
      <p className="text-[9px] text-slate-400 mt-0.5 tracking-wider uppercase">{label}</p>
    </div>
  );
}
