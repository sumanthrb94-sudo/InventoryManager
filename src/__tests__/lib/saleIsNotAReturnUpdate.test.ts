/**
 * Marking a unit sold must not look like processing a return.
 *
 * WHAT WENT WRONG
 *
 * firestore.rules gates return processing behind a returns-manager role:
 *
 *   allow update: if isSignedIn() && staysShared()
 *                 && (!isReturnUpdate() || isReturnsManager());
 *
 * and isReturnUpdate() asked whether a field was PRESENT in the write:
 *
 *   'returnType' in request.resource.data
 *
 * On an update, `request.resource.data` is the document as it will exist
 * AFTER the write — the merged result, not the delta. recordSale's unit patch
 * deliberately writes returnType / returnDate / returnReason / returnOutcome /
 * returnLegCost / returnComments as NULL, to clear stale return state when a
 * unit begins a fresh sale cycle. So every sale carried those keys, every sale
 * was classified as a return update, and only a returns manager could mark
 * stock sold. That allowlist is empty, which leaves three admin emails.
 *
 * A sales-team member pressing "Confirm 10 Sales" therefore had the
 * inventoryUnits write denied while the sale documents (a different rule) went
 * through — and dbService swallowed the denial, so the batch reported "10
 * sold" while inventory and every dashboard stayed unchanged.
 *
 * WHY THIS TEST IS SHAPED LIKE THIS
 *
 * No Firestore emulator is available here, so the rules cannot be executed.
 * Mirroring their logic in a test would prove nothing — a mirror agrees with
 * whatever it copies. Instead this READS firestore.rules and asserts the
 * property that broke: no field the sale patch writes may be gated on mere
 * presence. Change the rule back to `'returnType' in request.resource.data`
 * and this fails, without anyone having to remember why.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RULES = readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8');

/** The body of a named function in the rules file, with or without params. */
function ruleFunction(name: string): string {
  const start = RULES.search(new RegExp(`function\\s+${name}\\s*\\(`));
  expect(start, `firestore.rules should define ${name}()`).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = RULES.indexOf('{', start); i < RULES.length; i++) {
    if (RULES[i] === '{') depth++;
    else if (RULES[i] === '}' && --depth === 0) return RULES.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces in ${name}()`);
}

/**
 * Fields recordSale() writes as null on the unit to clear stale return state.
 * Kept literal rather than imported: the point is to notice when the two drift
 * apart, and importing the patch builder would hide a rename behind a green
 * test.
 */
const CLEARED_ON_SALE = [
  'returnType', 'returnDate', 'returnReason',
  'returnOutcome', 'returnLegCost', 'returnComments',
];

describe('firestore.rules — a sale is not a return update', () => {
  const body = ruleFunction('isReturnUpdate');

  it.each(CLEARED_ON_SALE)(
    '%s is not gated on presence alone',
    field => {
      // `'x' in request.resource.data` fires for a merged doc that merely
      // carries the key — which every sale patch does, because it nulls it.
      const presenceCheck = new RegExp(`['"]${field}['"]\\s+in\\s+request\\.resource\\.data`);
      expect(
        presenceCheck.test(body),
        `isReturnUpdate() tests "${field}" by presence. recordSale writes it as `
        + 'null on every sale, so this classifies marking a unit sold as return '
        + 'processing and denies it to everyone but a returns manager.',
      ).toBe(false);
    },
  );

  it('decides by what CHANGED, not by what the document carries', () => {
    // The comparison may live in a helper the predicate delegates to, so
    // follow the calls rather than insisting it be inlined — a test that
    // demands one particular shape of the fix outlives its usefulness the
    // first time someone refactors it.
    const called = [...body.matchAll(/\b([a-zA-Z][\w]*)\s*\(/g)]
      .map(m => m[1])
      .filter(n => RULES.includes(`function ${n}(`));
    const reachable = [body, ...new Set(called)].map(n =>
      n === body ? body : ruleFunction(n)).join('\n');

    expect(reachable, 'the predicate should compare the incoming value with the stored one')
      .toMatch(/request\.resource\.data\.get\([^)]*\)\s*!=\s*resource\.data\.get\(/);
  });

  it('still catches a unit being put INTO a return state', () => {
    // The gate has to keep working; loosening it must not open the door.
    expect(body).toMatch(/returnType/);
    expect(body).toMatch(/repairedAt/);
    expect(body).toMatch(/voidedAt/);
    expect(body, 'a status flip to returned is still return processing')
      .toMatch(/status[^\n]*returned/);
  });

  it('leaves the returns-manager gate itself in place', () => {
    expect(RULES).toMatch(/allow update:.*isReturnUpdate\(\)\s*\|\|\s*isReturnsManager\(\)/);
  });
});

describe('the sale patch itself', () => {
  it('clears return fields to null rather than leaving stale values', async () => {
    // Guards the other half: if recordSale stopped clearing these, a unit
    // returned and then re-sold would keep last cycle's returnType and be
    // counted as an open return on every Returns surface.
    const src = readFileSync(resolve(process.cwd(), 'src/services/salesService.ts'), 'utf8');
    const patch = src.slice(src.indexOf('const unitPatch'), src.indexOf('await dbService.update(\'inventoryUnits\''));
    for (const f of CLEARED_ON_SALE) {
      expect(patch, `recordSale should clear ${f} on a fresh sale cycle`)
        .toMatch(new RegExp(`${f}:\\s*null`));
    }
  });
});
