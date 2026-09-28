import { describe, expect, it } from 'vitest';
import type { JourneyFacts } from '@/lib/contracts';
import { seedJourney } from '@/lib/domain/journey';
import { evaluateMoment } from '@/lib/journey/moments';
import { hashBundle } from '@/lib/policy/hash';
import { getSnapshot } from '@/lib/policy/snapshots';

/**
 * The journey spine, executed from the captured publication.
 *
 * Three moments that look like different problems — a contract, a rent
 * increase, a deposit — and are the same kind of decision. The assertions are
 * the acceptance fixture: every figure here was produced by the real engine
 * against the published source, never computed in this file.
 */

const snapshot = getSnapshot('S5');
const seed = seedJourney();

/** Facts with one moment's fields overridden. */
function facts<K extends 'contract' | 'renewal' | 'deposit'>(
  moment: K,
  patch: Partial<JourneyFacts[K]>,
): JourneyFacts {
  return { ...seed, [moment]: { ...seed[moment], ...patch } };
}

const run = (moment: 'contract' | 'renewal' | 'deposit', f: JourneyFacts, effective?: string) =>
  evaluateMoment({ moment, snapshot, facts: f, effective });

const line = (o: ReturnType<typeof run>, rule: string) => o.lines.find((l) => l.rule === rule);

describe('the journey bundle', () => {
  it('is one publication carrying all four specs', () => {
    expect(hashBundle(snapshot.files)).toBe(snapshot.sourceHash);
    expect(snapshot.provenance).toBe('live-repository-read');
    expect(snapshot.publication?.specs).toEqual(
      expect.arrayContaining(['shortlist_policy', 'contract_check', 'renewal_policy', 'deposit_settlement']),
    );
  });
});

describe('the contract moment (mission 02)', () => {
  it('names the cost the advert never mentioned', () => {
    const o = run('contract', seed);
    expect(line(o, 'contract_monthly_cost')?.value).toBe(1185);
    expect(line(o, 'undisclosed_monthly_cost')?.value).toBe(85);
    expect(line(o, 'monthly_cost_as_advertised')?.passed).toBe(false);
    expect(line(o, 'notice_period_acceptable')?.passed).toBe(false);
    expect(o.decision.passed).toBe(false);
    expect(o.decision.vetoed).toBe(false);
  });

  it('accepts the deposit, which is what the advert said and within the cap', () => {
    const o = run('contract', seed);
    expect(line(o, 'maximum_deposit')?.value).toBe(2200);
    expect(line(o, 'deposit_as_advertised')?.passed).toBe(true);
    expect(line(o, 'deposit_within_cap')?.passed).toBe(true);
  });

  it('may be signed once the undisclosed charge and the notice period are fixed', () => {
    const o = run('contract', facts('contract', { contractServiceCharge: 0, contractNoticePeriodMonths: 1 }));
    expect(line(o, 'undisclosed_monthly_cost')?.value).toBe(0);
    expect(o.decision.passed).toBe(true);
  });
});

describe('the renewal moment (mission 06)', () => {
  it('declines an offer above the cap, and says what the cap is', () => {
    const o = run('renewal', seed, '2026-10-15');
    expect(line(o, 'maximum_increase')?.display).toBe('4.1%');
    expect(line(o, 'maximum_renewal_rent')?.value).toBe(1145.1);
    expect(line(o, 'offer_within_cap')?.passed).toBe(false);
    expect(line(o, 'notice_is_timely')?.passed).toBe(true);
    expect(o.decision.passed).toBe(false);
  });

  it('permits an offer at the cap', () => {
    const o = run('renewal', facts('renewal', { proposedMonthlyRent: 1145 }), '2026-10-15');
    expect(o.decision.passed).toBe(true);
  });

  it('refuses to answer for a contract type the policy does not cap', () => {
    const o = run('renewal', facts('renewal', { contractType: 'student_housing' }), '2026-10-15');
    // Not a "no". The policy has no rule for this case, so there is no answer
    // to give — and a plausible-looking number would be the actual failure.
    expect(o.decision.vetoed).toBe(true);
    expect(o.decision.passed).toBeNull();
    expect(line(o, 'maximum_increase')?.vetoed).toBe(true);
  });

  it('answers the 2027 question today, from the version that comes into force then', () => {
    const before = run('renewal', seed, '2026-12-31');
    const after = run('renewal', seed, '2027-01-01');

    expect(before.specEffectiveFrom).toBe('2026-01-01');
    expect(before.lines.find((l) => l.rule === 'maximum_increase')?.display).toBe('4.1%');
    expect(before.lines.find((l) => l.rule === 'maximum_renewal_rent')?.value).toBe(1145.1);

    expect(after.specEffectiveFrom).toBe('2027-01-01');
    expect(after.lines.find((l) => l.rule === 'maximum_increase')?.display).toBe('2.8%');
    expect(after.lines.find((l) => l.rule === 'maximum_renewal_rent')?.value).toBe(1130.8);

    // Same snapshot, same source, nothing activated. Only the date moved.
    expect(after.sourceHash).toBe(before.sourceHash);
    expect(after.snapshotId).toBe(before.snapshotId);
  });
});

describe('the deposit moment (mission 07)', () => {
  it('withholds nothing from a claim with no evidence on both sides', () => {
    const o = run('deposit', seed);
    expect(line(o, 'total_claimed')?.value).toBe(600);
    expect(line(o, 'chargeable_claim')?.value).toBe(600);
    expect(line(o, 'evidenced_claim')?.value).toBe(0);
    expect(line(o, 'deduction_payable')?.value).toBe(0);
    expect(line(o, 'refund_to_tenant')?.value).toBe(2200);
    expect(o.decision.passed).toBe(false);
  });

  it('upholds the same claim once both records support it', () => {
    const o = run('deposit', facts('deposit', { claimEvidenced: true }));
    expect(line(o, 'evidenced_claim')?.value).toBe(600);
    expect(line(o, 'deduction_payable')?.value).toBe(600);
    expect(line(o, 'refund_to_tenant')?.value).toBe(1600);
    expect(o.decision.passed).toBe(true);
  });

  it('charges nothing for normal wear, however well evidenced', () => {
    const o = run('deposit', facts('deposit', { claimCategory: 'normal_wear', claimEvidenced: true }));
    expect(line(o, 'chargeable_claim')?.value).toBe(0);
    expect(line(o, 'refund_to_tenant')?.value).toBe(2200);
  });

  it('never withholds more than the deposit being held', () => {
    const o = run('deposit', facts('deposit', { claimedAmount: 5000, claimEvidenced: true }));
    expect(line(o, 'deduction_payable')?.value).toBe(2200);
    expect(line(o, 'refund_to_tenant')?.value).toBe(0);
  });

  it('refuses to price a claim category the policy has no rule for', () => {
    const o = run('deposit', facts('deposit', { claimCategory: 'redecoration', claimEvidenced: true }));
    expect(line(o, 'chargeable_claim')?.vetoed).toBe(true);
    expect(o.summary).toMatch(/does not guess/);
  });
});

describe('provenance', () => {
  it('ties every outcome to the snapshot, the source and the facts it ran against', () => {
    const o = run('contract', seed);
    expect(o.snapshotId).toBe('S5');
    expect(o.sourceHash).toBe(snapshot.sourceHash);
    expect(o.factsRevision).toBe(seed.revision);
    expect(Date.parse(o.evaluatedAt)).not.toBeNaN();
    expect(Date.parse(o.effective)).not.toBeNaN();
    expect(o.evaluationId).not.toBe(run('contract', seed).evaluationId);
  });

  it('records exactly what the engine was handed', () => {
    const o = run('renewal', seed);
    expect(o.inputs).toEqual({
      current_monthly_rent: '1100 eur',
      proposed_monthly_rent: '1250 eur',
      contract_type: 'liberalised',
      notice_given: '3 month',
    });
  });
});
