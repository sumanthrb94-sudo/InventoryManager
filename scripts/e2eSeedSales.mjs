/**
 * Seed sales through the UI, the way an operator does.
 *
 * WHY THIS EXISTS
 *
 * Most of the E2E suite used to create sales by uploading a Sales Report,
 * because that was the fastest way to get rows into the app. Sales import was
 * removed from the product in 2026-08, and a full sweep against the shipping
 * build showed the cost: 32 of 48 scripts stopped at their first step, every
 * one of them waiting for a menu item that no longer exists. None of them were
 * testing import — they were seeding with it.
 *
 * This drives "Mark Multiple Sold" (BulkSaleModal), which is what the operator
 * actually uses to record a batch. Seeding through it is slower than parsing a
 * spreadsheet and considerably more honest: the sale goes through the real
 * modal, the real service and the real write path, so a script that seeds this
 * way is exercising the product rather than a route around it.
 *
 * USAGE
 *
 *   import { seedSales } from './e2eSeedSales.mjs';
 *
 *   await seedSales(page, [
 *     { marketplace: 'AMAZON', kind: 'office',    search: '350111000000011',
 *       orderNumber: 'A-1', price: 400 },
 *     { marketplace: 'EBAY',   kind: 'accessory', search: 'USB-C 20W Charger',
 *       orderNumber: 'E-1', price: 9.99 },
 *     { marketplace: 'BM',     kind: 'shs',       search: 'SUPPLIER-TAG',
 *       orderNumber: 'B-1', price: 300, imei: '888000000000001' },
 *   ]);
 *
 * Returns { requested, sold, failed, summary } so a caller can assert on the
 * seeding itself rather than discovering later that it silently did nothing —
 * which is how a script ends up green while testing an empty database.
 */

const PLATFORM_LABEL = {
  AMAZON: 'Amazon', BM: 'Back Market', EBAY: 'eBay', ONBUY: 'OnBuy', TEMU: 'Temu',
};

const modal = (page) => page.locator('div.fixed.inset-0').last();
const gridRows = (page) => modal(page).locator('tbody tr');

/** Open Inventory → Mark Multiple Sold. */
async function openBulkSaleModal(page, gotoTab) {
  await gotoTab(page, 'Inventory');
  await page.getByRole('button', { name: /Mark Multiple Sold/i }).click();
  await page.waitForTimeout(600);
}

/** Switch to a marketplace's tab. A row belongs to the tab it is entered on —
 *  there is no per-row marketplace dropdown, because the grid mirrors the
 *  Sales Report's own one-sheet-per-marketplace shape. */
async function goToMarketplace(page, marketplace) {
  const label = PLATFORM_LABEL[marketplace];
  if (!label) throw new Error(`unknown marketplace "${marketplace}"`);
  await modal(page).getByRole('tab', { name: new RegExp(`^${label}`, 'i') }).click();
  await page.waitForTimeout(250);
}

/**
 * Add a row and pick the stock for it.
 *
 * `kind` is set BEFORE searching on purpose: the search only offers the chosen
 * source, which is what stops an office handset being picked when an SHS one
 * of the same model was meant.
 */
async function addRow(page, { search, kind }) {
  const m = modal(page);
  const before = await gridRows(page).count();
  const filled = await m.locator('input[aria-label="Model"]')
    .evaluateAll(els => els.filter(e => e.value.trim()).length);
  if (filled >= before) {
    await m.getByRole('button', { name: /^Add row$/i }).click();
    await page.waitForTimeout(200);
  }
  const row = gridRows(page).last();

  await row.getByLabel('Source').selectOption(kind);
  await page.waitForTimeout(150);
  await row.locator('input[aria-label="Model"]').fill(search);
  await page.waitForTimeout(400);

  const options = page.locator('div[role="listbox"] button[role="option"]');
  if (!(await options.count())) {
    throw new Error(`seedSales: no ${kind} stock matching "${search}" — nothing to sell`);
  }
  await options.first().click({ timeout: 8000 });
  await page.waitForTimeout(250);
  return row;
}

/** Cells are addressed by aria-label, never by position: a row's shape changes
 *  with what it sells, so the nth cell is a different field on different rows. */
async function fillRow(page, row, { orderNumber, price, imei, quantity, postage }) {
  if (imei !== undefined) await row.locator('input[aria-label="IMEI"]').fill(String(imei));
  if (quantity !== undefined) {
    const q = row.getByLabel('Quantity');
    if (await q.count()) await q.fill(String(quantity));
  }
  await row.getByLabel('Order number').fill(orderNumber);
  await row.getByLabel('Sale price').fill(String(price));
  if (postage !== undefined) {
    const p = row.getByLabel('Postage');
    if (await p.count()) await p.fill(String(postage));
  }
  await page.waitForTimeout(120);
}

/**
 * Record a batch of sales through Mark Multiple Sold.
 *
 * @param page                Playwright page
 * @param sales               rows to enter; see the file header for the shape
 * @param opts.gotoTab        the caller's own nav helper (each script has one)
 * @param opts.batchSize      rows per modal pass; the grid stays responsive
 *                            around 10-15, and a fresh modal per batch keeps
 *                            one bad row from stranding the rest
 * @returns { requested, sold, failed, summary }
 */
export async function seedSales(page, sales, opts = {}) {
  const { gotoTab, batchSize = 10 } = opts;
  if (typeof gotoTab !== 'function') {
    throw new Error('seedSales: pass your script\'s gotoTab as opts.gotoTab');
  }
  if (!sales.length) return { requested: 0, sold: 0, failed: 0, summary: 'nothing to seed' };

  let sold = 0;
  let failed = 0;
  const summaries = [];

  for (let i = 0; i < sales.length; i += batchSize) {
    const batch = sales.slice(i, i + batchSize);
    await openBulkSaleModal(page, gotoTab);

    for (const s of batch) {
      await goToMarketplace(page, s.marketplace);
      const row = await addRow(page, { search: s.search, kind: s.kind ?? 'office' });
      await fillRow(page, row, s);
    }

    const m = modal(page);
    await m.getByRole('button', { name: /^Confirm \d+ Sales?$/i }).click();
    await page.waitForTimeout(1500);

    const text = await m.innerText().catch(() => '');
    summaries.push((text.match(/\d+ sold[^\n]*/i) ?? [])[0] || '');
    sold += Number((text.match(/(\d+)\s*sold/i) ?? [0, 0])[1]);
    failed += Number((text.match(/(\d+)\s*failed/i) ?? [0, 0])[1]);

    await m.getByRole('button', { name: /^Close$/i }).last().click().catch(() => {});
    await page.waitForTimeout(600);
  }

  return { requested: sales.length, sold, failed, summary: summaries.join(' · ') };
}

/** Convenience: assert the seeding actually happened.
 *
 *  Worth its own call because the failure it catches is the quiet one — a
 *  script that seeds nothing, asserts against an empty database and reports
 *  everything fine. */
export function assertSeeded(record, result, label = 'seeded sales through the UI') {
  record(`${label} — ${result.sold}/${result.requested}`,
    result.sold === result.requested && result.failed === 0,
    result.summary || `${result.failed} failed`);
}
