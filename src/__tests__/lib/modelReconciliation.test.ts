/**
 * Locks the model-reconciliation cluster builder against the operator's
 * 2026-06-20 dupe audit. Five known false-duplicate pairs were
 * documented in periodicBucketDedup.test.ts and must roll up into
 * single clusters with a deterministic canonical pick.
 */
import { describe, it, expect } from 'vitest';
import {
  buildReconciliationClusters,
  buildReconciliationPatches,
} from '../../lib/modelReconciliation';
import type { InventoryUnit } from '../../types';

function unit(id: string, brand: string, model: string): InventoryUnit {
  return {
    id, brand, model,
    imei: id,
    category: 'Other',
    colour: 'Black',
    buyPrice: 100,
    dateIn: '2026-06-15',
    supplierId: 'sup1', supplierName: 'Test',
    status: 'available',
    flags: [],
    notes: '',
    platformListed: false,
    listingSites: [],
    ownerId: 'shared',
  } as InventoryUnit;
}

describe('buildReconciliationClusters — operator-reported dupes', () => {
  it('collapses GALAXY S23 + S23 + Galaxy S23 into one cluster', () => {
    const units = [
      ...Array.from({ length: 5 }, (_, i) => unit(`g${i}`, 'Samsung', 'GALAXY S23')),
      ...Array.from({ length: 8 }, (_, i) => unit(`c${i}`, 'Samsung', 'Galaxy S23')),
      unit('b', 'Samsung', 'S23'),
    ];
    const clusters = buildReconciliationClusters(units);
    expect(clusters).toHaveLength(1);
    const c = clusters[0];
    expect(c.totalUnits).toBe(14);
    expect(c.variants.map(v => v.rawModel)).toEqual(['Galaxy S23', 'GALAXY S23', 'S23']);
    // Canonical = most-frequent variant ('Galaxy S23' with 8 units).
    expect(c.canonical).toBe('Galaxy S23');
  });

  it('drops single-variant clusters (nothing to reconcile)', () => {
    const units = [
      unit('a', 'Apple', 'iPhone 15'),
      unit('b', 'Apple', 'iPhone 15'),
    ];
    expect(buildReconciliationClusters(units)).toHaveLength(0);
  });

  it('keeps variant suffixes distinct (XCover 5 vs Pro 4G)', () => {
    const units = [
      unit('a', 'Samsung', 'X Cover 5'),
      unit('b', 'Samsung', 'X COVER 5'),
      unit('c', 'Samsung', 'X COVER PRO 4G'),
    ];
    const clusters = buildReconciliationClusters(units);
    // Two clusters — one for "5" (2 variants), Pro 4G has only 1 variant
    // so it's dropped. The 5-cluster keeps its dupes.
    expect(clusters).toHaveLength(1);
    expect(clusters[0].variants).toHaveLength(2);
    expect(new Set(clusters[0].variants.map(v => v.rawModel)))
      .toEqual(new Set(['X Cover 5', 'X COVER 5']));
  });

  it('ties broken by longest, then alpha (deterministic canonical)', () => {
    // Two variants with equal count — longest string wins.
    const units = [
      unit('a', 'Samsung', 'Galaxy A32'),
      unit('b', 'Samsung', 'A32'),
    ];
    const c = buildReconciliationClusters(units)[0];
    expect(c.canonical).toBe('Galaxy A32');
  });

  it('orders clusters by totalUnits desc — biggest impact first', () => {
    const units = [
      // Cluster 1: 4 dupe units of A32
      ...Array.from({ length: 3 }, (_, i) => unit(`a${i}`, 'Samsung', 'GALAXY A32')),
      unit('a3', 'Samsung', 'A32'),
      // Cluster 2: 2 dupe units of S23
      unit('s0', 'Samsung', 'Galaxy S23'),
      unit('s1', 'Samsung', 'S23'),
    ];
    const clusters = buildReconciliationClusters(units);
    expect(clusters.map(c => c.totalUnits)).toEqual([4, 2]);
  });
});

describe('buildReconciliationPatches', () => {
  it('emits one patch per off-canonical unit; canonical-matching units skipped', () => {
    const units = [
      unit('u1', 'Samsung', 'Galaxy S23'),
      unit('u2', 'Samsung', 'Galaxy S23'),
      unit('u3', 'Samsung', 'GALAXY S23'),
      unit('u4', 'Samsung', 'S23'),
    ];
    const [cluster] = buildReconciliationClusters(units);
    expect(cluster.canonical).toBe('Galaxy S23');
    const patches = buildReconciliationPatches(cluster);
    // u1/u2 already at canonical — only u3/u4 get patched.
    expect(patches).toHaveLength(2);
    expect(new Set(patches.map(p => p.id))).toEqual(new Set(['u3', 'u4']));
    expect(patches.every(p => p.model === 'Galaxy S23')).toBe(true);
  });

  it('respects an operator-overridden canonical', () => {
    const units = [
      unit('u1', 'Samsung', 'Galaxy S23'),
      unit('u2', 'Samsung', 'GALAXY S23'),
    ];
    const [cluster] = buildReconciliationClusters(units);
    cluster.canonical = 'GALAXY S23';   // operator override
    const patches = buildReconciliationPatches(cluster);
    expect(patches).toHaveLength(1);
    expect(patches[0]).toEqual({ id: 'u1', model: 'GALAXY S23' });
  });
});
