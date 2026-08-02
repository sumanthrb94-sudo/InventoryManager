/** Run every e2e*.mjs against the preview server, record the outcome. */
import { readdirSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);

const scripts = readdirSync('scripts')
  .filter(f => /^e2e.*\.mjs$/.test(f) && f !== 'e2eScreenshots.mjs')
  .sort();
scripts.push('clientOnboardingCapture.mjs');

const env = { ...process.env, E2E_BASE_URL: 'http://127.0.0.1:4173', E2E_DPR: '3' };
const results = [];
for (const s of scripts) {
  const t0 = Date.now();
  let out = '', ok = false;
  try {
    const r = await run('node', [`scripts/${s}`], { env, timeout: 420_000, maxBuffer: 64 * 1024 * 1024 });
    out = r.stdout + r.stderr; ok = true;
  } catch (e) {
    out = String(e.stdout ?? '') + String(e.stderr ?? '') + (e.killed ? '\n[TIMED OUT]' : '');
    ok = false;
  }
  const lines = out.trim().split('\n');
  const summary = [...lines].reverse().find(l => /\d+\s*\/\s*\d+\s*checks/.test(l)) ?? lines[lines.length - 1] ?? '';
  const m = /(\d+)\s*\/\s*(\d+)\s*checks/.exec(summary);
  const pass = m ? Number(m[1]) : null, total = m ? Number(m[2]) : null;
  const fails = lines.filter(l => /^\s*FAIL\b/.test(l)).map(l => l.trim());
  const passes = lines.filter(l => /^\s*PASS\b/.test(l)).map(l => l.trim());
  results.push({ script: s, ok, pass, total, summary: summary.trim(), fails, passes, secs: Math.round((Date.now() - t0) / 1000) });
  const tag = (pass !== null && pass === total) ? 'PASS' : (m ? 'PART' : (ok ? 'OK  ' : 'FAIL'));
  console.log(`${tag}  ${s.padEnd(46)} ${summary.trim().slice(0, 58)}  ${Math.round((Date.now()-t0)/1000)}s`);
  writeFileSync('e2e-suite-results.json', JSON.stringify(results, null, 2));
}
const totP = results.reduce((a, r) => a + (r.pass ?? 0), 0);
const totT = results.reduce((a, r) => a + (r.total ?? 0), 0);
console.log(`\nTOTAL ${totP}/${totT} checks across ${results.length} scripts`);
