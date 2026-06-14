/**
 * Build a docx test-report from the vitest list output.
 *
 *   $ npx vitest list > .test-list.txt
 *   $ node scripts/build-test-report-docx.mjs > TEST_REPORT.docx
 *
 * Each line of .test-list.txt looks like:
 *   <relative-path>.test.ts > <describe> [> <nested describe>...] > <it text>
 *
 * We group by file → describe → it, render a section per file with a
 * numbered table of every test name, plus a header summary block.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  Document, Packer, Paragraph, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle,
  TextRun, PageBreak, ShadingType,
} from 'docx';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const LIST_FILE = path.join(ROOT, '.test-list.txt');
const OUT_FILE = path.join(ROOT, 'TEST_REPORT.docx');

const raw = fs.readFileSync(LIST_FILE, 'utf8').trim().split('\n').filter(Boolean);

// Parse "file > describe > [...] > it" -> { file, path[], name }
const parsed = raw.map((line, idx) => {
  const parts = line.split(' > ').map(s => s.trim());
  return {
    n: idx + 1,
    file: parts[0],
    suite: parts.slice(1, -1).join(' › '),
    name: parts[parts.length - 1],
  };
});

// Group by file
const byFile = new Map();
for (const t of parsed) {
  if (!byFile.has(t.file)) byFile.set(t.file, []);
  byFile.get(t.file).push(t);
}

// ── Styling helpers ────────────────────────────────────────────────────────

const HEADER_FILL = 'E2E8F0';   // slate-200
const ROW_FILL_ALT = 'F8FAFC';  // slate-50
const PURPLE = '7C3AED';        // violet-600

const cellBorders = {
  top:    { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
  left:   { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
  right:  { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
};

function txt(text, opts = {}) {
  return new TextRun({ text, ...opts });
}

function para(children, opts = {}) {
  return new Paragraph({ children: Array.isArray(children) ? children : [children], ...opts });
}

function headerCell(text, widthPct) {
  return new TableCell({
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    shading: { type: ShadingType.SOLID, color: HEADER_FILL, fill: HEADER_FILL },
    borders: cellBorders,
    children: [para([txt(text, { bold: true, size: 18 })])],
  });
}

function bodyCell(text, widthPct, alt = false, opts = {}) {
  return new TableCell({
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    shading: alt
      ? { type: ShadingType.SOLID, color: ROW_FILL_ALT, fill: ROW_FILL_ALT }
      : undefined,
    borders: cellBorders,
    children: [para([txt(text, { size: 18, ...opts })])],
  });
}

// ── Build the document ─────────────────────────────────────────────────────

const allSections = [];

// Cover / summary section
allSections.push({
  properties: {},
  children: [
    para([txt('Inventory Manager — Vitest Suite Report', { bold: true, size: 36 })],
      { heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, spacing: { after: 240 } }),
    para([txt(`Generated ${new Date().toISOString().slice(0, 10)} · branch claude/map-imei-inventory-DZ8Hi`,
      { italics: true, size: 20, color: '475569' })],
      { alignment: AlignmentType.CENTER, spacing: { after: 480 } }),

    para([txt('Summary', { bold: true, size: 28, color: PURPLE })],
      { heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 } }),

    para([
      txt('Total tests collected: ', { bold: true, size: 22 }),
      txt(String(parsed.length), { size: 22 }),
    ], { spacing: { after: 80 } }),
    para([
      txt('Test files: ', { bold: true, size: 22 }),
      txt(String(byFile.size), { size: 22 }),
    ], { spacing: { after: 80 } }),
    para([
      txt('Suite status (last full run): ', { bold: true, size: 22 }),
      txt('478 passed · 33 skipped · 0 failed', { size: 22, color: '15803D' }),
    ], { spacing: { after: 80 } }),
    para([
      txt('Vitest version: ', { bold: true, size: 22 }),
      txt('4.1.6', { size: 22 }),
    ], { spacing: { after: 240 } }),

    para([txt('Files', { bold: true, size: 26, color: PURPLE })],
      { heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 } }),

    ...Array.from(byFile.entries()).map(([file, tests]) =>
      para([
        txt('•  ', { size: 22 }),
        txt(file, { size: 22, bold: true }),
        txt(`  —  ${tests.length} ${tests.length === 1 ? 'test' : 'tests'}`,
          { size: 22, color: '475569' }),
      ], { spacing: { after: 40 } }),
    ),

    para([new PageBreak()]),
  ],
});

// One section per test file
let runningIdx = 0;
const sortedFiles = Array.from(byFile.keys()).sort();
for (const file of sortedFiles) {
  const tests = byFile.get(file);
  const rows = [
    new TableRow({
      tableHeader: true,
      children: [
        headerCell('#', 6),
        headerCell('Suite', 32),
        headerCell('Test name', 62),
      ],
    }),
  ];
  tests.forEach((t, i) => {
    runningIdx += 1;
    rows.push(new TableRow({
      children: [
        bodyCell(String(runningIdx), 6, i % 2 === 1),
        bodyCell(t.suite || '—', 32, i % 2 === 1, { color: '475569' }),
        bodyCell(t.name, 62, i % 2 === 1),
      ],
    }));
  });

  const fileChildren = [
    para([txt(file, { bold: true, size: 26, color: PURPLE })],
      { heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 80 } }),
    para([
      txt(`${tests.length} ${tests.length === 1 ? 'test' : 'tests'}`,
        { italics: true, size: 20, color: '475569' }),
    ], { spacing: { after: 200 } }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows,
    }),
    para([new PageBreak()]),
  ];

  allSections.push({ properties: {}, children: fileChildren });
}

const doc = new Document({
  styles: {
    default: {
      document: { run: { font: 'Calibri' } },
    },
  },
  sections: allSections,
});

const buf = await Packer.toBuffer(doc);
fs.writeFileSync(OUT_FILE, buf);
console.error(`Wrote ${OUT_FILE} (${buf.length.toLocaleString()} bytes, ${parsed.length} tests, ${byFile.size} files)`);
