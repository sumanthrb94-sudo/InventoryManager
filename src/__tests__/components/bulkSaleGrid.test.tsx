/**
 * Mark Multiple Sold is a spreadsheet, and these are the parts of it that
 * broke silently once already.
 *
 * The grid's cells are addressed by aria-label. That is not decoration: the
 * row's shape CHANGES with what it is selling — an office unit gets an IMEI
 * <select>, an SHS unit with no IMEI on file gets a text input, an accessory
 * gets neither and a quantity box instead. Anything that reaches for "the
 * first <select> in the row" is therefore reading a different cell on
 * different rows, which is exactly how the 40-unit run came to spend 30
 * seconds per row filling the wrong thing before timing out.
 *
 * Placeholders cannot carry that contract either: the Postage cell's
 * placeholder is the marketplace's autofill amount, which is "0.00" on eBay
 * — indistinguishable from the Sale price cell.
 *
 * So: every editable cell carries a stable aria-label, and each kind of row
 * offers the cells that kind actually needs. Screen readers want the same
 * thing, which is why the fix is a label rather than a test id.
 */
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import BulkSaleModal from '../../components/BulkSaleModal';
import type { InventoryUnit, AccessoryStock } from '../../types';

vi.mock('../../services/salesService', () => ({
  recordBulkSales: vi.fn(async () => ({ results: [] })),
}));

const unit = (over: Partial<InventoryUnit> & { id: string }): InventoryUnit => ({
  status: 'available', model: 'IPHONE 13', sku: 'IP13-128-MID', imei: '350000000000001',
  buyPrice: 200, supplierName: 'MHL', ownerId: 'shared', createdAt: '', updatedAt: '',
  ...over,
} as InventoryUnit);

const OFFICE = [unit({ id: 'o1', imei: '350000000000001' })];
const SHS = [unit({ id: 's1', imei: '', model: 'IPHONE 12', status: 'incoming' })];
const ACCESSORIES = [{
  id: 'a1', sku: 'USB-C-20W', name: 'USB-C 20W Charger', quantity: 12,
  buyPrice: 3.2, supplierName: 'MHL', ownerId: 'shared', createdAt: '',
} as AccessoryStock];

function open() {
  return render(
    <BulkSaleModal
      units={OFFICE} shsUnits={SHS} accessoryStock={ACCESSORIES}
      supplierMap={{}} onClose={() => {}}
    />,
  );
}

/** Type into the Model cell of the last row and pick the suggestion tagged `tag`. */
function pickInLastRow(tag: 'stock' | 'SHS' | 'pool', query: string) {
  const rows = screen.getAllByRole('row').slice(1);       // drop the header row
  const row = rows[rows.length - 1];
  fireEvent.change(within(row).getByLabelText('Model'), { target: { value: query } });
  const option = screen.getAllByRole('button')
    .find(b => new RegExp(tag, 'i').test(b.textContent || '')
            && new RegExp(query, 'i').test(b.textContent || ''));
  expect(option, `a suggestion tagged ${tag} for "${query}"`).toBeTruthy();
  fireEvent.click(option!);
  return row;
}

describe('the grid offers one row per thing being sold', () => {
  it('opens as a table with the money columns the operator reads across', () => {
    open();
    const headers = screen.getAllByRole('columnheader').map(h => h.textContent?.trim());
    // Append-only, like the report: these are the columns the client reconciles
    // against their own sheet, in their order.
    expect(headers).toEqual([
      '#', 'Model', 'IMEI / Qty', 'Supplier', 'Marketplace', 'Order Number',
      'BP £', 'SP £', 'Postage', 'SP-BP', 'Mar. Tax', 'Comm.', 'Total VAT',
      'GP £', 'GP %', '',
    ]);
  });

  it('lists office stock, SHS and accessory pools together, each tagged', () => {
    open();
    const row = screen.getAllByRole('row')[1];
    // Focus, not change: an empty query is what the cell already holds, so a
    // change event would not fire — and focusing is how the operator sees the
    // whole of what they hold before typing anything.
    fireEvent.focus(within(row).getByLabelText('Model'));
    const text = screen.getAllByRole('button').map(b => b.textContent || '').join('\n');
    expect(text).toMatch(/IPHONE 13[\s\S]*stock/i);
    expect(text).toMatch(/IPHONE 12[\s\S]*SHS/i);
    expect(text).toMatch(/USB-C 20W Charger[\s\S]*pool/i);
  });

  it('finds a line by supplier, not just by model', () => {
    // Two groups can carry the SAME model and differ only by where they came
    // from — office stock and an SHS consignment of the same handset. Matching
    // the model alone cannot separate them, so the operator has no way to pick
    // the consignment they mean.
    render(
      <BulkSaleModal
        units={[unit({ id: 'o1', model: 'IPHONE 12', supplierName: 'MOBILE WHOLESALE LTD' })]}
        shsUnits={[unit({ id: 's1', model: 'IPHONE 12', imei: '', status: 'incoming',
                          supplierName: 'PHONEBOX DIRECT' })]}
        accessoryStock={[]} supplierMap={{}} onClose={() => {}}
      />,
    );
    const row = screen.getAllByRole('row')[1];
    fireEvent.change(within(row).getByLabelText('Model'), { target: { value: 'phonebox' } });

    const hits = screen.getAllByRole('button')
      .map(b => b.textContent || '')
      .filter(t => /IPHONE 12/.test(t));
    expect(hits, 'only the PHONEBOX consignment').toHaveLength(1);
    expect(hits[0]).toMatch(/SHS/i);
    expect(hits[0], 'and it names the supplier so they can tell').toMatch(/PHONEBOX DIRECT/i);
  });
});

describe('every editable cell is addressable by name, on every kind of row', () => {
  // The cells that exist on ALL rows. Postage is in here deliberately: its
  // placeholder collides with Sale price on eBay, so the label is the only
  // thing telling them apart.
  const ALWAYS = ['Model', 'Marketplace', 'Order number', 'Sale price', 'Postage'];

  it('an office row: shared cells, plus an IMEI picker for the handset', () => {
    open();
    const row = pickInLastRow('stock', 'IPHONE 13');
    for (const label of ALWAYS) expect(within(row).getByLabelText(label)).toBeTruthy();
    // The unit already has an IMEI, so the operator CHOOSES which handset
    // rather than typing a number.
    expect(within(row).getByLabelText('IMEI').tagName).toBe('SELECT');
  });

  it('an SHS row: the IMEI is typed, because the unit has none on file yet', () => {
    open();
    const row = pickInLastRow('SHS', 'IPHONE 12');
    for (const label of ALWAYS) expect(within(row).getByLabelText(label)).toBeTruthy();
    const imei = within(row).getByLabelText('IMEI');
    expect(imei.tagName, 'a text box, not a picker').toBe('INPUT');
    expect(imei.getAttribute('placeholder')).toBe('IMEI required');
  });

  it('an accessory row: a quantity, and no IMEI at all', () => {
    open();
    const row = pickInLastRow('pool', 'USB-C 20W Charger');
    for (const label of ALWAYS) expect(within(row).getByLabelText(label)).toBeTruthy();
    expect(within(row).getByLabelText('Quantity')).toBeTruthy();
    expect(within(row).queryByLabelText('IMEI'), 'a pool has no IMEI').toBeNull();
  });

  it('Sale price and Postage stay distinguishable on eBay, where both read 0.00', () => {
    open();
    const row = pickInLastRow('stock', 'IPHONE 13');
    fireEvent.change(within(row).getByLabelText('Marketplace'), { target: { value: 'EBAY' } });

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
});

describe('the row calculates itself once it has a price', () => {
  it('fills in the fee and GP columns from the sale, not from anything typed', () => {
    open();
    const row = pickInLastRow('stock', 'IPHONE 13');
    fireEvent.change(within(row).getByLabelText('Marketplace'), { target: { value: 'AMAZON' } });
    fireEvent.change(within(row).getByLabelText('Sale price'), { target: { value: '300' } });

    const cells = within(row).getAllByRole('cell').map(c => c.textContent?.trim());
    // BP comes off the unit and is shown, never typed — a hand-typed BP would
    // disagree with the buy record.
    expect(cells).toContain('200.00');
    // GP £ is present and non-empty: the calculator ran.
    const gp = cells[cells.length - 3];
    expect(gp).toMatch(/^-?\d+\.\d{2}$/);
  });

  it('counts only the rows that are actually ready to sell', () => {
    open();
    expect(screen.getByText(/0 of 1 rows ready/i)).toBeTruthy();

    const row = pickInLastRow('stock', 'IPHONE 13');
    fireEvent.change(within(row).getByLabelText('Order number'), { target: { value: 'AMZ-1' } });
    fireEvent.change(within(row).getByLabelText('Sale price'), { target: { value: '300' } });
    expect(screen.getByText(/1 of 1 rows ready/i)).toBeTruthy();
  });
});
