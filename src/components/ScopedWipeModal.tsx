import React, { useMemo, useState } from 'react';
import { X, Trash2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { motion } from 'motion/react';
import { dbService } from '../lib/dbService';
import { useInventoryStore } from '../lib/inventoryStore';
import { buildWipePlan, WIPE_SCOPES, type WipeScopeId } from '../lib/wipeScopes';
import type { InventoryEvent } from '../types';

interface Props {
  scope: WipeScopeId;
  onClose: () => void;
}

/**
 * ScopedWipeModal — admin-only "wipe just this bucket" dialog.
 *
 * Unlike ResetDataModal (which clears every collection and forces a
 * reload), this writes through dbService so the cache and every live
 * subscriber update in place — the page the operator is standing on
 * empties without a refresh.
 */
export default function ScopedWipeModal({ scope, onClose }: Props) {
  const meta = WIPE_SCOPES[scope];
  const { units, aggregates, sales } = useInventoryStore();

  const [confirmed, setConfirmed] = useState(false);
  const [running,   setRunning]   = useState(false);
  const [done,      setDone]      = useState(false);
  const [log,       setLog]       = useState<string[]>([]);
  const [error,     setError]     = useState('');

  // Preview plan — built without events (they're only fetched at run
  // time), so the breakdown shows the buckets the operator can see.
  const preview = useMemo(
    () => buildWipePlan(scope, { units, aggregates, sales }),
    [scope, units, aggregates, sales],
  );

  const addLog = (msg: string) => setLog(prev => [...prev, msg]);

  const handleWipe = async () => {
    setRunning(true);
    setError('');
    try {
      // Events aren't in the store — pull them so unit deletes cascade.
      let events: InventoryEvent[] = [];
      if (scope !== 'returns') {
        try {
          events = await dbService.readAll('inventoryEvents') as InventoryEvent[];
        } catch {
          addLog('Could not read inventoryEvents — skipping event cleanup');
        }
      }

      const plan = buildWipePlan(scope, { units, aggregates, sales, events });
      if (plan.total === 0) {
        addLog('Nothing to clear — already empty.');
        setDone(true);
        return;
      }

      if (plan.deletes.length > 0) {
        addLog(`Deleting ${plan.deletes.length} document${plan.deletes.length === 1 ? '' : 's'}…`);
        const res = await dbService.bulkDelete(plan.deletes);
        addLog(`  ↳ deleted ${res.deleted}${res.failed ? ` · ${res.failed} failed` : ''}`);
        if (res.failed > 0) throw new Error(`${res.failed} deletes failed — check Firestore rules/connection`);
      }

      if (plan.patches.length > 0) {
        addLog(`Clearing flags on ${plan.patches.length} unit${plan.patches.length === 1 ? '' : 's'}…`);
        const res = await dbService.bulkUpdate(plan.patches);
        addLog(`  ↳ updated ${res.updated}${res.failed ? ` · ${res.failed} failed` : ''}`);
        if (res.failed > 0) throw new Error(`${res.failed} updates failed — check Firestore rules/connection`);
      }

      addLog(`${meta.title} complete.`);
      setDone(true);
    } catch (err: any) {
      setError(err?.message || 'Wipe failed — check Firestore connection');
      setRunning(false);
    }
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
        <div className="flex items-center justify-between px-5 py-4 border-b border-rose-100 bg-rose-50">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-rose-600 text-white rounded-xl flex items-center justify-center">
              <Trash2 size={15} />
            </div>
            <div>
              <p className="text-sm font-bold text-rose-900">{meta.title}</p>
              <p className="text-[9px] text-rose-500 font-mono uppercase tracking-widest">Danger zone · scoped</p>
            </div>
          </div>
          {!running && (
            <button onClick={onClose} className="p-2 hover:bg-rose-100 rounded-xl text-rose-400 transition-all">
              <X size={15} />
            </button>
          )}
        </div>

        <div className="p-5 space-y-4">
          {!done ? (
            <>
              <div className="flex items-start gap-3 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">
                <AlertTriangle size={16} className="text-rose-500 mt-0.5 flex-shrink-0" />
                <div className="space-y-1">
                  <p className="text-xs font-bold text-rose-900">{meta.summary}</p>
                  <p className="text-[9px] text-rose-700 font-mono leading-relaxed">
                    {meta.keeps}
                    <br /><strong>This cannot be undone.</strong>
                  </p>
                </div>
              </div>

              <div>
                <p className="text-[8px] font-bold uppercase tracking-widest text-gray-400 mb-2">What will be cleared</p>
                <div className="space-y-1">
                  {preview.breakdown.map(b => (
                    <div key={b.label} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-1.5">
                      <span className="text-[10px] font-mono text-gray-600">{b.label}</span>
                      <span className={`text-[10px] font-bold font-mono ${b.count > 0 ? 'text-rose-600' : 'text-gray-300'}`}>
                        {b.count}
                      </span>
                    </div>
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
                <div className="bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">
                  <p className="text-[10px] text-rose-600 font-mono">{error}</p>
                </div>
              )}

              {!running && (
                // Whole row is the tap target. The onClick used to sit on the
                // 20px box alone, so tapping the label — the obvious target,
                // and the only one big enough on a phone — did nothing and the
                // confirm button stayed stubbornly disabled.
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={confirmed}
                  onClick={() => setConfirmed(c => !c)}
                  className="w-full flex items-center gap-3 cursor-pointer select-none text-left py-1"
                >
                  <span
                    className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all flex-shrink-0 ${
                      confirmed ? 'bg-rose-600 border-rose-600' : 'border-gray-300 bg-white'
                    }`}
                  >
                    {confirmed && <CheckCircle2 size={12} className="text-white" />}
                  </span>
                  <span className="text-xs text-gray-700 font-medium">{meta.confirmLabel}</span>
                </button>
              )}

              <div className="flex gap-3">
                {!running && (
                  <button onClick={onClose}
                    className="flex-1 py-2.5 border border-gray-200 rounded-xl text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:bg-gray-50 transition-all">
                    Cancel
                  </button>
                )}
                <button
                  onClick={handleWipe}
                  disabled={!confirmed || running || preview.total === 0}
                  className="flex-1 py-2.5 bg-rose-600 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-rose-700 transition-all disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  {running
                    ? <><div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Clearing…</>
                    : <><Trash2 size={12} /> {preview.total === 0 ? 'Nothing to clear' : meta.buttonLabel}</>
                  }
                </button>
              </div>
            </>
          ) : (
            <div className="py-4 space-y-4 text-center">
              <CheckCircle2 className="mx-auto text-emerald-600" size={40} />
              <div>
                <p className="text-sm font-bold">{meta.title} done</p>
                <p className="text-xs text-gray-500 mt-1 font-mono">The page below is already up to date.</p>
              </div>
              {log.length > 0 && (
                <div className="bg-gray-50 rounded-xl p-3 max-h-32 overflow-y-auto text-left">
                  {log.map((l, i) => (
                    <p key={i} className="text-[9px] font-mono text-gray-600">{l}</p>
                  ))}
                </div>
              )}
              <button
                onClick={onClose}
                className="w-full py-3 bg-black text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-gray-800 transition-all"
              >
                Close
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
