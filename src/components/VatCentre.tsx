/**
 * VatCentre — what you owe, per quarter, with the arithmetic shown.
 *
 * The per-sale VAT figures always existed; nothing added them up, so
 * answering "what do I owe this quarter?" meant exporting a workbook and
 * summing a column by hand. This is that number, on screen.
 *
 * It deliberately shows TWO totals rather than one. Margin VAT has always
 * been computed as (SP − BP) × 16.67% with no floor, so a phone sold at a
 * loss produces negative VAT that cancels real VAT owed on profitable sales.
 * HMRC Notice 718 treats each sale separately — a loss carries no VAT and
 * cannot be set against another item's margin. Re-stating a filed VAT figure
 * is not a change to make on a code author's reading of a public notice, so
 * both readings are presented with the difference and the exact rows behind
 * it, and the accountant rules.
 *
 * The export is the deliverable: a workbook an accountant can open with the
 * summary, the stock book HMRC expects, and the loss-making sales listed.
 */
import React, { useState, useMemo } from 'react';
import {
  Receipt, AlertTriangle, Download, Loader2, ChevronDown, Info, TrendingDown,
} from 'lucide-react';
import { useInventoryStore } from '../lib/inventoryStore';
import { buildVatPeriods, lossMakingLines, buildStockBook } from '../lib/vat';
import type { VatPeriodSummary } from '../lib/vat';

const money = (n: number) =>
  `${n < 0 ? '−' : ''}£${Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function VatCentre() {
  const { sales } = useInventoryStore();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showLosses, setShowLosses] = useState(false);

  const periods = useMemo(() => buildVatPeriods(sales), [sales]);
  const selected: VatPeriodSummary | undefined =
    periods.find(p => p.period.key === selectedKey) ?? periods[0];

  const losses = useMemo(
    () => (selected ? lossMakingLines([selected]) : []),
    [selected],
  );

  const handleExport = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();

      // ── Summary: the figure, both ways, with the delta spelled out ──────
      const sum = wb.addWorksheet('VAT Summary');
      sum.columns = [{ width: 38 }, { width: 18 }];
      const title = sum.addRow([`VAT — ${selected.period.label}`, '']);
      title.font = { bold: true, size: 14 };
      sum.addRow([`Period ${selected.period.from} to ${selected.period.to}`, '']);
      sum.addRow([]);
      const rows: [string, string | number][] = [
        ['Sales in period', selected.saleCount],
        ['Turnover (SP)', selected.totalSales],
        ['Cost of goods (BP)', selected.totalCost],
        ['Total margin', selected.totalMargin],
        ['', ''],
        ['Margin VAT — as historically computed', selected.marginVatAsComputed],
        ['Margin VAT — per margin scheme (losses floored at 0)', selected.marginVatMarginScheme],
        ['Difference', selected.difference],
        ['Loss-making sales causing the difference', selected.lossMakingCount],
        ['', ''],
        ['Input VAT reclaimable on marketplace fees', selected.inputVat],
        ['Net payable — as historically computed', selected.netPayableAsComputed],
        ['Net payable — per margin scheme', selected.netPayableMarginScheme],
      ];
      for (const [label, value] of rows) {
        const r = sum.addRow([label, value]);
        if (typeof value === 'number' && !Number.isInteger(value)) r.getCell(2).numFmt = '£#,##0.00';
        if (/^Margin VAT|^Net payable|^Difference/.test(label)) r.font = { bold: true };
      }
      sum.addRow([]);
      const note = sum.addRow([
        'The two margin-VAT figures differ only where an item sold for less than it cost. '
        + 'HMRC Notice 718 treats each margin-scheme sale separately: no VAT is due on a loss, '
        + 'and that loss cannot be set against the margin on other items. Both readings are shown '
        + 'so this can be confirmed before filing. Voided (refunded) sales are excluded throughout.',
        '',
      ]);
      note.getCell(1).alignment = { wrapText: true, vertical: 'top' };
      note.height = 60;

      // ── Stock book: one row per item, as HMRC expects to read it ────────
      const book = wb.addWorksheet('Stock Book');
      const BOOK_HEADERS = ['Sale Date', 'IMEI', 'Model', 'Supplier', 'Purchase Price',
        'Sale Price', 'Margin', 'VAT Due', 'Marketplace', 'Order Number'];
      book.addRow(BOOK_HEADERS).font = { bold: true };
      book.columns = BOOK_HEADERS.map((h, i) => ({ width: i === 1 || i === 2 ? 22 : 15 }));
      for (const r of buildStockBook([selected])) {
        const row = book.addRow([
          r.saleDate, r.imei, r.model, r.supplier, r.purchasePrice,
          r.salePrice, r.margin, r.vatDue, r.marketplace, r.orderNumber,
        ]);
        for (const c of [5, 6, 7, 8]) row.getCell(c).numFmt = '£#,##0.00';
        if (r.margin < 0) {
          row.eachCell(c => {
            c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
          });
        }
      }

      // ── The rows behind the difference ──────────────────────────────────
      const lossSheet = wb.addWorksheet('Loss-Making Sales');
      const LOSS_HEADERS = ['Sale Date', 'IMEI', 'Model', 'Supplier', 'BP', 'SP',
        'Margin', 'VAT as computed', 'VAT per margin scheme', 'Marketplace', 'Order Number'];
      lossSheet.addRow(LOSS_HEADERS).font = { bold: true };
      lossSheet.columns = LOSS_HEADERS.map((_, i) => ({ width: i === 1 || i === 2 ? 22 : 16 }));
      for (const l of lossMakingLines([selected])) {
        const row = lossSheet.addRow([
          l.saleDate, l.imei ?? '', l.model ?? '', l.supplierName ?? '',
          l.buyPrice, l.salePrice, l.margin, l.vatAsComputed, l.vatMarginScheme,
          l.marketplace, l.orderNumber,
        ]);
        for (const c of [5, 6, 7, 8, 9]) row.getCell(c).numFmt = '£#,##0.00';
      }

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `VAT-${selected.period.key}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally {
      setBusy(false);
    }
  };

  if (!periods.length) {
    return (
      <div className="py-16 text-center">
        <Receipt size={28} className="mx-auto text-slate-300" />
        <p className="mt-3 text-sm font-bold text-slate-700">No sales to account for yet</p>
        <p className="mt-1 text-[11px] font-mono text-slate-400">
          VAT periods appear once sales are recorded or imported.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Period picker + export ─────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <select
            value={selected?.period.key ?? ''}
            onChange={e => setSelectedKey(e.target.value)}
            className="appearance-none pl-3 pr-8 py-2 rounded-xl border border-slate-300 bg-white text-[12px] font-bold text-slate-900"
            aria-label="VAT period"
          >
            {periods.map(p => (
              <option key={p.period.key} value={p.period.key}>
                {p.period.label} · {p.saleCount} sales
              </option>
            ))}
          </select>
          <ChevronDown size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={busy}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-700 text-white text-[10px] font-bold uppercase tracking-widest transition-all disabled:opacity-40"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
          {busy ? 'Building…' : 'Export for accountant'}
        </button>
      </div>

      {selected && (
        <>
          {/* ── The two readings, side by side ──────────────────────────── */}
          <div className="grid gap-3 md:grid-cols-2">
            <figure className="rounded-2xl border border-slate-200 bg-white p-4 m-0">
              <figcaption className="text-[9px] font-bold uppercase tracking-widest text-slate-400">
                Margin VAT · as historically computed
              </figcaption>
              <p className="mt-1 text-3xl font-bold tabular-nums text-slate-900">
                {money(selected.marginVatAsComputed)}
              </p>
              <p className="mt-1 text-[10px] font-mono text-slate-500">
                losses subtract from the total
              </p>
            </figure>

            <figure className={`rounded-2xl border p-4 m-0 ${selected.difference > 0 ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
              <figcaption className="text-[9px] font-bold uppercase tracking-widest text-slate-500">
                Margin VAT · per margin scheme
              </figcaption>
              <p className="mt-1 text-3xl font-bold tabular-nums text-slate-900">
                {money(selected.marginVatMarginScheme)}
              </p>
              <p className="mt-1 text-[10px] font-mono text-slate-600">
                each sale floored at £0
              </p>
            </figure>
          </div>

          {/* ── The difference, if any ──────────────────────────────────── */}
          {selected.difference > 0 ? (
            <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
              <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-amber-800">
                <AlertTriangle size={13} /> The two readings differ by {money(selected.difference)}
              </p>
              <p className="mt-2 text-[12px] text-amber-900 leading-relaxed">
                <strong>{selected.lossMakingCount}</strong> {selected.lossMakingCount === 1 ? 'sale' : 'sales'} in
                this quarter sold for less than {selected.lossMakingCount === 1 ? 'it' : 'they'} cost. Under the
                historical calculation each contributes negative VAT, reducing the total. HMRC Notice 718 treats
                every margin-scheme sale separately — no VAT is due on a loss, and the loss cannot be set against
                the margin on other items.
              </p>
              <p className="mt-2 text-[11px] font-mono text-amber-800">
                Confirm with your accountant before filing. Nothing here changes the stored figures.
              </p>
              <button
                type="button"
                onClick={() => setShowLosses(s => !s)}
                className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-400 bg-white text-[10px] font-bold uppercase tracking-widest text-amber-900 hover:bg-amber-100 transition-colors"
              >
                <TrendingDown size={12} />
                {showLosses ? 'Hide' : 'Show'} the {selected.lossMakingCount} {selected.lossMakingCount === 1 ? 'sale' : 'sales'}
              </button>
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <Info size={13} className="mt-0.5 flex-shrink-0 text-slate-400" />
              <p className="text-[11px] text-slate-600">
                Every sale in this quarter made a margin, so both readings agree. The difference only appears
                when an item sells for less than it cost.
              </p>
            </div>
          )}

          {/* ── The rows behind the difference ──────────────────────────── */}
          {showLosses && losses.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead className="bg-slate-50 text-[9px] font-bold uppercase tracking-widest text-slate-500">
                    <tr>
                      {['Date', 'Model', 'IMEI', 'Supplier', 'BP', 'SP', 'Margin', 'VAT now', 'VAT scheme'].map(h => (
                        <th key={h} className="px-3 py-2 text-left whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {losses.map(l => (
                      <tr key={l.saleId} className="border-t border-slate-100">
                        <td className="px-3 py-2 whitespace-nowrap font-mono text-slate-600">{l.saleDate}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-slate-900">{l.model || '—'}</td>
                        <td className="px-3 py-2 whitespace-nowrap font-mono text-slate-500">{l.imei || '—'}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-slate-600">{l.supplierName || '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{money(l.buyPrice)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{money(l.salePrice)}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-bold text-rose-700">{money(l.margin)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-rose-600">{money(l.vatAsComputed)}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-bold">{money(l.vatMarginScheme)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── The rest of the position ────────────────────────────────── */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['Sales in period', String(selected.saleCount)],
              ['Turnover', money(selected.totalSales)],
              ['Cost of goods', money(selected.totalCost)],
              ['Total margin', money(selected.totalMargin)],
              ['Input VAT on fees', money(selected.inputVat)],
              ['Net payable · as computed', money(selected.netPayableAsComputed)],
              ['Net payable · margin scheme', money(selected.netPayableMarginScheme)],
              ['Loss-making sales', String(selected.lossMakingCount)],
            ].map(([label, value]) => (
              <figure key={label} className="rounded-2xl border border-slate-200 bg-white p-3 m-0">
                <figcaption className="text-[9px] font-bold uppercase tracking-widest text-slate-400">{label}</figcaption>
                <p className="mt-1 text-lg font-bold tabular-nums text-slate-900">{value}</p>
              </figure>
            ))}
          </div>

          <p className="text-[10px] font-mono text-slate-400 leading-relaxed">
            Calendar quarters. Voided (refunded) sales are excluded — the money went back to the customer, so
            there is no supply to account for. Input VAT is the reclaimable VAT the marketplaces charged on
            their fees, and is reclaimable under either reading.
          </p>
        </>
      )}
    </div>
  );
}
