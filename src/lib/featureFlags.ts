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
 * Whether the SALES Report import is offered alongside the Inventory one.
 *
 * OFF in a real build, ON under VITE_E2E=1.
 *
 * The operator asked for sales import to be removed and inventory import to
 * stay (2026-08). Sales no longer arrive from a spreadsheet: they are recorded
 * in the app at Sell → Mark Sold, or Mark Multiple Sold for a batch. An upload
 * route that can also CREATE sales is then a way to double-count a month, and
 * nothing needs it.
 *
 * Gated rather than deleted, and gated the same way Import itself was when it
 * came out of the UI before — see SHOW_IMPORT_UI's history above. The parser,
 * the preview and the restore-returns path stay compiled and stay under unit
 * test (salesImport.test.ts, schemaAlignment.test.ts, the round-trip suites).
 * Deleting the surface would take that with it, and would make restoring the
 * route later a rebuild rather than a one-line change.
 *
 * ITS OWN VARIABLE, NOT VITE_E2E — and the distinction is the point.
 *
 * The first version of this rode on VITE_E2E, so every E2E build kept sales
 * import and the suite never exercised the app as it actually ships. That is
 * the failure mode where a green run describes a configuration no user will
 * ever see. The default is now OFF everywhere, E2E included, so the suite
 * tests the shipping product unless a script deliberately asks otherwise.
 *
 * VITE_SALES_IMPORT=1 opts back in. Only scripts that exist specifically to
 * cover the still-compiled parser should set it, and should say why.
 *
 * WHAT THIS COSTS, so it is a decision and not a surprise:
 *
 * The wipe → re-upload → "go live" recovery no longer works for sales. A wipe
 * clears the sales collection, and with this off there is no route to put it
 * back — the Inventory Report carries stock, not sales history. Before this,
 * exporting both reports was a complete backup; now only the stock half can be
 * restored through the UI.
 *
 * That is worth weighing against the double-count risk it removes, and it is
 * the reason the flag exists instead of a deletion: flipping it back is the
 * recovery route if a wipe ever has to be undone.
 */
export const SHOW_SALES_IMPORT_UI = import.meta.env.VITE_SALES_IMPORT === '1';

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
