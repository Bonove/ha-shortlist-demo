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
import { type LemmaEvaluation, evaluateListing } from '@/lib/lemma/engine';

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

const euro = (n: number | null) =>
  n === null ? 'unknown' : `€${n.toLocaleString('en-GB', { maximumFractionDigits: n % 1 === 0 ? 0 : 2 })}`;

function statusOf(evaluation: LemmaEvaluation): FitStatus {
  const fit = evaluation.results.offer_fits;
  if (!fit) return 'evaluation-unavailable';
  if (fit.missingData?.length) return 'needs-information';
  if (fit.vetoed) return 'evaluation-unavailable';
  if (fit.boolean === undefined) return 'evaluation-unavailable';
  return fit.boolean ? 'fits' : 'does-not-fit';
}

function summarise(status: FitStatus, costs: CostBreakdown, checks: CheckResult[], missing: string[]): string {
  if (status === 'needs-information') {
    return `More information is needed before this can be assessed: ${missing.join(', ')}.`;
  }
  if (status === 'evaluation-unavailable') {
    return 'The policy engine could not produce a result for this listing.';
  }
  const money = `Initial payment ${euro(costs.initialPayment)} (rent ${euro(costs.monthlyRent)} + deposit ${euro(
    costs.effectiveDeposit,
  )} + booking fee ${euro(costs.bookingFee)}).`;
  if (status === 'fits') return `Fits the stated requirements. ${money}`;
  const failed = checks.filter((c) => c.passed === false).map((c) => c.label.toLowerCase());
  return `Does not fit: ${failed.join('; ')}. ${money}`;
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
    summary: summarise(status, costs, checks, missingInputs),
    raw: evaluation.raw,
    explanation: r.offer_fits?.explanation,
    tenantRevision: tenant.revision,
    listingRevision: listing.revision,
    snapshotId: snapshot.id,
    sourceHash: snapshot.sourceHash,
    evaluatedAt: new Date().toISOString(),
    effective: evaluation.effective,
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
  const evaluation = evaluateListing(args.snapshot.files, listingInput(args.tenant, args.listing), {
    spec: SPEC_NAME,
    effective: args.effective,
    explain: args.explain ?? true,
  });
  return toAssessment({ evaluation, snapshot: args.snapshot, listing: args.listing, tenant: args.tenant });
}
