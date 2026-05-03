// @ts-ignore — jspdf-autotable augments jsPDF at runtime
import jsPDF from 'jspdf';
// @ts-ignore
import autoTable from 'jspdf-autotable';
import { InventoryUnit, Supplier } from '../types';
import { calcNetProfit, platformTotalFee, DEFAULT_POSTAGE_COST, PLATFORM_LIST } from './platforms';

// ─────────────────────────────────────────────────────────────────────────────
// Palette
// ─────────────────────────────────────────────────────────────────────────────
type RGB = [number, number, number];

const C: Record<string, RGB> = {
  black:      [10,  10,  10],
  white:      [255, 255, 255],
  gray50:     [249, 250, 251],
  gray100:    [243, 244, 246],
  gray200:    [229, 231, 235],
  gray300:    [209, 213, 219],
  gray400:    [156, 163, 175],
  gray500:    [107, 114, 128],
  gray600:    [75,  85,  99],
  gray700:    [55,  65,  81],
  gray800:    [31,  41,  55],
  gray900:    [17,  24,  39],
  emerald:    [16,  185, 129],
  emeraldDk:  [4,   120, 87],
  emeraldLt:  [209, 250, 229],
  blue:       [59,  130, 246],
  amber:      [245, 158, 11],
  orange:     [249, 115, 22],
  red:        [239, 68,  68],
  redLt:      [254, 226, 226],
  purple:     [168, 85,  247],
  indigo:     [99,  102, 241],
};

const PLATFORM_RGB: Record<string, RGB> = {
  eBay:       [245, 158, 11],
  Amazon:     [249, 115, 22],
  OnBuy:      [59,  130, 246],
  Backmarket: [16,  185, 129],
};

// ─────────────────────────────────────────────────────────────────────────────
// Layout constants (A4 portrait, mm)
// ─────────────────────────────────────────────────────────────────────────────
const PW = 210;
const PH = 297;
const ML = 14;
const MR = 14;
const CW = PW - ML - MR;   // 182mm content width

// ─────────────────────────────────────────────────────────────────────────────
// Drawing helpers
// ─────────────────────────────────────────────────────────────────────────────
function setFill(doc: jsPDF, c: RGB)   { doc.setFillColor(c[0], c[1], c[2]); }
function setStroke(doc: jsPDF, c: RGB) { doc.setDrawColor(c[0], c[1], c[2]); }
function setTxt(doc: jsPDF, c: RGB)    { doc.setTextColor(c[0], c[1], c[2]); }
function setSize(doc: jsPDF, s: number){ doc.setFontSize(s); }

function fillRect(doc: jsPDF, x: number, y: number, w: number, h: number, c: RGB) {
  setFill(doc, c);
  doc.rect(x, y, w, h, 'F');
}

function roundFill(doc: jsPDF, x: number, y: number, w: number, h: number, r: number, c: RGB) {
  setFill(doc, c);
  doc.roundedRect(x, y, w, h, r, r, 'F');
}

function label(
  doc: jsPDF, text: string, x: number, y: number,
  size: number, color: RGB, bold = false, align: 'left' | 'center' | 'right' = 'left',
) {
  setSize(doc, size);
  setTxt(doc, color);
  doc.setFont('helvetica', bold ? 'bold' : 'normal');
  doc.text(text, x, y, { align });
}

// Section header with left accent bar
function sectionHeader(doc: jsPDF, title: string, subtitle: string, y: number): number {
  fillRect(doc, ML, y, 3, 11, C.black);
  label(doc, title,    ML + 6, y + 7.5, 13, C.black, true);
  label(doc, subtitle, ML + 6, y + 12,  6.5, C.gray400);
  return y + 19;
}

// Horizontal bar: [label][===bar===][value]
function hBar(
  doc: jsPDF,
  lbl: string, val: string, fillPct: number,
  x: number, y: number, w: number, h: number,
  barColor: RGB, labelW = 50,
) {
  const bx = x + labelW;
  const bw = w - labelW - 20;

  label(doc, lbl, bx - 2, y + h + 0.5, 7, C.gray700, false, 'right');

  // Track
  roundFill(doc, bx, y, bw, h, 1, C.gray100);
  // Fill
  const fw = Math.max(fillPct * bw, fillPct > 0 ? 2 : 0);
  if (fw > 0) roundFill(doc, bx, y, fw, h, 1, barColor);

  label(doc, val, bx + bw + 3, y + h + 0.5, 7, C.gray700, true);
}

// Vertical bar chart
function vBarChart(
  doc: jsPDF,
  data: { label: string; value: number }[],
  x: number, y: number, w: number, h: number,
  barColor: RGB,
) {
  const maxV = Math.max(...data.map(d => d.value), 1);
  const n    = data.length;
  const slotW = w / n;
  const barW  = Math.min(slotW * 0.65, 9);

  // Grid lines
  setStroke(doc, C.gray100);
  doc.setLineWidth(0.2);
  for (let i = 0; i <= 4; i++) {
    const gy = y + h - (i / 4) * h;
    doc.line(x, gy, x + w, gy);
    label(doc, String(Math.round((i / 4) * maxV)), x - 1, gy + 1.5, 5, C.gray300, false, 'right');
  }

  data.forEach((d, i) => {
    const bx  = x + i * slotW + (slotW - barW) / 2;
    const bh  = (d.value / maxV) * h;
    const by  = y + h - bh;

    if (bh > 0.5) {
      setFill(doc, barColor);
      doc.roundedRect(bx, by, barW, bh, 1, 1, 'F');
    }
    if (d.value > 0)
      label(doc, String(d.value), bx + barW / 2, by - 1, 5, C.gray600, true, 'center');

    if (n <= 16 || i % 2 === 0)
      label(doc, d.label, bx + barW / 2, y + h + 4.5, 5, C.gray400, false, 'center');
  });
}

// KPI box for cover page
function kpiBox(
  doc: jsPDF,
  x: number, y: number, w: number, h: number,
  lbl: string, value: string, sub: string, accent: RGB,
) {
  setFill(doc, C.gray800);
  doc.roundedRect(x, y, w, h, 3, 3, 'F');
  fillRect(doc, x, y, w, 2, accent);
  // Curved cap over accent stripe
  setFill(doc, C.gray800);
  doc.rect(x, y + 1.5, w, 1.5, 'F');

  label(doc, lbl.toUpperCase(), x + 5, y + 10, 6.5, C.gray400);
  label(doc, value,             x + 5, y + 23,  20,  C.white, true);
  label(doc, sub,               x + 5, y + 30,  6.5, C.gray500);
}

// Page footer (applied in final pass)
function pageFooter(doc: jsPDF, pageNum: number, total: number) {
  const fy = PH - 8;
  fillRect(doc, 0, fy - 1, PW, 10, C.gray900);
  label(doc, 'MOBILEPHONEMARKET · INVENTORY INSIGHTS REPORT · CONFIDENTIAL', ML, fy + 4.5, 6, C.gray500);
  label(doc, `Page ${pageNum} of ${total}`, PW - MR, fy + 4.5, 6, C.gray400, false, 'right');
}

// ─────────────────────────────────────────────────────────────────────────────
// Main report generator
// ─────────────────────────────────────────────────────────────────────────────
export function generateInventoryReport(units: InventoryUnit[], suppliers: Supplier[]) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const today    = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const dateLabel = today.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  const supplierMap: Record<string, string> = {};
  for (const s of suppliers) supplierMap[s.id] = s.name;

  const available = units.filter(u => u.status === 'available');
  const sold      = units.filter(u => u.status === 'sold');
  const returned  = units.filter(u => u.status === 'returned');

  const totalRevenue  = sold.reduce((s, u) => s + (u.salePrice || 0), 0);
  const totalBuyValue = available.reduce((s, u) => s + u.buyPrice, 0);
  const totalNetProfit = sold.reduce((s, u) =>
    s + calcNetProfit(u.salePrice || 0, u.buyPrice, u.salePlatform || '', u.postageCost ?? DEFAULT_POSTAGE_COST), 0);

  // ══════════════════════════════════════════════════════════════════════════
  // PAGE 1 — COVER
  // ══════════════════════════════════════════════════════════════════════════
  fillRect(doc, 0, 0, PW, PH, C.gray900);
  fillRect(doc, 0, 0, PW, 3,  C.emerald);   // emerald top stripe

  label(doc, 'MOBILEPHONEMARKET', ML, 28, 22, C.white, true);
  label(doc, 'INVENTORY INSIGHTS REPORT', ML, 37, 10, C.gray400);

  // Divider
  setStroke(doc, C.gray700);
  doc.setLineWidth(0.3);
  doc.line(ML, 43, PW - MR, 43);

  label(doc, `Generated ${dateLabel}`, ML, 51,  8, C.gray500);
  label(doc, `${units.length.toLocaleString()} total records across all statuses`, ML, 57, 7, C.gray600);

  // 4 KPI boxes (2×2)
  const KW = 84, KH = 36, KGX = 10, KGY = 9, KY0 = 68;
  [
    { lbl: 'Units in Stock',   val: available.length.toLocaleString(),          sub: 'Currently available',          accent: C.emerald },
    { lbl: 'Stock Value',      val: `£${totalBuyValue.toLocaleString()}`,        sub: 'At cost price',                accent: C.blue    },
    { lbl: 'Total Sold',       val: sold.length.toLocaleString(),                sub: `${returned.length} returned`,  accent: C.amber   },
    { lbl: 'Total Revenue',    val: `£${totalRevenue.toLocaleString()}`,         sub: 'Gross sales',                  accent: C.purple  },
  ].forEach((k, i) => {
    kpiBox(doc, ML + (i % 2) * (KW + KGX), KY0 + Math.floor(i / 2) * (KH + KGY), KW, KH, k.lbl, k.val, k.sub, k.accent);
  });

  // Contents legend
  const legY = 166;
  setStroke(doc, C.gray700);
  doc.setLineWidth(0.3);
  doc.line(ML, legY, PW - MR, legY);

  label(doc, 'REPORT CONTENTS', ML, legY + 7, 7, C.gray500, true);

  [
    'Sales Performance   ·   Daily trend · Platform breakdown · Top-selling models',
    'Inventory Health    ·   Category breakdown · Aged stock · Velocity analysis',
    'Reorder Intelligence ·  Low-stock alerts · Supplier sell-through performance',
    'Full Stock Report   ·   All available units with IMEI, grade, storage, days held',
    'Sales Log           ·   Complete transaction history with gross margin per sale',
  ].forEach((s, i) => {
    setFill(doc, C.emerald);
    doc.circle(ML + 1.5, legY + 15 + i * 7.5 - 1, 1, 'F');
    label(doc, s, ML + 5, legY + 15 + i * 7.5, 7.5, C.gray300);
  });

  // Cover footer
  fillRect(doc, 0, PH - 13, PW, 13, C.black);
  label(doc, 'CONFIDENTIAL · INTERNAL USE ONLY · MOBILEPHONEMARKET INVENTORY MANAGER', PW / 2, PH - 5, 6.5, C.gray600, false, 'center');

  // ══════════════════════════════════════════════════════════════════════════
  // PAGE 2 — SALES PERFORMANCE
  // ══════════════════════════════════════════════════════════════════════════
  doc.addPage();
  fillRect(doc, 0, 0, PW, PH, C.white);

  let y = sectionHeader(doc, 'SALES PERFORMANCE', `Daily trend · Platform breakdown · Top sellers · ${dateLabel}`, 14);

  // ── Daily trend (last 14 days) ──
  label(doc, 'UNITS SOLD · LAST 14 DAYS', ML, y, 7.5, C.gray700, true);
  y += 6;

  const trend14 = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - 13 + i);
    const ds = d.toISOString().split('T')[0];
    return {
      label: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
      value: sold.filter(u => (u.saleDate || u.dateIn) === ds).length,
    };
  });

  const totalLast14 = trend14.reduce((s, d) => s + d.value, 0);
  label(doc, `${totalLast14} units sold in 14 days`, PW - MR, y - 6, 7, C.emeraldDk, true, 'right');

  vBarChart(doc, trend14, ML + 6, y, CW - 6, 44, C.black);
  y += 58;

  // Divider
  setStroke(doc, C.gray100);
  doc.setLineWidth(0.3);
  doc.line(ML, y, PW - MR, y);
  y += 7;

  // ── Platform breakdown ──
  label(doc, 'PLATFORM BREAKDOWN', ML, y, 7.5, C.gray700, true);
  y += 7;

  const maxPlatCount = Math.max(...PLATFORM_LIST.map(p => sold.filter(u => u.salePlatform === p).length), 1);
  const maxPlatRev   = Math.max(...PLATFORM_LIST.map(p => sold.filter(u => u.salePlatform === p).reduce((s, u) => s + (u.salePrice || 0), 0)), 1);

  // Column headers
  label(doc, 'Units Sold →',   ML + 54, y - 1, 6, C.gray400);
  label(doc, 'Revenue →',      ML + CW / 2 + 54, y - 1, 6, C.gray400);
  y += 2;

  PLATFORM_LIST.forEach(p => {
    const pSold = sold.filter(u => u.salePlatform === p);
    const pRev  = pSold.reduce((s, u) => s + (u.salePrice || 0), 0);
    const color = PLATFORM_RGB[p] ?? C.gray500;

    hBar(doc, p, `${pSold.length}`, pSold.length / maxPlatCount, ML, y, CW / 2 - 2, 5, color, 25);
    hBar(doc, '',  `£${pRev.toLocaleString()}`, pRev / maxPlatRev, ML + CW / 2 + 2, y, CW / 2 - 2, 5, color, 1);
    y += 10;
  });

  y += 2;
  setStroke(doc, C.gray100);
  doc.setLineWidth(0.3);
  doc.line(ML, y, PW - MR, y);
  y += 7;

  // ── Top 10 sold models ──
  label(doc, 'TOP 10 BEST-SELLING MODELS', ML, y, 7.5, C.gray700, true);
  y += 4;

  const modelSales: Record<string, { count: number; revenue: number }> = {};
  for (const u of sold) {
    if (!modelSales[u.model]) modelSales[u.model] = { count: 0, revenue: 0 };
    modelSales[u.model].count++;
    modelSales[u.model].revenue += u.salePrice || 0;
  }
  const top10 = Object.entries(modelSales)
    .map(([model, d]) => ({ model, ...d }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  autoTable(doc, {
    startY: y,
    margin: { left: ML, right: MR },
    head: [['#', 'Model', 'Units Sold', 'Revenue']],
    body: top10.map((m, i) => [
      String(i + 1).padStart(2, '0'),
      m.model,
      m.count,
      `£${m.revenue.toLocaleString()}`,
    ]),
    styles:            { fontSize: 7.5, cellPadding: 2.5 },
    headStyles:        { fillColor: C.black as any, textColor: C.white as any, fontStyle: 'bold', fontSize: 7 },
    alternateRowStyles:{ fillColor: C.gray50 as any },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' },
      2: { cellWidth: 24, halign: 'center' },
      3: { cellWidth: 28, halign: 'right'  },
    },
  });

  // ══════════════════════════════════════════════════════════════════════════
  // PAGE 3 — INVENTORY HEALTH
  // ══════════════════════════════════════════════════════════════════════════
  doc.addPage();
  fillRect(doc, 0, 0, PW, PH, C.white);
  y = sectionHeader(doc, 'INVENTORY HEALTH', 'Category breakdown · Aged stock · Velocity analysis', 14);

  // ── Category breakdown ──
  label(doc, 'STOCK BY CATEGORY', ML, y, 7.5, C.gray700, true);
  y += 7;

  const catMap: Record<string, number> = {};
  for (const u of available) catMap[u.category] = (catMap[u.category] || 0) + 1;
  const catData = Object.entries(catMap).sort((a, b) => b[1] - a[1]);
  const maxCat  = Math.max(...catData.map(([, c]) => c), 1);

  catData.forEach(([cat, count]) => {
    hBar(doc, cat, `${count} units`, count / maxCat, ML, y, CW, 5, C.black, 55);
    y += 10;
  });

  y += 4;
  setStroke(doc, C.gray100);
  doc.setLineWidth(0.3);
  doc.line(ML, y, PW - MR, y);
  y += 7;

  // ── Aged stock ──
  label(doc, 'AGED STOCK DISTRIBUTION', ML, y, 7.5, C.gray700, true);
  y += 7;

  const aged = [
    { lbl: '0 – 30 days',  min: 0,  max: 30,      color: C.emerald },
    { lbl: '31 – 60 days', min: 31, max: 60,       color: C.amber   },
    { lbl: '61 – 90 days', min: 61, max: 90,       color: C.orange  },
    { lbl: '90 + days',    min: 91, max: Infinity,  color: C.red     },
  ].map(b => {
    const bucket = available.filter(u => {
      if (!u.dateIn) return false;
      const age = Math.floor((Date.now() - new Date(u.dateIn).getTime()) / 86400000);
      return age >= b.min && age <= b.max;
    });
    return { ...b, count: bucket.length, value: bucket.reduce((s, u) => s + u.buyPrice, 0) };
  });

  const maxAged = Math.max(...aged.map(d => d.count), 1);
  aged.forEach(d => {
    hBar(doc, d.lbl, `${d.count} units · £${d.value.toLocaleString()}`, d.count / maxAged, ML, y, CW, 5, d.color, 30);
    y += 10;
  });

  if (aged[3].count > 0) {
    roundFill(doc, ML, y, CW, 10, 2, C.redLt);
    label(doc, `⚠  ${aged[3].count} units unsold for 90+ days — consider repricing or listing on a new platform`, ML + 4, y + 7, 7, C.red, true);
    y += 14;
  }

  y += 4;
  setStroke(doc, C.gray100);
  doc.setLineWidth(0.3);
  doc.line(ML, y, PW - MR, y);
  y += 7;

  // ── Velocity (fast / slow movers) ──
  label(doc, 'VELOCITY ANALYSIS · AVG DAYS FROM STOCK-IN TO SALE', ML, y, 7.5, C.gray700, true);
  y += 7;

  const velMap: Record<string, { sold: number; days: number; inStock: number }> = {};
  for (const u of sold) {
    if (!velMap[u.model]) velMap[u.model] = { sold: 0, days: 0, inStock: 0 };
    velMap[u.model].sold++;
    if (u.saleDate && u.dateIn)
      velMap[u.model].days += Math.max(0,
        (new Date(u.saleDate).getTime() - new Date(u.dateIn).getTime()) / 86400000);
  }
  for (const u of available) {
    if (!velMap[u.model]) velMap[u.model] = { sold: 0, days: 0, inStock: 0 };
    velMap[u.model].inStock++;
  }

  const velocity = Object.entries(velMap)
    .filter(([, m]) => m.sold >= 2)
    .map(([model, m]) => ({
      model,
      sold:        m.sold,
      inStock:     m.inStock,
      avgDays:     Math.round(m.days / m.sold),
      sellThrough: Math.round(m.sold / (m.sold + m.inStock) * 100),
    }))
    .sort((a, b) => a.avgDays - b.avgDays);

  const fast = velocity.filter(m => m.avgDays <= 14).slice(0, 8);
  const slow = [...velocity].reverse().filter(m => m.avgDays > 30).slice(0, 8);
  const colW = (CW - 8) / 2;

  // Column headers
  roundFill(doc, ML, y, colW, 7, 2, C.emeraldLt);
  label(doc, `FAST MOVERS  ≤14d avg  (${fast.length})`, ML + 3, y + 5.5, 6.5, C.emeraldDk, true);

  roundFill(doc, ML + colW + 8, y, colW, 7, 2, C.redLt);
  label(doc, `SLOW MOVERS  >30d avg  (${slow.length})`, ML + colW + 11, y + 5.5, 6.5, C.red, true);
  y += 10;

  const rows = Math.max(fast.length, slow.length);
  for (let i = 0; i < rows; i++) {
    const ry = y + i * 8;
    if (i % 2 === 0) {
      fillRect(doc, ML,          ry, colW,    7, C.gray50);
      fillRect(doc, ML + colW + 8, ry, colW, 7, C.gray50);
    }
    if (fast[i]) {
      const m = fast[i];
      label(doc, m.model.length > 30 ? m.model.slice(0, 28) + '…' : m.model, ML + 2, ry + 5.5, 6.5, C.gray700);
      label(doc, `${m.avgDays}d`, ML + colW - 2, ry + 5.5, 6.5, C.emeraldDk, true, 'right');
    }
    if (slow[i]) {
      const m = slow[i];
      label(doc, m.model.length > 30 ? m.model.slice(0, 28) + '…' : m.model, ML + colW + 10, ry + 5.5, 6.5, C.gray700);
      label(doc, `${m.avgDays}d`, ML + CW - 2, ry + 5.5, 6.5, C.red, true, 'right');
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PAGE 4 — REORDER INTELLIGENCE
  // ══════════════════════════════════════════════════════════════════════════
  doc.addPage();
  fillRect(doc, 0, 0, PW, PH, C.white);
  y = sectionHeader(doc, 'REORDER INTELLIGENCE', 'Low-stock alerts · Supplier performance', 14);

  // ── Reorder alerts ──
  label(doc, 'REORDER ALERTS — HIGH SELL-THROUGH, LOW STOCK', ML, y, 7.5, C.gray700, true);
  y += 5;

  const stockMap: Record<string, { sold: number; inStock: number }> = {};
  for (const u of sold)      { if (!stockMap[u.model]) stockMap[u.model] = { sold: 0, inStock: 0 }; stockMap[u.model].sold++; }
  for (const u of available) { if (!stockMap[u.model]) stockMap[u.model] = { sold: 0, inStock: 0 }; stockMap[u.model].inStock++; }
  const velDays: Record<string, number> = {};
  for (const m of velocity) velDays[m.model] = m.avgDays;

  const alerts = Object.entries(stockMap)
    .map(([model, m]) => ({
      model, ...m,
      sellThrough: Math.round(m.sold / (m.sold + m.inStock) * 100),
      avgDays: velDays[model] ?? null,
    }))
    .filter(m => m.sellThrough >= 65 && m.inStock <= 3 && m.sold >= 2)
    .sort((a, b) => a.inStock - b.inStock || b.sellThrough - a.sellThrough);

  if (alerts.length === 0) {
    roundFill(doc, ML, y, CW, 10, 2, C.gray50);
    label(doc, 'No reorder alerts — all high-velocity models are adequately stocked.', ML + 4, y + 7, 7.5, C.gray400);
    y += 18;
  } else {
    autoTable(doc, {
      startY: y,
      margin: { left: ML, right: MR },
      head: [['Model', 'In Stock', 'Sold', 'Sell-Thru', 'Avg Days', 'Status']],
      body: alerts.map(m => [
        m.model,
        m.inStock,
        m.sold,
        `${m.sellThrough}%`,
        m.avgDays !== null ? `${m.avgDays}d` : '—',
        m.inStock === 0 ? 'OUT OF STOCK' : m.inStock === 1 ? 'CRITICAL' : 'LOW',
      ]),
      styles:            { fontSize: 7.5, cellPadding: 2.5 },
      headStyles:        { fillColor: [220, 38, 38] as any, textColor: C.white as any, fontStyle: 'bold', fontSize: 7 },
      alternateRowStyles:{ fillColor: C.gray50 as any },
      columnStyles: {
        1: { cellWidth: 18, halign: 'center' },
        2: { cellWidth: 14, halign: 'center' },
        3: { cellWidth: 22, halign: 'center' },
        4: { cellWidth: 24, halign: 'center' },
        5: { cellWidth: 24, halign: 'center' },
      },
      didParseCell: (data: any) => {
        if (data.column.index === 5 && data.section === 'body') {
          const v = data.cell.text[0];
          data.cell.styles.textColor = v === 'OUT OF STOCK' ? [220, 38, 38] : v === 'CRITICAL' ? [249, 115, 22] : [217, 119, 6];
          data.cell.styles.fontStyle = 'bold';
        }
      },
    });
    y = (doc as any).lastAutoTable.finalY + 10;
  }

  // Divider
  setStroke(doc, C.gray100);
  doc.setLineWidth(0.3);
  doc.line(ML, y, PW - MR, y);
  y += 7;

  // ── Supplier performance ──
  label(doc, 'SUPPLIER PERFORMANCE', ML, y, 7.5, C.gray700, true);
  y += 5;

  const suppMap: Record<string, { name: string; bought: number; soldCount: number; totalDays: number; withDate: number }> = {};
  for (const u of units) {
    const name = supplierMap[u.supplierId] || 'Unknown';
    if (!suppMap[u.supplierId]) suppMap[u.supplierId] = { name, bought: 0, soldCount: 0, totalDays: 0, withDate: 0 };
    suppMap[u.supplierId].bought++;
    if (u.status === 'sold') {
      suppMap[u.supplierId].soldCount++;
      if (u.saleDate && u.dateIn) {
        suppMap[u.supplierId].totalDays += Math.max(0,
          (new Date(u.saleDate).getTime() - new Date(u.dateIn).getTime()) / 86400000);
        suppMap[u.supplierId].withDate++;
      }
    }
  }
  const suppPerf = Object.values(suppMap)
    .filter(s => s.bought > 0)
    .map(s => ({
      ...s,
      inStock:       s.bought - s.soldCount,
      sellThrough:   Math.round(s.soldCount / s.bought * 100),
      avgDaysToSell: s.withDate ? Math.round(s.totalDays / s.withDate) : null,
    }))
    .sort((a, b) => b.sellThrough - a.sellThrough);

  autoTable(doc, {
    startY: y,
    margin: { left: ML, right: MR },
    head: [['Supplier', 'Bought', 'Sold', 'In Stock', 'Sell-Through', 'Avg Days to Sell']],
    body: suppPerf.map(s => [
      s.name, s.bought, s.soldCount, s.inStock,
      `${s.sellThrough}%`,
      s.avgDaysToSell !== null ? `${s.avgDaysToSell}d` : '—',
    ]),
    styles:            { fontSize: 7.5, cellPadding: 2.5 },
    headStyles:        { fillColor: C.gray900 as any, textColor: C.white as any, fontStyle: 'bold', fontSize: 7 },
    alternateRowStyles:{ fillColor: C.gray50 as any },
    columnStyles: {
      1: { cellWidth: 20, halign: 'center' },
      2: { cellWidth: 18, halign: 'center' },
      3: { cellWidth: 18, halign: 'center' },
      4: { cellWidth: 26, halign: 'center' },
      5: { cellWidth: 28, halign: 'center' },
    },
    didParseCell: (data: any) => {
      if (data.column.index === 4 && data.section === 'body') {
        const pct = parseInt(data.cell.text[0]);
        data.cell.styles.textColor = pct >= 70 ? [4, 120, 87] : pct >= 40 ? [146, 64, 14] : [185, 28, 28];
        data.cell.styles.fontStyle = 'bold';
      }
    },
  });

  // ══════════════════════════════════════════════════════════════════════════
  // PAGE 5 — FULL STOCK REPORT (auto-paginating)
  // ══════════════════════════════════════════════════════════════════════════
  doc.addPage();
  fillRect(doc, 0, 0, PW, PH, C.white);
  y = sectionHeader(doc, 'FULL STOCK REPORT', `All ${available.length} available units · as of ${dateLabel}`, 14);

  autoTable(doc, {
    startY: y,
    margin: { left: ML, right: MR },
    head: [['Model', 'IMEI / Serial', 'Colour', 'Gr.', 'Storage', 'Buy £', 'Supplier', 'Date In', 'Days']],
    body: available.map(u => {
      const age = u.dateIn ? Math.floor((Date.now() - new Date(u.dateIn).getTime()) / 86400000) : '—';
      return [
        u.model,
        u.imei,
        u.colour || '—',
        u.conditionGrade ?? '—',
        u.storage || '—',
        `£${u.buyPrice}`,
        supplierMap[u.supplierId] || '—',
        u.dateIn || '—',
        age,
      ];
    }),
    styles:            { fontSize: 6.5, cellPadding: 2 },
    headStyles:        { fillColor: C.black as any, textColor: C.white as any, fontStyle: 'bold', fontSize: 6.5 },
    alternateRowStyles:{ fillColor: C.gray50 as any },
    columnStyles: {
      0: { cellWidth: 42 },
      1: { cellWidth: 30 },
      2: { cellWidth: 20 },
      3: { cellWidth: 10, halign: 'center' },
      4: { cellWidth: 14, halign: 'center' },
      5: { cellWidth: 15, halign: 'right'  },
      6: { cellWidth: 22 },
      7: { cellWidth: 17, halign: 'center' },
      8: { cellWidth: 12, halign: 'center' },
    },
    didParseCell: (data: any) => {
      if (data.column.index === 8 && data.section === 'body') {
        const d = parseInt(data.cell.text[0]);
        if      (d > 90) data.cell.styles.textColor = [220, 38, 38];
        else if (d > 60) data.cell.styles.textColor = [249, 115, 22];
        else if (d > 30) data.cell.styles.textColor = [217, 119, 6];
        if (d > 30)      data.cell.styles.fontStyle = 'bold';
      }
    },
    didDrawPage: () => {
      const p = doc.getNumberOfPages();
      if (p > 1) fillRect(doc, 0, 0, PW, PH, C.white);
    },
  });

  // ══════════════════════════════════════════════════════════════════════════
  // PAGE 6 — SALES LOG (auto-paginating)
  // ══════════════════════════════════════════════════════════════════════════
  doc.addPage();
  fillRect(doc, 0, 0, PW, PH, C.white);
  y = sectionHeader(doc, 'SALES LOG', `${sold.length} transactions · Complete history`, 14);

  const sortedSold = [...sold].sort(
    (a, b) => new Date(b.saleDate || b.dateIn).getTime() - new Date(a.saleDate || a.dateIn).getTime(),
  );

  autoTable(doc, {
    startY: y,
    margin: { left: ML, right: MR },
    head: [['Date', 'Model', 'IMEI', 'Order #', 'Buy £', 'Sale £', 'Platform', 'Gross £']],
    body: sortedSold.map(u => {
      const sp    = u.salePrice || 0;
      const gross = sp - u.buyPrice;
      return [
        u.saleDate || u.dateIn,
        u.model,
        u.imei,
        u.saleOrderId || '—',
        `£${u.buyPrice}`,
        `£${sp}`,
        u.salePlatform || '—',
        `${gross >= 0 ? '+' : ''}£${gross}`,
      ];
    }),
    styles:            { fontSize: 6.5, cellPadding: 2 },
    headStyles:        { fillColor: C.gray800 as any, textColor: C.white as any, fontStyle: 'bold', fontSize: 6.5 },
    alternateRowStyles:{ fillColor: C.gray50 as any },
    columnStyles: {
      0: { cellWidth: 20, halign: 'center' },
      1: { cellWidth: 44 },
      2: { cellWidth: 28 },
      3: { cellWidth: 22 },
      4: { cellWidth: 14, halign: 'right' },
      5: { cellWidth: 14, halign: 'right' },
      6: { cellWidth: 22, halign: 'center' },
      7: { cellWidth: 18, halign: 'right' },
    },
    didParseCell: (data: any) => {
      if (data.column.index === 7 && data.section === 'body') {
        const v: string = data.cell.text[0] ?? '';
        data.cell.styles.textColor = v.startsWith('+') ? [4, 120, 87] : [185, 28, 28];
        data.cell.styles.fontStyle = 'bold';
      }
    },
    didDrawPage: () => {
      const p = doc.getNumberOfPages();
      if (p > 1) fillRect(doc, 0, 0, PW, PH, C.white);
    },
  });

  // ══════════════════════════════════════════════════════════════════════════
  // FINAL PASS — stamp footers on every page except cover
  // ══════════════════════════════════════════════════════════════════════════
  const total = doc.getNumberOfPages();
  for (let i = 2; i <= total; i++) {
    doc.setPage(i);
    pageFooter(doc, i - 1, total - 1);  // page 2 = content page 1
  }

  doc.save(`MOBILEPHONEMARKET-Inventory-Report-${todayStr}.pdf`);
}
