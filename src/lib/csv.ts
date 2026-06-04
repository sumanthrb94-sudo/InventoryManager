/**
 * csv.ts — tiny, pure CSV serialiser shared by the report exporters.
 *
 * Header-safe: when `headers` are supplied, an empty `rows` array still
 * produces a one-line header file rather than a 0-byte / no-op download
 * (E2E finding #8 — clicking "Export CSV" with nothing to export previously
 * produced no file and no feedback).
 */
export type CsvRow = Record<string, string | number | boolean | null | undefined>;

/** Prepend to CSV text before building a Blob so Excel reads it as UTF-8 —
 *  without it, em-dashes / £ and other non-ASCII render as mojibake ("â"). */
export const CSV_BOM = '﻿';

function escapeCell(value: unknown): string {
  const s = value == null ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Force Excel to treat a value as TEXT. A 15-digit IMEI is otherwise parsed
 *  as a number and shown as "3.51E+14". The ="…" form is the convention Excel
 *  honours on CSV import; blanks stay blank. */
export function excelTextCell(value: unknown): string {
  const s = value == null ? '' : String(value);
  return s === '' ? '' : `="${s.replace(/"/g, '""')}"`;
}

/** Columns that hold IMEI / serial / long-id values Excel would mangle into
 *  scientific notation. */
export function isImeiHeader(header: string): boolean {
  return /imei|serial|unit\s*id/i.test(header);
}

/**
 * Serialise rows to CSV text.
 * @param rows    data rows (objects keyed by column name)
 * @param headers explicit column order; defaults to the keys of the first row.
 *                Pass this so exports with zero rows still emit the header row.
 *
 * IMEI / serial columns are emitted as Excel text so long numeric IMEIs don't
 * collapse to scientific notation.
 */
export function toCsv(rows: CsvRow[], headers?: string[]): string {
  const cols = headers && headers.length
    ? headers
    : (rows.length ? Object.keys(rows[0]) : []);
  if (cols.length === 0) return '';
  const lines = [cols.map(escapeCell).join(',')];
  for (const row of rows) {
    lines.push(cols.map(h => (isImeiHeader(h) ? excelTextCell(row[h]) : escapeCell(row[h]))).join(','));
  }
  return lines.join('\n');
}
