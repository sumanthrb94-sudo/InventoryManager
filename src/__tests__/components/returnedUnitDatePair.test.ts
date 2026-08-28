/**
 * The stock-in / returned date pair travels together.
 *
 * Operator's request, near-verbatim: "while showing these returned units,
 * the schema needs — along with stock in date — the returned date, while
 * viewing everywhere."
 *
 * The gap was real: a returned-to-inventory unit sits inside "All Office
 * Stock", its Excel overlay and the Inventory Report export looking IDENTICAL
 * to fresh stock — same Stock In Date, nothing saying it ever left and came
 * back. And on the Returns page the opposite hole: Return Date with no Stock
 * In Date, so the unit's age was invisible exactly where its history matters.
 *
 * These are source-level pins on each surface's schema table, because those
 * tables are what every renderer and CSV derives from — a column present
 * there is present everywhere the surface draws.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('every unit-viewing surface carries both dates', () => {
  it('the dashboard-tile Excel overlay lists Return Date beside Sold Date', () => {
    const src = readFileSync('src/components/StockOverlayModal.tsx', 'utf8');
    const overlay = src.slice(src.indexOf('OVERLAY_COLUMNS'));
    expect(overlay).toMatch(/key: 'dateIn',\s+label: 'Stock In Date'/);
    expect(overlay).toMatch(/key: 'returnDate',\s+label: 'Return Date'/);
    // And the date formatter already knows the field — a column whose cells
    // render raw ISO strings would be present but unreadable.
    expect(src).toMatch(/\['dateIn', 'saleDate', 'returnDate'/);
  });

  it('the Inventory Report export appends Return Date without moving a column', () => {
    const src = readFileSync('src/components/BuySheet.tsx', 'utf8');
    const cols = src.match(/const INVENTORY_REPORT_COLUMNS = \[\s*([^\]]+)\]/)![1];
    // Appended LAST: this file is also the import contract, and the importer
    // matches headers by alias — growth at the end is the one shape of change
    // that cannot shift what an older file's positions mean.
    expect(cols.trim().replace(/\s+/g, ' ')).toMatch(/'Age \(days\)', 'Return Date',$/);
    expect(src).toMatch(/'Return Date':\s+u\.returnDate \|\| ''/);
  });

  it('the Returns page shows Stock In Date beside Return Date, sortably', () => {
    const src = readFileSync('src/components/ReturnsPage.tsx', 'utf8');
    expect(src).toMatch(/type SortKey = 'returnDate' \| 'dateIn'/);
    expect(src).toMatch(/case 'dateIn':\s+return u\.dateIn \|\| '';/);
    expect(src).toMatch(/<Th k="dateIn"[^>]*>Stock In Date<\/Th>/);
    // and its CSV — the on-screen table and the download must agree.
    expect(src).toMatch(/'Stock In Date': u\.dateIn \|\| ''/);
  });

  it('the unit drawer names the Returned date beside Date In', () => {
    const src = readFileSync('src/components/UnitDetailDrawer.tsx', 'utf8');
    expect(src).toMatch(/label: 'Returned', value: new Date\(unit\.returnDate\)/);
  });
});
