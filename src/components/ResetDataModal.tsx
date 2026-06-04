import React, { useState } from 'react';
import { X, Trash2, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { motion } from 'motion/react';
import { collection, getDocs, writeBatch } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { dbService, ALL_COLLECTION_NAMES } from '../lib/dbService';
import { notificationService } from '../lib/notificationService';

interface Props { onClose: () => void; }

// Drive the wipe from the canonical collection list in dbService so it can
// never drift and leave stale data behind (returnEvents / batches / auditLog
// were previously missing here — return-cycle history survived a "Wipe DB").
const COLLECTIONS = ALL_COLLECTION_NAMES;

export default function ResetDataModal({ onClose }: Props) {
  const [confirmed, setConfirmed] = useState(false);
  const [running,   setRunning]   = useState(false);
  const [done,      setDone]      = useState(false);
  const [log,       setLog]       = useState<string[]>([]);
  const [error,     setError]     = useState('');

  const addLog = (msg: string) => setLog(prev => [...prev, msg]);

  const handleReset = async () => {
    setRunning(true);
    setError('');
    try {
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
      // Drop the in-memory caches too — the deletes above went straight to
      // Firestore, so without this the live `units` cache stays populated and
      // the Add Stock duplicate-IMEI check keeps flagging a now-empty DB.
      dbService.clearLocalCache();
      notificationService.clearAll();
      setDone(true);
    } catch (err: any) {
      setError(err?.message || 'Reset failed — check Firestore connection');
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
        className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-red-100 bg-red-50">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-red-600 text-white rounded-xl flex items-center justify-center">
              <Trash2 size={15} />
            </div>
            <div>
              <p className="text-sm font-bold text-red-900">Reset Inventory Data</p>
              <p className="text-[9px] text-red-500 font-mono uppercase tracking-widest">Danger zone</p>
            </div>
          </div>
          {!running && (
            <button onClick={onClose} className="p-2 hover:bg-red-100 rounded-xl text-red-400 transition-all">
              <X size={15} />
            </button>
          )}
        </div>

        <div className="p-5 space-y-4">
          {!done ? (
            <>
              <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                <AlertTriangle size={16} className="text-red-500 mt-0.5 flex-shrink-0" />
                <div className="space-y-1">
                  <p className="text-xs font-bold text-red-900">This will permanently delete all data</p>
                  <p className="text-[9px] text-red-700 font-mono leading-relaxed">
                    All inventory units, suppliers, events, and listings will be removed from Firestore.
                    Use this to load a fresh Excel sample for testing.
                    <br /><strong>This cannot be undone.</strong>
                  </p>
                </div>
              </div>

              <div>
                <p className="text-[8px] font-bold uppercase tracking-widest text-gray-400 mb-2">Collections to clear</p>
                <div className="flex flex-wrap gap-1.5">
                  {COLLECTIONS.map(c => (
                    <span key={c} className="text-[9px] font-mono bg-gray-100 text-gray-600 px-2 py-0.5 rounded-lg">{c}</span>
                  ))}
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
                      confirmed ? 'bg-red-600 border-red-600' : 'border-gray-300 bg-white'
                    }`}
                  >
                    {confirmed && <CheckCircle2 size={12} className="text-white" />}
                  </div>
                  <span className="text-xs text-gray-700 font-medium">
                    I understand this will delete all inventory data
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
                  onClick={handleReset}
                  disabled={!confirmed || running}
                  className="flex-1 py-2.5 bg-red-600 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-red-700 transition-all disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  {running
                    ? <><div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Clearing…</>
                    : <><Trash2 size={12} /> Delete All Data</>
                  }
                </button>
              </div>
            </>
          ) : (
            <div className="py-4 space-y-4 text-center">
              <CheckCircle2 className="mx-auto text-emerald-600" size={40} />
              <div>
                <p className="text-sm font-bold">All data cleared</p>
                <p className="text-xs text-gray-500 mt-1 font-mono">
                  Reload the app then import your Excel file.
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
