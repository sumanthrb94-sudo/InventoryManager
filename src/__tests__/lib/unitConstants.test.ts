/**
 * The option lists every intake path must agree on.
 *
 * unitConstants exists because private copies drift: grades once differed by
 * casing between Add Stock and Bulk Order ('Brand new' vs 'Brand New'), and
 * Firestore treated them as two values, so one grade appeared twice in every
 * breakdown. Colours repeated the mistake — three screens, three lists.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { COLOUR_PRESETS, GRADE_OPTIONS } from '../../lib/unitConstants';

describe('colour presets are shared, not copied (operator asked for Silver, 2026-09-03)', () => {
  /** Silver was missing from Add Stock while the sales-audit dropdown had
   *  offered it for months — three private COLOUR_PRESETS copies had drifted
   *  apart, the same failure the GRADE_OPTIONS docblock records. Adding a
   *  colour must now be a one-line change that every intake path picks up. */
  it('includes Silver alongside the original four', () => {
    expect(COLOUR_PRESETS).toEqual(['Black', 'White', 'Grey', 'Blue', 'Silver']);
  });

  it('neither intake screen declares its own copy', () => {
    for (const f of ['src/components/AddStockManualModal.tsx', 'src/components/BulkOrderModal.tsx']) {
      const src = readFileSync(f, 'utf8');
      expect(src, `${f} redeclares COLOUR_PRESETS`).not.toMatch(/const COLOUR_PRESETS\s*=/);
      expect(src, `${f} does not import it`).toMatch(/COLOUR_PRESETS[^;]*from '\.\.\/lib\/unitConstants'/);
    }
  });

  /** "Other" is what keeps this list short without making it a cage: a
   *  colour outside the presets is typed free-hand, not forced into the
   *  nearest option. If that escape hatch ever disappears, a five-item list
   *  becomes a data-quality problem rather than a convenience. */
  it('both screens keep the free-text "Other" escape hatch', () => {
    for (const f of ['src/components/AddStockManualModal.tsx', 'src/components/BulkOrderModal.tsx']) {
      expect(readFileSync(f, 'utf8'), f).toMatch(/__other__/);
    }
  });
});

describe('grades stayed centralised too', () => {
  it('is the canonical five, in Add Stock order', () => {
    expect(GRADE_OPTIONS).toEqual(['A', 'B', 'C', 'ONU', 'Brand new']);
  });
});
