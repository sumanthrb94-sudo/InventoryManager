/**
 * Build-time UI flags. One obvious home so a surface can be switched off in
 * production without hunting for every entry point that renders it.
 */

/**
 * Whether the Import entry points are shown at all.
 *
 * Operator decision (2026-08): the wipe → Inventory Report → Sales Report
 * migration is complete and the data reconciled exactly (487 sold / £7,781 GP
 * / 5 returns reproduced after the wipe, 0 orphans). With the database correct,
 * an accidental re-import is pure downside, so Import comes out of the UI
 * entirely — including for admins, who were previously the only ones who
 * could see it.
 *
 * Nothing about the import PIPELINE changes: the modals, parsers and services
 * are all untouched and still fully tested. This hides the doors, it does not
 * remove the machinery, so restoring it is this one line plus a redeploy.
 *
 * Gated on VITE_E2E rather than hard-coded `false` because 36 scripts in
 * scripts/ drive imports through the real UI (openImportMenu → the Inventory
 * Report / Sales Report menu items) — e2eWipeReuploadReconcile,
 * e2eReportRoundTrip and clientOnboardingCapture among them. A hard false
 * would take every one of them red. The E2E harness is the only thing that
 * ever builds with VITE_E2E=1, so:
 *
 *   production / Vercel build   → Import invisible to everyone
 *   VITE_E2E=1 build            → Import present, E2E suite keeps passing
 */
export const SHOW_IMPORT_UI = import.meta.env.VITE_E2E === '1';

/**
 * Whether the "Build a new file from …" template-download block is shown.
 *
 * Follows SHOW_IMPORT_UI, because a blank upload template is only useful to
 * somebody about to upload it. With Import gone from the UI there is no way
 * to feed a filled-in template back into the system, so the links would hand
 * an operator a file they cannot do anything with — and worse, imply that
 * typing stock into a spreadsheet is still a supported way to get it in. It
 * isn't: intake is Stock Intake → Add Stock, and sales are Sell → Mark Sold.
 *
 * Two of the six placements live inside the import modals and are already
 * unreachable; the ones this actually removes are the blocks in the Buy and
 * Sell report menus (BuySheet / SellSheet → ReportRangeMenu).
 *
 * The template FILES stay where they are. public/templates/ and templates/
 * are the written column contract — templates.test.ts and
 * salesExportSchema.test.ts parse them, REPORT_SCHEMAS.md documents them, and
 * the E2E build still downloads them. This hides a menu, it does not delete
 * the schema.
 */
export const SHOW_TEMPLATE_DOWNLOADS = SHOW_IMPORT_UI;
