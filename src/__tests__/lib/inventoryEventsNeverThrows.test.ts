/**
 * logInventoryEvent must never throw.
 *
 * It is called AFTER the write it describes has already landed, by service
 * functions that report failure through a returned `{ ok, error }` object and
 * never by exception. Both `addSoldUnitFromSale` and `completeUnitBuyInfo`
 * wrap only their dbService writes in try/catch — this trailing log sits
 * OUTSIDE that guard. So a rejection here didn't fail the function, it flew
 * straight past its result contract and out into the caller.
 *
 * In the sales importer that turned one unloggable row into a failed import:
 * the per-row loop had no isolation of its own, so the exception aborted every
 * remaining row, ran setPhase('preview'), and dropped the operator back on the
 * audit screen — where the un-created rows correctly reported that they still
 * needed completing. Pressing Load again repeated it exactly.
 *
 * Losing an audit line is a real loss, but the unit is the system of record
 * and it is already saved. Swallow, warn, and let the caller succeed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const create = vi.fn();
vi.mock('../../lib/dbService', () => ({ dbService: { create: (...a: unknown[]) => create(...a) } }));

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  create.mockReset();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

describe('logInventoryEvent — bookkeeping must not be able to fail the operation', () => {
  it('resolves when the underlying write rejects, instead of propagating', async () => {
    const { logInventoryEvent } = await import('../../lib/inventoryEvents');
    create.mockRejectedValue(new Error('Missing or insufficient permissions.'));

    await expect(
      logInventoryEvent({ type: 'sold', message: 'Unit 355… marked sold', unitId: '355864341213049' }),
    ).resolves.toBeUndefined();
  });

  it('reports the swallowed failure rather than hiding it completely', async () => {
    const { logInventoryEvent } = await import('../../lib/inventoryEvents');
    create.mockRejectedValue(new Error('offline'));

    await logInventoryEvent({ type: 'sold', message: 'x', unitId: 'abc' });

    expect(warn).toHaveBeenCalled();
  });

  it('still writes the event on the happy path, under the shared owner', async () => {
    const { logInventoryEvent } = await import('../../lib/inventoryEvents');
    create.mockResolvedValue(undefined);

    await logInventoryEvent({ type: 'sold', message: 'ok', unitId: 'abc' });

    expect(create).toHaveBeenCalledTimes(1);
    const [collection, , payload] = create.mock.calls[0];
    expect(collection).toBe('inventoryEvents');
    expect(payload).toMatchObject({ type: 'sold', unitId: 'abc', ownerId: 'shared' });
  });

  it('a rejection on one call does not stop the next call from writing', async () => {
    // The import loop's shape: many rows, one bad. The rest must still land.
    const { logInventoryEvent } = await import('../../lib/inventoryEvents');
    create.mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined);

    for (const id of ['a', 'b', 'c']) {
      await logInventoryEvent({ type: 'sold', message: id, unitId: id });
    }

    expect(create).toHaveBeenCalledTimes(3);
  });
});
