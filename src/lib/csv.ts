/**
 * csv.ts — tiny, pure CSV serialiser shared by the report exporters.
 *
 * Header-safe: when `headers` are supplied, an empty `rows` array still
 * produces a one-line header file rather than a 0-byte / no-op download
 * (E2E finding #8 — clicking "Export CSV" with nothing to export previously
 * produced no file and no feedback).
 */
export type CsvRow = Record<string, string | number | boolean | null | undefined>;

function escapeCell(value: unknown): string {
  const s = value == null ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Serialise rows to CSV text.
 * @param rows    data rows (objects keyed by column name)
 * @param headers explicit column order; defaults to the keys of the first row.
 *                Pass this so exports with zero rows still emit the header row.
 */
export function toCsv(rows: CsvRow[], headers?: string[]): string {
  const cols = headers && headers.length
    ? headers
    : (rows.length ? Object.keys(rows[0]) : []);
  if (cols.length === 0) return '';
  const lines = [cols.map(escapeCell).join(',')];
  for (const row of rows) {
    lines.push(cols.map(h => escapeCell(row[h])).join(','));
  }
  return lines.join('\n');
}
