/**
 * isAppleDevice — which device families may be identified by a serial.
 *
 * The name is historical; the question it answers is "does this device
 * legitimately have no 15-digit IMEI?". Get it wrong in the false direction
 * and the unit cannot be taken into stock at all: there is no IMEI to type,
 * and the serial is rejected.
 *
 * That is exactly what happened to earbuds and watches. Their generation is
 * FUSED to the model name — Buds2, Buds3 Pro, AirPods4, Galaxy Watch6 — so
 * `\bBUDS\b` never matched. The same fused-token problem was already known
 * and special-cased for tablets (TABA8 → `TAB[A-Z0-9]*`); the fix was never
 * carried across to the other families.
 */
import { describe, it, expect } from 'vitest';
import { isAppleDevice, isValidImei } from '../../lib/imeiValidation';

const SERIAL = 'NL6CMQCYTD';
const canIntakeBySerial = (model: string) =>
  isValidImei(SERIAL, { isAppleSerial: isAppleDevice(model) });

describe('fused generation suffixes', () => {
  it.each([
    'SAMSUNG GALAXY BUDS2',
    'GALAXY BUDS3 PRO',
    'GALAXY BUDS2 PRO',
    'AIRPODS4',
    'SAMSUNG GALAXY WATCH6',
    'GALAXY WATCH7 CLASSIC',
  ])('%s can be taken into stock by serial', (model) => {
    expect(isAppleDevice(model)).toBe(true);
    expect(canIntakeBySerial(model)).toBe(true);
  });

  it.each([
    'GALAXY BUDS',
    'AIRPODS PRO 2',
    'AIRPODS MAX',
    'APPLE WATCH SE 44MM',
    'APPLE WATCH ULTRA2',
    'PIXEL BUDS PRO',
  ])('%s still works, as it did before', (model) => {
    expect(canIntakeBySerial(model)).toBe(true);
  });
});

describe('the suffix stays narrow', () => {
  // \d* not [A-Z0-9]* — the latter would swallow unrelated words.
  it.each([
    'BOOKCASE DISPLAY STAND',
    'WATCHDOG SECURITY TAG',
    'BUDSCO PACKAGING',
  ])('%s is NOT treated as a serial device', (model) => {
    expect(isAppleDevice(model)).toBe(false);
  });
});

describe('phones still require a real IMEI', () => {
  // An Android handset always has one, so the serial escape must stay shut.
  it.each([
    'SAMSUNG GALAXY S22',
    'SAMSUNG GALAXY A14 4G 128GB - 2 SIM SLOTS',
    'GOOGLE PIXEL 7',
    'ONEPLUS NORD 3',
  ])('%s cannot be taken in by serial', (model) => {
    expect(isAppleDevice(model)).toBe(false);
    expect(canIntakeBySerial(model)).toBe(false);
    expect(isValidImei('350100000000000', { isAppleSerial: false })).toBe(true);
  });
});

describe('the operator real catalogue keeps working', () => {
  // Spot-checks lifted verbatim from public/master-walkthrough.xlsx, which
  // is the live model list this validator actually meets.
  it.each([
    ['iPad Air 11-inch (M3) 128GB - Wi-Fi', true],
    ['Galaxy Tab A9 4GB 64 GB - WiFi', true],
    ['Galaxy Tab A11+ 6GB 128GB - WiFi + CELLULAR', true],
    ['Apple iPhone 13 128GB', true],
    ['Samsung Galaxy S20 5G 128GB - SS No E-Sim', false],
    ['Samsung Galaxy A13 64GB - 2 SIM SLOTS', false],
  ] as [string, boolean][])('%s → serial unlocked = %s', (model, expected) => {
    expect(isAppleDevice(model)).toBe(expected);
  });
});
