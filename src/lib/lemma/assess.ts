/**
 * Engine result → `Assessment`. Kept next to the adapter because it is the only
 * translation between the engine's vocabulary and the app's contract; the
 * harness evaluates through this too so both sides cannot drift.
 */

import { randomUUID } from 'node:crypto';
import type {
  Assessment,
  CheckResult,
  CostBreakdown,
  FitStatus,
  Listing,
  PolicySnapshot,
  TenantProfile,
} from '@/lib/contracts';
import { CHECK_LABELS, SPEC_NAME } from '@/lib/contracts';
import { type LemmaEvaluation, runSpec } from '@/lib/lemma/engine';

/** Engine inputs for one listing/tenant pair. */
export function listingInput(tenant: TenantProfile, listing: Listing): Record<string, unknown> {
  const data: Record<string, unknown> = {
    listing_reference: listing.reference,
    monthly_rent: `${listing.monthlyRent} eur`,
    listing_minimum_stay: `${listing.minimumStayMonths} month`,
    intended_stay: `${tenant.intendedStayMonths} month`,
    maximum_monthly_rent: `${tenant.maxMonthlyRent} eur`,
    maximum_initial_payment: `${tenant.maxInitialPayment} eur`,
  };
  // An unstated deposit stays unbound so the engine reports missing data.
  // Sending 0 would turn "we do not know" into "it is free".
  if (listing.requestedDepositMonths !== null) {
    data.requested_deposit = `${listing.requestedDepositMonths * listing.monthlyRent} eur`;
  }
  return data;
}

/**
 * Money as a person writes it. Whole amounts lose the cents; anything with a
 * fraction keeps both digits, so a cap of 1145.10 does not read as 1145.1.
 */
export const formatEuro = (n: number | null, unknown = 'unknown'): string =>
  n === null
    ? unknown
    : `€${n.toLocaleString('en-GB', {
        minimumFractionDigits: n % 1 === 0 ? 0 : 2,
        maximumFractionDigits: n % 1 === 0 ? 0 : 2,
      })}`;

function statusOf(evaluation: LemmaEvaluation): FitStatus {
  const fit = evaluation.results.offer_fits;
  if (!fit) return 'evaluation-unavailable';
  if (fit.missingData?.length) return 'needs-information';
  if (fit.vetoed) return 'evaluation-unavailable';
  if (fit.boolean === undefined) return 'evaluation-unavailable';
  return fit.boolean ? 'fits' : 'does-not-fit';
}

/**
 * How a failed check reads in a sentence. CHECK_LABELS are positive statements
 * ("Stay length meets the minimum"), which cannot be listed after "does not
 * fit" without saying the opposite of what happened.
 */
const FAILURE_PHRASES: Record<string, string> = {
  fits_monthly_budget: 'the monthly rent is above the tenant\'s limit',
  fits_initial_payment_budget: 'the up-front cost is above the tenant\'s limit',
  meets_minimum_stay: 'the home asks for a longer stay than the tenant intends',
};

/** Input names as a person would say them. */
const INPUT_NAMES: Record<string, string> = {
  requested_deposit: 'the deposit it asks for',
  monthly_rent: 'its monthly rent',
  listing_minimum_stay: 'its minimum stay',
};

/** Plain language, assembled only from values the engine returned. */
export function summarise(tenant: TenantProfile, listing: Listing, a: Assessment): string {
  const { costs } = a;
  const money =
    costs.initialPayment === null
      ? ''
      : ` Up front: ${formatEuro(costs.monthlyRent)} first month + ${formatEuro(costs.effectiveDeposit)} deposit +` +
        ` ${formatEuro(costs.bookingFee)} booking fee = ${formatEuro(costs.initialPayment)}, against a` +
        ` ${formatEuro(tenant.maxInitialPayment)} limit.`;
  const head = `${listing.name} (${listing.reference}) in ${listing.neighbourhood}, ${formatEuro(costs.monthlyRent)} a month.`;

  if (a.status === 'needs-information') {
    const what = a.missingInputs.map((i) => INPUT_NAMES[i] ?? i.replace(/_/g, ' ')).join(' and ');
    return `${head} The advertiser has not stated ${what}, so the up-front total cannot be worked out — it is unknown, not zero.`;
  }
  if (a.status === 'evaluation-unavailable') {
    const reason = a.checks.find((c) => c.vetoReason)?.vetoReason;
    return `${head} No verdict is available${reason ? `: ${reason}` : '.'}`;
  }
  if (a.status === 'fits') {
    return (
      `${head} It fits: the rent is within ${formatEuro(tenant.maxMonthlyRent)} a month, the up-front cost is within ` +
      `${formatEuro(tenant.maxInitialPayment)}, and ${tenant.intendedStayMonths} months meets the ` +
      `${costs.effectiveMinimumStayMonths ?? listing.minimumStayMonths}-month minimum.${money}`
    );
  }
  const failed = a.checks
    .filter((c) => c.passed === false && c.rule !== 'offer_fits')
    .map((c) => FAILURE_PHRASES[c.rule] ?? c.label.toLowerCase());
  return `${head} It does not fit: ${failed.join('; ')}.${money}`;
}

/** Turn one engine run into a contract-shaped assessment. */
export function toAssessment(args: {
  evaluation: LemmaEvaluation;
  /** Only the identity is needed, so a draft can be assessed without pretending to be published. */
  snapshot: Pick<PolicySnapshot, 'id' | 'sourceHash'>;
  listing: Listing;
  tenant: TenantProfile;
}): Assessment {
  const { evaluation, snapshot, listing, tenant } = args;
  const r = evaluation.results;

  const checks: CheckResult[] = Object.keys(CHECK_LABELS).map((rule) => {
    const res = r[rule];
    return {
      rule,
      label: CHECK_LABELS[rule],
      passed: res && !res.vetoed && res.boolean !== undefined ? res.boolean : null,
      display: res?.display,
      vetoReason: res?.vetoReason,
      missingData: res?.missingData,
    };
  });

  const value = (rule: string) => (r[rule]?.vetoed ? null : (r[rule]?.numericEur ?? null));
  const costs: CostBreakdown = {
    monthlyRent: listing.monthlyRent,
    effectiveDeposit: value('effective_deposit'),
    bookingFee: value('booking_fee'),
    initialPayment: value('initial_payment'),
    effectiveMinimumStayMonths: r.effective_minimum_stay?.vetoed
      ? null
      : (r.effective_minimum_stay?.months ?? null),
  };

  const missingInputs = [...new Set(Object.values(r).flatMap((x) => x.missingData ?? []))];
  const status = statusOf(evaluation);

  return {
    evaluationId: randomUUID(),
    listingReference: listing.reference,
    status,
    checks,
    costs,
    missingInputs,
    // Filled by assessListing, or by the harness once its own checks have run.
    summary: '',
    raw: evaluation.raw,
    explanation: r.offer_fits?.explanation,
    tenantRevision: tenant.revision,
    listingRevision: listing.revision,
    snapshotId: snapshot.id,
    sourceHash: snapshot.sourceHash,
    evaluatedAt: new Date().toISOString(),
    effective: evaluation.effective,
    specEffectiveFrom: evaluation.specEffectiveFrom,
  };
}

/** Evaluate one listing against a snapshot, end to end. */
export function assessListing(args: {
  snapshot: PolicySnapshot;
  tenant: TenantProfile;
  listing: Listing;
  effective?: string;
  explain?: boolean;
}): Assessment {
  const evaluation = runSpec(args.snapshot.files, listingInput(args.tenant, args.listing), {
    spec: SPEC_NAME,
    effective: args.effective,
    explain: args.explain ?? true,
  });
  const assessment = toAssessment({
    evaluation,
    snapshot: args.snapshot,
    listing: args.listing,
    tenant: args.tenant,
  });
  assessment.summary = summarise(args.tenant, args.listing, assessment);
  return assessment;
}
