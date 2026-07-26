/**
 * dataHealth.ts — the broken records, before they reach a report.
 *
 * Every bug this codebase has had a bad afternoon over started as a record
 * that was already wrong and had nowhere to show up: a unit with no buy
 * price (so every profit figure built on a zero), an IMEI keyed twice (so
 * one sale matched the wrong phone), a sale whose IMEI matches nothing in
 * stock (so revenue exists with no cost behind it), SHS stock a supplier
 * has been "holding" since spring.
 *
 * None of those surface until a number looks wrong downstream, which is the
 * expensive moment to find them. This module is the cheap moment: pure
 * predicates over the data already in the store, each one naming the record
 * and what to do about it.
 *
 * Deliberately NOT a validator — nothing here blocks a write. These are
 * conditions that are legal but suspicious, and the operator decides.
 */
import type { InventoryUnit, Sale, Supplier } from '../types';
import { marketplaceOf } from './marketplaceLabels';

export type HealthSeverity = 'high' | 'medium' | 'low';

export interface HealthIssue {
  /** Stable id for the row — unit id or sale id. */
  id: string;
  /** What is wrong, in the operator's language. */
  detail: string;
  /** Enough to find the record without a search. */
  label: string;
}

export interface HealthCheck {
  key: string;
  title: string;
  /** What breaks downstream if this is left alone. */
  consequence: string;
  severity: HealthSeverity;
  issues: HealthIssue[];
}

/** Units still on the books — the only ones worth reporting on. */
const isLive = (u: InventoryUnit) =>
  u.status === 'available' || u.status === 'incoming';

const unitLabel = (u: InventoryUnit) =>
  `${u.rawModel || u.model || '(no model)'} · ${u.imei || '(no imei)'}`;

const DAY = 86_400_000;

export interface HealthInput {
  units: InventoryUnit[];
  sales: Sale[];
  /** Supplier docs, for the duplicate-name check. Optional so callers that
   *  only have units and sales still get every other check. */
  suppliers?: Supplier[];
  /** Ms epoch used for age calculations — passed in so results are stable. */
  now: number;
  /** Days a supplier may hold SHS stock before it looks abandoned. */
  shsStaleDays?: number;
}

/**
 * A unit whose buy price is missing or zero.
 *
 * Every profit figure in the app is SP − BP. A zero BP does not read as
 * "unknown", it reads as "this phone was free", so the unit shows a 100%
 * margin and pollutes every average it appears in.
 */
export function missingBuyPrice({ units }: HealthInput): HealthCheck {
  const issues = units
    .filter(isLive)
    .filter(u => !u.buyPrice || u.buyPrice <= 0)
    .map(u => ({ id: u.id, label: unitLabel(u), detail: `BP is ${u.buyPrice ?? 'empty'}` }));
  return {
    key: 'missing-bp',
    title: 'Stock with no buy price',
    consequence: 'Shows as 100% margin and inflates every average it lands in.',
    severity: 'high',
    issues,
  };
}

/**
 * A unit with no supplier.
 *
 * Supplier is how SHS stock is matched when it is fulfilled, and how return
 * rates are attributed. Without it the unit cannot be reconciled against the
 * supplier who actually sent it.
 */
export function missingSupplier({ units }: HealthInput): HealthCheck {
  const issues = units
    .filter(isLive)
    .filter(u => !(u.supplierName || '').trim() && !(u.supplierId || '').trim())
    .map(u => ({ id: u.id, label: unitLabel(u), detail: 'no supplier recorded' }));
  return {
    key: 'missing-supplier',
    title: 'Stock with no supplier',
    consequence: 'Cannot be matched on SHS fulfilment or counted in supplier performance.',
    severity: 'medium',
    issues,
  };
}

/**
 * The same IMEI on more than one live unit.
 *
 * A sale matches stock by IMEI. Two live units sharing one means the match
 * is a coin toss — one gets marked sold, the other sits in stock forever
 * looking available.
 */
export function duplicateImeis({ units }: HealthInput): HealthCheck {
  const byImei = new Map<string, InventoryUnit[]>();
  for (const u of units.filter(isLive)) {
    const key = (u.imei || '').trim().toUpperCase();
    if (!key) continue;
    byImei.set(key, [...(byImei.get(key) ?? []), u]);
  }
  const issues: HealthIssue[] = [];
  for (const [imei, dupes] of byImei) {
    if (dupes.length < 2) continue;
    issues.push({
      id: imei,
      label: `${imei} · ${dupes.length} units`,
      detail: dupes.map(u => u.rawModel || u.model || '(no model)').join(' · '),
    });
  }
  return {
    key: 'duplicate-imei',
    title: 'IMEI on more than one unit',
    consequence: 'A sale matches the wrong phone; the other never leaves stock.',
    severity: 'high',
    issues,
  };
}

/**
 * A sale whose IMEI matches nothing in inventory.
 *
 * Revenue with no cost behind it. The sale carries a buy price typed during
 * import, so profit looks plausible — but no unit ever left the shelf, so
 * stock counts stay high while the phone is gone.
 */
export function orphanSales({ units, sales }: HealthInput): HealthCheck {
  const known = new Set(
    units.map(u => (u.imei || '').trim().toUpperCase()).filter(Boolean),
  );
  const issues = sales
    .filter(s => !s.voidedAt)
    .filter(s => {
      const imei = (s.imei || '').trim().toUpperCase();
      return !!imei && !known.has(imei);
    })
    .map(s => ({
      id: s.id,
      label: `${s.marketplace} · ${s.orderNumber}`,
      detail: `IMEI ${s.imei} is not in inventory`,
    }));
  return {
    key: 'orphan-sales',
    title: 'Sales with no matching stock',
    consequence: 'Revenue recorded against a phone the system never held.',
    severity: 'high',
    issues,
  };
}

/**
 * SHS stock a supplier has held for a long time.
 *
 * Supplier-held stock is money committed to phones you cannot sell yet.
 * Past a point it is not incoming stock, it is a conversation to have.
 */
export function staleShs({ units, now, shsStaleDays = 60 }: HealthInput): HealthCheck {
  const issues = units
    .filter(u => u.status === 'incoming')
    .map(u => {
      const t = u.dateIn ? new Date(u.dateIn).getTime() : NaN;
      const days = Number.isFinite(t) ? Math.floor((now - t) / DAY) : null;
      return { u, days };
    })
    .filter(({ days }) => days !== null && days >= shsStaleDays)
    .sort((a, b) => (b.days ?? 0) - (a.days ?? 0))
    .map(({ u, days }) => ({
      id: u.id,
      label: unitLabel(u),
      detail: `held by ${u.supplierName || 'unknown supplier'} for ${days} days`,
    }));
  return {
    key: 'stale-shs',
    title: `Supplier-held stock over ${shsStaleDays} days`,
    consequence: 'Capital committed to phones that have not arrived.',
    severity: 'medium',
    issues,
  };
}

/**
 * A unit whose model is still a raw operator SKU code.
 *
 * Grouping is by model name, so a SKU string is its own group of one — it
 * never joins the model it belongs to on any screen or in any report.
 */
export function skuLikeModels({ units }: HealthInput): HealthCheck {
  // Operator SKUs look like ASI-SG-A32--64-BK-EX: several hyphen-separated
  // uppercase segments. A real model name has spaces and no run of hyphens.
  const looksLikeSku = (m: string) =>
    /^[A-Z0-9]+(-{1,2}[A-Z0-9]+){2,}$/.test(m.trim()) && !m.includes(' ');
  const issues = units
    .filter(isLive)
    .filter(u => looksLikeSku(u.rawModel || u.model || ''))
    .map(u => ({
      id: u.id,
      label: u.rawModel || u.model || '',
      detail: `IMEI ${u.imei || '—'} — model is still a SKU code`,
    }));
  return {
    key: 'sku-models',
    title: 'Stock still named by SKU code',
    consequence: 'Groups as its own model everywhere; never joins the real one.',
    severity: 'medium',
    issues,
  };
}

/**
 * A sale that lost money.
 *
 * Not an error — clearing aged stock at a loss is a real decision. It is
 * here because it is the one condition that changes the VAT figure, and
 * because a rising count is a buying problem worth seeing early.
 */
export function lossMakingSales({ sales }: HealthInput): HealthCheck {
  const issues = sales
    .filter(s => !s.voidedAt)
    .filter(s => (s.salePrice ?? 0) - (s.buyPrice ?? 0) < 0)
    .sort((a, b) => ((a.salePrice ?? 0) - (a.buyPrice ?? 0)) - ((b.salePrice ?? 0) - (b.buyPrice ?? 0)))
    .map(s => ({
      id: s.id,
      label: `${s.marketplace} · ${s.orderNumber}`,
      detail: `sold £${(s.salePrice ?? 0).toFixed(2)} against £${(s.buyPrice ?? 0).toFixed(2)} cost`,
    }));
  return {
    key: 'loss-making',
    title: 'Sales below cost',
    consequence: 'No VAT is due on these, and they drag the margin scheme total.',
    severity: 'low',
    issues,
  };
}

/**
 * An open SHS holding that already carries an IMEI.
 *
 * A holding is supplier-held stock that has not shipped — there is no
 * handset in anyone's hand yet, so there is nothing to read an IMEI off.
 * The only legitimate way a holding gets an IMEI is by being fulfilled
 * (Received into office stock, or matched against an incoming sale), and
 * both of those close the holding — it stops being `incoming`.
 *
 * So an `incoming` unit with an IMEI already on it did not get that number
 * honestly. It is almost always a leftover from before this rule existed,
 * when the SHS template required an IMEI and operators typed something in
 * to satisfy the field. That invented number matches no real phone, and it
 * breaks the one thing SHS matching depends on: if a real sale later
 * carries this same invented digit string by coincidence, or if this
 * holding is Received and the invented IMEI collides with a genuine unit,
 * the wrong holding closes.
 */
export function shsInventedImei({ units }: HealthInput): HealthCheck {
  const issues = units
    .filter(u => u.status === 'incoming')
    .filter(u => (u.imei || '').trim().length > 0)
    .map(u => ({
      id: u.id,
      label: unitLabel(u),
      detail: `held by ${u.supplierName || 'unknown supplier'} — clear the IMEI, it was never read off a real phone`,
    }));
  return {
    key: 'shs-invented-imei',
    title: 'SHS holdings with an IMEI already on them',
    consequence: 'Matches the wrong phone on receipt, or blocks a real orphan sale from finding this holding.',
    severity: 'high',
    issues,
  };
}

/**
 * Two supplier records with the same name.
 *
 * Every per-supplier figure in the app groups by supplier ID, so two docs
 * named NIHAL are two rows: one carrying all the history, one showing zero.
 * It reads as a supplier who has never sold anything, and it splits the
 * return rate that should have been attributed to one relationship.
 *
 * Near-misses are reported too — MOBILE KIT beside MOBIL KIT is a typo that
 * silently halves both. Compared on letters and digits only, so spacing,
 * punctuation and case differences all collapse.
 */
export function duplicateSuppliers({ suppliers = [] }: HealthInput): HealthCheck {
  const key = (name: string) => name.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const byKey = new Map<string, Supplier[]>();
  for (const s of suppliers) {
    const k = key(s.name ?? '');
    if (!k) continue;
    byKey.set(k, [...(byKey.get(k) ?? []), s]);
  }
  const issues: HealthIssue[] = [];
  for (const [k, group] of byKey) {
    if (group.length < 2) continue;
    issues.push({
      id: k,
      label: group.map(s => s.name).join('  ·  '),
      detail: `${group.length} supplier records share this name — each gets its own row and its own history`,
    });
  }
  return {
    key: 'duplicate-suppliers',
    title: 'Suppliers recorded more than once',
    consequence: 'Splits one relationship across rows; one shows all the sales, the other zero.',
    severity: 'high',
    issues,
  };
}

/**
 * A sold unit whose platform is not one of the four marketplaces.
 *
 * Platform figures resolve a stored value back to a marketplace. Anything
 * that will not resolve — a blank, a typo, a legacy label — is invisible on
 * every per-platform screen while still counting in the totals, so the parts
 * stop summing to the whole.
 */
export function unrecognisedPlatform({ units }: HealthInput): HealthCheck {
  const issues = units
    .filter(u => u.status === 'sold')
    .filter(u => marketplaceOf(u.salePlatform) === null)
    .map(u => ({
      id: u.id,
      label: unitLabel(u),
      detail: `sold on "${u.salePlatform || '(blank)'}" — not a known marketplace`,
    }));
  return {
    key: 'unknown-platform',
    title: 'Sold stock with an unrecognised platform',
    consequence: 'Missing from every per-platform figure while still in the totals.',
    severity: 'medium',
    issues,
  };
}

const CHECKS = [
  missingBuyPrice, missingSupplier, duplicateSuppliers, duplicateImeis,
  orphanSales, unrecognisedPlatform, staleShs, skuLikeModels, lossMakingSales,
  shsInventedImei,
];

const SEVERITY_ORDER: Record<HealthSeverity, number> = { high: 0, medium: 1, low: 2 };

/** Run every check. Worst first, and checks that found nothing sort last. */
export function runHealthChecks(input: HealthInput): HealthCheck[] {
  return CHECKS.map(fn => fn(input)).sort((a, b) => {
    if ((a.issues.length === 0) !== (b.issues.length === 0)) return a.issues.length ? -1 : 1;
    if (SEVERITY_ORDER[a.severity] !== SEVERITY_ORDER[b.severity]) {
      return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    }
    return b.issues.length - a.issues.length;
  });
}

/** One number for the header: how many records need a look. */
export function totalIssues(checks: HealthCheck[]): number {
  return checks.reduce((n, c) => n + c.issues.length, 0);
}
