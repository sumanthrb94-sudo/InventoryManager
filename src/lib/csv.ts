/**
 * CSV download, in one place.
 *
 * Extracted from ReturnsPage, which owned the only correct copy: it quotes a
 * field containing a comma, a quote or a newline, and doubles embedded quotes.
 * That matters here more than it looks — deletion reasons are free text typed
 * by an operator, and "QC FAIL, RETURNED TO SUPPLIER" is a real one. An
 * unquoted comma silently shifts every later column of that row, which is the
 * kind of corruption nobody notices until the spreadsheet is being relied on.
 *
 * Headers come from the first row's keys, so callers control column order by
 * the order they build their objects in.
 */

/** Rows share a shape; the first row's keys become the header. */
export function downloadCsv(filename: string, rows: Array<Record<string, any>>): void {
  if (rows.length === 0) {
    const blob = new Blob(['(no rows)\n'], { type: 'text/csv' });
    triggerDownload(filename, blob);
    return;
  }
  const headers = Object.keys(rows[0]);
  const esc = (v: any) => {
    const s = v == null ? '' : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.join(','), ...rows.map(r => headers.map(h => esc(r[h])).join(','))];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(filename, blob);
}

/**
 * Hand a blob to the browser as a download.
 *
 * The revoke is deferred rather than immediate: revoking in the same tick can
 * cancel the download before the browser has read the blob.
 */
export function triggerDownload(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
