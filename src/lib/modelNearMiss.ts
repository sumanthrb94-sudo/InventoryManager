/**
 * "Did you mean iPhone 13?" — the correction that goes with a held row.
 *
 * WHY THIS EXISTS SEPARATELY FROM supplierNearMiss
 *
 * The two checks answer the same question and must not answer it the same way.
 *
 * A supplier catalogue is a flat list of unrelated names, so any two of them
 * being one character apart really is suspicious. A MODEL catalogue is the
 * opposite: it is full of names that differ by exactly one character on
 * purpose. iPhone 13 / iPhone 14. Galaxy S23 / Galaxy S24. Galaxy A54 /
 * Galaxy A55. Pixel 7 / Pixel 7a. Run the supplier tolerances over a model
 * catalogue and every generation flags the one before it — which is not a
 * near-miss warning, it is a machine that cries wolf on correct data.
 *
 * THE DIGIT-TOKEN GUARD
 *
 * What separates "iPhoen 13" from "iPhone 14" is not distance — both are one
 * edit away from "iPhone 13". It is WHERE the edit falls. A model's generation
 * lives in its digit-bearing tokens ("13", "s24", "a55", "7a"), and those are
 * never typed by accident into another valid model: an operator who means the
 * S24 does not produce the S23 by fumbling a key and then have the result
 * happen to be a phone that also exists.
 *
 * So: tokens containing a digit must match EXACTLY. Only the letters around
 * them are allowed to be wrong. "iPhone 13" vs "iPhoen 13" — digit token "13"
 * on both sides, letters transposed — is a typo. "Galaxy S24 Ultra" vs
 * "Galaxy S23 Ultra" is two different phones, and this check stays quiet.
 *
 * The exception is checked first: when the letters and digits are identical in
 * sequence and only spacing or punctuation differs ("iPhone13" vs "iPhone 13"),
 * there is no generation ambiguity to protect against and the guard would
 * wrongly suppress the strongest signal there is. normalizeBucketModel folds
 * repeated whitespace but not spaces themselves, so that pair really does miss
 * the catalogue and really does need saying.
 *
 * WHAT THIS IS FOR
 *
 * The sales importer HOLDS a row whose model is not in the admin catalogue —
 * it will not mint a model from free text, because that is how supplier
 * product codes became model names. A held row needs a way forward that is not
 * "add a second catalogue entry spelled slightly differently", which is the
 * failure this whole gate exists to prevent. The recommendation IS that way
 * forward: one click puts the row on the catalogue name that already exists.
 *
 * A recommendation, never an automatic correction. The operator picks.
 */

import { boundedEditDistance } from './supplierNearMiss';

export interface ModelNearMiss {
  /** The model name exactly as it appears in the file. */
  candidate: string;
  /** The catalogue model it resembles, in the catalogue's own spelling. */
  match: string;
  /** Edit distance after case/space folding. 0 = same characters throughout. */
  distance: number;
  /**
   * `punctuation` — same characters, different spacing ("iPhone13").
   * `typo` — one or two letter edits away, generation digits identical.
   */
  kind: 'punctuation' | 'typo';
}

/** Case and surrounding whitespace folded; inner spacing collapsed. */
const soft = (s: string) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Letters and digits only — what survives when spacing and punctuation differ. */
const hard = (s: string) => soft(s).replace(/[^a-z0-9]/g, '');

/**
 * The generation-bearing part of a model name: every whitespace-separated
 * token that contains at least one digit, in order.
 *
 * "galaxy s24 ultra 256gb" → "s24|256gb". "iphone se" → "" (no digits at all,
 * so there is no generation to protect and the letter check stands alone).
 */
function digitTokens(s: string): string {
  return soft(s)
    .split(' ')
    .filter(t => /\d/.test(t))
    .join('|');
}

/**
 * Is the difference between two generation strings a single transposition of
 * the same characters — "41" for "14", "s42" for "s24"?
 *
 * This is the one crack the guard above is allowed to leave open. The guard
 * exists because a one-character difference in the generation is usually a
 * DIFFERENT PRODUCT: 13 and 14, S23 and S24, A54 and A55 all exist, and all
 * are one substitution apart. But a transposition is a different animal — it
 * cannot change which digits are present, only their order, and no two real
 * phones in a catalogue are digit-anagrams of one another. There is no iPhone
 * 41 to confuse with the iPhone 14, no Galaxy S42 shadowing the S24.
 *
 * Transposing two adjacent characters is also among the commonest ways to
 * mistype a number, so refusing it left the check silent on a typo the
 * operator will actually make.
 *
 * Both conditions are required. Same characters alone would admit "1234" and
 * "4321"; distance alone would admit "13" and "14".
 */
function isDigitTransposition(a: string, b: string): boolean {
  if (!a || !b || a === b) return false;
  const sorted = (s: string) => [...s].sort().join('');
  if (sorted(a) !== sorted(b)) return false;
  return boundedEditDistance(a, b, 1) === 1;
}

/**
 * How far apart two model names may be and still be worth querying.
 *
 * Tighter than the supplier scale, and deliberately: two model names of the
 * same length are far more likely to be two real products than two spellings
 * of one. "iPhone SE" and "iPhone XR" are nine characters and two edits apart,
 * and both exist.
 */
function toleranceFor(len: number): number {
  if (len <= 4) return 0;     // too short to tell a typo from a name
  if (len <= 14) return 1;
  return 2;
}

/**
 * The catalogue model a held name most resembles, or null if none is close.
 *
 * An exact match (after case/spacing folding) returns null — that model is not
 * unknown at all, and the row would not have been held.
 */
export function findModelNearMiss(
  candidate: string,
  catalogNames: string[],
): ModelNearMiss | null {
  const softCandidate = soft(candidate);
  const hardCandidate = hard(candidate);
  if (!hardCandidate) return null;

  const candidateDigits = digitTokens(candidate);
  let best: ModelNearMiss | null = null;

  for (const name of catalogNames) {
    const softName = soft(name);
    if (!softName || softName === softCandidate) continue;   // not unknown

    // Same characters, different spacing. Checked before the digit guard
    // because there is no generation ambiguity here — the digits are present
    // and in the same order, just packed differently.
    if (hard(name) === hardCandidate) {
      return { candidate, match: name, distance: 0, kind: 'punctuation' };
    }

    // Generation must match exactly — or differ only by a transposition of
    // the same characters. This is what keeps the S23 from being reported as
    // a misspelling of the S24 while still catching "iPhone 41".
    const nameDigits = digitTokens(name);
    if (nameDigits !== candidateDigits
        && !isDigitTransposition(nameDigits, candidateDigits)) continue;

    const max = toleranceFor(Math.min(softCandidate.length, softName.length));
    if (max === 0) continue;

    const distance = boundedEditDistance(softCandidate, softName, max);
    if (distance <= max && (!best || distance < best.distance)) {
      best = { candidate, match: name, distance, kind: 'typo' };
    }
  }

  return best;
}
