/**
 * ReportViewerModal — in-browser preview of a report workbook.
 *
 * Renders the ReportViewModel produced by src/lib/reportView.ts as an
 * Excel-style grid: sheet tabs, column letters, row-number gutter, computed
 * formula cells, red voided-row fills and bold TOTAL rows — the exact view
 * the .xlsx download opens to, so browser testers can verify the report
 * without downloading. The Download button saves the same range the
 * preview was built from.
 *
 * Deliberately heavy-import-free: all ExcelJS work happens in reportView.ts
 * (dynamic-imported by the screens); this component only paints the model.
 */
import React, { useState, useEffect } from 'react';
import { X, Download, FileSpreadsheet, RefreshCw } from 'lucide-react';
import type { ReportViewModel } from '../lib/reportView';
import { numToCol } from '../lib/reportView';

export default function ReportViewerModal({
  model, onClose, onDownload, refreshing = false, lastRefreshedAt = null,
}: {
  model: ReportViewModel;
  onClose: () => void;
  /** Saves the same range the preview shows (wired to the menu's download). */
  onDownload?: () => Promise<void> | void;
  /** True while the parent is rebuilding the model from fresh data. */
  refreshing?: boolean;
  /** ms epoch of the last successful refresh — drives the "Updated Xs ago"
   *  pill in the header so the operator knows the preview is live. */
  lastRefreshedAt?: number | null;
}) {
  const [active, setActive] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const sheet = model.sheets[active] ?? model.sheets[0];
  // Tick once a second so the "Updated 12s ago" label stays current
  // without forcing the whole grid to re-render.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (lastRefreshedAt === null) return;
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [lastRefreshedAt]);

  const refreshLabel = (() => {
    if (refreshing) return 'Updating…';
    if (lastRefreshedAt === null) return null;
    const secs = Math.max(0, Math.round((Date.now() - lastRefreshedAt) / 1000));
    if (secs < 5) return 'Updated just now';
    if (secs < 60) return `Updated ${secs}s ago`;
    const m = Math.floor(secs / 60);
    return `Updated ${m}m ago`;
  })();

  const handleDownload = async () => {
    if (!onDownload || downloading) return;
    setDownloading(true);
    try { await onDownload(); } finally { setDownloading(false); }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-2 md:p-6 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[96vw] h-[92vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header row 1: title + actions ───────────────────────────────
            Compact title row that always reserves space for Download +
            Close on the right. Title truncates with ellipsis on narrow
            screens instead of pushing the sheet tabs off-screen (the bug
            in the round-5 mobile screenshots — only "RET" was visible).  */}
        <div className="flex-shrink-0 px-3 py-2.5 border-b border-slate-100 flex items-center gap-2">
          <FileSpreadsheet size={16} className="text-emerald-700 flex-shrink-0" />
          <h3 className="text-sm font-bold text-slate-900 truncate flex-1 min-w-0">{model.title}</h3>
          {refreshLabel && (
            <span
              className={`hidden sm:inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest flex-shrink-0
                ${refreshing
                  ? 'bg-blue-50 text-blue-800 border border-blue-200'
                  : 'bg-emerald-50 text-emerald-800 border border-emerald-200'}`}
              title="The preview auto-refreshes whenever the underlying data changes"
            >
              <RefreshCw size={10} className={refreshing ? 'animate-spin' : ''} />
              {refreshLabel}
            </span>
          )}
          {onDownload && (
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold uppercase tracking-widest hover:bg-emerald-700 transition-all disabled:opacity-50 flex-shrink-0"
            >
              <Download size={13} /> <span className="hidden sm:inline">{downloading ? 'Saving…' : 'Download'}</span>
            </button>
          )}
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-slate-100 text-slate-700 flex-shrink-0"
            title="Close preview"
          >
            <X size={16} />
          </button>
        </div>

        {/* ── Header row 2: sheet tabs (Excel-style) ──────────────────────
            Own row so all tabs sit on the full modal width and stay
            tappable on mobile. Horizontal scroll for many tabs;
            min-h-11 (44px) keeps each tab at the iOS/Android touch-target
            minimum so they don't ghost-tap on small phones. */}
        <div
          className="flex-shrink-0 border-b border-slate-200 bg-slate-50/60 overflow-x-auto"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          <div className="flex items-stretch gap-1.5 px-3 py-2 min-w-max">
            {model.sheets.map((s, i) => (
              <button
                key={s.name}
                type="button"
                onClick={() => setActive(i)}
                className={`min-h-11 px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide border transition-all flex-shrink-0
                  ${i === active
                    ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                    : 'bg-white text-slate-900 border-slate-300 hover:border-slate-500 active:bg-slate-100'}`}
                style={{ touchAction: 'manipulation' }}
                aria-pressed={i === active}
              >
                {s.name}
              </button>
            ))}
          </div>
        </div>

        {/* ── Grid ── */}
        <div className="flex-1 overflow-auto bg-slate-50">
          {sheet && sheet.rows.length > 0 ? (
            <table
              className="border-separate border-spacing-0 text-xs text-slate-900 bg-white"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              <thead>
                <tr>
                  {/* corner cell */}
                  <th className="sticky top-0 left-0 z-30 bg-slate-200 border-b border-r border-slate-300 w-10 min-w-10" />
                  {Array.from({ length: sheet.columnCount }, (_, c) => (
                    <th
                      key={c}
                      className="sticky top-0 z-20 bg-slate-100 border-b border-r border-slate-300 px-2 py-1 text-[10px] font-bold text-slate-700 text-center"
                      style={{ minWidth: sheet.columnWidths[c] ?? 70 }}
                    >
                      {numToCol(c + 1)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sheet.rows.map((cells, r) => (
                  <tr key={r}>
                    <td className="sticky left-0 z-10 bg-slate-100 border-b border-r border-slate-300 px-1.5 py-1 text-[10px] font-bold text-slate-700 text-center">
                      {r + 1}
                    </td>
                    {cells.map((cell, c) => (
                      <td
                        key={c}
                        title={cell.title}
                        className={`border-b border-r border-slate-200 px-2 py-1 whitespace-nowrap
                          ${cell.align === 'right' ? 'text-right' : 'text-left'}
                          ${cell.bold ? 'font-bold' : ''}`}
                        style={cell.fillColor ? { backgroundColor: cell.fillColor } : undefined}
                      >
                        {cell.display}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="py-16 text-center text-sm font-bold text-slate-700">
              This sheet has no rows for the selected range.
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="flex-shrink-0 px-4 py-2 border-t border-slate-200 bg-slate-50 text-[11px] font-mono uppercase tracking-widest text-slate-900 flex items-center justify-between">
          <span>
            {sheet ? `${sheet.rows.length.toLocaleString()} rows × ${sheet.columnCount} cols` : '—'}
            {sheet?.truncatedFrom ? ` · showing first ${sheet.rows.length.toLocaleString()} of ${sheet.truncatedFrom.toLocaleString()}` : ''}
          </span>
          <span className="hidden sm:inline">Preview matches the .xlsx download — formulas computed in-browser</span>
        </div>
      </div>
    </div>
  );
}
