import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Truck, ShoppingBag, CheckCircle2, Undo2, PackageCheck,
  Wrench, RotateCcw, RefreshCw, Banknote, FileText, History,
} from 'lucide-react';
import type { InventoryUnit, ReturnEvent, Sale } from '../types';
import { dbService } from '../lib/dbService';
import {
  buildUnitHistory, normalizeImei, type UnitHistoryKind,
} from '../lib/returnsLifecycle';

/**
 * UnitHistoryTimeline — the single, reusable "story of a unit" template.
 *
 * Renders one chronological timeline woven from the unit doc (intake / listing),
 * its sales (active + voided), and its return lifecycle events (returned →
 * restocked → sent_to_supplier → sent_to_repair → repair_complete →
 * received_again …), each with its date, comment and actor.
 *
 * Self-contained: pass `events` / `sales` if the caller already has them
 * (Returns Report), or omit them and the component subscribes to the
 * `returnEvents` / `sales` collections itself (unit detail drawer).
 */

const KIND_ICON: Record<UnitHistoryKind, ReactNode> = {
  intake:           <Truck size={12} />,
  listed:           <ShoppingBag size={12} />,
  sold:             <CheckCircle2 size={12} />,
  returned:         <Undo2 size={12} />,
  restocked:        <PackageCheck size={12} />,
  sent_to_supplier: <Truck size={12} />,
  sent_to_repair:   <Wrench size={12} />,
  repair_complete:  <PackageCheck size={12} />,
  received_again:   <RefreshCw size={12} />,
  refunded:         <Banknote size={12} />,
  note:             <FileText size={12} />,
};

const KIND_TONE: Record<UnitHistoryKind, string> = {
  intake:           'bg-slate-100 text-slate-600 border-slate-200',
  listed:           'bg-indigo-100 text-indigo-700 border-indigo-200',
  sold:             'bg-slate-900 text-white border-slate-900',
  returned:         'bg-rose-100 text-rose-700 border-rose-200',
  restocked:        'bg-emerald-100 text-emerald-700 border-emerald-200',
  sent_to_supplier: 'bg-amber-100 text-amber-700 border-amber-200',
  sent_to_repair:   'bg-sky-100 text-sky-700 border-sky-200',
  repair_complete:  'bg-emerald-100 text-emerald-700 border-emerald-200',
  received_again:   'bg-orange-100 text-orange-700 border-orange-200',
  refunded:         'bg-violet-100 text-violet-700 border-violet-200',
  note:             'bg-slate-100 text-slate-500 border-slate-200',
};

interface Props {
  /** The unit doc; may be null when it was soft-deleted to supplier. */
  unit?: InventoryUnit | null;
  /** IMEI to scope by — defaults to `unit.imei`. Required when `unit` is null. */
  imei?: string;
  /** Pre-loaded sales; if omitted the component subscribes to the collection. */
  sales?: Sale[];
  /** Pre-loaded return events; if omitted the component subscribes. */
  events?: ReturnEvent[];
  /** Optional heading shown above the timeline. */
  title?: string;
  className?: string;
}

export default function UnitHistoryTimeline({
  unit, imei, sales, events, title = 'Unit History', className = '',
}: Props) {
  const key = normalizeImei(imei ?? unit?.imei);

  const [subEvents, setSubEvents] = useState<ReturnEvent[]>([]);
  const [subSales, setSubSales]   = useState<Sale[]>([]);
  const needEventsSub = events == null;
  const needSalesSub  = sales == null;

  useEffect(() => {
    if (!needEventsSub) return;
    const unsub = dbService.subscribeToCollection('returnEvents', (rows: any[]) =>
      setSubEvents(rows as ReturnEvent[]));
    return () => unsub();
  }, [needEventsSub]);

  useEffect(() => {
    if (!needSalesSub) return;
    const unsub = dbService.subscribeToCollection('sales', (rows: any[]) =>
      setSubSales(rows as Sale[]));
    return () => unsub();
  }, [needSalesSub]);

  const allEvents = events ?? subEvents;
  const allSales  = sales ?? subSales;

  const steps = useMemo(() => {
    const myEvents = allEvents.filter(e => normalizeImei(e.imei) === key);
    const mySales = allSales.filter(s =>
      (s.imei ? normalizeImei(s.imei) === key : false) ||
      (unit ? s.unitId === unit.id : false),
    );
    return buildUnitHistory(unit ?? null, myEvents, mySales);
  }, [allEvents, allSales, key, unit]);

  return (
    <div className={className}>
      {title && (
        <div className="flex items-center gap-1.5 mb-3">
          <History size={13} className="text-slate-400" />
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{title}</p>
        </div>
      )}
      {steps.length === 0 ? (
        <p className="text-[10px] font-mono text-slate-400 py-4 text-center">No history recorded yet.</p>
      ) : (
        <>
          {/* Current state — the unit's LATEST cycle, pinned up top so a unit
              returned N times and finally sent to supplier reads as "Returned
              to supplier" at a glance, not buried under earlier cycles. */}
          {(() => {
            const latest = steps[steps.length - 1];
            return (
              <div className={`mb-3 flex items-center gap-2 rounded-xl border px-3 py-2 ${KIND_TONE[latest.kind]}`}>
                <span className="w-6 h-6 rounded-full border border-current/30 flex items-center justify-center flex-shrink-0">
                  {KIND_ICON[latest.kind]}
                </span>
                <div className="min-w-0">
                  <p className="text-[8px] font-bold uppercase tracking-widest opacity-70">Current state</p>
                  <p className="text-[11px] font-bold truncate">
                    {latest.label}{latest.date ? ` · ${latest.date}` : ''}
                  </p>
                </div>
              </div>
            );
          })()}
          <div className="space-y-0">
          {steps.map((step, i) => (
            <div key={i} className="flex gap-3">
              {/* Rail: icon dot + connector */}
              <div className="flex flex-col items-center">
                <span className={`w-6 h-6 rounded-full border flex items-center justify-center flex-shrink-0 ${KIND_TONE[step.kind]}`}>
                  {KIND_ICON[step.kind]}
                </span>
                {i < steps.length - 1 && <span className="w-px flex-1 bg-slate-200 my-1" />}
              </div>
              {/* Body */}
              <div className="pb-4 min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-[11px] font-bold text-slate-900">{step.label}</p>
                  <span className="text-[9px] font-mono text-slate-400 whitespace-nowrap">{step.date || '—'}</span>
                </div>
                {step.detail && (
                  <p className="text-[10px] font-mono text-slate-500 mt-0.5 truncate" title={step.detail}>{step.detail}</p>
                )}
                {step.comment && (
                  <p className="text-[10px] text-slate-600 mt-0.5 italic">“{step.comment}”</p>
                )}
                {step.actor && (
                  <p className="text-[9px] font-mono text-slate-300 mt-0.5">{step.actor}</p>
                )}
              </div>
            </div>
          ))}
          </div>
        </>
      )}
    </div>
  );
}
