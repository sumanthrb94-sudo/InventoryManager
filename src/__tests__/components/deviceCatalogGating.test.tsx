/**
 * Proves today's actual gating behavior when someone tries to add stock for
 * a model that exists in NEITHER the admin's model catalog (`models`
 * collection / ModelSeed) NOR current inventory — a genuinely brand-new
 * model — for both a single unit and a bulk/multi-row add.
 *
 * Office stock and SHS stock both wire this exact same DeviceComboBox
 * (`strict + isAdmin + onCreateModel`) with identical props from
 * AddStockManualModal.tsx (office ~865-898, SHS ~482-529) and
 * BulkOrderModal.tsx (~1081-1112) — there is no per-mode branching in the
 * gating itself, so proving it once at the DeviceComboBox level covers both
 * wirings. "Bulk" takes two different real shapes in the app:
 *   - AddStockManualModal's bulk grid = N independent DeviceComboBox
 *     instances, one per row (see AddStockManualModal.tsx `rows.map`).
 *   - BulkOrderModal = ONE DeviceComboBox instance shared by the whole
 *     batch (the model is picked once in Setup, then stamped onto every
 *     generated slot/unit).
 * The multi-instance tests below simulate the first shape (independent
 * rows); the single-instance tests already cover the second shape, since
 * it's the same one-instance behavior just applied downstream to N units.
 */
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import DeviceComboBox from '../../components/DeviceComboBox';
import type { DeviceCatalogEntry } from '../../lib/deviceCatalog';

function Row({
  isAdmin,
  onCreateModel,
  placeholder,
  testId,
}: {
  isAdmin: boolean;
  onCreateModel?: (draft: { brand: string; model: string }) => Promise<DeviceCatalogEntry>;
  placeholder: string;
  testId: string;
}) {
  const [model, setModel] = useState('');
  return (
    <div data-testid={testId}>
      <DeviceComboBox
        units={[]}
        seeds={[]}
        strict
        isAdmin={isAdmin}
        brand=""
        model={model}
        onModelChange={setModel}
        onPick={entry => setModel(entry.model)}
        onCreateModel={onCreateModel}
        placeholder={placeholder}
      />
    </div>
  );
}

async function typeUnknownModel(placeholder: string, text: string) {
  const input = screen.getByPlaceholderText(placeholder);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: text } });
  await waitFor(() => {
    expect(screen.getByText(new RegExp(`No matches in \\d+ known device`))).toBeTruthy();
  });
  return input;
}

describe('new-model gating — office/SHS (shared DeviceComboBox wiring)', () => {
  it('employee, single unit: brand-new model is blocked — no "+Add", input reverts to empty on blur', async () => {
    render(<Row isAdmin={false} placeholder="Row 1" testId="row1" />);
    const row = screen.getByTestId('row1');
    const input = await typeUnknownModel('Row 1', 'Totally New Phone 9000');

    // No "+Add" pill exists for a non-admin — only the read-only hint.
    expect(within(row).queryByRole('button', { name: /Add "/ })).toBeNull();
    expect(within(row).getByText(/No match — ask an admin/i)).toBeTruthy();

    fireEvent.blur(input);
    await waitFor(() => expect((input as HTMLInputElement).value).toBe(''));
  });

  it('employee, bulk (multiple independent rows): every row blocks identically — no row lets a new model through', async () => {
    render(
      <>
        <Row isAdmin={false} placeholder="Row 1" testId="row1" />
        <Row isAdmin={false} placeholder="Row 2" testId="row2" />
        <Row isAdmin={false} placeholder="Row 3" testId="row3" />
      </>
    );
    for (const ph of ['Row 1', 'Row 2', 'Row 3']) {
      const input = await typeUnknownModel(ph, 'Totally New Phone 9000');
      fireEvent.blur(input);
      await waitFor(() => expect((input as HTMLInputElement).value).toBe(''));
    }
    // Zero "+Add" pills anywhere — the block is uniform across the whole batch.
    expect(screen.queryAllByRole('button', { name: /Add "/ })).toHaveLength(0);
  });

  it('admin, single unit: "+Add" creates the catalog entry, then auto-picks it — unit is no longer blocked', async () => {
    const onCreateModel = vi.fn().mockResolvedValue({
      brand: '', model: 'Totally New Phone 9000', count: 0, latestDateIn: '', storages: [], colours: [], source: 'seed',
    } as DeviceCatalogEntry);

    render(<Row isAdmin onCreateModel={onCreateModel} placeholder="Row 1" testId="row1" />);
    const row = screen.getByTestId('row1');
    await typeUnknownModel('Row 1', 'Totally New Phone 9000');

    fireEvent.click(within(row).getByRole('button', { name: /^Add "Totally New Phone 9000"/ }));
    await waitFor(() => expect(onCreateModel).toHaveBeenCalledTimes(1));
    expect(onCreateModel).toHaveBeenCalledWith({ brand: '', model: 'Totally New Phone 9000' });

    // Picked value sticks — no revert, no lingering "ask an admin" hint.
    await waitFor(() => {
      expect((screen.getByPlaceholderText('Row 1') as HTMLInputElement).value).toBe('Totally New Phone 9000');
    });
  });

  it('admin, bulk (multiple independent rows): each row is its own catalog-creation decision — one write per row, not deduped across the batch', async () => {
    // AddStockManualModal's bulk grid wires an independent onCreateModel
    // closure per row (each row's own JSX map iteration) — there's no
    // batch-level dedup, so clicking "+Add" in N rows for the SAME new
    // model text really does call onCreateModel N times. Proving that here
    // (rather than assuming the app collapses it) is the honest read of
    // today's behavior — an admin bulk-adding a brand-new model should add
    // the catalog entry once (e.g. on the first row) and let the other
    // rows pick the now-live entry from the dropdown instead of re-adding.
    const onCreateModel = vi.fn().mockResolvedValue({
      brand: '', model: 'Totally New Phone 9000', count: 0, latestDateIn: '', storages: [], colours: [], source: 'seed',
    } as DeviceCatalogEntry);

    render(
      <>
        <Row isAdmin onCreateModel={onCreateModel} placeholder="Row 1" testId="row1" />
        <Row isAdmin onCreateModel={onCreateModel} placeholder="Row 2" testId="row2" />
      </>
    );

    for (const testId of ['row1', 'row2']) {
      const row = screen.getByTestId(testId);
      const ph = within(row).getByRole('textbox').getAttribute('placeholder')!;
      await typeUnknownModel(ph, 'Totally New Phone 9000');
      fireEvent.click(within(row).getByRole('button', { name: /^Add "Totally New Phone 9000"/ }));
    }
    await waitFor(() => expect(onCreateModel).toHaveBeenCalledTimes(2));
  });
});
