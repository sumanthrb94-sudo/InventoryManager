import { useState } from 'react';
import { FileSpreadsheet, Loader2 } from 'lucide-react';
import type { InventoryUnit, Supplier, AccessoryStock } from '../types';
import { dbService } from '../lib/dbService';

interface Props {
  units: InventoryUnit[];
  suppliers: Supplier[];
  accessoryStock?: AccessoryStock[];
  /** Optional date window (yyyy-mm-dd inclusive); when omitted the workbook
   *  contains the full current snapshot, mirroring the client's master files. */
  from?: string;
  to?: string;
  variant?: 'primary' | 'outline';
}

/**
 * Downloads INVENTORY_REPORT_YYYY_M.xlsx and SALES_REPORT_YYYY.xlsx — two
 * workbooks byte-compatible with the client's master files (preserving sheet
 * names, header text, cell formats and per-marketplace formulas).
 */
export default function ExcelReportButton({ units, suppliers, accessoryStock, from, to, variant = 'primary' }: Props) {
  const [loading, setLoading] = useState(false);

  const handleDownload = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const [{ downloadClientWorkbooks }, aggregates, whatsappFeed, sales] = await Promise.all([
        import('../lib/clientReport'),
        dbService.readAll('inventoryAggregates'),
        dbService.readAll('supplierWhatsappUpdates'),
        from && to ? dbService.getSalesInRange(from, to) : dbService.readAll('sales'),
      ]);
      await downloadClientWorkbooks({
        units,
        aggregates: aggregates as any,
        suppliers,
        whatsappFeed: whatsappFeed as any,
        sales: sales as any,
        opts: { from, to, today: new Date() },
        accessoryStock,
      });
    } catch (err: any) {
      console.error('[ExcelReportButton] download failed:', err);
      // Surface the error visibly so the operator knows the daily report didn't
      // land — a silent failure would let bad bookkeeping accumulate.
      alert(`Excel report failed: ${err?.message ?? err}`);
    } finally {
      setTimeout(() => setLoading(false), 1500);
    }
  };

  if (variant === 'outline') {
    return (
      <button
        onClick={handleDownload}
        disabled={loading}
        className="flex items-center gap-2 px-4 py-2.5 border border-gray-200 bg-white text-black rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-gray-50 hover:border-gray-400 transition-all disabled:opacity-50"
      >
        {loading
          ? <Loader2 size={14} className="animate-spin" />
          : <FileSpreadsheet size={14} />}
        {loading ? 'Building Excel…' : 'Download Master Excel'}
      </button>
    );
  }

  return (
    <button
      onClick={handleDownload}
      disabled={loading || units.length === 0}
      className="flex items-center gap-2.5 px-5 py-3 bg-black text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-gray-800 transition-all active:scale-[0.98] disabled:opacity-40"
    >
      {loading
        ? <Loader2 size={15} className="animate-spin" />
        : <FileSpreadsheet size={15} />}
      {loading ? 'Building Excel…' : 'Download Master Excel'}
    </button>
  );
}
