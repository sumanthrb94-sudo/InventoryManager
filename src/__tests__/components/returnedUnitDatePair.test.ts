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

describe('the Inventory tab wears the latest return date (operator, 2026-08-29)', () => {
  /** "When searching in inventory I need a tag that says latest return
   *  date or return date back to inventory." A returned-to-inventory unit
   *  is status 'available' again — nothing else in the row said it had
   *  ever come back. The tag reads BACK IN STOCK · <date> for that route
   *  (RETURNED · <date> for units still in the returns flow), and it is
   *  self-expiring: salesService nulls returnDate when the unit is resold,
   *  so the field's presence always means the CURRENT cycle. */
  it('unit rows render a return tag driven by unit.returnDate', () => {
    const src = readFileSync('src/components/Inventory.tsx', 'utf8');
    expect(src).toMatch(/\{unit\.returnDate && \(/);
    expect(src).toMatch(/'BACK IN STOCK' : 'RETURNED'/);
    // returned_to_inventory is the route that reads "back in stock".
    expect(src).toMatch(/unit\.returnType === 'returned_to_inventory'/);
    // Date-only strings must not shift a day through UTC parsing.
    expect(src).toMatch(/unit\.returnDate\.length <= 10 \? unit\.returnDate \+ 'T12:00:00'/);
  });

  it('the tag is self-expiring — resale clears the field that drives it', () => {
    const svc = readFileSync('src/services/salesService.ts', 'utf8');
    expect(svc).toMatch(/returnDate: null/);
  });
});

describe('the grouped stock tables wear the latest return date too', () => {
  /** Follow-up in the same breath: "or when clicked on tiles to view
   *  inventory stock". The tile overlays and the Stock-by-Model table
   *  render GROUPS, where no per-unit field is visible — so the group
   *  itself must carry the marker: how many of its units came back, and
   *  the latest date one did. */
  it('buildGroupedModels rolls up returnedCount + latestReturnDate', async () => {
    const { buildGroupedModels } = await import('../../components/StockOverlayModal');
    const unit = (over: Record<string, unknown>) => ({
      id: String(Math.random()), model: 'Galaxy S22 128GB', storage: '128GB',
      colour: 'Black', buyPrice: 140, status: 'available', dateIn: '2026-08-13',
      ...over,
    }) as never;
    const groups = buildGroupedModels([
      unit({ id: 'a' }),
      unit({ id: 'b', returnDate: '2026-08-20' }),
      unit({ id: 'c', returnDate: '2026-08-27', returnType: 'returned_to_inventory' }),
    ], []);
    expect(groups).toHaveLength(1);
    expect(groups[0].returnedCount).toBe(2);
    expect(groups[0].latestReturnDate).toBe('2026-08-27');
  });

  it('the group row renders the ↩ RET tag from those fields', () => {
    const src = readFileSync('src/components/StockOverlayModal.tsx', 'utf8');
    expect(src).toMatch(/g\.returnedCount > 0 && g\.latestReturnDate && \(/);
    expect(src).toMatch(/came back via a return · latest return/);
  });
});
