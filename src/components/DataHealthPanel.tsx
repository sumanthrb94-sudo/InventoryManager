/**
 * DataHealthPanel — the broken records, before they reach a report.
 *
 * Sits under Configuration alongside the other repair tools, because that is
 * what it is: not a dashboard to admire, a list to work through and empty.
 *
 * Every check corresponds to something that has actually gone wrong here —
 * a zero buy price reading as a 100% margin, an IMEI on two units so a sale
 * matched the wrong phone, a model left as a raw SKU code so it grouped as
 * its own model everywhere. None of those surfaced until a number looked
 * wrong downstream, which is the expensive place to find them.
 *
 * Checks that found nothing still render, collapsed and ticked. A panel that
 * hides its passing checks is a panel nobody believes is running.
 */
import React, { useMemo, useState } from 'react';
import { ShieldCheck, ChevronDown, AlertTriangle, AlertCircle, Info } from 'lucide-react';
import { useInventoryStore } from '../lib/inventoryStore';
import { runHealthChecks, totalIssues } from '../lib/dataHealth';
import type { HealthCheck, HealthSeverity } from '../lib/dataHealth';

const SEVERITY: Record<HealthSeverity, { icon: React.ReactNode; chip: string; label: string }> = {
  high: {
    icon: <AlertTriangle size={13} className="text-rose-600" />,
    chip: 'bg-rose-50 text-rose-700 border-rose-200',
    label: 'High',
  },
  medium: {
    icon: <AlertCircle size={13} className="text-amber-600" />,
    chip: 'bg-amber-50 text-amber-700 border-amber-200',
    label: 'Medium',
  },
  low: {
    icon: <Info size={13} className="text-slate-500" />,
    chip: 'bg-slate-50 text-slate-600 border-slate-200',
    label: 'Low',
  },
};

/** Rows beyond this are counted but not rendered — the list is a worklist,
 *  not an export, and 400 rows of the same problem says the same thing. */
const MAX_ROWS = 25;

// `key` is declared here because this React types version checks the whole
// JSX props object against the annotation, so an exact type rejects it.
function CheckRow({ check }: { check: HealthCheck; key?: React.Key }) {
  const [open, setOpen] = useState(false);
  const clean = check.issues.length === 0;
  const sev = SEVERITY[check.severity];

  return (
    <div className={`rounded-2xl border ${clean ? 'border-slate-200 bg-white' : 'border-slate-300 bg-white'}`}>
      <button
        type="button"
        onClick={() => !clean && setOpen(o => !o)}
        disabled={clean}
        className={`w-full flex items-center gap-3 px-4 py-3 text-left ${clean ? 'cursor-default' : 'hover:bg-slate-50'} transition-colors rounded-2xl`}
      >
        <span className="flex-shrink-0">
          {clean ? <ShieldCheck size={13} className="text-emerald-600" /> : sev.icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12px] font-bold text-slate-900">{check.title}</span>
          <span className="block text-[10px] font-mono text-slate-500 leading-tight">
            {clean ? 'nothing to fix' : check.consequence}
          </span>
        </span>
        {!clean && (
          <>
            <span className={`flex-shrink-0 px-2 py-0.5 rounded-md border text-[9px] font-bold uppercase tracking-widest ${sev.chip}`}>
              {sev.label}
            </span>
            <span className="flex-shrink-0 text-[13px] font-bold tabular-nums text-slate-900">
              {check.issues.length}
            </span>
            <ChevronDown
              size={13}
              className={`flex-shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
            />
          </>
        )}
        {clean && (
          <span className="flex-shrink-0 text-[9px] font-bold uppercase tracking-widest text-emerald-700">
            Clear
          </span>
        )}
      </button>

      {open && !clean && (
        <ul className="border-t border-slate-100 divide-y divide-slate-50">
          {check.issues.slice(0, MAX_ROWS).map(issue => (
            <li key={issue.id} className="px-4 py-2">
              <p className="text-[11px] font-bold text-slate-800">{issue.label}</p>
              <p className="text-[10px] font-mono text-slate-500">{issue.detail}</p>
            </li>
          ))}
          {check.issues.length > MAX_ROWS && (
            <li className="px-4 py-2 text-[10px] font-mono text-slate-400">
              + {check.issues.length - MAX_ROWS} more
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

export default function DataHealthPanel() {
  const { units, sales } = useInventoryStore();
  // Date.now() once per render pass, not per check — otherwise two checks
  // can disagree about what "60 days" means on the same screen.
  const checks = useMemo(
    () => runHealthChecks({ units, sales, now: Date.now() }),
    [units, sales],
  );
  const total = totalIssues(checks);

  return (
    <section className="bg-white border border-slate-200 rounded-3xl p-4 md:p-5">
      <header className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="text-[13px] font-bold tracking-tight flex items-center gap-2">
            <ShieldCheck size={14} className={total ? 'text-amber-600' : 'text-emerald-600'} />
            Data Health
          </h3>
          <p className="text-[10px] font-mono uppercase tracking-widest text-slate-400 mt-0.5">
            Records that are legal but suspicious
          </p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-2xl font-bold tabular-nums text-slate-900">{total}</p>
          <p className="text-[9px] font-mono uppercase tracking-widest text-slate-400">
            {total === 1 ? 'record' : 'records'} to review
          </p>
        </div>
      </header>

      {total === 0 && (
        <p className="mb-3 text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
          Every check is clear. These run against live data, so this is worth a look after each bulk import.
        </p>
      )}

      <div className="space-y-2">
        {checks.map(c => <CheckRow key={c.key} check={c} />)}
      </div>

      <p className="mt-3 text-[10px] font-mono text-slate-400 leading-relaxed">
        Nothing here blocks a save — these are conditions that are valid but usually wrong. Sold and
        deleted units are excluded, so the list reflects stock you still hold.
      </p>
    </section>
  );
}
