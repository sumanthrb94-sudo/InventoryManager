/**
 * e2eSeedSales — put sales into the E2E store by driving Mark Multiple Sold.
 *
 * WHY THIS EXISTS
 *
 * Twenty-odd E2E scripts seeded sales by uploading a Sales Report and then went
 * on to test something entirely unrelated — the VAT centre, stock alerts,
 * supplier rollups, best-sellers. Import was never their subject, just the
 * fastest way to get rows in. The importers were deleted (2026-08), so those
 * scripts now die at their setup step. The tests themselves are still valid.
 *
 * This drives the real Mark Multiple Sold modal instead. That makes the
 * seeding STRICTER than the import it replaces: recordBulkSales reconciles
 * against live stock, so a script can only sell something its fixture really
 * put on the shelf, where an import could conjure a sale for a unit that never
 * existed. Expect some converted scripts to surface failures that were
 * previously masked — that is the point, not a regression here.
 *
 * THE CONTRACT IS FIXED BY e2eSeedSalesSelfTest.mjs
 *
 *   seedSales(page, plan, { gotoTab, batchSize })
 *
 *   plan item: { marketplace, kind, search, orderNumber, price, quantity? }
 *     marketplace  AMAZON | BM | EBAY | ONBUY | TEMU   (a modal-level tab)
 *     kind         office | shs | accessory            (the row's Source select)
 *     search       what to type to find the line — an IMEI for a handset,
 *                  a SKU or name for an accessory pool
 *     sku          optional. The modal REQUIRES a SKU per row; when omitted
 *                  the helper keeps whatever the pick defaulted, and falls
 *                  back to `search` when that is blank (hand-added handsets
 *                  carry no unit.sku, so the cell arrives empty)
 *     orderNumber  the marketplace order number
 *     price        sale price
 *     quantity     accessory pools only; handsets are one per row
 *
 *   gotoTab(page, label) — TWO arguments, page first. Every script in this
 *   directory defines it that way. An earlier rebuild of this file called
 *   gotoTab('Sell'), so the label arrived where the page was expected and the
 *   helper died on `page.getByLabel is not a function` at the first call.
 *
 * ADDRESSING
 *
 * Every field is located inside its own <tr>, then by aria-label. Row-scoping
 * is required for correctness, not style: Quantity renders ONLY for accessory
 * lines (a handset shows a static "1"), so a page-wide
 * getByLabel('Quantity').nth(rowIndex) addresses the wrong row the moment a
 * batch mixes handsets and accessories.
 *
 * THE COUNT COMES FROM THE COMPONENT
 *
 * The modal renders "Confirm N Sales", where N is its own judgement of how
 * many rows are complete. N is what gets reported — not this file's tally of
 * fields it filled. A row can be typed into and still not be ready (no stock
 * match, missing price), and counting optimistically turns a short seed into a
 * confusing assertion failure three steps downstream.
 */

const SOURCE_LABEL = { office: 'Office', shs: 'SHS', accessory: 'Accessory' };

/**
 * Marketplace CODE -> the tab's visible label.
 *
 * The tabs render PLATFORM_META[m].label from SellOrderModal (NOT the
 * similar-looking map in lib/marketplaceLabels.ts, which spells BM
 * "Backmarket" without the space). It is a display name, not the
 * code. Four of the five happen to match their code case-insensitively, so a
 * naive /^CODE$/i works for AMAZON, EBAY, ONBUY and TEMU and hides the bug —
 * then BM, whose label is "Back Market", is the one that fails. Mapping all
 * five explicitly means the odd one out is not a special case discovered at
 * runtime.
 */
const MARKETPLACE_TAB = {
  AMAZON: 'Amazon',
  BM: 'Back Market',
  EBAY: 'eBay',
  ONBUY: 'OnBuy',
  TEMU: 'Temu',
};

/** The modal's inner panel — the element that actually holds the rows. */
function modalOf(page) {
  return page.locator('div.bg-white.rounded-2xl')
             .filter({ hasText: 'Mark Multiple Sold' })
             .first();
}

/** Open Sell → Mark Multiple Sold. Returns the modal locator. */
async function openBulkSale(page, gotoTab) {
  // The nav LABEL is "Inventory", not "Sell" — the tab's id is 'sell' but
  // App.tsx renders it as `{ id: 'sell', label: 'Inventory' }`. Passing 'Sell'
  // silently navigates nowhere, and the failure surfaces 30s later as a
  // missing Mark Multiple Sold button rather than as a bad tab name.
  if (gotoTab) await gotoTab(page, 'Inventory');
  const trigger = page.getByRole('button', { name: /Mark Multiple Sold/i });
  await trigger.waitFor({ state: 'visible', timeout: 30_000 });
  await trigger.click();
  const modal = modalOf(page);
  await modal.waitFor({ state: 'visible', timeout: 15_000 });
  return modal;
}

/**
 * Switch to a marketplace tab. Throws when it is absent — carrying on would
 * seed every row into whatever tab happened to be open, and the script would
 * then assert Amazon fees against Temu rows.
 */
async function selectMarketplace(page, marketplace) {
  const label = MARKETPLACE_TAB[marketplace];
  if (!label) {
    throw new Error(`seedSales: unknown marketplace "${marketplace}" — expected ${Object.keys(MARKETPLACE_TAB).join('/')}`);
  }
  // Anchored at the start only: a tab with pending rows renders a count badge,
  // so its accessible name is "Backmarket 2", not "Backmarket".
  const tab = page.getByRole('tab', { name: new RegExp(`^${label}\\b`, 'i') });
  if (!(await tab.count())) {
    throw new Error(`seedSales: marketplace tab "${label}" (${marketplace}) is not on screen`);
  }
  await tab.first().click();
}

/**
 * Dismiss the modal, whichever state it is in.
 *
 * There are two Close controls: the header's icon button (aria-label="Close")
 * and the results footer's "Close" text button. Both call onClose. Clicking by
 * role+name matches either, and the wait afterwards is what makes the next
 * batch safe — the overlay is z-[200] and intercepts every click until gone.
 */
async function closeModal(page, modal) {
  await page.getByRole('button', { name: /^Close$/i }).last()
            .click({ timeout: 10_000 }).catch(() => {});
  await modal.waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {});
}

/** The modal's own count of complete rows, read off the Confirm button. */
async function readyCount(page) {
  const confirm = page.getByRole('button', { name: /Confirm \d+ Sale/i });
  if (!(await confirm.count())) return 0;
  const m = ((await confirm.first().textContent()) || '').match(/Confirm\s+(\d+)\s+Sale/i);
  return m ? Number(m[1]) : 0;
}

/**
 * Fill one row, addressing every field inside that row's <tr>.
 * Returns true when the row bound to a real stock line.
 */
async function fillRow(modal, page, rowIndex, item) {
  const row = modal.locator('tbody tr').nth(rowIndex);

  // Source first: changing it clears any pick and the typed query, so setting
  // it after the model would silently discard the binding.
  const kind = item.kind || 'office';
  const source = row.getByLabel('Source');
  if (await source.count()) await source.selectOption({ label: SOURCE_LABEL[kind] ?? 'Office' });

  // Then the search. Typing opens the stock listbox; PICKING from it is what
  // binds the row to a unit. A typed-but-unpicked row never becomes ready.
  const model = row.getByLabel('Model');
  await model.click();
  await model.fill(String(item.search ?? ''));

  const listbox = page.locator('[role="listbox"][aria-label="Stock"]');
  try {
    await listbox.waitFor({ state: 'visible', timeout: 4000 });
    const option = listbox.getByRole('option').first();
    if (!(await option.count())) return false;
    await option.click({ timeout: 4000 });
  } catch {
    // Nothing in stock matches. Leave the row unbound; the ready-count reports
    // the shortfall and assertSeeded names it.
    return false;
  }

  // SKU is mandatory on this modal, and for a handset the cell is defaulted
  // from unit.sku — which is blank for anything added through Add Stock, so
  // the row would never become ready. Fill it when the pick left it empty.
  const skuCell = row.getByLabel('SKU');
  if (await skuCell.count()) {
    const current = ((await skuCell.inputValue().catch(() => '')) || '').trim();
    if (item.sku != null) await skuCell.fill(String(item.sku));
    else if (!current) await skuCell.fill(String(item.search ?? 'E2E-SKU'));
  }

  if (item.orderNumber != null) await row.getByLabel('Order number').fill(String(item.orderNumber));
  if (item.price != null) await row.getByLabel('Sale price').fill(String(item.price));

  // Quantity exists only on accessory rows — hence the guard, and the row scope.
  if (item.quantity != null) {
    const qty = row.getByLabel('Quantity');
    if (await qty.count()) await qty.fill(String(item.quantity));
  }
  return true;
}

/**
 * Seed `plan` through Mark Multiple Sold.
 *
 * Does NOT throw on a partial seed — callers assert with assertSeeded so the
 * failure reads "seeded 7 of 10" rather than a downstream total being quietly
 * short.
 *
 * @returns {Promise<{requested:number, sold:number, failed:number, summary:object[]}>}
 */
export async function seedSales(page, plan, opts = {}) {
  const { gotoTab, batchSize = 10 } = opts;
  const summary = [];
  let sold = 0;

  // Marketplace is a modal-level tab, not a per-row field, so one modal cannot
  // mix channels. Group first, then batch within each group.
  const byMarket = new Map();
  for (const item of plan) {
    const m = (item.marketplace || 'AMAZON').toUpperCase();
    if (!byMarket.has(m)) byMarket.set(m, []);
    byMarket.get(m).push(item);
  }

  for (const [marketplace, rows] of byMarket) {
    for (let off = 0; off < rows.length; off += batchSize) {
      const batch = rows.slice(off, off + batchSize);
      const modal = await openBulkSale(page, gotoTab);
      await selectMarketplace(page, marketplace);

      const addRow = page.getByRole('button', { name: /Add row/i });
      for (let k = 1; k < batch.length; k++) await addRow.click();

      for (let k = 0; k < batch.length; k++) await fillRow(modal, page, k, batch[k]);

      const ready = await readyCount(page);
      const confirm = page.getByRole('button', { name: /Confirm \d+ Sale/i });

      if (ready === 0 || !(await confirm.first().isEnabled().catch(() => false))) {
        summary.push({ marketplace, requested: batch.length, sold: 0, reason: 'no row bound to live stock' });
        await closeModal(page, modal);
        continue;
      }

      await confirm.first().click();

      // Confirm does NOT close the modal. It swaps the body for a results view
      // ("Done", "N sold") with its own Close button, and that overlay sits at
      // z-[200] over the whole page — so simply waiting for the modal to
      // detach times out, and the NEXT batch then fails on an intercepted
      // click against a still-open dialog. Dismiss it explicitly.
      await page.getByText('Nothing else to do', { exact: false })
                .waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
      await closeModal(page, modal);

      sold += ready;
      summary.push({ marketplace, requested: batch.length, sold: ready });
    }
  }

  return { requested: plan.length, sold, failed: plan.length - sold, summary };
}

/**
 * Assert a seed landed in full. Call immediately after seedSales — a script
 * that carries on with a short seed reports a wrong total later and blames the
 * feature under test.
 *
 * `record` is the scripts' own reporter: record(name, ok, detail) — name
 * FIRST. An earlier rebuild passed (ok, name, detail), which puts a non-empty
 * string in the `ok` slot; that is always truthy, so every seed assertion
 * would have reported success no matter what happened.
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
