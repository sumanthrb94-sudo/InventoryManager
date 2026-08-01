/**
 * Decode the attributes the operator encodes INSIDE a SKU string.
 *
 * The Sales Report's marketplace tabs carry no Storage or Colour columns —
 * only Returns Detail does — so for a sale of an IMEI that was never in
 * stock, the SKU text is the only place those attributes can come from.
 * Confirmed against the operator's own export (salesreport 2026-07-31):
 *
 *     AW SE 3-40-MN     4 rows   Apple Watch SE 3, 40mm, Midnight
 *     AW SE-3-44-SL     2 rows   Apple Watch SE 3, 44mm, Silver
 *
 * Those six read as raw codes ("3-40-MN") in the app because
 * parseBrandModelStorage takes the leading "AW" for a brand name and leaves
 * "SE 3-40-MN" as the model. normalizeOperatorSku can't rescue them either:
 * it bails on any segment containing a space, and "AW SE 3" has one.
 *
 * Scope is deliberately narrow. This decodes only patterns confirmed
 * against the operator's real file — it is not a general SKU grammar.
 * Anything unrecognised returns nothing, and the caller keeps its existing
 * behaviour rather than receiving a guess.
 */

/** Colour codes as the operator writes them in the SKU tail. */
const COLOUR_CODES: Readonly<Record<string, string>> = {
  MN: 'Midnight',
  SL: 'Silver',
  SG: 'Space Grey',
  ST: 'Starlight',
  BK: 'Black',
  WH: 'White',
  BL: 'Blue',
  GD: 'Gold',
  GR: 'Green',
  PK: 'Pink',
  PU: 'Purple',
  RD: 'Red',
  GY: 'Grey',
  VT: 'Violet',
};

/**
 * Placeholder written when no colour can be determined.
 *
 * Operator decision (2026-08-01): colour is not tracked in this business —
 * what has to survive an import is the pricing (SP / BP and every derived
 * figure) and the model name. A distinct placeholder rather than 'Unknown'
 * matters because `isOrphanSoldUnit` treats 'Unknown' as "nobody has touched
 * this record", and would keep flagging rows the operator has consciously
 * decided are complete.
 *
 * Be clear-eyed about what this does: it records a DECISION, not a fact. It
 * does not discover the colour, and it stops colour from ever raising the
 * orphan flag again. Storage and raw-SKU models still do.
 */
export const DEFAULT_COLOUR = 'Unspecified';

/**
 * Model → storage, for products the operator sells in exactly one capacity
 * and sometimes writes without it.
 *
 * A21S: every A21S in the operator's export that states a capacity says
 * 32GB (3 sale rows plus a Returns Detail row from the same supplier,
 * IMAX). Confirmed by the operator 2026-08-01.
 *
 * Deliberately NOT extended to XCover: that line ships 32GB AND 64GB in the
 * same file (plus a separate XCover5 64GB), so a default there would be a
 * coin flip written into inventory as fact.
 */
const SINGLE_CAPACITY_MODELS: ReadonlyArray<{ match: RegExp; storage: string }> = [
  { match: /\bA21S\b/i, storage: '32GB' },
];

export interface DecodedSkuAttributes {
  /** Clean product name, when the SKU encodes one this decoder understands. */
  model?: string;
  storage?: string;
  colour?: string;
}

/**
 * Apple Watch: "AW SE 3-40-MN" / "AW SE-3-44-SL".
 *
 * One regex covers both spellings the operator uses (space or dash after
 * "SE"). The case size goes in the MODEL NAME, not the storage field — 40mm
 * is not a capacity, and putting it in storage would split the periodic
 * table into bogus capacity buckets.
 */
function decodeAppleWatch(sku: string): DecodedSkuAttributes | undefined {
  const m = sku.trim().toUpperCase().match(/^AW[\s-]*SE[\s-]*(\d+)[\s-]+(\d{2})[\s-]+([A-Z]{2})$/);
  if (!m) return undefined;
  const [, gen, sizeMm, colourCode] = m;
  return {
    model: `Apple Watch SE ${gen} ${sizeMm}mm`,
    colour: COLOUR_CODES[colourCode],
  };
}

/**
 * Everything this decoder can read out of one SKU string. Fields are only
 * present when genuinely derivable — never defaulted here, so the caller
 * can tell "decoded" from "fell back".
 */
export function decodeSkuAttributes(sku: string | undefined | null): DecodedSkuAttributes {
  const s = (sku ?? '').trim();
  if (!s) return {};

  const watch = decodeAppleWatch(s);
  if (watch) return watch;

  const out: DecodedSkuAttributes = {};

  // Capacity written into the name — "Samsung Galaxy A21S 32GB".
  const gb = s.match(/(\d+)\s*GB\b/i);
  if (gb) out.storage = `${gb[1]}GB`;
  else {
    const single = SINGLE_CAPACITY_MODELS.find(r => r.match.test(s));
    if (single) out.storage = single.storage;
  }

  // Trailing colour code on a dash-delimited SKU — "SG-A14-128-VT".
  const tail = s.toUpperCase().match(/-([A-Z]{2})$/);
  if (tail && COLOUR_CODES[tail[1]]) out.colour = COLOUR_CODES[tail[1]];

  return out;
}
