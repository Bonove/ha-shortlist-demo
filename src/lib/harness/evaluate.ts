import { randomUUID } from 'node:crypto';
import {
  CHECK_LABELS,
  RULES,
  type Assessment,
  type CheckResult,
  type CostBreakdown,
  type FitStatus,
  type Listing,
  type PolicySnapshot,
  type SessionState,
  type TenantProfile,
} from '@/lib/contracts';
import { evaluateListing } from '@/lib/lemma/engine';
import { getActiveSnapshot } from '@/lib/policy/snapshots';
import { readDoc, transact } from '@/lib/store/db';
import { appendEvent } from '@/lib/harness/events';

/**
 * The single enforcement point. No other module decides whether an offer fits:
 * everything here comes from a real engine run against a real snapshot, and
 * every assessment carries the provenance needed to tell when it went stale.
 */

/** Harness-level checks are prefixed so nobody mistakes them for policy rules. */
const AVAILABILITY_CHECK = 'harness:available_for_requested_dates';

const NO_COSTS: CostBreakdown = {
  monthlyRent: null,
  effectiveDeposit: null,
  bookingFee: null,
  initialPayment: null,
  effectiveMinimumStayMonths: null,
};

export function buildInput(tenant: TenantProfile, listing: Listing): Record<string, string> {
  const input: Record<string, string> = {
    listing_reference: listing.reference,
    monthly_rent: `${listing.monthlyRent} eur`,
    listing_minimum_stay: `${listing.minimumStayMonths} month`,
    intended_stay: `${tenant.intendedStayMonths} month`,
    maximum_monthly_rent: `${tenant.maxMonthlyRent} eur`,
    maximum_initial_payment: `${tenant.maxInitialPayment} eur`,
  };
  // An unstated deposit is omitted, never sent as 0 eur: the engine then reports
  // it as missing data, so the tenant is told the total is unknown rather than
  // quoted a confidently wrong one.
  if (listing.requestedDepositMonths !== null) {
    input.requested_deposit = `${listing.requestedDepositMonths * listing.monthlyRent} eur`;
  }
  return input;
}

let engineOk = false;
/** Whether a real engine run has succeeded in this process. Used by status. */
export const engineHasRun = () => engineOk;

export async function assess(
  tenant: TenantProfile,
  listing: Listing,
  snapshot: PolicySnapshot,
): Promise<Assessment> {
  const evaluatedAt = new Date().toISOString();
  const base = {
    evaluationId: randomUUID(),
    listingReference: listing.reference,
    tenantRevision: tenant.revision,
    listingRevision: listing.revision,
    snapshotId: snapshot.id,
    sourceHash: snapshot.sourceHash,
    evaluatedAt,
  };

  let ev;
  try {
    ev = await evaluateListing(snapshot.files, buildInput(tenant, listing), { explain: true });
  } catch (err) {
    engineOk = false;
    const message = err instanceof Error ? err.message : String(err);
    return {
      ...base,
      status: 'evaluation-unavailable',
      checks: [],
      costs: NO_COSTS,
      missingInputs: [],
      summary: `The policy engine could not evaluate ${listing.name}: ${message}`,
      raw: { error: message },
      effective: evaluatedAt,
    };
  }
  engineOk = true;

  const r = ev.results;
  const money = (rule: string) => r[rule]?.numericEur ?? null;
  const costs: CostBreakdown = {
    // monthly_rent is the figure we supplied; the rest are the engine's maths.
    monthlyRent: money('monthly_rent') ?? listing.monthlyRent,
    effectiveDeposit: money('effective_deposit'),
    bookingFee: money('booking_fee'),
    initialPayment: money('initial_payment'),
    effectiveMinimumStayMonths: r.effective_minimum_stay?.months ?? null,
  };

  const missingInputs = [...new Set(RULES.flatMap((rule) => r[rule]?.missingData ?? []))];

  const checks: CheckResult[] = RULES.filter((rule) => rule in CHECK_LABELS).map((rule) => {
    const res = r[rule];
    return {
      rule,
      label: CHECK_LABELS[rule],
      passed: !res || res.vetoed || typeof res.boolean !== 'boolean' ? null : res.boolean,
      display: res?.display,
      vetoReason: res?.vetoReason,
      missingData: res?.missingData,
    };
  });
  if (!listing.availableForRequestedDates) {
    checks.push({
      rule: AVAILABILITY_CHECK,
      label: 'Available for the requested dates — checked by the harness, not by the policy',
      passed: false,
      vetoReason: 'The advertiser has marked this home as unavailable for the requested dates.',
    });
  }

  const status = statusOf(ev.results.offer_fits, missingInputs, listing.availableForRequestedDates);

  return {
    ...base,
    status,
    checks,
    costs,
    missingInputs,
    summary: summarise(tenant, listing, status, costs, checks, missingInputs),
    raw: ev.raw,
    explanation: r.offer_fits?.explanation,
    effective: effectiveOf(ev.raw) ?? evaluatedAt,
  };
}

type RuleResult = { vetoed: boolean; boolean?: boolean };

function statusOf(fit: RuleResult | undefined, missing: string[], available: boolean): FitStatus {
  // Unavailability is decisive: whatever else is unknown, this offer cannot be
  // taken, and the check row says plainly that the harness decided it.
  if (!available) return 'does-not-fit';
  if (missing.length) return 'needs-information';
  if (!fit || fit.vetoed || typeof fit.boolean !== 'boolean') return 'evaluation-unavailable';
  return fit.boolean ? 'fits' : 'does-not-fit';
}

function effectiveOf(raw: unknown): string | undefined {
  const e = (raw as { effective?: unknown } | null)?.effective;
  return typeof e === 'string' ? e : undefined;
}

const eur = (n: number) => `€${n.toLocaleString('en-GB', { maximumFractionDigits: n % 1 ? 2 : 0 })}`;

/** Plain language, assembled only from values the engine returned. */
function summarise(
  tenant: TenantProfile,
  listing: Listing,
  status: FitStatus,
  costs: CostBreakdown,
  checks: CheckResult[],
  missing: string[],
): string {
  const parts: string[] = [`${listing.name} (${listing.reference}) in ${listing.neighbourhood}.`];
  if (costs.initialPayment !== null) {
    parts.push(
      `Up front: ${eur(costs.monthlyRent ?? listing.monthlyRent)} first month` +
        `${costs.effectiveDeposit !== null ? ` + ${eur(costs.effectiveDeposit)} deposit` : ''}` +
        `${costs.bookingFee !== null ? ` + ${eur(costs.bookingFee)} booking fee` : ''}` +
        ` = ${eur(costs.initialPayment)}, against a ${eur(tenant.maxInitialPayment)} limit.`,
    );
  }
  if (status === 'needs-information') {
    parts.push(
      `The advertiser has not stated ${missing.join(', ')}, so the total up-front cost cannot be worked out. ` +
        'It is unknown, not zero.',
    );
  } else if (status === 'does-not-fit') {
    const failed = checks.filter((c) => c.passed === false && c.rule !== 'offer_fits');
    parts.push(`This home does not fit: ${failed.map((c) => c.label.toLowerCase()).join('; ')}.`);
  } else if (status === 'fits') {
    parts.push(
      `Every check passed: rent within ${eur(tenant.maxMonthlyRent)} a month, up-front cost within ` +
        `${eur(tenant.maxInitialPayment)}, and a ${tenant.intendedStayMonths}-month stay meets the ` +
        `${costs.effectiveMinimumStayMonths ?? listing.minimumStayMonths}-month minimum.`,
    );
  } else {
    const reason = checks.find((c) => c.vetoReason)?.vetoReason;
    parts.push(`No verdict is available for this home${reason ? `: ${reason}` : '.'}`);
  }
  return parts.join(' ');
}

/* ----------------------------------------------------------- session-facing */

/** Session state, with the policy pointer lemma-core owns mirrored into it. */
export async function currentSession(): Promise<SessionState> {
  const active = await getActiveSnapshot();
  return transact((doc) => {
    if (doc.session.activeSnapshotId !== active.id) {
      doc.session.previousSnapshotId = doc.session.activeSnapshotId;
      doc.session.activeSnapshotId = active.id;
    }
    return doc.session;
  });
}

// ponytail: in-process sequence numbers. One server process owns the store, so
// a counter is enough to stop a slow earlier run overwriting a newer result.
let issued = 0;
const applied = new Map<string, number>();

export async function evaluateListings(references?: string[]): Promise<Assessment[]> {
  const snapshot = await getActiveSnapshot();
  const { tenant, listings } = await readDoc((d) => ({
    tenant: d.session.tenant,
    listings: d.session.listings,
  }));
  const targets = references?.length
    ? listings.filter((l) => references.includes(l.reference))
    : listings;
  const seq = ++issued;
  const assessments = await Promise.all(targets.map((l) => assess(tenant, l, snapshot)));

  await transact((doc) => {
    for (const a of assessments) {
      if ((applied.get(a.listingReference) ?? 0) > seq) continue; // a newer run already landed
      applied.set(a.listingReference, seq);
      doc.session.assessments[a.listingReference] = a;
    }
    doc.session.activeSnapshotId = snapshot.id;
    appendEvent(
      doc.session,
      'evaluation.ran',
      `Evaluated ${assessments.map((a) => a.listingReference).join(', ') || 'nothing'} against ${snapshot.label}`,
      {
        snapshotId: snapshot.id,
        sourceHash: snapshot.sourceHash,
        statuses: Object.fromEntries(assessments.map((a) => [a.listingReference, a.status])),
      },
    );
  });
  return assessments;
}

/** True when the world has moved on since this assessment was produced. */
export async function isStale(assessment: Assessment): Promise<boolean> {
  const active = await getActiveSnapshot();
  return readDoc((d) => {
    const listing = d.session.listings.find((l) => l.reference === assessment.listingReference);
    return (
      !listing ||
      assessment.tenantRevision !== d.session.tenant.revision ||
      assessment.listingRevision !== listing.revision ||
      assessment.snapshotId !== active.id ||
      assessment.sourceHash !== active.sourceHash
    );
  });
}
