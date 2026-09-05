/**
 * seedData — the dataset the E2E harness boots with.
 *
 * Shaped to light up every surface a screenshot pass needs: office stock,
 * SHS awaiting delivery, sold history with linked sales, an open return,
 * a repair, a replacement pair, and one duplicate sale doc so the Returns
 * reconciliation panel has something real to explain.
 *
 * 2026-08 — accessories added. There were none, so the Sales Report's
 * Accessories tab exported as a bare header row on every run, and a reviewer
 * reasonably read that as the feature not working. Two pools, a sale from each,
 * and one accessory return, so that sheet and the Accessory line of Returns
 * Detail both carry real rows.
 *
 * Only loaded by firestoreShim under VITE_E2E=1 — never in a normal build.
 */

const TODAY = '2026-07-25';
const supplier = (id: string, name: string) => ({
  id, name, ownerId: 'shared', createdAt: '2026-01-01', contact: '', notes: '',
});

const unit = (o: Record<string, any>) => ({
  model: 'IPHONE 12',
  storage: '64GB',
  colour: 'BLACK',
  status: 'available',
  buyPrice: 200,
  dateIn: '2026-07-01',
  flags: [],
  platformListed: false,
  supplierId: 'sup-1',
  supplierName: 'MOBILE WHOLESALE LTD',
  ownerId: 'shared',
  createdAt: '2026-07-01',
  ...o,
});

const sale = (o: Record<string, any>) => ({
  marketplace: 'AMAZON',
  quantity: 1,
  buyPrice: 200,
  spMinusBp: 120,
  marginalTax: 20,
  commission: 48,
  postage: 8,
  grossProfit: 44,
  gpPercent: 13.7,
  saleDate: '2026-07-10',
  salePrice: 320,
  supplierName: 'MOBILE WHOLESALE LTD',
  importBatchId: 'e2e-batch',
  sourceFile: 'SALES_REPORT_2026.xlsx',
  sourceRow: 2,
  importedAt: '2026-07-20',
  createdAt: '2026-07-20',
  updatedAt: '2026-07-20',
  ownerId: 'shared',
  ...o,
});

export const E2E_SEED: Record<string, Record<string, any>[]> = {
  suppliers: [
    supplier('sup-1', 'MOBILE WHOLESALE LTD'),
    supplier('sup-2', 'PHONEBOX DIRECT'),
  ],

  inventoryUnits: [
    // ── Office stock, available ──────────────────────────────────────────
    unit({ id: 'u-101', imei: '350000000000101', model: 'IPHONE 13', storage: '128GB', colour: 'MIDNIGHT', buyPrice: 320, dateIn: TODAY }),
    unit({ id: 'u-102', imei: '350000000000102', model: 'IPHONE 13', storage: '128GB', colour: 'STARLIGHT', buyPrice: 318, dateIn: TODAY }),
    unit({ id: 'u-103', imei: '350000000000103', model: 'IPHONE 12', storage: '64GB', colour: 'BLUE', buyPrice: 205 }),
    unit({ id: 'u-104', imei: '350000000000104', model: 'SAMSUNG GALAXY S22', storage: '128GB', colour: 'GREEN', buyPrice: 240, supplierId: 'sup-2', supplierName: 'PHONEBOX DIRECT' }),
    unit({ id: 'u-105', imei: '350000000000105', model: 'IPHONE 14', storage: '256GB', colour: 'PURPLE', buyPrice: 480 }),
    // Legacy casing written before the intake screens shared one grade
    // list — 'Brand New' vs the canonical 'Brand new'. The Configuration
    // panel offers to merge them.
    unit({ id: 'u-106', imei: '350000000000106', model: 'IPHONE 15', storage: '128GB', colour: 'BLACK', buyPrice: 620, grade: 'Brand New' }),
    unit({ id: 'u-107', imei: '350000000000107', model: 'IPHONE 15', storage: '128GB', colour: 'BLUE', buyPrice: 615, grade: 'Brand New' }),

    // ── SHS — supplier holds these, awaiting delivery ────────────────────
    unit({ id: 'u-201', imei: '350000000000201', status: 'incoming', stockSource: 'shs', model: 'IPHONE 13 PRO', storage: '256GB', colour: 'GRAPHITE', buyPrice: 520 }),
    unit({ id: 'u-202', imei: '350000000000202', status: 'incoming', stockSource: 'shs', model: 'IPHONE 13 PRO', storage: '256GB', colour: 'SIERRA BLUE', buyPrice: 525 }),
    unit({ id: 'u-203', imei: '350000000000203', status: 'incoming', stockSource: 'shs', model: 'SAMSUNG GALAXY S23', storage: '256GB', colour: 'CREAM', buyPrice: 430, supplierId: 'sup-2', supplierName: 'PHONEBOX DIRECT' }),

    // ── Sold ─────────────────────────────────────────────────────────────
    unit({ id: 'u-301', imei: '350000000000301', status: 'sold', stockSource: 'office', model: 'IPHONE 12', storage: '64GB', salePrice: 320, saleDate: '2026-07-10', salePlatform: 'AMAZON', saleOrderId: 'AMZ-1001', postageCost: 8 }),
    unit({ id: 'u-302', imei: '350000000000302', status: 'sold', stockSource: 'office', model: 'IPHONE 12', storage: '128GB', salePrice: 355, saleDate: '2026-07-18', salePlatform: 'EBAY', saleOrderId: 'EB-2001', postageCost: 8 }),
    unit({ id: 'u-303', imei: '350000000000303', status: 'sold', stockSource: 'shs', model: 'IPHONE 13', storage: '128GB', salePrice: 410, saleDate: TODAY, salePlatform: 'ONBUY', saleOrderId: 'OB-3001', postageCost: 8 }),

    // ── Returns ──────────────────────────────────────────────────────────
    // Back to inventory — available again, carries return history
    unit({
      id: 'u-401', imei: '350000000000401', status: 'available', model: 'IPHONE 12', storage: '64GB',
      returnType: 'returned_to_inventory', returnDate: '2026-07-21', returnReason: 'Battery health below 85%',
      returnOutcome: 'refund', returnLegCost: 9.6, returnComments: 'Customer reported rapid drain; QC confirmed 79%.',
      customerComments: 'Phone dies by lunchtime.', technicianComments: 'Battery health 79%, screen and body A-grade.',
    }),
    // In repair
    unit({
      id: 'u-402', imei: '350000000000402', status: 'returned', model: 'SAMSUNG GALAXY S22', storage: '128GB',
      supplierId: 'sup-2', supplierName: 'PHONEBOX DIRECT',
      returnType: 'repair', returnDate: '2026-07-22', returnReason: 'Cracked rear glass in transit',
      returnOutcome: 'replacement', returnLegCost: 9.6,
    }),
    // Replacement pair — u-403 came back, u-404 shipped in its place
    unit({
      id: 'u-403', imei: '350000000000403', status: 'available', model: 'IPHONE 14', storage: '256GB',
      returnType: 'returned_to_inventory', returnDate: '2026-07-23', returnReason: 'Face ID intermittent',
      returnOutcome: 'replacement', replacedByUnitId: 'u-404', returnLegCost: 9.6,
    }),
    unit({
      id: 'u-404', imei: '350000000000404', status: 'sold', model: 'IPHONE 14', storage: '256GB',
      salePrice: 610, saleDate: '2026-07-23', salePlatform: 'AMAZON', saleOrderId: 'AMZ-1009',
      replacementForUnitId: 'u-403',
    }),
  ],

  sales: [
    sale({ id: 'AMAZON__AMZ-1001__350000000000301', orderNumber: 'AMZ-1001', imei: '350000000000301', unitId: 'u-301', sku: 'IP12-64-BLK' }),
    sale({ id: 'EBAY__EB-2001__350000000000302', orderNumber: 'EB-2001', marketplace: 'EBAY', imei: '350000000000302', unitId: 'u-302', sku: 'IP12-128-BLK', salePrice: 355, saleDate: '2026-07-18' }),
    sale({ id: 'ONBUY__OB-3001__350000000000303', orderNumber: 'OB-3001', marketplace: 'ONBUY', imei: '350000000000303', unitId: 'u-303', sku: 'IP13-128-MID', salePrice: 410, saleDate: TODAY }),
    sale({ id: 'AMAZON__AMZ-1009__350000000000404', orderNumber: 'AMZ-1009', imei: '350000000000404', unitId: 'u-404', sku: 'IP14-256-PUR', salePrice: 610, saleDate: '2026-07-23' }),

    // ── Accessory sales — no unitId and no IMEI, which is what identifies
    //    them downstream (see clientReport's Returns Detail writer).
    sale({
      id: 'AMAZON__AMZ-ACC-1__USB-C-20W-CHARGER', orderNumber: 'AMZ-ACC-1',
      sku: 'USB-C-20W-CHARGER', quantity: 4, buyPrice: 12.8, salePrice: 39.96,
      postage: 2.5, saleDate: '2026-07-19', spMinusBp: 27.16, marginalTax: 4.53,
      commission: 2.8, grossProfit: 14.9, gpPercent: 116.4,
    }),
    sale({
      id: 'EBAY__EB-ACC-1__TEMPERED-GLASS-IP13', orderNumber: 'EB-ACC-1',
      marketplace: 'EBAY', sku: 'TEMPERED-GLASS-IP13', quantity: 3,
      buyPrice: 3.3, salePrice: 17.97, postage: 2.5, saleDate: '2026-07-20',
      spMinusBp: 14.67, marginalTax: 2.45, commission: 1.12,
      grossProfit: 6.1, gpPercent: 184.8,
    }),
    // One of them came back — gives Returns Detail an "Accessory" row with a
    // real postage loss, alongside the device returns below.
    sale({
      id: 'AMAZON__AMZ-ACC-2__USB-C-20W-CHARGER', orderNumber: 'AMZ-ACC-2',
      sku: 'USB-C-20W-CHARGER', quantity: 1, buyPrice: 3.2, salePrice: 9.99,
      postage: 2.5, saleDate: '2026-07-21', spMinusBp: 6.79, marginalTax: 1.13,
      commission: 0.7, grossProfit: 1.2, gpPercent: 37.5,
      voidedAt: '2026-07-24', voidReason: 'Wrong item ordered', voidOutcome: 'refund',
    }),

    // Voided by the Back-to-Inventory return on u-401
    sale({
      id: 'AMAZON__AMZ-1005__350000000000401', orderNumber: 'AMZ-1005', imei: '350000000000401', unitId: 'u-401',
      sku: 'IP12-64-BLK', salePrice: 325, saleDate: '2026-07-15',
      voidedAt: '2026-07-21', voidReason: 'Refund — Battery health below 85%', voidOutcome: 'refund',
    }),
    // SECOND voided doc for the SAME phone — an in-app sale that predates the
    // import. One return click voided both, which is why the Sell chip reads
    // one higher than the Returns ledger. The reconciliation panel names it.
    sale({
      id: 'AMAZON__AMZ-1005-LEGACY__350000000000401', orderNumber: 'AMZ-1005-LEGACY', imei: '350000000000401', unitId: 'u-401',
      sku: 'IP12-64-BLK', salePrice: 325, saleDate: '2026-07-15',
      voidedAt: '2026-07-21', voidReason: 'Refund — Battery health below 85%', voidOutcome: 'refund',
    }),
    // Voided by the repair return on u-402
    sale({
      id: 'EBAY__EB-2007__350000000000402', orderNumber: 'EB-2007', marketplace: 'EBAY', imei: '350000000000402', unitId: 'u-402',
      sku: 'S22-128-GRN', salePrice: 375, saleDate: '2026-07-16',
      voidedAt: '2026-07-22', voidReason: 'In Repair — Cracked rear glass in transit', voidOutcome: 'repair',
    }),
    // Voided by the replacement return on u-403
    sale({
      id: 'AMAZON__AMZ-1008__350000000000403', orderNumber: 'AMZ-1008', imei: '350000000000403', unitId: 'u-403',
      sku: 'IP14-256-PUR', salePrice: 605, saleDate: '2026-07-19',
      voidedAt: '2026-07-23', voidReason: 'Replacement — Face ID intermittent', voidOutcome: 'replacement',
    }),
  ],

  // ── Accessories: no-IMEI quantity pools ─────────────────────────────────
  accessoryStock: [
    {
      id: 'acc-1', sku: 'USB-C-20W-CHARGER', name: 'USB-C 20W Charger',
      quantity: 46, buyPrice: 3.2, lowStockThreshold: 10,
      supplierId: 'sup-1', supplierName: 'MOBILE WHOLESALE LTD',
      ownerId: 'shared', createdAt: '2026-07-02', updatedAt: TODAY,
    },
    {
      id: 'acc-2', sku: 'TEMPERED-GLASS-IP13', name: 'Tempered Glass · iPhone 13',
      quantity: 22, buyPrice: 1.1, lowStockThreshold: 15,
      supplierId: 'sup-2', supplierName: 'PHONEBOX DIRECT',
      ownerId: 'shared', createdAt: '2026-07-02', updatedAt: TODAY,
    },
  ],

  // The ledger behind those pools — intake, the two sales below, and the
  // restock that the accessory return produced.
  accessoryStockEvents: [
    { id: 'ae-1', accessoryId: 'acc-1', sku: 'USB-C-20W-CHARGER', type: 'intake',  quantity: 50, note: 'Opening stock', createdAt: '2026-07-02', ownerId: 'shared' },
    { id: 'ae-2', accessoryId: 'acc-2', sku: 'TEMPERED-GLASS-IP13', type: 'intake', quantity: 25, note: 'Opening stock', createdAt: '2026-07-02', ownerId: 'shared' },
    { id: 'ae-3', accessoryId: 'acc-1', sku: 'USB-C-20W-CHARGER', type: 'sale',    quantity: -4, note: 'AMZ-ACC-1', createdAt: '2026-07-19', ownerId: 'shared' },
    { id: 'ae-4', accessoryId: 'acc-2', sku: 'TEMPERED-GLASS-IP13', type: 'sale',  quantity: -3, note: 'EB-ACC-1',  createdAt: '2026-07-20', ownerId: 'shared' },
    { id: 'ae-5', accessoryId: 'acc-1', sku: 'USB-C-20W-CHARGER', type: 'return',  quantity: 1,  note: 'AMZ-ACC-1 — refund', createdAt: '2026-07-24', ownerId: 'shared' },
  ],

  inventoryAggregates: [
    {
      id: 'agg-1', model: 'IPHONE 11 64GB', storage: '64GB', quantityText: 'SHS', supplierIds: ['sup-1'],
      coloursRaw: 'BLACK 3 WHITE 2', coloursMap: { BLACK: 3, WHITE: 2 }, buyPrice: 165,
      ownerId: 'shared', createdAt: '2026-07-01', updatedAt: '2026-07-01',
    },
    {
      id: 'agg-2', model: 'IPHONE 11 128GB', storage: '128GB', quantityNum: 4, quantityText: '4', supplierIds: ['sup-2'],
      coloursRaw: 'BLACK 4', coloursMap: { BLACK: 4 }, buyPrice: 185,
      ownerId: 'shared', createdAt: '2026-07-01', updatedAt: '2026-07-01',
    },
  ],

  // The admin-curated device catalogue.
  //
  // WHY THIS IS NOT EMPTY ANY MORE. Import HOLDS any row whose Model is not
  // in this catalogue (see SHOW_IMPORT_UI in lib/featureFlags.ts) — that gate
  // is what stops supplier product codes becoming model names. In production
  // the catalogue SURVIVES a wipe: ResetDataModal never touches `models`.
  //
  // With this array empty, the shim's catalogue existed only as a derivation
  // from the seeded units, so a Wipe All emptied it — and every subsequent
  // import held all 120 rows of INVENTORY_REPORT_SAMPLE.xlsx, leaving no
  // "Load N rows" button and killing nine e2e scripts at a 30s timeout apiece,
  // before a single assertion ran. The shim was modelling a state production
  // cannot reach.
  //
  // ALL SEVEN models in INVENTORY_REPORT_SAMPLE.xlsx, so the sample file
  // imports whole.
  //
  // GOOGLE PIXEL 7 was left out at first, on the theory that its 15 rows
  // staying HELD would keep the catalogue gate exercised. That was a
  // rationalisation, not a requirement, and it cost more than it bought:
  // e2eBatchVsMarketplace expects the file to land 110 office + 10 SHS and
  // got 95 + 10, and the sales imports that follow could never enable
  // Confirm, because rows referencing the 15 units that were never created
  // are held. Eight failing assertions to preserve incidental coverage of a
  // gate that deserves its own test, with its own fixture, rather than being
  // a side effect of what this one omits.
  models: [
    { id: 'mdl-ip12',  brand: 'APPLE',   model: 'IPHONE 12',         ownerId: 'shared' },
    { id: 'mdl-ip13',  brand: 'APPLE',   model: 'IPHONE 13',         ownerId: 'shared' },
    { id: 'mdl-ip13p', brand: 'APPLE',   model: 'IPHONE 13 PRO',     ownerId: 'shared' },
    { id: 'mdl-ip14',  brand: 'APPLE',   model: 'IPHONE 14',         ownerId: 'shared' },
    { id: 'mdl-s22',   brand: 'SAMSUNG', model: 'SAMSUNG GALAXY S22', ownerId: 'shared' },
    { id: 'mdl-s23',   brand: 'SAMSUNG', model: 'SAMSUNG GALAXY S23', ownerId: 'shared' },
    { id: 'mdl-px7',   brand: 'GOOGLE',  model: 'GOOGLE PIXEL 7',      ownerId: 'shared' },
  ],
  notices: [],
  activeListings: [],
  inventoryEvents: [],
  marketplaceFees: [],
  supplierWhatsappUpdates: [],
  importBatches: [],
  dailyUpdates: [],
  sourceDocuments: [],
};
