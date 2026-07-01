# AGENTS.md — MOBILEPHONEMARKET Inventory Manager

> This file is written for AI coding agents. It assumes no prior knowledge of the project and only describes what is actually present in the codebase. Read this before modifying code, adding features, or debugging.

---

## 1. Project overview

**MOBILEPHONEMARKET — Inventory Manager** is a production web application for tracking mobile-device inventory, sales, returns, and supplier relationships. It is used by a UK/India reseller team and is built as a single-page React application backed by Firebase.

Core capabilities visible in the code:

- IMEI-level inventory tracking (phones, tablets, watches).
- Bulk Excel import of stock and sales reports.
- Supplier-held stock (SHS) workflow: receive aggregate supplier rows, scan individual IMEIs when they arrive.
- Multi-marketplace sales recording (Amazon, Backmarket/MBM, eBay, OnBuy) with per-platform commission/VAT math.
- Returns processing with two-step Tech-QC → CRM hand-off.
- Admin reporting with Excel/PDF export.
- Real-time team notifications and a notice board.
- OCR-based device extraction from images during stock intake.
- Firebase Auth sign-in with role-based navigation (admin / UK warehouse ops / India sell ops).

The project was originally generated in Google AI Studio and is now maintained as a real production app.

---

## 2. Technology stack

| Layer | Choice |
|-------|--------|
| Framework | React 19 (functional components + hooks) |
| Language | TypeScript 5.8 |
| Build tool | Vite 6 |
| Styling | Tailwind CSS 4 with CSS-first `@theme` tokens (`src/index.css`) |
| Backend | Firebase (Auth, Firestore, Storage) |
| Auth | Firebase email/password |
| Routing | None — the app is a single-page tab shell (`src/App.tsx`) |
| State (global) | `InventoryStoreProvider` (`src/lib/inventoryStore.tsx`) backed by Firestore snapshot listeners |
| Testing | Vitest 4 + `@testing-library/react` + jsdom |
| Observability | Sentry React + Vercel Analytics + Vercel Speed Insights (optional, env-gated) |
| Runtime target | Vercel (static SPA from `dist/`) |

Notable heavy dependencies that are code-split by Vite:

- `recharts` (charts)
- `exceljs` (Excel import/export)
- `jspdf` + `jspdf-autotable` (PDF reports)
- `html5-qrcode` (barcode/IMEI scanner)
- `tesseract.js` (OCR)

---

## 3. Project structure

```
InventoryManager/
├── .github/workflows/ci.yml   # CI pipeline
├── public/                    # Static assets + sample Excel files
├── dist/                      # Vite production build output
├── scripts/                   # Node/TS utilities (team provisioning, master-file loaders, reports)
├── src/
│   ├── App.tsx                # Root shell: auth, navigation, tab routing, notifications
│   ├── main.tsx               # React root + Sentry + Vercel + stale-chunk recovery
│   ├── index.css              # Tailwind theme, global polish, focus rings, scrollbars
│   ├── types.ts               # Canonical TypeScript interfaces/types
│   ├── vite-env.d.ts          # Vite env types
│   ├── components/            # React components (flat, grouped by feature)
│   │   ├── OCR/               # OCR UI helpers
│   │   └── StockIntakeFlow/   # Multi-step stock intake wizard
│   ├── lib/                   # Business logic, helpers, Firestore abstraction
│   │   ├── ocr/               # OCR engine, image preprocessing, text patterns
│   │   ├── migrations/        # Firestore data-fix scripts
│   │   └── __tests__/         # Library unit tests
│   ├── services/              # Centralised write surfaces (THE place for business rules)
│   ├── hooks/                 # Shared React hooks
│   ├── data/                  # Static data / walkthrough issue definitions
│   └── __tests__/             # Vitest tests (components, integration, API, regressions)
├── client.config.cjs          # Master client config: business identity, Excel mapping, Firebase paths
├── firebase-applet-config.json# Firebase client config (checked in)
├── firestore.rules            # Production Firestore security rules
├── firestore.indexes.json     # Firestore composite indexes
├── vercel.json                # Vercel routing, build command, security headers
├── vite.config.ts             # Vite + Vitest config
├── tsconfig.json              # TypeScript config (paths alias `@/*` → `./*`)
├── package.json
└── .env.example               # Env vars reference
```

---

## 4. Build, dev and test commands

All commands run from the project root.

```bash
# Install dependencies
npm install

# Dev server (port 3000, host 0.0.0.0, HMR enabled)
npm run dev

# Production build (outputs to dist/)
npm run build

# Preview the production build locally
npm run preview

# Type-check only (the "lint" script in this repo is tsc --noEmit)
npm run lint

# Run tests once
npm test

# Watch tests
npm run test:watch

# Coverage report (covers src/lib/**/*.ts by default)
npm run test:coverage

# Clean build output
npm run clean
```

Specialised data/import scripts (see also `client.config.cjs`):

```bash
# Parse the master inventory Excel workbook to JSON
node import_excel.cjs
node import_excel.cjs --file <xlsx> --verbose --public public/imported_inventory.json

# Seed sample data into public/imported_inventory.json
npm run seed:public

# Provision Firebase Auth team accounts (requires firebase-service-account.json)
npm run users:provision
```

---

## 5. Runtime architecture

### 5.1 Authentication and roles

- Firebase Auth email/password. The Firebase Console is the source of truth for allowed users.
- `src/lib/firebase.ts` contains hard-coded `ADMIN_EMAILS` and region allowlists (`UK_OPS_EMAILS`, `INDIA_OPS_EMAILS`).
- Admin sees all tabs; UK ops see **Stock Intake** + Returns; India ops see **Inventory** (sell) + Returns. Unknown users default to seeing both Buy and Sell.
- `isAdmin` / `userRegion` / `canBuy` / `canSell` are **UX gates only**. The real boundary is `firestore.rules`.

### 5.2 Data model

Firestore uses a **shared-ownership** model: every doc carries `ownerId: 'shared'`. This lets the whole signed-in team read/write one dataset.

Main collections (defined in `src/lib/dbService.ts`):

- `inventoryUnits` — one doc per physical device, keyed by IMEI/serial.
- `sales` — one doc per marketplace transaction; voided sales persist for audit.
- `batches` — supplier packing slip / purchase batches.
- `suppliers` — supplier master data.
- `activeListings` — platform listings.
- `importBatches` — provenance for every bulk import.
- `inventoryAggregates` — rolled-up model rows from the master INVENTORY sheet.
- `marketplaceFees` — per-marketplace fee schedule (admin-managed).
- `supplierWhatsappUpdates` — free-text supplier feed.
- `inventoryEvents` — audit log.
- `dailyUpdates` / `notices` / `models` / `sourceDocuments`.

### 5.3 State management

- `InventoryStoreProvider` subscribes to Firestore collections via `dbService.subscribeToCollection`.
- The store normalises `model`/`brand`/`storage`/`sku` from raw strings on every snapshot using `parseBrandModelStorage`.
- Components read from the store with `useInventoryStore()`. Writes go through `dbService` or the service layers below.

### 5.4 Service-layer boundaries

Important convention: **do not call `dbService.create('inventoryUnits', …)` directly from UI components**. All writes that own business rules route through:

- `src/services/inventoryService.ts` — adding units manually, SHS receipt, IMEI backfill, duplicate checks, strict IMEI validation, buy-price validation.
- `src/services/salesService.ts` — recording sales, computing financials, flipping unit status, composite doc IDs.
- `src/services/listingService.ts` — listing operations.
- `src/services/shsService.ts` — admin-only deletion of SHS (incoming) stock, including audit log + notice-board post.

Centralising rules here means a future tightening (e.g. new validation) updates every surface at once.

---

## 6. Code organisation and conventions

### 6.1 File naming

- Components: `PascalCase.tsx`.
- Library modules: `camelCase.ts` or `camelCase.tsx` for React-specific hooks.
- Tests: co-located in `src/__tests__/` or `src/lib/__tests__/` with `.test.ts(x)` suffix.
- Scripts at repo root and in `scripts/` use `.cjs`, `.mjs`, `.ts` or `.mts` as appropriate.

### 6.2 Naming and casing rules

- Firestore collection names are **camelCase** in code (e.g. `inventoryUnits`), matching the TypeScript interfaces.
- Internal app fields are camelCase. Legacy helpers `toSnake`/`toCamel`/`dbToApp`/`appToDb` exist but are mostly for backward compatibility.
- `ownerId` is always `'shared'` in this app.
- Sale doc IDs are composite: `${marketplace}__${orderNumber}__${imei|sku|'inapp'}` to prevent duplicates across imports.

### 6.3 Path alias

`tsconfig.json` defines `"@/*": ["./*"]`, and `vite.config.ts` resolves `@` to the repo root. In practice most source files use relative imports (`./lib/...`, `../types`); the alias is available for absolute imports when needed.

### 6.4 Styling conventions

- Tailwind utility classes are used inline. Custom tokens live in `src/index.css` under `@theme`.
- Global polish (focus rings, button press, scrollbars, autofill) is applied in `index.css` so components stay clean.
- Status pills use standard Tailwind colours (`bg-emerald-100`, `bg-amber-100`, etc.) with a global gradient overlay.
- The app is mobile-first with a bottom tab bar on small screens and a hamburger drawer on desktop.

### 6.5 Comments

The codebase uses block comments to explain *why* a decision exists, not just *what* the code does. Keep that style. Examples:

- `// ── Shared helpers ─────────────────────────────────────────────────────`
- `/** REQUIRED. Validated strict against {@link isValidImei} … */`
- Inline notes referencing bug IDs like `BUG-RP-002` and dates like `2026-06-20`.

---

## 7. Testing strategy

### 7.1 Test runner config

Configured in `vite.config.ts`:

- `environment: 'node'` for most tests.
- `include: ['src/__tests__/**/*.test.ts']` is the base include; some `.tsx` tests set their own environment with `// @vitest-environment jsdom`.
- `globals: true`.
- Coverage provider `v8`, covering `src/lib/**/*.ts` by default.

### 7.2 Test patterns

- **Service-layer integration tests** mock `src/lib/dbService` with an in-memory `Map` store, then exercise the real business rules end-to-end without Firebase. See `src/__tests__/services/inventoryService.test.ts` and `src/__tests__/lib/clientReport.test.ts`.
- **Component tests** use `@testing-library/react` with the shared `src/__tests__/setup.ts` file, which mocks `window.matchMedia`, `localStorage`, `console.error/warn`, and `Audio`.
- **Regression tests** live in `src/__tests__/regressions.test.ts` and should be preserved.
- **API tests** in `src/__tests__/api/` exercise data population and integration paths.

### 7.3 Test report generation

```bash
npx vitest list > .test-list.txt
node scripts/build-test-report-docx.mjs > TEST_REPORT.docx
node scripts/build-test-report-txt.mjs  > TEST_REPORT.txt
```

`.test-list.txt` is gitignored and regenerated each time.

### 7.4 Manual QA

The `QA_MANUAL/` directory contains a 127-case manual test suite across five workflows (SHS, batch import, barcode scan, returns processing, dashboard/data accuracy). The `SOPs/` directory contains operational procedures for the team.

---

## 8. Deployment

The app is deployed to **Vercel**.

- `vercel.json` sets the framework to Vite, build command `npm run build`, output directory `dist/`.
- SPA rewrite: everything except `/assets/*` routes to `index.html`.
- Security headers include CSP, HSTS, frame options, referrer policy, permissions policy, and COOP.
- `/assets/*` are cached immutably for one year.
- Build-time build ID is injected into the bundle (`__BUILD_ID__`) and into a `<meta name="build-id">` tag. `useBuildVersionCheck` prompts users to reload when a stale bundle is detected.

### CI pipeline

`.github/workflows/ci.yml` runs on PR and push to `main`:

1. `npm ci --no-audit --no-fund`
2. `npm run lint` (type-check)
3. `npm test`
4. `npm run build`

---

## 9. Security considerations

### 9.1 Firestore rules

`firestore.rules` is the real security boundary. Key policies:

- Every signed-in user can read shared data.
- Creates/updates must carry `ownerId == 'shared'`.
- Hard deletes are restricted to admin for audit collections (`sales`, `inventoryEvents`, `importBatches`, `sourceDocuments`).
- Admin-managed collections (`marketplaceFees`, `notices`, `models`) are write-gated to the admin email allowlist.
- Unlisted collections default-deny.

Keep `ADMIN_EMAILS` in `src/lib/firebase.ts` in sync with `isAdmin()` in `firestore.rules`.

### 9.2 Secrets and credentials

The following are gitignored and must never be committed:

- `.env*` (except `.env.example`)
- `firebase-service-account.json` and variants
- `scripts/team-passwords.json`
- `imported_inventory.json`

`firebase-applet-config.json` contains public Firebase client keys and is checked in intentionally.

### 9.3 CSP and headers

`vercel.json` configures a strict Content Security Policy. If you add a new external domain (e.g. a new image host, analytics provider, or auth domain), update the matching CSP directive or the app will fail at runtime.

### 9.4 Build-id / stale-bundle defence

`main.tsx` and `App.tsx` contain multiple defences against stale Vite chunks after a Vercel redeploy:

- Global `error`/`unhandledrejection` listeners detect chunk-load failures and reload once per session.
- `useBuildVersionCheck` compares the compiled `__BUILD_ID__` with the live `index.html` meta tag and shows a reload banner.
- Sentry ignores common stale-chunk and ResizeObserver errors.

---

## 10. Environment variables

Copy `.env.example` to `.env.local` and fill in values. The most important variables are:

| Variable | Purpose |
|----------|---------|
| `GEMINI_API_KEY` | Required for AI features (auto-generated in AI Studio). |
| `VITE_CLOUDINARY_PRESET` | Cloudinary unsigned upload preset for stock images. |
| `APP_URL` | Hosted app URL. |
| `MASTER_EXCEL_PATH` / `IMPORT_SHEET_NAME` / `IMPORT_OUTPUT_PATH` | Overrides for CLI import scripts. |
| `VITE_SENTRY_DSN` | Optional Sentry DSN. Sentry stays silent without it. |
| `DISABLE_HMR` | Set to `true` to disable Vite HMR. |

Firebase config is normally read from `firebase-applet-config.json`; the env vars in `.env.example` are overrides only.

---

## 11. Known current issues (as of last exploration)

The repository is actively maintained but has unresolved type/build issues that any agent should be aware of before starting work:

1. **Missing runtime dependencies in `node_modules`.** `@vercel/analytics`, `@vercel/speed-insights`, and `@sentry/react` are listed in `package.json` but are not installed locally. `npm install` should be re-run to restore them. Until then `npm run build` fails with Rollup resolve errors, and `npm run lint` reports missing module declarations.

2. **TypeScript errors.** `npm run lint` currently reports multiple type mismatches, including:
   - Test fixtures missing required `Sale` fields such as `spMinusBp`.
   - `src/components/ReceiveSHSModal.tsx` references undefined identifiers (`numericOk`, `alphaSerial`).
   - `src/components/Sales.tsx` is missing the `repaired_unit` key in an `OperationalFlag` record.
   - `src/services/inventoryService.ts(317)` accesses `stockSource` on a `Sale` type that does not declare it.
   - `MockDB.ts` uses `DeviceCategory | "phone"` and non-existent fields `platformFee` / `profit`.

3. **Test failures.** `npm test` currently reports:
   - 1 assertion failure in `src/__tests__/lib/modelReconciliation.test.ts` (expected model value mismatch).
   - 3 Vitest worker timeout errors on heavy test files (`clientReport.test.ts`, `salesReportImportPreview.test.ts`, `notificationService.test.ts`).

These are pre-existing conditions; do not assume your changes caused them. Run the same checks before and after your edits to verify your own changes.

---

## 12. Agent onboarding checklist

Before making changes:

1. Run `npm install` to ensure `node_modules` matches `package-lock.json`.
2. Copy `.env.example` to `.env.local` and set `GEMINI_API_KEY` if you need AI features.
3. Run `npm run lint` and `npm test` to establish a baseline.
4. Read the relevant SOP in `SOPs/` if your change touches a user workflow.
5. If adding a new Firestore collection, add matching rules to `firestore.rules` and composite indexes to `firestore.indexes.json` if required.
6. If adding a new external domain, update `vercel.json` CSP headers.
7. Keep business-rule changes inside `src/services/` or `src/lib/`, not spread across components.
8. Preserve existing regression tests; add new tests for new behaviour.

---

## 13. Useful references

- `src/types.ts` — canonical data model.
- `src/lib/dbService.ts` — Firestore abstraction and collection map.
- `src/lib/firebase.ts` — auth helpers and role allowlists.
- `client.config.cjs` — client onboarding config and Excel column mappings.
- `firestore.rules` — security boundary.
- `vercel.json` — deployment and headers.
- `vite.config.ts` — build, chunking, and test configuration.
- `SOPs/SOP_OVERVIEW.md` — operational workflow overview.
- `QA_MANUAL/README.md` — manual QA plan.

---

*Last updated: 2026-06-30 based on actual project exploration.*
