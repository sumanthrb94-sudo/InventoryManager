/**
 * MoneySection — the tax and the cash, in one place.
 *
 * These were three screens' worth of scattered figures: VAT in Reports on a
 * rolling 90-day window, capital implied by an aged-stock unit count in
 * Insights, and supplier profit that never subtracted returns. They answer
 * one question between them — is this business making money, and where is
 * it — so they live together and share a header.
 */
import React, { useState } from 'react';
import { Receipt, Layers } from 'lucide-react';
import VatCentre from './VatCentre';
import CapitalPanel from './CapitalPanel';

type MoneyTab = 'vat' | 'capital';

const TABS: { key: MoneyTab; label: string; icon: React.ReactNode; blurb: string }[] = [
  { key: 'vat', label: 'VAT', icon: <Receipt size={13} />, blurb: 'What you owe, by quarter' },
  { key: 'capital', label: 'Capital & Profit', icon: <Layers size={13} />, blurb: 'Where the cash is, and what it earned' },
];

export default function MoneySection() {
  const [tab, setTab] = useState<MoneyTab>('vat');
  const active = TABS.find(t => t.key === tab)!;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {TABS.map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            aria-pressed={t.key === tab}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border text-[10px] font-bold uppercase tracking-widest transition-all
              ${t.key === tab
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-700 border-slate-300 hover:border-slate-500'}`}
          >
            {t.icon}{t.label}
          </button>
        ))}
        <p className="text-[10px] font-mono text-slate-400 ml-1">{active.blurb}</p>
      </div>

      {tab === 'vat' && <VatCentre />}
      {tab === 'capital' && <CapitalPanel />}
    </div>
  );
}
