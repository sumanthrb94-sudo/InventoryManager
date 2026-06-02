/**
 * stickerPdf — generate a print-ready PDF of peel-off labels for a stock
 * batch. Each sticker carries the unit's manual details (model · storage ·
 * colour · grade · supplier · date · BP, plus IMEI when present) so the
 * operator can peel and stick them directly onto handsets — especially
 * useful for SHS / no-IMEI placeholders coming off a delivery.
 *
 * Layout targets Avery L7160 / J8160 / 7160 sheets — the de-facto standard
 * for UK office label printing. 21 labels per A4 sheet (3 cols × 7 rows),
 * 63.5 mm × 38.1 mm each, 7.21 mm left margin, 15.1 mm top margin, 2.5 mm
 * horizontal gap, 0 mm vertical gap. Compatible with Avery L7160 / 7160 /
 * J8160 / L7159 / L7651 / 5160 (US-imperial equivalent).
 *
 * Why not page-1-cover branding like the inventory PDF: stickers don't have
 * room for marketing chrome. Every mm is data. The brand stamps on each
 * label and that's it.
 */
import jsPDF from 'jspdf';

// ── Typed sticker input ──────────────────────────────────────────────────────
// Subset of InventoryUnit — the writer accepts this minimal shape so callers
// can hand-build sticker data (e.g. from a bulk-order draft) without forcing
// a full InventoryUnit construction.
export interface StickerUnit {
  id?: string;
  imei?: string;
  model: string;
  storage?: string;
  colour?: string;
  grade?: string;
  buyPrice?: number;
  supplierName?: string;
  dateIn?: string;
  batchId?: string;
  notes?: string;
}

export interface BatchStickerOptions {
  /** Filename slug — defaults to `batch-stickers-${YYYY-MM-DD_HHMM}.pdf`. */
  filenameSuffix?: string;
  /** Header brand line on each sticker. Defaults to the firm's brand. */
  brand?: string;
  /** Skip units that already have an IMEI (so the operator only burns
   *  label paper on units that genuinely need a manual identifier).
   *  Defaults to false — print stickers for every unit in the batch. */
  skipImeiUnits?: boolean;
}

// ── Avery L7160 sheet geometry (A4, all units in mm) ─────────────────────────
const PAGE_W   = 210;
const PAGE_H   = 297;
const TOP_M    = 15.1;
const LEFT_M   = 7.21;
const LBL_W    = 63.5;
const LBL_H    = 38.1;
const COL_GAP  = 2.5;
const ROW_GAP  = 0;
const COLS     = 3;
const ROWS     = 7;
const PER_PAGE = COLS * ROWS;

// ── Drawing helpers ──────────────────────────────────────────────────────────
type RGB = [number, number, number];
const C = {
  ink:      [17,  24,  39]  as RGB,
  muted:    [107, 114, 128] as RGB,
  faint:    [156, 163, 175] as RGB,
  border:   [203, 213, 225] as RGB,
  accent:   [16,  185, 129] as RGB,
  bandBg:   [15,  23,  42]  as RGB,
  bandTxt:  [226, 232, 240] as RGB,
};

function fmtDate(iso: string | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
}

function fmtMoney(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `£${n.toFixed(2)}`;
}

/** Truncate `s` with no ellipsis (every char on a label counts) — falls back
 *  to a hard cut at `maxChars` if jsPDF's text width measurement isn't
 *  helpful (which it isn't without setFont applied first). */
function clampText(doc: jsPDF, s: string, maxWidthMm: number, sizePt: number): string {
  if (!s) return '';
  doc.setFontSize(sizePt);
  if (doc.getTextWidth(s) <= maxWidthMm) return s;
  let lo = 0, hi = s.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (doc.getTextWidth(s.slice(0, mid)) <= maxWidthMm) lo = mid;
    else hi = mid - 1;
  }
  return s.slice(0, Math.max(1, lo - 1)) + '…';
}

/** Paint a single sticker at (x,y) of size (LBL_W × LBL_H). */
function drawSticker(
  doc: jsPDF,
  unit: StickerUnit,
  brand: string,
  slotIdx: number,
  slotTotal: number,
  x: number,
  y: number,
) {
  const W = LBL_W, H = LBL_H;

  // ── Border — light grey, helps the operator see where to peel.
  doc.setDrawColor(C.border[0], C.border[1], C.border[2]);
  doc.setLineWidth(0.15);
  doc.roundedRect(x + 0.4, y + 0.4, W - 0.8, H - 0.8, 1.2, 1.2, 'S');

  // ── Header band (4mm tall): brand on the left, slot ref on the right.
  doc.setFillColor(C.bandBg[0], C.bandBg[1], C.bandBg[2]);
  doc.roundedRect(x + 0.4, y + 0.4, W - 0.8, 4, 1.2, 1.2, 'F');
  // Square the bottom of the band so it sits flush with the body — paint
  // a small rect over the rounded lower corners.
  doc.rect(x + 0.4, y + 3, W - 0.8, 1.4, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5.5);
  doc.setTextColor(C.bandTxt[0], C.bandTxt[1], C.bandTxt[2]);
  doc.text(brand, x + 2, y + 3.1);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5);
  doc.text(`#${slotIdx + 1}/${slotTotal}`, x + W - 2, y + 3.1, { align: 'right' });

  // ── Body — text rows top-to-bottom, padded 2.5mm left/right.
  const PADX = 2.5;
  const innerW = W - PADX * 2;
  let cy = y + 8.5; // first line baseline

  // Model (bold, biggest line on the sticker — the operator reads this
  // first when matching a sticker to a handset).
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(C.ink[0], C.ink[1], C.ink[2]);
  const modelTxt = clampText(doc, unit.model || '—', innerW, 10);
  doc.setFontSize(10);
  doc.text(modelTxt, x + PADX, cy);
  cy += 5.5;

  // Storage · Colour · Grade — secondary identifying line.
  const subParts = [unit.storage, unit.colour, unit.grade && `Grade ${unit.grade}`].filter(Boolean) as string[];
  if (subParts.length) {
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(C.muted[0], C.muted[1], C.muted[2]);
    const subTxt = clampText(doc, subParts.join(' · '), innerW, 8);
    doc.setFontSize(8);
    doc.text(subTxt, x + PADX, cy);
    cy += 4.5;
  } else {
    cy += 1.5;
  }

  // Supplier · Date · BP — the trading fingerprint of the unit.
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(C.ink[0], C.ink[1], C.ink[2]);
  const tradeParts = [
    unit.supplierName || '—',
    fmtDate(unit.dateIn),
    fmtMoney(unit.buyPrice),
  ];
  const tradeTxt = clampText(doc, tradeParts.join('  ·  '), innerW, 7.5);
  doc.setFontSize(7.5);
  doc.text(tradeTxt, x + PADX, cy);
  cy += 4.2;

  // IMEI (if present) in monospace so the digits are easy to eyeball-match
  // against the device's own IMEI sticker.
  if (unit.imei && unit.imei.trim()) {
    doc.setFont('courier', 'bold');
    doc.setTextColor(C.ink[0], C.ink[1], C.ink[2]);
    doc.setFontSize(7.5);
    const imeiTxt = clampText(doc, `IMEI: ${unit.imei.trim()}`, innerW, 7.5);
    doc.text(imeiTxt, x + PADX, cy);
    cy += 4;
  }

  // Batch reference at the foot — small, dim, ties the sticker back to
  // the import / bulk-order batch in the audit trail.
  if (unit.batchId) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5);
    doc.setTextColor(C.faint[0], C.faint[1], C.faint[2]);
    const batchShort = unit.batchId.length > 28 ? unit.batchId.slice(-12) : unit.batchId;
    doc.text(`batch ${batchShort}`, x + PADX, y + H - 2);
  }

  // Notes (operator-typed) on the right of the foot if any — clamped so it
  // never crosses the batch ref.
  if (unit.notes && unit.notes.trim()) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5);
    doc.setTextColor(C.faint[0], C.faint[1], C.faint[2]);
    const notesTxt = clampText(doc, unit.notes.trim(), innerW * 0.55, 5);
    doc.text(notesTxt, x + W - PADX, y + H - 2, { align: 'right' });
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Lay out and save a peel-off sticker sheet for the supplied units. */
export function generateBatchStickerSheet(
  rawUnits: StickerUnit[],
  opts: BatchStickerOptions = {},
): { savedAs: string; stickerCount: number } {
  const brand = opts.brand || 'MOBILEPHONEMARKET';
  const filtered = opts.skipImeiUnits
    ? rawUnits.filter(u => !u.imei || !u.imei.trim())
    : rawUnits;

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  // Empty input — still emit a single-page placeholder so the click was
  // visibly answered. CEO PDFs never silently no-op.
  if (filtered.length === 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(C.ink[0], C.ink[1], C.ink[2]);
    doc.text('No labels to print', PAGE_W / 2, PAGE_H / 2 - 4, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(C.muted[0], C.muted[1], C.muted[2]);
    const msg = opts.skipImeiUnits
      ? 'Every unit in this batch already has an IMEI — skipImeiUnits is on.'
      : 'The batch was empty.';
    doc.text(msg, PAGE_W / 2, PAGE_H / 2 + 4, { align: 'center' });
  } else {
    filtered.forEach((unit, i) => {
      if (i > 0 && i % PER_PAGE === 0) doc.addPage();
      const idx = i % PER_PAGE;
      const col = idx % COLS;
      const row = Math.floor(idx / COLS);
      const x = LEFT_M + col * (LBL_W + COL_GAP);
      const y = TOP_M  + row * (LBL_H + ROW_GAP);
      drawSticker(doc, unit, brand, i, filtered.length, x, y);
    });
  }

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = opts.filenameSuffix
    || `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  const filename = `batch-stickers-${stamp}.pdf`;
  doc.save(filename);
  return { savedAs: filename, stickerCount: filtered.length };
}
