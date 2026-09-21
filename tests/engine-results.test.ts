/**
 * Business behaviour, measured through the real Lemma engine.
 *
 * Nothing here is mocked: every number comes from `assessListing`, which loads
 * the captured published source and runs it. If a number in this file changes,
 * the money the tenant would actually be quoted has changed.
 */

import { describe, expect, it } from 'vitest';
import type { FitStatus, Listing, PolicySnapshot, TenantProfile } from '@/lib/contracts';
import { SPEC_PATH } from '@/lib/contracts';
import { seedListings } from '@/lib/domain/listings';
import { seedTenant } from '@/lib/domain/tenant';
import { assessListing } from '@/lib/lemma/assess';
import { assess } from '@/lib/harness/evaluate';
import { hashBundle } from '@/lib/policy/hash';
import { getSnapshot } from '@/lib/policy/snapshots';

const tenant = () => seedTenant();
const listing = (reference: string): Listing => {
  const found = seedListings().find((l) => l.reference === reference);
  if (!found) throw new Error(`no seed listing ${reference}`);
  return found;
};

/** The acceptance fixture, verbatim: initial payment in euro, and the verdict. */
const FIXTURE: Record<string, Record<string, { initialPayment: number; status: FitStatus }>> = {
  S0: {
    A: { initialPayment: 3450, status: 'does-not-fit' },
    B: { initialPayment: 2450, status: 'fits' },
    C: { initialPayment: 2250, status: 'does-not-fit' },
  },
  S1: {
    A: { initialPayment: 3400, status: 'does-not-fit' },
    B: { initialPayment: 2400, status: 'fits' },
    C: { initialPayment: 2200, status: 'does-not-fit' },
  },
  S2: {
    A: { initialPayment: 2300, status: 'fits' },
    B: { initialPayment: 2400, status: 'fits' },
    C: { initialPayment: 2200, status: 'does-not-fit' },
  },
  S3: {
    A: { initialPayment: 2300, status: 'fits' },
    B: { initialPayment: 2400, status: 'fits' },
    C: { initialPayment: 2200, status: 'fits' },
  },
};

/** Which homes the tenant is told she can take, per snapshot. */
const SHORTLIST: Record<string, string[]> = { S0: ['B'], S1: ['B'], S2: ['A', 'B'], S3: ['A', 'B', 'C'] };

describe('1. S0–S3 reproduce the acceptance fixture exactly', () => {
  for (const [snapshotId, rows] of Object.entries(FIXTURE)) {
    describe(snapshotId, () => {
      for (const [reference, expected] of Object.entries(rows)) {
        it(`${reference}: €${expected.initialPayment} up front, ${expected.status}`, () => {
          const a = assessListing({ snapshot: getSnapshot(snapshotId), tenant: tenant(), listing: listing(reference) });
          expect(a.costs.initialPayment, `${snapshotId}/${reference} initial payment`).toBe(expected.initialPayment);
          expect(a.status, `${snapshotId}/${reference} fit status`).toBe(expected.status);
          // Initial payment = first month's rent + deposit + booking fee, from the engine only.
          expect(a.costs.monthlyRent! + a.costs.effectiveDeposit! + a.costs.bookingFee!).toBe(
            expected.initialPayment,
          );
        });
      }

      it(`shortlist is ${SHORTLIST[snapshotId].join(', ')}`, () => {
        const snapshot = getSnapshot(snapshotId);
        const fitting = seedListings()
          .filter((l) => assessListing({ snapshot, tenant: tenant(), listing: l }).status === 'fits')
          .map((l) => l.reference);
        expect(fitting).toEqual(SHORTLIST[snapshotId]);
      });
    });
  }

  it('the S2 change is a deposit cap, not a discount: A pays one month, not two', () => {
    const before = assessListing({ snapshot: getSnapshot('S0'), tenant: tenant(), listing: listing('A') });
    const after = assessListing({ snapshot: getSnapshot('S2'), tenant: tenant(), listing: listing('A') });
    expect(before.costs.effectiveDeposit).toBe(2200); // two months of €1,100, as requested
    expect(after.costs.effectiveDeposit).toBe(1100); // capped at one month's rent
    expect(before.costs.bookingFee).toBe(150);
    expect(after.costs.bookingFee).toBe(100);
  });

  it('the S3 change is an exception for C only: its minimum stay becomes 5 months', () => {
    const s2 = assessListing({ snapshot: getSnapshot('S2'), tenant: tenant(), listing: listing('C') });
    const s3 = assessListing({ snapshot: getSnapshot('S3'), tenant: tenant(), listing: listing('C') });
    expect(s2.costs.effectiveMinimumStayMonths).toBe(6);
    expect(s3.costs.effectiveMinimumStayMonths).toBe(5);
    // B is not covered by the exception, so its minimum stay is untouched.
    expect(
      assessListing({ snapshot: getSnapshot('S3'), tenant: tenant(), listing: listing('B') }).costs
        .effectiveMinimumStayMonths,
    ).toBe(4);
  });
});

describe('3. a manual source edit beyond the presets changes real engine output', () => {
  it('raising the booking fee to €250 in the S0 source moves B from €2,450 to €2,550 and it stops fitting', () => {
    const s0 = getSnapshot('S0');
    const edited = s0.files.map((f) => ({ ...f, code: f.code.replace('\n  150 eur', '\n  250 eur') }));
    expect(edited[0].code, 'the edit must actually change the source text').not.toBe(s0.files[0].code);

    // A different bundle hash means a different engine instance: this result
    // cannot have come from the cached S0 engine.
    const editedSnapshot: PolicySnapshot = {
      ...s0,
      id: 'manual-edit',
      files: edited,
      sourceHash: hashBundle(edited),
    };
    expect(editedSnapshot.sourceHash).not.toBe(s0.sourceHash);

    const before = assessListing({ snapshot: s0, tenant: tenant(), listing: listing('B') });
    const after = assessListing({ snapshot: editedSnapshot, tenant: tenant(), listing: listing('B') });

    expect(before.costs.initialPayment).toBe(2450);
    expect(after.costs.bookingFee).toBe(250);
    expect(after.costs.initialPayment).toBe(2550);
    expect(before.status).toBe('fits');
    expect(after.status, '€2,550 is over the €2,500 limit').toBe('does-not-fit');
  });
});

describe("4. the independent deposit change: A's deposit two months → one month", () => {
  it('gives an S0 initial payment of exactly €2,350, and A then fits', () => {
    const a = assessListing({
      snapshot: getSnapshot('S0'),
      tenant: tenant(),
      listing: { ...listing('A'), requestedDepositMonths: 1 },
    });
    expect(a.costs.effectiveDeposit).toBe(1100);
    expect(a.costs.initialPayment).toBe(2350);
    expect(a.status).toBe('fits');
  });
});

describe('5. a value exactly equal to a budget passes', () => {
  const check = (t: TenantProfile, l: Listing, rule: string) =>
    assessListing({ snapshot: getSnapshot('S0'), tenant: t, listing: l }).checks.find((c) => c.rule === rule);

  it('rent of €1,100 against a €1,100 monthly limit passes', () => {
    const atLimit = check({ ...tenant(), maxMonthlyRent: 1100 }, listing('A'), 'fits_monthly_budget');
    expect(atLimit?.passed, 'a rent equal to the limit is within the limit').toBe(true);
    const overLimit = check({ ...tenant(), maxMonthlyRent: 1099 }, listing('A'), 'fits_monthly_budget');
    expect(overLimit?.passed).toBe(false);
  });

  it('an initial payment of €3,450 against a €3,450 up-front limit passes', () => {
    const atLimit = check(
      { ...tenant(), maxInitialPayment: 3450 },
      listing('A'),
      'fits_initial_payment_budget',
    );
    expect(atLimit?.passed, 'an initial payment equal to the limit is within the limit').toBe(true);
    const overLimit = check(
      { ...tenant(), maxInitialPayment: 3449 },
      listing('A'),
      'fits_initial_payment_budget',
    );
    expect(overLimit?.passed).toBe(false);
  });

  it('an intended stay exactly equal to the minimum stay passes', () => {
    // C asks for six months; a six-month stay meets it, five does not.
    const exact = assessListing({
      snapshot: getSnapshot('S0'),
      tenant: { ...tenant(), intendedStayMonths: 6 },
      listing: listing('C'),
    });
    expect(exact.checks.find((c) => c.rule === 'meets_minimum_stay')?.passed).toBe(true);
  });
});

describe('6. missing deposit information never becomes zero', () => {
  const unstated = assessListing({
    snapshot: getSnapshot('S0'),
    tenant: tenant(),
    // The advertiser has not stated a deposit at all.
    listing: { ...listing('A'), requestedDepositMonths: null },
  });

  it('reads as needs-information, not as a cheap home', () => {
    expect(unstated.status).toBe('needs-information');
  });

  it('leaves the cost unknown rather than zero', () => {
    expect(unstated.costs.initialPayment).toBeNull();
    expect(unstated.costs.effectiveDeposit).toBeNull();
    expect(unstated.costs.initialPayment).not.toBe(0);
  });

  it('names the input that is missing', () => {
    expect(unstated.missingInputs).toContain('requested_deposit');
    expect(
      unstated.checks.find((c) => c.rule === 'fits_initial_payment_budget')?.missingData,
    ).toContain('requested_deposit');
  });
});

describe('15. a veto is not a false, and a technical failure is not a negative result', () => {
  it("'fits' needs every check to pass", () => {
    const a = assessListing({ snapshot: getSnapshot('S0'), tenant: tenant(), listing: listing('B') });
    expect(a.status).toBe('fits');
    expect(a.checks.filter((c) => c.rule !== 'offer_fits').every((c) => c.passed === true)).toBe(true);
  });

  it("'does-not-fit' comes from a check that failed on its merits", () => {
    const a = assessListing({ snapshot: getSnapshot('S0'), tenant: tenant(), listing: listing('A') });
    expect(a.status).toBe('does-not-fit');
    expect(a.checks.find((c) => c.rule === 'fits_initial_payment_budget')?.passed).toBe(false);
    expect(a.missingInputs).toEqual([]);
  });

  it("a veto for missing data is 'needs-information', and the check is null rather than false", () => {
    const a = assessListing({
      snapshot: getSnapshot('S0'),
      tenant: tenant(),
      listing: { ...listing('A'), requestedDepositMonths: null },
    });
    expect(a.status).toBe('needs-information');
    expect(a.status).not.toBe('does-not-fit');
    const vetoed = a.checks.find((c) => c.rule === 'fits_initial_payment_budget');
    expect(vetoed?.passed, 'a vetoed check is unknown, not a no').toBeNull();
    expect(vetoed?.vetoReason).toMatch(/Missing data/i);
  });

  it("an engine failure is 'evaluation-unavailable', never a rejection of the home", () => {
    const broken: PolicySnapshot = {
      ...getSnapshot('S0'),
      id: 'broken',
      sourceHash: 'sha256:broken',
      files: [{ path: SPEC_PATH, code: 'spec shortlist_policy 2026-01-01\nrule offer_fits:\n  +' }],
    };
    const a = assess(tenant(), listing('B'), broken);
    expect(a.status).toBe('evaluation-unavailable');
    expect(a.status).not.toBe('does-not-fit');
    expect(a.costs.initialPayment, 'a failed run must not report a price').toBeNull();
    expect(a.summary).toMatch(/could not evaluate/i);
  });
});
