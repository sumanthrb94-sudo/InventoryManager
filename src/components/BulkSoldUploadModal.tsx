/**
 * BulkSoldUploadModal — mark a batch of handsets sold from a filled sheet.
 *
 * The narrow door. It reads a BULK_SOLD_TEMPLATE, shows exactly which rows it
 * will sell and which it will not (and why), and only writes once the operator
 * has read that and confirmed. Selling goes through recordBulkSales — the same
 * function behind Mark Multiple Sold — so a sale from a sheet is the same write
 * as a sale from the app, with the same fees, VAT lines and audit trail.
 *
 * It cannot create stock, restore a return or re-import history. That is the
 * Sales Report import, which is deliberately absent from this build; nothing
 * here brings it back.
 */
import React, { useState } from 'react';
import { X, Upload, CheckCircle2, AlertTriangle, FileSpreadsheet, Loader2 } from 'lucide-react';
import {
  parseBulkSoldWorkbook,
  buildBulkSoldPreview,
  type BulkSoldPreview,
} from '../lib/bulkSoldImport';
import { recordBulkSales, type BulkSaleResult } from '../services/salesService';
import { useInventoryStore } from '../lib/inventoryStore';

type Phase = 'pick' | 'preview' | 'saving' | 'done';

interface Props {
  onClose: () => void;
}

export default function BulkSoldUploadModal({ onClose }: Props) {
  const { units } = useInventoryStore();
  const [phase, setPhase] = useState<Phase>('pick');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<BulkSoldPreview | null>(null);
  const [result, setResult] = useState<BulkSaleResult | null>(null);
  const [error, setError] = useState('');

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setFileName(file.name);
    try {
      const rows = await parseBulkSoldWorkbook(await file.arrayBuffer());
      // Read the preview against stock as it stands NOW, not as it stood when
      // the sheet was filled in — a unit sold in the app since then must be
      // rejected, not sold twice.
      setPreview(buildBulkSoldPreview(rows, units));
      setPhase('preview');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not read that file.');
    }
  };

  const confirm = async () => {
    if (!preview?.lines.length) return;
    setPhase('saving');
    setResult(await recordBulkSales(preview.lines));
    setPhase('done');
  };

  const ready = preview?.lines.length ?? 0;
  const rejected = preview?.rejected.length ?? 0;

  return (
    <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4"
         onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden"
           onClick={e => e.stopPropagation()}>

        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2 min-w-0">
            <FileSpreadsheet size={18} className="text-emerald-600 flex-shrink-0" />
            <div className="min-w-0">
              <h2 className="text-[13px] font-black uppercase tracking-tight text-slate-900">
                Mark Sold from a sheet
              </h2>
              <p className="text-[10px] text-slate-500 font-mono uppercase tracking-widest truncate">
                {fileName || 'BULK_SOLD_TEMPLATE.xlsx'}
              </p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close"
                  className="p-2 rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {phase === 'pick' && (
            <>
              <p className="text-[12px] text-slate-700 leading-relaxed">
                One row per handset: IMEI, marketplace, order number and sale price. Each row marks
                that unit sold — exactly as Mark Multiple Sold does. It can only sell stock you
                already have; it never creates a unit or restores a return.
              </p>
              <label className="mt-4 flex flex-col items-center justify-center gap-2 px-4 py-10
                                border-2 border-dashed border-slate-300 rounded-2xl cursor-pointer
                                hover:border-emerald-400 hover:bg-emerald-50/40 transition-all">
                <Upload size={20} className="text-slate-400" />
                <span className="text-[11px] font-bold uppercase tracking-widest text-slate-600">
                  Choose the filled sheet
                </span>
                <input type="file" accept=".xlsx,.xlsm" className="hidden" onChange={onFile} />
              </label>
              <p className="mt-3 text-[10px] text-slate-500">
                Need the sheet? Download <span className="font-mono">BULK_SOLD_TEMPLATE.xlsx</span> from
                the Sales Report menu.
              </p>
              {error && (
                <p className="mt-3 text-[11px] font-semibold text-rose-700 bg-rose-50 border border-rose-200
                              rounded-lg px-3 py-2">{error}</p>
              )}
            </>
          )}

          {phase === 'preview' && preview && (
            <>
              <div className="flex flex-wrap gap-2">
                <span className="px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200
                                 text-[11px] font-bold text-emerald-800">
                  {ready} will be marked sold
                </span>
                {rejected > 0 && (
                  <span className="px-3 py-1.5 rounded-lg bg-rose-50 border border-rose-200
                                   text-[11px] font-bold text-rose-800">
                    {rejected} cannot be
                  </span>
                )}
                {preview.blankRows > 0 && (
                  <span className="px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200
                                   text-[11px] font-bold text-slate-600">
                    {preview.blankRows} empty rows skipped
                  </span>
                )}
              </div>

              {rejected > 0 && (
                <div className="mt-4">
                  <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest
                                text-rose-800">
                    <AlertTriangle size={13} /> Not sold — fix the sheet and upload again
                  </p>
                  <div className="mt-2 border border-rose-200 rounded-xl overflow-hidden">
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="bg-rose-50 text-left text-[9px] font-bold uppercase
                                       tracking-widest text-rose-700">
                          <th className="px-3 py-1.5 w-16">Row</th>
                          <th className="px-3 py-1.5">IMEI</th>
                          <th className="px-3 py-1.5">Why</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.rejected.map(r => (
                          <tr key={`${r.sourceRow}-${r.imei}`} className="border-t border-rose-100">
                            <td className="px-3 py-1.5 font-mono text-slate-500">{r.sourceRow}</td>
                            <td className="px-3 py-1.5 font-mono">{r.imei || '—'}</td>
                            <td className="px-3 py-1.5 text-rose-800">{r.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {ready > 0 && (
                <div className="mt-4">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-emerald-800">
                    Will be marked sold
                  </p>
                  <div className="mt-2 border border-slate-200 rounded-xl overflow-hidden">
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="bg-slate-50 text-left text-[9px] font-bold uppercase
                                       tracking-widest text-slate-500">
                          <th className="px-3 py-1.5">IMEI</th>
                          <th className="px-3 py-1.5">Model</th>
                          <th className="px-3 py-1.5">Marketplace</th>
                          <th className="px-3 py-1.5">Order</th>
                          <th className="px-3 py-1.5 text-right">SP £</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.lines.map((l, i) => (
                          <tr key={i} className="border-t border-slate-100">
                            <td className="px-3 py-1.5 font-mono">
                              {l.kind === 'unit' ? l.unit.imei : ''}
                              {l.kind === 'unit' && l.isSHS && (
                                <span className="ml-1.5 text-[9px] font-bold text-amber-700">SHS</span>
                              )}
                            </td>
                            <td className="px-3 py-1.5">{l.kind === 'unit' ? l.unit.model : ''}</td>
                            <td className="px-3 py-1.5">{l.marketplace}</td>
                            <td className="px-3 py-1.5 font-mono text-slate-500">{l.orderNumber}</td>
                            <td className="px-3 py-1.5 text-right font-mono">{l.salePrice.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}

          {phase === 'saving' && (
            <div className="flex flex-col items-center justify-center gap-3 py-16">
              <Loader2 size={22} className="animate-spin text-emerald-600" />
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-600">
                Marking {ready} units sold…
              </p>
            </div>
          )}

          {phase === 'done' && result && (
            <>
              <div className="flex items-center gap-2">
                <CheckCircle2 size={18} className="text-emerald-600" />
                <p className="text-[13px] font-bold text-slate-900">
                  {result.succeeded} marked sold{result.failed > 0 ? `, ${result.failed} failed` : ''}
                </p>
              </div>
              {result.failed > 0 && (
                <div className="mt-3 border border-rose-200 rounded-xl overflow-hidden">
                  <table className="w-full text-[11px]">
                    <tbody>
                      {result.results.filter(r => !r.ok).map((r, i) => (
                        <tr key={i} className="border-t border-rose-100">
                          <td className="px-3 py-1.5 font-mono">{r.label}</td>
                          <td className="px-3 py-1.5 text-rose-800">{r.message || r.error}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="mt-4 text-[11px] text-slate-600">
                The fees, VAT lines and GP for these sales are on the Sales Report.
              </p>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50">
          {phase === 'preview' && (
            <>
              <button onClick={() => { setPhase('pick'); setPreview(null); }}
                      className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600
                                 text-[10px] font-bold uppercase tracking-widest hover:bg-white">
                Choose another file
              </button>
              <button
                onClick={confirm}
                disabled={ready === 0}
                title={ready === 0 ? 'No row in this sheet can be sold.' : undefined}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white
                           text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-700
                           disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <CheckCircle2 size={12} /> Mark {ready} sold
              </button>
            </>
          )}
          {(phase === 'pick' || phase === 'done') && (
            <button onClick={onClose}
                    className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600
                               text-[10px] font-bold uppercase tracking-widest hover:bg-white">
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
