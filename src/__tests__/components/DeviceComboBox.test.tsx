/**
 * The "+ Add" pill (admin, strict mode) writes whatever the admin typed
 * straight into the models collection as a permanent catalog entry. Real
 * client data showed this let a raw operator SKU code ("IPAD-11-128-BL")
 * get saved as a unit's model — see the "Orphans" panel it produced.
 * handleCreate must clean it up first when the code is recognised.
 */
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DeviceComboBox from '../../components/DeviceComboBox';
import type { DeviceCatalogEntry } from '../../lib/deviceCatalog';

function Wrapper({ onCreateModel }: { onCreateModel: (draft: { brand: string; model: string }) => Promise<DeviceCatalogEntry> }) {
  const [model, setModel] = useState('');
  return (
    <DeviceComboBox
      units={[]}
      seeds={[]}
      strict
      isAdmin
      brand=""
      model={model}
      onModelChange={setModel}
      onPick={() => {}}
      onCreateModel={onCreateModel}
      placeholder="Search model…"
    />
  );
}

async function typeAndOpenAdd(query: string) {
  const input = screen.getByPlaceholderText('Search model…');
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: query } });
  await waitFor(() => {
    expect(screen.queryByRole('button', { name: new RegExp(`^Add "${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`) })).toBeTruthy();
  });
}

describe('DeviceComboBox — "+ Add" model cleanup', () => {
  it('cleans up a recognised raw SKU before creating the catalog entry', async () => {
    const onCreateModel = vi.fn().mockResolvedValue({
      brand: 'Apple', model: 'Apple iPad 11 128GB', count: 0, latestDateIn: '', storages: [], colours: [], source: 'seed',
    } as DeviceCatalogEntry);

    render(<Wrapper onCreateModel={onCreateModel} />);
    await typeAndOpenAdd('IPAD-11-128-BL');

    fireEvent.click(screen.getByRole('button', { name: /^Add "IPAD-11-128-BL"/ }));

    await waitFor(() => expect(onCreateModel).toHaveBeenCalled());
    expect(onCreateModel).toHaveBeenCalledWith({ brand: '', model: 'Apple iPad 11 128GB' });
  });

  it('flags an unrecognised SKU-shaped string with a caution note, but still allows creating it', async () => {
    const onCreateModel = vi.fn().mockResolvedValue({
      brand: '', model: 'WX440-12-PK', count: 0, latestDateIn: '', storages: [], colours: [], source: 'seed',
    } as DeviceCatalogEntry);

    render(<Wrapper onCreateModel={onCreateModel} />);
    await typeAndOpenAdd('WX440-12-PK');

    expect(screen.queryByText(/looks like a raw SKU code/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^Add "WX440-12-PK"/ }));
    await waitFor(() => expect(onCreateModel).toHaveBeenCalled());
    // Unrecognised — passed through verbatim, since we can't safely guess.
    expect(onCreateModel).toHaveBeenCalledWith({ brand: '', model: 'WX440-12-PK' });
  });

  it('does not flag a genuine clean model name typed by the operator', async () => {
    const onCreateModel = vi.fn().mockResolvedValue({
      brand: '', model: 'iPhone 13 Pro Max', count: 0, latestDateIn: '', storages: [], colours: [], source: 'seed',
    } as DeviceCatalogEntry);

    render(<Wrapper onCreateModel={onCreateModel} />);
    await typeAndOpenAdd('iPhone 13 Pro Max');

    expect(screen.queryByText(/looks like a raw SKU code/i)).toBeNull();
  });
});
