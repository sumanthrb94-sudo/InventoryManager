/**
 * Repair inventory units whose stored `model` decayed to a bare parenthetical.
 *
 * Field case that prompted this: three Samsung tablets sitting in inventory
 * with `model: "(10.1)(T580)"`. The product name — "Samsung Galaxy Tab A" —
 * had been stripped somewhere upstream, leaving only the screen size and the
 * model code. That is not just ugly:
 *
 *   - `isAppleDevice()` decides whether a device may use an alphanumeric
 *     SERIAL instead of a 15-digit IMEI by looking for prose (TAB / TABLET /
 *     IPAD / WIFI…). With the prose gone, three Wi-Fi-only tablets — which
 *     have no cellular radio and therefore no IMEI in existence — were told
 *     their perfectly valid serials were "invalid format", and the Sales
 *     Report import's audit gate refused to unlock.
 *   - Every display surface (Dashboard, periodic table, reports) shows
 *     "(10.1)(T580)" as the product name.
 *
 * The validator now also matches Samsung model codes directly, so the gate
 * no longer blocks. This migration fixes the DATA, so the operator sees a
 * real product name rather than a fragment.
 *
 * DELIBERATELY CONSERVATIVE — it never guesses:
 *   - Only units whose model carries NO usable word at all are candidates.
 *     "Galaxy Tab A (10.1)(T580)" is left alone; it reads fine.
 *   - A candidate is only rewritten when its model code is in the table
 *     below. An unrecognised code is reported as `unresolved` for the
 *     operator to name by hand — inventing a product name would be worse
 *     than leaving the fragment visible.
 *   - `rawModel` is never touched: it is the provenance record of what the
 *     source file actually said.
 *
 * Usage — review before writing, same as the sibling migrations here:
 *   const drift = findMangledUnitModels(units);
 *   await fixMangledUnitModels(drift, dbService);
 */

export interface TabletModelInfo {
  /** Product name written the way the operator would recognise it. */
  name: string;
  /** False for Wi-Fi-only variants — these have NO IMEI in existence, only
   *  a serial. Recorded because it is the whole reason the audit gate was
   *  demanding an impossible number. */
  hasCellular: boolean;
}

/**
 * Samsung tablet model codes → product names.
 *
 * Kept intentionally short and certain. Codes are added only when the
 * mapping is unambiguous; anything absent falls through to `unresolved`
 * rather than being approximated. Wi-Fi and LTE variants are listed as
 * separate codes because they are separate products (T580 vs T585) and the
 * cellular flag differs.
 */
export const SAMSUNG_TABLET_CODES: Readonly<Record<string, TabletModelInfo>> = {
  // Galaxy Tab A 10.1 (2016)
  T580: { name: 'Galaxy Tab A 10.1', hasCellular: false },
  T585: { name: 'Galaxy Tab A 10.1', hasCellular: true },
  // Galaxy Tab A 10.1 (2019)
  T510: { name: 'Galaxy Tab A 10.1 (2019)', hasCellular: false },
  T515: { name: 'Galaxy Tab A 10.1 (2019)', hasCellular: true },
  // Galaxy Tab A 8.0 (2019)
  T290: { name: 'Galaxy Tab A 8.0', hasCellular: false },
  T295: { name: 'Galaxy Tab A 8.0', hasCellular: true },
  // Galaxy Tab A7 10.4 (2020)
  T500: { name: 'Galaxy Tab A7 10.4', hasCellular: false },
  T505: { name: 'Galaxy Tab A7 10.4', hasCellular: true },
  // Galaxy Tab A7 Lite 8.7 (2021)
  T220: { name: 'Galaxy Tab A7 Lite 8.7', hasCellular: false },
  T225: { name: 'Galaxy Tab A7 Lite 8.7', hasCellular: true },
  // Galaxy Tab A8 10.5 (2021)
  X200: { name: 'Galaxy Tab A8 10.5', hasCellular: false },
  X205: { name: 'Galaxy Tab A8 10.5', hasCellular: true },
  // Galaxy Tab S5e 10.5 (2019)
  T720: { name: 'Galaxy Tab S5e 10.5', hasCellular: false },
  T725: { name: 'Galaxy Tab S5e 10.5', hasCellular: true },
  // Galaxy Tab S6 Lite 10.4
  P610: { name: 'Galaxy Tab S6 Lite 10.4', hasCellular: false },
  P615: { name: 'Galaxy Tab S6 Lite 10.4', hasCellular: true },
  // Galaxy Tab S7 11 (2020)
  T870: { name: 'Galaxy Tab S7 11', hasCellular: false },
  T875: { name: 'Galaxy Tab S7 11', hasCellular: true },
  // Galaxy Tab S8 11 (2022)
  X700: { name: 'Galaxy Tab S8 11', hasCellular: false },
  X706: { name: 'Galaxy Tab S8 11', hasCellular: true },
};

/**
 * True when a model string carries no usable product word — only digits,
 * punctuation and model codes. "(10.1)(T580)" qualifies; "Galaxy Tab A
 * (10.1)(T580)" does not.
 *
 * The test is deliberately about WORDS, not about parentheses: a name is
 * usable if any alphabetic run of 2+ characters survives once bracketed
 * groups are removed. That keeps the rule from firing on legitimate names
 * that merely happen to end in a parenthetical.
 */
export function isMangledModel(model: string | undefined | null): boolean {
  const s = (model ?? '').trim();
  if (!s) return false;                       // blank is a different problem
  const withoutBrackets = s.replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ');
  // Alphabetic run of 2+ that isn't itself a bare model code (T580, X205).
  const words = withoutBrackets.match(/[A-Za-z]{2,}/g) ?? [];
  const meaningful = words.filter(w => !/^(SM)$/i.test(w));
  return meaningful.length === 0;
}

/** Pull the first Samsung tablet model code out of a string, if present. */
export function extractTabletCode(model: string | undefined | null): string | undefined {
  const m = (model ?? '').toUpperCase().match(/\b(?:SM-)?([TXP]\d{3})[A-Z]?\b/);
  return m ? m[1] : undefined;
}

export interface UnitModelRowInput {
  id: string;
  model?: string;
  rawModel?: string;
  imei?: string;
}

export interface MangledModelRepair {
  id: string;
  before: string;
  after: string;
  code: string;
  hasCellular: boolean;
  /** True when the unit holds an alphanumeric serial rather than an IMEI —
   *  the population this whole repair exists to unblock. */
  usesSerial: boolean;
}

export interface MangledModelDrift {
  repairs: MangledModelRepair[];
  /** Mangled models whose code isn't in the table — named by hand, never
   *  guessed. */
  unresolved: Array<{ id: string; model: string; code?: string }>;
}

/** Work out which units need repairing. Pure — writes nothing. */
export function findMangledUnitModels(units: UnitModelRowInput[] = []): MangledModelDrift {
  const repairs: MangledModelRepair[] = [];
  const unresolved: MangledModelDrift['unresolved'] = [];

  for (const u of units) {
    const before = (u.model ?? '').trim();
    if (!isMangledModel(before)) continue;

    const code = extractTabletCode(before) ?? extractTabletCode(u.rawModel);
    const info = code ? SAMSUNG_TABLET_CODES[code] : undefined;
    if (!code || !info) {
      unresolved.push({ id: u.id, model: before, code });
      continue;
    }

    // Keep the code in the name. It is how the operator matches a unit to a
    // supplier listing, and it is what keeps the model string matching the
    // validator's code rule if the prose is ever stripped again.
    const after = `${info.name} (${code})`;
    if (after === before) continue;

    const imei = (u.imei ?? '').trim();
    repairs.push({
      id: u.id,
      before,
      after,
      code,
      hasCellular: info.hasCellular,
      usesSerial: imei.length > 0 && !/^\d{15}$/.test(imei),
    });
  }

  return { repairs, unresolved };
}

/**
 * Apply the repair. Takes dbService by parameter so this module stays
 * testable and free of Firebase imports, matching the sibling migrations.
 *
 * Writes `model` only. `rawModel` keeps saying what the source file said.
 */
export async function fixMangledUnitModels(
  drift: Pick<MangledModelDrift, 'repairs'>,
  db: {
    bulkCreate: (entries: Array<{ collection: string; id: string; data: any }>) => Promise<any>;
  },
): Promise<{ updated: number }> {
  if (drift.repairs.length === 0) return { updated: 0 };
  await db.bulkCreate(drift.repairs.map(r => ({
    collection: 'inventoryUnits',
    id: r.id,
    data: { model: r.after },
  })));
  return { updated: drift.repairs.length };
}
