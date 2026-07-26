/**
 * TemplateDownload — "build your file from the standard, not from a colleague's
 * old copy."
 *
 * Sits next to the reports it belongs to (in the range menu) and inside the
 * import modals (at the point of upload). Both placements answer the same
 * question at the moment it's actually asked: *what shape should this file
 * be?* Answering it with a link to the current template is the difference
 * between an import that lands and an afternoon of re-keying.
 *
 * Files come from public/templates/, written by
 * scripts/generateImportTemplates.mjs — the same run that writes templates/,
 * so what the app hands out can't drift from what the tests parse.
 */
import React from 'react';
import { FileDown } from 'lucide-react';

export interface TemplateLink {
  /** File name inside public/templates/. */
  file: string;
  /** What the operator calls it. */
  label: string;
  /** One line on when to reach for this one. */
  hint?: string;
}

const BASE = 'templates';

/**
 * The template block for a report menu — a labelled divider plus one row per
 * template. Renders nothing when the report has no importer (Returns), so
 * callers can pass an empty list without special-casing.
 */
export default function TemplateDownload({
  templates,
  heading = 'Build a new file from',
}: {
  templates: TemplateLink[];
  heading?: string;
}) {
  if (!templates.length) return null;
  return (
    <div className="border-t border-slate-100 bg-slate-50/60">
      <p className="px-3 pt-2 pb-1 text-[9px] font-bold uppercase tracking-widest text-slate-400">
        {heading}
      </p>
      {templates.map(t => (
        <a
          key={t.file}
          href={`${import.meta.env.BASE_URL ?? '/'}${BASE}/${t.file}`}
          download={t.file}
          className="flex items-start gap-2 px-3 py-2 hover:bg-slate-50 transition-colors group"
        >
          <FileDown
            size={13}
            className="mt-0.5 flex-shrink-0 text-slate-400 group-hover:text-emerald-600 transition-colors"
          />
          <span className="min-w-0">
            <span className="block text-[11px] font-bold text-slate-700 group-hover:text-slate-900">
              {t.label}
            </span>
            {t.hint && (
              <span className="block text-[9px] font-mono text-slate-400 leading-tight">{t.hint}</span>
            )}
          </span>
        </a>
      ))}
    </div>
  );
}

// ── The catalogue, in one place ──────────────────────────────────────────────
// Referenced by both the report menus and the import modals so the two can't
// offer different files for the same job.

export const INVENTORY_TEMPLATES: TemplateLink[] = [
  {
    file: 'INVENTORY_REPORT_TEMPLATE.xlsx',
    label: 'Inventory template',
    hint: '11 columns · office and SHS stock',
  },
  {
    file: 'SHS_STOCK_TEMPLATE.xlsx',
    label: 'SHS stock template',
    hint: 'same schema, every row pre-set to SHS',
  },
];

export const SALES_TEMPLATES: TemplateLink[] = [
  {
    file: 'SALES_REPORT_TEMPLATE.xlsx',
    label: 'Sales template · all marketplaces',
    hint: 'one sheet per channel',
  },
  { file: 'SALES_AMAZON_TEMPLATE.xlsx', label: 'Amazon only', hint: '15 columns' },
  { file: 'SALES_BM_TEMPLATE.xlsx',     label: 'BM only',     hint: '17 columns · Payment Mode at 9' },
  { file: 'SALES_EBAY_TEMPLATE.xlsx',   label: 'eBay only',   hint: '19 columns · postage is SHIPPING' },
  { file: 'SALES_ONBUY_TEMPLATE.xlsx',  label: 'OnBuy only',  hint: '15 columns · no Quantity' },
  { file: 'SALES_TEMU_TEMPLATE.xlsx',   label: 'Temu only',   hint: '15 columns · same layout as Amazon' },
];
