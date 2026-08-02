/** Run every e2e*.mjs against the preview server, record the outcome. */
import { readdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);

// Pass script names (with or without .mjs) to re-run just those and merge the
// results back into the existing file — a fix to one script should not cost a
// ninety-minute full sweep.
const only = process.argv.slice(2).map(a => a.replace(/\.mjs$/, ''));

const all = readdirSync('scripts')
  .filter(f => /^e2e.*\.mjs$/.test(f) && f !== 'e2eScreenshots.mjs')
  .sort()
  .concat('clientOnboardingCapture.mjs');
const scripts = only.length ? all.filter(f => only.includes(f.replace(/\.mjs$/, ''))) : all;
if (only.length && scripts.length !== only.length) {
  console.error('unknown script(s):', only.filter(o => !all.some(a => a.replace(/\.mjs$/, '') === o)));
  process.exit(1);
}

const OUT_FILE = 'e2e-suite-results.json';
/** Merge mode keeps every run not being re-run. */
const results = only.length && existsSync(OUT_FILE)
  ? JSON.parse(readFileSync(OUT_FILE, 'utf8')).filter(r => !only.includes(r.script.replace(/\.mjs$/, '')))
  : [];

const env = { ...process.env, E2E_BASE_URL: 'http://127.0.0.1:4173', E2E_DPR: '3' };
for (const s of scripts) {
  const t0 = Date.now();
  let out = '', ok = false;
  try {
    const r = await run('node', [`scripts/${s}`], { env, timeout: 900_000, maxBuffer: 64 * 1024 * 1024 });
    out = r.stdout + r.stderr; ok = true;
  } catch (e) {
    out = String(e.stdout ?? '') + String(e.stderr ?? '') + (e.killed ? '\n[TIMED OUT]' : '');
    ok = false;
  }
  const lines = out.trim().split('\n');
  const summary = [...lines].reverse().find(l => /\d+\s*\/\s*\d+\s*checks/.test(l)) ?? lines[lines.length - 1] ?? '';
  const fails = lines.filter(l => /^\s*FAIL\b/.test(l)).map(l => l.trim());
  const passes = lines.filter(l => /^\s*PASS\b/.test(l)).map(l => l.trim());
  // Prefer the script's own tally. Several scripts print per-check lines and
  // no summary at all, though, and reading those as "no checks ran" understated
  // the suite by hundreds of assertions — so fall back to counting the lines.
  const m = /(\d+)\s*\/\s*(\d+)\s*checks/.exec(summary);
  const pass = m ? Number(m[1]) : (passes.length + fails.length ? passes.length : null);
  const total = m ? Number(m[2]) : (passes.length + fails.length || null);
  results.push({ script: s, ok, pass, total, summary: summary.trim(), fails, passes, secs: Math.round((Date.now() - t0) / 1000) });
  const tag = (pass !== null && pass === total) ? 'PASS' : (m ? 'PART' : (ok ? 'OK  ' : 'FAIL'));
  console.log(`${tag}  ${s.padEnd(46)} ${summary.trim().slice(0, 58)}  ${Math.round((Date.now()-t0)/1000)}s`);
  results.sort((a, b) => a.script.localeCompare(b.script));
  writeFileSync(OUT_FILE, JSON.stringify(results, null, 2));
}
const totP = results.reduce((a, r) => a + (r.pass ?? 0), 0);
const totT = results.reduce((a, r) => a + (r.total ?? 0), 0);
console.log(`\nTOTAL ${totP}/${totT} checks across ${results.length} scripts`);
