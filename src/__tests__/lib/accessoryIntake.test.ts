/**
 * Serialised accessories — AirPods, Galaxy Buds, Watches — through the real
 * stock importer.
 *
 * These have no IMEI. A serial is the only identifier they carry, so the
 * whole question of whether they can be stocked comes down to whether
 * isAppleDevice unlocks the serial format for the model name as the operator
 * actually types it. Earbud and watch names fuse the generation to the name
 * (Buds2, AirPods4, Watch6), which is precisely where that detection used to
 * fail — so this drives the importer, not the regex, to prove the whole path
 * works and not just the predicate.
 *
 * Cases, chargers and cables are deliberately NOT supported: they have no
 * identifier of any kind, and every intake path is per-unit. Confirmed with
 * the operator; the last case below pins that as intended behaviour rather
 * than an oversight.
 */
import { describe, it, expect } from 'vitest';
import { parseSheet } from '../../lib/inventoryImportParse';

const HEADER = [
  'Stock In Date', 'Model', 'IMEI', 'Grade', 'Storage',
  'SIM Type', 'Colour', 'Supplier', 'BP', 'Stock Type', 'Notes',
];

/** One stock row, as typed into the inventory template. */
const row = (model: string, id: string) => [
  '2026-07-20', model, id, 'A', 'Not Applicable',
  'Not Applicable', 'WHITE', 'MOBILE WHOLESALE LTD', 120, 'OFFICE', '',
];

const parseOne = (model: string, id: string) => parseSheet([HEADER, row(model, id)])[0];

describe('accessories that carry a serial import cleanly', () => {
  it.each([
    ['APPLE AIRPODS PRO 2', 'NL6CMQCYTD'],
    ['AIRPODS4', 'H4JCMQ1YTD'],
    ['AIRPODS MAX', 'FVFXQ2ABCD'],
    ['SAMSUNG GALAXY BUDS2', 'R8YWA0ALDFT'],
    ['GALAXY BUDS3 PRO', 'R9ZWB1BMEGU'],
    ['APPLE WATCH SE 44MM', 'GX9CMQCYTDA'],
    ['SAMSUNG GALAXY WATCH6', 'R5CWC2CNFHV'],
  ])('%s accepts its serial', (model, serial) => {
    const parsed = parseOne(model, serial);
    expect(parsed.errors).toEqual([]);
    expect(parsed.imei).toBe(serial.toUpperCase());
    expect(parsed.model).toBe(model);
  });

  it('a serialised accessory can arrive as supplier-held stock too', () => {
    const shs = parseSheet([HEADER, [
      '2026-07-20', 'SAMSUNG GALAXY BUDS2', 'R8YWA0ALDFT', 'A', 'Not Applicable',
      'Not Applicable', 'WHITE', 'MOBILE WHOLESALE LTD', 120, 'SHS', '',
    ]])[0];
    expect(shs.errors).toEqual([]);
    expect(shs.stockType).toBe('shs');
  });
});

describe('phones are unaffected', () => {
  it('an Android handset still needs a real 15-digit IMEI', () => {
    expect(parseOne('SAMSUNG GALAXY S22', 'R8YWA0ALDFT').errors)
      .toContain('IMEI not valid (15 digits, or 10-12 char alphanumeric serial)');
    expect(parseOne('SAMSUNG GALAXY S22', '350100000000000').errors).toEqual([]);
  });

  it('an iPhone takes either form', () => {
    expect(parseOne('APPLE IPHONE 13 128GB', '350100000000000').errors).toEqual([]);
    expect(parseOne('APPLE IPHONE 13 128GB', 'NL6CMQCYTD').errors).toEqual([]);
  });
});

describe('identifier-less accessories are out of scope, by decision', () => {
  // Cases, chargers, cables and screen protectors have no serial. Supporting
  // them would mean quantity-based stock — a different stock model, not a
  // validation tweak. The operator's live 79-model catalogue contains none.
  it.each(['IPHONE 15 SILICONE CASE', 'USB-C CHARGER 20W', 'LIGHTNING CABLE 1M'])(
    '%s is rejected for having no identifier', (model) => {
      expect(parseOne(model, '').errors).toContain('IMEI is required for office stock');
    },
  );
});
