import React, { useState } from 'react';
import { FileDown, Loader2 } from 'lucide-react';
import { InventoryUnit, Supplier } from '../types';

interface Props {
  units: InventoryUnit[];
  suppliers: Supplier[];
  variant?: 'primary' | 'outline';
}

export default function PDFReportButton({ units, suppliers, variant = 'primary' }: Props) {
  const [loading, setLoading] = useState(false);

  const handleDownload = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const { generateInventoryReport } = await import('../lib/pdfReport');
      generateInventoryReport(units, suppliers);
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
          : <FileDown size={14} />}
        {loading ? 'Building PDF…' : 'Download PDF Report'}
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
        : <FileDown size={15} />}
      {loading ? 'Building PDF…' : 'Download Insights Report'}
    </button>
  );
}
