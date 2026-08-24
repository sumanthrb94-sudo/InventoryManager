/**
 * Shared sheet helpers for the E2E scripts.
 *
 * WHY THIS EXISTS
 *
 * Several scripts build a one-row sales file by dropping an array into a
 * template row:
 *
 *   ws.getRow(2).values = ['2026-07-22', 'ACC-9001', SKU, '', 'SUPPLIER', ...]
 *
 * That silently encodes the column order. When the marketplace tabs were
 * reordered in 2026-08 to put Model / Colour / Storage beside the IMEI, those
 * arrays kept writing the supplier into the Model column and the buy and sale
 * prices into Colour and Storage. The rows then arrived with no BP or SP, the
 * importer correctly rejected every one of them, and the scripts hung waiting
 * for a Confirm button on a preview that was never going to appear.
 *
 * The failure was in the SCRIPTS, not the product — the importer matches on
 * header name and handled the reorder fine. But it took a full 48-script sweep
 * to surface, because the affected scripts were not in the subset being run.
 *
 * Addressing cells by name removes the class of bug rather than this instance
 * of it, and `writeRowByHeader` throws on an unknown column, so the next
 * rename fails loudly at the point of the mistake instead of producing an
 * empty preview twenty seconds later.
 */

/**
 * Write `values` into `rowNumber`, addressing each cell by its column HEADER.
 *
 * @param {import('exceljs').Worksheet} ws
 * @param {number} rowNumber
 * @param {Record<string, unknown>} values  keyed by header text, e.g. { 'BP': 40 }
 * @throws if any key is not a column on the sheet
 */
export function writeRowByHeader(ws, rowNumber, values) {
  const headers = (ws.getRow(1).values ?? []).slice(1).map(v => String(v ?? '').trim());
  const row = ws.getRow(rowNumber);
  for (const [name, value] of Object.entries(values)) {
    const idx = headers.indexOf(name);
    if (idx < 0) throw new Error(`${ws.name}: no "${name}" column — headers: ${headers.join(', ')}`);
    row.getCell(idx + 1).value = value;
  }
  row.commit();
}

/**
 * Open one of the two importers from the header.
 *
 * Both used to live behind an "Import ▾" menu. When the importers were
 * deleted in 2026-08 the menu went with them, and each came back as its own
 * admin-gated icon button — Inventory on 2026-08-23, Sales on 2026-08-24. The
 * scripts written against the menu wait 30s for a `menuitem` that no longer
 * exists and fail on a timeout that says nothing about what changed.
 *
 * Addressing the button by its aria-label keeps the scripts off both the icon
 * and the menu structure, so the next rearrangement of the header does not
 * break them again.
 *
 * @param {import('playwright').Page} page
 * @param {'inventory'|'sales'} which
 */
export async function openImporter(page, which) {
  const label = which === 'sales' ? /Import Sales Report/i : /Import Inventory Report/i;
  await page.getByRole('button', { name: label }).first().click();
  await page.waitForTimeout(800);
}

/** Blank every data row, leaving the header and its formatting intact. */
export function clearDataRows(ws) {
  for (let r = 2; r <= ws.rowCount; r++) ws.getRow(r).values = [];
}
