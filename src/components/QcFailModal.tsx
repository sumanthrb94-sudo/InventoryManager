import React, { useState } from 'react';
import { X, Truck, Box, AlertTriangle, Clock } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { dbService } from '../lib/dbService';
import { deleteOfficeUnit } from '../services/inventoryService';
import { isAdmin } from '../lib/firebase';
import { auth } from '../lib/firebase';
import type { InventoryUnit } from '../types';

interface Props {
  unit: InventoryUnit;
  onClose: () => void;
  onSuccess: () => void;
}

export default function QcFailModal({ unit, onClose, onSuccess }: Props) {
  const [loading, setLoading] = useState<'fba' | 'rts' | null>(null);
  const [error, setError] = useState('');

  const userIsAdmin = isAdmin(auth.currentUser);

  const handleFba = async () => {
    if (!userIsAdmin) {
      setError('Admin access required.');
      return;
    }
    setLoading('fba');
    setError('');
    try {
      const reason = 'QC Fail - FBA (Fulfilled by Amazon)';
      const res = await deleteOfficeUnit(unit, reason);
      if (!res.ok) {
        setError(res.message || 'FBA failed');
        return;
      }
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'FBA failed');
    } finally {
      setLoading(null);
    }
  };

  const handleRts = async () => {
    if (!userIsAdmin) {
      setError('Admin access required.');
      return;
    }
    setLoading('rts');
    setError('');
    try {
      const reason = 'QC Fail - RTS (Return to Supplier)';
      const res = await deleteOfficeUnit(unit, reason);
      if (!res.ok) {
        setError(res.message || 'RTS failed');
        return;
      }
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'RTS failed');
    } finally {
      setLoading(null);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        onClick={e => e.stopPropagation()}
        className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-100 text-amber-600 rounded-xl flex items-center justify-center">
              <AlertTriangle size={18} />
            </div>
            <div>
              <p className="text-sm font-bold">QC Fail · {unit.model}</p>
              <p className="text-[9px] text-slate-400 font-mono">{unit.imei} · £{unit.buyPrice} BP</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-xl text-slate-400">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-sm text-slate-600">
            This unit failed QC. Choose how to handle it:
          </p>

          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={handleFba}
              disabled={loading !== null}
              className={`flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all ${
                loading === 'fba'
                  ? 'bg-blue-50 border-blue-300'
                  : 'bg-white border-slate-200 hover:border-blue-300 hover:bg-blue-50'
              }`}
            >
              <Box size={24} className="text-blue-600" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-700">FBA</span>
              <span className="text-[9px] text-slate-400 font-mono">Fulfilled by Amazon</span>
              {loading === 'fba' && (
                <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              )}
            </button>

            <button
              onClick={handleRts}
              disabled={loading !== null}
              className={`flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all ${
                loading === 'rts'
                  ? 'bg-amber-50 border-amber-300'
                  : 'bg-white border-slate-200 hover:border-amber-300 hover:bg-amber-50'
              }`}
            >
              <Truck size={24} className="text-amber-600" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-700">RTS</span>
              <span className="text-[9px] text-slate-400 font-mono">Return to Supplier</span>
              {loading === 'rts' && (
                <div className="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
              )}
            </button>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
            <div className="flex items-center gap-2 text-[9px] font-mono text-amber-700">
              <Clock size={11} />
              <span>RTS items appear on Stock Intake for 72 hours</span>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-2">
              <p className="text-[10px] text-red-600 font-mono">{error}</p>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}