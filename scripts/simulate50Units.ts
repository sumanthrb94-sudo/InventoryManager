/**
 * Fifty units, twenty returns, every return scenario the app supports.
 *
 * WHAT THIS IS FOR
 *
 * The operator wants to check the numbers by hand. That only means anything
 * if the numbers here come from the SAME code the application runs, so this
 * script imports the production functions rather than re-deriving anything:
 *
 *   calcSaleFinancials      every fee, VAT line and GP on every sale
 *   processReturnSalePatch  what a return writes to the sale (incl. whether
 *                           the customer was refunded, from the 30-day rule)
 *   buildReturningUnitPatch what a return writes to the unit
 *   returnCostFor           what the return actually cost
 *   buildSalesWorkbookBuffer the Sales Report itself
 *
 * A simulation that reimplemented the maths would agree with itself and prove
 * nothing. The two patch builders are the same ones returnsService applies
 * inside its transaction — they are exported precisely so callers can use the
 * real thing — so the state transitions below are the production ones, minus
 * the Firestore round-trip.
 *
 * OUTPUT
 *   SIMULATION_SALES_REPORT.xlsx   the real report, for manual checking
 *   simulation-manifest.json       every unit's journey + the expected money
 *
 * Run:  npx tsx scripts/simulate50Units.ts
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { calcSaleFinancials } from '../src/lib/platforms';
import { processReturnSalePatch } from '../src/lib/processReturnSalePatch';
import { buildReturningUnitPatch } from '../src/services/returnsService';
import { returnCostFor } from '../src/lib/returnLoss';
import { buildSalesWorkbookBuffer } from '../src/lib/clientReport';
import type { InventoryUnit, Sale, Marketplace } from '../src/types';

const OUT = resolve('simulation-output');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

// ── Catalogue ────────────────────────────────────────────────────────────────
// Deliberately a small model set with several units per model: a replacement
// needs a like-for-like handset on the shelf, and scenario 14 needs one model
// where there is deliberately NO spare.
const MODELS = [
  { brand: 'Apple',   model: 'iPhone 13',        storage: '128GB', bp: 300, sp: 415 },
  { brand: 'Apple',   model: 'iPhone 14',        storage: '256GB', bp: 430, sp: 585 },
  { brand: 'Apple',   model: 'iPhone 12',        storage: '64GB',  bp: 210, sp: 300 },
  { brand: 'Samsung', model: 'Galaxy S22',       storage: '128GB', bp: 250, sp: 350 },
  { brand: 'Samsung', model: 'Galaxy S21 FE',    storage: '128GB', bp: 180, sp: 258 },
  { brand: 'Apple',   model: 'iPhone 15 Pro',    storage: '256GB', bp: 720, sp: 940 },
];
const MARKETPLACES: Marketplace[] = ['AMAZON', 'BM', 'EBAY', 'ONBUY', 'TEMU'];
const SUPPLIERS = [
  { id: 'sup-1', name: 'MOBILE WHOLESALE LTD' },
  { id: 'sup-2', name: 'PHONEBOX DIRECT' },
  { id: 'sup-3', name: 'CELLTECH TRADING' },
];

/** Deterministic — the operator must be able to re-run this and get the same
 *  workbook, or "check it by hand" is meaningless. */
let seed = 20260807;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

const START = '2026-06-01';

// ── 1 · Fifty units into inventory ───────────────────────────────────────────
const units: InventoryUnit[] = [];
for (let i = 0; i < 50; i++) {
  // Cycle the catalogue so every model gets 8-9 units — enough spare stock for
  // the replacement scenarios, except the model reserved for scenario 14.
  const m = MODELS[i % MODELS.length];
  const sup = SUPPLIERS[i % SUPPLIERS.length];
  units.push({
    id: `u-${String(i + 1).padStart(3, '0')}`,
    imei: `35100000000${String(i + 1).padStart(4, '0')}`,
    model: m.model, brand: m.brand, storage: m.storage,
    category: m.brand === 'Apple' ? 'iPhone' : 'Samsung S Series',
    colour: pick(['Black', 'Blue', 'Silver', 'Graphite']),
    grade: pick(['A', 'A', 'B']),
    buyPrice: m.bp,
    dateIn: addDays(START, Math.floor(rnd() * 20)),
    supplierId: sup.id, supplierName: sup.name,
    status: 'available', flags: [], notes: '', platformListed: true,
    stockSource: 'office', stockLocation: 'office',
    ownerId: 'shared',
  } as InventoryUnit);
}

// ── 2 · Sell them ────────────────────────────────────────────────────────────
// Units 1-40 sell. 41-50 stay on the shelf as replacement stock and to prove
// the intake side is untouched by any of this.
const sales: Sale[] = [];
const SOLD_COUNT = 40;

/** Postage the operator would have entered on the sale.
 *
 *  The fee schedule defaults postage to 0 for every marketplace — it is a
 *  per-sale figure the operator types from the carrier's charge, not a rate.
 *  Leaving it at the default made every simulated return cost £0 of carriage,
 *  which is the one number that should never be zero. eBay is the exception:
 *  it has explicit shipping tiers, so tier 8 is passed as a tier. */
function postageFor(marketplace: Marketplace, i: number): { postageOverride?: number; eBayShippingTier?: 1 | 2 | 8 } {
  if (marketplace === 'EBAY') return { eBayShippingTier: ([1, 2, 8] as const)[i % 3] };
  return { postageOverride: 8 };
}

function sell(u: InventoryUnit, marketplace: Marketplace, saleDate: string, sp: number, i: number): Sale {
  const f = calcSaleFinancials({
    marketplace, buyPrice: u.buyPrice, salePrice: sp, ...postageFor(marketplace, i),
  });
  const sale = {
    id: `s-${u.id}`,
    unitId: u.id,
    imei: u.imei,
    marketplace,
    sku: `${u.model} ${u.storage}`,
    model: u.model,
    storage: u.storage,
    colour: u.colour,
    orderNumber: `ORD-${u.id.slice(-3)}`,
    saleDate,
    buyPrice: u.buyPrice,
    salePrice: sp,
    supplierName: u.supplierName,
    ...f,
    ownerId: 'shared',
    importBatchId: 'sim', sourceFile: 'simulation', sourceRow: 0,
  } as unknown as Sale;
  u.status = 'sold';
  u.salePrice = sp;
  u.saleDate = saleDate;
  u.salePlatform = marketplace;
  u.saleOrderId = sale.orderNumber;
  u.postageCost = (f as any).postage;
  return sale;
}

for (let i = 0; i < SOLD_COUNT; i++) {
  const u = units[i];
  const m = MODELS[i % MODELS.length];
  const marketplace = MARKETPLACES[i % MARKETPLACES.length];
  // Spread sale dates so the 30-day warranty boundary can be exercised.
  const saleDate = addDays(START, 20 + Math.floor(i * 1.5));
  const sp = m.sp + Math.round((rnd() - 0.5) * 30);   // a little price spread
  sales.push(sell(u, marketplace, saleDate, sp, i));
}

// ── 3 · Twenty returns, one per named scenario ───────────────────────────────
type Journey = {
  n: number;
  scenario: string;
  unitId: string;
  imei: string;
  model: string;
  marketplace: string;
  bp: number;
  sp: number;
  saleDate: string;
  returnDate: string;
  daysAfterSale: number;
  route: string;
  destination: string;
  legs: number;
  legCost: number;
  carriage: number;
  otherCost: number;
  supplierCredit: number;
  totalCost: number;
  saleStillCounts: boolean;
  awaiting: string;
  endStatus: string;
  note: string;
};
const journeys: Journey[] = [];
const byId = new Map(units.map(u => [u.id, u]));
const saleFor = (unitId: string) => sales.find(s => (s as any).unitId === unitId)!;

/** Apply a return exactly as returnsService does: the same two patch builders,
 *  in the same order, with the leg cost derived the same way. */
function applyReturn(opts: {
  n: number;
  scenario: string;
  unitId: string;
  destination: 'returned_to_inventory' | 'repair' | 'returned_to_supplier';
  outcome: 'refund' | 'replacement' | null;
  daysAfterSale: number;
  reason: string;
  replacementUnitId?: string;
  repairCost?: number;
  supplierCredit?: number;
  note?: string;
}) {
  const u = byId.get(opts.unitId)!;
  const sale = saleFor(opts.unitId);
  const returnDate = addDays(u.saleDate!, opts.daysAfterSale);

  const postage = Number((sale as any).postage) || 0;
  const pVat = (sale as any).postageVatExempt ? 0 : (Number((sale as any).postageVat) || postage * 0.2);
  const legCost = postage + pVat;

  const replacementUnit = opts.replacementUnitId ? byId.get(opts.replacementUnitId) : undefined;

  const salePatch = processReturnSalePatch({
    returnType: opts.destination,
    outcome: opts.outcome ?? 'refund',
    returnDate,
    reason: opts.reason,
    saleDate: u.saleDate,
  });
  Object.assign(sale as any, salePatch);

  const unitPatch = buildReturningUnitPatch(
    u, opts.destination, returnDate, opts.reason,
    opts.destination === 'repair' ? null : opts.outcome,
    legCost, undefined, undefined, replacementUnit,
  );
  Object.assign(u, unitPatch);

  // Post-return entries the operator makes later.
  if (opts.repairCost !== undefined) {
    u.repairCost = opts.repairCost;
    u.status = 'available';
    u.repairedAt = addDays(returnDate, 5);
    u.flags = [...(u.flags ?? []), 'repaired_unit'];
  }
  if (opts.supplierCredit !== undefined) {
    u.supplierCreditAmount = opts.supplierCredit;
    u.supplierCreditDate = returnDate;
    u.supplierCreditType = 'credit';
  }
  if (replacementUnit) {
    replacementUnit.status = 'sold';
    replacementUnit.salePrice = u.salePrice ?? (sale as any).salePrice;
    replacementUnit.saleDate = returnDate;
    replacementUnit.salePlatform = (sale as any).marketplace;
    replacementUnit.replacementForUnitId = u.id;
  }

  const cost = returnCostFor(u, sale as any);
  journeys.push({
    n: opts.n,
    scenario: opts.scenario,
    unitId: u.id,
    imei: u.imei,
    model: `${u.model} ${u.storage}`,
    marketplace: String((sale as any).marketplace),
    bp: u.buyPrice,
    sp: Number((sale as any).salePrice),
    saleDate: String((sale as any).saleDate),
    returnDate,
    daysAfterSale: opts.daysAfterSale,
    route: String((sale as any).voidOutcome),
    destination: opts.destination,
    legs: opts.outcome === 'replacement' ? 3 : 2,
    legCost: Number(legCost.toFixed(2)),
    carriage: Number(cost.postage.toFixed(2)),
    otherCost: Number(cost.repair.toFixed(2)),
    supplierCredit: Number(cost.supplierCredit.toFixed(2)),
    totalCost: Number(cost.total.toFixed(2)),
    saleStillCounts: (sale as any).customerRefunded === false,
    awaiting: cost.gaps.join(', '),
    endStatus: String(u.status),
    note: opts.note ?? '',
  });
}

/** A spare, unsold, like-for-like handset — what a replacement needs. */
function spareFor(unitId: string): string | undefined {
  const u = byId.get(unitId)!;
  const spare = units.find(x =>
    x.status === 'available' && x.id !== u.id
    && x.brand === u.brand && x.model === u.model && x.storage === u.storage);
  return spare?.id;
}

// ── The twenty scenarios ─────────────────────────────────────────────────────
// Refunds across every marketplace, so each fee schedule is exercised.
applyReturn({ n: 1,  scenario: 'Refund · Amazon',          unitId: 'u-001', destination: 'returned_to_inventory', outcome: 'refund', daysAfterSale: 6,  reason: 'Customer changed mind' });
applyReturn({ n: 2,  scenario: 'Refund · BM',              unitId: 'u-002', destination: 'returned_to_inventory', outcome: 'refund', daysAfterSale: 9,  reason: 'Not as described' });
applyReturn({ n: 3,  scenario: 'Refund · eBay',            unitId: 'u-003', destination: 'returned_to_inventory', outcome: 'refund', daysAfterSale: 4,  reason: 'Battery health below 85%' });
applyReturn({ n: 4,  scenario: 'Refund · OnBuy',           unitId: 'u-004', destination: 'returned_to_inventory', outcome: 'refund', daysAfterSale: 12, reason: 'Arrived damaged' });
applyReturn({ n: 5,  scenario: 'Refund · Temu',            unitId: 'u-005', destination: 'returned_to_inventory', outcome: 'refund', daysAfterSale: 3,  reason: 'Customer changed mind' });

// Repairs on both sides of the 30-day warranty line.
applyReturn({ n: 6,  scenario: 'Repair ≤30d · invoiced',   unitId: 'u-006', destination: 'repair', outcome: null, daysAfterSale: 11, reason: 'Cracked screen', repairCost: 64.50,
  note: 'Inside warranty → refunded, revenue reverses' });
applyReturn({ n: 7,  scenario: 'Repair ≤30d · invoiced',   unitId: 'u-007', destination: 'repair', outcome: null, daysAfterSale: 22, reason: 'Speaker fault',  repairCost: 38.00 });
applyReturn({ n: 8,  scenario: 'Repair ≤30d · NO invoice', unitId: 'u-008', destination: 'repair', outcome: null, daysAfterSale: 15, reason: 'Charging port',
  note: 'Invoice not yet entered → shows AWAITING, total is a floor' });
applyReturn({ n: 9,  scenario: 'Repair >30d · invoiced',   unitId: 'u-009', destination: 'repair', outcome: null, daysAfterSale: 45, reason: 'Screen flicker', repairCost: 72.00,
  note: 'Outside warranty → free repair, NO refund, sale still counts' });
applyReturn({ n: 10, scenario: 'Repair >30d · invoiced',   unitId: 'u-010', destination: 'repair', outcome: null, daysAfterSale: 61, reason: 'Camera fault',   repairCost: 95.00,
  note: 'Outside warranty → sale still counts' });
applyReturn({ n: 11, scenario: 'Repair · day 30 exactly',  unitId: 'u-011', destination: 'repair', outcome: null, daysAfterSale: 30, reason: 'Battery swelling', repairCost: 45.00,
  note: 'Boundary: day 30 is INSIDE the window → refunded' });
applyReturn({ n: 12, scenario: 'Repair · day 31 exactly',  unitId: 'u-012', destination: 'repair', outcome: null, daysAfterSale: 31, reason: 'Battery swelling', repairCost: 45.00,
  note: 'Boundary: day 31 is OUTSIDE → sale still counts' });

// Replacements — three legs, no handset charge, faulty unit returns to stock.
applyReturn({ n: 13, scenario: 'Replacement · stock avail', unitId: 'u-013', destination: 'returned_to_inventory', outcome: 'replacement', daysAfterSale: 8,  reason: 'Faulty — replaced', replacementUnitId: spareFor('u-013'),
  note: 'Customer keeps what they paid → sale still counts' });
applyReturn({ n: 14, scenario: 'Replacement · stock avail', unitId: 'u-014', destination: 'returned_to_inventory', outcome: 'replacement', daysAfterSale: 17, reason: 'Dead pixels',       replacementUnitId: spareFor('u-014') });
applyReturn({ n: 15, scenario: 'Replacement · stock avail', unitId: 'u-015', destination: 'returned_to_inventory', outcome: 'replacement', daysAfterSale: 25, reason: 'Face ID failure',   replacementUnitId: spareFor('u-015') });

// The no-stock case: the app refuses a replacement, so it becomes a refund.
applyReturn({ n: 16, scenario: 'Replacement · NO stock → refund', unitId: 'u-016', destination: 'returned_to_inventory', outcome: 'refund', daysAfterSale: 10, reason: 'Faulty — no matching stock, refunded',
  note: 'No like-for-like handset available → refund, 2 legs not 3' });

// Supplier returns, settled and unsettled.
applyReturn({ n: 17, scenario: 'To supplier · credited',   unitId: 'u-017', destination: 'returned_to_supplier', outcome: 'refund', daysAfterSale: 5,  reason: 'DOA — back to supplier', supplierCredit: 210,
  note: 'Full credit received same day' });
applyReturn({ n: 18, scenario: 'To supplier · credited',   unitId: 'u-018', destination: 'returned_to_supplier', outcome: 'refund', daysAfterSale: 7,  reason: 'Wrong model shipped',    supplierCredit: 430 });
applyReturn({ n: 19, scenario: 'To supplier · credit due', unitId: 'u-019', destination: 'returned_to_supplier', outcome: 'refund', daysAfterSale: 13, reason: 'Fails network lock check',
  note: 'Credit not yet booked → shows AWAITING' });
// Zero-rated shipping: the leg is the postage alone, with no P.VAT on top.
// Flagged on the sale BEFORE the return so the leg cost snapshot picks it up.
(saleFor('u-020') as any).postageVatExempt = true;
(saleFor('u-020') as any).postageVat = 0;
applyReturn({ n: 20, scenario: 'Refund · postage VAT exempt', unitId: 'u-020', destination: 'returned_to_inventory', outcome: 'refund', daysAfterSale: 14, reason: 'Zero-rated shipping return',
  note: 'Zero-rated shipping → leg is postage only, no P.VAT: £8.00 not £9.60' });

// ── 4 · Emit the Sales Report and the manifest ───────────────────────────────
const supplierMap = Object.fromEntries(SUPPLIERS.map(s => [s.id, s.name]));

const totals = journeys.reduce((a, j) => ({
  carriage: a.carriage + j.carriage,
  other: a.other + j.otherCost,
  credit: a.credit + j.supplierCredit,
  total: a.total + j.totalCost,
}), { carriage: 0, other: 0, credit: 0, total: 0 });

const manifest = {
  generated: '2026-08-07',
  seed: 20260807,
  counts: {
    unitsCreated: units.length,
    unitsSold: SOLD_COUNT,
    unitsNeverSold: units.length - SOLD_COUNT,
    returns: journeys.length,
    salesStillCounting: sales.filter(s => !(s as any).voidedAt || (s as any).customerRefunded === false).length,
  },
  returnTotals: {
    carriage: Number(totals.carriage.toFixed(2)),
    repairInvoices: Number(totals.other.toFixed(2)),
    supplierCredits: Number(totals.credit.toFixed(2)),
    netCost: Number(totals.total.toFixed(2)),
    awaitingCount: journeys.filter(j => j.awaiting).length,
  },
  units: units.map(u => ({
    id: u.id, imei: u.imei, model: `${u.model} ${u.storage}`, colour: u.colour,
    grade: u.grade, bp: u.buyPrice, supplier: u.supplierName, dateIn: u.dateIn,
    status: u.status, marketplace: u.salePlatform ?? '', sp: u.salePrice ?? '',
    saleDate: u.saleDate ?? '', returnType: u.returnType ?? '',
    repairCost: u.repairCost ?? '', supplierCredit: u.supplierCreditAmount ?? '',
    replacedBy: u.replacedByUnitId ?? '', replacementFor: u.replacementForUnitId ?? '',
  })),
  sales: sales.map(s => {
    const a = s as any;
    return {
      id: a.id, unitId: a.unitId, imei: a.imei, marketplace: a.marketplace,
      order: a.orderNumber, saleDate: a.saleDate, bp: a.buyPrice, sp: a.salePrice,
      commission: a.commission ?? '', totalVat: a.totalVat ?? '', postage: a.postage ?? '',
      grossProfit: a.grossProfit, gpPercent: a.gpPercent,
      voided: !!a.voidedAt, voidOutcome: a.voidOutcome ?? '',
      customerRefunded: a.customerRefunded ?? '', gpBasis: a.gpBasis ?? '',
    };
  }),
  journeys,
};

writeFileSync(resolve(OUT, 'simulation-manifest.json'), JSON.stringify(manifest, null, 2));

const buf = await buildSalesWorkbookBuffer({ sales, units, supplierMap });
writeFileSync(resolve(OUT, 'SIMULATION_SALES_REPORT.xlsx'), Buffer.from(buf));

console.log(`units            ${manifest.counts.unitsCreated}`);
console.log(`sold             ${manifest.counts.unitsSold}`);
console.log(`still in stock   ${manifest.counts.unitsNeverSold}`);
console.log(`returns          ${manifest.counts.returns}`);
console.log(`sales counting   ${manifest.counts.salesStillCounting}`);
console.log(`carriage         £${manifest.returnTotals.carriage.toFixed(2)}`);
console.log(`repair invoices  £${manifest.returnTotals.repairInvoices.toFixed(2)}`);
console.log(`supplier credits £${manifest.returnTotals.supplierCredits.toFixed(2)}`);
console.log(`net return cost  £${manifest.returnTotals.netCost.toFixed(2)}`);
console.log(`awaiting         ${manifest.returnTotals.awaitingCount}`);
console.log(`\nwritten to ${OUT}`);
