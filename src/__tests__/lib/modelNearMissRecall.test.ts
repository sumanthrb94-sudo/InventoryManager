/**
 * How many typos does the model check actually CATCH?
 *
 * WHY MEASURE INSTEAD OF ASSERT
 *
 * The rest of the near-miss tests are hand-picked examples: I chose the typo,
 * so of course it is caught. That answers "does the mechanism work" and not
 * the question the operator actually asked — "my staff mistype names all day,
 * will this help them?" A check that catches the three typos its author
 * thought of is not the same as a check that catches the ones a tired person
 * makes at 6pm.
 *
 * So: generate every single-slip typo of every catalogue entry, mechanically,
 * and count. The number is asserted with a floor, so it can go up freely and
 * cannot quietly rot.
 *
 * PRECISION IS THE OTHER HALF, AND IT IS THE HALF THAT MATTERS MORE
 *
 * Recall is easy to buy — widen the tolerance and everything matches
 * something. What that buys is a check that fires on correct data, which gets
 * ignored, which turns every false positive into a false negative. So the
 * precision suite below is absolute: NO genuine catalogue entry may be
 * reported as a misspelling of another, and no generated typo may be pointed
 * at the wrong entry. Those are `toBe`, not floors.
 *
 * THE DIGIT BLIND SPOT IS MEASURED, NOT HIDDEN
 *
 * Typos are counted in two groups. A slip among the LETTERS is catchable. A
 * slip among the GENERATION DIGITS mostly is not, on purpose: "S23" and "S24"
 * are one substitution apart and both are real, so a check that guessed there
 * would misfile sales. The one exception is a transposition, which cannot
 * change which digits are present. Both rates are printed.
 */

import { describe, it, expect } from 'vitest';
import { findModelNearMiss } from '../../lib/modelNearMiss';

/** A realistic catalogue: mixed brands, and full of names that differ by one
 *  character ON PURPOSE. Recall measured against a catalogue of unrelated
 *  names would be meaninglessly high. */
const CATALOG = [
  'iPhone 13', 'iPhone 13 Pro', 'iPhone 13 Pro Max',
  'iPhone 14', 'iPhone 14 Plus', 'iPhone 15 Pro Max', 'iPhone SE',
  'Galaxy S22 Ultra', 'Galaxy S23 Ultra', 'Galaxy S24 Ultra',
  'Galaxy A14', 'Galaxy A34', 'Galaxy A54', 'Galaxy A55',
  'Galaxy Z Fold 5', 'Galaxy Z Flip 5', 'Galaxy Tab A8',
  'Pixel 7', 'Pixel 7a', 'Pixel 8 Pro',
  'Redmi Note 12', 'Redmi Note 13 Pro',
];

const KEYBOARD_NEIGHBOUR: Record<string, string> = {
  a: 's', b: 'v', c: 'x', d: 'f', e: 'r', f: 'g', g: 'h', h: 'j', i: 'o',
  j: 'k', k: 'l', l: 'k', m: 'n', n: 'm', o: 'p', p: 'o', q: 'w', r: 't',
  s: 'a', t: 'y', u: 'i', v: 'b', w: 'e', x: 'c', y: 'u', z: 'x',
};

/**
 * Every single-slip mutation of `name`, tagged by whether the slip lands on a
 * digit-bearing token (the generation) or on the letters around it.
 *
 * The four shapes are the ones typing research keeps finding: transposition,
 * omission, insertion (a doubled key), and substitution by a keyboard
 * neighbour. Spacing slips are added separately because they are not
 * positional.
 */
function typosOf(name: string): Array<{ typo: string; zone: 'letters' | 'digits' }> {
  const out: Array<{ typo: string; zone: 'letters' | 'digits' }> = [];
  const tokens = name.split(' ');
  // A character position belongs to the generation if its whole token has a
  // digit in it — "S24" and "128GB" are generation, "Galaxy" and "Ultra" are
  // not, and the guard treats them that way.
  const zoneAt = (i: number): 'letters' | 'digits' => {
    let cursor = 0;
    for (const t of tokens) {
      if (i >= cursor && i < cursor + t.length) return /\d/.test(t) ? 'digits' : 'letters';
      cursor += t.length + 1;
    }
    return 'letters';
  };
  const push = (typo: string, i: number) => {
    if (typo !== name && typo.trim()) out.push({ typo, zone: zoneAt(i) });
  };

  for (let i = 0; i < name.length; i++) {
    const ch = name[i];
    if (ch === ' ') continue;
    // transposition with the next character
    if (i + 1 < name.length && name[i + 1] !== ' ') {
      push(name.slice(0, i) + name[i + 1] + name[i] + name.slice(i + 2), i);
    }
    // omission
    push(name.slice(0, i) + name.slice(i + 1), i);
    // insertion — the same key struck twice, the commonest insertion there is
    push(name.slice(0, i) + ch + name.slice(i), i);
    // substitution by a keyboard neighbour
    const lower = ch.toLowerCase();
    const neighbour = KEYBOARD_NEIGHBOUR[lower];
    if (neighbour) {
      const sub = ch === lower ? neighbour : neighbour.toUpperCase();
      push(name.slice(0, i) + sub + name.slice(i + 1), i);
    }
  }
  // Spacing slips, which are not positional and always land in the letters
  // bucket: the space run out, or a stray one in the middle.
  if (name.includes(' ')) {
    out.push({ typo: name.replace(/ /g, ''), zone: 'letters' });
    out.push({ typo: name.replace(' ', '  '), zone: 'letters' });
  }
  out.push({ typo: name.toUpperCase(), zone: 'letters' });
  out.push({ typo: name.toLowerCase(), zone: 'letters' });
  return out;
}

/** A typo is only "caught" if it lands on the RIGHT entry. Being offered a
 *  correction to the wrong phone is worse than being offered none — the
 *  operator takes it and the sale is filed against a product they never sold. */
function scoreAgainst(catalog: string[]) {
  let lettersTotal = 0, lettersHit = 0;
  let digitsTotal = 0, digitsHit = 0;
  const misdirected: string[] = [];

  for (const truth of catalog) {
    for (const { typo, zone } of typosOf(truth)) {
      // A mutation that happens to BE another catalogue entry is not a typo at
      // all — it is a different product, correctly spelled. Skip it.
      if (catalog.some(c => c.toLowerCase() === typo.trim().toLowerCase())) continue;
      const hit = findModelNearMiss(typo, catalog);
      const right = hit?.match === truth;
      if (hit && !right) misdirected.push(`"${typo}" (meant ${truth}) → offered ${hit.match}`);
      if (zone === 'digits') { digitsTotal++; if (right) digitsHit++; }
      else { lettersTotal++; if (right) lettersHit++; }
    }
  }
  return { lettersTotal, lettersHit, digitsTotal, digitsHit, misdirected };
}

describe('typo recall over a generated corpus', () => {
  const score = scoreAgainst(CATALOG);
  const pct = (hit: number, total: number) => Math.round((hit / total) * 1000) / 10;

  it('reports the rates', () => {
    console.log(
      `\n  letters: ${score.lettersHit}/${score.lettersTotal} (${pct(score.lettersHit, score.lettersTotal)}%)`
      + `\n  digits:  ${score.digitsHit}/${score.digitsTotal} (${pct(score.digitsHit, score.digitsTotal)}%)`
      + `\n  misdirected: ${score.misdirected.length}`);
    expect(score.lettersTotal).toBeGreaterThan(500);
  });

  /** THE FLOOR. A slip among the letters is the case this feature exists for,
   *  and it has to be caught most of the time or the operator learns to ignore
   *  the panel. Raise this when the check improves; never lower it to make a
   *  change pass. */
  it('catches the great majority of letter typos', () => {
    expect(pct(score.lettersHit, score.lettersTotal)).toBeGreaterThanOrEqual(85);
  });

  /** ZERO. Not a floor — an absolute. Pointing a typo at the wrong phone is
   *  the one outcome worse than staying silent, because the operator will take
   *  the suggestion and file the sale against a product they never sold. */
  it('never points a typo at the wrong catalogue entry', () => {
    expect(score.misdirected).toEqual([]);
  });

  /** The generation blind spot, stated as a number rather than a paragraph.
   *  It is LOW on purpose: S23/S24 and A54/A55 are one substitution apart and
   *  both real. What lands here is the transposition case, which is safe. */
  it('is deliberately conservative inside the generation digits', () => {
    expect(pct(score.digitsHit, score.digitsTotal)).toBeLessThan(50);
    expect(score.digitsHit).toBeGreaterThan(0);   // transpositions still land
  });
});

describe('precision — no genuine entry is ever called a misspelling', () => {
  for (const entry of CATALOG) {
    it(`${entry}`, () => {
      expect(findModelNearMiss(entry, CATALOG.filter(m => m !== entry))).toBeNull();
    });
  }
});
