/**
 * Accessory intake now carries the same gate as office/SHS device intake
 * (see deviceCatalogGating.test.tsx): an employee may only top up a pool
 * that already exists, and only an admin can approve a genuinely new SKU.
 *
 * Before this, the accessory tab was free text with no admin check at all,
 * so any employee could silently create a second pool for a product that
 * was already in stock under a differently-ordered name.
 */
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AccessoryComboBox from '../../components/AccessoryComboBox';
import type { AccessoryStock } from '../../types';
import type { AccessoryCatalogEntry } from '../../lib/accessoryCatalog';

const acc = (sku: string, name: string, quantity = 10): AccessoryStock => ({
  id: sku.toLowerCase(), sku, name, quantity, buyPrice: 5,
  ownerId: 'shared', createdAt: '2026-07-01',
} as AccessoryStock);

const STOCK = [acc('USB-C-20W', 'USB-C 20W Charger'), acc('SIM-PIN', 'SIM Eject Pin')];

function Harness({
  isAdmin,
  onCreateNew,
  onPick,
}: {
  isAdmin: boolean;
  onCreateNew?: (typed: string) => void;
  onPick?: (e: AccessoryCatalogEntry) => void;
}) {
  const [value, setValue] = useState('');
  return (
    <AccessoryComboBox
      accessories={STOCK}
      value={value}
      onValueChange={setValue}
      onPick={entry => { setValue(entry.sku); onPick?.(entry); }}
      onCreateNew={onCreateNew}
      isAdmin={isAdmin}
      placeholder="Accessory"
    />
  );
}

function typeIn(text: string) {
  const input = screen.getByPlaceholderText('Accessory');
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: text } });
  return input as HTMLInputElement;
}

describe('accessory intake gating', () => {
  it('employee: a brand-new accessory is blocked — no "+Add", reverts to empty on blur', async () => {
    render(<Harness isAdmin={false} />);
    const input = typeIn('Wireless Charging Pad');

    await waitFor(() => expect(screen.getByText(/No matches in \d+ known accessor/)).toBeTruthy());
    expect(screen.queryByRole('button', { name: /Add "/ })).toBeNull();
    expect(screen.getByText(/ask an admin/i)).toBeTruthy();

    fireEvent.blur(input);
    await waitFor(() => expect(input.value).toBe(''));
  });

  it('employee: CAN still top up an accessory that already exists', async () => {
    const onPick = vi.fn();
    render(<Harness isAdmin={false} onPick={onPick} />);
    typeIn('USB-C 20W Charger');

    const option = await screen.findByText('USB-C 20W Charger');
    fireEvent.click(option);
    await waitFor(() => expect(onPick).toHaveBeenCalledTimes(1));
    expect(onPick.mock.calls[0][0].sku).toBe('USB-C-20W');
  });

  it('the operator-reported dupe is caught: typing "20W USB-C" finds the existing "USB-C 20W" pool instead of offering to create it', async () => {
    render(<Harness isAdmin onCreateNew={vi.fn()} />);
    typeIn('20W USB-C');

    // The existing pool surfaces...
    expect(await screen.findByText('USB-C 20W Charger')).toBeTruthy();
    // ...and because there IS a match, no "+Add" pill is offered at all —
    // even to an admin. The duplicate can't be created by accident.
    expect(screen.queryByRole('button', { name: /Add "/ })).toBeNull();
  });

  it('admin: a genuinely new accessory offers "+Add", which hands the typed text back to the caller', async () => {
    const onCreateNew = vi.fn();
    render(<Harness isAdmin onCreateNew={onCreateNew} />);
    typeIn('Wireless Charging Pad');

    const pill = await screen.findByRole('button', { name: /Add "Wireless Charging Pad"/ });
    fireEvent.click(pill);
    expect(onCreateNew).toHaveBeenCalledWith('Wireless Charging Pad');
  });

  it('an admin-approved new SKU survives a later blur (strict={false} — it is not in the catalog yet by design)', async () => {
    function Approved() {
      const [value, setValue] = useState('Wireless Charging Pad');
      return (
        <AccessoryComboBox
          accessories={STOCK}
          value={value}
          onValueChange={setValue}
          onPick={() => {}}
          isAdmin
          strict={false}
          placeholder="Accessory"
        />
      );
    }
    render(<Approved />);
    const input = screen.getByPlaceholderText('Accessory') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.blur(input);
    // Give the deferred validator a chance to (incorrectly) fire.
    await new Promise(r => setTimeout(r, 200));
    expect(input.value).toBe('Wireless Charging Pad');
  });
});
