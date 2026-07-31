/**
 * accessoryCatalog — the "what accessories exist" lookup behind the strict
 * accessory picker in Add Stock, mirroring what `deviceCatalog.ts` does for
 * phones/tablets.
 *
 * There is no separate admin-curated seed collection for accessories: the
 * live `accessoryStock` pool docs ARE the catalog. Every SKU an employee is
 * allowed to top up is one that already exists there; creating a genuinely
 * new SKU is an admin-only action (see AccessoryComboBox).
 *
 * The key difference from the device catalog is the matching rule. Device
 * models differ by prefix ("GALAXY S23" vs "S23"), so `normalizeBucketModel`
 * strips a leading brand word. Accessory names differ by WORD ORDER and
 * punctuation instead — the operator reported "type c usb" and "c type usb"
 * being entered as two separate pools for the same product. A substring
 * search can't connect those, so the key here is token-SORTED: both collapse
 * to "c type usb" and match each other.
 */
import type { AccessoryStock } from '../types';

export interface AccessoryCatalogEntry {
  sku: string;
  name: string;
  /** Units currently in stock — surfaced in the picker so the operator can
   *  see at a glance whether they're topping up a live pool or a dead one. */
  quantity: number;
  /** Order-insensitive match key over sku + name combined. */
  key: string;
}

/** Lowercase, replace every run of non-alphanumerics with a single space,
 *  then SORT the resulting tokens. Word order and punctuation stop mattering:
 *
 *    "USB-C 20W"    → "20w c usb"
 *    "usb c 20w"    → "20w c usb"   ← same pool, different punctuation
 *    "20W USB-C"    → "20w c usb"   ← same pool, different word order
 *    "type c usb"   → "c type usb"
 *    "c type usb"   → "c type usb"  ← the operator's reported duplicate
 *
 *  Genuinely different products keep different keys, because an extra or
 *  missing token changes the result ("USB-C 20W Charger" → "20w c charger
 *  usb" ≠ "20w c usb"). This is intentionally conservative: it collapses
 *  reorderings/repunctuations of the SAME words, never merges different ones. */
export function normalizeAccessoryKey(s: string | undefined | null): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

/** Tokens of a string, order-insensitive comparison-ready. */
function tokensOf(s: string | undefined | null): string[] {
  const k = normalizeAccessoryKey(s);
  return k ? k.split(' ') : [];
}

/** Build the pickable catalog from the live accessoryStock pools. One entry
 *  per pool doc; SKUs with no name fall back to the SKU as the display name. */
export function buildAccessoryCatalog(stock: AccessoryStock[]): AccessoryCatalogEntry[] {
  const out: AccessoryCatalogEntry[] = [];
  for (const a of stock ?? []) {
    const sku = (a?.sku ?? '').trim();
    if (!sku) continue;
    const name = (a?.name ?? '').trim() || sku;
    out.push({
      sku,
      name,
      quantity: Number(a?.quantity) || 0,
      // Key spans sku AND name so typing either one finds the pool — the
      // operator may know a product by its code or by its shelf name.
      key: normalizeAccessoryKey(`${sku} ${name}`),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Exact catalog hit for a typed string — the gate the strict picker's blur
 *  validator uses to decide "is this a real, already-known accessory".
 *  Matches against the sku alone, the name alone, or the combined key, all
 *  order-insensitively, so "20W USB-C" finds the "USB-C 20W" pool. */
export function accessoryEntryFor(
  catalog: AccessoryCatalogEntry[],
  text: string | undefined | null,
): AccessoryCatalogEntry | null {
  const k = normalizeAccessoryKey(text);
  if (!k) return null;
  return catalog.find(e =>
    e.key === k ||
    normalizeAccessoryKey(e.sku) === k ||
    normalizeAccessoryKey(e.name) === k
  ) ?? null;
}

/** Rank catalog entries against a typed query. An entry matches when EVERY
 *  query token appears in it (order-insensitive prefix match per token), so
 *  "usb 20" surfaces "USB-C 20W Charger" while the query is still half-typed.
 *  Ranked by exact-key hit first, then by how much of the entry the query
 *  accounts for, then by stock on hand. */
export function searchAccessoryCatalog(
  catalog: AccessoryCatalogEntry[],
  query: string,
  limit = 8,
): AccessoryCatalogEntry[] {
  const qTokens = tokensOf(query);
  if (!qTokens.length) {
    return [...catalog].sort((a, b) => b.quantity - a.quantity).slice(0, limit);
  }
  const qKey = qTokens.join(' ');

  const scored: Array<{ e: AccessoryCatalogEntry; score: number }> = [];
  for (const e of catalog) {
    const eTokens = e.key.split(' ');
    // Every query token must be a prefix of some entry token — partial
    // typing still matches, but an unrelated word disqualifies the entry.
    const all = qTokens.every(qt => eTokens.some(et => et.startsWith(qt)));
    if (!all) continue;
    let score = 0;
    if (e.key === qKey) score += 1000;                       // exact, order-insensitive
    score += (qTokens.length / eTokens.length) * 100;        // how complete the match is
    score += Math.min(e.quantity, 50) / 100;                 // tiebreak: live stock first
    scored.push({ e, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map(s => s.e);
}
