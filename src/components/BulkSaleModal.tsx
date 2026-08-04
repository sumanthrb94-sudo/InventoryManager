/**
 * BulkSaleModal — "Mark Multiple Sold", as the Sales Report's own sheets.
 *
 * ONE TAB PER MARKETPLACE, because the report has one sheet per marketplace
 * and they are not the same shape. Amazon charges a DSF and reports its VAT;
 * eBay reports ROF, FVF, a 20%-on-fees bundle, a total-commission line and
 * per-line marketing spend; OnBuy reports a single VAT 20%; Temu reports
 * commission VAT on its own; Back Market charges a flat customer-care fee and
 * carries no Total VAT column at all. A single generic grid could only show
 * the columns they have in common, which is not what the operator reconciles
 * against. So each tab shows that marketplace's columns, in its order — see
 * bulkSaleColumns.ts, which is pinned to SALES_HEADERS by a test.
 *
 * FILLING A ROW
 *
 *   Source   →  Office / SHS / Accessory. Narrows what the search will offer,
 *               so the operator says what they are selling before looking for
 *               it rather than hunting through everything.
 *   Model    →  searches STOCK — by model, IMEI, SKU, supplier, storage or
 *               colour — and lists the individual units, scrollable. Picking
 *               one brings its Supplier and BP with it. Those are shown, not
 *               typed: BP is what the unit was bought for, and a hand-typed
 *               one would disagree with the buy record.
 *   SP, Postage, Order Number  →  yours to fill.
 *   Everything else            →  computed live by calcSaleFinancials, the
 *               same function behind every other sale in the app.
 *
 * A row can only sell a handset that is in stock. That is what makes the grid
 * safe: it cannot invent a unit, so stock and the reports cannot drift apart.
 *
 * Every line still goes through recordBulkSales(), so a sale entered here is
 * the same write as one recorded singly — same fees, same VAT lines, same
 * audit trail — and lands on its marketplace tab in the Sales Report as usual.
 */
import { useState, useMemo, useRef, useEffect, useLayoutEffect, type Key, type ReactNode } from 'react';
import { X, Plus, CheckCircle2, Trash2, Truck, Package, Tag, Loader2, Search } from 'lucide-react';
import type { InventoryUnit, AccessoryStock, Marketplace } from '../types';
import { calcSaleFinancials, type SaleFinancials } from '../lib/platforms';
import { MARKETPLACE_COLUMNS } from '../lib/bulkSaleColumns';
import { recordBulkSales, type BulkSaleLine, type BulkSaleLineResult } from '../services/salesService';
import { ACTIVE_PLATFORMS, PLATFORM_META, BM_PAYMENT_MODES } from './SellOrderModal';

const today = () => new Date().toISOString().split('T')[0];

/** What the postage cell starts at per marketplace. UI convenience only —
 *  calcSaleFinancials defaults postage to 0 and takes what it is given. */
const UI_AUTOFILL_POSTAGE: Record<Marketplace, number> = {
  AMAZON: 6.30, BM: 6.30, ONBUY: 6.30, EBAY: 0, TEMU: 6.30,
};

// ── What a row can be selling ──────────────────────────────────────────────

/** Where a row's stock comes from. Chosen before searching, so the list the
 *  operator scrolls is only ever the kind of thing they meant. */
export type StockSource = 'office' | 'shs' | 'accessory';

const SOURCE_LABEL: Record<StockSource, string> = {
  office: 'Office', shs: 'SHS', accessory: 'Accessory',
};

type Pick =
  | { kind: 'unit'; unit: InventoryUnit; isSHS: boolean }
  | { kind: 'accessory'; accessory: AccessoryStock };

interface Row {
  key: string;
  source: StockSource;
  pick?: Pick;
  /** Typed only when the picked SHS unit has no IMEI on file yet — the
   *  service refuses to sell one without stamping it first, same as the
   *  single-sale flow. */
  imei: string;
  /** Text in the Model cell while the operator is searching. */
  query: string;
  marketplace: Marketplace;
  orderNumber: string;
  quantity: string;
  salePrice: string;
  postage: string;
  /** eBay only — per-line promo spend. */
  marketing: string;
  paymentMode: string;
  saleDate: string;
}

let seq = 0;
const blankRow = (marketplace: Marketplace): Row => ({
  key: `r${++seq}`, source: 'office', query: '', imei: '', marketplace,
  orderNumber: '', quantity: '1', salePrice: '', postage: '', marketing: '',
  paymentMode: '', saleDate: today(),
});

/** One entry in the search list: a single handset, or an accessory pool. */
interface PickOption {
  id: string;
  source: StockSource;
  label: string;
  detail: string;
  /** Everything the search matches against, lowercased. */
  search: string;
  unit?: InventoryUnit;
  accessory?: AccessoryStock;
}

const money = (n: number | undefined): string =>
  n === undefined || Number.isNaN(n) ? '' : n.toFixed(2);

interface Props {
  units: InventoryUnit[];      // sellable office stock
  shsUnits: InventoryUnit[];   // sellable SHS units
  accessoryStock: AccessoryStock[];
  supplierMap: Record<string, string>;
  onClose: () => void;
  onSaved?: () => void;
}

export default function BulkSaleModal({
  units, shsUnits, accessoryStock, supplierMap, onClose, onSaved,
}: Props) {
  const [tab, setTab] = useState<Marketplace>(ACTIVE_PLATFORMS[0]);
  const [rows, setRows] = useState<Row[]>([blankRow(ACTIVE_PLATFORMS[0])]);
  const [saving, setSaving] = useState(false);
  const [results, setResults] = useState<BulkSaleLineResult[] | null>(null);
  const [openPicker, setOpenPicker] = useState<string | null>(null);

  // ── Every sellable thing, one entry per handset ──────────────────────────
  // Listed individually rather than grouped by model, because the operator
  // searches by IMEI as often as by name — and an IMEI identifies one handset,
  // so a grouped list would make them pick the model and then hunt for the
  // number they already typed.
  const options = useMemo<PickOption[]>(() => {
    const list: PickOption[] = [];
    const addUnit = (u: InventoryUnit, source: StockSource) => {
      const supplier = u.supplierName || (u.supplierId ? supplierMap[u.supplierId] : '') || '';
      const bits = [u.storage, u.colour, supplier].filter(Boolean);
      list.push({
        id: u.id,
        source,
        label: (u.model || u.sku || 'Unknown model').trim(),
        detail: [u.imei || 'no IMEI yet', ...bits].join(' · '),
        search: [u.model, u.sku, u.imei, u.storage, u.colour, supplier]
          .filter(Boolean).join(' ').toLowerCase(),
        unit: u,
      });
    };
    for (const u of units) addUnit(u, 'office');
    for (const u of shsUnits) addUnit(u, 'shs');
    for (const a of accessoryStock) {
      if ((a.quantity ?? 0) <= 0) continue;
      list.push({
        id: `acc::${a.id}`,
        source: 'accessory',
        label: a.name || a.sku,
        detail: `${a.quantity} in pool${a.supplierName ? ` · ${a.supplierName}` : ''}`,
        search: [a.name, a.sku, a.supplierName].filter(Boolean).join(' ').toLowerCase(),
        accessory: a,
      });
    }
    return list.sort((x, y) => x.label.localeCompare(y.label) || x.detail.localeCompare(y.detail));
  }, [units, shsUnits, accessoryStock, supplierMap]);

  /** Units already spoken for by another row — a handset sells once. */
  const claimed = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) if (r.pick?.kind === 'unit') s.add(r.pick.unit.id);
    return s;
  }, [rows]);

  const patch = (key: string, p: Partial<Row>) =>
    setRows(rs => rs.map(r => (r.key === key ? { ...r, ...p } : r)));

  const choose = (key: string, opt: PickOption) => {
    setOpenPicker(null);
    if (opt.accessory) {
      patch(key, { pick: { kind: 'accessory', accessory: opt.accessory }, query: opt.label });
      return;
    }
    patch(key, {
      pick: { kind: 'unit', unit: opt.unit!, isSHS: opt.source === 'shs' },
      query: `${opt.label}${opt.unit!.imei ? ` · ${opt.unit!.imei}` : ''}`,
    });
  };

  /** What this row's search offers: its source, minus anything already taken. */
  const matchesFor = (r: Row): PickOption[] => {
    const q = r.query.trim().toLowerCase();
    return options.filter(o =>
      o.source === r.source
      && (!q || o.search.includes(q))
      // The handset this row already holds stays listed, so re-opening the
      // list does not make the current pick look like it vanished.
      && (!o.unit || !claimed.has(o.unit.id)
          || (r.pick?.kind === 'unit' && o.unit.id === r.pick.unit.id)));
  };

  /** Live financials for a row, or undefined while it is incomplete. */
  const figuresFor = (r: Row): SaleFinancials | undefined => {
    if (!r.pick) return undefined;
    const sp = Number(r.salePrice);
    if (!r.salePrice || Number.isNaN(sp)) return undefined;
    const qty = Number(r.quantity) || 1;
    const bp = r.pick.kind === 'unit'
      ? Number(r.pick.unit.buyPrice ?? 0)
      : Number(r.pick.accessory.buyPrice ?? 0) * qty;
    const postage = r.postage === '' ? UI_AUTOFILL_POSTAGE[r.marketplace] : Number(r.postage);
    const marketing = r.marketing === '' ? undefined : Number(r.marketing);
    return calcSaleFinancials({
      marketplace: r.marketplace,
      buyPrice: bp,
      salePrice: r.pick.kind === 'accessory' ? sp * qty : sp,
      postageOverride: Number.isNaN(postage) ? 0 : postage,
      marketing: marketing === undefined || Number.isNaN(marketing) ? undefined : marketing,
      hasPayPalKlarna: r.marketplace === 'BM' && !!r.paymentMode,
    } as never);
  };

  /** An SHS unit with no IMEI on file cannot be sold until one is typed. */
  const needsImei = (r: Row): boolean =>
    r.pick?.kind === 'unit' && r.pick.isSHS && !(r.pick.unit.imei || '').trim();

  const isReady = (r: Row): boolean =>
    !!r.pick && !!r.orderNumber.trim() && !!r.salePrice && Number(r.salePrice) > 0
    && (!needsImei(r) || !!r.imei.trim());

  const ready = rows.filter(isReady);
  const tabRows = rows.filter(r => r.marketplace === tab);
  const countFor = (m: Marketplace) => rows.filter(r => r.marketplace === m && isReady(r)).length;

  const addRow = () => setRows(rs => [...rs, blankRow(tab)]);

  /** Switching tabs must land on something typeable. A marketplace nobody has
   *  entered a row for yet would otherwise show an empty sheet with no row and
   *  no obvious way in. */
  const goToTab = (m: Marketplace) => {
    setTab(m);
    setRows(rs => (rs.some(r => r.marketplace === m) ? rs : [...rs, blankRow(m)]));
  };

  const dropRow = (key: string) => setRows(rs => {
    const left = rs.filter(r => r.key !== key);
    // Never leave the active tab with nothing to type into.
    return left.some(r => r.marketplace === tab) ? left : [...left, blankRow(tab)];
  });

  const confirm = async () => {
    setSaving(true);
    const lines: BulkSaleLine[] = ready.map(r => {
      const postage = r.postage === '' ? UI_AUTOFILL_POSTAGE[r.marketplace] : Number(r.postage);
      const marketing = r.marketing === '' ? undefined : Number(r.marketing);
      const common = {
        marketplace: r.marketplace,
        orderNumber: r.orderNumber.trim(),
        salePrice: Number(r.salePrice),
        saleDate: r.saleDate,
        paymentMode: r.paymentMode || undefined,
        postageOverride: Number.isNaN(postage) ? undefined : postage,
        marketing: marketing === undefined || Number.isNaN(marketing) ? undefined : marketing,
      };
      const pick = r.pick!;
      return pick.kind === 'unit'
        ? { kind: 'unit', unit: pick.unit, isSHS: pick.isSHS, sku: pick.unit.sku,
            imei: r.imei.trim() || undefined, ...common }
        : { kind: 'accessory', sku: pick.accessory.sku, quantity: Number(r.quantity) || 1, ...common };
    });
    const res = await recordBulkSales(lines);
    setResults(res.results);
    setSaving(false);
    onSaved?.();
  };

  // ── Cells ────────────────────────────────────────────────────────────────
  const TH = ({ children, w, right }: { children: ReactNode; w?: string; right?: boolean; key?: Key }) => (
    <th className={`px-2 py-1.5 ${w ?? ''} text-[9px] font-bold uppercase tracking-widest text-slate-500
                    ${right ? 'text-right' : 'text-left'}`}>{children}</th>
  );
  const input = 'w-full px-1.5 py-1 text-[11px] rounded border border-transparent hover:border-slate-200 '
    + 'focus:border-slate-900 focus:outline-none bg-transparent';
  const cols = MARKETPLACE_COLUMNS[tab];

  return (
    <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-3" onClick={onClose}>
      {/* A fixed 92vh rather than max-h: this is a sheet, so the grid needs a
          body to type into even when only one row exists. Sizing to content
          collapsed it to a single line. */}
      <div className="bg-white rounded-2xl w-full max-w-[95vw] h-[92vh] flex flex-col overflow-hidden"
           onClick={e => e.stopPropagation()}>

        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
          <div>
            <h2 className="text-[13px] font-black uppercase tracking-tight text-slate-900">
              Mark Multiple Sold
            </h2>
            <p className="text-[10px] text-slate-500 font-mono uppercase tracking-widest">
              {results ? 'Done' : `${ready.length} of ${rows.length} rows ready`}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close"
                  className="p-2 rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100">
            <X size={16} />
          </button>
        </div>

        {results ? (
          <div className="flex-1 overflow-y-auto px-5 py-4">
            <p className="text-[13px] font-bold text-slate-900">
              {results.filter(r => r.ok).length} sold
              {results.some(r => !r.ok) ? `, ${results.filter(r => !r.ok).length} failed` : ''}
            </p>
            <div className="mt-3 border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-[11px]">
                <tbody>
                  {results.map((r, i) => (
                    <tr key={i} className="border-t border-slate-100 first:border-0">
                      <td className="px-3 py-1.5 w-8">
                        {r.ok
                          ? <CheckCircle2 size={13} className="text-emerald-600" />
                          : <X size={13} className="text-rose-600" />}
                      </td>
                      <td className="px-3 py-1.5 font-mono">{r.label}</td>
                      <td className="px-3 py-1.5 text-rose-800">{r.ok ? '' : (r.message || r.error)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-[11px] text-slate-600">
              These sales are on their marketplace tabs in the Sales Report, with the fees, VAT
              lines and GP already worked out.
            </p>
          </div>
        ) : (
          <>
            {/* One tab per marketplace, the same five the report has. */}
            <div role="tablist" aria-label="Marketplace"
                 className="flex items-center gap-1 px-4 pt-2 border-b border-slate-200 bg-slate-50">
              {ACTIVE_PLATFORMS.map(m => {
                const n = countFor(m);
                return (
                  <button
                    key={m}
                    role="tab"
                    aria-selected={m === tab}
                    onClick={() => goToTab(m)}
                    className={`px-3 py-2 text-[10px] font-bold uppercase tracking-widest rounded-t-lg
                                border-b-2 -mb-px transition-colors ${m === tab
                      ? 'border-slate-900 text-slate-900 bg-white'
                      : 'border-transparent text-slate-400 hover:text-slate-700'}`}
                  >
                    {PLATFORM_META[m].label}
                    {n > 0 && (
                      <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-emerald-600 text-white
                                       text-[9px] tabular-nums">{n}</span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="flex-1 overflow-auto">
              {/* Width follows the column count rather than a fixed minimum:
                  eBay carries six more columns than Back Market, and a single
                  min-width squashed its SP and BP cells to a couple of
                  characters. The grid scrolls sideways instead. */}
              <table className="w-full border-collapse"
                     style={{ minWidth: `${58 + cols.length * 5.5}rem` }}>
                <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 z-10">
                  <tr>
                    <TH w="w-8">#</TH>
                    <TH w="w-28">Source</TH>
                    <TH w="w-64">Model</TH>
                    <TH w="w-44">IMEI / Qty</TH>
                    <TH w="w-32">Supplier</TH>
                    <TH w="w-36">Order Number</TH>
                    {tab === 'BM' && <TH w="w-32">Payment Mode</TH>}
                    <TH w="w-24" right>BP</TH>
                    <TH w="w-24" right>SP</TH>
                    {cols.map(c => <TH key={c.header} w="w-24" right>{c.header}</TH>)}
                    <TH w="w-8"> </TH>
                  </tr>
                </thead>
                <tbody>
                  {tabRows.map((r, i) => {
                    const f = figuresFor(r);
                    const bp = r.pick?.kind === 'unit'
                      ? r.pick.unit.buyPrice
                      : r.pick?.accessory.buyPrice;
                    const supplier = r.pick?.kind === 'unit'
                      ? (r.pick.unit.supplierName
                         || (r.pick.unit.supplierId ? supplierMap[r.pick.unit.supplierId] : '') || '—')
                      : (r.pick?.accessory.supplierName || '—');

                    return (
                      <tr key={r.key as Key}
                          className={`border-b border-slate-100 ${isReady(r) ? 'bg-emerald-50/40' : ''}`}>
                        <td className="px-2 py-1 text-[10px] font-mono text-slate-400">{i + 1}</td>

                        {/* Say what you are selling before looking for it. */}
                        <td className="px-1 py-1">
                          <select
                            className={input}
                            aria-label="Source"
                            value={r.source}
                            onChange={e => patch(r.key, {
                              // Changing source invalidates the pick — an
                              // office handset is not an SHS one.
                              source: e.target.value as StockSource,
                              pick: undefined, query: '', imei: '',
                            })}
                          >
                            {(Object.keys(SOURCE_LABEL) as StockSource[]).map(s => (
                              <option key={s} value={s}>{SOURCE_LABEL[s]}</option>
                            ))}
                          </select>
                        </td>

                        {/* Model — searches stock by name, IMEI, SKU or supplier */}
                        <td className="px-1 py-1 relative">
                          <div className="flex items-center gap-1">
                            {r.source === 'accessory'
                              ? <Tag size={11} className="text-indigo-500 flex-shrink-0" />
                              : r.source === 'shs'
                                ? <Truck size={11} className="text-amber-500 flex-shrink-0" />
                                : <Package size={11} className="text-slate-300 flex-shrink-0" />}
                            <input
                              className={input}
                              aria-label="Model"
                              placeholder={r.source === 'accessory'
                                ? 'Search accessories…' : 'Search model or IMEI…'}
                              value={r.query}
                              onFocus={() => setOpenPicker(r.key)}
                              onChange={e => { patch(r.key, { query: e.target.value, pick: undefined }); setOpenPicker(r.key); }}
                            />
                          </div>
                          {openPicker === r.key && (
                            <StockPicker
                              options={matchesFor(r)}
                              onPick={o => choose(r.key, o)}
                              onDismiss={() => setOpenPicker(null)}
                            />
                          )}
                        </td>

                        {/* IMEI (units) or quantity (accessories) */}
                        <td className="px-1 py-1">
                          {r.source === 'accessory' ? (
                            <input type="number" min={1} className={`${input} text-right`}
                                   aria-label="Quantity"
                                   value={r.quantity}
                                   onChange={e => patch(r.key, { quantity: e.target.value })} />
                          ) : needsImei(r) ? (
                            <input
                              className={`${input} font-mono border-amber-300`}
                              aria-label="IMEI"
                              placeholder="IMEI required"
                              value={r.imei}
                              onChange={e => patch(r.key, { imei: e.target.value })}
                            />
                          ) : r.pick?.kind === 'unit' ? (
                            <span className="px-1.5 text-[11px] font-mono text-slate-600">
                              {r.pick.unit.imei}
                            </span>
                          ) : <span className="text-[10px] text-slate-300 px-1.5">—</span>}
                        </td>

                        <td className="px-2 py-1 text-[10px] text-slate-500 truncate">{supplier}</td>

                        <td className="px-1 py-1">
                          <input className={`${input} font-mono`} aria-label="Order number"
                                 placeholder="order no."
                                 value={r.orderNumber}
                                 onChange={e => patch(r.key, { orderNumber: e.target.value })} />
                        </td>

                        {tab === 'BM' && (
                          <td className="px-1 py-1">
                            <select className={`${input} text-[10px]`} aria-label="Payment mode"
                                    value={r.paymentMode}
                                    onChange={e => patch(r.key, { paymentMode: e.target.value })}>
                              {BM_PAYMENT_MODES.map(p => (
                                <option key={p} value={p}>{p || 'payment mode…'}</option>
                              ))}
                            </select>
                          </td>
                        )}

                        {/* From the unit — shown, not typed. */}
                        <td className="px-2 py-1 text-right text-[11px] font-mono text-slate-500 tabular-nums">
                          {bp === undefined ? '' : money(Number(bp))}
                        </td>

                        <td className="px-1 py-1">
                          <input type="number" step="0.01" className={`${input} text-right font-mono tabular-nums`}
                                 aria-label="Sale price"
                                 placeholder="0.00" value={r.salePrice}
                                 onChange={e => patch(r.key, { salePrice: e.target.value })} />
                        </td>

                        {/* This marketplace's own columns, in its own order. */}
                        {cols.map(c => c.input ? (
                          <td key={c.header} className="px-1 py-1">
                            {/* Postage's placeholder is the marketplace autofill, which
                                is "0.00" on eBay and so cannot be told apart from the SP
                                cell by placeholder alone. Every cell carries a label. */}
                            <input type="number" step="0.01"
                                   className={`${input} text-right font-mono tabular-nums`}
                                   aria-label={c.header}
                                   placeholder={c.input === 'postage'
                                     ? money(UI_AUTOFILL_POSTAGE[r.marketplace]) : '0.00'}
                                   value={c.input === 'postage' ? r.postage : r.marketing}
                                   onChange={e => patch(r.key, c.input === 'postage'
                                     ? { postage: e.target.value }
                                     : { marketing: e.target.value })} />
                          </td>
                        ) : (
                          <td key={c.header}
                              className={`px-2 py-1 text-right text-[11px] font-mono tabular-nums
                                ${c.field === 'grossProfit'
                                  ? `font-bold ${(f?.grossProfit ?? 0) < 0 ? 'text-rose-600' : 'text-slate-900'}`
                                  : 'text-slate-500'}`}>
                            {money(f?.[c.field!] as number | undefined)}
                          </td>
                        ))}

                        <td className="px-1 py-1">
                          <button onClick={() => dropRow(r.key)} aria-label="Remove row"
                                  className="p-1 text-slate-300 hover:text-rose-600">
                            <Trash2 size={12} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <button onClick={addRow}
                      className="m-3 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed
                                 border-slate-300 text-[10px] font-bold uppercase tracking-widest
                                 text-slate-500 hover:border-slate-900 hover:text-slate-900">
                <Plus size={12} /> Add row
              </button>
            </div>
          </>
        )}

        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-slate-200 bg-slate-50">
          <p className="text-[10px] text-slate-500">
            {results
              ? 'Nothing else to do — the sales are recorded.'
              : `${PLATFORM_META[tab].label} · pick a source, then search stock by model or IMEI. BP and Supplier come from the unit.`}
          </p>
          {results ? (
            <button onClick={onClose}
                    className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-[10px] font-bold
                               uppercase tracking-widest hover:bg-slate-700">
              Close
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button onClick={onClose}
                      className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600
                                 text-[10px] font-bold uppercase tracking-widest hover:bg-slate-100">
                Cancel
              </button>
              <button
                onClick={confirm}
                disabled={!ready.length || saving}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white
                           text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-700
                           disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {saving ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                Confirm {ready.length} Sale{ready.length === 1 ? '' : 's'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** The Model cell's search list — stock only, never a bare catalog. */
function StockPicker({
  options, onPick, onDismiss,
}: {
  options: PickOption[];
  onPick: (o: PickOption) => void;
  onDismiss: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // The list is positioned FIXED against the Model cell rather than absolutely
  // inside it. Absolute positioning put it inside two clipping ancestors — the
  // grid's `overflow-auto` and the modal's `overflow-hidden` — so on a short
  // grid it was cut off mid-list and the stock underneath was unreachable.
  // z-index cannot defeat a clipping ancestor; leaving the flow can.
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    const cell = ref.current?.parentElement;
    if (!cell) return;
    const place = () => {
      const r = cell.getBoundingClientRect();
      // Flip above the cell when there is no room below it.
      const below = window.innerHeight - r.bottom;
      setAt({
        top: below < 200 ? Math.max(8, r.top - 264) : r.bottom + 4,
        left: Math.min(r.left, window.innerWidth - 344),
      });
    };
    place();
    window.addEventListener('resize', place);
    // Scrolling an ancestor would leave the list floating away from its cell,
    // so follow the cell rather than closing.
    //
    // Following, NOT dismissing: a capture-phase scroll listener that closed
    // the list also fired when the TEXT scrolled inside the Model input, which
    // any query longer than the narrow cell does. The effect was that short
    // searches worked and long ones — a full 15-digit IMEI, a supplier name —
    // silently returned nothing, because the list was torn down as the
    // operator typed.
    document.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      document.removeEventListener('scroll', place, true);
    };
  }, []);

  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onDismiss();
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [onDismiss]);

  return (
    <div ref={ref}
         role="listbox"
         aria-label="Stock"
         style={at ? { top: at.top, left: at.left } : { visibility: 'hidden' }}
         className="fixed w-84 max-h-64 overflow-auto z-[9999] bg-white
                    border border-slate-200 rounded-lg shadow-lg">
      <div className="sticky top-0 px-3 py-1.5 bg-white border-b border-slate-100 flex items-center gap-1.5
                      text-[9px] uppercase tracking-widest text-slate-500 font-mono">
        <Search size={10} />
        {options.length ? `${options.length} in stock` : 'nothing in stock matches'}
      </div>
      {options.map(o => (
        <button
          key={o.id}
          type="button"
          role="option"
          onMouseDown={e => e.preventDefault()}
          onClick={() => onPick(o)}
          className="w-full text-left px-3 py-2 flex items-center justify-between gap-2 hover:bg-slate-50"
        >
          <span className="min-w-0">
            <span className="block text-[11px] font-semibold truncate">{o.label}</span>
            <span className="block text-[9px] font-mono text-slate-500 truncate">{o.detail}</span>
          </span>
          <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400 flex-shrink-0">
            {o.source === 'accessory' ? 'pool' : o.source === 'shs' ? 'SHS' : 'stock'}
          </span>
        </button>
      ))}
    </div>
  );
}
