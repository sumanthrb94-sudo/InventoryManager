/**
 * "Did you mean NIHAL?" — catching a mistyped supplier before it becomes one.
 *
 * WHY
 *
 * The inventory importer creates any supplier name it has not seen before. That
 * is deliberate: onboarding a supplier is ordinary, there is no curated supplier
 * catalogue to gate against, and blocking the import over one would be worse
 * than the problem. Model names are gated; suppliers are not.
 *
 * The cost is that a TYPO becomes a real supplier. "NIHAAL" for "NIHAL" creates
 * a second record, and from that moment the supplier's purchase history is split
 * across two names with nothing indicating anything went wrong. The preview does
 * list new suppliers, but as a comma-separated line — easy to skim past at eight
 * names and useless at thirty.
 *
 * So: flag a new name that closely resembles an existing one, and say which.
 * A WARNING, never a block. The operator knows their suppliers; the software
 * does not, and "MHL" and "MKL" really could be two different companies.
 *
 * TUNING
 *
 * False positives are cheap here (a glance) and false negatives are expensive
 * (a silently split ledger), but a check that cries wolf gets ignored, which
 * converts every false positive into a false negative. The thresholds below are
 * checked in supplierNearMiss.test.ts against a real supplier list — MHL, NANAK,
 * IMAX, NIHAL, MOBILE KIT, RR STOCK, ABC, BUNTY — with the requirement that no
 * pair of them flags each other.
 */

export interface SupplierNearMiss {
  /** The new name, exactly as it appears in the file. */
  candidate: string;
  /** The existing supplier it resembles, in that supplier's own spelling. */
  match: string;
  /** Edit distance between the two, after normalisation. 0 = same letters. */
  distance: number;
  /**
   * `punctuation` — identical once case, spaces and punctuation are removed
   * ("MOBILE KIT" vs "MOBILEKIT"). Near-certain, and worth saying differently
   * from a letter-level typo.
   * `typo` — one or two character edits away.
   */
  kind: 'punctuation' | 'typo';
}

/** Case and surrounding whitespace folded; inner spacing collapsed. */
const soft = (s: string) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Letters and digits only — what survives when spacing and punctuation differ. */
const hard = (s: string) => soft(s).replace(/[^a-z0-9]/g, '');

/**
 * Damerau-Levenshtein (optimal string alignment), abandoned once it exceeds
 * `max`.
 *
 * TRANSPOSITION COSTS ONE, not two. Swapping adjacent characters — "NHIAL" for
 * "NIHAL" — is among the commonest ways to mistype a word, and plain
 * Levenshtein charges it as two substitutions. On a five-letter supplier name
 * that puts it outside tolerance, so the single most likely typo was the one
 * shape this check could not see.
 *
 * The cap is what makes this safe to run over every new name against every
 * existing supplier: once a row's best possible score is already too far, there
 * is no reason to finish the matrix.
 */
export function boundedEditDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  // Three rows: the transposition case reaches two back on both axes.
  let prevPrev = new Array<number>(b.length + 1).fill(0);
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowBest = curr[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(
        prev[j] + 1,               // deletion
        curr[j - 1] + 1,           // insertion
        prev[j - 1] + cost,        // substitution
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, prevPrev[j - 2] + 1);   // transposition
      }
      curr[j] = best;
      if (best < rowBest) rowBest = best;
    }
    if (rowBest > max) return max + 1;
    [prevPrev, prev, curr] = [prev, curr, prevPrev];
  }
  return prev[b.length];
}

/**
 * How far apart two supplier names may be and still be worth querying.
 *
 * Scaled by length, because one character means far more in a three-letter
 * name than in a twelve-letter one: "ABC" and "ABD" differ by a third of
 * themselves, "MOBILE WHOLESALE" and "MOBILE WHOLESALF" by a sixteenth.
 */
function toleranceFor(len: number): number {
  if (len <= 2) return 0;    // too short to distinguish a typo from a name
  if (len <= 8) return 1;
  return 2;
}

/**
 * The existing supplier a new name most resembles, or null if none is close.
 *
 * An exact match (after case/spacing folding) returns null — that name is not
 * new at all, and the importer will have matched it already.
 */
export function findSupplierNearMiss(
  candidate: string,
  existing: string[],
): SupplierNearMiss | null {
  const softCandidate = soft(candidate);
  const hardCandidate = hard(candidate);
  if (!hardCandidate) return null;

  let best: SupplierNearMiss | null = null;

  for (const name of existing) {
    const softName = soft(name);
    if (!softName || softName === softCandidate) continue;   // not new

    // Same letters, different spacing or punctuation. Checked first because it
    // is a stronger signal than any edit distance and should not lose to one.
    if (hard(name) === hardCandidate) {
      return { candidate, match: name, distance: 0, kind: 'punctuation' };
    }

    const max = toleranceFor(Math.min(softCandidate.length, softName.length));
    if (max === 0) continue;

    const distance = boundedEditDistance(softCandidate, softName, max);
    if (distance <= max && (!best || distance < best.distance)) {
      best = { candidate, match: name, distance, kind: 'typo' };
    }
  }

  return best;
}

/**
 * Run the check across a whole import's worth of new names.
 *
 * Compares against existing suppliers only, not against the other new names in
 * the same file: two new suppliers that resemble each other are far more often
 * two real companies than one typed twice, and flagging those pairs was noise
 * without a decision attached.
 */
export function findSupplierNearMisses(
  newNames: string[],
  existing: string[],
): SupplierNearMiss[] {
  const out: SupplierNearMiss[] = [];
  for (const n of newNames) {
    const hit = findSupplierNearMiss(n, existing);
    if (hit) out.push(hit);
  }
  return out;
}
