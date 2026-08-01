/**
 * Backfill model / storage / colour on units ALREADY in the database, using
 * the SKU each one carries.
 *
 * decodeSkuAttributes runs when a sale creates a unit (addSoldUnitFromSale),
 * so it fixes everything imported from now on. It does nothing for units
 * created before it existed — and those are exactly the rows sitting on the
 * Orphans list. Re-importing does not reach them either: an IMEI already in
 * inventory takes the matched path, and the audit gate only asks for IMEI,
 * model, supplier and buy price, so a unit missing only storage/colour never
 * surfaces for completion.
 *
 * The unit already stores the sale's SKU (addSoldUnitFromSale writes
 * `sku: sale.sku`), which is where the operator encodes the attributes:
 *
 *     AW SE 3-40-MN        → Apple Watch SE 3 40mm · Midnight
 *     Samsung Galaxy A21S  → 32GB (single-capacity line)
 *
 * NEVER OVERWRITES REAL DATA:
 *   - model   — replaced only when the SKU decodes to a proper product name
 *               AND what's stored is a raw operator code. A human-readable
 *               model is left alone.
 *   - storage — filled only when currently empty.
 *   - colour  — filled only when currently empty or the 'Unknown' import
 *               default. An operator-chosen colour always wins.
 *
 * Usage — review before writing, same as the sibling migrations here:
 *   const drift = findUnitAttributeBackfill(units);
 *   await applyUnitAttributeBackfill(drift, dbService);
 */
import { decodeSkuAttributes, DEFAULT_COLOUR } from '../operatorSkuAttributes';
import { normalizeOperatorSku } from '../modelStorage';

export interface UnitAttributeRowInput {
  id: string;
  sku?: string;
  model?: string;
  storage?: string;
  colour?: string;
  status?: string;
}

export interface UnitAttributePatch {
  id: string;
  sku: string;
  before: { model: string; storage: string; colour: string };
  after: { model?: string; storage?: string; colour?: string };
}

export interface UnitAttributeDrift {
  patches: UnitAttributePatch[];
  /** Units whose SKU yielded nothing usable — listed so the operator knows
   *  what still needs a human, rather than the sweep quietly skipping them. */
  undecodable: Array<{ id: string; sku: string; model: string }>;
}

/** True when the stored model is a raw operator code rather than a name. */
function modelIsRawCode(model: string): boolean {
  if (!model.trim()) return true;
  // normalizeOperatorSku returns non-null only for strings it recognises AS
  // a dash-delimited operator SKU — the same test the Orphans list uses.
  if (normalizeOperatorSku(model) !== null) return true;
  // "3-40-MN" survives that (it isn't a recognised SKU shape either), so
  // also treat a model with no alphabetic word of 3+ letters as a code.
  return !/[A-Za-z]{3,}/.test(model);
}

/** Work out which units can be improved from their SKU. Pure — writes nothing. */
export function findUnitAttributeBackfill(units: UnitAttributeRowInput[] = []): UnitAttributeDrift {
  const patches: UnitAttributePatch[] = [];
  const undecodable: UnitAttributeDrift['undecodable'] = [];

  for (const u of units) {
    if (u.status && u.status !== 'sold') continue;    // scope: sold history
    const sku = (u.sku ?? '').trim();
    if (!sku) continue;

    const model = (u.model ?? '').trim();
    const storage = (u.storage ?? '').trim();
    const colour = (u.colour ?? '').trim();
    const colourIsPlaceholder = !colour || colour.toLowerCase() === 'unknown';

    const decoded = decodeSkuAttributes(sku);
    const after: UnitAttributePatch['after'] = {};

    if (decoded.model && modelIsRawCode(model) && decoded.model !== model) {
      after.model = decoded.model;
    }
    if (!storage && decoded.storage) after.storage = decoded.storage;
    if (colourIsPlaceholder) after.colour = decoded.colour ?? DEFAULT_COLOUR;

    if (Object.keys(after).length === 0) continue;

    // A colour placeholder on its own is still worth writing — it is the
    // operator's recorded decision that colour isn't tracked — but if that
    // is ALL we have and the model is still a raw code, say so.
    if (!after.model && !after.storage && modelIsRawCode(model)) {
      undecodable.push({ id: u.id, sku, model });
    }

    patches.push({
      id: u.id,
      sku,
      before: { model, storage, colour },
      after,
    });
  }

  return { patches, undecodable };
}

/**
 * Apply the backfill. Takes dbService by parameter so this module stays
 * testable and free of Firebase imports, matching the sibling migrations.
 */
export async function applyUnitAttributeBackfill(
  drift: Pick<UnitAttributeDrift, 'patches'>,
  db: {
    bulkCreate: (entries: Array<{ collection: string; id: string; data: any }>) => Promise<any>;
  },
): Promise<{ updated: number }> {
  if (drift.patches.length === 0) return { updated: 0 };
  await db.bulkCreate(drift.patches.map(p => ({
    collection: 'inventoryUnits',
    id: p.id,
    data: p.after,                                   // merge — only the fields we resolved
  })));
  return { updated: drift.patches.length };
}
