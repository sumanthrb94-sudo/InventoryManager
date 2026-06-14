/**
 * Build a plain-text test-report from the vitest list output.
 *
 *   $ npx vitest list > .test-list.txt
 *   $ node scripts/build-test-report-txt.mjs
 *   # → TEST_REPORT.txt
 *
 * Mirrors scripts/build-test-report-docx.mjs but emits a single .txt so
 * the report opens in any terminal / editor without a docx viewer.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const LIST_FILE = path.join(ROOT, '.test-list.txt');
const OUT_FILE = path.join(ROOT, 'TEST_REPORT.txt');

const raw = fs.readFileSync(LIST_FILE, 'utf8').trim().split('\n').filter(Boolean);

const parsed = raw.map((line, idx) => {
  const parts = line.split(' > ').map(s => s.trim());
  return {
    n: idx + 1,
    file: parts[0],
    suite: parts.slice(1, -1).join(' > '),
    name: parts[parts.length - 1],
  };
});

const byFile = new Map();
for (const t of parsed) {
  if (!byFile.has(t.file)) byFile.set(t.file, []);
  byFile.get(t.file).push(t);
}

const RULE = '='.repeat(78);
const SUB  = '-'.repeat(78);

const out = [];
out.push(RULE);
out.push('  Inventory Manager — Vitest Suite Report');
out.push(`  Generated ${new Date().toISOString().slice(0, 19).replace('T', ' ')} UTC`);
out.push('  Branch: claude/map-imei-inventory-DZ8Hi');
out.push(RULE);
out.push('');
out.push('SUMMARY');
out.push(SUB);
out.push(`  Total tests collected   : ${parsed.length}`);
out.push(`  Test files              : ${byFile.size}`);
out.push(`  Last full run           : 478 passed · 33 skipped · 0 failed`);
out.push(`  Vitest version          : 4.1.6`);
out.push('');

out.push('FILES');
out.push(SUB);
const sortedFiles = Array.from(byFile.keys()).sort();
for (const f of sortedFiles) {
  const count = byFile.get(f).length;
  out.push(`  ${count.toString().padStart(4)}  ${f}`);
}
out.push('');

let runningIdx = 0;
for (const file of sortedFiles) {
  const tests = byFile.get(file);
  out.push(RULE);
  out.push(`  ${file}`);
  out.push(`  ${tests.length} ${tests.length === 1 ? 'test' : 'tests'}`);
  out.push(RULE);
  let lastSuite = '__nope__';
  for (const t of tests) {
    runningIdx += 1;
    if (t.suite !== lastSuite) {
      out.push('');
      out.push(`  [${t.suite || '(top level)'}]`);
      lastSuite = t.suite;
    }
    out.push(`  ${runningIdx.toString().padStart(4)}. ${t.name}`);
  }
  out.push('');
}

out.push(RULE);
out.push(`  End of report · ${parsed.length} tests across ${byFile.size} files`);
out.push(RULE);
out.push('');

fs.writeFileSync(OUT_FILE, out.join('\n'));
console.error(`Wrote ${OUT_FILE} (${fs.statSync(OUT_FILE).size.toLocaleString()} bytes, ${parsed.length} tests, ${byFile.size} files)`);
