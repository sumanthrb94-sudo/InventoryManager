/**
 * e2eSeedSales — put sales into the E2E store by driving Mark Multiple Sold.
 *
 * WHY THIS EXISTS
 *
 * Twenty-two E2E scripts used to seed sales by uploading a Sales Report
 * through the importer, then went on to test something entirely unrelated —
 * the VAT centre, stock alerts, supplier rollups, best-sellers. Import was
 * never the subject of those tests; it was just the fastest way to get rows
 * into the database.
 *
 * The importers were deleted (2026-08), so that seeding route is gone and
 * those scripts die at their setup step on a button that no longer exists.
 * The tests themselves are still valid.
 *
 * This drives the real Mark Multiple Sold modal instead, which is the route an
 * operator actually uses. That makes the seeding STRICTER than the import it
 * replaces: recordBulkSales reconciles against live stock, so a script can
 * only sell something its fixture really put on the shelf. An import could
 * conjure a sale for a unit that never existed — which is how a suite could
 * pass while masking a stock bug. Expect some converted scripts to surface
 * real failures that were previously hidden; that is the point, not a
 * regression in this helper.
 *
 * ADDRESSING
 *
 * Everything is located per-ROW, then by aria-label inside that row
 * ("Model", "IMEI", "Order number", "Sale price", "Quantity").
 *
 * Row-scoping is not a style preference, it is required for correctness.
 * Quantity is rendered ONLY for accessory lines (a handset shows a static
 * "1"), so a page-wide `getByLabel('Quantity').nth(rowIndex)` silently
 * addresses the wrong row the moment a batch mixes handsets and accessories.
 * Scoping to the row makes the lookup say what it means.
 *
 * TRUTH SOURCE FOR THE COUNT
 *
 * The modal renders "N of M rows ready" and "Confirm N Sales". N is the
 * component's own judgement of how many rows are complete, so N is what gets
 * reported — not this script's opinion of how many fields it filled. A row can
 * be typed into and still not be ready (no stock match, missing price), and
 * counting optimistically here is how a short seed turns into a confusing
 * assertion failure three steps downstream.
 */

/** The modal's inner panel — the element that actually contains the rows. */
function modalOf(page) {
  return page.locator('div.bg-white.rounded-2xl')
             .filter({ hasText: 'Mark Multiple Sold' })
             .first();
}

/** Open Sell → Mark Multiple Sold. Returns the modal locator. */
async function openBulkSale(page, gotoTab) {
  if (gotoTab) await gotoTab('sell');
  const trigger = page.getByRole('button', { name: /Mark Multiple Sold/i });
  await trigger.waitFor({ state: 'visible', timeout: 30_000 });
  await trigger.click();
  const modal = modalOf(page);
  await modal.waitFor({ state: 'visible', timeout: 15_000 });
  return modal;
}

/**
 * Switch the modal to a marketplace tab. Throws when the tab is absent —
 * silently continuing would seed every row to whatever tab happened to be
 * open, and the script would then assert Amazon fees against Temu rows.
 */
async function selectMarketplace(page, marketplace) {
  const tab = page.getByRole('tab', { name: new RegExp(`^${marketplace}$`, 'i') });
  if (!(await tab.count())) {
    throw new Error(`seedSales: no marketplace tab "${marketplace}" — tabs are AMAZON/BM/EBAY/ONBUY/TEMU`);
  }
  await tab.first().click();
}

/** The modal's own count of complete rows, read off the Confirm button. */
async function readyCount(page) {
  const confirm = page.getByRole('button', { name: /Confirm \d+ Sale/i });
  if (!(await confirm.count())) return 0;
  const label = (await confirm.first().textContent()) || '';
  const m = label.match(/Confirm\s+(\d+)\s+Sale/i);
  return m ? Number(m[1]) : 0;
}

/**
 * Fill one row, addressing every field inside that row's <tr>.
 * Returns true when the row bound to a real stock line.
 */
async function fillRow(modal, page, rowIndex, sale) {
  const row = modal.locator('tbody tr').nth(rowIndex);

  // Model first: typing opens the stock listbox, and PICKING from that
  // listbox is what binds the row to a unit. A typed-but-unpicked row has no
  // unitId and never becomes ready.
  const model = row.getByLabel('Model');
  await model.click();
  await model.fill(sale.model);

  const listbox = page.locator('[role="listbox"][aria-label="Stock"]');
  try {
    await listbox.waitFor({ state: 'visible', timeout: 4000 });
    const option = sale.imei
      ? listbox.getByRole('option').filter({ hasText: sale.imei }).first()
      : listbox.getByRole('option').first();
    if (!(await option.count())) return false;
    await option.click({ timeout: 4000 });
  } catch {
    // Nothing in stock matches. Leave the row unbound; the ready-count below
    // reports the shortfall by number and assertSeeded names it.
    return false;
  }

  if (sale.orderNumber != null) await row.getByLabel('Order number').fill(String(sale.orderNumber));
  if (sale.salePrice != null) await row.getByLabel('Sale price').fill(String(sale.salePrice));

  // Quantity exists only on accessory rows — hence the count() guard, and
  // hence the row scope.
  if (sale.quantity != null) {
    const qty = row.getByLabel('Quantity');
    if (await qty.count()) await qty.fill(String(sale.quantity));
  }
  return true;
}

/**
 * Seed `sales` through Mark Multiple Sold.
 *
 * Does NOT throw on a partial seed — callers assert with assertSeeded so the
 * failure reads "seeded 7 of 10" instead of a downstream total being quietly
 * short.
 *
 * @param {import('playwright').Page} page
 * @param {Array<{marketplace?: string, model: string, imei?: string,
 *                orderNumber?: string|number, salePrice?: number, quantity?: number}>} sales
 * @param {{gotoTab?: Function, batchSize?: number}} [opts]
 * @returns {Promise<{requested: number, sold: number, failed: number, summary: object[]}>}
 */
export async function seedSales(page, sales, opts = {}) {
  const { gotoTab, batchSize = 10 } = opts;
  const summary = [];
  let sold = 0;

  // Marketplace is a modal-level tab, not a per-row field, so a single modal
  // cannot mix channels. Group first, then batch within each group.
  const byMarket = new Map();
  for (const s of sales) {
    const m = (s.marketplace || 'AMAZON').toUpperCase();
    if (!byMarket.has(m)) byMarket.set(m, []);
    byMarket.get(m).push(s);
  }

  for (const [marketplace, rows] of byMarket) {
    for (let off = 0; off < rows.length; off += batchSize) {
      const batch = rows.slice(off, off + batchSize);
      const modal = await openBulkSale(page, gotoTab);
      await selectMarketplace(page, marketplace);

      const addRow = page.getByRole('button', { name: /Add row/i });
      for (let k = 1; k < batch.length; k++) await addRow.click();

      for (let k = 0; k < batch.length; k++) await fillRow(modal, page, k, batch[k]);

      // The component's count, not ours.
      const ready = await readyCount(page);
      const confirm = page.getByRole('button', { name: /Confirm \d+ Sale/i });

      if (ready === 0 || !(await confirm.first().isEnabled().catch(() => false))) {
        summary.push({ marketplace, requested: batch.length, sold: 0, reason: 'no row bound to live stock' });
        await page.getByRole('button', { name: 'Close' }).first().click().catch(() => {});
        await modal.waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {});
        continue;
      }

      await confirm.first().click();
      await modal.waitFor({ state: 'detached', timeout: 30_000 }).catch(() => {});
      sold += ready;
      summary.push({ marketplace, requested: batch.length, sold: ready });
    }
  }

  return { requested: sales.length, sold, failed: sales.length - sold, summary };
}

/**
 * Assert a seed landed in full. Call immediately after seedSales — a script
 * that carries on with a short seed reports a wrong total later and blames
 * the feature under test.
 *
 * `record` is the scripts' own reporter, whose signature is
 * record(name, ok, detail) — name FIRST. Getting that order wrong passes a
 * boolean as the name and a non-empty string as `ok`, which is always truthy,
 * so every assertion silently "passes". Hence the explicit note.
 */
export function assertSeeded(record, result, label = 'seed sales') {
  const ok = result.failed === 0;
  record(
    label,
    ok,
    ok
      ? `seeded ${result.sold}/${result.requested} through Mark Multiple Sold`
      : `seeded only ${result.sold}/${result.requested} — ${JSON.stringify(result.summary)}`,
  );
  return ok;
}
