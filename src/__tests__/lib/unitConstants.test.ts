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
import { extractDeviceFromText } from '../../lib/ocr/deviceExtractor';

describe('colour presets are shared, not copied (operator asked for Silver, 2026-09-03)', () => {
  /** Silver was missing from Add Stock while the sales-audit dropdown had
   *  offered it for months — three private COLOUR_PRESETS copies had drifted
   *  apart, the same failure the GRADE_OPTIONS docblock records. Adding a
   *  colour must now be a one-line change that every intake path picks up.
   *  Purple and Violet were added the same way on 2026-09-22, then Navy. */
  it('includes Silver, Purple, Violet and Navy alongside the original four', () => {
    expect(COLOUR_PRESETS).toEqual(
      ['Black', 'White', 'Grey', 'Blue', 'Silver', 'Purple', 'Violet', 'Navy'],
    );
  });

  /** The dropdown renders COLOUR_PRESETS in order, so a new colour appended
   *  at the end leaves every existing option where the operator's thumb
   *  already expects it. Inserting one mid-list would silently move the
   *  four they tap most. */
  it('keeps the original options in their original positions', () => {
    expect(COLOUR_PRESETS.slice(0, 5)).toEqual(['Black', 'White', 'Grey', 'Blue', 'Silver']);
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

/**
 * extractColour walks COLOR_SYNONYMS in insertion order and returns the first
 * synonym the OCR text CONTAINS. That makes position, not specificity, decide
 * the winner: "Navy Blue" on a box would hit the generic 'blue' entry and be
 * filed as Blue, so the operator's Navy and the scanner's Navy would land in
 * two different buckets on the same handset.
 */
describe('OCR resolves Navy before the generic blue that contains it', () => {
  it('reads "Navy" and "Navy Blue" as Navy, and plain blue as Blue', () => {
    expect(extractDeviceFromText('iPhone 14 128GB Navy').colour.value).toBe('Navy');
    expect(extractDeviceFromText('iPhone 14 128GB Navy Blue').colour.value).toBe('Navy');
    expect(extractDeviceFromText('iPhone 14 128GB Blue').colour.value).toBe('Blue');
  });

  /** Found by this test rather than in the field: the dropdown wrote 'Grey'
   *  while the scanner wrote 'Space Grey' for a box that just says "Grey",
   *  so one handset filed itself under two colours depending on which
   *  intake path it came through. A genuine "Space Grey" box still reads as
   *  Space Grey — that entry now sits above the bare one. */
  it('every preset colour survives a round trip through the scanner', () => {
    for (const colour of COLOUR_PRESETS) {
      expect(
        extractDeviceFromText(`iPhone 14 128GB ${colour}`).colour.value,
        `OCR does not read back the preset "${colour}"`,
      ).toBe(colour);
    }
  });

  it('still reads a genuine Space Grey box as Space Grey', () => {
    expect(extractDeviceFromText('iPhone 13 Pro 256GB Space Grey').colour.value).toBe('Space Grey');
    expect(extractDeviceFromText('iPhone 13 Pro 256GB Space Gray').colour.value).toBe('Space Grey');
  });
});

describe('grades stayed centralised too', () => {
  it('is the canonical five, in Add Stock order', () => {
    expect(GRADE_OPTIONS).toEqual(['A', 'B', 'C', 'ONU', 'Brand new']);
  });
});
