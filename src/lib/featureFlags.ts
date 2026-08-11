/**
 * Build-time UI flags. One obvious home so a surface can be switched off in
 * production without hunting for every entry point that renders it.
 *
 * The two import flags that used to live here are gone. Gating was the answer
 * for a while; deleting the importers outright (2026-08) made the flags dead
 * weight, and a dead flag is an invitation to switch a surface back on against
 * modules that no longer exist. See noImportSurface.test.ts for what replaced
 * them and why.
 */

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
export const SHOW_TEMPLATE_DOWNLOADS = true;
