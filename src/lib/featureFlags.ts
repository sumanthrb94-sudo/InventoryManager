/**
 * Build-time UI flags. One obvious home so a surface can be switched off in
 * production without hunting for every entry point that renders it.
 */

/**
 * Whether the Import entry points are shown at all.
 *
 * ON, for admins.
 *
 * History, because the reasoning matters more than the value: after the
 * 2026-08 wipe → Inventory Report → Sales Report migration reconciled exactly
 * (487 sold / £7,781 GP / 5 returns reproduced after the wipe, 0 orphans),
 * Import came out of the UI entirely. With the database known correct, an
 * accidental re-import was pure downside and there was nothing left to import.
 * It was gated on VITE_E2E rather than hard-coded `false` so the 36 scripts in
 * scripts/ that drive imports through the real UI stayed green.
 *
 * The operator has since asked for it back, so it is back. Nothing about the
 * pipeline ever changed — the modals, parsers and services were untouched and
 * stayed under test throughout, which is precisely why restoring it is this
 * one line.
 *
 * WHAT TURNING THIS ON RE-OPENS, so it is a decision and not a surprise:
 * Import is the only route in the app that can CREATE units, complete orphan
 * records and restore returns from a file. Mark Multiple Sold cannot — it can
 * only sell stock that already exists, which is what makes it safe. Uploading
 * a stale or hand-edited report can therefore reintroduce units that were
 * deliberately removed, so the file matters.
 *
 * Still `&& userIsAdmin` at the call site in App.tsx: an employee cannot see
 * or reach it. That has been true the whole time and is not what this flag
 * changes.
 */
export const SHOW_IMPORT_UI = true;

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
