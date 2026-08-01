/**
 * Covers the two halves of the "(10.1)(T580)" field case:
 *   1. isAppleDevice must unlock the alphanumeric-serial path off a Samsung
 *      tablet MODEL CODE, so a stripped model name can't make a Wi-Fi-only
 *      tablet fail validation for lacking an IMEI it never had.
 *   2. The sweep must repair the stored model — and must refuse to guess.
 */
import { describe, it, expect } from 'vitest';
import { isAppleDevice, isValidImei } from '../../lib/imeiValidation';
import {
  isMangledModel,
  extractTabletCode,
  findMangledUnitModels,
  fixMangledUnitModels,
} from '../../lib/migrations/repairMangledUnitModels';

// The three real serials from the operator's Back Market import.
const SERIALS = ['r52ha16036m', 'R52H804SC0D', 'R52HA12QETX'];

describe('isAppleDevice — Samsung tablet model codes', () => {
  it('unlocks the serial path from a bare code, with no prose left', () => {
    expect(isAppleDevice('(10.1)(T580)')).toBe(true);
    expect(isAppleDevice('T580')).toBe(true);
    expect(isAppleDevice('SM-T580')).toBe(true);
    expect(isAppleDevice('X206B')).toBe(true);
    expect(isAppleDevice('P615')).toBe(true);
  });

  it('still unlocks from prose, as before', () => {
    expect(isAppleDevice('SAMSUNG GALAXY TAB A 10.1 (T580)')).toBe(true);
    expect(isAppleDevice('IPHONE 14')).toBe(true);
    expect(isAppleDevice('GALAXY TABA8 32GB')).toBe(true);
  });

  it('does NOT unlock for phones — they have a real IMEI and must keep failing', () => {
    expect(isAppleDevice('GALAXY A32 128GB')).toBe(false);
    expect(isAppleDevice('GALAXY S21 5G')).toBe(false);
    expect(isAppleDevice('SM-A536B')).toBe(false);
    expect(isAppleDevice('PIXEL 7')).toBe(false);
  });

  it('accepts the operator\'s three real serials once the code is recognised', () => {
    for (const s of SERIALS) {
      expect(isValidImei(s, { isAppleSerial: isAppleDevice('(10.1)(T580)') })).toBe(true);
    }
  });

  it('still rejects junk on a tablet — the serial shape is enforced', () => {
    const ctx = { isAppleSerial: isAppleDevice('(10.1)(T580)') };
    expect(isValidImei('abc', ctx)).toBe(false);              // too short
    expect(isValidImei('R52HA12QETX-EXTRA', ctx)).toBe(false); // punctuation
    expect(isValidImei('', ctx)).toBe(false);
  });

  it('a phone with a serial-shaped value is still rejected', () => {
    expect(isValidImei('R52HA12QETX', { isAppleSerial: isAppleDevice('GALAXY A32') })).toBe(false);
  });
});

describe('isMangledModel', () => {
  it('fires only when no usable product word survives', () => {
    expect(isMangledModel('(10.1)(T580)')).toBe(true);
    expect(isMangledModel('(T580)')).toBe(true);
    expect(isMangledModel('[10.1][X205]')).toBe(true);
  });

  it('leaves readable names alone, parentheses and all', () => {
    expect(isMangledModel('Galaxy Tab A 10.1 (T580)')).toBe(false);
    expect(isMangledModel('iPhone 14 Pro (128GB)')).toBe(false);
    expect(isMangledModel('IPHONE 12')).toBe(false);
  });

  it('treats blank as a different problem, not this one', () => {
    expect(isMangledModel('')).toBe(false);
    expect(isMangledModel(undefined)).toBe(false);
  });
});

describe('extractTabletCode', () => {
  it('pulls the code out of a fragment or an SM- form', () => {
    expect(extractTabletCode('(10.1)(T580)')).toBe('T580');
    expect(extractTabletCode('SM-X205')).toBe('X205');
    expect(extractTabletCode('Galaxy Tab S6 Lite (P615)')).toBe('P615');
  });

  it('returns undefined when there is no tablet code', () => {
    expect(extractTabletCode('IPHONE 14')).toBeUndefined();
    expect(extractTabletCode('GALAXY A32')).toBeUndefined();
  });
});

describe('findMangledUnitModels', () => {
  const units = [
    { id: 'u1', model: '(10.1)(T580)', imei: 'R52HA12QETX' },
    { id: 'u2', model: '(10.1)(T580)', imei: 'r52ha16036m' },
    { id: 'u3', model: 'Galaxy Tab A 10.1 (T580)', imei: 'R52H804SC0D' },  // fine already
    { id: 'u4', model: 'IPHONE 14', imei: '350111000000011' },              // fine
    { id: 'u5', model: '(9.7)(Z999)', imei: 'ABCD12345678' },               // unknown code
  ];

  it('repairs only the mangled rows with a known code', () => {
    const drift = findMangledUnitModels(units);
    expect(drift.repairs.map(r => r.id)).toEqual(['u1', 'u2']);
    expect(drift.repairs[0].after).toBe('Galaxy Tab A 10.1 (T580)');
  });

  it('flags an unknown code instead of inventing a name', () => {
    const drift = findMangledUnitModels(units);
    expect(drift.unresolved.map(u => u.id)).toEqual(['u5']);
    expect(drift.repairs.some(r => r.id === 'u5')).toBe(false);
  });

  it('records that the repaired units are Wi-Fi-only and serial-identified', () => {
    const [r] = findMangledUnitModels(units).repairs;
    expect(r.hasCellular).toBe(false);   // T580 is the Wi-Fi variant
    expect(r.usesSerial).toBe(true);
  });

  it('the repaired name unlocks the serial path — the point of the exercise', () => {
    const [r] = findMangledUnitModels(units).repairs;
    expect(isAppleDevice(r.after)).toBe(true);
    expect(isValidImei('R52HA12QETX', { isAppleSerial: isAppleDevice(r.after) })).toBe(true);
  });

  it('is idempotent — a second pass finds nothing', () => {
    const drift = findMangledUnitModels(units);
    const after = units.map(u => {
      const hit = drift.repairs.find(r => r.id === u.id);
      return hit ? { ...u, model: hit.after } : u;
    });
    expect(findMangledUnitModels(after).repairs).toHaveLength(0);
  });
});

describe('fixMangledUnitModels', () => {
  it('writes model only, never rawModel', async () => {
    const writes: any[] = [];
    const db = { bulkCreate: async (e: any[]) => { writes.push(...e); } };
    const drift = findMangledUnitModels([
      { id: 'u1', model: '(10.1)(T580)', rawModel: 'ORIGINAL SHEET TEXT', imei: 'R52HA12QETX' },
    ]);
    const res = await fixMangledUnitModels(drift, db);
    expect(res.updated).toBe(1);
    expect(writes).toHaveLength(1);
    expect(writes[0].collection).toBe('inventoryUnits');
    expect(writes[0].data).toEqual({ model: 'Galaxy Tab A 10.1 (T580)' });
    expect(writes[0].data.rawModel).toBeUndefined();
  });

  it('writes nothing when there is nothing to repair', async () => {
    let called = false;
    const db = { bulkCreate: async () => { called = true; } };
    const res = await fixMangledUnitModels({ repairs: [] }, db);
    expect(res.updated).toBe(0);
    expect(called).toBe(false);
  });
});
