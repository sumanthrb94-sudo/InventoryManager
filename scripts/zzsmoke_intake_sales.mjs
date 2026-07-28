import { chromium } from 'playwright';
import { readdirSync } from 'node:fs';
import {
  BASE, gotoTab, wipeAll, stockIntakePersona, salesPersona, results, record,
} from './e2eQuarterSimulation.mjs';

async function run() {
  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const chromeDir = readdirSync(browsersRoot).find(d => /^chromium-\d+$/.test(d));
  const browser = await chromium.launch({
    executablePath: chromeDir ? `${browsersRoot}/${chromeDir}/chrome-linux/chrome` : undefined,
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(60000);
  const jsErrors = [];
  page.on('pageerror', e => jsErrors.push(String(e)));

  await page.goto(`${BASE}?e2eReset=1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await wipeAll(page);

  await stockIntakePersona(page);
  const preLiveReturnsStore = await salesPersona(page);

  console.log('\n--- Post-sales-import: gotoTab Returns sanity check ---');
  const t0 = Date.now();
  try {
    await gotoTab(page, 'Returns');
    record('gotoTab Returns after bulk sales import (smoke)', true, `${Date.now() - t0}ms`);
  } catch (e) {
    record('gotoTab Returns after bulk sales import (smoke)', false, String(e).slice(0, 300));
  }

  console.log('\n--- Post-sales-import: gotoTab Admin sanity check ---');
  const t1 = Date.now();
  try {
    await gotoTab(page, 'Admin');
    record('gotoTab Admin after bulk sales import (smoke)', true, `${Date.now() - t1}ms`);
  } catch (e) {
    record('gotoTab Admin after bulk sales import (smoke)', false, String(e).slice(0, 300));
  }

  console.log(`\nJS errors: ${jsErrors.length}`);
  jsErrors.slice(0, 5).forEach(e => console.log('  ', e.slice(0, 200)));

  const pass = results.filter(r => r.ok).length;
  console.log(`\n${pass}/${results.length} checks passed`);

  await browser.close();
}
run().catch(e => { console.error(e); process.exit(1); });
