/**
 * Mark Multiple Sold is the Sales Report's own sheets, as an entry grid.
 *
 * Two things here are worth pinning, and both have broken before.
 *
 * THE TABS ARE NOT DECORATION. Each marketplace's sheet is a different shape
 * — Amazon has DSF lines, eBay has ROF/FVF/marketing, Back Market has no
 * Total VAT column at all — and the operator reconciles a tab against that
 * marketplace's own statement. Showing the wrong columns under a tab is a
 * silent reconciliation error, so the tabs are asserted against
 * MARKETPLACE_COLUMNS, which bulkSaleColumns.test.ts in turn pins to the
 * report's own headers.
 *
 * THE CELLS ARE ADDRESSED BY NAME. A row's shape changes with what it sells:
 * an SHS unit with no IMEI on file gets a text box, an accessory gets a
 * quantity, an office unit gets neither. Anything reaching for "the first
 * input in the row" reads a different cell on different rows. Placeholders
 * cannot carry the contract either — Postage's placeholder is the
 * marketplace's autofill, which is "0.00" on eBay and indistinguishable from
 * Sale price. Screen readers want the same labels, which is why the fix is
 * aria-label rather than a test id.
 */
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import BulkSaleModal from '../../components/BulkSaleModal';
import { MARKETPLACE_COLUMNS } from '../../lib/bulkSaleColumns';
import type { InventoryUnit, AccessoryStock, Marketplace, Sale } from '../../types';

vi.mock('../../services/salesService', () => ({
  recordBulkSales: vi.fn(async () => ({ results: [], succeeded: 0, failed: 0 })),
}));

const unit = (over: Partial<InventoryUnit> & { id: string }): InventoryUnit => ({
  status: 'available', model: 'IPHONE 13', sku: 'IP13-128-MID', imei: '350000000000001',
  storage: '128GB', colour: 'MIDNIGHT',
  buyPrice: 200, supplierName: 'MOBILE WHOLESALE LTD', ownerId: 'shared',
  // Distinct per unit on purpose: a Stock In cell reading the wrong unit's
  // date is invisible when every fixture shares one.
  dateIn: '2026-06-01',
  createdAt: '', updatedAt: '',
  ...over,
} as InventoryUnit);

const OFFICE = [
  unit({ id: 'o1', imei: '350000000000001', dateIn: '2026-06-01' }),
  unit({ id: 'o2', imei: '350000000000002', model: 'IPHONE 14', sku: 'IP14-256-PUR',
         dateIn: '2026-07-22' }),
];
const SHS = [
  unit({ id: 's1', imei: '', model: 'IPHONE 12', status: 'incoming',
         supplierName: 'PHONEBOX DIRECT', dateIn: '2026-05-14' }),
];
const ACCESSORIES = [{
  id: 'a1', sku: 'USB-C-20W', name: 'USB-C 20W Charger', quantity: 12,
  buyPrice: 3.2, supplierName: 'MOBILE WHOLESALE LTD', ownerId: 'shared', createdAt: '',
} as AccessoryStock];

function open() {
  return render(
    <BulkSaleModal
      sales={[]} allUnits={[...OFFICE, ...SHS]}
      units={OFFICE} shsUnits={SHS} accessoryStock={ACCESSORIES}
      supplierMap={{}} onClose={() => {}}
    />,
  );
}

// Scoped to the Marketplace tablist: the modal also has a "Stage" tablist
// (Record sales / Update IMEI & Mark Sold), so an unscoped tab lookup is
// ambiguous now.
const tabFor = (m: string) => within(
  screen.getByRole('tablist', { name: /Marketplace/i }),
).getByRole('tab', { name: new RegExp(m, 'i') });

/** The stock list's own entries. Scoped to the picker's listbox on purpose:
 *  the Source and Payment Mode <select>s render native <option> elements,
 *  which carry the same ARIA role and would otherwise be counted as stock. */
const stockOptions = () => {
  const list = screen.queryByRole('listbox', { name: 'Stock' });
  return list ? within(list).getAllByRole('option') : [];
};
const lastRow = () => {
  const rows = screen.getAllByRole('row').slice(1);   // drop the header row
  return rows[rows.length - 1];
};

/** Choose a source, search it, and take the first hit. */
function pick(source: 'Office' | 'SHS' | 'Accessory', query: string) {
  fireEvent.change(within(lastRow()).getByLabelText('Source'), { target: { value: source.toLowerCase() } });
  // Re-query the row: changing the source is a real state change now that the
  // default is 'model', so React replaces the <tr> and a node captured before
  // the change is detached — events fired on it update nothing.
  fireEvent.change(within(lastRow()).getByLabelText('Model'), { target: { value: query } });
  const options = stockOptions();
  expect(options.length, `something in ${source} matching "${query}"`).toBeGreaterThan(0);
  fireEvent.click(options[0]);
  return lastRow();
}

describe('one tab per marketplace, each showing that sheet\'s own columns', () => {
  it('offers the five marketplaces the report has', () => {
    open();
    // Scoped: the modal also has a Stage tablist (Record sales / Update IMEI
    // & Mark Sold), so an unscoped tab query returns seven.
    const names = within(screen.getByRole('tablist', { name: /Marketplace/i }))
      .getAllByRole('tab').map(t => t.textContent?.trim());
    expect(names).toEqual(['Amazon', 'Back Market', 'eBay', 'OnBuy', 'Temu']);
  });

  it.each([
    ['Amazon', 'AMAZON'], ['Back Market', 'BM'], ['eBay', 'EBAY'],
    ['OnBuy', 'ONBUY'], ['Temu', 'TEMU'],
  ])('%s shows exactly its own money columns', (label, key) => {
    open();
    fireEvent.click(tabFor(label));
    const headers = screen.getAllByRole('columnheader').map(h => h.textContent?.trim());
    const expected = MARKETPLACE_COLUMNS[key as Marketplace].map(c => c.header);
    // The leading identity columns are the same on every tab; everything from
    // SP-BP onward is this marketplace's own.
    expect(headers.slice(headers.indexOf('SP-BP'), -1)).toEqual(expected);
  });

  it.each([
    ['Amazon', 'Quantity'], ['Back Market', 'Quantity'], ['eBay', 'Units'],
    ['OnBuy', 'Qty'], ['Temu', 'Quantity'],
  ])('%s shows IMEI and quantity as separate columns, named "%s"', (label, qty) => {
    // They were once one "IMEI / Qty" cell. Every sheet carries IMEI on its
    // own, and names quantity differently — eBay says Units, and OnBuy's
    // sheet has no such column at all, so that tab labels the box "Qty"
    // rather than claiming a column the sheet does not have.
    open();
    fireEvent.click(tabFor(label));
    const headers = screen.getAllByRole('columnheader').map(h => h.textContent?.trim());
    expect(headers).toContain('IMEI');
    expect(headers).not.toContain('IMEI / Qty');
    expect(headers).toContain(qty);
    expect(headers.indexOf('IMEI')).toBeLessThan(headers.indexOf(qty));
  });

  it('does not show Amazon\'s DSF lines on the eBay tab, or the reverse', () => {
    open();
    fireEvent.click(tabFor('eBay'));
    let headers = screen.getAllByRole('columnheader').map(h => h.textContent?.trim());
    expect(headers).toContain('ROF');
    expect(headers).not.toContain('DSF');

    fireEvent.click(tabFor('Amazon'));
    headers = screen.getAllByRole('columnheader').map(h => h.textContent?.trim());
    expect(headers).toContain('DSF');
    expect(headers).not.toContain('ROF');
  });

  it('asks for a payment mode only on Back Market, which is the only one it changes', () => {
    open();
    fireEvent.click(tabFor('Back Market'));
    expect(within(lastRow()).getByLabelText('Payment mode')).toBeTruthy();

    fireEvent.click(tabFor('Amazon'));
    expect(within(lastRow()).queryByLabelText('Payment mode')).toBeNull();
  });

  it('keeps each tab\'s rows to itself, and counts the ready ones on the tab', () => {
    open();
    const row = pick('Office', 'IPHONE 13');
    fireEvent.change(within(row).getByLabelText('Order number'), { target: { value: 'AMZ-1' } });
    fireEvent.change(within(row).getByLabelText('Sale price'), { target: { value: '300' } });
    expect(tabFor('Amazon').textContent).toMatch(/1$/);

    // Switching tabs lands on a fresh blank row for that marketplace, never
    // on Amazon's row — a row belongs to the tab it was entered under.
    fireEvent.click(tabFor('Temu'));
    expect(within(lastRow()).queryByDisplayValue('AMZ-1')).toBeNull();
    expect(within(lastRow()).getByLabelText('Order number'), 'somewhere to type').toBeTruthy();
    // …and the Amazon row is still counted, and still going to be sold.
    expect(tabFor('Amazon').textContent).toMatch(/1$/);
    expect(screen.getByRole('button', { name: /Confirm 1 Sale/i })).toBeTruthy();
  });
});

describe('selling one row at a time', () => {
  it('a ready handset row carries its own Sold tick', () => {
    open();
    const row = pick('Office', 'IPHONE 13');
    // Not ready yet — no SKU, order number or price.
    // .disabled, not toBeDisabled — this suite does not load jest-dom matchers.
    expect((within(lastRow()).getByRole('button', { name: /Mark sold/i }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(within(lastRow()).getByLabelText('SKU'), { target: { value: 'IP13-128-MID' } });
    fireEvent.change(within(lastRow()).getByLabelText('Order number'), { target: { value: 'AMZ-1' } });
    fireEvent.change(within(lastRow()).getByLabelText('Sale price'), { target: { value: '320' } });
    expect((within(lastRow()).getByRole('button', { name: /Mark sold/i }) as HTMLButtonElement).disabled).toBe(false);
    expect(row).toBeTruthy();
  });

  it('clicking it sells THAT row only — one line, not the batch', async () => {
    const { recordBulkSales } = await import('../../services/salesService');
    open();
    pick('Office', 'IPHONE 13');
    fireEvent.change(within(lastRow()).getByLabelText('SKU'), { target: { value: 'IP13-128-MID' } });
    fireEvent.change(within(lastRow()).getByLabelText('Order number'), { target: { value: 'AMZ-1' } });
    fireEvent.change(within(lastRow()).getByLabelText('Sale price'), { target: { value: '320' } });

    fireEvent.click(within(lastRow()).getByRole('button', { name: /Mark sold/i }));
    expect(recordBulkSales).toHaveBeenCalledTimes(1);
    // One line — the whole point. A batch call here would sell rows the
    // operator had not finished typing.
    expect((recordBulkSales as any).mock.calls[0][0]).toHaveLength(1);
    expect((recordBulkSales as any).mock.calls[0][0][0]).toMatchObject({
      kind: 'unit', sku: 'IP13-128-MID', orderNumber: 'AMZ-1', salePrice: 320,
    });
  });

  it('a model row gets Update Unit instead — it is not a sale yet', () => {
    open();
    // The default source is 'model'; picking one must NOT offer a Sold tick,
    // because no handset is attached and nothing can be marked sold.
    fireEvent.change(within(lastRow()).getByLabelText('Model'), { target: { value: 'IPHONE 13' } });
    const opts = stockOptions();
    expect(opts.length).toBeGreaterThan(0);
    fireEvent.click(opts[0]);
    expect(within(lastRow()).queryByRole('button', { name: /Mark sold/i })).toBeNull();
    expect(within(lastRow()).getByRole('button', { name: /Update Unit/i })).toBeTruthy();
  });
});

describe('the sale date is the operator\'s, and it leads the row', () => {
  const todayIso = () => new Date().toISOString().split('T')[0];

  it('is the first column after the row number, as it is column A of every tab', () => {
    open();
    const headers = screen.getAllByRole('columnheader').map(h => h.textContent?.trim());
    expect(headers[0]).toBe('#');
    expect(headers[1]).toBe('Date');
    // Before the identity columns it shares a sheet with.
    expect(headers.indexOf('Date')).toBeLessThan(headers.indexOf('Order Number'));
  });

  it('starts on today, so the common case needs no typing', () => {
    open();
    expect((within(lastRow()).getByLabelText('Sale date') as HTMLInputElement).value)
      .toBe(todayIso());
  });

  it('a back-dated row sells on the date typed, not on today', async () => {
    const { recordBulkSales } = await import('../../services/salesService');
    (recordBulkSales as any).mockClear();
    open();
    pick('Office', 'IPHONE 13');
    fireEvent.change(within(lastRow()).getByLabelText('Sale date'), { target: { value: '2026-07-30' } });
    fireEvent.change(within(lastRow()).getByLabelText('SKU'), { target: { value: 'IP13-128-MID' } });
    fireEvent.change(within(lastRow()).getByLabelText('Order number'), { target: { value: 'AMZ-BACK' } });
    fireEvent.change(within(lastRow()).getByLabelText('Sale price'), { target: { value: '320' } });

    fireEvent.click(within(lastRow()).getByRole('button', { name: /Mark sold/i }));
    expect((recordBulkSales as any).mock.calls[0][0][0]).toMatchObject({
      orderNumber: 'AMZ-BACK', saleDate: '2026-07-30',
    });
  });

  it('an emptied date stops the row being ready rather than reverting to today', () => {
    // Both services fall back to today() on a blank saleDate. Without this
    // guard, clearing the cell in a back-dated batch would land that one row
    // in the wrong period silently — the row would still look ready.
    open();
    const row = pick('Office', 'IPHONE 13');
    fireEvent.change(within(row).getByLabelText('Order number'), { target: { value: 'AMZ-1' } });
    fireEvent.change(within(row).getByLabelText('Sale price'), { target: { value: '300' } });
    expect(screen.getByRole('button', { name: /Confirm 1 Sale/i })).toBeTruthy();

    fireEvent.change(within(lastRow()).getByLabelText('Sale date'), { target: { value: '' } });
    expect(screen.getByRole('button', { name: /Confirm 0 Sales/i })).toBeTruthy();
  });

  it('shows the picked handset\'s Stock In date beside the sale date', () => {
    open();
    const headers = screen.getAllByRole('columnheader').map(h => h.textContent?.trim());
    expect(headers[2]).toBe('Stock In');

    const row = pick('Office', '350000000000002');
    const cells = within(row).getAllByRole('cell').map(c => c.textContent?.trim());
    // That unit's own arrival date, not the other office unit's.
    expect(cells, `got ${cells.join('|')}`).toContain('2026-07-22');
    expect(cells).not.toContain('2026-06-01');
  });

  it('leaves Stock In blank for a model row — no handset, no arrival date', () => {
    open();
    // The default source is 'model': team 1 has not chosen a unit, so there is
    // no single date to show and inventing one would be a lie about age.
    fireEvent.change(within(lastRow()).getByLabelText('Model'), { target: { value: 'IPHONE 13' } });
    const opts = stockOptions();
    expect(opts.length).toBeGreaterThan(0);
    fireEvent.click(opts[0]);
    const cells = within(lastRow()).getAllByRole('cell').map(c => c.textContent?.trim());
    expect(cells).not.toContain('2026-06-01');
    expect(cells, 'the Supplier cell is what explains why').toContain('attached later');
  });

  it('fills a waiting row\'s Stock In once team 2 picks the handset', () => {
    // Stage 1 leaves the row with no unit behind it, so there is no arrival
    // date to show. Choosing an IMEI is the moment one exists — and "how long
    // has this handset been sitting" is exactly what team 2 wants at that
    // moment, so it appears then rather than after the sale is committed.
    const pending = {
      id: 'p1', marketplace: 'AMAZON', orderNumber: 'AMZ-PEND', sku: 'IP13-128-MID',
      model: 'IPHONE 13', storage: '128GB', imei: '', awaitingImei: true,
      provisionalBuyPrice: true, buyPrice: 200, salePrice: 320,
      saleDate: '2026-08-01', ownerId: 'shared',
    } as unknown as Sale;
    render(
      <BulkSaleModal
        sales={[pending]} allUnits={[...OFFICE, ...SHS]}
        units={OFFICE} shsUnits={SHS} accessoryStock={ACCESSORIES}
        supplierMap={{}} onClose={() => {}}
      />,
    );

    const row = screen.getAllByRole('row')[1];   // waiting rows lead the grid
    expect(within(row).getAllByRole('cell').map(c => c.textContent?.trim()))
      .not.toContain('2026-06-01');

    fireEvent.change(within(row).getByLabelText('IMEI for AMZ-PEND'), { target: { value: 'o1' } });
    const cells = within(screen.getAllByRole('row')[1]).getAllByRole('cell')
      .map(c => c.textContent?.trim());
    expect(cells, `got ${cells.join('|')}`).toContain('2026-06-01');
  });

  it('carries the date onto the next row — a batch is one day\'s orders', () => {
    open();
    fireEvent.change(within(lastRow()).getByLabelText('Sale date'), { target: { value: '2026-07-30' } });
    fireEvent.click(screen.getByRole('button', { name: /Add row/i }));
    expect((within(lastRow()).getByLabelText('Sale date') as HTMLInputElement).value)
      .toBe('2026-07-30');
  });
});

describe('choosing a source, then searching it', () => {
  it('searches office stock, SHS and accessory pools separately', () => {
    open();
    const row = lastRow();
    const source = within(row).getByLabelText('Source');
    const model = within(row).getByLabelText('Model');

    fireEvent.change(source, { target: { value: 'office' } });
    fireEvent.change(model, { target: { value: 'iphone' } });
    let text = stockOptions().map(o => o.textContent || '').join('\n');
    expect(text).toMatch(/IPHONE 13/);
    expect(text, 'the SHS iPhone is not office stock').not.toMatch(/IPHONE 12/);

    fireEvent.change(source, { target: { value: 'shs' } });
    fireEvent.change(model, { target: { value: 'iphone' } });
    text = stockOptions().map(o => o.textContent || '').join('\n');
    expect(text).toMatch(/IPHONE 12/);
    expect(text).not.toMatch(/IPHONE 13/);

    fireEvent.change(source, { target: { value: 'accessory' } });
    fireEvent.change(model, { target: { value: 'charger' } });
    text = stockOptions().map(o => o.textContent || '').join('\n');
    expect(text).toMatch(/USB-C 20W Charger/);
  });

  it('finds a handset by its IMEI, not just by model', () => {
    // An IMEI identifies ONE handset. Listing by model and making the operator
    // hunt for the number they just typed defeats the point of typing it.
    open();
    const row = lastRow();
    // Office, explicitly: the grid now DEFAULTS to 'Model only', because the
    // team entering sales knows the model and not the IMEI. These tests are
    // about the office-stock search, so they have to ask for it.
    fireEvent.change(within(row).getByLabelText('Source'), { target: { value: 'office' } });
    fireEvent.change(within(lastRow()).getByLabelText('Model'), { target: { value: '350000000000002' } });
    const options = stockOptions();
    expect(options).toHaveLength(1);
    expect(options[0].textContent).toMatch(/IPHONE 14/);
    expect(options[0].textContent).toMatch(/350000000000002/);
  });

  it('keeps the list open however long the query is', () => {
    // The bug this pins: the list followed the cell by listening for scroll
    // events in the capture phase and closing. Typing a query longer than the
    // narrow Model cell scrolls the TEXT INSIDE THE INPUT, which fires exactly
    // that event — so a 7-digit search worked and a full 15-digit IMEI, or a
    // supplier name, silently returned nothing as the operator typed.
    open();
    // Office, explicitly: the grid now DEFAULTS to 'Model only', because the
    // team entering sales knows the model and not the IMEI. These tests are
    // about the office-stock search, so they have to ask for it.
    fireEvent.change(within(lastRow()).getByLabelText('Source'), { target: { value: 'office' } });
    const model = within(lastRow()).getByLabelText('Model');
    for (const q of ['350', '3500000', '35000000000000', '350000000000002']) {
      fireEvent.change(model, { target: { value: q } });
      fireEvent.scroll(model);          // what a long value does by itself
      expect(stockOptions().length, `"${q}" (${q.length} chars) still lists`)
        .toBeGreaterThan(0);
    }
  });

  it('finds a line by supplier and by SKU too', () => {
    open();
    // Office, explicitly: the grid now DEFAULTS to 'Model only', because the
    // team entering sales knows the model and not the IMEI. These tests are
    // about the office-stock search, so they have to ask for it.
    fireEvent.change(within(lastRow()).getByLabelText('Source'), { target: { value: 'office' } });
    const row = lastRow();
    const model = within(row).getByLabelText('Model');

    fireEvent.change(model, { target: { value: 'IP14-256' } });
    expect(stockOptions()[0].textContent).toMatch(/IPHONE 14/);

    fireEvent.change(within(row).getByLabelText('Source'), { target: { value: 'shs' } });
    fireEvent.change(model, { target: { value: 'phonebox' } });
    expect(stockOptions()[0].textContent).toMatch(/IPHONE 12/);
  });

  it('lists every handset separately, so two of a model are two choices', () => {
    render(
      <BulkSaleModal
        units={[unit({ id: 'a', imei: '111111111111111' }), unit({ id: 'b', imei: '222222222222222' })]}
        sales={[]} allUnits={[]}
        shsUnits={[]} accessoryStock={[]} supplierMap={{}} onClose={() => {}}
      />,
    );
    // Office, explicitly: the grid now DEFAULTS to 'Model only', because the
    // team entering sales knows the model and not the IMEI. These tests are
    // about the office-stock search, so they have to ask for it.
    fireEvent.change(within(lastRow()).getByLabelText('Source'), { target: { value: 'office' } });
    fireEvent.change(within(lastRow()).getByLabelText('Model'), { target: { value: 'IPHONE 13' } });
    const options = stockOptions();
    expect(options).toHaveLength(2);
    expect(options.map(o => o.textContent).join()).toMatch(/111111111111111[\s\S]*222222222222222/);
  });

  it('will not offer a handset another row already claimed', () => {
    render(
      <BulkSaleModal
        units={[unit({ id: 'a', imei: '111111111111111' }), unit({ id: 'b', imei: '222222222222222' })]}
        sales={[]} allUnits={[]}
        shsUnits={[]} accessoryStock={[]} supplierMap={{}} onClose={() => {}}
      />,
    );
    pick('Office', 'IPHONE 13');                          // takes the first
    fireEvent.click(screen.getByRole('button', { name: /Add row/i }));
    // The added row also starts on 'Model only' — this assertion is about the
    // office list, so ask for it.
    fireEvent.change(within(lastRow()).getByLabelText('Source'), { target: { value: 'office' } });
    fireEvent.change(within(lastRow()).getByLabelText('Model'), { target: { value: 'IPHONE 13' } });
    const options = stockOptions();
    expect(options, 'the claimed handset is gone').toHaveLength(1);
    expect(options[0].textContent).toMatch(/222222222222222/);
  });

  it('drops the pick when the source changes, because it is a different thing', () => {
    open();
    const row = pick('Office', 'IPHONE 13');
    expect(within(row).getByLabelText('Order number')).toBeTruthy();
    fireEvent.change(within(lastRow()).getByLabelText('Source'), { target: { value: 'accessory' } });
    // Nothing is picked, so nothing is ready to sell.
    expect(screen.getByRole('button', { name: /Confirm 0 Sales/i })).toBeTruthy();
  });
});

describe('every editable cell is addressable by name, on every kind of row', () => {
  const ALWAYS = ['Source', 'Model', 'Order number', 'Sale price', 'Postage'];

  it('an office row: shared cells, and the IMEI it was picked by', () => {
    open();
    const row = pick('Office', '350000000000001');
    for (const label of ALWAYS) expect(within(row).getByLabelText(label)).toBeTruthy();
    // Shown, not typed — the handset was already identified by the search.
    expect(within(row).queryByLabelText('IMEI')).toBeNull();
    expect(row.textContent).toMatch(/350000000000001/);
  });

  it('an SHS row: the IMEI is typed, because the unit has none on file yet', () => {
    open();
    const row = pick('SHS', 'IPHONE 12');
    for (const label of ALWAYS) expect(within(row).getByLabelText(label)).toBeTruthy();
    const imei = within(row).getByLabelText('IMEI');
    expect(imei.tagName, 'a text box, not a picker').toBe('INPUT');
    expect(imei.getAttribute('placeholder')).toBe('IMEI required');
  });

  it('an accessory row: a quantity, and no IMEI at all', () => {
    open();
    const row = pick('Accessory', 'charger');
    for (const label of ALWAYS) expect(within(row).getByLabelText(label)).toBeTruthy();
    expect(within(row).getByLabelText('Quantity')).toBeTruthy();
    expect(within(row).queryByLabelText('IMEI'), 'a pool has no IMEI').toBeNull();
  });

  it('Sale price and Postage stay distinguishable on eBay, where both read 0.00', () => {
    open();
    fireEvent.click(tabFor('eBay'));
    const row = pick('Office', 'IPHONE 13');

    const sp = within(row).getByLabelText('Sale price') as HTMLInputElement;
    const postage = within(row).getByLabelText('Postage') as HTMLInputElement;
    expect(sp).not.toBe(postage);
    // The collision this guards against — same placeholder, different cells.
    expect(sp.placeholder).toBe('0.00');
    expect(postage.placeholder).toBe('0.00');

    fireEvent.change(sp, { target: { value: '350' } });
    expect(sp.value).toBe('350');
    expect(postage.value, 'typing SP must not land in Postage').toBe('');
  });

  it('lets the operator type eBay marketing, which only eBay has', () => {
    open();
    fireEvent.click(tabFor('eBay'));
    const row = pick('Office', 'IPHONE 13');
    const marketing = within(row).getByLabelText('Marketing') as HTMLInputElement;
    fireEvent.change(within(row).getByLabelText('Sale price'), { target: { value: '400' } });
    fireEvent.change(marketing, { target: { value: '10' } });

    // M. VAT is derived from what was just typed, so a non-zero Marketing
    // has to move it. A decorative column would leave it at 0.00.
    const cells = within(row).getAllByRole('cell').map(c => c.textContent?.trim());
    expect(cells.some(c => c === '2.00'), `M. VAT off £10 marketing — got ${cells.join('|')}`)
      .toBe(true);

    fireEvent.click(tabFor('Amazon'));
    expect(within(lastRow()).queryByLabelText('Marketing'), 'Amazon has no such column').toBeNull();
  });
});

describe('the row calculates itself once it has a price', () => {
  it('fills the fee and GP columns from the sale, not from anything typed', () => {
    open();
    const row = pick('Office', 'IPHONE 13');
    fireEvent.change(within(row).getByLabelText('Sale price'), { target: { value: '300' } });

    const cells = within(row).getAllByRole('cell').map(c => c.textContent?.trim());
    // BP comes off the unit and is shown, never typed — a hand-typed BP would
    // disagree with the buy record.
    expect(cells).toContain('200.00');
    expect(cells).toContain('100.00');            // SP-BP
  });

  it('counts only the rows that are actually ready to sell', () => {
    open();
    expect(screen.getByText(/0 of 1 rows ready/i)).toBeTruthy();

    const row = pick('Office', 'IPHONE 13');
    fireEvent.change(within(row).getByLabelText('Order number'), { target: { value: 'AMZ-1' } });
    fireEvent.change(within(row).getByLabelText('Sale price'), { target: { value: '300' } });
    expect(screen.getByText(/1 of 1 rows ready/i)).toBeTruthy();
  });

  it('will not count an SHS row until an IMEI has been stamped on it', () => {
    // recordBulkSales refuses an SHS unit with no IMEI, so a row that looks
    // ready but is not would fail at the very end of a long batch.
    open();
    const row = pick('SHS', 'IPHONE 12');
    fireEvent.change(within(row).getByLabelText('Order number'), { target: { value: 'AMZ-2' } });
    fireEvent.change(within(row).getByLabelText('Sale price'), { target: { value: '300' } });
    expect(screen.getByRole('button', { name: /Confirm 0 Sales/i })).toBeTruthy();

    fireEvent.change(within(lastRow()).getByLabelText('IMEI'), { target: { value: '888000000000001' } });
    expect(screen.getByRole('button', { name: /Confirm 1 Sale/i })).toBeTruthy();
  });
});
