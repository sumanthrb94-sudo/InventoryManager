import React, { useMemo, useState } from 'react';
import { X, ChevronUp, ChevronDown, ChevronRight } from 'lucide-react';
import { motion } from 'motion/react';
import { InventoryUnit } from '../types';
import { useInventoryStore } from '../lib/inventoryStore';
import CopyImei from './CopyImei';
import { groupIdenticalUnits } from '../lib/unitGroups';

interface Props {
  units: InventoryUnit[];
  onClose: () => void;
}

export default function InStockModal({ units, onClose }: Props) {
  const { suppliers } = useInventoryStore();
  // Default to most-recent first across the app — overridable via column header.
  const [sortKey, setSortKey] = useState<string>('dateIn');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const supplierMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const s of suppliers) map[s.id] = s.name;
    return map;
  }, [suppliers]);

  // Group identical SKUs (model · storage · grade · supplier · status)
  // into one row each so a 20-unit bulk import surfaces as a single row
  // with × 20 + an expandable per-colour and per-IMEI breakdown rather
  // than 20 visually-identical lines.
  const groups = useMemo(() => groupIdenticalUnits(units), [units]);

  const columns = [
    { key: 'expand', label: '', width: 'w-10', sortable: false },
    { key: 'model', label: 'Model', width: 'w-44', sortable: true },
    { key: 'qty', label: 'Qty', width: 'w-16', sortable: true },
    { key: 'colour', label: 'Colour', width: 'w-44', sortable: true },
    { key: 'storage', label: 'Storage', width: 'w-24', sortable: true },
    { key: 'grade', label: 'Grade', width: 'w-20', sortable: true },
    { key: 'supplier', label: 'Supplier', width: 'w-32', sortable: true },
    { key: 'bp', label: 'Buy Price', width: 'w-28', sortable: true },
    { key: 'dateIn', label: 'Date In', width: 'w-24', sortable: true },
  ];

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortOrder('asc');
    }
  };

  const sortedGroups = useMemo(() => {
    if (!sortKey) return groups;
    const sorted = [...groups];
    sorted.sort((a, b) => {
      const ar = a.representative;
      const br = b.representative;
      let aVal: any = '';
      let bVal: any = '';

      if (sortKey === 'model') { aVal = ar.model; bVal = br.model; }
      else if (sortKey === 'qty') { aVal = a.count; bVal = b.count; }
      else if (sortKey === 'colour') {
        aVal = a.colours.length === 1 ? a.colours[0].colour : `${a.colours.length} colours`;
        bVal = b.colours.length === 1 ? b.colours[0].colour : `${b.colours.length} colours`;
      }
      else if (sortKey === 'storage') { aVal = ar.storage || ''; bVal = br.storage || ''; }
      else if (sortKey === 'grade') { aVal = ar.grade || ''; bVal = br.grade || ''; }
      else if (sortKey === 'supplier') {
        aVal = supplierMap[ar.supplierId] || '';
        bVal = supplierMap[br.supplierId] || '';
      }
      else if (sortKey === 'bp') { aVal = ar.buyPrice; bVal = br.buyPrice; }
      else if (sortKey === 'dateIn') { aVal = ar.dateIn || ''; bVal = br.dateIn || ''; }

      if (typeof aVal === 'string') {
        const cmp = aVal.localeCompare(bVal);
        return sortOrder === 'asc' ? cmp : -cmp;
      } else {
        return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
      }
    });
    return sorted;
  }, [sortKey, sortOrder, groups, supplierMap]);

  const totalBP = units.reduce((s, u) => s + u.buyPrice, 0);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[95] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-white rounded-3xl overflow-hidden w-full max-w-7xl shadow-2xl flex flex-col"
        style={{ maxHeight: '90vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-300 bg-gray-50">
          <div>
            <h2 className="text-lg font-bold text-gray-900">In Stock · Office</h2>
            <p className="text-xs text-gray-600 font-mono mt-1">
              {units.length} units · {groups.length} {groups.length === 1 ? 'SKU' : 'SKUs'} · £{totalBP.toLocaleString()} total buy value
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-lg transition-all">
            <X size={20} className="text-gray-600" />
          </button>
        </div>

        {/* Table Content */}
        <div className="flex-1 overflow-auto">
          {units.length === 0 ? (
            <div className="py-16 flex flex-col items-center gap-2 text-gray-400">
              <p className="text-sm font-mono">No units in stock</p>
            </div>
          ) : (
            <table className="w-full border-collapse">
              {/* Table Header */}
              <thead className="sticky top-0 bg-gray-100 border-b border-gray-300 z-10">
                <tr>
                  {columns.map(col => (
                    <th
                      key={col.key}
                      onClick={() => col.sortable && handleSort(col.key)}
                      className={`${col.width} px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wide border-r border-gray-300 last:border-r-0 ${
                        col.sortable ? 'cursor-pointer hover:bg-gray-200 transition-colors' : ''
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        {col.label}
                        {col.sortable && sortKey === col.key && (
                          sortOrder === 'asc'
                            ? <ChevronUp size={13} className="text-gray-500" />
                            : <ChevronDown size={13} className="text-gray-500" />
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>

              {/* Table Body — one row per (model + storage + grade +
                  supplier + status) group. Click chevron to expand into
                  per-colour breakdown + per-IMEI list. */}
              <tbody>
                {sortedGroups.map(g => {
                  const u = g.representative;
                  const isExpanded = expandedKey === g.key;
                  const colourLabel = g.colours.length === 1
                    ? g.colours[0].colour || '—'
                    : `${g.colours.length} colours`;
                  return (
                    <React.Fragment key={g.key}>
                      <tr
                        className={`border-b border-gray-200 hover:bg-gray-50 cursor-pointer ${
                          isExpanded ? 'bg-blue-50/40' : ''
                        }`}
                        onClick={() => setExpandedKey(isExpanded ? null : g.key)}
                      >
                        <td className="px-2 py-3 text-gray-400 text-center">
                          <ChevronRight
                            size={14}
                            className={`inline-block transition-transform ${isExpanded ? 'rotate-90 text-gray-700' : ''}`}
                          />
                        </td>
                        <td className="px-4 py-3 text-xs font-bold text-gray-900 truncate">{u.model}</td>
                        <td className="px-4 py-3 text-xs font-mono font-bold text-gray-900">
                          {g.count > 1 ? <span>×&nbsp;{g.count}</span> : <span className="text-gray-500">1</span>}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-700">{colourLabel}</td>
                        <td className="px-4 py-3 text-xs text-gray-700">{u.storage || '—'}</td>
                        <td className="px-4 py-3 text-xs text-gray-700 font-semibold">{u.grade || '—'}</td>
                        <td className="px-4 py-3 text-xs text-gray-700">{supplierMap[u.supplierId] || '—'}</td>
                        <td className="px-4 py-3 text-xs font-mono font-bold text-gray-900">
                          £{u.buyPrice.toFixed(2)}
                          {g.count > 1 && (
                            <span className="ml-1 text-[10px] font-normal text-gray-500">
                              (£{g.totalBuyPrice.toFixed(2)})
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs font-mono text-gray-700">{u.dateIn || '—'}</td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-gray-50 border-b border-gray-200">
                          <td colSpan={9} className="px-6 py-4">
                            <div className="space-y-4">
                              {/* Per-colour breakdown */}
                              {g.colours.length > 1 && (
                                <div>
                                  <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">
                                    Colour breakdown ({g.colours.length})
                                  </p>
                                  <div className="flex flex-wrap gap-1.5">
                                    {g.colours.map(c => (
                                      <span
                                        key={c.colour}
                                        className="inline-flex items-center gap-2 text-[11px] px-2.5 py-1 bg-white border border-gray-200 rounded-full"
                                      >
                                        <span className="font-semibold text-gray-900">{c.colour}</span>
                                        <span className="text-gray-500 font-mono">×&nbsp;{c.count}</span>
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Per-IMEI list */}
                              <div>
                                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">
                                  Units ({g.units.length})
                                </p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1 max-h-64 overflow-y-auto custom-scrollbar">
                                  {g.units.map(individual => (
                                    <div key={individual.id} className="flex items-center justify-between gap-2 py-1 border-b border-gray-100 last:border-b-0">
                                      <span className="text-[11px] font-mono text-gray-700 truncate">
                                        {individual.imei ? <CopyImei imei={individual.imei} truncate={18} /> : '—'}
                                      </span>
                                      <span className="text-[10px] text-gray-500 flex-shrink-0">
                                        {individual.colour || '—'}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>

              {/* Footer Summary */}
              <tfoot className="sticky bottom-0 bg-gray-100 border-t border-gray-300">
                <tr>
                  <td colSpan={7} className="px-4 py-3 text-xs font-bold text-gray-700">
                    TOTAL · {units.length} units · {groups.length} SKUs
                  </td>
                  <td className="px-4 py-3 text-xs font-mono font-bold text-gray-900">
                    £{totalBP.toFixed(2)}
                  </td>
                  <td className="px-4 py-3" />
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
