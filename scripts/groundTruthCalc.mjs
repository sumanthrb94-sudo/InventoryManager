/**
 * scripts/groundTruthCalc.mjs — independent re-derivation of GP/VAT/stock
 * ground truth for the quarter simulation. Deliberately does NOT import
 * src/lib/platforms.ts or src/lib/vat.ts — every formula here is
 * hand-transcribed from those files' current DOCUMENTED behaviour (verified
 * by direct `calcSaleFinancials` calls via tsx while writing this), so a
 * real regression in the app's own formula still shows up as a mismatch
 * against this independent copy, rather than the check trivially agreeing
 * with itself.
 *
 * Keeping the two in step is NOT left to whoever edits the schedule next.
 * src/__tests__/lib/groundTruthParity.test.ts calls both implementations over
 * a grid of prices and fails naming the marketplace and the field the moment
 * they disagree. That guard exists because this file went stale by three fee
 * changes and the simulation then reported live-versus-truth GP mismatches on
 * Back Market, eBay and Temu — which reads exactly like a calculation defect
 * in the software, and was not one. Independence is worth keeping; silent
 * drift is not.
 *
 * Formulas current as of 2026-08 (src/lib/platforms.ts DEFAULT_MARKETPLACE_FEES
 * + calcSaleFinancials):
 *   AMAZON: commission = SP*7%, marginalTax = (SP-BP)*16.67%, C.VAT/DSF/DSF.VAT
 *           chain off commission, totalVat = C.VAT+DSF.VAT+P.VAT, accessoryFee=£1
 *   BM:     commission = SP*11%, customerCareFees = £8.99 flat, psf = SP*1%
 *           (Payment Seller Fee, new 2026-08-14 — charged whatever the payment
 *           mode, and NOT a VAT line), NO PayPal/Klarna adjustment
 *           (intentionally dropped in the 2026-05 schema rewrite — see
 *           platforms.ts's own comment "No PayPal/Klarna commission any
 *           more — drop the field"), totalVat = P.VAT only, accessoryFee=£1
 *   EBAY:   commission = SP*6.21%, rof = SP*0.35%, fvf = £0.40 flat,
 *           marketing = £0 unless the operator enters one, P.VAT = £0 unless
 *           the file carries one (eBay shipping is zero-rated to this
 *           operator — the master's P. VAT column reads 0 on all 33 rows
 *           despite £4.65 of postage), totalVat = VAT+P.VAT+M.VAT,
 *           gpPercent divides by SP (not BP), accessoryFee=£1
 *   ONBUY:  commission = SP*7%, vat20 = commission*20%, totalVat = vat20+P.VAT,
 *           no Quantity column at all, accessoryFee=£1
 *   TEMU:   commission = SP*3.96% (2026-08-14 — the client's report computes
 *           every row as =H2*3.96%), marginalTax = (SP-BP)*16.67%,
 *           totalVat = P.VAT only (Commission VAT tracked but excluded, and
 *           Commission+VAT is display only), no DSF, accessoryFee=£1
 * All 5 marketplaces: postage defaults to £0 unless the file supplies one
 * (this simulation's generated files carry no Postage column, so every
 * sale uses the £0 default — confirmed via getMarketplaceFee's own comments).
 */

const r2 = n => Math.round(n * 100) / 100;

export function calcFinancials(marketplace, bp, sp, postage = 0) {
  const spMinusBp = r2(sp - bp);
  switch (marketplace) {
    case 'AMAZON': {
      const marginalTax = spMinusBp * 16.67 / 100;
      const commission = sp * 7 / 100;
      const commissionVat = commission * 0.20;
      const dsf = commission * 0.02;
      const dsfVat = dsf * 0.20;
      const postageVat = postage * 0.20;
      const accessoryFee = 1;
      const totalVat = commissionVat + dsfVat + postageVat;
      const grossProfit = spMinusBp - marginalTax - commission - commissionVat
        - dsf - dsfVat - postage - postageVat - accessoryFee;
      return { spMinusBp, marginalTax: r2(marginalTax), commission: r2(commission), totalVat: r2(totalVat), postage, grossProfit: r2(grossProfit) };
    }
    case 'TEMU': {
      const marginalTax = spMinusBp * 16.67 / 100;
      const commission = sp * 3.96 / 100; // 2026-08-14 rate, from the client's report
      const postageVat = postage * 0.20;
      const accessoryFee = 1;
      const totalVat = postageVat; // commission VAT excluded from totalVat/GP
      const grossProfit = spMinusBp - marginalTax - commission - postage - postageVat - accessoryFee;
      return { spMinusBp, marginalTax: r2(marginalTax), commission: r2(commission), totalVat: r2(totalVat), postage, grossProfit: r2(grossProfit) };
    }
    case 'BM': {
      const marginalTax = spMinusBp * 16.67 / 100;
      const commission = sp * 11 / 100;
      const customerCareFees = 8.99;
      const psf = sp * 1 / 100;   // Payment Seller Fee, 2026-08-14
      const postageVat = postage * 0.20;
      const accessoryFee = 1;
      const totalVat = postageVat; // BM's only VAT line — PSF is a charge, not a tax
      const grossProfit = spMinusBp - marginalTax - commission - customerCareFees - psf - postage - postageVat - accessoryFee;
      return { spMinusBp, marginalTax: r2(marginalTax), commission: r2(commission), totalVat: r2(totalVat), postage, grossProfit: r2(grossProfit) };
    }
    case 'EBAY': {
      const marginalTax = spMinusBp * 16.67 / 100;
      const commission = sp * 6.21 / 100;
      const rof = sp * 0.35 / 100;
      const fvf = 0.40;
      const vat = (commission + rof + fvf) * 0.20;
      const tCom = commission + rof + fvf + vat;
      // eBay alone does not derive either of these. Postage is zero-rated to
      // this operator and marketing is a hand-typed spend, £0 on most rows —
      // deriving them charged £0.93 and ~£2.80 of GP against every eBay sale
      // that never incurred them.
      const postageVat = 0;
      const marketing = 0;
      const marketingVat = marketing * 0.20;
      const accessoryFee = 1;
      const totalVat = vat + postageVat + marketingVat;
      const grossProfit = spMinusBp - marginalTax - tCom - postage - postageVat - marketing - marketingVat - accessoryFee;
      return { spMinusBp, marginalTax: r2(marginalTax), commission: r2(tCom), totalVat: r2(totalVat), postage, grossProfit: r2(grossProfit) };
    }
    case 'ONBUY': {
      const marginalTax = spMinusBp * 16.67 / 100;
      const commission = sp * 7 / 100;
      const vat20 = commission * 0.20;
      const postageVat = postage * 0.20;
      const accessoryFee = 1;
      const totalVat = vat20 + postageVat;
      const grossProfit = spMinusBp - marginalTax - commission - vat20 - postage - postageVat - accessoryFee;
      return { spMinusBp, marginalTax: r2(marginalTax), commission: r2(commission), totalVat: r2(totalVat), postage, grossProfit: r2(grossProfit) };
    }
    default:
      throw new Error(`Unknown marketplace: ${marketplace}`);
  }
}

/** Calendar quarter of an ISO date — same boundary rule as vat.ts's vatPeriodOf. */
export function quarterKeyOf(isoDate) {
  const [y, m] = isoDate.split('-').map(Number);
  const q = Math.floor((m - 1) / 3) + 1;
  return `${y}-Q${q}`;
}

/**
 * Compute the full ground-truth picture from the generator's manifest,
 * BEFORE any live returns are processed (that's checked separately, per
 * return, directly in the E2E script — see generateQuarterSimData.mjs's
 * header comment for why baked-in bulk returns aren't modelled here).
 */
export function computeGroundTruth(manifest) {
  const allSales = [...manifest.sales, ...manifest.accessorySales];

  let totalRevenue = 0, totalCost = 0, totalGP = 0;
  const byMarketplace = {};
  const byQuarter = new Map(); // key -> { marginVatAsComputed, inputVat, totalSales, totalCost, totalMargin, count }

  for (const s of allSales) {
    const fin = calcFinancials(s.marketplace, s.bp, s.sp, 0);
    totalRevenue += s.sp;
    totalCost += s.bp;
    totalGP += fin.grossProfit;

    const mp = byMarketplace[s.marketplace] ?? { revenue: 0, cost: 0, gp: 0, count: 0 };
    mp.revenue += s.sp; mp.cost += s.bp; mp.gp += fin.grossProfit; mp.count += 1;
    byMarketplace[s.marketplace] = mp;

    const qKey = quarterKeyOf(s.saleDate);
    const q = byQuarter.get(qKey) ?? { marginVatAsComputed: 0, inputVat: 0, totalSales: 0, totalCost: 0, totalMargin: 0, count: 0 };
    const margin = s.sp - s.bp;
    q.marginVatAsComputed += fin.marginalTax;
    q.inputVat += fin.totalVat;
    q.totalSales += s.sp;
    q.totalCost += s.bp;
    q.totalMargin += margin;
    q.count += 1;
    byQuarter.set(qKey, q);
  }

  const vatPeriods = Array.from(byQuarter.entries()).map(([key, v]) => ({
    key,
    saleCount: v.count,
    marginVatAsComputed: r2(v.marginVatAsComputed),
    inputVat: r2(v.inputVat),
    netPayableAsComputed: r2(v.marginVatAsComputed - v.inputVat),
    totalSales: r2(v.totalSales),
    totalCost: r2(v.totalCost),
    totalMargin: r2(v.totalMargin),
  })).sort((a, b) => b.key.localeCompare(a.key));

  const officeSold = manifest.officeUnits.filter(u => u.sold).length;
  const shsSold = manifest.shsUnits.filter(u => u.sold).length;
  const officeAvailable = manifest.officeUnits.length - officeSold;
  const shsAvailable = manifest.shsUnits.length - shsSold;

  const accessorySoldBySku = {};
  for (const s of manifest.accessorySales) {
    accessorySoldBySku[s.sku] = (accessorySoldBySku[s.sku] || 0) + s.quantity;
  }
  const accessoryAddedBySku = {};
  for (const t of manifest.accessoryTopups) {
    accessoryAddedBySku[t.sku] = (accessoryAddedBySku[t.sku] || 0) + t.qty;
  }
  const accessoryStockLevels = manifest.accessories.map(a => ({
    sku: a.sku,
    totalAdded: accessoryAddedBySku[a.sku] || 0,
    sold: accessorySoldBySku[a.sku] || 0,
    remaining: (accessoryAddedBySku[a.sku] || 0) - (accessorySoldBySku[a.sku] || 0),
  }));

  return {
    totalRevenue: r2(totalRevenue), totalCost: r2(totalCost), totalGP: r2(totalGP),
    byMarketplace: Object.fromEntries(Object.entries(byMarketplace).map(([k, v]) => [k, {
      revenue: r2(v.revenue), cost: r2(v.cost), gp: r2(v.gp), count: v.count,
    }])),
    vatPeriods,
    stock: {
      officeIntake: manifest.officeUnits.length, officeSold, officeAvailable,
      shsIntake: manifest.shsUnits.length, shsSold, shsAvailable,
      accessoryStockLevels,
    },
  };
}
