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
 * ON. It followed SHOW_IMPORT_UI for as long as a template was only an upload
 * vehicle: with no way to feed a filled-in one back, the links handed the
 * operator a file they could do nothing with, and implied that typing stock
 * into a spreadsheet was still a supported intake route. It isn't — intake is
 * Stock Intake → Add Stock and sales are Sell → Mark Sold, and that has not
 * changed.
 *
 * What changed is the template. Since 2026-08 the sales templates are
 * generated from the report writer itself (scripts/generateSalesTemplates.ts)
 * and carry LIVE formulas: same columns as the Sales Report, and typing a BP
 * and an SP fills in the whole row — SP-BP, Marginal Tax, Commission, the VAT
 * lines, GP, GP % and Total VAT NTP — in Excel, on the spot. That is a working
 * sheet the operator can reconcile a marketplace statement against, and it is
 * useful whether or not anything ever reads it back.
 *
 * So this no longer tracks Import, and turning Import back on does not depend
 * on it. The two flags answer different questions now.
 *
 * The template FILES were never gated by this: public/templates/ and
 * templates/ are the written column contract — templates.test.ts,
 * salesTemplateFormulas.test.ts and schemaAlignment.test.ts all parse them.
 */
export const SHOW_TEMPLATE_DOWNLOADS = true;
