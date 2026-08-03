/**
 * reportView.ts — in-browser "exact Excel view" for the report workbooks.
 *
 * The download path builds an .xlsx via ExcelJS (clientReport.ts) where most
 * derived cells are FORMULAS (`H2-G2`, `SUM(G2:G9)`, `IFERROR(...)`) with no
 * cached result — Excel computes them on open. For the in-browser preview we
 * parse the same buffer back and evaluate that closed formula set ourselves,
 * so the tester sees the exact grid (values, red voided fills, bold TOTAL
 * rows, Summary tab) without downloading.
 *
 * Scope of the evaluator — only what our writers emit:
 *   - arithmetic  + - * / with parens
 *   - percent literals (`16.67%`, `5%`)
 *   - cell refs incl. multi-letter columns (`AA4`, `AD2`)
 *   - SUM(range | args), IFERROR(expr, fallback)
 * Anything else degrades gracefully: the cell shows `=<formula>` verbatim.
 */

import ExcelJS from 'exceljs';

// ---------------------------------------------------------------------------
// View model
// ---------------------------------------------------------------------------

export interface ViewCell {
  display: string;
  align: 'left' | 'right';
  bold?: boolean;
  /** CSS hex fill (e.g. '#FEE2E2' for voided rows) — from the cell/row style. */
  fillColor?: string;
  /** Tooltip — the source formula for computed cells. */
  title?: string;
}

export interface ViewSheet {
  name: string;
  rows: ViewCell[][];
  columnCount: number;
  /** Approx column widths in px (from the worksheet's column widths). */
  columnWidths: number[];
  /** Total data rows before the render cap was applied (0 = not truncated). */
  truncatedFrom: number;
}

export interface ReportViewModel {
  title: string;
  sheets: ViewSheet[];
}

/** Hard cap per sheet so a pathological all-time export can't hang the tab. */
const MAX_VIEW_ROWS = 3000;

// ---------------------------------------------------------------------------
// Column letter helpers (local — keeps this module dependency-free)
// ---------------------------------------------------------------------------

export function numToCol(n: number): string {
  let s = '';
  let x = n;
  while (x > 0) {
    const m = (x - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

export function colToNum(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

// ---------------------------------------------------------------------------
// Formula evaluator
// ---------------------------------------------------------------------------

type Tok =
  | { t: 'num'; v: number }
  | { t: 'ref'; v: string }
  | { t: 'id'; v: string }
  | { t: 'str'; v: string }
  | { t: 'op'; v: string };

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ') { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      toks.push({ t: 'num', v: parseFloat(src.slice(i, j)) });
      i = j;
      continue;
    }
    // Sheet-qualified reference — 'AMAZON'!$S$204. The Summary tab points at
    // each marketplace tab's TOTAL row and at its fillable rows, so the
    // preview has to resolve across sheets, not just within one.
    if (c === "'") {
      const close = src.indexOf("'", i + 1);
      if (close < 0) throw new Error('unterminated sheet name in formula');
      const sheet = src.slice(i + 1, close);
      if (src[close + 1] !== '!') throw new Error('sheet name not followed by !');
      let j = close + 2;
      while (j < src.length && /[A-Za-z$]/.test(src[j])) j++;
      let k = j;
      while (k < src.length && /[0-9]/.test(src[k])) k++;
      if (k === j) throw new Error('bad cross-sheet reference');
      const letters = src.slice(close + 2, j).replace(/\$/g, '').toUpperCase();
      toks.push({ t: 'ref', v: `'${sheet}'!${letters}${src.slice(j, k)}` });
      i = k;
      continue;
    }
    if (/[A-Za-z$]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z$]/.test(src[j])) j++;
      let k = j;
      while (k < src.length && /[0-9]/.test(src[k])) k++;
      const letters = src.slice(i, j).replace(/\$/g, '').toUpperCase();
      if (k > j) { toks.push({ t: 'ref', v: letters + src.slice(j, k) }); i = k; }
      else       { toks.push({ t: 'id',  v: letters }); i = j; }
      continue;
    }
    // String literal. The only ones the report writes are the empty string in
    // a blank-row guard — IF($H5="","",…) — but quote handling is quote
    // handling, so parse it properly rather than special-casing `""`.
    if (c === '"') {
      let j = i + 1; let out = '';
      while (j < src.length) {
        if (src[j] === '"') {
          if (src[j + 1] === '"') { out += '"'; j += 2; continue; }  // escaped ""
          break;
        }
        out += src[j]; j++;
      }
      if (j >= src.length) throw new Error('unterminated string in formula');
      toks.push({ t: 'str', v: out });
      i = j + 1;
      continue;
    }
    if (c === '<' && src[i + 1] === '>') { toks.push({ t: 'op', v: '<>' }); i += 2; continue; }
    if ('+-*/(),:%='.includes(c)) { toks.push({ t: 'op', v: c }); i++; continue; }
    throw new Error(`unexpected char '${c}' in formula`);
  }
  return toks;
}

type Node =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'ref'; v: string }
  | { k: 'range'; from: string; to: string }
  | { k: 'bin'; op: string; l: Node; r: Node }
  | { k: 'neg'; e: Node }
  | { k: 'pct'; e: Node }
  | { k: 'call'; name: string; args: Node[] };

class Parser {
  private pos = 0;
  constructor(private toks: Tok[]) {}

  private peek(): Tok | undefined { return this.toks[this.pos]; }
  private next(): Tok | undefined { return this.toks[this.pos++]; }
  private isOp(v: string): boolean {
    const t = this.peek();
    return !!t && t.t === 'op' && t.v === v;
  }
  private expect(v: string): void {
    const t = this.next();
    if (!t || t.t !== 'op' || t.v !== v) throw new Error(`expected '${v}'`);
  }

  parse(): Node {
    const e = this.expr();
    if (this.pos < this.toks.length) throw new Error('trailing tokens');
    return e;
  }

  /** Comparison binds loosest — `$H5=""` is one argument to IF, not `$H5` = (""). */
  private expr(): Node {
    let l = this.sum();
    while (this.isOp('=') || this.isOp('<>')) {
      const op = (this.next() as Tok & { t: 'op' }).v;
      l = { k: 'bin', op, l, r: this.sum() };
    }
    return l;
  }

  private sum(): Node {
    let l = this.term();
    while (this.isOp('+') || this.isOp('-')) {
      const op = (this.next() as Tok & { t: 'op' }).v;
      l = { k: 'bin', op, l, r: this.term() };
    }
    return l;
  }

  private term(): Node {
    let l = this.unary();
    while (this.isOp('*') || this.isOp('/')) {
      const op = (this.next() as Tok & { t: 'op' }).v;
      l = { k: 'bin', op, l, r: this.unary() };
    }
    return l;
  }

  private unary(): Node {
    if (this.isOp('-')) { this.next(); return { k: 'neg', e: this.unary() }; }
    if (this.isOp('+')) { this.next(); return this.unary(); }
    return this.postfix();
  }

  private postfix(): Node {
    let e = this.primary();
    while (this.isOp('%')) { this.next(); e = { k: 'pct', e }; }
    return e;
  }

  private primary(): Node {
    const t = this.next();
    if (!t) throw new Error('unexpected end of formula');
    if (t.t === 'num') return { k: 'num', v: t.v };
    if (t.t === 'str') return { k: 'str', v: t.v };
    if (t.t === 'ref') {
      // A range only appears as a function argument (SUM(G2:G9)).
      if (this.isOp(':')) {
        this.next();
        const to = this.next();
        if (!to || to.t !== 'ref') throw new Error('bad range');
        return { k: 'range', from: t.v, to: to.v };
      }
      return { k: 'ref', v: t.v };
    }
    if (t.t === 'id') {
      this.expect('(');
      const args: Node[] = [];
      if (!this.isOp(')')) {
        args.push(this.expr());
        while (this.isOp(',')) { this.next(); args.push(this.expr()); }
      }
      this.expect(')');
      return { k: 'call', name: t.v, args };
    }
    if (t.t === 'op' && t.v === '(') {
      const e = this.expr();
      this.expect(')');
      return e;
    }
    throw new Error(`unexpected token`);
  }
}

export type RefResolver = (ref: string) => number;

/**
 * What a cell evaluates to. Everything here is a number except the empty
 * string, which is what a blank-row guard returns: the Sales Report's fillable
 * tail is `IF($H5="","",<formula>)` on every derived column, so an untouched
 * row must come back as "blank", not as 0.00 repeated two hundred times.
 */
export type CellValue = number | '';

/** Blank behaves as 0 in arithmetic and in SUM — same as Excel. */
const num = (v: CellValue): number => (v === '' ? 0 : v);

function evalNode(n: Node, resolve: RefResolver): CellValue {
  switch (n.k) {
    case 'num':   return n.v;
    case 'str':   return n.v === '' ? '' : NaN;   // only "" is meaningful to us
    case 'ref':   return resolve(n.v);
    case 'neg':   return -num(evalNode(n.e, resolve));
    case 'pct':   return num(evalNode(n.e, resolve)) / 100;
    case 'bin': {
      const lv = evalNode(n.l, resolve);
      const rv = evalNode(n.r, resolve);
      // Comparison against "" is the blank test in a guard. The resolver hands
      // back numbers, so an empty cell arrives as 0 — and 0 is the right answer
      // either way here: a row with no sale price is not a sale.
      if (n.op === '=' || n.op === '<>') {
        const equal = (lv === '' || rv === '')
          ? num(lv) === num(rv)
          : lv === rv;
        return (n.op === '=' ? equal : !equal) ? 1 : 0;
      }
      const l = num(lv); const r = num(rv);
      switch (n.op) {
        case '+': return l + r;
        case '-': return l - r;
        case '*': return l * r;
        case '/': return l / r;   // div-by-0 → Infinity → rendered '#DIV/0!'
        default:  throw new Error(`bad op ${n.op}`);
      }
    }
    case 'range':
      throw new Error('range outside SUM');
    case 'call': {
      const name = n.name.toUpperCase();
      if (name === 'SUM') {
        let total = 0;
        for (const a of n.args) {
          if (a.k === 'range') {
            for (const ref of expandRange(a.from, a.to)) total += resolve(ref);
          } else {
            total += num(evalNode(a, resolve));
          }
        }
        return total;
      }
      if (name === 'COUNT') {
        // Counts numbers, skipping blanks — how the Summary asks "how many
        // sales has the operator typed into the fillable rows?". An untouched
        // guarded row resolves to 0; a row with a sale price does not, and a
        // sale price of zero is not a sale.
        let count = 0;
        for (const a of n.args) {
          const refs = a.k === 'range' ? expandRange(a.from, a.to) : [];
          if (refs.length) {
            for (const ref of refs) if (resolve(ref) !== 0) count++;
          } else if (num(evalNode(a, resolve)) !== 0) count++;
        }
        return count;
      }
      if (name === 'IF') {
        if (n.args.length !== 3) throw new Error('IF arity');
        return num(evalNode(n.args[0], resolve)) !== 0
          ? evalNode(n.args[1], resolve)
          : evalNode(n.args[2], resolve);
      }
      if (name === 'IFERROR') {
        if (n.args.length !== 2) throw new Error('IFERROR arity');
        try {
          const v = evalNode(n.args[0], resolve);
          if (v === '') return v;
          return Number.isFinite(v) ? v : evalNode(n.args[1], resolve);
        } catch {
          return evalNode(n.args[1], resolve);
        }
      }
      throw new Error(`unsupported function ${name}`);
    }
  }
}

/** Split `'AMAZON'!S204` into its sheet prefix and the bare A1 reference. */
export function splitSheetRef(ref: string): { sheet?: string; cell: string } {
  const m = /^'([^']*)'!(.+)$/.exec(ref);
  return m ? { sheet: m[1], cell: m[2] } : { cell: ref };
}

function expandRange(from: string, to: string): string[] {
  // A cross-sheet range names its sheet once, on the left: 'AMAZON'!$G$3:$G$202.
  const a = splitSheetRef(from);
  const b = splitSheetRef(to);
  const prefix = a.sheet ? `'${a.sheet}'!` : '';
  const m1 = a.cell.match(/^([A-Z]+)(\d+)$/);
  const m2 = b.cell.match(/^([A-Z]+)(\d+)$/);
  if (!m1 || !m2) throw new Error('bad range refs');
  const c1 = colToNum(m1[1]); const r1 = parseInt(m1[2], 10);
  const c2 = colToNum(m2[1]); const r2 = parseInt(m2[2], 10);
  const refs: string[] = [];
  for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) {
    for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) {
      refs.push(`${prefix}${numToCol(c)}${r}`);
    }
  }
  return refs;
}

/** Evaluate one Excel formula string against a cell resolver. Throws on
 *  anything outside the supported subset — callers fall back to showing
 *  the raw `=formula` text.
 *
 *  Numeric view: a formula that evaluates to blank comes back as 0, which is
 *  what a blank cell is worth in arithmetic and in a SUM. Use
 *  `evaluateFormulaValue` where the difference between blank and zero matters,
 *  which is display. */
export function evaluateFormula(formula: string, resolve: RefResolver): number {
  return num(evaluateFormulaValue(formula, resolve));
}

/** As `evaluateFormula`, but tells blank apart from zero. */
export function evaluateFormulaValue(formula: string, resolve: RefResolver): CellValue {
  return evalNode(new Parser(tokenize(formula)).parse(), resolve);
}

// ---------------------------------------------------------------------------
// Workbook → view model
// ---------------------------------------------------------------------------

function fmtDate(d: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getDate()}-${months[d.getMonth()]}-${d.getFullYear()}`;
}

function fmtNumber(v: number, numFmt?: string): string {
  if (!Number.isFinite(v)) return '#DIV/0!';
  if (numFmt === '0') return String(Math.round(v));
  if (numFmt === '0.00') return v.toFixed(2);
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

function argbToCss(argb?: string): string | undefined {
  if (!argb || argb.length < 6) return undefined;
  return `#${argb.slice(-6)}`;
}

function cellFill(cell: ExcelJS.Cell, row: ExcelJS.Row): string | undefined {
  const f = (cell.fill ?? row.fill) as ExcelJS.FillPattern | undefined;
  if (f && f.type === 'pattern' && f.pattern === 'solid') {
    return argbToCss((f.fgColor as { argb?: string } | undefined)?.argb);
  }
  return undefined;
}

/** Build a lazy, memoised numeric resolver over one worksheet — formula cells
 *  recurse (GP% reads the GP cell, TOTAL reads SUM ranges) with cycle guard.
 *
 *  A reference may name another sheet ('AMAZON'!S204). The Summary tab does
 *  exactly that: its figures point at each marketplace tab's TOTAL row and at
 *  the blank rows the operator can fill, so it stays right as the file is
 *  worked on. Resolution therefore starts from the workbook, falling back to
 *  the sheet being rendered when no sheet is named. */
function makeResolver(ws: ExcelJS.Worksheet): RefResolver {
  const memo = new Map<string, number>();
  const visiting = new Set<string>();

  /**
   * Resolve `ref` where an unqualified reference means "on `home`".
   *
   * The home sheet matters when recursing. A Summary cell reads
   * 'AMAZON'!S204; that cell's own formula is SUM(S2:S203), and those bare
   * references belong to AMAZON, not to the Summary we happen to be
   * rendering. Following a cross-sheet reference therefore moves the home
   * sheet with it.
   */
  const resolveOn = (home: ExcelJS.Worksheet, ref: string): number => {
    const { sheet, cell } = splitSheetRef(ref);
    const target = sheet ? home.workbook?.getWorksheet(sheet) : home;
    if (!target) return 0;
    const key = `${target.name}!${cell}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    if (visiting.has(key)) return NaN;
    visiting.add(key);
    let out = 0;
    try {
      const v = target.getCell(cell).value as unknown;
      if (typeof v === 'number') out = v;
      else if (typeof v === 'string') {
        const n = Number(v);
        out = Number.isFinite(n) ? n : 0;
      } else if (v && typeof v === 'object' && typeof (v as { formula?: string }).formula === 'string') {
        const fv = v as { formula: string; result?: unknown };
        try {
          out = evaluateFormula(fv.formula, r => resolveOn(target, r));
        } catch {
          out = typeof fv.result === 'number' ? fv.result : NaN;
        }
      }
      // null / Date / rich text → 0 in arithmetic context (matches our usage).
    } finally {
      visiting.delete(key);
    }
    memo.set(key, out);
    return out;
  };

  return (ref) => resolveOn(ws, ref);
}

function convertSheet(ws: ExcelJS.Worksheet): ViewSheet {
  const columnCount = Math.max(1, ws.columnCount || ws.actualColumnCount || 1);
  const totalRows = ws.rowCount;
  const renderRows = Math.min(totalRows, MAX_VIEW_ROWS);
  const resolve = makeResolver(ws);

  const columnWidths: number[] = [];
  for (let c = 1; c <= columnCount; c++) {
    const w = ws.getColumn(c)?.width;
    columnWidths.push(Math.round((typeof w === 'number' && w > 0 ? w : 10) * 7));
  }

  const rows: ViewCell[][] = [];
  for (let r = 1; r <= renderRows; r++) {
    const row = ws.getRow(r);
    const cells: ViewCell[] = [];
    for (let c = 1; c <= columnCount; c++) {
      const cell = row.getCell(c);
      const v = cell.value as unknown;
      const bold = (cell.font?.bold ?? row.font?.bold) || undefined;
      const fillColor = cellFill(cell, row);

      let display = '';
      let align: 'left' | 'right' = 'left';
      let title: string | undefined;

      if (v === null || v === undefined) {
        // blank
      } else if (typeof v === 'number') {
        display = fmtNumber(v, cell.numFmt);
        align = 'right';
      } else if (v instanceof Date) {
        // Every date cell our writers emit uses the d-mmm-yyyy mask.
        display = fmtDate(v);
        align = 'right';
      } else if (typeof v === 'string') {
        display = v;
      } else if (typeof v === 'object' && typeof (v as { formula?: string }).formula === 'string') {
        const formula = (v as { formula: string }).formula;
        title = `=${formula}`;
        align = 'right';
        try {
          // A guarded formula on an untouched fillable row evaluates to blank.
          // Show it blank — printing 0.00 down two hundred empty rows would
          // read as two hundred zero-value sales.
          const out = evaluateFormulaValue(formula, resolve);
          display = out === '' ? '' : fmtNumber(out, cell.numFmt);
        } catch {
          display = `=${formula}`;
          align = 'left';
        }
      } else {
        display = String(v);
      }

      cells.push({ display, align, bold, fillColor, title });
    }
    rows.push(cells);
  }

  return {
    name: ws.name,
    rows,
    columnCount,
    columnWidths,
    truncatedFrom: totalRows > renderRows ? totalRows : 0,
  };
}

/** Parse a built .xlsx buffer (the SAME buffer the download saves) into the
 *  renderable model — sheet tabs, computed formula cells, fills, bolds. */
export async function viewModelFromXlsxBuffer(buffer: ArrayBuffer, title: string): Promise<ReportViewModel> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return { title, sheets: wb.worksheets.map(convertSheet) };
}

/** Adapter for the CSV-based Inventory Report — renders the same row objects
 *  the CSV download serialises, as a single-sheet grid with a styled header. */
/** Build one ViewSheet from plain row objects. */
function sheetFromRows(name: string, rows: Array<Record<string, unknown>>): ViewSheet {
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  const headerCells: ViewCell[] = headers.map(h => ({
    display: h, align: 'left', bold: true, fillColor: '#F1F5F9',
  }));
  const totalRows = rows.length;
  const capped = rows.slice(0, MAX_VIEW_ROWS);
  const bodyRows: ViewCell[][] = capped.map(r =>
    headers.map(h => {
      const v = r[h];
      if (typeof v === 'number') {
        return { display: fmtNumber(v), align: 'right' as const };
      }
      return { display: v == null ? '' : String(v), align: 'left' as const };
    }),
  );
  return {
    name,
    rows: headers.length ? [headerCells, ...bodyRows] : [],
    columnCount: headers.length || 1,
    columnWidths: headers.map(h => Math.max(80, Math.min(220, h.length * 9 + 40))),
    truncatedFrom: totalRows > MAX_VIEW_ROWS ? totalRows : 0,
  };
}

export function viewModelFromRows(
  title: string,
  sheetName: string,
  rows: Array<Record<string, unknown>>,
): ReportViewModel {
  return { title, sheets: [sheetFromRows(sheetName, rows)] };
}

/**
 * Multi-sheet preview, for reports whose download has more than one tab.
 *
 * The viewer footer promises "preview matches the .xlsx download", so a
 * report that downloads as two sheets has to preview as two sheets —
 * flattening Office and SHS into one combined list made the preview
 * disagree with the file the operator actually gets, and hid the split
 * that decides whether stock is on the shelf or still with the supplier.
 *
 * Sheet names should match the workbook's exactly.
 */
export function viewModelFromSheets(
  title: string,
  sheets: Array<{ name: string; rows: Array<Record<string, unknown>> }>,
): ReportViewModel {
  return { title, sheets: sheets.map(s => sheetFromRows(s.name, s.rows)) };
}
