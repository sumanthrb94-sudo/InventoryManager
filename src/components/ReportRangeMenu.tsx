/**
 * Range-aware report download button. Sits where the plain "Sales
 * Report" / "Inventory Report" buttons used to — same place, same
 * pixel weight, but clicking opens a small dropdown with preset
 * periods (Today / This Week / This Month / All Time) plus a custom
 * from/to range. Selected period drives the date filter and the
 * filename suffix; the actual workbook build is delegated to the
 * caller via `onDownload({ from, to, periodLabel })`.
 *
 * Used by both SellSheet (Sales Report) and BuySheet (Inventory
 * Report) so the operator picks the same way for both.
 */
import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Calendar, Eye } from 'lucide-react';
import ReportViewerModal from './ReportViewerModal';
import type { ReportViewModel } from '../lib/reportView';

export type PeriodPreset = 'today' | 'week' | 'month' | 'custom' | 'all';

const PRESET_LABELS: Record<PeriodPreset, string> = {
  today:  'Today',
  week:   'This Week',
  month:  'This Month',
  custom: 'Custom range…',
  all:    'All Time',
};

/** Resolve a preset (and optional custom from/to) to an ISO date window
 *  + a human label for the filename. `'all'` returns null bounds so
 *  callers can short-circuit the filter. Sunday-start weeks per the
 *  operator's preference. */
export function resolvePeriod(
  preset: PeriodPreset,
  custom?: { from?: string; to?: string },
): { from?: string; to?: string; label: string } {
  const today = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayIso = iso(today);
  switch (preset) {
    case 'today':
      return { from: todayIso, to: todayIso, label: `today-${todayIso}` };
    case 'week': {
      const sunday = new Date(today);
      sunday.setDate(today.getDate() - today.getDay());
      return { from: iso(sunday), to: todayIso, label: `week-${iso(sunday)}-to-${todayIso}` };
    }
    case 'month': {
      const first = new Date(today.getFullYear(), today.getMonth(), 1);
      return { from: iso(first), to: todayIso, label: `${today.getFullYear()}-${pad(today.getMonth() + 1)}` };
    }
    case 'custom':
      return {
        from: custom?.from,
        to: custom?.to,
        label: `${custom?.from || 'start'}-to-${custom?.to || 'today'}`,
      };
    case 'all':
    default:
      return { label: 'all-time' };
  }
}

export default function ReportRangeMenu({
  label, icon, tone = 'emerald', onDownload, onView, disabled,
}: {
  label: string;
  icon: React.ReactNode;
  tone?: 'emerald' | 'slate';
  onDownload: (range: { from?: string; to?: string; label: string }) => Promise<void> | void;
  /** Optional in-browser preview: builds the SAME report for the picked range
   *  and returns a view model (see src/lib/reportView.ts). When provided,
   *  every preset row grows an eye button and the custom panel a View
   *  button — the preview opens in ReportViewerModal with a Download
   *  pass-through for the identical range. */
  onView?: (range: { from?: string; to?: string; label: string }) => Promise<ReportViewModel>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const today = new Date().toISOString().split('T')[0];
  const [from, setFrom] = useState<string>(today);
  const [to, setTo] = useState<string>(today);
  const [busy, setBusy] = useState(false);
  const [viewModel, setViewModel] = useState<ReportViewModel | null>(null);
  const [viewRange, setViewRange] = useState<{ from?: string; to?: string; label: string } | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const btnBg = tone === 'emerald'
    ? 'bg-emerald-600 hover:bg-emerald-700'
    : 'bg-slate-900 hover:bg-slate-700';

  const pick = async (preset: PeriodPreset) => {
    if (preset === 'custom') {
      setCustomOpen(o => !o);
      return;
    }
    setBusy(true);
    try {
      await onDownload(resolvePeriod(preset));
      setOpen(false);
      setCustomOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const downloadCustom = async () => {
    setBusy(true);
    try {
      await onDownload(resolvePeriod('custom', { from, to }));
      setOpen(false);
      setCustomOpen(false);
    } finally {
      setBusy(false);
    }
  };

  // Build the in-browser preview for a preset / the custom range and open
  // the viewer. Keeps the resolved range so the modal's Download button can
  // save exactly what was previewed.
  const pickView = async (preset: PeriodPreset) => {
    if (!onView) return;
    setBusy(true);
    try {
      const range = resolvePeriod(preset, preset === 'custom' ? { from, to } : undefined);
      const model = await onView(range);
      setViewRange(range);
      setViewModel(model);
      setOpen(false);
      setCustomOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        disabled={disabled || busy}
        className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-white text-[10px] font-bold uppercase tracking-widest transition-all disabled:opacity-40 ${btnBg}`}
        title={`${label} — pick a date range`}
      >
        {icon}
        {busy ? 'Building…' : label}
        <ChevronDown size={11} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 min-w-[220px] bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
          {(['today', 'week', 'month'] as PeriodPreset[]).map(p => (
            <div key={p} className="flex items-stretch">
              <button
                type="button"
                onClick={() => pick(p)}
                disabled={busy}
                className="flex-1 text-left px-3 py-2 text-[11px] font-bold text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                {PRESET_LABELS[p]}
              </button>
              {onView && (
                <button
                  type="button"
                  onClick={() => pickView(p)}
                  disabled={busy}
                  title={`View ${PRESET_LABELS[p]} in browser`}
                  className="px-2.5 border-l border-slate-100 text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition-colors disabled:opacity-50"
                >
                  <Eye size={13} />
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => pick('custom')}
            disabled={busy}
            className="w-full text-left px-3 py-2 text-[11px] font-bold text-slate-700 hover:bg-slate-50 transition-colors flex items-center gap-2 border-t border-slate-100 disabled:opacity-50"
          >
            <Calendar size={11} className="text-slate-400" />
            {PRESET_LABELS.custom}
          </button>
          {customOpen && (
            <div className="px-3 py-2 border-t border-slate-100 bg-slate-50/50 space-y-2">
              <label className="block text-[9px] font-mono uppercase tracking-widest text-slate-500">
                From
                <input
                  type="date"
                  value={from}
                  max={to}
                  onChange={e => setFrom(e.target.value)}
                  className="mt-0.5 w-full px-2 py-1 border border-slate-200 rounded text-[11px] font-mono"
                />
              </label>
              <label className="block text-[9px] font-mono uppercase tracking-widest text-slate-500">
                To
                <input
                  type="date"
                  value={to}
                  min={from}
                  onChange={e => setTo(e.target.value)}
                  className="mt-0.5 w-full px-2 py-1 border border-slate-200 rounded text-[11px] font-mono"
                />
              </label>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={downloadCustom}
                  disabled={busy || !from || !to}
                  className="flex-1 px-2 py-1.5 rounded-lg bg-slate-900 text-white text-[10px] font-bold uppercase tracking-widest hover:bg-slate-700 transition-all disabled:opacity-40"
                >
                  {busy ? 'Building…' : 'Download'}
                </button>
                {onView && (
                  <button
                    type="button"
                    onClick={() => pickView('custom')}
                    disabled={busy || !from || !to}
                    title="View this range in browser"
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 text-slate-900 text-[10px] font-bold uppercase tracking-widest hover:bg-slate-100 transition-all disabled:opacity-40"
                  >
                    <Eye size={12} /> View
                  </button>
                )}
              </div>
            </div>
          )}
          <div className="flex items-stretch border-t border-slate-100">
            <button
              type="button"
              onClick={() => pick('all')}
              disabled={busy}
              className="flex-1 text-left px-3 py-2 text-[11px] font-bold text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              {PRESET_LABELS.all}
            </button>
            {onView && (
              <button
                type="button"
                onClick={() => pickView('all')}
                disabled={busy}
                title="View All Time in browser"
                className="px-2.5 border-l border-slate-100 text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition-colors disabled:opacity-50"
              >
                <Eye size={13} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* In-browser preview of the exact workbook the download produces. */}
      {viewModel && (
        <ReportViewerModal
          model={viewModel}
          onClose={() => { setViewModel(null); setViewRange(null); }}
          onDownload={viewRange ? () => onDownload(viewRange) : undefined}
        />
      )}
    </div>
  );
}
