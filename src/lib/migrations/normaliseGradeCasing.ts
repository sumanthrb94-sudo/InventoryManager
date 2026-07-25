/**
 * One-shot data fix for units whose `grade` (or `simType`) differs from the
 * canonical option only by CASE or padding.
 *
 * How the split happened: unitConstants declared 'Brand New', while Add
 * Stock and Bulk Order each kept a private list saying 'Brand new'. Both
 * spellings were written to Firestore for months. They are the same grade
 * to a human and two different strings to every `groupBy`, so a grade
 * breakdown showed "Brand New 12" and "Brand new 31" as separate rows and
 * neither number was right.
 *
 * The intake screens now share one list and normalise on write, so no new
 * drift is possible. This repairs what was written before that.
 *
 * SAFE BY CONSTRUCTION: a unit is only patched when its value matches a
 * canonical option case-insensitively AND differs from it exactly. A
 * genuine free-text grade the operator typed ("A/B mix", "Grade A-") never
 * matches an option, so it is left alone — this migration only ever
 * changes capitalisation and whitespace, never meaning.
 *
 * Usage — review before writing, same as every migration here:
 *   const drift = findGradeCasingDrift(units);
 *   // inspect drift.patches / drift.summary
 *   await fixGradeCasing(drift.patches, dbService);
 */
import type { InventoryUnit } from '../../types';
import { normaliseGrade, normaliseSimType } from '../unitConstants';

export interface GradeCasingPatch {
  unitId: string;
  imei?: string;
  /** Only the fields that actually change. */
  data: { grade?: string; simType?: string };
  /** For the review table. */
  before: { grade?: string; simType?: string };
}

export interface GradeCasingDrift {
  patches: GradeCasingPatch[];
  /** `"Brand New" → "Brand new": 31 units` rows, for the operator. */
  summary: Array<{ field: 'grade' | 'simType'; from: string; to: string; count: number }>;
}

/**
 * Find every unit whose grade / simType needs only a capitalisation fix.
 * Pure — returns the proposed patches without writing anything.
 */
export function findGradeCasingDrift(units: InventoryUnit[] = []): GradeCasingDrift {
  const patches: GradeCasingPatch[] = [];
  const tally = new Map<string, { field: 'grade' | 'simType'; from: string; to: string; count: number }>();

  const note = (field: 'grade' | 'simType', from: string, to: string) => {
    const key = `${field}::${from}::${to}`;
    const row = tally.get(key);
    if (row) row.count++;
    else tally.set(key, { field, from, to, count: 1 });
  };

  for (const u of units) {
    const data: GradeCasingPatch['data'] = {};
    const before: GradeCasingPatch['before'] = {};

    const rawGrade = u.grade ?? '';
    const nextGrade = normaliseGrade(rawGrade);
    if (rawGrade && nextGrade !== rawGrade) {
      data.grade = nextGrade;
      before.grade = rawGrade;
      note('grade', rawGrade, nextGrade);
    }

    const rawSim = (u as { simType?: string }).simType ?? '';
    const nextSim = normaliseSimType(rawSim);
    if (rawSim && nextSim !== rawSim) {
      data.simType = nextSim;
      before.simType = rawSim;
      note('simType', rawSim, nextSim);
    }

    if (Object.keys(data).length > 0) {
      patches.push({ unitId: u.id, imei: u.imei, data, before });
    }
  }

  return {
    patches,
    summary: [...tally.values()].sort((a, b) => b.count - a.count),
  };
}

/**
 * Apply the patches. Takes dbService by parameter so this module stays
 * testable and free of Firebase imports — same shape as the other
 * migration in this folder.
 */
export async function fixGradeCasing(
  patches: GradeCasingPatch[],
  db: { bulkCreate: (entries: Array<{ collection: string; id: string; data: any }>) => Promise<any> },
): Promise<{ updated: number }> {
  if (patches.length === 0) return { updated: 0 };
  await db.bulkCreate(patches.map(p => ({
    collection: 'inventoryUnits',
    id: p.unitId,
    data: p.data,
  })));
  return { updated: patches.length };
}
