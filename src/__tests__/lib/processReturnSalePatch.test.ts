/**
 * Locks the ProcessReturnModal Sale-doc write contract that two
 * consecutive QA rounds (BUG-RP-002, BUG-RP-003) found broken.
 *
 * Failure mode: if voidOutcome is written as 'refund' instead of 'repair'
 * for the Send-for-Repair route, every downstream report silently treats
 * the void as a customer refund. On any non-zero-leg platform this adds
 * £15.12 of phantom postage loss; on eBay's £0-leg tier the money is
 * masked but the refund/total counters still drift (round 4 BUG-RP-003).
 *
 * If this test ever fails — DO NOT just update the assertions. The Sale
 * doc is the only signal that survives ReadyToShipModal's post-completion
 * mutation of the unit; getting this wrong reopens the round-3 bug.
 */
import { describe, it, expect } from 'vitest';
import { processReturnSalePatch } from '../../lib/processReturnSalePatch';

describe('processReturnSalePatch — write contract', () => {
  it('Send-for-Repair always writes voidOutcome=repair regardless of the radio default', () => {
    // The modal's radio defaults to 'refund' even when hidden; if we
    // trust the default we ship the same bug back.
    const patch = processReturnSalePatch({
      returnType: 'repair',
      outcome: 'refund',     // <- modal default leaking through
      returnDate: '2026-06-12',
      reason: 'prod gate repair',
    });
    expect(patch.voidOutcome).toBe('repair');
    expect(patch.voidReason).toBe('In Repair — prod gate repair');
    expect(patch.voidedAt).toBe('2026-06-12');
  });

  it('Send-for-Repair stays repair even if outcome was somehow set to replacement', () => {
    const patch = processReturnSalePatch({
      returnType: 'repair',
      outcome: 'replacement',
      returnDate: '2026-06-12',
      reason: 'broken hinge',
    });
    expect(patch.voidOutcome).toBe('repair');
    expect(patch.voidReason).toBe('In Repair — broken hinge');
  });

  it('Back-to-Inventory + refund → voidOutcome=refund + "Refund —" prefix', () => {
    const patch = processReturnSalePatch({
      returnType: 'returned_to_inventory',
      outcome: 'refund',
      returnDate: '2026-06-12',
      reason: 'buyer cancelled',
    });
    expect(patch.voidOutcome).toBe('refund');
    expect(patch.voidReason).toBe('Refund — buyer cancelled');
  });

  it('Back-to-Inventory + replacement → voidOutcome=replacement + "Replacement —" prefix', () => {
    const patch = processReturnSalePatch({
      returnType: 'returned_to_inventory',
      outcome: 'replacement',
      returnDate: '2026-06-12',
      reason: 'faulty screen',
    });
    expect(patch.voidOutcome).toBe('replacement');
    expect(patch.voidReason).toBe('Replacement — faulty screen');
  });

  it('Return-to-Supplier honours the chosen outcome (not forced to repair)', () => {
    const patch = processReturnSalePatch({
      returnType: 'returned_to_supplier',
      outcome: 'refund',
      returnDate: '2026-06-12',
      reason: 'DOA',
    });
    expect(patch.voidOutcome).toBe('refund');
    expect(patch.voidReason).toBe('Refund — DOA');
  });
});
