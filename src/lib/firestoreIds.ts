/**
 * Firestore document-id helpers.
 *
 * This lived inside src/lib/salesImport.ts, because that is where the composite
 * sale id was first built. When the importers were deleted (2026-08) the file
 * went with them and this came out first: it is not import logic, it is a
 * Firestore constraint, and `recordSale` / `recordBulkSales` still depend on it
 * for every sale written from the app.
 */

/** Sanitise a string for use as a Firestore document-id segment.
 *
 *  Forward slashes turn into underscores — Firestore treats `/` as a path
 *  separator, so leaving one in would split a single id into multiple segments
 *  and trigger "Invalid document reference. Document references must have an
 *  even number of segments". Backslashes and ASCII control chars are scrubbed
 *  for parity.
 *
 *  Hyphens, dots and colons stay intact, so a hyphenated marketplace order
 *  number (`206-5248339-8852336`) survives unchanged — that is the common case
 *  and the reason this is a targeted scrub rather than a slug.
 */
export function sanitiseFsIdSegment(s: string): string {
  return String(s ?? '').replace(/[/\\\u0000-\u001f\u007f]/g, '_').trim();
}
