/**
 * Grade extraction from OCR text.
 *
 * Grade sets the price of a handset, so a wrong grade is a wrong number on an
 * invoice rather than a cosmetic slip. Two faults lived here together and both
 * failed quietly — the field either came back blank, or came back confidently
 * wrong at 0.88.
 *
 *   THE SUBSTRING LOOKUP PROMOTED EVERYTHING TO A. GRADE_MAPPING was searched
 *   with `matched.includes(key)`. The word "grade" contains an "a", so the key
 *   'a' matched inside "grade b" and "grade c" alike and both reported A.
 *   "Fair" did the same and reported A where it should have said C.
 *
 *   PUNCTUATION AND "A+" NEVER MATCHED AT ALL. `Grade\s*[A-C]` left no room
 *   for the colon that real labels use, and `A\+\b` is unsatisfiable — a word
 *   boundary needs a word character beside it and "+" is not one — so A+ could
 *   not match under any input.
 */
import { describe, it, expect } from 'vitest';
import { extractGrade } from '../../lib/ocr/deviceExtractor';

const grade = (s: string) => extractGrade(s).value;

describe('extractGrade', () => {
  it.each([
    ['Grade A', 'A'],
    ['Grade B', 'B'],
    ['Grade C', 'C'],
  ])('reads a bare label: %s → %s', (text, want) => {
    expect(grade(text)).toBe(want);
  });

  it.each([
    ['Grade: A', 'A'],
    ['Grade: B', 'B'],
    ['Grade: C', 'C'],
    ['Grade - B', 'B'],
    ['Grade:C', 'C'],
  ])('reads a punctuated label, as real labels are written: %s → %s', (text, want) => {
    // These are the common form on a device label and on marketplace listings,
    // and every one of them returned blank before.
    expect(grade(text)).toBe(want);
  });

  it.each([
    ['A+', 'A'],
    ['Grade: A+', 'A'],
    ['Grade A+', 'A'],
  ])('reads A+, which could not match at all before: %s → %s', (text, want) => {
    expect(grade(text)).toBe(want);
  });

  it.each([
    ['Excellent', 'A'],
    ['Like New', 'A'],
    ['Brand New', 'A'],
    ['Good', 'B'],
    ['Very Good', 'B'],
    ['Fair', 'C'],
    ['Acceptable', 'C'],
    ['Refurbished', 'C'],
    ['ONU', 'C'],
  ])('maps the word forms to their own grade: %s → %s', (text, want) => {
    expect(grade(text)).toBe(want);
  });

  it('does not read B or C as A', () => {
    // The regression that mattered: not a missing value, a confident wrong one.
    // A C-grade handset priced as an A is a real loss on a real sale.
    for (const [text, wrong] of [['Grade B', 'A'], ['Grade C', 'A'], ['Fair', 'A']] as const) {
      expect(grade(text), `${text} must not report ${wrong}`).not.toBe(wrong);
    }
  });

  it('does not invent a grade from ordinary device text', () => {
    // A bare capital letter is not a grade. OCR output is full of stray
    // capitals, and reading one as a grade would misprice the unit — so a
    // single letter still needs its "Grade" label to count.
    for (const text of [
      'Samsung Galaxy S24 Ultra',
      'Storage: 512GB',
      'IMEI: 358622163345827',
      'Colour: Titanium Black',
    ]) {
      expect(grade(text), `${text} is not a grade`).toBe('');
    }
  });

  it('reports no confidence when it found nothing', () => {
    // A blank value carrying a high confidence would let an empty grade
    // through an autofill threshold.
    expect(extractGrade('Samsung Galaxy S24 Ultra')).toEqual({ value: '', confidence: 0 });
  });

  it('pulls the grade out of a full OCR block', () => {
    const text = `
      Brand: Samsung
      Model: Galaxy S24 Ultra
      IMEI: 358622163345827
      Storage: 512GB
      Grade: A+
      Color: Titanium Black
    `;
    expect(grade(text)).toBe('A');
  });
});
