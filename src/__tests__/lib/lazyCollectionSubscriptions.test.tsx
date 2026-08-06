/**
 * Which collections the app opens on every page load.
 *
 * WHY THIS IS PINNED
 *
 * Each entry in this set is an unfiltered whole-collection onSnapshot, and
 * Firestore bills one read per document on the first snapshot. With ~3,000
 * documents that is ~3,000 reads per page load, against a free-tier ceiling of
 * 50,000 a day — about sixteen loads for the whole team before Firestore
 * starts refusing, at which point one failing listener flips the app to
 * "offline" and the screens sit empty waiting for data that never arrives.
 * That is exactly what the operator reported.
 *
 * So the boot set is a budget, not an implementation detail. Adding a
 * collection here costs its entire document count on every load forever, and
 * the two worst offenders — accessoryStockEvents and importBatches — grow by a
 * document per operation and appeared on no first screen.
 *
 * A test that merely asserted "some collections are subscribed" would not have
 * caught the original problem. This one names them.
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

const subscribed: string[] = [];

vi.mock('../../lib/dbService', () => ({
  dbService: {
    subscribeToCollection: (name: string) => {
      subscribed.push(name);
      return () => {};
    },
  },
}));

import { InventoryStoreProvider, useLazyCollection } from '../../lib/inventoryStore';

/** Collections needed to paint the first screen either team opens. */
const EAGER = [
  'inventoryUnits',
  'suppliers',
  'sales',
  'inventoryAggregates',
  'accessoryStock',
  'models',
].sort();

/** Opened only by the screen that shows them. */
const LAZY = ['accessoryStockEvents', 'importBatches'];

beforeEach(() => { subscribed.length = 0; });

describe('the collections opened at boot', () => {
  it('is exactly the set needed for first paint', async () => {
    render(<InventoryStoreProvider><div /></InventoryStoreProvider>);
    await waitFor(() => expect(subscribed.length).toBeGreaterThan(0));
    expect([...subscribed].sort()).toEqual(EAGER);
  });

  it.each(LAZY)('does NOT open %s until a screen asks', async name => {
    render(<InventoryStoreProvider><div /></InventoryStoreProvider>);
    await waitFor(() => expect(subscribed.length).toBeGreaterThan(0));
    expect(
      subscribed,
      `${name} grows by a document per operation and is on no first screen — `
      + 'opening it at boot charges the whole collection to every page load',
    ).not.toContain(name);
  });

  it('never opens supplierWhatsappUpdates', async () => {
    // Removed rather than made lazy: its only consumer (ExcelReportButton)
    // fetches it with readAll() when a report is built. The subscription fed a
    // store field App.tsx destructured and never read.
    render(<InventoryStoreProvider><div /></InventoryStoreProvider>);
    await waitFor(() => expect(subscribed.length).toBeGreaterThan(0));
    expect(subscribed).not.toContain('supplierWhatsappUpdates');
  });
});

describe('opening a collection on demand', () => {
  function Screen({ name }: { name: 'accessoryStockEvents' | 'importBatches' }) {
    useLazyCollection(name);
    return <div />;
  }

  it.each(LAZY)('%s opens when the screen that shows it mounts', async name => {
    render(
      <InventoryStoreProvider>
        <Screen name={name as 'accessoryStockEvents' | 'importBatches'} />
      </InventoryStoreProvider>,
    );
    await waitFor(() => expect(subscribed).toContain(name));
  });

  it('opens once, however many screens ask', async () => {
    // Two consumers of the same collection must not open two listeners — and
    // re-subscribing re-reads the whole collection, so a duplicate is not
    // merely untidy, it is another full read.
    render(
      <InventoryStoreProvider>
        <Screen name="accessoryStockEvents" />
        <Screen name="accessoryStockEvents" />
      </InventoryStoreProvider>,
    );
    await waitFor(() => expect(subscribed).toContain('accessoryStockEvents'));
    expect(subscribed.filter(n => n === 'accessoryStockEvents')).toHaveLength(1);
  });

  it('asking for one does not drag the other in', async () => {
    render(
      <InventoryStoreProvider><Screen name="importBatches" /></InventoryStoreProvider>,
    );
    await waitFor(() => expect(subscribed).toContain('importBatches'));
    expect(subscribed).not.toContain('accessoryStockEvents');
  });
});
