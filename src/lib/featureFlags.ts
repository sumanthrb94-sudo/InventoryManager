/**
 * Build-time UI flags. One obvious home so a surface can be switched off in
 * production without hunting for every entry point that renders it.
 */

/**
 * Whether the Inventory Report import is reachable.
 *
 * ON, for admins, as of 2026-08-23 — and this time with the gate that was
 * missing the first time round.
 *
 * The importer was deleted in 2026-08, not merely hidden, and the reason was
 * specific: it was the only route in the app that could create an inventory
 * unit from free text. Every other intake path goes through a picker bound to
 * the admin model catalogue, so a model that is not in Configuration cannot be
 * typed into existence. Import took whatever the Model column said, which put
 * supplier product codes into production as model names — "SG TABA
 * (10.1)(T580) 16GB" and the like, unclassifiable, bucketing as their own SKU
 * and surfacing in Stock Alerts as phones to reorder that were never stocked.
 *
 * The operator asked for it back, with that hole closed. It is closed at the
 * point it has to be — buildPreview, not the UI: a row whose Model is not in
 * the catalogue is HELD, so it is neither created nor updated and its supplier
 * is not created either. The rest of the file imports normally. Held rows come
 * back as a downloadable workbook in the same schema to be corrected and
 * re-uploaded, and an admin can add the model to the catalogue from inside the
 * preview, at which point the waiting rows join the import with no re-upload.
 *
 * SALES import was NOT restored. Only the inventory route came back.
 *
 * What this still re-opens, so it is a decision and not a surprise: import is
 * the only route that can CREATE units in bulk, so a stale or hand-edited file
 * can reintroduce stock that was deliberately removed. The file matters.
 *
 * The call site in App.tsx is `SHOW_IMPORT_UI && userIsAdmin`; an employee can
 * neither see nor reach it.
 */
export const SHOW_IMPORT_UI = true;

/**
 * Whether the "Build a new file from …" template-download block is shown.
 *
 * ON, and it now offers SALES templates only.
 *
 * These were once upload vehicles, and while that was all they were, handing
 * them out implied that typing stock into a spreadsheet was a supported intake
 * route. It isn't: intake is Stock Intake → Add Stock through the catalogue
 * picker, and sales are Sell → Mark Sold.
 *
 * What makes them worth keeping is that they stopped being upload vehicles.
 * Since 2026-08 the sales templates are generated from the report writer itself
 * (scripts/generateSalesTemplates.ts) and carry LIVE formulas: the report's
 * exact columns, and typing a BP and an SP fills in the rest of the row —
 * SP-BP, Marginal Tax, Commission, the VAT lines, GP, GP % and Total VAT NTP —
 * in Excel, on the spot. That is a working sheet for reconciling a marketplace
 * statement, and it is useful precisely because nothing reads it back.
 *
 * The INVENTORY templates were deleted with the importers. A blank intake
 * workbook with no importer behind it is a file the operator can do nothing
 * with, and the wrong habit to keep advertising.
 *
 * The sales template FILES are not gated by this flag: public/templates/ and
 * templates/ are the written column contract, and salesTemplateFormulas.test.ts
 * parses them to check the columns, the formulas and the download menu's own
 * "N columns" hints against the real files.
 */
/**
 * OFF as of 2026-08-15, at the operator's request: "remove this from ui".
 *
 * The block it hides is the "Build a new file from …" list under the Sales
 * Report menu — the six sales templates. TemplateDownload short-circuits on
 * this flag before rendering anything, so the whole surface goes with it.
 *
 * The FILES stay, and so does everything that reads them. templates/ and
 * public/templates/ are the written column contract, and
 * salesTemplateFormulas.test.ts parses them to check the columns and the live
 * formulas against the report writer itself. Deleting them would remove a
 * genuine test of the schema to hide a menu.
 *
 * Flip back to `true` to restore it; nothing else has to change.
 */
export const SHOW_TEMPLATE_DOWNLOADS = false;
