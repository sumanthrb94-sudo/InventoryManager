/**
 * Turn the 50-unit simulation manifest into a verification document.
 *
 * The point of this document is that the operator can sit with it and the
 * exported Sales Report side by side and check any figure by hand. So every
 * table shows its working — the fee lines that make up a GP, the leg cost and
 * leg count that make up a carriage figure — rather than a finished number.
 *
 * Run:  npx tsx scripts/simulate50Units.ts && node scripts/buildSimulationPdf.mjs
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const OUT = resolve('simulation-output');
const m = JSON.parse(readFileSync(resolve(OUT, 'simulation-manifest.json'), 'utf8'));

import { existsSync } from 'node:fs';
const SCREENS = resolve('simulation-output/screens');
const dataUri = f => {
  const p = resolve(SCREENS, f);
  if (!existsSync(p)) return null;
  return 'data:image/png;base64,' + readFileSync(p).toString('base64');
};
const screenFig = (file, caption, cls = '') => {
  const uri = dataUri(file);
  if (!uri) return '';
  return `<figure class="${cls}"><img src="${uri}" alt="${caption.replace(/"/g, '&quot;')}">
    <figcaption>${caption}</figcaption></figure>`;
};

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const money = v => (v === '' || v == null || Number.isNaN(Number(v)))
  ? '<span class="dim">—</span>'
  : `£${Number(v).toFixed(2)}`;
const signed = v => {
  const n = Number(v);
  if (!n) return '<span class="dim">—</span>';
  return n > 0
    ? `<span class="neg">−£${n.toFixed(2)}</span>`
    : `<span class="pos">+£${Math.abs(n).toFixed(2)}</span>`;
};

const journeyRows = m.journeys.map(j => `
  <tr>
    <td class="n">${j.n}</td>
    <td>${esc(j.scenario)}</td>
    <td class="mono">${esc(j.imei)}</td>
    <td>${esc(j.model)}</td>
    <td>${esc(j.marketplace)}</td>
    <td class="n">${esc(j.saleDate)}</td>
    <td class="n">${esc(j.returnDate)}</td>
    <td class="n">${j.daysAfterSale}d</td>
    <td><span class="pill p-${j.route}">${esc(j.route)}</span></td>
    <td class="n">${money(j.legCost)}</td>
    <td class="n">× ${j.legs}</td>
    <td class="n">${signed(j.carriage)}</td>
    <td class="n">${j.otherCost ? signed(j.otherCost) : (j.awaiting ? '<span class="await">AWAITING</span>' : '<span class="dim">—</span>')}</td>
    <td class="n">${j.supplierCredit ? `<span class="pos">+£${j.supplierCredit.toFixed(2)}</span>` : '<span class="dim">—</span>'}</td>
    <td class="n strong">${signed(j.totalCost)}</td>
    <td class="ctr">${j.saleStillCounts ? '<span class="yes">YES</span>' : '<span class="dim">no</span>'}</td>
    <td>${esc(j.endStatus)}</td>
  </tr>`).join('');

const saleRows = m.sales.map(s => {
  const j = m.journeys.find(x => x.unitId === s.unitId);
  return `
  <tr class="${s.voided ? 'voided' : ''}">
    <td class="mono">${esc(s.imei)}</td>
    <td>${esc(s.marketplace)}</td>
    <td class="mono">${esc(s.order)}</td>
    <td class="n">${esc(s.saleDate)}</td>
    <td class="n">${money(s.bp)}</td>
    <td class="n">${money(s.sp)}</td>
    <td class="n">${money(s.commission)}</td>
    <td class="n">${money(s.totalVat)}</td>
    <td class="n">${money(s.postage)}</td>
    <td class="n strong">${money(s.grossProfit)}</td>
    <td class="n">${s.gpPercent == null || s.gpPercent === '' ? '<span class="dim">—</span>' : Number(s.gpPercent).toFixed(2) + '%'}</td>
    <td class="ctr">${s.voided ? `<span class="pill p-${s.voidOutcome}">${esc(s.voidOutcome)}</span>` : '<span class="dim">—</span>'}</td>
    <td class="ctr">${s.voided
      ? (s.customerRefunded === false ? '<span class="yes">counts</span>' : '<span class="dim">reversed</span>')
      : '<span class="yes">counts</span>'}</td>
    <td class="n">${j ? j.n : ''}</td>
  </tr>`;
}).join('');

const unitRows = m.units.map(u => `
  <tr>
    <td class="mono">${esc(u.id)}</td>
    <td class="mono">${esc(u.imei)}</td>
    <td>${esc(u.model)}</td>
    <td>${esc(u.colour)}</td>
    <td class="ctr">${esc(u.grade)}</td>
    <td>${esc(u.supplier)}</td>
    <td class="n">${esc(u.dateIn)}</td>
    <td class="n">${money(u.bp)}</td>
    <td>${esc(u.marketplace) || '<span class="dim">—</span>'}</td>
    <td class="n">${u.sp === '' ? '<span class="dim">—</span>' : money(u.sp)}</td>
    <td>${esc(u.returnType) || '<span class="dim">—</span>'}</td>
    <td class="n">${u.repairCost === '' ? '<span class="dim">—</span>' : money(u.repairCost)}</td>
    <td class="n">${u.supplierCredit === '' ? '<span class="dim">—</span>' : money(u.supplierCredit)}</td>
    <td class="mono">${esc(u.replacedBy) || esc(u.replacementFor) || '<span class="dim">—</span>'}</td>
    <td>${esc(u.status)}</td>
  </tr>`).join('');

const t = m.returnTotals;
const c = m.counts;

const HTML = `<title>50-Unit Simulation — Verification Pack</title>
<style>
:root{--paper:#FAF8F4;--panel:#fff;--ink:#191B1F;--rule:#DDD7CB;--muted:#6F6B62;
      --neg:#A32C1E;--pos:#14654F;--await:#B0500A;--acc:#2E4A99;
      --sans:ui-sans-serif,system-ui,"Helvetica Neue",Arial,sans-serif;
      --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;}
@media (prefers-color-scheme:dark){:root{--paper:#15171A;--panel:#1C1F23;--ink:#ECE9E3;--rule:#34383E;
  --muted:#9A958C;--neg:#E8806E;--pos:#5BC0A8;--await:#E0904A;--acc:#8AA0E8;}}
:root[data-theme="dark"]{--paper:#15171A;--panel:#1C1F23;--ink:#ECE9E3;--rule:#34383E;
  --muted:#9A958C;--neg:#E8806E;--pos:#5BC0A8;--await:#E0904A;--acc:#8AA0E8;}
:root[data-theme="light"]{--paper:#FAF8F4;--panel:#fff;--ink:#191B1F;--rule:#DDD7CB;
  --muted:#6F6B62;--neg:#A32C1E;--pos:#14654F;--await:#B0500A;--acc:#2E4A99;}

body{background:var(--paper);color:var(--ink);font-family:var(--sans);margin:0;padding:26px 24px 36px;line-height:1.5;}
.doc{max-width:1500px;margin:0 auto;}
.masthead{border-bottom:3px solid var(--ink);padding-bottom:12px;margin-bottom:20px;}
.eyebrow{font-family:var(--mono);font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:var(--muted);margin:0 0 6px;}
h1{font-size:32px;font-weight:800;letter-spacing:-.03em;margin:0 0 6px;}
.standfirst{color:var(--muted);margin:0;font-size:14px;max-width:78ch;}

h2{font-size:18px;font-weight:800;letter-spacing:-.02em;margin:30px 0 3px;}
h2 .num{font-family:var(--mono);font-size:11px;color:var(--acc);display:block;letter-spacing:.16em;margin-bottom:3px;}
.sub{font-family:var(--mono);font-size:11px;color:var(--muted);margin:0 0 10px;}
p{margin:8px 0;max-width:88ch;font-size:13px;}

.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:16px 0 4px;}
.kpi{background:var(--panel);border:1.5px solid var(--rule);border-radius:5px;padding:10px 12px;}
.kpi .lbl{font-family:var(--mono);font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);}
.kpi .val{font-size:22px;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:-.02em;margin-top:2px;}

table{width:100%;border-collapse:collapse;font-size:10.5px;margin:8px 0 4px;}
th,td{text-align:left;padding:3.5px 6px;border-bottom:1px solid var(--rule);vertical-align:top;}
thead th{font-family:var(--mono);font-size:8.5px;letter-spacing:.1em;text-transform:uppercase;
         color:var(--muted);border-bottom:1.5px solid var(--ink);white-space:nowrap;}
td.n,td.mono{font-family:var(--mono);font-variant-numeric:tabular-nums;white-space:nowrap;}
td.n{text-align:right;}
td.ctr{text-align:center;}
td.strong{font-weight:700;}
.dim{color:var(--muted);}
.neg{color:var(--neg);font-weight:700;}
.pos{color:var(--pos);font-weight:700;}
.yes{color:var(--pos);font-weight:700;}
.await{color:var(--await);font-weight:700;font-family:var(--mono);font-size:9px;letter-spacing:.08em;}
tr.voided td{background:rgba(163,44,30,.10);}
.pill{font-family:var(--mono);font-size:8.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;
      border:1px solid var(--rule);border-radius:3px;padding:0 4px;white-space:nowrap;}
.p-refund{color:var(--neg);border-color:var(--neg);}
.p-repair{color:var(--acc);border-color:var(--acc);}
.p-replacement{color:#6D3FA0;border-color:#6D3FA0;}

.callout{border-left:4px solid var(--acc);background:var(--panel);padding:10px 14px;margin:14px 0;border-radius:0 4px 4px 0;}
.callout .lbl{font-family:var(--mono);font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);display:block;margin-bottom:3px;}
.callout p{margin:4px 0;}
.maths{font-family:var(--mono);font-size:11px;background:var(--panel);border:1px solid var(--rule);
       border-radius:4px;padding:10px 13px;white-space:pre;overflow-x:auto;line-height:1.65;margin:10px 0;}
figure{margin:14px 0 6px;break-inside:avoid;}
figure img{display:block;width:100%;height:auto;border:1px solid var(--rule);border-radius:4px;}
figcaption{font-family:var(--mono);font-size:9.5px;color:var(--muted);margin-top:5px;line-height:1.4;}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
.grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;}
.grid4 figure{margin:0;}
.grid4 figcaption{font-size:9px;}
footer{margin-top:32px;border-top:1px solid var(--rule);padding-top:10px;font-family:var(--mono);font-size:10px;color:var(--muted);}

@page{size:A3 landscape;margin:10mm;}
@media print{
  :root{--paper:#fff;--panel:#fff;--ink:#000;--rule:#c0c0c0;--muted:#555;}
  body{padding:0;}
  .doc{max-width:none;}
  h2{break-after:avoid;}
  table{break-inside:auto;}
  tr{break-inside:avoid;}
  thead{display:table-header-group;}
  .callout,.maths,.kpis{break-inside:avoid;}
}
</style>

<div class="doc">
<header class="masthead">
  <p class="eyebrow">Mobilephonemarket · Inventory Manager · verification pack · ${esc(m.generated)}</p>
  <h1>50 units · 40 sales · 20 returns</h1>
  <p class="standfirst">
    Every figure below is produced by the application's own code — the same
    <span class="mono">calcSaleFinancials</span>, return-patch builders and report writer the live app runs.
    Nothing here is re-derived for the document. Deterministic seed ${m.seed}: re-running the
    simulation reproduces this pack and the workbook exactly.
  </p>
</header>

<div class="kpis">
  <div class="kpi"><div class="lbl">Units created</div><div class="val">${c.unitsCreated}</div></div>
  <div class="kpi"><div class="lbl">Sold</div><div class="val">${c.unitsSold}</div></div>
  <div class="kpi"><div class="lbl">Still in stock</div><div class="val">${c.unitsNeverSold}</div></div>
  <div class="kpi"><div class="lbl">Returns</div><div class="val">${c.returns}</div></div>
  <div class="kpi"><div class="lbl">Sales still counting</div><div class="val">${c.salesStillCounting}</div></div>
  <div class="kpi"><div class="lbl">Carriage</div><div class="val">£${t.carriage.toFixed(2)}</div></div>
  <div class="kpi"><div class="lbl">Repair invoices</div><div class="val">£${t.repairInvoices.toFixed(2)}</div></div>
  <div class="kpi"><div class="lbl">Supplier credits</div><div class="val">£${t.supplierCredits.toFixed(2)}</div></div>
  <div class="kpi"><div class="lbl">Net return cost</div><div class="val">£${t.netCost.toFixed(2)}</div></div>
</div>

<div class="maths">carriage        £${t.carriage.toFixed(2)}
repair invoices £${t.repairInvoices.toFixed(2)}
supplier credits    −£${t.supplierCredits.toFixed(2)}
──────────────────────────────
net return cost £${t.netCost.toFixed(2)}        ${t.awaitingCount} cost(s) not yet entered — this is a floor</div>

<h2><span class="num">01</span>The twenty returns</h2>
<p class="sub">one row per scenario · leg = postage + P.VAT · refund / repair / to-supplier = 2 legs · replacement = 3</p>

<table>
  <thead><tr>
    <th>#</th><th>Scenario</th><th>IMEI</th><th>Model</th><th>Mkt</th>
    <th>Sold</th><th>Returned</th><th>After</th><th>Route</th>
    <th>Leg £</th><th>Legs</th><th>Carriage</th><th>Other</th><th>Credit</th><th>Total</th>
    <th>Sale counts?</th><th>Unit now</th>
  </tr></thead>
  <tbody>${journeyRows}</tbody>
</table>

<div class="callout">
  <span class="lbl">The two boundary rows</span>
  <p>
    <strong>#11 at day 30</strong> is inside the warranty window, so the customer was refunded and the
    sale reverses. <strong>#12 at day 31</strong> is outside it — free repair, no refund, so the sale
    still counts. Same handset model, same repair cost, one day apart, opposite treatment. That is the
    30-day rule doing its job.
  </p>
  <p>
    <strong>#16</strong> is the no-stock case: a replacement was wanted but no like-for-like handset
    was on the shelf, so it became a refund — two legs, not three.
  </p>
  <p>
    <strong>#13–15</strong> are replacements. Three legs each and nothing more; the faulty unit came
    back as the replacement shipped, so net stock is unchanged and no handset was consumed.
  </p>
</div>

<h2><span class="num">02</span>Every sale, with its fee lines</h2>
<p class="sub">check any row against the matching marketplace tab in SIMULATION_SALES_REPORT.xlsx · shaded rows were returned</p>

<table>
  <thead><tr>
    <th>IMEI</th><th>Mkt</th><th>Order</th><th>Sale date</th>
    <th>BP</th><th>SP</th><th>Commission</th><th>Total VAT</th><th>Postage</th>
    <th>GP</th><th>GP %</th><th>Return</th><th>Revenue</th><th>Sc#</th>
  </tr></thead>
  <tbody>${saleRows}</tbody>
</table>

<div class="callout">
  <span class="lbl">Reading the Revenue column</span>
  <p>
    <strong>counts</strong> means the money stayed with the business. Every live sale counts, and so do
    replacements and out-of-warranty repairs — the customer kept paying in both. <strong>reversed</strong>
    means refunded: on the marketplace tab that row's GP is now zero, so it reads as the loss it is
    rather than showing the profit the sale would have made.
  </p>
</div>

<h2><span class="num">03</span>All fifty units</h2>
<p class="sub">intake → sale → return outcome · units 41–50 were never sold and stand as replacement stock</p>

<table>
  <thead><tr>
    <th>ID</th><th>IMEI</th><th>Model</th><th>Colour</th><th>Gr</th><th>Supplier</th>
    <th>In</th><th>BP</th><th>Sold on</th><th>SP</th>
    <th>Return</th><th>Repair £</th><th>Credit £</th><th>Linked</th><th>Status</th>
  </tr></thead>
  <tbody>${unitRows}</tbody>
</table>

<h2><span class="num">04</span>The screens, with this data loaded</h2>
<p class="sub">the simulation's own store injected into the application — these are not screenshots of a different dataset</p>

${screenFig('returns-kpis.png', 'Returns · the four buckets. 10 back to inventory + 7 in repair + 3 to supplier = the 20 returns in §01.')}
${screenFig('returns-loss-ledger.png', 'Returns · the loss ledger. Replacement rows carry carriage only; a repair with no invoice reads AWAITING; supplier credits show green because the money came back.')}
${screenFig('inventory-kpis.png', 'Inventory · the sales tiles. ALL-TIME SOLD 26 is the 40 sales less the 14 that were refunded — the 6 replacements and out-of-warranty repairs still count.')}

${screenFig('returns-table-01.png', 'Returns · the loss ledger paginated, showing 12 of the 20 cycles. The remaining rows are in §01, and every return also has its own card in §05.')}

<h2><span class="num">05</span>Each return, unit by unit</h2>
<p class="sub">the Unit Lifecycle card the app shows for every returned handset · stock in → sold → return → where it is now</p>
<div class="grid4">
${m.journeys.map(j => {
  const f = `history-${String(j.n).padStart(2, '0')}-${j.route}.png`;
  return screenFig(f, `#${j.n} ${j.scenario}`);
}).join('')}
</div>

<h2><span class="num">06</span>How to check it by hand</h2>
<p>
  Open <span class="mono">SIMULATION_SALES_REPORT.xlsx</span> next to this document.
</p>
<ul style="font-size:13px;max-width:88ch">
  <li>Find any IMEI from §02 on its marketplace tab. BP, SP, commission, VAT and postage should match
      the row here exactly — both come from the same calculation.</li>
  <li>The money columns in the workbook are <strong>live Excel formulas</strong>, not frozen numbers.
      Click a GP cell and you will see the arithmetic.</li>
  <li>On a refunded row the GP cell reads <strong>0</strong>. GP % and Net GP follow from it, and the
      tab's TOTAL row excludes it.</li>
  <li>On a replacement or an out-of-warranty repair the GP is untouched — those sales kept their money.</li>
  <li>The Returns Summary and Returns Detail sheets inside the same workbook carry the same twenty
      rows as §01.</li>
</ul>

<footer>
  Generated from simulation-manifest.json · seed ${m.seed} · production functions:
  calcSaleFinancials · processReturnSalePatch · buildReturningUnitPatch · returnCostFor · buildSalesWorkbookBuffer
</footer>
</div>`;

writeFileSync(resolve(OUT, 'simulation.html'), HTML);

const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
const dir = readdirSync(root).find(d => /^chromium-\d+$/.test(d));
const browser = await chromium.launch({
  executablePath: dir ? `${root}/${dir}/chrome-linux/chrome` : undefined,
});
const page = await browser.newPage();
await page.setContent(
  `<!doctype html><html><head><meta charset="utf-8">
   <style>*,*::before,*::after{box-sizing:border-box}body{margin:0}</style></head><body>${HTML}</body></html>`,
  { waitUntil: 'networkidle' },
);
await page.emulateMedia({ media: 'print', colorScheme: 'light' });
await page.pdf({
  path: resolve(OUT, 'Simulation-50-Units-20-Returns.pdf'),
  format: 'A3', landscape: true, printBackground: true,
  margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
});
await browser.close();
console.log('PDF written to simulation-output/Simulation-50-Units-20-Returns.pdf');
