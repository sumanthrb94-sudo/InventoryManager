/**
 * AccessoryStockPanel — the no-IMEI quantity pools (see AccessoryStock in
 * types.ts). New pools / top-ups are added via the "Accessories" tab in Add
 * Stock; this panel is where an admin sees current levels, adjusts/returns
 * stock outside the Sales Report import path, and reviews the transaction
 * ledger behind each SKU's running quantity (see AccessoryStockEvent).
 *
 * Shared between Admin → Configuration and the Buy screen's Accessory Stock
 * tile — same panel, two entry points, so accessory management isn't buried
 * one level deeper than everything else on Buy.
 */
import React, { useMemo, useState } from 'react';
import { History, Trash2, Package } from 'lucide-react';
import { dbService } from '../lib/dbService';
import { useInventoryStore } from '../lib/inventoryStore';
import AccessoryStockActionModal from './AccessoryStockActionModal';
import type { AccessoryStock, AccessoryStockEvent } from '../types';

/** Human-readable line for one ledger row in the per-SKU history strip. */
function describeAccessoryEvent(e: AccessoryStockEvent): string {
  const sign = e.delta > 0 ? '+' : '';
  switch (e.type) {
    case 'topup':      return `Topped up ${sign}${e.delta} → ${e.quantityAfter}`;
    case 'sale': {
      const via = e.source === 'sales_report_import'
        ? (e.orderNumber ? `order ${e.orderNumber}` : 'Sales Report import')
        : (e.orderNumber ? `manual · ${e.orderNumber}` : 'manual sale');
      // "Sold" already conveys direction — showing the signed delta here
      // would read as "Sold -3", a redundant minus sign.
      return `Sold ${Math.abs(e.delta)} (${via}) → ${e.quantityAfter}`;
    }
    case 'adjustment': return `Adjusted ${sign}${e.delta} → ${e.quantityAfter}${e.reason ? ` · ${e.reason}` : ''}`;
    case 'return':     return `Returned ${sign}${e.delta} → ${e.quantityAfter}`;
    case 'restore':    return `Restored from Inventory Report → ${e.quantityAfter}`;
    default:           return `${sign}${e.delta} → ${e.quantityAfter}`;
  }
}

interface Props {
  /** Omits the outer card chrome (header/border) when embedded inside
   *  another modal/card that already provides it — e.g. the Buy screen's
   *  Accessory Stock overlay. */
  bare?: boolean;
  /** Hides the Adjust/Return action buttons — the Buy screen's Accessory
   *  Stock overlay is for topping up pools (that's what "Buy" means here),
   *  not for selling/adjusting/returning stock; those actions live on the
   *  Sell/Inventory screen (where a sale is actually recorded) and on
   *  Configuration. History stays visible either way — it's read-only. */
  showActions?: boolean;
}

export default function AccessoryStockPanel({ bare = false, showActions = true }: Props) {
  const { accessoryStock, accessoryStockEvents } = useInventoryStore();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [actionFor, setActionFor] = useState<{ accessory: AccessoryStock; mode: 'adjust' | 'return' } | null>(null);
  const sorted = useMemo(
    () => [...accessoryStock].sort((a, b) => a.sku.localeCompare(b.sku)),
    [accessoryStock],
  );
  const eventsBySkuId = useMemo(() => {
    const map = new Map<string, AccessoryStockEvent[]>();
    for (const e of accessoryStockEvents) {
      const list = map.get(e.skuId) ?? [];
      list.push(e);
      map.set(e.skuId, list);
    }
    for (const list of map.values()) {
      list.sort((x, y) => {
        const tx = typeof x.createdAt === 'string' ? x.createdAt : '';
        const ty = typeof y.createdAt === 'string' ? y.createdAt : '';
        return ty.localeCompare(tx);
      });
    }
    return map;
  }, [accessoryStockEvents]);

  const removeSku = async (id: string, sku: string) => {
    const sure = window.confirm(`Remove accessory SKU "${sku}" from stock? This deletes the pool entirely — use it only when the SKU is discontinued.`);
    if (!sure) return;
    await dbService.delete('accessoryStock', id);
  };

  const table = (
    <>
      {sorted.length === 0 ? (
        <p className="text-[11px] font-mono text-slate-400">No accessory SKUs yet.</p>
      ) : (
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-left text-[9px] font-bold uppercase tracking-widest text-slate-400 border-b border-slate-100">
              <th className="pb-2 pr-3">SKU</th>
              <th className="pb-2 pr-3">Name</th>
              <th className="pb-2 pr-3">Supplier</th>
              <th className="pb-2 pr-3 text-right">Qty</th>
              <th className="pb-2 pr-3 text-right">BP</th>
              {showActions && <th className="pb-2 w-40" />}
              <th className="pb-2 w-8" />
            </tr>
          </thead>
          <tbody>
            {sorted.map(a => {
              const history = eventsBySkuId.get(a.id) ?? [];
              const isOpen = expanded === a.id;
              return (
                <React.Fragment key={a.id}>
                  <tr className="border-b border-slate-50 last:border-0">
                    <td className="py-1.5 pr-3 font-mono">{a.sku}</td>
                    <td className="py-1.5 pr-3">{a.name}</td>
                    <td className="py-1.5 pr-3 text-slate-500">{a.supplierName || '—'}</td>
                    <td className={`py-1.5 pr-3 text-right font-mono font-bold ${a.quantity === 0 ? 'text-rose-500' : 'text-slate-700'}`}>{a.quantity}</td>
                    <td className="py-1.5 pr-3 text-right font-mono text-slate-500">£{(a.buyPrice ?? 0).toFixed(2)}</td>
                    {showActions && (
                      <td className="py-1.5 pr-3">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setActionFor({ accessory: a, mode: 'adjust' })}
                            className="px-2 py-1 rounded bg-amber-100 text-amber-800 text-[9px] font-bold uppercase tracking-widest hover:bg-amber-200"
                          >
                            Adjust
                          </button>
                          <button
                            onClick={() => setActionFor({ accessory: a, mode: 'return' })}
                            className="px-2 py-1 rounded bg-emerald-100 text-emerald-800 text-[9px] font-bold uppercase tracking-widest hover:bg-emerald-200"
                          >
                            Return
                          </button>
                        </div>
                      </td>
                    )}
                    <td className="py-1.5">
                      <div className="flex items-center gap-0.5">
                        <button
                          onClick={() => setExpanded(isOpen ? null : a.id)}
                          className="p-1 text-gray-300 hover:text-indigo-500 hover:bg-indigo-50 rounded transition-all"
                          title="History"
                        >
                          <History size={11} />
                        </button>
                        <button
                          onClick={() => removeSku(a.id, a.sku)}
                          className="p-1 text-gray-300 hover:text-rose-500 hover:bg-rose-50 rounded transition-all"
                          title="Remove SKU"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-slate-50/60">
                      <td colSpan={showActions ? 7 : 6} className="px-3 py-2">
                        {history.length === 0 ? (
                          <p className="text-[10px] font-mono text-slate-400 py-1">No ledger history yet.</p>
                        ) : (
                          <ul className="space-y-1">
                            {history.slice(0, 10).map(e => (
                              <li key={e.id} className="flex items-center justify-between gap-3 text-[10px] font-mono text-slate-600">
                                <span className="truncate">{describeAccessoryEvent(e)}</span>
                                <span className="text-slate-400 flex-shrink-0">
                                  {typeof e.createdAt === 'string' ? e.createdAt.slice(0, 10) : ''}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      )}
      {actionFor && (
        <AccessoryStockActionModal
          accessory={actionFor.accessory}
          initialMode={actionFor.mode}
          onClose={() => setActionFor(null)}
        />
      )}
    </>
  );

  if (bare) {
    return <div className="px-1 py-1">{table}</div>;
  }

  return (
    <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100">
        <div className="w-8 h-8 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center">
          <Package size={14} />
        </div>
        <div className="min-w-0">
          <h3 className="text-[13px] font-bold tracking-tight">Accessory Stock</h3>
          <p className="text-[10px] font-mono text-slate-400">
            No-IMEI quantity pools (chargers, SIM pins, cables) — add / top up from Add Stock → Accessories
          </p>
        </div>
      </div>
      <div className="px-5 py-4">
        {table}
      </div>
    </div>
  );
}
