import { describe, expect, it } from 'vitest';
import { evaluateListing } from '@/lib/lemma/engine';
import { hashBundle } from '@/lib/policy/hash';
import { getSnapshot } from '@/lib/policy/snapshots';
import { SPEC_NAME } from '@/lib/contracts';

/**
 * Temporal versions: one published bundle holding several dated versions of the
 * same spec, where the evaluation date decides which one answers.
 *
 * This is a different axis from the S0–S3 snapshots. Those are about which
 * published bundle the runtime executes, and somebody has to activate one.
 * Here nobody activates anything — moving the date is enough.
 */

// The captured S4 publication, not a local copy: these assertions are about
// what LemmaBase actually serves.
const snapshot = getSnapshot('S4');
const files = snapshot.files;

const TENANT = {
  intended_stay: '5 month',
  maximum_monthly_rent: '1200 eur',
  maximum_initial_payment: '2500 eur',
};
const LISTINGS = {
  A: { listing_reference: 'A', monthly_rent: '1100 eur', requested_deposit: '2200 eur', listing_minimum_stay: '3 month' },
  B: { listing_reference: 'B', monthly_rent: '1150 eur', requested_deposit: '1150 eur', listing_minimum_stay: '4 month' },
  C: { listing_reference: 'C', monthly_rent: '1050 eur', requested_deposit: '1050 eur', listing_minimum_stay: '6 month' },
};

const at = (effective: string, listing: keyof typeof LISTINGS) =>
  evaluateListing(files, { ...LISTINGS[listing], ...TENANT }, { spec: SPEC_NAME, effective });

describe('temporal policy versions', () => {
  it('is a captured publication carrying both dated versions', () => {
    expect(hashBundle(files)).toBe(snapshot.sourceHash);
    expect(snapshot.provenance).toBe('live-repository-read');
    const headers = files[0].code.match(/^spec shortlist_policy .*$/gm) ?? [];
    expect(headers).toEqual(['spec shortlist_policy 2026-01-01', 'spec shortlist_policy 2027-01-01']);
    // The service exposed no revision for this publication, so none was stored.
    expect(snapshot.publication?.revision).toBeUndefined();
  });

  it('reads the 2026 version before the boundary', () => {
    const r = at('2026-12-31', 'A');
    expect(r.specEffectiveFrom).toBe('2026-01-01');
    expect(r.results.booking_fee.numericEur).toBe(100);
    expect(r.results.initial_payment.numericEur).toBe(2300);
  });

  it('reads the 2027 version from the boundary onwards', () => {
    const r = at('2027-01-01', 'A');
    expect(r.specEffectiveFrom).toBe('2027-01-01');
    expect(r.results.booking_fee.numericEur).toBe(0);
    expect(r.results.initial_payment.numericEur).toBe(2200);
  });

  it('is inclusive of the effective date itself, to the day', () => {
    expect(at('2026-12-31', 'A').specEffectiveFrom).toBe('2026-01-01');
    expect(at('2027-01-01', 'A').specEffectiveFrom).toBe('2027-01-01');
  });

  it('drops the fee from every listing once the later version applies', () => {
    const before = { A: at('2026-12-31', 'A'), B: at('2026-12-31', 'B'), C: at('2026-12-31', 'C') };
    const after = { A: at('2027-06-01', 'A'), B: at('2027-06-01', 'B'), C: at('2027-06-01', 'C') };
    expect([before.A, before.B, before.C].map((r) => r.results.initial_payment.numericEur)).toEqual([2300, 2400, 2200]);
    expect([after.A, after.B, after.C].map((r) => r.results.initial_payment.numericEur)).toEqual([2200, 2300, 2100]);
  });

  it('carries the deposit cap and the stay exception into the later version', () => {
    // The 2027 slice is a whole policy, not a patch: everything S3 established
    // has to still hold, or the later version would quietly undo it.
    const a = at('2027-06-01', 'A');
    expect(a.results.effective_deposit.numericEur).toBe(1100); // capped, not the 2200 asked
    const c = at('2027-06-01', 'C');
    expect(c.results.effective_minimum_stay.months).toBe(5);
    expect(c.results.offer_fits.boolean).toBe(true);
  });

  it('the same source answers differently only because of the date', () => {
    // Nothing was activated and no source changed between these two calls.
    const early = at('2026-09-28', 'B');
    const late = at('2027-09-28', 'B');
    expect(early.sourceHash).toBe(late.sourceHash);
    expect(early.results.initial_payment.numericEur).not.toBe(late.results.initial_payment.numericEur);
  });
});
