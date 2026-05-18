/**
 * Client Walkthrough — admin-only view for meeting-room data review.
 *
 * Renders the client's master workbook 1:1 with one tab per sheet
 * (INVENTORY, IMEI NUMBERS, SUPPLIER WHATSAPP UPDATES). The INVENTORY
 * sheet carries the audit colour classifications applied during the
 * May-17 review (green=clean, yellow=rollup-gap, red=issue, blue=our
 * fix); the other two sheets render the raw rows.
 *
 * Cells are editable inline. Corrections live in component state until
 * the operator clicks "Load to DB", which writes the visible INVENTORY
 * rows into Firestore as InventoryAggregate documents — same path the
 * Master Data Importer uses. Default filter on INVENTORY is GREEN
 * rows only (the ones safe to import without further questions); the
 * operator opens the others as the meeting works through them.
 *
 * Downloads in the toolbar:
 *  - Corrected workbook (xlsx) with the operator's edits applied to
 *    every sheet.
 *  - Issue report (PDF) — printable row-by-row write-up of RED rows.
 *
 * Data source: scripts/build_walkthrough_data.py extracts the three
 * sheets and writes src/data/walkthroughWorkbook.json. RED-row
 * commentary lives in src/data/walkthroughIssues.ts (hand-editable).
 */
import React, { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle, CheckCircle2, Clock, Edit3, Download, FileText,
  Sparkles, Upload, Loader2, X, CheckCheck, Wand2,
  RefreshCw, Tag, FlagTriangleRight,
} from 'lucide-react';
import ExcelJS from 'exceljs';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import workbookData from '../data/walkthroughWorkbook.json';
import { WALKTHROUGH_ISSUES, RowIssue } from '../data/walkthroughIssues';
import { dbService } from '../lib/dbService';
import { parseBrandModelStorage } from '../lib/modelStorage';
import type { InventoryAggregate, InventoryUnit, Supplier, DeviceCategory } from '../types';

type Classification = 'green' | 'yellow' | 'red' | 'blue' | 'none' | 'divider' | 'blank';

interface SheetRow {
  row: number;
  cells: (string | number | null)[];
  classification: Classification;
}
interface Sheet {
  headers: (string | null)[];
  rows: SheetRow[];
}
type SheetName = 'INVENTORY' | 'IMEI NUMBERS' | 'SUPPLIER WHATSAPP UPDATES';

const SHEETS = workbookData as Record<SheetName, Sheet>;
const SHEET_ORDER: SheetName[] = ['INVENTORY', 'IMEI NUMBERS', 'SUPPLIER WHATSAPP UPDATES'];

const ROW_BG: Record<Classification, string> = {
  green:   'bg-emerald-50 hover:bg-emerald-100/60',
  yellow:  'bg-amber-50 hover:bg-amber-100/60',
  red:     'bg-rose-50 hover:bg-rose-100/60',
  blue:    'bg-sky-50 hover:bg-sky-100/60',
  none:    'bg-white hover:bg-slate-50',
  divider: 'bg-slate-200 font-bold',
  blank:   'bg-white',
};

const CLASS_PILLS: { id: Classification; label: string; chip: string; icon: React.ReactNode }[] = [
  { id: 'green',  label: 'Clean',      chip: 'bg-emerald-500', icon: <CheckCircle2 size={11} /> },
  { id: 'yellow', label: 'Rollup gap', chip: 'bg-amber-500',   icon: <Clock size={11} /> },
  { id: 'red',    label: 'Issue',      chip: 'bg-rose-500',    icon: <AlertCircle size={11} /> },
  { id: 'blue',   label: 'Our fix',    chip: 'bg-sky-500',     icon: <Edit3 size={11} /> },
];

const slugify = (name: string) =>
  `sup_${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown'}`;

function asStr(v: string | number | null): string {
  if (v === null || v === undefined) return '';
  return String(v);
}

/** Mirrors src/services/inventoryService.ts:detectCategory so the
 *  walkthrough loader and the rest of the app classify the same way. */
function detectCategory(model: string): DeviceCategory {
  const m = (model || '').toUpperCase();
  if (m.includes('IPAD')) return 'iPad';
  if (/APPLE WATCH|WATCH ULTRA|WATCH SE/.test(m)) return 'Apple Watch';
  if (m.includes('IPHONE')) return 'iPhone';
  if (/GALAXY TAB|TAB A\d|TAB S\d/.test(m)) return 'Tablet';
  if (m.includes('SAMSUNG') || m.includes('GALAXY'))
    return /\bA\d{2,3}\b|GALAXY A/.test(m) ? 'Samsung A Series' : 'Samsung S Series';
  return 'Other';
}

/** Normalise a model string so two minor formatting differences
 *  ("Galaxy Tab S9FE" vs "GALAXY TAB S9 FE") collide on the same key.
 *  Used to match INVENTORY rollup rows to their IMEI sheet rows. */
function normalizeModel(s: string): string {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Best-effort colours-string → { COLOUR: count } map. Handles the
 *  "BLACK 2 WHITE 1" shorthand the client uses. */
function parseColoursRaw(raw: string): { [c: string]: number } {
  const out: { [c: string]: number } = {};
  if (!raw) return out;
  const tokens = raw.split(/\s+/);
  let i = 0;
  while (i < tokens.length) {
    let name = tokens[i];
    let j = i + 1;
    while (j < tokens.length && !/^\d+$/.test(tokens[j]) && tokens[j].length > 0) {
      name += ' ' + tokens[j];
      j += 1;
    }
    const qty = j < tokens.length ? parseInt(tokens[j], 10) : NaN;
    if (Number.isFinite(qty)) out[name] = qty;
    i = j + 1;
  }
  return out;
}

export default function ClientWalkthrough() {
  const [activeSheet, setActiveSheet] = useState<SheetName>('INVENTORY');
  /** Cell edits keyed by `${sheet}|${row}|${col}`. Survives sheet
   *  switches; cleared only by reloading the page. */
  const [edits, setEdits] = useState<Record<string, string>>({});
  /** Per-row classification overrides — set when the operator clicks
   *  Mark green / Mark red in the issue card. Drives both the filter
   *  visibility and what gets pushed by Load to DB. */
  const [classOverrides, setClassOverrides] = useState<Record<number, Classification>>({});
  /** INVENTORY filter — defaults to GREEN per spec. Operator can pop
   *  open YELLOW/RED/BLUE as the walkthrough progresses. */
  const [filter, setFilter] = useState<Set<Classification>>(new Set(['green']));
  const [loadState, setLoadState] = useState<
    | { kind: 'idle' }
    | { kind: 'confirm'; rows: SheetRow[] }
    | { kind: 'loading'; done: number; total: number }
    | { kind: 'done'; count: number; units: number }
    | { kind: 'error'; msg: string }
  >({ kind: 'idle' });

  const inv = SHEETS.INVENTORY;

  /** Counts honour the operator's overrides so the filter pills
   *  reflect the live state — every Mark green flips a digit. */
  const invCounts = useMemo(() => {
    const c: Record<Classification, number> = {
      green: 0, yellow: 0, red: 0, blue: 0,
      none: 0, divider: 0, blank: 0,
    };
    inv.rows.forEach(r => {
      const eff = classOverrides[r.row] ?? r.classification;
      c[eff] += 1;
    });
    return c;
  }, [inv.rows, classOverrides]);

  const editValue = (sheet: SheetName, row: number, col: number, original: string | number | null): string => {
    const key = `${sheet}|${row}|${col}`;
    return key in edits ? edits[key] : asStr(original);
  };
  const setEdit = (sheet: SheetName, row: number, col: number, val: string) => {
    setEdits(prev => ({ ...prev, [`${sheet}|${row}|${col}`]: val }));
  };

  const toggleFilter = (c: Classification) => {
    setFilter(prev => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  };

  /** Effective classification = manual override (if operator clicked
   *  Mark green / Mark red) else the audit value baked into the JSON.
   *  All visibility + loadability decisions use this, so the override
   *  immediately moves a row between filter pills and the load set. */
  const effectiveClass = (r: SheetRow): Classification =>
    classOverrides[r.row] ?? r.classification;

  /** Rows currently visible in INVENTORY — controlled by the filter
   *  pills. Dividers and blanks always render so the row numbers line
   *  up with what the client sees. */
  const visibleInvRows = useMemo(() => {
    return inv.rows.filter(r => {
      if (r.classification === 'divider' || r.classification === 'blank') return true;
      return filter.has(effectiveClass(r));
    });
  }, [inv.rows, filter, classOverrides]);

  /** Rows that would be pushed to DB on Load. Always green by
   *  default; if the operator widened the filter we include whatever
   *  data rows are currently visible (and skip dividers/blanks). */
  const loadableInvRows = useMemo(() => {
    return inv.rows.filter(r => {
      if (r.classification === 'divider' || r.classification === 'blank') return false;
      const eff = effectiveClass(r);
      if (eff === 'none') return false;
      return filter.has(eff);
    });
  }, [inv.rows, filter, classOverrides]);

  /** One digest per model (normalised) drawn from the AVAILABLE rows
   *  of the IMEI sheet — powers every "Use IMEI <thing>" button on a
   *  row: name, supplier, colour breakdown, qty. Computed once. */
  const imeiByModel = useMemo(() => {
    interface Digest {
      modelLabel: string;       // canonical IMEI-side name
      suppliers: string[];
      colourCount: Map<string, number>;
      qty: number;
    }
    const out = new Map<string, Digest>();
    for (const r of SHEETS['IMEI NUMBERS'].rows) {
      if (r.classification === 'blank') continue;
      const m = asStr(r.cells[1]);
      const status = asStr(r.cells[7]).trim().toUpperCase();
      if (!m) continue;
      if (status && status !== 'AVAILABLE') continue;
      const key = normalizeModel(m);
      const d = out.get(key) ?? { modelLabel: m.trim(), suppliers: [], colourCount: new Map(), qty: 0 };
      d.qty += 1;
      const sup = asStr(r.cells[5]).trim();
      if (sup && !d.suppliers.includes(sup)) d.suppliers.push(sup);
      const colour = asStr(r.cells[4]).trim().toUpperCase();
      if (colour) d.colourCount.set(colour, (d.colourCount.get(colour) ?? 0) + 1);
      out.set(key, d);
    }
    return out;
  }, []);

  /** Build the colour-string used in the rollup ("BLUE 3 MINT 5 ...")
   *  from a count map. Insertion order is preserved. */
  const formatColourMap = (m: Map<string, number>): string => {
    const parts: string[] = [];
    for (const [c, n] of m.entries()) {
      parts.push(`${c} ${n}`);
    }
    return parts.join(' ');
  };

  const applyImeiSupplier = (rowI: number, model: string): boolean => {
    const d = imeiByModel.get(normalizeModel(model));
    if (!d || d.suppliers.length === 0) return false;
    setEdit('INVENTORY', rowI, 6, d.suppliers.join(' / '));
    return true;
  };
  const applyImeiName = (rowI: number, model: string): boolean => {
    const d = imeiByModel.get(normalizeModel(model));
    if (!d) return false;
    setEdit('INVENTORY', rowI, 0, d.modelLabel);
    return true;
  };
  const applyImeiColours = (rowI: number, model: string): boolean => {
    const d = imeiByModel.get(normalizeModel(model));
    if (!d || d.colourCount.size === 0) return false;
    setEdit('INVENTORY', rowI, 5, formatColourMap(d.colourCount));
    return true;
  };
  const applyImeiQty = (rowI: number, model: string): boolean => {
    const d = imeiByModel.get(normalizeModel(model));
    if (!d) return false;
    setEdit('INVENTORY', rowI, 2, String(d.qty));
    return true;
  };

  /** Flip a row's classification override. Used by the Mark green /
   *  Mark red button on each row's issue card. */
  const toggleRowClass = (rowI: number, target: Classification) => {
    setClassOverrides(prev => {
      const next = { ...prev };
      if (prev[rowI] === target) delete next[rowI];
      else next[rowI] = target;
      return next;
    });
  };

  /** Once-only auto-resolver: for any red row where the ONLY
   *  disagreement with the IMEI register is the supplier name, apply
   *  the IMEI supplier and flip the row green automatically. Per the
   *  client directive — these rows have all their stock confirmed
   *  (name + qty + colours match), only the supplier label was stale,
   *  so a name change is enough to clear them.
   *
   *  Runs once on mount only; the operator can still hit Mark red to
   *  undo any row the auto-resolver touched. */
  const [autoResolved, setAutoResolved] = useState<number[]>([]);
  useEffect(() => {
    const flips: number[] = [];
    const supplierEdits: Record<string, string> = {};
    const overrideEdits: Record<number, Classification> = {};
    for (const r of SHEETS.INVENTORY.rows) {
      if (r.classification !== 'red') continue;
      const model    = asStr(r.cells[0]).trim();
      const qty      = asStr(r.cells[2]).trim();
      const colours  = asStr(r.cells[5]).trim();
      const supplier = asStr(r.cells[6]).trim();
      const d = imeiByModel.get(normalizeModel(model));
      if (!d || d.suppliers.length === 0) continue;
      const imeiSup = d.suppliers.join(' / ');
      const imeiCol = formatColourMap(d.colourCount);
      const imeiQty = String(d.qty);
      const nameOk    = d.modelLabel.trim() === model;
      const qtyOk     = imeiQty === qty;
      const colourOk  = imeiCol === colours;
      const supplierMismatch = imeiSup !== supplier;
      if (nameOk && qtyOk && colourOk && supplierMismatch) {
        supplierEdits[`INVENTORY|${r.row}|6`] = imeiSup;
        overrideEdits[r.row] = 'green';
        flips.push(r.row);
      }
    }
    if (flips.length > 0) {
      setEdits(prev => ({ ...prev, ...supplierEdits }));
      setClassOverrides(prev => ({ ...prev, ...overrideEdits }));
      setAutoResolved(flips);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Pre-count the IMEI units we'll create so the toolbar button can
   *  show an honest preview ("Load to DB · 8 rows / 84 units"). Same
   *  matching logic the loader uses. */
  const loadableUnitCount = useMemo(() => {
    const imei = SHEETS['IMEI NUMBERS'];
    const availableByModel = new Map<string, number>();
    for (const r of imei.rows) {
      if (r.classification === 'blank') continue;
      const m = asStr(r.cells[1]);
      const status = asStr(r.cells[7]).trim().toUpperCase();
      if (!m) continue;
      if (status && status !== 'AVAILABLE') continue;
      const key = normalizeModel(m);
      availableByModel.set(key, (availableByModel.get(key) ?? 0) + 1);
    }
    let total = 0;
    for (const r of loadableInvRows) {
      const model = editValue('INVENTORY', r.row, 0, r.cells[0]).trim();
      total += availableByModel.get(normalizeModel(model)) ?? 0;
    }
    return total;
  }, [loadableInvRows, edits]);

  const handleDownloadXlsx = async () => {
    const wb = new ExcelJS.Workbook();
    const FILL: Record<Classification, string | null> = {
      green:   'FFC6EFCE',
      yellow:  'FFFFEB9C',
      red:     'FFFFC7CE',
      blue:    'FFBDD7EE',
      none:    null,
      divider: 'FFE2E8F0',
      blank:   null,
    };
    for (const name of SHEET_ORDER) {
      const sheet = SHEETS[name];
      const ws = wb.addWorksheet(name);
      const headers = [...sheet.headers];
      if (name === 'INVENTORY') headers.push('ISSUE / EXPLANATION');
      ws.addRow(headers);
      const hdr = ws.getRow(1);
      hdr.font = { bold: true, size: 10 };
      hdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      for (const r of sheet.rows) {
        const cells = r.cells.map((v, i) => editValue(name, r.row, i, v));
        if (name === 'INVENTORY') {
          const issue = WALKTHROUGH_ISSUES[r.row];
          const txt = r.classification === 'red' && issue
            ? `${issue.headline}\n• ${issue.bullets.join('\n• ')}${issue.questions?.length ? `\nAsk: ${issue.questions.join(' | ')}` : ''}`
            : '';
          cells.push(txt);
        }
        const xlsxRow = ws.addRow(cells);
        const argb = FILL[r.classification];
        if (argb) xlsxRow.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } }; });
        xlsxRow.font = { size: 10 };
        xlsxRow.alignment = { vertical: 'top', wrapText: true };
      }
      ws.columns.forEach((c, i) => {
        if (i === 0) c.width = 50;
        else if (i === sheet.headers.length) c.width = 60;
        else c.width = 14;
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

  const handleDownloadPdf = () => {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    let y = 14;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('INVENTORY_REPORT_2026 — Issue Report', 14, y);
    y += 6;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(
      `Generated ${new Date().toLocaleDateString()}  ·  ${invCounts.red} issues, ${invCounts.yellow} rollup gaps, ${invCounts.green} clean rows`,
      14, y,
    );
    y += 8;

    autoTable(doc, {
      startY: y,
      head: [['Row', 'Class', 'Model', 'Issue']],
      body: inv.rows
        .filter(r => r.classification === 'red' || r.classification === 'yellow')
        .map(r => [
          r.row,
          r.classification.toUpperCase(),
          asStr(r.cells[0]).slice(0, 38),
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
      const r = inv.rows.find(rr => rr.row === Number(rowStr));
      if (!r) return;
      doc.addPage();
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.text(`Row ${r.row}  ·  ${r.classification.toUpperCase()}`, 14, 16);
      doc.setFontSize(11);
      const modelLines = doc.splitTextToSize(asStr(r.cells[0]), 180);
      doc.text(modelLines, 14, 23);
      let yy = 23 + modelLines.length * 5 + 4;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text(`BP £${r.cells[1] ?? '—'}  ·  QTY ${r.cells[2] ?? '—'}  ·  Supplier ${r.cells[6] ?? '—'}`, 14, yy);
      yy += 6;
      doc.text(`Colours: ${r.cells[5] ?? '—'}`, 14, yy);
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

  /** Push the currently-filtered INVENTORY rows to Firestore. For each
   *  green row we create:
   *    - one InventoryAggregate doc (the rollup line for the master-data
   *      panel), AND
   *    - one InventoryUnit doc per matching available IMEI from the IMEI
   *      NUMBERS sheet — the dashboards, BuySheet, SellSheet etc all
   *      read inventoryUnits, so without these the data wouldn't show.
   *
   *  Supplier names resolve to existing supplier docs or create new
   *  ones (mirroring MasterDataLinkedImport's path). The whole load is
   *  tagged with a fresh importBatches entry. */
  const handleLoadToDb = async () => {
    setLoadState({ kind: 'loading', done: 0, total: loadableInvRows.length + 1 });
    try {
      const existingSuppliers = (await dbService.readAll('suppliers')) as Supplier[];
      const byNormName = new Map<string, Supplier>();
      for (const s of existingSuppliers) {
        const n = (s.name || '').trim().toLowerCase();
        if (n) byNormName.set(n, s);
      }
      const suppliersToCreate = new Map<string, Supplier>();
      const resolveSupplier = (name: string): { id: string; name: string } => {
        const cleanName = name.trim();
        const norm = cleanName.toLowerCase();
        const existing = byNormName.get(norm);
        if (existing?.id) return { id: existing.id, name: existing.name || cleanName };
        const id = slugify(cleanName);
        if (!suppliersToCreate.has(id)) {
          const supplier: Supplier = {
            id, name: cleanName,
            portal: 'Wholesale',
            ownerId: 'shared',
            createdAt: new Date().toISOString() as any,
          };
          suppliersToCreate.set(id, supplier);
          byNormName.set(norm, supplier);
        }
        return { id, name: cleanName };
      };

      // Build a lookup from normalised model → all matching IMEI rows
      // that are still available (blank status field). Done once so we
      // don't rescan the 655-row sheet per INVENTORY row.
      const imei = SHEETS['IMEI NUMBERS'];
      const imeiByModel = new Map<string, SheetRow[]>();
      for (const r of imei.rows) {
        if (r.classification === 'blank') continue;
        const m = asStr(r.cells[1]);
        const status = asStr(r.cells[7]).trim().toUpperCase();
        if (!m) continue;
        if (status && status !== 'AVAILABLE') continue;
        const key = normalizeModel(m);
        if (!imeiByModel.has(key)) imeiByModel.set(key, []);
        imeiByModel.get(key)!.push(r);
      }

      const importBatchId = await dbService.createImportBatch({
        sourceFile: 'INVENTORY_REPORT_2026_annotated.xlsx',
        sourceSheet: 'INVENTORY',
        rowCount: loadableInvRows.length,
        notes: `Client walkthrough — ${[...filter].join('/')} rows`,
      });
      const importedAt = new Date().toISOString();
      const today = importedAt.split('T')[0];

      const docs: { collection: string; id: string; data: any }[] = [];
      let unitsCreated = 0;

      for (const r of loadableInvRows) {
        const model    = editValue('INVENTORY', r.row, 0, r.cells[0]).trim();
        const bpStr    = editValue('INVENTORY', r.row, 1, r.cells[1]).trim();
        const qtyStr   = editValue('INVENTORY', r.row, 2, r.cells[2]).trim();
        const valStr   = editValue('INVENTORY', r.row, 4, r.cells[4]).trim();
        const colours  = editValue('INVENTORY', r.row, 5, r.cells[5]).trim();
        const supRaw   = editValue('INVENTORY', r.row, 6, r.cells[6]).trim();
        const notes    = editValue('INVENTORY', r.row, 7, r.cells[7]).trim();
        const bp       = parseFloat(bpStr);
        const qtyNum   = parseFloat(qtyStr);
        const supplierNames = supRaw.split(/[\/,]/).map(s => s.trim()).filter(Boolean);
        const resolvedSuppliers = supplierNames.map(resolveSupplier);
        const supplierIds   = resolvedSuppliers.map(s => s.id);
        const primarySup    = resolvedSuppliers[0];

        const parsed = parseBrandModelStorage(model);
        const category = detectCategory(model);

        // 1) Aggregate doc — populates Admin → Master Data view.
        const aggId = `walkthrough_${importBatchId}_agg_r${r.row}`;
        const aggregate: Omit<InventoryAggregate, 'createdAt' | 'updatedAt'> & { createdAt?: any; updatedAt?: any } = {
          id: aggId,
          model,
          storage:      parsed.storage,
          buyPrice:     Number.isFinite(bp) ? bp : undefined,
          quantityNum:  Number.isFinite(qtyNum) ? qtyNum : undefined,
          quantityText: Number.isFinite(qtyNum) ? undefined : qtyStr || undefined,
          coloursRaw:   colours || undefined,
          coloursMap:   parseColoursRaw(colours),
          supplierIds,
          notes:        [notes, valStr ? `value=${valStr}` : ''].filter(Boolean).join(' · ') || undefined,
          importBatchId,
          sourceRow:    r.row,
          ownerId:      'shared',
        };
        docs.push({ collection: 'inventoryAggregates', id: aggId, data: aggregate });

        // 2) Unit docs — one per available IMEI in the IMEI NUMBERS
        //    sheet matching this model. These are what the dashboards,
        //    Inventory, BuySheet and SellSheet actually read.
        const matchedImeis = imeiByModel.get(normalizeModel(model)) ?? [];
        for (const ir of matchedImeis) {
          const imeiVal = asStr(ir.cells[2]).trim();
          if (!imeiVal) continue;
          const imeiBp  = parseFloat(asStr(ir.cells[3]));
          const imeiCol = asStr(ir.cells[4]).trim();
          const imeiSupRaw = asStr(ir.cells[5]).trim();
          const imeiSup = imeiSupRaw ? resolveSupplier(imeiSupRaw) : primarySup;
          const imeiNotes  = asStr(ir.cells[6]).trim();
          const dateInRaw  = asStr(ir.cells[0]).trim();
          const dateIn = dateInRaw && !Number.isNaN(Date.parse(dateInRaw))
            ? new Date(dateInRaw).toISOString().split('T')[0]
            : today;
          const unitId = `walkthrough_${importBatchId}_u_${imeiVal}`;
          const unit: Partial<InventoryUnit> & { id: string } = {
            id:           unitId,
            imei:         imeiVal,
            model,
            brand:        parsed.brand,
            category,
            colour:       imeiCol || 'Unspecified',
            storage:      parsed.storage,
            buyPrice:     Number.isFinite(imeiBp) ? imeiBp : (Number.isFinite(bp) ? bp : 0),
            dateIn,
            supplierId:   imeiSup?.id ?? primarySup?.id ?? '',
            supplierName: imeiSup?.name ?? primarySup?.name,
            supplierIds:  supplierIds.length ? supplierIds : (imeiSup ? [imeiSup.id] : []),
            status:       'available',
            notes:        imeiNotes || undefined,
            importBatchId,
            sourceFile:   'INVENTORY_REPORT_2026_annotated.xlsx',
            sourceRow:    ir.row,
            importedAt,
            ownerId:      'shared',
          };
          docs.push({ collection: 'inventoryUnits', id: unitId, data: unit });
          unitsCreated += 1;
        }
      }

      // Supplier docs need to be staged BEFORE the units that reference
      // them — bulkCreate writes in order, so we sort them first.
      const supplierDocs: { collection: string; id: string; data: any }[] = [];
      for (const s of suppliersToCreate.values()) {
        supplierDocs.push({ collection: 'suppliers', id: s.id, data: s });
      }
      const finalDocs = [...supplierDocs, ...docs];

      await dbService.bulkCreate(finalDocs, (done, total) =>
        setLoadState({ kind: 'loading', done, total }),
      );
      setLoadState({ kind: 'done', count: loadableInvRows.length, units: unitsCreated });
    } catch (err: any) {
      setLoadState({ kind: 'error', msg: err?.message || String(err) });
    }
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
              The client's three sheets rendered 1:1. Edit cells inline, then load corrected rows into the DB.
            </p>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button
              onClick={() => setLoadState({ kind: 'confirm', rows: loadableInvRows })}
              disabled={loadableInvRows.length === 0}
              className="inline-flex items-center gap-1.5 bg-emerald-600 text-white rounded-xl px-3 py-2 text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-700 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Upload size={11} /> Load to DB · {loadableInvRows.length} rows / {loadableUnitCount} units
            </button>
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
              <FileText size={11} /> Issue PDF
            </button>
          </div>
        </div>

        {/* Auto-resolved banner — surfaces what the mount-time
            supplier-only resolver fixed, so the operator can see at
            a glance which rows joined the green set without effort. */}
        {autoResolved.length > 0 && (
          <div className="mt-3 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg flex items-start gap-2">
            <CheckCheck size={14} className="text-emerald-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1 text-[11px]">
              <p className="font-bold text-emerald-900">
                {autoResolved.length} row{autoResolved.length === 1 ? '' : 's'} auto-resolved (supplier-name-only mismatch)
              </p>
              <p className="text-emerald-700 mt-0.5 font-mono">
                Rows {autoResolved.sort((a, b) => a - b).join(', ')} — supplier rewritten to match the IMEI register, flipped green. Mark red on any row to undo.
              </p>
            </div>
          </div>
        )}

        {/* Sheet tabs */}
        <div className="mt-4 flex gap-1 border-b border-slate-200">
          {SHEET_ORDER.map(name => (
            <button
              key={name}
              onClick={() => setActiveSheet(name)}
              className={`px-3 py-2 text-[10px] font-bold uppercase tracking-widest border-b-2 -mb-px transition-all
                ${activeSheet === name
                  ? 'border-slate-900 text-slate-900'
                  : 'border-transparent text-slate-400 hover:text-slate-700'}`}
            >
              {name}
              <span className="ml-1.5 text-slate-400 font-mono">{SHEETS[name].rows.length}</span>
            </button>
          ))}
        </div>

        {/* INVENTORY filter pills — only on the INVENTORY tab */}
        {activeSheet === 'INVENTORY' && (
          <div className="mt-3 flex flex-wrap gap-2 items-center">
            <span className="text-[9px] font-mono uppercase tracking-widest text-slate-400">Show:</span>
            {CLASS_PILLS.map(p => {
              const active = filter.has(p.id);
              return (
                <button
                  key={p.id}
                  onClick={() => toggleFilter(p.id)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-mono uppercase tracking-wider border transition-all
                    ${active
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'}`}
                >
                  <span className={`w-2 h-2 rounded-full ${p.chip}`} />
                  {p.label}
                  <span className={active ? 'text-slate-300' : 'text-slate-400 font-bold'}>{invCounts[p.id]}</span>
                </button>
              );
            })}
            <span className="text-[9px] font-mono text-slate-400 ml-2">
              Default: green rows only. Toggle to reveal others.
            </span>
          </div>
        )}
      </div>

      {/* Active sheet */}
      {activeSheet === 'INVENTORY' && (
        <InventoryTable
          sheet={inv}
          visibleRows={visibleInvRows}
          editValue={editValue}
          setEdit={setEdit}
          imeiByModel={imeiByModel}
          formatColourMap={formatColourMap}
          applyImeiSupplier={applyImeiSupplier}
          applyImeiName={applyImeiName}
          applyImeiColours={applyImeiColours}
          applyImeiQty={applyImeiQty}
          effectiveClass={effectiveClass}
          isOverridden={(rowI: number) => rowI in classOverrides}
          toggleRowClass={toggleRowClass}
        />
      )}
      {activeSheet === 'IMEI NUMBERS' && (
        <RawSheetTable sheet={SHEETS['IMEI NUMBERS']} name="IMEI NUMBERS" editValue={editValue} setEdit={setEdit} />
      )}
      {activeSheet === 'SUPPLIER WHATSAPP UPDATES' && (
        <RawSheetTable sheet={SHEETS['SUPPLIER WHATSAPP UPDATES']} name="SUPPLIER WHATSAPP UPDATES" editValue={editValue} setEdit={setEdit} />
      )}

      {/* Load-to-DB modal */}
      <LoadToDbModal
        state={loadState}
        onConfirm={handleLoadToDb}
        onClose={() => setLoadState({ kind: 'idle' })}
      />
    </div>
  );
}

/** INVENTORY-specific table.
 *
 *  Each data row carries:
 *    - per-cell mismatch detection against the IMEI register: name,
 *      qty, colour, supplier. When any of these disagree, a tiny
 *      "Use IMEI" pencil button renders inside the cell — one click
 *      copies the IMEI-side value into the rollup cell.
 *    - an Issue / Explanation column on the right with the audit
 *      headline (when there is one), live mismatch chips driven by
 *      the current cell values, and a Mark green / Mark red toggle.
 *      The toggle writes a per-row classification override that
 *      flows through filter visibility and the Load-to-DB scope. */
function InventoryTable({
  sheet, visibleRows, editValue, setEdit,
  imeiByModel, formatColourMap,
  applyImeiSupplier, applyImeiName, applyImeiColours, applyImeiQty,
  effectiveClass, isOverridden, toggleRowClass,
}: {
  sheet: Sheet;
  visibleRows: SheetRow[];
  editValue: (sheet: SheetName, row: number, col: number, original: string | number | null) => string;
  setEdit: (sheet: SheetName, row: number, col: number, val: string) => void;
  imeiByModel: Map<string, {
    modelLabel: string;
    suppliers: string[];
    colourCount: Map<string, number>;
    qty: number;
  }>;
  formatColourMap: (m: Map<string, number>) => string;
  applyImeiSupplier: (rowI: number, model: string) => boolean;
  applyImeiName:     (rowI: number, model: string) => boolean;
  applyImeiColours:  (rowI: number, model: string) => boolean;
  applyImeiQty:      (rowI: number, model: string) => boolean;
  effectiveClass: (r: SheetRow) => Classification;
  isOverridden:   (rowI: number) => boolean;
  toggleRowClass: (rowI: number, target: Classification) => void;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] table-fixed">
          <colgroup>
            <col style={{ width: '44px' }} />
            <col style={{ width: '20%' }} />
            <col style={{ width: '60px' }} />
            <col style={{ width: '90px' }} />
            <col style={{ width: '70px' }} />
            <col style={{ width: '17%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '9%' }} />
            <col />
          </colgroup>
          <thead>
            <tr className="bg-slate-100 text-slate-700 sticky top-0 z-10">
              <th className="px-2 py-2 text-left font-mono text-[9px] uppercase tracking-widest text-slate-400">#</th>
              {sheet.headers.map((h, i) => (
                <th key={i} className="px-2 py-2 text-left font-bold text-[10px] uppercase tracking-wider">
                  {h ?? ''}
                </th>
              ))}
              <th className="px-2 py-2 text-left font-bold text-[10px] uppercase tracking-wider">Issue / Explanation</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map(r => {
              if (r.classification === 'blank') {
                return (
                  <tr key={r.row} className="bg-white">
                    <td className="px-2 py-1 text-right font-mono text-[9px] text-slate-300">{r.row}</td>
                    <td colSpan={sheet.headers.length + 1} className="px-2 py-1">&nbsp;</td>
                  </tr>
                );
              }
              if (r.classification === 'divider') {
                return (
                  <tr key={r.row} className="bg-slate-200">
                    <td className="px-2 py-2 text-right font-mono text-[9px] text-slate-500 font-bold">{r.row}</td>
                    <td colSpan={sheet.headers.length + 1} className="px-2 py-2 font-bold text-slate-900 uppercase tracking-widest text-[11px]">
                      {asStr(r.cells[0])}
                    </td>
                  </tr>
                );
              }

              // Live cell values (after edits)
              const currentModel    = editValue('INVENTORY', r.row, 0, r.cells[0]);
              const currentQty      = editValue('INVENTORY', r.row, 2, r.cells[2]);
              const currentColours  = editValue('INVENTORY', r.row, 5, r.cells[5]);
              const currentSupplier = editValue('INVENTORY', r.row, 6, r.cells[6]);

              // Look up the IMEI-side digest for this model.
              const d = imeiByModel.get(normalizeModel(currentModel));
              const imeiSupString = d?.suppliers.join(' / ') ?? '';
              const imeiColString = d ? formatColourMap(d.colourCount) : '';
              const imeiQtyStr    = d ? String(d.qty) : '';

              // Per-cell mismatch detection — only flags when the IMEI
              // register has data to suggest. A row with no matching
              // IMEIs (e.g. row 24 phantom units) shows no buttons.
              const nameMismatch     = !!d && d.modelLabel.trim() !== currentModel.trim();
              const qtyMismatch      = !!d && imeiQtyStr !== currentQty.trim();
              const colourMismatch   = !!d && d.colourCount.size > 0 && imeiColString !== currentColours.trim();
              const supplierMismatch = !!d && d.suppliers.length > 0 && imeiSupString !== currentSupplier.trim();

              const eff      = effectiveClass(r);
              const isFlipped = isOverridden(r.row);
              const issue    = WALKTHROUGH_ISSUES[r.row] as RowIssue | undefined;
              const anyMismatch = nameMismatch || qtyMismatch || colourMismatch || supplierMismatch;

              return (
                <tr key={r.row} className={`${ROW_BG[eff]} border-b border-slate-100`}>
                  <td className="px-2 py-1.5 text-right font-mono text-[9px] text-slate-400 align-top pt-2">{r.row}</td>
                  {sheet.headers.map((_, i) => {
                    // Cells with potential mismatch action buttons.
                    let v = '';
                    let alignR: 'left' | 'right' = 'left';
                    let showBtn = false;
                    let btnTitle = '';
                    let btnIcon: React.ReactNode = null;
                    let btnClick: (() => void) | null = null;
                    if (i === 0) {
                      v = currentModel;
                      showBtn = nameMismatch;
                      btnTitle = `Use IMEI name: ${d?.modelLabel}`;
                      btnIcon = <Edit3 size={11} />;
                      btnClick = () => { applyImeiName(r.row, currentModel); };
                    } else if (i === 2) {
                      v = currentQty;
                      alignR = 'right';
                      showBtn = qtyMismatch;
                      btnTitle = `Use IMEI count: ${imeiQtyStr}`;
                      btnIcon = <RefreshCw size={11} />;
                      btnClick = () => { applyImeiQty(r.row, currentModel); };
                    } else if (i === 5) {
                      v = currentColours;
                      showBtn = colourMismatch;
                      btnTitle = `Use IMEI colours: ${imeiColString}`;
                      btnIcon = <Tag size={11} />;
                      btnClick = () => { applyImeiColours(r.row, currentModel); };
                    } else if (i === 6) {
                      v = currentSupplier;
                      showBtn = supplierMismatch;
                      btnTitle = `Use IMEI supplier: ${imeiSupString}`;
                      btnIcon = <Wand2 size={11} />;
                      btnClick = () => { applyImeiSupplier(r.row, currentModel); };
                    } else {
                      return (
                        <td key={i} className="px-1 py-1 align-top">
                          <EditableCell
                            value={editValue('INVENTORY', r.row, i, r.cells[i])}
                            onChange={vv => setEdit('INVENTORY', r.row, i, vv)}
                            align={i === 1 || i === 4 ? 'right' : 'left'}
                          />
                        </td>
                      );
                    }
                    return (
                      <td key={i} className="px-1 py-1 align-top">
                        <div className="flex items-center gap-1">
                          <EditableCell
                            value={v}
                            onChange={vv => setEdit('INVENTORY', r.row, i, vv)}
                            align={alignR}
                          />
                          {showBtn && btnClick && (
                            <button
                              type="button"
                              onClick={btnClick}
                              title={btnTitle}
                              className="flex-shrink-0 p-1 rounded text-sky-600 hover:bg-sky-100 hover:text-sky-800 transition-all"
                            >
                              {btnIcon}
                            </button>
                          )}
                        </div>
                      </td>
                    );
                  })}
                  <td className="px-2 py-1.5 align-top">
                    <IssueCard
                      effectiveClass={eff}
                      originalClass={r.classification}
                      isFlipped={isFlipped}
                      issue={issue}
                      mismatches={{
                        name: nameMismatch,
                        qty: qtyMismatch,
                        colour: colourMismatch,
                        supplier: supplierMismatch,
                      }}
                      anyMismatch={anyMismatch}
                      onMarkGreen={() => toggleRowClass(r.row, 'green')}
                      onMarkRed={() => toggleRowClass(r.row, 'red')}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Plain renderer for IMEI / WHATSAPP sheets — no classifications. */
function RawSheetTable({
  sheet, name, editValue, setEdit,
}: {
  sheet: Sheet;
  name: SheetName;
  editValue: (sheet: SheetName, row: number, col: number, original: string | number | null) => string;
  setEdit: (sheet: SheetName, row: number, col: number, val: string) => void;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden">
      <div className="overflow-x-auto max-h-[70vh]">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="bg-slate-100 text-slate-700 sticky top-0 z-10">
              <th className="px-2 py-2 text-right font-mono text-[9px] uppercase tracking-widest text-slate-400 w-12">#</th>
              {sheet.headers.map((h, i) => (
                <th key={i} className="px-2 py-2 text-left font-bold text-[10px] uppercase tracking-wider whitespace-nowrap">
                  {h ?? ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map(r => {
              if (r.classification === 'blank') {
                return (
                  <tr key={r.row} className="bg-white">
                    <td className="px-2 py-1 text-right font-mono text-[9px] text-slate-300">{r.row}</td>
                    <td colSpan={sheet.headers.length} className="px-2 py-1">&nbsp;</td>
                  </tr>
                );
              }
              return (
                <tr key={r.row} className="bg-white hover:bg-slate-50 border-b border-slate-100">
                  <td className="px-2 py-1 text-right font-mono text-[9px] text-slate-400 align-top pt-2">{r.row}</td>
                  {sheet.headers.map((_, i) => (
                    <td key={i} className="px-1 py-1 align-top">
                      <EditableCell
                        value={editValue(name, r.row, i, r.cells[i])}
                        onChange={v => setEdit(name, r.row, i, v)}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** The right-column card on every INVENTORY row. Shows three things:
 *
 *  1. A status badge — OPEN (red) / RESOLVED (green) — plus the
 *     original audit classification when the operator has overridden
 *     it ("was: ISSUE"), so the audit trail stays visible.
 *  2. Live mismatch chips driven by the current cell values: NAME,
 *     QTY, COLOUR, SUPPLIER. Disappear as the operator applies fixes.
 *  3. The audit headline / bullets / "ask the client" questions (when
 *     there's an entry for this row), and a Mark green / Mark red
 *     toggle at the bottom. */
function IssueCard({
  effectiveClass, originalClass, isFlipped, issue, mismatches, anyMismatch,
  onMarkGreen, onMarkRed,
}: {
  effectiveClass: Classification;
  originalClass: Classification;
  isFlipped: boolean;
  issue: RowIssue | undefined;
  mismatches: { name: boolean; qty: boolean; colour: boolean; supplier: boolean };
  anyMismatch: boolean;
  onMarkGreen: () => void;
  onMarkRed: () => void;
}) {
  // Render nothing for rows that are green from source and have
  // nothing to say — keeps the meeting-mode default view clean.
  if (effectiveClass === 'green' && !anyMismatch && !issue && !isFlipped) return null;

  const isGreen = effectiveClass === 'green';
  const statusClass = isGreen
    ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
    : effectiveClass === 'yellow'
      ? 'bg-amber-100 text-amber-700 border-amber-200'
      : 'bg-rose-100 text-rose-700 border-rose-200';
  const statusLabel = isGreen ? 'Resolved' : effectiveClass === 'yellow' ? 'Gap' : 'Open';

  const chips: { id: string; label: string; tone: 'rose' | 'sky' }[] = [];
  if (mismatches.name)     chips.push({ id: 'name',     label: 'NAME',     tone: 'sky' });
  if (mismatches.qty)      chips.push({ id: 'qty',      label: 'QTY',      tone: 'sky' });
  if (mismatches.colour)   chips.push({ id: 'colour',   label: 'COLOUR',   tone: 'sky' });
  if (mismatches.supplier) chips.push({ id: 'supplier', label: 'SUPPLIER', tone: 'sky' });

  return (
    <div className="space-y-1.5 leading-snug">
      {/* Status badge + audit-history pill */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[8px] font-bold uppercase tracking-widest ${statusClass}`}>
          {isGreen ? <CheckCircle2 size={9} /> : <AlertCircle size={9} />}
          {statusLabel}
        </span>
        {isFlipped && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-slate-200 bg-white text-slate-500 text-[8px] font-bold uppercase tracking-widest">
            was: {originalClass}
          </span>
        )}
        {chips.map(c => (
          <span
            key={c.id}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-sky-200 bg-sky-50 text-sky-700 text-[8px] font-bold uppercase tracking-widest"
          >
            {c.label}
          </span>
        ))}
      </div>

      {/* Audit context, if we have a write-up for this row */}
      {issue && (
        <>
          <p className={`text-[11px] font-bold ${isGreen ? 'text-emerald-900' : 'text-rose-900'}`}>{issue.headline}</p>
          <ul className="space-y-0.5">
            {issue.bullets.map((b, i) => (
              <li key={i} className="text-[10px] text-slate-700 flex gap-1.5">
                <span className={`flex-shrink-0 ${isGreen ? 'text-emerald-400' : 'text-rose-400'}`}>•</span>
                <span>{b}</span>
              </li>
            ))}
          </ul>
          {issue.questions?.length ? (
            <div className={`mt-1.5 pt-1.5 border-t ${isGreen ? 'border-emerald-200' : 'border-rose-200'}`}>
              <p className={`text-[8px] font-bold uppercase tracking-widest mb-0.5 ${isGreen ? 'text-emerald-400' : 'text-rose-400'}`}>Ask the client</p>
              {issue.questions.map((q, i) => (
                <p key={i} className="text-[10px] text-slate-800 italic">"{q}"</p>
              ))}
            </div>
          ) : null}
        </>
      )}

      {/* Mark-green / mark-red toggle. Always shown when there's
          anything to act on (mismatches present, audit issue exists,
          or row was already overridden). */}
      <div className="pt-1.5 flex gap-1.5">
        {isGreen ? (
          <button
            type="button"
            onClick={onMarkRed}
            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-white border border-rose-200 text-rose-700 hover:bg-rose-50 text-[9px] font-bold uppercase tracking-widest transition-all"
          >
            <FlagTriangleRight size={10} /> Mark red
          </button>
        ) : (
          <button
            type="button"
            onClick={onMarkGreen}
            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700 text-[9px] font-bold uppercase tracking-widest transition-all"
          >
            <CheckCheck size={10} /> Mark green
          </button>
        )}
      </div>
    </div>
  );
}

function EditableCell({
  value, onChange, align = 'left',
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

/** Confirm / progress / done modal for the Load-to-DB action.
 *
 *  Rendered into document.body via a portal — the walkthrough table
 *  sits inside scrolling/transformed ancestors, and `fixed` positioning
 *  inside a transformed parent anchors to the parent, not the viewport.
 *  Portal + no animation = the overlay appears instantly the moment
 *  the user clicks "Load to DB". */
function LoadToDbModal({
  state, onConfirm, onClose,
}: {
  state:
    | { kind: 'idle' }
    | { kind: 'confirm'; rows: SheetRow[] }
    | { kind: 'loading'; done: number; total: number }
    | { kind: 'done'; count: number; units: number }
    | { kind: 'error'; msg: string };
  onConfirm: () => void;
  onClose: () => void;
}) {
  if (state.kind === 'idle') return null;
  const canClose = state.kind === 'confirm' || state.kind === 'done' || state.kind === 'error';
  const body = (
    <div
      className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4"
      style={{ pointerEvents: 'auto' }}
      onClick={canClose ? onClose : undefined}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6"
        onClick={e => e.stopPropagation()}
      >
        {state.kind === 'confirm' && (
          <>
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h3 className="text-base font-bold flex items-center gap-2">
                  <Upload size={16} className="text-emerald-600" /> Load to inventory DB
                </h3>
                <p className="text-[11px] text-slate-500 mt-1 font-mono">
                  Pushes {state.rows.length} corrected aggregate rows into Firestore.
                </p>
              </div>
              <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={16} /></button>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-4 text-[11px] text-slate-600 space-y-1">
              <p>• Creates an <code>inventoryAggregates</code> rollup per row, AND</p>
              <p>• One <code>inventoryUnits</code> doc per matching available IMEI (this is what Dashboard, Inventory and Sell read).</p>
              <p>• Supplier names get matched to existing suppliers, or new docs created.</p>
              <p>• Tagged with a fresh <code>importBatches</code> entry so this run is reversible.</p>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={onClose} className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-600 hover:text-slate-900">Cancel</button>
              <button onClick={onConfirm} className="px-3 py-2 bg-emerald-600 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-700">Load {state.rows.length} rows</button>
            </div>
          </>
        )}
        {state.kind === 'loading' && (
          <div className="text-center py-4">
            <Loader2 size={28} className="mx-auto text-emerald-600 animate-spin" />
            <p className="mt-3 text-[12px] font-bold">Writing {state.done} / {state.total}…</p>
            <div className="mt-3 w-full bg-slate-100 rounded-full h-1.5">
              <div className="bg-emerald-500 h-1.5 rounded-full transition-all" style={{ width: `${(state.done / Math.max(state.total, 1)) * 100}%` }} />
            </div>
          </div>
        )}
        {state.kind === 'done' && (
          <div className="text-center py-4">
            <CheckCheck size={28} className="mx-auto text-emerald-600" />
            <p className="mt-3 text-[13px] font-bold">
              Loaded {state.count} aggregate rows + {state.units} stock units.
            </p>
            <p className="mt-1 text-[11px] text-slate-500 font-mono">
              Stock now visible in Dashboard, Inventory and Sell screens.
            </p>
            <button onClick={onClose} className="mt-4 px-4 py-2 bg-slate-900 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest">Close</button>
          </div>
        )}
        {state.kind === 'error' && (
          <div className="py-2">
            <h3 className="text-base font-bold text-rose-700 flex items-center gap-2">
              <AlertCircle size={16} /> Load failed
            </h3>
            <p className="mt-2 text-[12px] text-slate-700 font-mono break-words">{state.msg}</p>
            <button onClick={onClose} className="mt-4 px-4 py-2 bg-slate-900 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest">Close</button>
          </div>
        )}
      </div>
    </div>
  );
  return createPortal(body, document.body);
}
