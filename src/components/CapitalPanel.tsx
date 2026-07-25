/**
 * CapitalPanel — where the money is, and what it earned.
 *
 * The existing Insights answer operational questions in COUNTS. These are
 * the same shapes in pounds, plus the one column that was missing entirely:
 * return rate. A supplier with strong margins and a 20% return rate can be
 * the worst one on the list, and until now nothing said so.
 */
import React, { useMemo } from 'react';
import { Layers, Users, Package } from 'lucide-react';
import { useInventoryStore } from '../lib/inventoryStore';
import { capitalPosition, supplierPerformance, modelProfitability } from '../lib/capital';

const money = (n: number) =>
  `${n < 0 ? '−' : ''}£${Math.abs(n).toLocaleString('en-GB', { maximumFractionDigits: 0 })}`;

const BUCKET_TONE = ['bg-emerald-500', 'bg-amber-400', 'bg-orange-500', 'bg-rose-500'];

export default function CapitalPanel() {
  const { units, sales } = useInventoryStore();
  const now = Date.now();

  const position = useMemo(() => capitalPosition(units, now), [units]);
  const suppliers = useMemo(() => supplierPerformance(units, sales, now), [units, sales]);
  const models = useMemo(() => modelProfitability(units, sales, now), [units, sales]);

  return (
    <div className="space-y-4">
      {/* ── Capital tied up ───────────────────────────────────────────────── */}
      <section className="bg-white border border-slate-200 rounded-3xl p-4 md:p-5">
        <header className="flex items-center gap-2 mb-4">
          <Layers size={14} className="text-blue-600" />
          <h3 className="text-[13px] font-bold tracking-tight">Capital tied up in stock</h3>
        </header>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-4">
          {[
            ['Total held', money(position.totalValue), `${position.totalUnits} units`],
            ['On the shelf', money(position.officeValue), 'office stock'],
            ['With suppliers', money(position.shsValue), 'not yet arrived'],
            ['Over 90 days', money(position.agedValue), `${position.agedShare}% of capital`],
          ].map(([label, value, sub]) => (
            <figure key={label} className="rounded-2xl border border-slate-200 p-3 m-0">
              <figcaption className="text-[9px] font-bold uppercase tracking-widest text-slate-400">{label}</figcaption>
              <p className="mt-1 text-xl font-bold tabular-nums text-slate-900">{value}</p>
              <p className="text-[9px] font-mono text-slate-400">{sub}</p>
            </figure>
          ))}
        </div>

        {/* Aged stock, measured in money rather than unit count — twelve £600
            phones and twelve £90 phones are the same bar on a count. */}
        <div className="space-y-2">
          {position.buckets.map((b, i) => (
            <div key={b.label} className="flex items-center gap-3">
              <span className="w-24 flex-shrink-0 text-[10px] font-mono text-slate-500">{b.label}</span>
              <span className="flex-1 h-5 rounded-md bg-slate-100 overflow-hidden">
                <span
                  className={`block h-full ${BUCKET_TONE[i]} transition-all`}
                  style={{ width: `${Math.max(b.share, b.value > 0 ? 2 : 0)}%` }}
                />
              </span>
              <span className="w-20 flex-shrink-0 text-right text-[11px] font-bold tabular-nums text-slate-900">
                {money(b.value)}
              </span>
              <span className="w-16 flex-shrink-0 text-right text-[10px] font-mono text-slate-400">
                {b.units} {b.units === 1 ? 'unit' : 'units'}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Supplier profitability, returns included ──────────────────────── */}
      <section className="bg-white border border-slate-200 rounded-3xl overflow-hidden">
        <header className="flex items-center gap-2 px-4 md:px-5 py-4 border-b border-slate-100">
          <Users size={14} className="text-amber-600" />
          <div>
            <h3 className="text-[13px] font-bold tracking-tight">Supplier profitability</h3>
            <p className="text-[10px] font-mono text-slate-400">
              Returns removed from profit and counted against the supplier
            </p>
          </div>
        </header>
        {suppliers.length === 0 ? (
          <p className="px-5 py-8 text-center text-[11px] font-mono text-slate-400">No supplier activity yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead className="bg-slate-50 text-[9px] font-bold uppercase tracking-widest text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left">Supplier</th>
                  <th className="px-4 py-2 text-right">Sold</th>
                  <th className="px-4 py-2 text-right">Revenue</th>
                  <th className="px-4 py-2 text-right">Net profit</th>
                  <th className="px-4 py-2 text-right">Margin</th>
                  <th className="px-4 py-2 text-right">Returns</th>
                  <th className="px-4 py-2 text-right">Return rate</th>
                  <th className="px-4 py-2 text-right">Capital held</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map(s => (
                  <tr key={s.supplier} className="border-t border-slate-100">
                    <td className="px-4 py-2 font-bold text-slate-900 whitespace-nowrap">{s.supplier}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{s.unitsSold}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{money(s.revenue)}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-bold">{money(s.netProfit)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{s.netMargin}%</td>
                    <td className="px-4 py-2 text-right tabular-nums">{s.returned}</td>
                    <td className={`px-4 py-2 text-right tabular-nums font-bold ${
                      s.returnRate >= 10 ? 'text-rose-700' : s.returnRate >= 5 ? 'text-amber-700' : 'text-slate-500'
                    }`}>
                      {s.returnRate}%
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-500">{money(s.heldValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Model profitability against how long the cash was tied up ─────── */}
      <section className="bg-white border border-slate-200 rounded-3xl overflow-hidden">
        <header className="flex items-center gap-2 px-4 md:px-5 py-4 border-b border-slate-100">
          <Package size={14} className="text-emerald-600" />
          <div>
            <h3 className="text-[13px] font-bold tracking-tight">Model profitability</h3>
            <p className="text-[10px] font-mono text-slate-400">
              GP alone ranks a slow £200 phone above a fast £60 one — days-to-sell sits beside it
            </p>
          </div>
        </header>
        {models.length === 0 ? (
          <p className="px-5 py-8 text-center text-[11px] font-mono text-slate-400">No model activity yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead className="bg-slate-50 text-[9px] font-bold uppercase tracking-widest text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left">Model</th>
                  <th className="px-4 py-2 text-right">Sold</th>
                  <th className="px-4 py-2 text-right">GP</th>
                  <th className="px-4 py-2 text-right">GP / unit</th>
                  <th className="px-4 py-2 text-right">Days to sell</th>
                  <th className="px-4 py-2 text-right">Return rate</th>
                  <th className="px-4 py-2 text-right">Held</th>
                </tr>
              </thead>
              <tbody>
                {models.slice(0, 20).map(m => (
                  <tr key={m.model} className="border-t border-slate-100">
                    <td className="px-4 py-2 font-bold text-slate-900 whitespace-nowrap">{m.model}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{m.unitsSold}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-bold">{money(m.grossProfit)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{money(m.gpPerUnit)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-500">
                      {m.medianDaysToSell === null ? '—' : `${m.medianDaysToSell}d`}
                    </td>
                    <td className={`px-4 py-2 text-right tabular-nums ${m.returnRate >= 10 ? 'text-rose-700 font-bold' : 'text-slate-500'}`}>
                      {m.returnRate}%
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-500">
                      {money(m.heldValue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
