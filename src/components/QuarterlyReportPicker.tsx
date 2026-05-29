import { useMemo, useState } from 'react';
import { FileSpreadsheet, Loader2, Calendar } from 'lucide-react';
import type { InventoryUnit, Supplier } from '../types';
import { dbService } from '../lib/dbService';

interface Props {
  units: InventoryUnit[];
  suppliers: Supplier[];
}

/** Calendar-quarter labels used in the UI dropdown. */
const QUARTER_LABELS: Record<1 | 2 | 3 | 4, string> = {
  1: 'Q1 (Jan–Mar)',
  2: 'Q2 (Apr–Jun)',
  3: 'Q3 (Jul–Sep)',
  4: 'Q4 (Oct–Dec)',
};

/** Resolve the quarter the supplied date falls in. */
function currentQuarter(d: Date): 1 | 2 | 3 | 4 {
  return (Math.floor(d.getMonth() / 3) + 1) as 1 | 2 | 3 | 4;
}

/**
 * Quarterly SALES_REPORT picker — operator selects calendar year + quarter and
 * downloads a SALES_REPORT_${year}_Q${n}.xlsx workbook scoped to that 3-month
 * window. Backed by `clientReport.downloadClientWorkbooks` so the produced
 * file is byte-equivalent to the client's master format (4 marketplace tabs,
 * verbatim formulas).
 */
export default function QuarterlyReportPicker({ units, suppliers }: Props) {
  const today = new Date();
  const [year, setYear] = useState<number>(today.getFullYear());
  const [quarter, setQuarter] = useState<1 | 2 | 3 | 4>(currentQuarter(today));
  const [loading, setLoading] = useState(false);

  // Year options: current year + last 2 years (covers retrospective filings).
  const yearOptions = useMemo(() => {
    const y = today.getFullYear();
    return [y, y - 1, y - 2];
  }, [today]);

  const handleDownload = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const [{ downloadClientWorkbooks, quarterDateRange }, aggregates, whatsappFeed] = await Promise.all([
        import('../lib/clientReport'),
        dbService.readAll('inventoryAggregates'),
        dbService.readAll('supplierWhatsappUpdates'),
      ]);
      const { from, to } = quarterDateRange(year, quarter);
      const sales = await dbService.getSalesInRange(from, to);

      await downloadClientWorkbooks({
        units,
        aggregates: aggregates as any,
        suppliers,
        whatsappFeed: whatsappFeed as any,
        sales: sales as any,
        opts: { from, to, today, quarter: { year, quarter } },
      });
    } catch (err: any) {
      console.error('[QuarterlyReportPicker] download failed:', err);
      alert(`Quarterly report failed: ${err?.message ?? err}`);
    } finally {
      setTimeout(() => setLoading(false), 1500);
    }
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Calendar size={14} className="text-gray-400" />
      <select
        value={year}
        onChange={e => setYear(Number(e.target.value))}
        className="bg-white border border-gray-200 rounded-xl px-3 py-2 text-[11px] font-mono focus:outline-none focus:border-black"
      >
        {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
      </select>
      <select
        value={quarter}
        onChange={e => setQuarter(Number(e.target.value) as 1 | 2 | 3 | 4)}
        className="bg-white border border-gray-200 rounded-xl px-3 py-2 text-[11px] font-mono focus:outline-none focus:border-black"
      >
        {(Object.keys(QUARTER_LABELS) as Array<'1' | '2' | '3' | '4'>).map(q =>
          <option key={q} value={q}>{QUARTER_LABELS[Number(q) as 1 | 2 | 3 | 4]}</option>
        )}
      </select>
      <button
        onClick={handleDownload}
        disabled={loading}
        className="flex items-center gap-2 px-4 py-2 bg-black text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-gray-800 transition-all disabled:opacity-50"
      >
        {loading
          ? <Loader2 size={14} className="animate-spin" />
          : <FileSpreadsheet size={14} />}
        {loading ? 'Building…' : `Download Q${quarter} ${year}`}
      </button>
    </div>
  );
}
