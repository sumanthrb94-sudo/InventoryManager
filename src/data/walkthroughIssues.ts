/**
 * Per-row issue write-ups for the Client Walkthrough admin view.
 *
 * Keyed by INVENTORY sheet row number (matches the row numbers shown
 * in the workbook when opened in Excel). Each entry is the operator's
 * talking points: short headline, then bullets describing what to ask.
 *
 * Update this file as new audit findings come in. Rows not listed here
 * are still rendered in the walkthrough table with their colour
 * classification but no expandable detail.
 */

export interface RowIssue {
  /** One-line headline (rendered in the row's chevron summary).  */
  headline: string;
  /** Bullet points for the client conversation (rendered when expanded). */
  bullets: string[];
  /** Optional verbatim question(s) for the client.                 */
  questions?: string[];
}

export const WALKTHROUGH_ISSUES: Record<number, RowIssue> = {
  3: {
    headline: 'iPad 9th gen — rollup behind by 2 units',
    bullets: [
      'INV says 10 units, IMEI sheet shows 12 available.',
      'Same supplier (MHL), same BP, same colours (Space Grey / Silver).',
      'Just a stale rollup count — 2 units logged with IMEIs but not added to the qty cell.',
    ],
    questions: ['Confirm rollup should read 12 not 10?'],
  },
  6: {
    headline: 'Galaxy Tab A8 — resolved: colour is SPACE GREY',
    bullets: [
      'Client confirmed all 16 units are SPACE GREY (Samsung\'s "Dark Grey" = BLACK label some retailers use).',
      'Rollup colour updated to "SPACE GREY 16 SILVER 0" to match the IMEI sheet.',
      'Row reclassified green — safe to load.',
    ],
  },
  7: {
    headline: 'Galaxy Tab S9FE — naming + WiFi/cellular tag drift',
    bullets: [
      'IMEI sheet uses "W/C" suffix that the rollup doesn\'t.',
      '3 units, same colour, same BP otherwise.',
      'Cosmetic — fixed by the v2 rename pass.',
    ],
  },
  9: {
    headline: 'iPhone SE 3rd — supplier drift',
    bullets: [
      'INV says NANAK supplier.',
      'IMEI sheet shows the 2 available units sourced from a different supplier — supplier mismatch on the row.',
      'May be an ABC/RR sourcing flip similar to iPhone 13.',
    ],
    questions: ['Were the 2 SE 3rd units actually bought from NANAK or another supplier?'],
  },
  10: {
    headline: 'iPhone XS — GREY vs BLACK',
    bullets: [
      'INV says GREY × 1. IMEI shows 1 BLACK.',
      'Apple sells the XS in "Space Grey" which the IMEI sheet writes as BLACK.',
      'Same alias rule as the Tab A8 above.',
    ],
  },
  13: {
    headline: 'iPhone 13 128GB — ABC supplier never appears in IMEI sheet',
    bullets: [
      'INV says ABC supplier for the 2 in-office units.',
      'IMEI sheet has those 2 units split: 1 from RR STOCK, 1 from IMAX. No ABC anywhere for this model.',
      'Sold history: 2 NANAK units. So 4 different suppliers across the model\'s history.',
    ],
    questions: [
      'Did the ABC purchase order for iPhone 13 128GB actually land, or were the 2 units re-sourced from RR STOCK / IMAX?',
      'If re-sourced, the INV row should read IMAX (or RR STOCK), not ABC.',
    ],
  },
  15: {
    headline: 'Samsung S9+ — PURPLE vs PINK',
    bullets: [
      'INV says PURPLE × 1. IMEI shows PINK × 1.',
      'Same supplier, same BP.',
      'Likely just colour-name drift — Samsung sells the S9+ in "Lilac Purple" / "Rose Gold". Same unit, different label.',
    ],
  },
  17: {
    headline: 'Samsung S20 FE 5G — naming drift (long form vs short)',
    bullets: [
      'IMEI sheet had 11 units filed as "SAMSUNG S20FE 128GB" — different from INV\'s long form.',
      'Fixed in v2 rename pass — these now match.',
      'Counts align at 11.',
    ],
  },
  18: {
    headline: 'Samsung S21 5G 128GB — rollup behind by ~1',
    bullets: [
      'IMEI count slightly ahead of INV qty.',
      'Same supplier, same BP, same colours.',
      'One batch of IMEIs logged but not added to the rollup.',
    ],
  },
  19: {
    headline: 'Samsung S21 FE 5G 128GB — supplier flip MHL vs RR STOCK',
    bullets: [
      'INV says MHL × 3.',
      'IMEI shows: 2 RR STOCK + 1 MHL (different BPs — RR units came in at higher cost).',
      'Looks like a re-source on 2 of the 3 units.',
    ],
    questions: ['Were those 2 RR STOCK units a deliberate re-buy, or should the rollup just be split per batch?'],
  },
  20: {
    headline: 'Samsung S21 Plus 5G 128GB — "+ vs Plus" naming, plus supplier mismatch',
    bullets: [
      'INV used "Samsung Galaxy S21+ 128GB"; IMEI used "SAMSUNG S21+ 128GB". Renamed in v2 to "S21 Plus".',
      'Qty matches (1 each).',
      'Supplier: INV says RR STOCK. Confirm vs IMEI value.',
    ],
  },
  21: {
    headline: 'Samsung S22 128GB — rollup behind by 1',
    bullets: [
      'INV qty 7, IMEI has 8 available.',
      'Same supplier (MHL), same BP, same colour breakdown.',
      'Yellow gap row — easy fix.',
    ],
  },
  22: {
    headline: 'Samsung S22 256GB — multi-issue row',
    bullets: [
      'PURPLE vs LAVENDER naming on 2 units (Bora Purple = Lavender).',
      'BLACK off by 1 (INV says 1, IMEI shows 2).',
      'INV supplier "ABC / MHL"; IMEI shows MHL + IMAX — ABC doesn\'t appear.',
      '2 of the MHL units came in at BP 160 (different batch); INV BP says 145.',
    ],
    questions: [
      'Did the ABC purchase land for S22 256GB, or were PINK/WHITE sourced from IMAX?',
      '2 MHL units at BP 160 — should the rollup show blended cost or split row?',
    ],
  },
  23: {
    headline: 'Samsung S23 5G 128GB — clearance row with multiple gaps',
    bullets: [
      'WHITE × 1 unit in IMEI not on the rollup ("WHITE 0" on INV but 1 exists).',
      'GREEN units priced wrong — ABC at BP 185, not INV\'s 190.',
      'NIHAL listed as supplier but doesn\'t appear in IMEI register.',
      '"(SHS)" tag in colours field — likely flagging that LAVENDER is supplier-held, not in office.',
      'Notes say CLEARANCE.',
    ],
    questions: [
      'Add the missing WHITE unit to the rollup?',
      'Drop NIHAL from this row\'s supplier list?',
    ],
  },
  24: {
    headline: 'Samsung S23 FE 5G 128GB — phantom units',
    bullets: [
      'Internal inconsistency: QTY says 1 but colours list adds to 5 (BLACK 1, WHITE 1, PURPLE 2, GREEN 1).',
      'Zero IMEIs available for this SKU.',
      'INV supplier MOBILE KIT never appears in IMEI sheet for S23 FE; the only sold unit was from RR STOCK.',
    ],
    questions: [
      'Do you have 1, 5, or 0 of these in office?',
      'Was the MOBILE KIT purchase ever received?',
    ],
  },
  25: {
    headline: 'Samsung S23 FE 5G 256GB — supplier mismatch',
    bullets: [
      'INV says MOBILE KIT × 1.',
      'No IMEI under MOBILE KIT for this SKU.',
      'Same pattern as row 24.',
    ],
  },
  28: {
    headline: 'Samsung A13 64GB — 4G/5G ambiguity',
    bullets: [
      'INV row reads "Samsung Galaxy A13 64GB" — no 4G/5G tag.',
      'IMEI sheet has these 5 units as A13 5G 64GB.',
      'Samsung A13 has distinct 4G and 5G variants (different specs, different price).',
    ],
    questions: ['Are all 5 A13 units the 5G variant? If yes, add "5G" to the row name.'],
  },
  29: {
    headline: 'Samsung A14 4G 128GB — supplier mismatch',
    bullets: [
      'INV says RR STOCK × 1.',
      'IMEI register supplier differs for this single unit.',
    ],
  },
  30: {
    headline: 'Samsung A14 5G 128GB — qty + supplier mismatch',
    bullets: [
      'INV qty 1, supplier MHL.',
      'IMEI register shows different supplier for this unit.',
    ],
  },
  31: {
    headline: 'Samsung A14 5G 64GB — colour + storage mismatch',
    bullets: [
      'INV says A14 5G 64GB × 5 (BLACK).',
      'IMEI shows 1 unit only — VIOLET, A14 4G 64GB variant (different SKU).',
      '4 units missing IMEIs entirely, plus the 1 that does exist is the 4G variant not 5G.',
    ],
    questions: [
      'Are those 4 missing 5G units real stock with unlogged IMEIs, or was the rollup wrong?',
      'Should the 1 VIOLET 4G unit be in a separate row?',
    ],
  },
  32: {
    headline: 'Samsung A15 5G 128GB — storage mismatch',
    bullets: [
      'INV says 128GB × 1 (BLACK).',
      'IMEI shows 1 BLACK A15 5G — but as 64GB, not 128GB.',
      'Different SKU, different price.',
    ],
    questions: ['Is the unit in office 64GB or 128GB?'],
  },
  33: {
    headline: 'Samsung A16 4G 128GB — 4G/5G flip on 1 unit',
    bullets: [
      'INV says A16 4G 128GB × 2 (GREEN/WHITE).',
      'IMEI shows 1 unit as A16 5G 128GB (GREEN). Other unit doesn\'t appear.',
      '4G and 5G are different SKUs; can\'t auto-merge.',
    ],
    questions: ['Is the office holding 4G or 5G? Where\'s the second unit?'],
  },
  36: {
    headline: 'Samsung A21S 32GB — rollup behind by 1',
    bullets: [
      'INV qty 4, IMEI has 5 available.',
      'Same supplier (IMAX), same BP, same colour.',
      'Yellow gap — easy fix.',
    ],
  },
  37: {
    headline: 'Samsung A32 5G 64GB — the big one (+29 units, supplier sprawl)',
    bullets: [
      'INV says 42 units from IMAX.',
      'IMEI sheet has 71 available units across 4 suppliers (IMAX 34, MHL 20, NANAK 16, RR STOCK 1).',
      'Already fixed: 42 rows had BLACK in the SUPPLIER column (column swap). Those should read MHL.',
      'Real gap: the MHL batch (20) and NANAK batch (16) aren\'t reflected in the rollup at all.',
      'Question: are these unlogged stock, or sold/RTS units that weren\'t marked?',
    ],
    questions: [
      'For A32 5G 64GB — INV says 42, IMEI has 71. Are the extra 29 units real unlogged stock, or are some already sold and just not marked?',
    ],
  },
};
