/**
 * BulkSaleModal — "Mark Multiple Sold", as a spreadsheet.
 *
 * The operator sells in batches and thinks in rows, so this is a grid with the
 * Sales Report's columns rather than a stack of per-sale cards. Type into a
 * row and it fills itself in:
 *
 *   Model ▾  →  searches STOCK, not a catalog. Picking one narrows the IMEI
 *               dropdown beside it to the handsets you actually hold.
 *   IMEI ▾   →  choosing the handset brings its Supplier and BP with it. They
 *               are shown, not typed: BP is what the unit was bought for, and
 *               a hand-typed one would disagree with the buy record.
 *   SP, Postage, Order Number  →  yours to fill.
 *   SP-BP, Marginal Tax, Commission, Total VAT, GP, GP %  →  computed live by
 *               calcSaleFinancials, the same function behind every other sale.
 *
 * A row can only sell a handset that is in stock. That is what makes the grid
 * safe: it cannot invent a unit, so stock and the reports cannot drift apart.
 * Accessory pools appear in the same Model dropdown and become quantity rows.
 *
 * Every line still goes through recordBulkSales(), so a sale entered here is
 * the same write as one recorded singly — same fees, same VAT lines, same
 * audit trail — and lands on its marketplace tab in the Sales Report as usual.
 */
import { useState, useMemo, useRef, useEffect, useLayoutEffect, type Key, type ReactNode } from 'react';
import { X, Plus, CheckCircle2, Trash2, Truck, Package, Tag, Loader2 } from 'lucide-react';
import type { InventoryUnit, AccessoryStock, Marketplace } from '../types';
import { calcSaleFinancials } from '../lib/platforms';
import { recordBulkSales, type BulkSaleLine, type BulkSaleLineResult } from '../services/salesService';
import { ACTIVE_PLATFORMS, PLATFORM_META, BM_PAYMENT_MODES } from './SellOrderModal';

const today = () => new Date().toISOString().split('T')[0];

/** What the postage cell starts at per marketplace. UI convenience only —
 *  calcSaleFinancials defaults postage to 0 and takes what it is given. */
const UI_AUTOFILL_POSTAGE: Record<Marketplace, number> = {
  AMAZON: 6.30, BM: 6.30, ONBUY: 6.30, EBAY: 0, TEMU: 6.30,
};

// ── What a row can be selling ──────────────────────────────────────────────

type Pick =
  | { kind: 'unit'; unit: InventoryUnit; isSHS: boolean }
  | { kind: 'accessory'; accessory: AccessoryStock };

interface Row {
  key: string;
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
  paymentMode: string;
  saleDate: string;
}

let seq = 0;
const blankRow = (): Row => ({
  key: `r${++seq}`, query: '', imei: '', marketplace: 'EBAY', orderNumber: '',
  quantity: '1', salePrice: '', postage: '', paymentMode: '', saleDate: today(),
});

/** One entry in the Model dropdown: a model you hold, or an accessory pool. */
interface ModelOption {
  id: string;
  label: string;
  detail: string;
  /** Everything the Model cell matches against, lowercased — model, supplier
   *  and SKU, so the operator can find a line by any of them. */
  search: string;
  kind: 'unit' | 'accessory';
  units?: InventoryUnit[];
  isSHS?: boolean;
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
  const [rows, setRows] = useState<Row[]>([blankRow()]);
  const [saving, setSaving] = useState(false);
  const [results, setResults] = useState<BulkSaleLineResult[] | null>(null);
  const [openPicker, setOpenPicker] = useState<string | null>(null);

  // ── The stock, grouped the way the dropdown offers it ────────────────────
  const options = useMemo<ModelOption[]>(() => {
    type Bucket = ModelOption & { suppliers: Set<string>; skus: Set<string> };
    const byModel = new Map<string, Bucket>();
    const add = (u: InventoryUnit, isSHS: boolean) => {
      const label = (u.model || u.sku || 'Unknown model').trim();
      const id = `${isSHS ? 'shs' : 'off'}::${label.toUpperCase()}`;
      let hit = byModel.get(id);
      if (!hit) {
        hit = { id, label, detail: '', search: '', kind: 'unit', units: [], isSHS,
                suppliers: new Set(), skus: new Set() };
        byModel.set(id, hit);
      }
      hit.units!.push(u);
      const supplier = u.supplierName || (u.supplierId ? supplierMap[u.supplierId] : '');
      if (supplier) hit.suppliers.add(supplier);
      if (u.sku) hit.skus.add(u.sku);
    };
    for (const u of units) add(u, false);
    for (const u of shsUnits) add(u, true);

    const list: ModelOption[] = [...byModel.values()].map(({ suppliers, skus, ...o }) => {
      // Office and SHS stock of the SAME model are two separate entries that
      // read identically without this — naming the supplier is what tells the
      // operator which line they are about to sell off.
      const only = suppliers.size === 1 ? [...suppliers][0] : '';
      return {
        ...o,
        detail: `${o.units!.length} in ${o.isSHS ? 'SHS' : 'stock'}${only ? ` · ${only}` : ''}`,
        // Searchable by supplier and SKU as well as model, matching how the
        // single-sale SellSheet picker behaves. Searching the model alone
        // cannot separate two same-model groups from different suppliers.
        search: [o.label, ...suppliers, ...skus].join(' ').toLowerCase(),
      };
    });
    for (const a of accessoryStock) {
      if ((a.quantity ?? 0) <= 0) continue;
      list.push({
        id: `acc::${a.id}`, label: a.name || a.sku, detail: `${a.quantity} in pool`,
        search: [a.name, a.sku, a.supplierName].filter(Boolean).join(' ').toLowerCase(),
        kind: 'accessory', accessory: a,
      });
    }
    return list.sort((x, y) => x.label.localeCompare(y.label));
  }, [units, shsUnits, accessoryStock, supplierMap]);

  /** Units already spoken for by another row — a handset sells once. */
  const claimed = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) if (r.pick?.kind === 'unit') s.add(r.pick.unit.id);
    return s;
  }, [rows]);

  const patch = (key: string, p: Partial<Row>) =>
    setRows(rs => rs.map(r => (r.key === key ? { ...r, ...p } : r)));

  const choose = (key: string, opt: ModelOption) => {
    setOpenPicker(null);
    if (opt.kind === 'accessory') {
      patch(key, { pick: { kind: 'accessory', accessory: opt.accessory! }, query: opt.label });
      return;
    }
    const free = opt.units!.filter(u => !claimed.has(u.id));
    const unit = free[0] ?? opt.units![0];
    patch(key, { pick: { kind: 'unit', unit, isSHS: !!opt.isSHS }, query: opt.label });
  };

  /** The handsets of this row's model that are still free (plus its own). */
  const siblingsFor = (r: Row): InventoryUnit[] => {
    const pick = r.pick;
    if (pick?.kind !== 'unit') return [];
    const model = (pick.unit.model || pick.unit.sku || '').toUpperCase();
    const pool = pick.isSHS ? shsUnits : units;
    return pool.filter(u =>
      (u.model || u.sku || '').toUpperCase() === model
      && (!claimed.has(u.id) || u.id === pick.unit.id));
  };

  /** Live financials for a row, or undefined while it is incomplete. */
  const figuresFor = (r: Row) => {
    if (!r.pick) return undefined;
    const sp = Number(r.salePrice);
    if (!r.salePrice || Number.isNaN(sp)) return undefined;
    const bp = r.pick.kind === 'unit'
      ? Number(r.pick.unit.buyPrice ?? 0)
      : Number(r.pick.accessory.buyPrice ?? 0) * (Number(r.quantity) || 1);
    const postage = r.postage === '' ? UI_AUTOFILL_POSTAGE[r.marketplace] : Number(r.postage);
    return calcSaleFinancials({
      marketplace: r.marketplace,
      buyPrice: bp,
      salePrice: r.pick.kind === 'accessory' ? sp * (Number(r.quantity) || 1) : sp,
      postageOverride: Number.isNaN(postage) ? 0 : postage,
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

  const confirm = async () => {
    setSaving(true);
    const lines: BulkSaleLine[] = ready.map(r => {
      const postage = r.postage === '' ? UI_AUTOFILL_POSTAGE[r.marketplace] : Number(r.postage);
      const common = {
        marketplace: r.marketplace,
        orderNumber: r.orderNumber.trim(),
        salePrice: Number(r.salePrice),
        saleDate: r.saleDate,
        paymentMode: r.paymentMode || undefined,
        postageOverride: Number.isNaN(postage) ? undefined : postage,
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
  const TH = ({ children, w, right }: { children: ReactNode; w: string; right?: boolean }) => (
    <th className={`px-2 py-1.5 ${w} text-[9px] font-bold uppercase tracking-widest text-slate-500
                    ${right ? 'text-right' : 'text-left'}`}>{children}</th>
  );
  const input = 'w-full px-1.5 py-1 text-[11px] rounded border border-transparent hover:border-slate-200 '
    + 'focus:border-slate-900 focus:outline-none bg-transparent';

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
          <div className="flex-1 overflow-auto">
            <table className="min-w-[92rem] w-full border-collapse">
              <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 z-10">
                <tr>
                  <TH w="w-8">#</TH>
                  <TH w="w-56">Model</TH>
                  <TH w="w-44">IMEI / Qty</TH>
                  <TH w="w-32">Supplier</TH>
                  <TH w="w-36">Marketplace</TH>
                  <TH w="w-36">Order Number</TH>
                  <TH w="w-24" right>BP £</TH>
                  <TH w="w-24" right>SP £</TH>
                  <TH w="w-24" right>Postage</TH>
                  <TH w="w-24" right>SP-BP</TH>
                  <TH w="w-24" right>Mar. Tax</TH>
                  <TH w="w-24" right>Comm.</TH>
                  <TH w="w-24" right>Total VAT</TH>
                  <TH w="w-24" right>GP £</TH>
                  <TH w="w-20" right>GP %</TH>
                  <TH w="w-8"> </TH>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const f = figuresFor(r);
                  const sibs = siblingsFor(r);
                  const bp = r.pick?.kind === 'unit'
                    ? r.pick.unit.buyPrice
                    : r.pick?.accessory.buyPrice;
                  const supplier = r.pick?.kind === 'unit'
                    ? (r.pick.unit.supplierName
                       || (r.pick.unit.supplierId ? supplierMap[r.pick.unit.supplierId] : '') || '—')
                    : (r.pick?.accessory.supplierName || '—');
                  const matches = options.filter(o =>
                    !r.query || o.search.includes(r.query.toLowerCase()));

                  return (
                    <tr key={r.key as Key}
                        className={`border-b border-slate-100 ${isReady(r) ? 'bg-emerald-50/40' : ''}`}>
                      <td className="px-2 py-1 text-[10px] font-mono text-slate-400">{i + 1}</td>

                      {/* Model — searches stock */}
                      <td className="px-1 py-1 relative">
                        <div className="flex items-center gap-1">
                          {r.pick?.kind === 'accessory'
                            ? <Tag size={11} className="text-indigo-500 flex-shrink-0" />
                            : r.pick?.kind === 'unit' && r.pick.isSHS
                              ? <Truck size={11} className="text-amber-500 flex-shrink-0" />
                              : <Package size={11} className="text-slate-300 flex-shrink-0" />}
                          <input
                            className={input}
                            aria-label="Model"
                            placeholder="Search stock…"
                            value={r.query}
                            onFocus={() => setOpenPicker(r.key)}
                            onChange={e => { patch(r.key, { query: e.target.value, pick: undefined }); setOpenPicker(r.key); }}
                          />
                        </div>
                        {openPicker === r.key && (
                          <ModelDropdown
                            options={matches}
                            claimed={claimed}
                            onPick={o => choose(r.key, o)}
                            onDismiss={() => setOpenPicker(null)}
                          />
                        )}
                      </td>

                      {/* IMEI (units) or quantity (accessories) */}
                      <td className="px-1 py-1">
                        {r.pick?.kind === 'accessory' ? (
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
                        ) : r.pick ? (
                          <select
                            className={`${input} font-mono`}
                            aria-label="IMEI"
                            value={r.pick.unit.id}
                            onChange={e => {
                              const u = sibs.find(x => x.id === e.target.value);
                              if (u) patch(r.key, { pick: { kind: 'unit', unit: u, isSHS: (r.pick as { isSHS: boolean }).isSHS } });
                            }}
                          >
                            {sibs.map(u => (
                              <option key={u.id} value={u.id}>
                                {u.imei || '(no IMEI)'}{u.storage ? ` · ${u.storage}` : ''}
                              </option>
                            ))}
                          </select>
                        ) : <span className="text-[10px] text-slate-300 px-1.5">—</span>}
                      </td>

                      <td className="px-2 py-1 text-[10px] text-slate-500 truncate">{supplier}</td>

                      <td className="px-1 py-1">
                        <select className={input} aria-label="Marketplace" value={r.marketplace}
                                onChange={e => patch(r.key, { marketplace: e.target.value as Marketplace, postage: '' })}>
                          {ACTIVE_PLATFORMS.map(m => (
                            <option key={m} value={m}>{PLATFORM_META[m].label}</option>
                          ))}
                        </select>
                        {r.marketplace === 'BM' && (
                          <select className={`${input} text-[10px] text-slate-500`} aria-label="Payment mode"
                                  value={r.paymentMode}
                                  onChange={e => patch(r.key, { paymentMode: e.target.value })}>
                            {BM_PAYMENT_MODES.map(p => (
                              <option key={p} value={p}>{p || 'payment mode…'}</option>
                            ))}
                          </select>
                        )}
                      </td>

                      <td className="px-1 py-1">
                        <input className={`${input} font-mono`} aria-label="Order number" placeholder="order no."
                               value={r.orderNumber}
                               onChange={e => patch(r.key, { orderNumber: e.target.value })} />
                      </td>

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
                      <td className="px-1 py-1">
                        {/* Postage's placeholder is the marketplace's autofill, which is
                            "0.00" on some tariffs — so it cannot be told apart from the
                            SP cell by placeholder alone. Both carry an aria-label. */}
                        <input type="number" step="0.01" className={`${input} text-right font-mono tabular-nums`}
                               aria-label="Postage"
                               placeholder={money(UI_AUTOFILL_POSTAGE[r.marketplace])}
                               value={r.postage}
                               onChange={e => patch(r.key, { postage: e.target.value })} />
                      </td>

                      {/* Computed — the same calculator every other sale uses. */}
                      {[f?.spMinusBp, f?.marginalTax, f?.commission, f?.totalVat].map((v, k) => (
                        <td key={k} className="px-2 py-1 text-right text-[11px] font-mono text-slate-500 tabular-nums">
                          {money(v)}
                        </td>
                      ))}
                      <td className={`px-2 py-1 text-right text-[11px] font-mono font-bold tabular-nums
                                      ${(f?.grossProfit ?? 0) < 0 ? 'text-rose-700' : 'text-slate-900'}`}>
                        {money(f?.grossProfit)}
                      </td>
                      <td className="px-2 py-1 text-right text-[11px] font-mono text-slate-500 tabular-nums">
                        {money(f?.gpPercent)}
                      </td>

                      <td className="px-1 py-1">
                        {rows.length > 1 && (
                          <button onClick={() => setRows(rs => rs.filter(x => x.key !== r.key))}
                                  aria-label={`Remove row ${i + 1}`}
                                  className="p-1 text-slate-300 hover:text-rose-600">
                            <Trash2 size={12} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <button onClick={() => setRows(rs => [...rs, blankRow()])}
                    className="m-3 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed
                               border-slate-300 text-[10px] font-bold uppercase tracking-widest
                               text-slate-500 hover:border-slate-900 hover:text-slate-900">
              <Plus size={12} /> Add row
            </button>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-slate-200 bg-slate-50">
          <p className="text-[10px] text-slate-500">
            {results
              ? 'Recorded through the same path as a single sale.'
              : 'Pick a model to see the handsets you hold. BP and Supplier come from the unit.'}
          </p>
          <div className="flex items-center gap-2">
            {results ? (
              <button onClick={onClose}
                      className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-[10px] font-bold
                                 uppercase tracking-widest hover:bg-slate-700">Close</button>
            ) : (
              <>
                <button onClick={onClose}
                        className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600
                                   text-[10px] font-bold uppercase tracking-widest hover:bg-white">Cancel</button>
                <button
                  onClick={confirm}
                  disabled={ready.length === 0 || saving}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white
                             text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-700
                             disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {saving ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                  Confirm {ready.length} {ready.length === 1 ? 'Sale' : 'Sales'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The Model cell's suggestion list — stock only, never a bare catalog. */
function ModelDropdown({
  options, claimed, onPick, onDismiss,
}: {
  options: ModelOption[];
  claimed: Set<string>;
  onPick: (o: ModelOption) => void;
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
        left: Math.min(r.left, window.innerWidth - 296),
      });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, []);

  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onDismiss();
    };
    document.addEventListener('mousedown', away);
    // Scrolling the grid would leave the list floating away from its cell.
    document.addEventListener('scroll', onDismiss, true);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('scroll', onDismiss, true);
    };
  }, [onDismiss]);

  return (
    <div ref={ref}
         style={at ? { top: at.top, left: at.left } : { visibility: 'hidden' }}
         className="fixed w-72 max-h-64 overflow-auto z-[9999] bg-white
                    border border-slate-200 rounded-lg shadow-lg">
      <div className="px-3 py-1.5 border-b border-slate-100 text-[9px] uppercase tracking-widest
                      text-slate-500 font-mono">
        {options.length ? `${options.length} in stock` : 'nothing in stock matches'}
      </div>
      {options.map(o => {
        const free = o.kind === 'unit'
          ? o.units!.filter(u => !claimed.has(u.id)).length
          : (o.accessory!.quantity ?? 0);
        return (
          <button
            key={o.id}
            type="button"
            disabled={free === 0}
            onMouseDown={e => e.preventDefault()}
            onClick={() => onPick(o)}
            className="w-full text-left px-3 py-2 flex items-center justify-between gap-2
                       hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span className="min-w-0">
              <span className="block text-[11px] font-semibold truncate">{o.label}</span>
              <span className="block text-[9px] font-mono text-slate-500">{o.detail}</span>
            </span>
            <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400 flex-shrink-0">
              {free === 0 ? 'all taken' : o.kind === 'accessory' ? 'pool' : o.isSHS ? 'SHS' : 'stock'}
            </span>
          </button>
        );
      })}
    </div>
  );
}
