/**
 * Locks the read-time normalisation inventoryStore applies to every raw
 * `inventoryUnits`/`sales` doc. This is the single place that used to
 * unconditionally re-derive `model` from `parseBrandModelStorage` on every
 * snapshot — a parser tweak changed what's displayed for every unit in the
 * app simultaneously, with no way to opt a unit out once its name was
 * already clean. `deriveUnitFields`/`deriveSaleFields` now gate that
 * re-derivation on `looksLikeSku`: a clean model must stay byte-identical
 * forever, regardless of future parser changes; a genuinely SKU-shaped one
 * keeps getting live-cleaned exactly as before.
 */
import { describe, it, expect } from 'vitest';
import { deriveUnitFields, deriveSaleFields } from '../../lib/inventoryStore';

describe('deriveUnitFields', () => {
  it('leaves a clean, human-confirmed model completely untouched', () => {
    const unit = { id: 'u1', model: 'Galaxy S22 Ultra', brand: 'Samsung', storage: '256GB', sku: 'whatever-preserved' };
    const out = deriveUnitFields(unit);
    expect(out).toEqual({ ...unit, rawModel: 'Galaxy S22 Ultra' });
  });

  it('still cleans a genuinely SKU-shaped model, same as before this gate existed', () => {
    const unit = { id: 'u2', model: 'ASI-SG-S20-128-CN-EX', brand: '', storage: undefined };
    const out = deriveUnitFields(unit);
    expect(out.model).toBe('Galaxy S20');
    expect(out.brand).toBe('Samsung');
    expect(out.storage).toBe('128GB');
    expect(out.rawModel).toBe('ASI-SG-S20-128-CN-EX');
  });

  it('a clean model never changes even if it happens to contain a dash', () => {
    const unit = { id: 'u3', model: 'Samsung Galaxy Note 9 - Pre-owned', brand: 'Samsung' };
    const out = deriveUnitFields(unit);
    expect(out.model).toBe('Samsung Galaxy Note 9 - Pre-owned');
  });

  it('passes through a unit with no model at all', () => {
    const unit = { id: 'u4' };
    expect(deriveUnitFields(unit)).toBe(unit);
  });

  it('preserves an already-set brand/storage on a clean unit rather than blanking them', () => {
    const unit = { id: 'u5', model: 'iPhone 13 Pro Max', brand: 'Apple', storage: '512GB' };
    const out = deriveUnitFields(unit);
    expect(out.brand).toBe('Apple');
    expect(out.storage).toBe('512GB');
  });
});

describe('deriveSaleFields', () => {
  it('never touches an accessory sale (no imei), even if its sku looks dash-shaped', () => {
    const sale = { id: 's1', sku: 'USB-C-20W', model: undefined };
    expect(deriveSaleFields(sale)).toBe(sale);
  });

  it('leaves a clean device-sale model untouched', () => {
    const sale = { id: 's2', imei: '350000000000111', model: 'Galaxy S22 Ultra' };
    const out = deriveSaleFields(sale);
    expect(out.model).toBe('Galaxy S22 Ultra');
  });

  it('still cleans a genuinely SKU-shaped device-sale model', () => {
    const sale = { id: 's3', imei: '350000000000111', model: 'ASI-SG-S20-128-CN-EX' };
    const out = deriveSaleFields(sale);
    expect(out.model).toBe('Galaxy S20');
  });

  it('passes through a device sale with no model or sku to fall back on', () => {
    const sale = { id: 's4', imei: '350000000000111' };
    expect(deriveSaleFields(sale)).toBe(sale);
  });

  /**
   * The operator's SKU is the one thing on a sale row that must survive
   * verbatim: it is what gets matched against a marketplace statement.
   *
   * This line read `expectedSku || item.sku` — the same bug fixed on the unit
   * side in 2026-08 and missed here — so the synthesised brand + model +
   * storage string overwrote it at READ time. Nothing was wrong in the
   * database; the Sales Report simply printed something else.
   */
  it('keeps the operator\'s typed SKU verbatim, however SKU-shaped it looks', () => {
    const sale = { id: 's5', imei: '350000000000111', sku: 'IP13-128-MID' };
    // Would have come out as "Apple iPhone 13 128GB".
    expect(deriveSaleFields(sale).sku).toBe('IP13-128-MID');
  });

  it('does not mangle a real operator SKU into a half-parsed one', () => {
    // This one came back as "Samsung ASI-SG-S20 Fe- -DS-128-CN-EX2" — not a
    // string that matches anything on any statement.
    const sku = 'ASI-SG-S20FE-5G-DS-128-CN-EX2';
    const sale = { id: 's6', imei: '350000000000111', sku };
    expect(deriveSaleFields(sale).sku).toBe(sku);
  });

  it('still synthesises a SKU when the sale genuinely has none', () => {
    // Filling a blank is the one thing the synthesised string is good for.
    const out = deriveSaleFields({ id: 's7', imei: '350000000000111', model: 'ASI-SG-S20-128-CN-EX' });
    expect(out.sku).toBe('Samsung Galaxy S20 128GB');
  });

  it('a stamped model stops the SKU being parsed for one at all', () => {
    // recordSale now snapshots unit.model onto the sale, so the guess path
    // below never runs for an in-app sale. Belt and braces: even with a
    // SKU-shaped SKU present, a clean model wins and nothing is rewritten.
    const sale = { id: 's8', imei: '350000000000111', sku: 'IP13-128-MID', model: 'IPHONE 13' };
    expect(deriveSaleFields(sale)).toBe(sale);
  });
});
