import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Regression guard for E2E finding #4 (and the latent returnEvents data-loss
 * bug). The Firestore catch-all `match /{document=**} { allow ... if false }`
 * denies every collection not explicitly granted, so both `auditLog` and
 * `returnEvents` MUST have their own rule blocks — otherwise their writes are
 * rejected and the data only ever lives in the in-memory cache (vanishing on
 * reload). This test fails loudly if either grant is ever removed.
 */
describe('firestore.rules grants the lifecycle + audit collections', () => {
  const rules = readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8');

  it('has a returnEvents rule allowing signed-in read/write', () => {
    expect(rules).toMatch(/match\s+\/returnEvents\/\{[^}]+\}\s*\{\s*allow\s+read,\s*write:\s*if\s+isSignedIn\(\);/);
  });

  it('has an auditLog rule allowing signed-in read/write', () => {
    expect(rules).toMatch(/match\s+\/auditLog\/\{[^}]+\}\s*\{\s*allow\s+read,\s*write:\s*if\s+isSignedIn\(\);/);
  });

  it('still ends with a deny-all catch-all (the reason explicit grants are required)', () => {
    expect(rules).toMatch(/match\s+\/\{document=\*\*\}\s*\{\s*allow\s+read,\s*write:\s*if\s+false;/);
  });
});
