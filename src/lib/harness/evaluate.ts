import { randomUUID } from 'node:crypto';
import type {
  Assessment,
  CostBreakdown,
  Listing,
  PolicySnapshot,
  SessionState,
  TenantProfile,
} from '@/lib/contracts';
import { assessListing, summarise } from '@/lib/lemma/assess';
import { getActiveSnapshot } from '@/lib/policy/snapshots';
import { readDoc, transact } from '@/lib/store/db';
import { appendEvent } from '@/lib/harness/events';

/**
 * The single enforcement point: nothing else in the app decides whether an
 * offer fits. The money and the verdict come from `assessListing`, which runs
 * the real engine; this module adds what only the harness can know — the
 * harness's own availability veto, provenance, persistence and staleness.
 */

/** Prefixed so nobody can mistake a harness check for a Lemma policy rule. */
const AVAILABILITY_CHECK = 'harness:available_for_requested_dates';

const NO_COSTS: CostBreakdown = {
  monthlyRent: null,
  effectiveDeposit: null,
  bookingFee: null,
  initialPayment: null,
  effectiveMinimumStayMonths: null,
};

// Next bundles each route handler separately, so a module-level flag set by
// /api/evaluate is invisible to /api/status. The flag lives on globalThis so
// every bundle sees the same one.
const engineFlag = globalThis as { __haEngineOk?: boolean };
/** Whether a real engine run has succeeded in this process. Used by status. */
export const engineHasRun = () => engineFlag.__haEngineOk === true;

export function assess(
  tenant: TenantProfile,
  listing: Listing,
  snapshot: PolicySnapshot,
  /** ISO date to evaluate at. Undefined means now. */
  effective?: string,
): Assessment {
  let assessment: Assessment;
  try {
    assessment = assessListing({ snapshot, tenant, listing, explain: true, effective });
    engineFlag.__haEngineOk = true;
  } catch (error) {
    // An engine failure is shown, never smoothed over into a zero or a "no".
    engineFlag.__haEngineOk = false;
    const message = error instanceof Error ? error.message : String(error);
    const at = new Date().toISOString();
    return {
      evaluationId: randomUUID(),
      listingReference: listing.reference,
      status: 'evaluation-unavailable',
      checks: [],
      costs: NO_COSTS,
      missingInputs: [],
      summary: `The policy engine could not evaluate ${listing.name}: ${message}`,
      raw: { error: message },
      tenantRevision: tenant.revision,
      listingRevision: listing.revision,
      snapshotId: snapshot.id,
      sourceHash: snapshot.sourceHash,
      evaluatedAt: at,
      effective: at,
    };
  }

  // Availability is the harness's own call, not the policy's, so it gets its own
  // clearly-labelled row and is decisive: an unavailable home cannot be taken
  // whatever the money says.
  if (!listing.availableForRequestedDates) {
    assessment.checks = [
      ...assessment.checks,
      {
        rule: AVAILABILITY_CHECK,
        label: 'Available for the requested dates — checked by the harness, not by the policy',
        passed: false,
        vetoReason: 'The advertiser has marked this home as unavailable for the requested dates.',
      },
    ];
    assessment.status = 'does-not-fit';
  }
  assessment.summary = summarise(tenant, listing, assessment);
  if (!listing.availableForRequestedDates) {
    assessment.summary = `${listing.name} is not available for the requested dates, so it cannot be taken. ${assessment.summary}`;
  }
  return assessment;
}

/* ----------------------------------------------------------- session-facing */

/** Session state, with the policy pointer lemma-core owns mirrored into it. */
export function currentSession(): Promise<SessionState> {
  const active = getActiveSnapshot();
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
  const snapshot = getActiveSnapshot();
  const { tenant, listings, evaluationDate } = await readDoc((d) => ({
    tenant: d.session.tenant,
    listings: d.session.listings,
    evaluationDate: d.session.evaluationDate,
  }));
  const targets = references?.length
    ? listings.filter((l) => references.includes(l.reference))
    : listings;
  const seq = ++issued;
  const assessments = targets.map((l) => assess(tenant, l, snapshot, evaluationDate ?? undefined));

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
export function isStale(assessment: Assessment): Promise<boolean> {
  const active = getActiveSnapshot();
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
