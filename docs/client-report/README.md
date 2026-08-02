# Client verification report

`InventoryManager_Verification_Report.pdf` is the document handed to the
client. Everything in it is generated — no figure is transcribed by hand.

## What goes in

| Part | Source |
|---|---|
| Flow diagrams | inline SVG authored in `scripts/buildClientReport.mjs` (vector, sharp at any zoom) |
| Calculation rules | the fee schedule in `src/lib/platforms.ts`, restated for a non-engineer |
| Reconciliation | the comparison run against the operator's own master workbook |
| Unit results | vitest's JSON reporter |
| End-to-end results | `e2e-suite-results.json`, written by the suite runner |
| Screenshots | every PNG under `e2e-screenshots/`, at native resolution |

## Rebuilding it

The E2E preview server has to be up, because the report is assembled from a
real run rather than from cached numbers:

```bash
VITE_E2E=1 npx vite build --outDir dist-e2e
npx vite preview --outDir dist-e2e --port 4173 &

# capture the walkthrough at print density
E2E_BASE_URL=http://127.0.0.1:4173 E2E_DPR=3 node scripts/e2eScreenshots.mjs

# the whole E2E suite, writing e2e-suite-results.json
node scripts/runE2eSuite.mjs

# the unit suite, as JSON
npx vitest run --reporter=json --outputFile=/tmp/vitest.json

npm run report:client
```

`SKIP_PDF=1` writes the HTML only — the print pass is the slow half and
iterating on a diagram does not need it.

## Notes

- Chromium navigates to `127.0.0.1`, not `localhost`: it resolves `localhost`
  to IPv6 and `vite preview` binds IPv4 only.
- Screenshots are linked by relative path rather than base64'd in. Inlining
  459 images is over 100 MB of string for Chromium to hold before layout, and
  it falls over.
- Each figure is capped so it never prints below 150 DPI. A 390 px phone
  capture stretched across a full page prints at about 55 DPI — bigger, and
  visibly worse. Capped, it sits smaller and stays sharp.
