/**
 * Client Walkthrough — admin-only view for meeting-room data review.
 *
 * Renders the annotated master file (INVENTORY rollup, in-office rows)
 * as a colour-coded HTML table. Each row carries its classification
 * (green=clean, yellow=rollup gap, red=real issue, blue=our fix). Click
 * a cell to edit inline. RED/YELLOW rows expand to show the issue notes
 * (questions to ask the client).
 *
 * Three downloads from the toolbar:
 *  1. Corrected workbook (xlsx) with the operator's edits applied.
 *  2. Issue report (PDF) — printable row-by-row write-up of the talking
 *     points.
 *  3. Source workbook (xlsx) — unedited annotated file as it shipped.
 *
 * Data source: src/data/walkthroughRows.json is built at audit time by
 * scripts/build_walkthrough_data.py (one-shot, not on every dev build).
 * Issue text lives in src/data/walkthroughIssues.ts so it can be edited
 * by hand without re-running the script.
 */
import React, { useState, useMemo } from 'react';
import {
  AlertCircle, CheckCircle2, Clock, Edit3, Download, FileText,
  ChevronDown, ChevronRight, HelpCircle, Sparkles,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ExcelJS from 'exceljs';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import rowsData from '../data/walkthroughRows.json';
import { WALKTHROUGH_ISSUES, RowIssue } from '../data/walkthroughIssues';

type Classification = 'green' | 'yellow' | 'red' | 'blue' | 'none';

interface WalkRow {
  row: number;
  model: string;
  bp: number | string | null;
  qty: number | string | null;
  value: number | string | null;
  colours: string | null;
  supplier: string | null;
  notes: string | null;
  classification: Classification;
}

const ROWS = rowsData as WalkRow[];

const CLASS_STYLE: Record<Classification, { bg: string; ring: string; chip: string; icon: React.ReactNode; label: string }> = {
  green:  { bg: 'bg-emerald-50',  ring: 'ring-emerald-200', chip: 'bg-emerald-500',  icon: <CheckCircle2 size={11} />, label: 'Clean' },
  yellow: { bg: 'bg-amber-50',    ring: 'ring-amber-200',   chip: 'bg-amber-500',    icon: <Clock size={11} />,        label: 'Rollup gap' },
  red:    { bg: 'bg-rose-50',     ring: 'ring-rose-200',    chip: 'bg-rose-500',     icon: <AlertCircle size={11} />,  label: 'Issue' },
  blue:   { bg: 'bg-sky-50',      ring: 'ring-sky-200',     chip: 'bg-sky-500',      icon: <Edit3 size={11} />,        label: 'Our fix' },
  none:   { bg: 'bg-white',       ring: 'ring-slate-200',   chip: 'bg-slate-400',    icon: <HelpCircle size={11} />,   label: '—' },
};

function cellDisplay(v: number | string | null): string {
  if (v === null || v === undefined || v === '') return '—';
  return String(v);
}

export default function ClientWalkthrough() {
  // Edits are kept in memory keyed by `${row}.${field}`. Persisted on
  // download — never written back to Firestore. This is a review tool.
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState<Classification | 'all'>('all');

  const filtered = useMemo(
    () => (filter === 'all' ? ROWS : ROWS.filter(r => r.classification === filter)),
    [filter],
  );

  const counts = useMemo(() => {
    const c: Record<Classification, number> = { green: 0, yellow: 0, red: 0, blue: 0, none: 0 };
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

  const toggleExpand = (rowI: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(rowI)) next.delete(rowI);
      else next.add(rowI);
      return next;
    });
  };

  /** Build a fresh xlsx from the current row state + edits, download it. */
  const handleDownloadXlsx = async () => {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('INVENTORY (edited)');
    sheet.columns = [
      { header: 'Row',      key: 'row',      width: 6  },
      { header: 'Model',    key: 'model',    width: 50 },
      { header: 'BP',       key: 'bp',       width: 8  },
      { header: 'Qty',      key: 'qty',      width: 8  },
      { header: 'Value',    key: 'value',    width: 10 },
      { header: 'Colours',  key: 'colours',  width: 40 },
      { header: 'Supplier', key: 'supplier', width: 20 },
      { header: 'Notes',    key: 'notes',    width: 20 },
      { header: 'Class',    key: 'klass',    width: 12 },
    ];
    // Header row styling.
    const hdr = sheet.getRow(1);
    hdr.font = { bold: true, size: 10 };
    hdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };

    const FILL: Record<Classification, string> = {
      green:  'FFC6EFCE',
      yellow: 'FFFFEB9C',
      red:    'FFFFC7CE',
      blue:   'FFBDD7EE',
      none:   'FFFFFFFF',
    };

    for (const r of ROWS) {
      const row = sheet.addRow({
        row:      r.row,
        model:    editValue(r.row, 'model'),
        bp:       editValue(r.row, 'bp'),
        qty:      editValue(r.row, 'qty'),
        value:    editValue(r.row, 'value'),
        colours:  editValue(r.row, 'colours'),
        supplier: editValue(r.row, 'supplier'),
        notes:    editValue(r.row, 'notes'),
        klass:    r.classification,
      });
      const argb = FILL[r.classification];
      row.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
        cell.font = { size: 10 };
      });
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

  /** Build a printable PDF of the row-by-row issue notes (RED + YELLOW). */
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

    // Summary table
    autoTable(doc, {
      startY: y,
      head: [['Row', 'Class', 'Model', 'Issue']],
      body: ROWS
        .filter(r => r.classification === 'red' || r.classification === 'yellow')
        .map(r => [
          r.row,
          r.classification.toUpperCase(),
          r.model.slice(0, 38),
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

    // Per-row details
    Object.entries(WALKTHROUGH_ISSUES).forEach(([rowStr, issue]) => {
      const r = ROWS.find(rr => rr.row === Number(rowStr));
      if (!r) return;
      doc.addPage();
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.text(`Row ${r.row}  ·  ${r.classification.toUpperCase()}`, 14, 16);
      doc.setFontSize(11);
      const modelLines = doc.splitTextToSize(r.model, 180);
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
              Client Walkthrough
            </h2>
            <p className="mt-1 text-[11px] text-slate-500 font-mono">
              In-office rollup with colour-coded audit findings. Click any cell to edit. Expand RED/YELLOW rows for talking points.
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

        {/* Legend chips + filter pills */}
        <div className="mt-4 flex flex-wrap gap-2">
          {(['all', 'red', 'yellow', 'green', 'blue'] as const).map(k => {
            const count = k === 'all' ? ROWS.length : counts[k as Classification];
            const style = k === 'all' ? null : CLASS_STYLE[k as Classification];
            const active = filter === k;
            return (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-mono uppercase tracking-wider border transition-all
                  ${active
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'}`}
              >
                {style && <span className={`w-2 h-2 rounded-full ${style.chip}`} />}
                {k === 'all' ? 'All' : style?.label}
                <span className="text-slate-400 font-bold">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Rows */}
      <div className="space-y-2">
        {filtered.map(r => {
          const style = CLASS_STYLE[r.classification];
          const issue = WALKTHROUGH_ISSUES[r.row] as RowIssue | undefined;
          const isExpanded = expanded.has(r.row);
          const canExpand = r.classification === 'red' || r.classification === 'yellow';

          return (
            <div
              key={r.row}
              className={`border ${style.ring.replace('ring-', 'border-')} ${style.bg} rounded-2xl overflow-hidden transition-all`}
            >
              {/* Row header — clickable to expand if there's an issue note */}
              <div
                className={`px-3 py-2.5 grid grid-cols-12 gap-2 items-center text-[11px] ${canExpand ? 'cursor-pointer hover:bg-white/40' : ''}`}
                onClick={() => canExpand && toggleExpand(r.row)}
              >
                {/* Row number + class chip */}
                <div className="col-span-12 sm:col-span-2 flex items-center gap-2">
                  <span className={`inline-flex items-center justify-center w-6 h-6 rounded-lg text-white ${style.chip}`}>
                    {style.icon}
                  </span>
                  <span className="font-mono text-slate-500 text-[9px] uppercase tracking-wider">Row {r.row}</span>
                  {canExpand && (
                    isExpanded
                      ? <ChevronDown size={12} className="text-slate-400" />
                      : <ChevronRight size={12} className="text-slate-400" />
                  )}
                </div>

                {/* Editable model */}
                <div className="col-span-12 sm:col-span-4">
                  <EditableCell
                    value={editValue(r.row, 'model')}
                    onChange={v => setEdit(r.row, 'model', v)}
                    onClick={e => e.stopPropagation()}
                  />
                </div>

                {/* BP / Qty / Supplier */}
                <div className="col-span-4 sm:col-span-1">
                  <EditableCell
                    value={editValue(r.row, 'bp')}
                    onChange={v => setEdit(r.row, 'bp', v)}
                    onClick={e => e.stopPropagation()}
                    placeholder="BP"
                  />
                </div>
                <div className="col-span-4 sm:col-span-1">
                  <EditableCell
                    value={editValue(r.row, 'qty')}
                    onChange={v => setEdit(r.row, 'qty', v)}
                    onClick={e => e.stopPropagation()}
                    placeholder="Qty"
                  />
                </div>
                <div className="col-span-4 sm:col-span-2">
                  <EditableCell
                    value={editValue(r.row, 'supplier')}
                    onChange={v => setEdit(r.row, 'supplier', v)}
                    onClick={e => e.stopPropagation()}
                    placeholder="Supplier"
                  />
                </div>

                {/* Colour breakdown editable */}
                <div className="col-span-12 sm:col-span-2">
                  <EditableCell
                    value={editValue(r.row, 'colours')}
                    onChange={v => setEdit(r.row, 'colours', v)}
                    onClick={e => e.stopPropagation()}
                    placeholder="Colours"
                  />
                </div>
              </div>

              {/* Expandable issue panel */}
              <AnimatePresence>
                {isExpanded && issue && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    className="bg-white/60 border-t border-slate-200"
                  >
                    <div className="px-4 py-3 space-y-3">
                      <p className="text-[12px] font-bold text-slate-900">{issue.headline}</p>
                      <ul className="space-y-1.5">
                        {issue.bullets.map((b, i) => (
                          <li key={i} className="text-[11px] text-slate-700 leading-relaxed flex gap-2">
                            <span className="text-slate-400 flex-shrink-0 font-mono">•</span>
                            <span>{b}</span>
                          </li>
                        ))}
                      </ul>
                      {issue.questions?.length ? (
                        <div className="pt-2 mt-2 border-t border-slate-200">
                          <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">Ask the client</p>
                          <ul className="space-y-1.5">
                            {issue.questions.map((q, i) => (
                              <li key={i} className="text-[11px] text-slate-700 italic leading-relaxed">
                                "{q}"
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-3xl p-8 text-center">
          <HelpCircle size={28} className="mx-auto text-slate-300" />
          <p className="mt-2 text-[12px] text-slate-500">No rows in this category.</p>
        </div>
      )}
    </div>
  );
}

/** Single-line editable cell. Renders an input that grows on focus and
 *  flat text when not focused, so the table reads like a spreadsheet. */
function EditableCell({
  value,
  onChange,
  onClick,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onClick?: React.MouseEventHandler<HTMLInputElement>;
  placeholder?: string;
}) {
  return (
    <input
      type="text"
      value={value === '—' ? '' : value}
      onChange={e => onChange(e.target.value)}
      onClick={onClick}
      placeholder={placeholder}
      className="w-full bg-transparent border border-transparent rounded px-1.5 py-1 text-[11px] font-mono text-slate-800 hover:border-slate-200 focus:border-slate-400 focus:bg-white focus:outline-none transition-all truncate"
    />
  );
}
