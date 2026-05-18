/**
 * Client Walkthrough — admin-only view for meeting-room data review.
 *
 * Renders the master file (INVENTORY_REPORT_2026) 1:1 as a single HTML
 * table, mirroring the layout the client sees when they open it in
 * Excel: in-office rows, the TOTAL marker, the SHS section header and
 * its line items, the SOLD section, blank spacer rows. Row numbers
 * shown match the workbook's row numbers exactly.
 *
 * Cells are colour-coded by audit classification (red/yellow/green/
 * blue). Every editable cell is an inline text input so the operator
 * can correct values during the client meeting. The right-most column
 * "Issue / Explanation" is populated only for RED rows — it holds the
 * audit headline, bullets, and the verbatim question(s) to ask the
 * client.
 *
 * Two downloads from the toolbar:
 *  1. Corrected workbook (xlsx) with the operator's edits applied.
 *  2. Issue report (PDF) — printable row-by-row write-up.
 *
 * Data source: src/data/walkthroughRows.json is built at audit time by
 * scripts/build_walkthrough_data.py. Issue text lives in
 * src/data/walkthroughIssues.ts so it can be hand-edited without
 * re-running the script.
 */
import React, { useState, useMemo } from 'react';
import {
  AlertCircle, CheckCircle2, Clock, Edit3, Download, FileText,
  Sparkles,
} from 'lucide-react';
import ExcelJS from 'exceljs';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import rowsData from '../data/walkthroughRows.json';
import { WALKTHROUGH_ISSUES, RowIssue } from '../data/walkthroughIssues';

type Classification = 'green' | 'yellow' | 'red' | 'blue' | 'none' | 'divider' | 'blank';

interface WalkRow {
  row: number;
  model: string | null;
  bp: number | string | null;
  qty: number | string | null;
  value: number | string | null;
  colours: string | null;
  supplier: string | null;
  notes: string | null;
  classification: Classification;
}

const ROWS = rowsData as WalkRow[];

const ROW_BG: Record<Classification, string> = {
  green:   'bg-emerald-50 hover:bg-emerald-100/60',
  yellow:  'bg-amber-50 hover:bg-amber-100/60',
  red:     'bg-rose-50 hover:bg-rose-100/60',
  blue:    'bg-sky-50 hover:bg-sky-100/60',
  none:    'bg-white hover:bg-slate-50',
  divider: 'bg-slate-100 font-bold',
  blank:   'bg-white',
};

const COUNT_LABELS: { id: Classification; label: string; chip: string; icon: React.ReactNode }[] = [
  { id: 'red',    label: 'Issue',      chip: 'bg-rose-500',    icon: <AlertCircle size={11} /> },
  { id: 'yellow', label: 'Rollup gap', chip: 'bg-amber-500',   icon: <Clock size={11} /> },
  { id: 'green',  label: 'Clean',      chip: 'bg-emerald-500', icon: <CheckCircle2 size={11} /> },
  { id: 'blue',   label: 'Our fix',    chip: 'bg-sky-500',     icon: <Edit3 size={11} /> },
];

function cellDisplay(v: number | string | null): string {
  if (v === null || v === undefined || v === '') return '';
  return String(v);
}

export default function ClientWalkthrough() {
  const [edits, setEdits] = useState<Record<string, string>>({});
  /** When true, hide rows after the SOLD divider to keep the meeting
   *  view focused on in-office + SHS. Default off — operator can
   *  expand to show the historical SOLD section if needed. */
  const [showSold, setShowSold] = useState(false);

  const counts = useMemo(() => {
    const c: Record<Classification, number> = {
      green: 0, yellow: 0, red: 0, blue: 0,
      none: 0, divider: 0, blank: 0,
    };
    ROWS.forEach(r => { c[r.classification] += 1; });
    return c;
  }, []);

  const editValue = (rowI: number, field: keyof WalkRow): string => {
    const key = `${rowI}.${String(field)}`;
    if (key in edits) return edits[key];
    return cellDisplay((ROWS.find(r => r.row === rowI) as any)?.[field] ?? null);
  };

  const setEdit = (rowI: number, field: keyof WalkRow, val: string) => {
    setEdits(prev => ({ ...prev, [`${rowI}.${String(field)}`]: val }));
  };

  /** Find the row index of the SOLD divider so we can hide everything
   *  past it when showSold is false. */
  const soldDividerIdx = useMemo(() => {
    return ROWS.findIndex(r => r.classification === 'divider' && String(r.model).trim().toUpperCase() === 'SOLD');
  }, []);

  const visibleRows = useMemo(() => {
    if (showSold || soldDividerIdx < 0) return ROWS;
    return ROWS.slice(0, soldDividerIdx);
  }, [showSold, soldDividerIdx]);

  const handleDownloadXlsx = async () => {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('INVENTORY (edited)');
    sheet.columns = [
      { header: 'MODEL',    key: 'model',    width: 50 },
      { header: 'BP',       key: 'bp',       width: 8  },
      { header: 'QUANTITY', key: 'qty',      width: 10 },
      { header: '',         key: 'gap',      width: 4  },
      { header: 'VALUE',    key: 'value',    width: 10 },
      { header: 'COLOURS',  key: 'colours',  width: 40 },
      { header: 'SUPPLIER', key: 'supplier', width: 20 },
      { header: 'NOTES',    key: 'notes',    width: 18 },
      { header: 'ISSUE / EXPLANATION', key: 'issue', width: 60 },
    ];
    const hdr = sheet.getRow(1);
    hdr.font = { bold: true, size: 10 };
    hdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };

    const FILL: Record<Classification, string | null> = {
      green:   'FFC6EFCE',
      yellow:  'FFFFEB9C',
      red:     'FFFFC7CE',
      blue:    'FFBDD7EE',
      none:    null,
      divider: 'FFE2E8F0',
      blank:   null,
    };

    for (const r of ROWS) {
      const issue = WALKTHROUGH_ISSUES[r.row];
      const issueText = r.classification === 'red' && issue
        ? `${issue.headline}\n• ${issue.bullets.join('\n• ')}${issue.questions?.length ? `\nAsk: ${issue.questions.join(' | ')}` : ''}`
        : '';
      const row = sheet.addRow({
        model:    editValue(r.row, 'model'),
        bp:       editValue(r.row, 'bp'),
        qty:      editValue(r.row, 'qty'),
        value:    editValue(r.row, 'value'),
        colours:  editValue(r.row, 'colours'),
        supplier: editValue(r.row, 'supplier'),
        notes:    editValue(r.row, 'notes'),
        issue:    issueText,
      });
      const argb = FILL[r.classification];
      if (argb) {
        row.eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
        });
      }
      row.font = { size: 10 };
      row.alignment = { vertical: 'top', wrapText: true };
    }

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `INVENTORY_REPORT_2026_edited_${new Date().toISOString().split('T')[0]}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadPdf = () => {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    let y = 14;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('INVENTORY_REPORT_2026 — Issue Report', 14, y);
    y += 6;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`Generated ${new Date().toLocaleDateString()}  ·  ${counts.red} issues, ${counts.yellow} rollup gaps, ${counts.green} clean rows`, 14, y);
    y += 8;

    autoTable(doc, {
      startY: y,
      head: [['Row', 'Class', 'Model', 'Issue']],
      body: ROWS
        .filter(r => r.classification === 'red' || r.classification === 'yellow')
        .map(r => [
          r.row,
          r.classification.toUpperCase(),
          (r.model ?? '').slice(0, 38),
          (WALKTHROUGH_ISSUES[r.row]?.headline ?? '—').slice(0, 62),
        ]),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold' },
      didParseCell(d) {
        if (d.section === 'body' && d.column.index === 1) {
          const v = String(d.cell.raw);
          if (v === 'RED')    d.cell.styles.fillColor = [254, 226, 226];
          if (v === 'YELLOW') d.cell.styles.fillColor = [254, 243, 199];
        }
      },
    });

    Object.entries(WALKTHROUGH_ISSUES).forEach(([rowStr, issue]) => {
      const r = ROWS.find(rr => rr.row === Number(rowStr));
      if (!r) return;
      doc.addPage();
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.text(`Row ${r.row}  ·  ${r.classification.toUpperCase()}`, 14, 16);
      doc.setFontSize(11);
      const modelLines = doc.splitTextToSize(r.model ?? '', 180);
      doc.text(modelLines, 14, 23);
      let yy = 23 + modelLines.length * 5 + 4;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text(`BP £${r.bp ?? '—'}  ·  QTY ${r.qty ?? '—'}  ·  Supplier ${r.supplier ?? '—'}`, 14, yy);
      yy += 6;
      doc.text(`Colours: ${r.colours ?? '—'}`, 14, yy);
      yy += 8;

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text(issue.headline, 14, yy);
      yy += 6;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      issue.bullets.forEach(b => {
        const lines = doc.splitTextToSize(`• ${b}`, 180);
        doc.text(lines, 14, yy);
        yy += lines.length * 5 + 1;
      });

      if (issue.questions?.length) {
        yy += 4;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.text('Questions for client:', 14, yy);
        yy += 5;
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(10);
        issue.questions.forEach(q => {
          const lines = doc.splitTextToSize(`— ${q}`, 180);
          doc.text(lines, 14, yy);
          yy += lines.length * 5 + 1;
        });
      }
    });

    doc.save(`INVENTORY_REPORT_2026_issues_${new Date().toISOString().split('T')[0]}.pdf`);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold tracking-tight flex items-center gap-2">
              <Sparkles size={18} className="text-amber-500" />
              Client Walkthrough — INVENTORY_REPORT_2026
            </h2>
            <p className="mt-1 text-[11px] text-slate-500 font-mono">
              The client's master file rendered 1:1. Cells are editable. RED rows have the issue + explanation in the last column.
            </p>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button
              onClick={handleDownloadXlsx}
              className="inline-flex items-center gap-1.5 bg-slate-900 text-white rounded-xl px-3 py-2 text-[10px] font-bold uppercase tracking-widest hover:bg-slate-700 transition-all"
            >
              <Download size={11} /> Corrected xlsx
            </button>
            <button
              onClick={handleDownloadPdf}
              className="inline-flex items-center gap-1.5 bg-white border border-slate-300 text-slate-700 rounded-xl px-3 py-2 text-[10px] font-bold uppercase tracking-widest hover:bg-slate-50 transition-all"
            >
              <FileText size={11} /> Issue report (PDF)
            </button>
          </div>
        </div>

        {/* Legend / counts */}
        <div className="mt-4 flex flex-wrap gap-2 items-center">
          {COUNT_LABELS.map(c => (
            <div
              key={c.id}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-mono uppercase tracking-wider bg-white border border-slate-200"
            >
              <span className={`w-2 h-2 rounded-full ${c.chip}`} />
              {c.label}
              <span className="text-slate-400 font-bold">{counts[c.id]}</span>
            </div>
          ))}
          <button
            onClick={() => setShowSold(s => !s)}
            className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-mono uppercase tracking-wider bg-white border border-slate-200 hover:border-slate-400 transition-all"
          >
            {showSold ? 'Hide' : 'Show'} SOLD section
          </button>
        </div>
      </div>

      {/* The table — mirrors the workbook */}
      <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] table-fixed">
            <colgroup>
              <col style={{ width: '44px' }} />     {/* row # */}
              <col style={{ width: '22%' }} />      {/* model */}
              <col style={{ width: '60px' }} />     {/* BP */}
              <col style={{ width: '70px' }} />     {/* qty */}
              <col style={{ width: '70px' }} />     {/* value */}
              <col style={{ width: '18%' }} />      {/* colours */}
              <col style={{ width: '11%' }} />      {/* supplier */}
              <col style={{ width: '10%' }} />      {/* notes */}
              <col />                               {/* issue / explanation */}
            </colgroup>
            <thead>
              <tr className="bg-slate-100 text-slate-700 sticky top-0 z-10">
                <th className="px-2 py-2 text-left font-mono font-bold text-[9px] uppercase tracking-widest text-slate-400">#</th>
                <th className="px-2 py-2 text-left font-bold text-[10px] uppercase tracking-wider">Model</th>
                <th className="px-2 py-2 text-right font-bold text-[10px] uppercase tracking-wider">BP</th>
                <th className="px-2 py-2 text-right font-bold text-[10px] uppercase tracking-wider">Quantity</th>
                <th className="px-2 py-2 text-right font-bold text-[10px] uppercase tracking-wider">Value</th>
                <th className="px-2 py-2 text-left font-bold text-[10px] uppercase tracking-wider">Colours</th>
                <th className="px-2 py-2 text-left font-bold text-[10px] uppercase tracking-wider">Supplier</th>
                <th className="px-2 py-2 text-left font-bold text-[10px] uppercase tracking-wider">Notes</th>
                <th className="px-2 py-2 text-left font-bold text-[10px] uppercase tracking-wider">Issue / Explanation</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map(r => {
                if (r.classification === 'blank') {
                  return (
                    <tr key={r.row} className="bg-white">
                      <td className="px-2 py-1 text-right font-mono text-[9px] text-slate-300">{r.row}</td>
                      <td colSpan={8} className="px-2 py-1">&nbsp;</td>
                    </tr>
                  );
                }
                if (r.classification === 'divider') {
                  return (
                    <tr key={r.row} className="bg-slate-200">
                      <td className="px-2 py-2 text-right font-mono text-[9px] text-slate-500 font-bold">{r.row}</td>
                      <td colSpan={8} className="px-2 py-2 font-bold text-slate-900 uppercase tracking-widest text-[11px]">
                        {r.model}
                      </td>
                    </tr>
                  );
                }
                const issue = WALKTHROUGH_ISSUES[r.row] as RowIssue | undefined;
                const showIssue = r.classification === 'red' && issue;
                return (
                  <tr key={r.row} className={`${ROW_BG[r.classification]} border-b border-slate-100`}>
                    <td className="px-2 py-1.5 text-right font-mono text-[9px] text-slate-400 align-top pt-2">{r.row}</td>
                    <td className="px-1 py-1 align-top">
                      <EditableCell value={editValue(r.row, 'model')} onChange={v => setEdit(r.row, 'model', v)} />
                    </td>
                    <td className="px-1 py-1 align-top">
                      <EditableCell value={editValue(r.row, 'bp')} onChange={v => setEdit(r.row, 'bp', v)} align="right" />
                    </td>
                    <td className="px-1 py-1 align-top">
                      <EditableCell value={editValue(r.row, 'qty')} onChange={v => setEdit(r.row, 'qty', v)} align="right" />
                    </td>
                    <td className="px-1 py-1 align-top">
                      <EditableCell value={editValue(r.row, 'value')} onChange={v => setEdit(r.row, 'value', v)} align="right" />
                    </td>
                    <td className="px-1 py-1 align-top">
                      <EditableCell value={editValue(r.row, 'colours')} onChange={v => setEdit(r.row, 'colours', v)} />
                    </td>
                    <td className="px-1 py-1 align-top">
                      <EditableCell value={editValue(r.row, 'supplier')} onChange={v => setEdit(r.row, 'supplier', v)} />
                    </td>
                    <td className="px-1 py-1 align-top">
                      <EditableCell value={editValue(r.row, 'notes')} onChange={v => setEdit(r.row, 'notes', v)} />
                    </td>
                    <td className="px-2 py-1.5 align-top">
                      {showIssue ? <IssueBlock issue={issue!} /> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/** Render the issue write-up inline inside the table's last column.
 *  Headline + bullets + verbatim questions, stacked vertically. */
function IssueBlock({ issue }: { issue: RowIssue }) {
  return (
    <div className="space-y-1.5 leading-snug">
      <p className="text-[11px] font-bold text-rose-900">{issue.headline}</p>
      <ul className="space-y-0.5">
        {issue.bullets.map((b, i) => (
          <li key={i} className="text-[10px] text-slate-700 flex gap-1.5">
            <span className="text-rose-400 flex-shrink-0">•</span>
            <span>{b}</span>
          </li>
        ))}
      </ul>
      {issue.questions?.length ? (
        <div className="mt-1.5 pt-1.5 border-t border-rose-200">
          <p className="text-[8px] font-bold uppercase tracking-widest text-rose-400 mb-0.5">Ask the client</p>
          {issue.questions.map((q, i) => (
            <p key={i} className="text-[10px] text-slate-800 italic">"{q}"</p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Inline-edit input — looks flat until focused, then bordered like
 *  a spreadsheet cell in edit mode. */
function EditableCell({
  value,
  onChange,
  align = 'left',
}: {
  value: string;
  onChange: (v: string) => void;
  align?: 'left' | 'right';
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      className={`w-full bg-transparent border border-transparent rounded px-1.5 py-1 text-[11px] font-mono text-slate-800 hover:border-slate-200 focus:border-slate-400 focus:bg-white focus:outline-none transition-all truncate ${align === 'right' ? 'text-right tabular-nums' : ''}`}
    />
  );
}
