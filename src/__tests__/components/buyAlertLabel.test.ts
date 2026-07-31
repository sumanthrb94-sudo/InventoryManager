/**
 * The Buy screen's Sold Out / Running Low lists showed the brand twice on
 * some rows — "Samsung SAMSUNG GALAXY A14 64GB" — while others on the same
 * screen read correctly as "Samsung Galaxy A52 128GB".
 *
 * Cause: buildAlertLabel prefixed the brand unconditionally. Rows whose
 * model text already carried the brand word inside it (legacy imports
 * stored as "SAMSUNG GALAXY A14" rather than brand "Samsung" + model
 * "Galaxy A14") therefore got it a second time. Rows with a properly split
 * model were unaffected, which is why only some entries looked doubled.
 *
 * Strings below are taken verbatim from the operator's 2026-07-31 screenshot.
 */
import { describe, it, expect } from 'vitest';
import { buildAlertLabel } from '../../components/BuySheet';

describe('buildAlertLabel — brand must not be printed twice', () => {
  it.each([
    ['Samsung', 'SAMSUNG GALAXY TAB A8 LTE', '64GB'],
    ['Samsung', 'SAMSUNG GALAXY A14',        '64GB'],
    ['Samsung', 'SAMSUNG GALAXY A15',        '128GB'],
    ['Samsung', 'SAMSUNG GALAXY A06 4G',     '128GB'],
    ['Apple',   'APPLE IPHONE SE 3',         '64GB'],
  ])('does not repeat %s when the model already contains it', (brand, model, storage) => {
    const { label } = buildAlertLabel(brand, model, storage);
    // The brand word appears exactly once, however it is cased.
    const hits = label.toLowerCase().split(brand.toLowerCase()).length - 1;
    expect(hits).toBe(1);
    expect(label.toLowerCase()).not.toContain(`${brand.toLowerCase()} ${brand.toLowerCase()}`);
  });

  it('still prefixes the brand when the model does NOT carry it', () => {
    // These rows already rendered correctly and must not regress.
    expect(buildAlertLabel('Samsung', 'Galaxy A52', '128GB').label).toBe('Samsung Galaxy A52 128GB');
    expect(buildAlertLabel('Apple', 'iPhone 12', '64GB').label).toBe('Apple iPhone 12 64GB');
  });

  it('keeps the model when there is no brand at all', () => {
    expect(buildAlertLabel('', 'Galaxy A52', '128GB').label).toBe('Galaxy A52 128GB');
  });

  it('matches the brand case-insensitively, since stored text is often shouty', () => {
    expect(buildAlertLabel('Samsung', 'samsung galaxy a14', '64GB').label)
      .toBe('samsung galaxy a14 64GB');
  });

  it('falls back to the raw model when nothing composable is left', () => {
    expect(buildAlertLabel('', '', '').label).toBe('');
  });
});
