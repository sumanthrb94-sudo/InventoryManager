import { describe, it, expect } from 'vitest';
import { decodeSkuAttributes, DEFAULT_COLOUR } from '../../lib/operatorSkuAttributes';
import { isOrphanSoldUnit } from '../../components/OrphanUnitsModal';

describe('decodeSkuAttributes — Apple Watch, both spellings', () => {
  it('decodes the space form', () => {
    expect(decodeSkuAttributes('AW SE 3-40-MN')).toEqual({
      model: 'Apple Watch SE 3 40mm', colour: 'Midnight',
    });
  });
  it('decodes the hyphen form', () => {
    expect(decodeSkuAttributes('AW SE-3-44-SL')).toEqual({
      model: 'Apple Watch SE 3 44mm', colour: 'Silver',
    });
  });
  it('puts the case size in the model name, never in storage', () => {
    expect(decodeSkuAttributes('AW SE 3-40-MN').storage).toBeUndefined();
  });
});

describe('decodeSkuAttributes — capacity', () => {
  it('reads a capacity written into the name', () => {
    expect(decodeSkuAttributes('Samsung Galaxy XCOVER 32GB').storage).toBe('32GB');
  });
  it('applies the confirmed A21S default when the capacity is absent', () => {
    expect(decodeSkuAttributes('Samsung Galaxy A21S').storage).toBe('32GB');
  });
  it('refuses to default XCover — it ships in two capacities', () => {
    expect(decodeSkuAttributes('Samsung Galaxy XCOVER').storage).toBeUndefined();
  });
  it('returns nothing for an unrecognised SKU', () => {
    expect(decodeSkuAttributes('SOME RANDOM THING')).toEqual({});
    expect(decodeSkuAttributes('')).toEqual({});
  });
});

// The point of the exercise: these nine stop being flagged.
const sold = (o: Record<string, unknown>) => ({
  status: 'sold', saleDate: '2026-07-28', ...o,
} as any);

describe('the nine flagged units clear the orphan check', () => {
  it('Apple Watch — colour from the SKU, model no longer a raw code', () => {
    const d = decodeSkuAttributes('AW SE 3-40-MN');
    expect(isOrphanSoldUnit(sold({ model: d.model, colour: d.colour }))).toBe(false);
  });

  it('Galaxy A21S — storage fills, so the pair-miss cannot fire', () => {
    const d = decodeSkuAttributes('Samsung Galaxy A21S');
    expect(isOrphanSoldUnit(sold({
      model: 'Galaxy A21S', storage: d.storage, colour: DEFAULT_COLOUR,
    }))).toBe(false);
  });

  it('Galaxy XCover — no capacity known, cleared by the colour placeholder', () => {
    expect(isOrphanSoldUnit(sold({
      model: 'Galaxy XCover', colour: DEFAULT_COLOUR,
    }))).toBe(false);
  });

  it('still flags a record nobody has touched', () => {
    expect(isOrphanSoldUnit(sold({ model: 'Galaxy XCover', colour: 'Unknown' }))).toBe(true);
  });

  it('still flags a genuinely raw SKU model', () => {
    expect(isOrphanSoldUnit(sold({
      model: 'SG-A14-128-VT', storage: '128GB', colour: 'Violet',
    }))).toBe(true);
  });
});
