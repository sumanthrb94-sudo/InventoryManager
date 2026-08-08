/**
 * Build FORMULAS_TO_CONFIRM.xlsx — one sheet per marketplace, listing every
 * calculated line so the operator can check it against their own workings and
 * tell us where we are wrong.
 *
 * GENERATED FROM THE LIVE CALCULATOR, deliberately.
 *
 * A hand-typed summary of the formulas would be a fourth copy of them, and the
 * one the client signs off would be the copy nobody tests. Every rate, every
 * formula and every worked figure below comes from calcSaleFinancials and
 * excelFormulaFor — the same two functions that price a real sale and write the
 * real report. If the app changes, regenerating this sheet changes with it; if
 * the client disagrees with a line here, they disagree with the software.
 *
 *   npx tsx scripts/buildFormulaConfirmationSheet.mts
 */
import ExcelJS from 'exceljs';
import { calcSaleFinancials, excelFormulaFor, SALES_HEADERS, getMarketplaceFee } from '../src/lib/platforms';
import { MARKETPLACES } from '../src/types';
import type { Marketplace } from '../src/types';

/** One worked example per marketplace. Deliberately the SAME phone every
 *  time, so the sheets can be compared side by side: the only thing that
 *  differs down the five tabs is the marketplace's own fee schedule. */
const BP = 300;
const SP = 400;
const POSTAGE = 6.30;

/** Plain-English rule for each calculated line, keyed by the column header.
 *  The wording is for the operator, not for us — this is the column they read
 *  when deciding whether they agree. */
const RULE: Record<string, string> = {
  'SP-BP':          'What you sold it for, less what you paid',
  'Marginal Tax':   'VAT on the margin — 16.67% of (SP − BP)',
  'Commission':     "The marketplace's cut",
  'C. VAT':         'VAT on the commission — 20%',
  'DSF':            'Digital Services Fee — 2% of the commission',
  'DSF. VAT':       'VAT on the DSF — 20%',
  'ROF':            'Regulatory Operating Fee — 0.35% of the sale price',
  'FVF':            'Fixed per-order fee',
  'VAT':            'VAT on commission + ROF + FVF — 20%',
  'T.COM':          'Total eBay charges: commission + ROF + FVF + their VAT',
  'VAT 20%':        'VAT on the commission — 20%',
  'Commission VAT': "VAT on Temu's commission — 20%. Reclaimable, so it is NOT taken off profit",
  'Customer Care Fees': 'Back Market flat fee, charged on every unit',
  'Marketing':      'Promo spend you actually paid — typed in, never guessed',
  'M. VAT':         'VAT on the marketing spend — 20%',
  'Postage':        'What the COURIER charges you (not what the customer paid)',
  'P. VAT':         'VAT on the postage — 20%',
  'Accessories':    'The box and charger that ship with the phone — £1 per handset, £0 on an accessory sold alone',
  'Total VAT':      'The VAT lines added up',
  'GP':             'GROSS PROFIT — the margin less every fee, VAT, postage and the box',
  'GP %':           'Profit as a percentage of WHAT YOU PAID (changed 2026-08; was sale price on eBay only)',
  'Total VAT NTP':  'Net tax position — Marginal Tax less Total VAT',
  'Postage Loss':   'Carriage on a returned order — blank unless returned. See the RETURNS sheet',
  'Net GP £':       'Gross profit after the return carriage — same as GP unless returned',
};

/** Columns that are typed by a person, not calculated. Listed so the operator
 *  can see at a glance which figures the software is responsible for. */
const OPERATOR_ENTERED = new Set(['Date', 'Order Number', 'SKU', 'IMEI', 'Model', 'Colour',
  'Storage', 'Supplier', 'Quantity', 'Units', 'BP', 'SP', 'Postage', 'Marketing',
  'Return Date', 'Outcome', 'Return Reason', 'Comments', 'Shipping Legs']);

const HDR_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
const money = '£#,##0.00';

function rateNote(m: Marketplace): string {
  const f = getMarketplaceFee(m);
  const bits: string[] = [`Commission ${f.commissionPct}% of SP`];
  if (f.rofPct) bits.push(`ROF ${f.rofPct}%`);
  if (f.fixedFee) bits.push(`fixed fee £${f.fixedFee.toFixed(2)}`);
  if (f.customerCareFees) bits.push(`customer care £${f.customerCareFees.toFixed(2)} per unit`);
  bits.push('marginal tax 16.67%', 'VAT 20%', 'box + charger £1');
  return bits.join(' · ');
}

async function main() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Inventory Manager';

  // ── Cover ────────────────────────────────────────────────────────────────
  const cover = wb.addWorksheet('READ ME');
  cover.columns = [{ width: 110 }];
  const coverLines: Array<[string, boolean]> = [
    ['HOW EVERY FIGURE IS WORKED OUT', true],
    ['', false],
    ['One sheet per marketplace. Each row is a column on that marketplace\'s tab of the Sales Report.', false],
    ['', false],
    ['For each line you get:', true],
    ['   • the plain-English rule', false],
    ['   • the exact Excel formula the report writes', false],
    [`   • a worked example — the SAME phone on every sheet: paid £${BP}, sold £${SP}, postage £${POSTAGE.toFixed(2)}`, false],
    ['', false],
    ['Because the phone is identical on all five sheets, any difference in the profit', false],
    ['is caused by that marketplace\'s fees and nothing else. The five are directly comparable.', false],
    ['', false],
    ['PLEASE CHECK, AND TELL US WHERE WE ARE WRONG:', true],
    ['   1. Are the commission rates right for your account?', false],
    ['   2. Are the fixed fees right — and charged on EVERY order?', false],
    ['   3. Is anything charged that should not be, or missing that should be?', false],
    ['', false],
    ['This sheet is generated from the software itself, not typed by hand.', false],
    ['If you disagree with a line here, you disagree with what the app is doing —', false],
    ['which is exactly what we want to find out before it matters.', false],
  ];
  coverLines.forEach(([text, bold]) => {
    const r = cover.addRow([text]);
    r.font = { bold, size: bold ? 12 : 11 };
  });

  // ── One sheet per marketplace ────────────────────────────────────────────
  for (const m of MARKETPLACES) {
    const fin = calcSaleFinancials({
      marketplace: m, buyPrice: BP, salePrice: SP, quantity: 1, postageOverride: POSTAGE,
    } as never) as Record<string, number> | undefined;
    if (!fin) continue;
    const formulas = excelFormulaFor(m, 2) as unknown as Record<string, string>;

    const ws = wb.addWorksheet(m);
    ws.columns = [
      { header: 'Line', width: 20 },
      { header: 'What it means', width: 62 },
      { header: 'Excel formula', width: 34 },
      { header: `Worked example`, width: 16, style: { numFmt: money } },
      { header: 'Agree?', width: 12 },
    ];
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = HDR_FILL;

    const note = ws.addRow([`${m} — ${rateNote(m)}`]);
    note.font = { italic: true, size: 10, color: { argb: 'FF475569' } };
    ws.mergeCells(note.number, 1, note.number, 5);
    const inputs = ws.addRow([`Worked example: paid £${BP}, sold £${SP}, postage £${POSTAGE.toFixed(2)}`]);
    inputs.font = { italic: true, size: 10, color: { argb: 'FF475569' } };
    ws.mergeCells(inputs.number, 1, inputs.number, 5);
    ws.addRow([]);

    // Map report header -> the calculator field holding its value.
    const FIELD: Record<string, string> = {
      'SP-BP': 'spMinusBp', 'Marginal Tax': 'marginalTax', 'Commission': 'commission',
      'C. VAT': 'commissionVat', 'DSF': 'dsf', 'DSF. VAT': 'dsfVat', 'ROF': 'rof',
      'FVF': 'fvf', 'VAT': 'vat20', 'T.COM': 'totalCom', 'VAT 20%': 'vat20',
      'Commission VAT': 'commissionVat', 'Customer Care Fees': 'customerCareFees',
      'Marketing': 'marketing', 'M. VAT': 'marketingVat', 'Postage': 'postage',
      'P. VAT': 'postageVat', 'Accessories': 'accessoryFee', 'Total VAT': 'totalVat',
      'GP': 'grossProfit', 'GP %': 'gpPercent', 'Total VAT NTP': 'totalVatNtp',
    };
    // Report header -> the excelFormulaFor key that produces it.
    const FKEY: Record<string, string> = {
      'SP-BP': 'spMinusBp', 'Marginal Tax': 'marginalTax', 'Commission': 'commission',
      'C. VAT': 'commissionVat', 'DSF': 'dsf', 'DSF. VAT': 'dsfVat', 'ROF': 'rof',
      'FVF': 'fvf', 'VAT': 'vat20', 'T.COM': 'totalCom', 'VAT 20%': 'vat20',
      'Commission VAT': 'commissionVat', 'Customer Care Fees': 'customerCareFees',
      'M. VAT': 'marketingVat', 'P. VAT': 'postageVat', 'Accessories': 'accessoryFee',
      'Total VAT': 'totalVat', 'GP': 'grossProfit', 'GP %': 'gpPercent',
      'Total VAT NTP': 'totalVatNtp',
    };

    for (const header of SALES_HEADERS[m] as readonly string[]) {
      if (OPERATOR_ENTERED.has(header) && !FIELD[header]) continue;
      if (!RULE[header]) continue;
      const value = FIELD[header] ? fin[FIELD[header]] : undefined;
      const formula = FKEY[header] ? formulas[FKEY[header]] : '';
      const typed = OPERATOR_ENTERED.has(header);
      const row = ws.addRow([
        header,
        RULE[header] + (typed ? '   (you type this one in)' : ''),
        typed ? '— typed, not calculated' : (formula ? `=${formula}` : '—'),
        typeof value === 'number' ? value : null,
        '',
      ]);
      if (header === 'GP' || header === 'GP %') {
        row.font = { bold: true };
        row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECFDF5' } };
      }
      if (header === 'GP %') row.getCell(4).numFmt = '0.00"%"';
      row.getCell(3).font = { name: 'Consolas', size: 10 };
      row.getCell(5).border = { bottom: { style: 'hair' } };
    }

    ws.addRow([]);
    const foot = ws.addRow([
      'Bottom line',
      `On this phone ${m} leaves you £${(fin.grossProfit ?? 0).toFixed(2)}, which is ${(fin.gpPercent ?? 0).toFixed(2)}% of the £${BP} you paid.`,
    ]);
    foot.font = { bold: true };
    ws.mergeCells(foot.number, 2, foot.number, 5);
  }

  // ── Returns ──────────────────────────────────────────────────────────────
  // Included because this is where most of the 2026-08 changes landed, and a
  // return costs more than the carriage everyone thinks of.
  const ret = wb.addWorksheet('RETURNS');
  ret.columns = [{ width: 30 }, { width: 76 }];
  const R = (a: string, b = '', bold = false) => {
    const r = ret.addRow([a, b]);
    if (bold) r.font = { bold: true };
    return r;
  };
  R('WHAT A RETURN COSTS', '', true);
  R('');
  R('Carriage', 'Each journey costs postage + its VAT. How many you are billed for:');
  R('');
  const legHdr = ret.addRow(['Route', 'Journeys the parcel makes', 'Billed to the return', 'Why']);
  legHdr.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  legHdr.fill = HDR_FILL;
  ([
    ['Refund', '2 — out, and back', '2', 'The sale is reversed, so it pays for none of them'],
    ['Repair inside 30 days', '2 — out, and back', '2', 'Treated as a refund: money returned, phone stays here'],
    ['Repair after 30 days', '3 — out, back, out again mended', '2', 'The sale keeps its money, so it is still paying for the first journey'],
    ['Replacement', '3 — out, faulty back, new one out', '2', 'Same reason: the first journey is already inside the sale'],
    ['Accessory return', '2 or 3', 'all of them', 'The sale is reversed outright, so nothing else is paying'],
  ] as string[][]).forEach(r => ret.addRow(r));
  ret.getColumn(2).width = 34; ret.getColumn(3).width = 20; ret.getColumn(4).width = 58;
  R('');
  R('IMPORTANT', 'A replacement ships THREE times but is billed TWO. The first journey was paid', true);
  R('', 'when the phone was sold and is already inside that sale\'s postage. Billing three');
  R('', 'here charged you four journeys for three. Corrected 2026-08.');
  R('');
  R('Repair invoice', 'Added to the return when you enter it. Flagged as outstanding until you do —');
  R('', 'an un-entered invoice is never counted as £0.');
  R('Supplier credit', 'Subtracted from the return cost when it lands. A return can end up positive.');
  R('Second handset', 'NOT charged on a replacement. The faulty one comes back, so your stock is');
  R('', 'unchanged — only the journeys are consumed.');
  R('Written-off phone', 'Never happens, per your answer. Nothing is booked as a total loss.');
  R('');
  R('THE WARRANTY RULE', '', true);
  R('Within 30 days', 'Full refund. The sale is reversed and keeps no profit.');
  R('After 30 days', 'Free repair or replacement, but the money stays paid — so the sale keeps its profit.');
  R('');
  R('Marketplace commission', 'Currently NOT credited back on a refund, per your decision. Four of the five');
  R('', 'marketplaces do publish a policy of returning it, so this understates your profit');
  R('', 'rather than overstating it. Reopen if refunds grow.');

  // ── Side-by-side comparison ──────────────────────────────────────────────
  const cmp = wb.addWorksheet('COMPARE THE FIVE');
  cmp.columns = [
    { header: 'Marketplace', width: 16 },
    { header: 'Total fees', width: 14, style: { numFmt: money } },
    { header: 'You keep (GP)', width: 15, style: { numFmt: money } },
    { header: 'GP %', width: 10, style: { numFmt: '0.00"%"' } },
    { header: 'Least you must add to break even', width: 32, style: { numFmt: money } },
  ];
  cmp.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  cmp.getRow(1).fill = HDR_FILL;

  const breakEven = (m: Marketplace) => {
    let lo = BP, hi = BP * 4 + 200;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      const r = calcSaleFinancials({
        marketplace: m, buyPrice: BP, salePrice: mid, quantity: 1, postageOverride: POSTAGE,
      } as never) as Record<string, number> | undefined;
      if ((r?.grossProfit ?? 0) >= 0) hi = mid; else lo = mid;
    }
    return hi - BP;
  };

  for (const m of MARKETPLACES) {
    const fin = calcSaleFinancials({
      marketplace: m, buyPrice: BP, salePrice: SP, quantity: 1, postageOverride: POSTAGE,
    } as never) as Record<string, number> | undefined;
    if (!fin) continue;
    cmp.addRow([m, (SP - BP) - (fin.grossProfit ?? 0), fin.grossProfit, fin.gpPercent, breakEven(m)]);
  }
  cmp.addRow([]);
  const cn = cmp.addRow([
    `Same phone every time — paid £${BP}, sold £${SP}. The differences are purely each marketplace's fees.`,
  ]);
  cn.font = { italic: true, size: 10, color: { argb: 'FF475569' } };
  cmp.mergeCells(cn.number, 1, cn.number, 5);

  await wb.xlsx.writeFile('FORMULAS_TO_CONFIRM.xlsx');
  console.log('FORMULAS_TO_CONFIRM.xlsx written');
  for (const m of MARKETPLACES) {
    const fin = calcSaleFinancials({
      marketplace: m, buyPrice: BP, salePrice: SP, quantity: 1, postageOverride: POSTAGE,
    } as never) as Record<string, number> | undefined;
    console.log(`   ${m.padEnd(7)} fees £${((SP - BP) - (fin?.grossProfit ?? 0)).toFixed(2).padStart(6)}   GP £${(fin?.grossProfit ?? 0).toFixed(2).padStart(6)}   ${(fin?.gpPercent ?? 0).toFixed(2).padStart(6)}%   break-even +£${breakEven(m).toFixed(0)}`);
  }
}
main();
