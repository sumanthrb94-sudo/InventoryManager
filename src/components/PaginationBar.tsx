/**
 * Shared 100-rows-per-page pagination used by every large data surface
 * (Sell / Buy / Returns inline sheets + the sales overlay). One place
 * for the page-window math and the nav-bar UI so the operator gets the
 * exact same rhythm everywhere — per their perf rule: any surface that
 * can exceed 100 rows must page, so the DOM stays small and the app
 * never hangs rendering thousands of rows in one pass.
 */
import React, { useMemo, useState } from 'react';

export const ROWS_PER_PAGE = 100;

/** Slice `rows` into 100-row pages. Page auto-clamps when the row set
 *  shrinks below the current window (e.g. a filter cut 1800 rows down
 *  to 40 while the operator sat on page 5). */
export function usePagedRows<T>(rows: T[]): {
  page: number;
  setPage: (p: number | ((prev: number) => number)) => void;
  totalPages: number;
  paged: T[];
  total: number;
} {
  const [rawPage, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE));
  const page = Math.min(rawPage, totalPages);
  const paged = useMemo(
    () => rows.slice((page - 1) * ROWS_PER_PAGE, page * ROWS_PER_PAGE),
    [rows, page],
  );
  return { page, setPage, totalPages, paged, total: rows.length };
}

const btnCls =
  'px-2 py-1 rounded-lg border border-slate-200 text-slate-600 text-[10px] font-bold uppercase tracking-widest hover:bg-slate-100 transition-all disabled:opacity-30 disabled:cursor-not-allowed';

/** First / Prev / Next / Last nav bar. Renders nothing when the data
 *  fits in one page, so callers can mount it unconditionally. */
export default function PaginationBar({
  page, totalPages, total, onPage, itemLabel = 'rows',
}: {
  page: number;
  totalPages: number;
  total: number;
  onPage: (p: number | ((prev: number) => number)) => void;
  itemLabel?: string;
}) {
  if (totalPages <= 1) return null;
  const from = (page - 1) * ROWS_PER_PAGE + 1;
  const to = Math.min(page * ROWS_PER_PAGE, total);
  return (
    <div className="flex-shrink-0 px-5 py-2 border-t border-slate-100 bg-white flex items-center justify-between gap-3">
      <span className="text-[10px] font-mono text-slate-500">
        {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()} {itemLabel}
        {' · page '}{page}/{totalPages}
      </span>
      <div className="flex items-center gap-1.5">
        <button onClick={() => onPage(1)} disabled={page === 1} className={btnCls}>« First</button>
        <button onClick={() => onPage(p => Math.max(1, (typeof p === 'number' ? p : 1) - 1))} disabled={page === 1} className={btnCls}>‹ Prev</button>
        <button onClick={() => onPage(p => Math.min(totalPages, (typeof p === 'number' ? p : 1) + 1))} disabled={page >= totalPages} className={btnCls}>Next ›</button>
        <button onClick={() => onPage(totalPages)} disabled={page >= totalPages} className={btnCls}>Last »</button>
      </div>
    </div>
  );
}
