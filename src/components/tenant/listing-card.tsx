'use client';

import { useState } from 'react';
import type {
  Assessment,
  DemoApplication,
  FitStatus,
  Listing,
  SystemStatus,
  SessionState,
} from '@/lib/contracts';
import './tenant.css';

/* ------------------------------------------------------- shared helpers */

/** Whole euros, never a decimal. null is a fact we do not have, not zero. */
export function money(value: number | null | undefined): string | null {
  return value == null ? null : `€${Math.round(value).toLocaleString('en-GB')}`;
}

export function months(value: number | null | undefined): string | null {
  return value == null ? null : `${value} ${value === 1 ? 'month' : 'months'}`;
}

export const STATUS_META: Record<FitStatus, { pill: string; label: string }> = {
  fits: { pill: 'pill-fits', label: 'Fits stated requirements' },
  'does-not-fit': { pill: 'pill-nofit', label: 'Does not fit stated requirements' },
  'needs-information': { pill: 'pill-info', label: 'Needs information' },
  'evaluation-unavailable': { pill: 'pill-unavailable', label: 'Evaluation unavailable' },
};

/**
 * An unknown cost can never be presented as a pass: if any input the policy
 * needs is unbound, the card says "needs information" whatever else happened.
 */
export function displayStatus(assessment: Assessment | undefined): FitStatus {
  if (!assessment) return 'evaluation-unavailable';
  const unknownCost =
    assessment.costs.initialPayment == null ||
    assessment.costs.effectiveDeposit == null ||
    assessment.costs.bookingFee == null;
  if (assessment.missingInputs.length > 0 || unknownCost) return 'needs-information';
  return assessment.status;
}

/** Order used everywhere the listings are listed: best news first. */
export const STATUS_ORDER: FitStatus[] = [
  'fits',
  'needs-information',
  'does-not-fit',
  'evaluation-unavailable',
];

/**
 * Reasons this assessment no longer describes what is on screen. Every
 * assessment is tied to a tenant revision, a listing revision and a policy
 * bundle; if any of them moved, the result is stale rather than wrong.
 */
export function stalenessReasons(
  assessment: Assessment | undefined,
  listing: Listing,
  session: SessionState,
  status: SystemStatus | null,
): string[] {
  if (!assessment) return [];
  const out: string[] = [];
  if (assessment.tenantRevision !== session.tenant.revision) out.push('the stated requirements changed');
  if (assessment.listingRevision !== listing.revision) out.push('this listing’s details changed');
  if (assessment.snapshotId !== session.activeSnapshotId) out.push('a different policy snapshot is active');
  else if (status?.activeSnapshot && status.activeSnapshot.sourceHash !== assessment.sourceHash) {
    out.push('the active policy source changed');
  }
  return out;
}

/* -------------------------------------------------------------- markup */

function Mark({ passed }: { passed: boolean | null }) {
  const colour = passed === true ? 'var(--success)' : passed === false ? 'var(--destructive)' : 'oklch(0.52 0.13 70)';
  return (
    <svg className="mark" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="7.2" stroke={colour} strokeWidth="1.4" />
      {passed === true && <path d="M4.8 8.3l2.2 2.2 4.2-4.7" stroke={colour} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />}
      {passed === false && <path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" stroke={colour} strokeWidth="1.6" strokeLinecap="round" />}
      {passed === null && <path d="M6.2 6.2a1.9 1.9 0 113 1.6c-.6.4-1.2.7-1.2 1.5M8 11.6v.1" stroke={colour} strokeWidth="1.5" strokeLinecap="round" />}
    </svg>
  );
}

export function Figure({ label, value, headline }: { label: string; value: string | null; headline?: boolean }) {
  return (
    <div className={headline ? 'headline' : undefined}>
      <span className="k">{label}</span>
      <span className="v" data-missing={value === null}>{value ?? 'not stated'}</span>
    </div>
  );
}

export function ListingCard({
  listing,
  assessment,
  session,
  status,
  application,
  onWhy,
  onChanged,
}: {
  listing: Listing;
  assessment: Assessment | undefined;
  session: SessionState;
  status: SystemStatus | null;
  application: DemoApplication | undefined;
  onWhy: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ kind: 'ok' | 'refused' | 'error'; text: string } | null>(null);

  const fit = displayStatus(assessment);
  const meta = STATUS_META[fit];
  const stale = stalenessReasons(assessment, listing, session, status);
  const deposit = listing.requestedDepositMonths;

  async function apply() {
    setBusy(true);
    setOutcome(null);
    try {
      const res = await fetch('/api/application', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ listingReference: listing.reference }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        assessment?: Assessment;
      };
      if (res.status === 409) {
        const failed = (body.assessment?.checks ?? [])
          .filter((c) => c.passed === false)
          .map((c) => c.label.toLowerCase());
        setOutcome({
          kind: 'refused',
          text: failed.length
            ? `Not recorded. The policy was re-run just now and this home no longer meets the stated requirements: ${failed.join(', ')}.`
            : body.error ?? 'Not recorded. The fresh re-evaluation did not fit the stated requirements.',
        });
      } else if (!res.ok) {
        setOutcome({ kind: 'error', text: body.error ?? `The harness returned ${res.status}.` });
      } else {
        setOutcome({
          kind: 'ok',
          text: 'Demonstration application recorded locally. No booking was made, no payment taken and no message sent to the advertiser.',
        });
      }
    } catch (e) {
      setOutcome({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
      onChanged();
    }
  }

  return (
    <article className="card listing-card" data-fits={fit === 'fits'}>
      <div className="listing-art" style={{ '--hue': listing.imageHue } as React.CSSProperties}>
        <span className="art-ref">{listing.reference}</span>
        <div className="art-foot">
          <span>{listing.neighbourhood}</span>
          <span>{listing.travelMinutesToUniversity} min to university</span>
        </div>
      </div>

      <div className="listing-body">
        <div className="listing-title">
          <div>
            <h3>{listing.name}</h3>
            <p className="sub">
              Minimum stay {months(listing.minimumStayMonths)}
              {listing.availableForRequestedDates ? '' : ' · not available for the requested dates'}
            </p>
          </div>
          <span className={`pill ${meta.pill}`}>{meta.label}</span>
        </div>

        {stale.length > 0 && (
          <div className="stale-flag">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M8 1.6l6.2 11.2H1.8L8 1.6z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
              <path d="M8 6.2v3M8 11.3v.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span>Assessment out of date — {stale.join(' and ')}. Re-run before relying on it.</span>
          </div>
        )}

        <div className="figures">
          <Figure label="Monthly rent" value={money(listing.monthlyRent)} />
          <Figure
            label="Requested deposit"
            value={deposit == null ? null : `${months(deposit)} · ${money(assessment?.costs.effectiveDeposit ?? null) ?? 'not stated'}`}
          />
          <Figure label="Booking fee" value={money(assessment?.costs.bookingFee ?? null)} />
          <Figure label="Initial payment" value={money(assessment?.costs.initialPayment ?? null)} headline />
          <Figure
            label="Minimum stay applied"
            value={months(assessment?.costs.effectiveMinimumStayMonths ?? null)}
          />
          <Figure label="Travel to university" value={`${listing.travelMinutesToUniversity} min`} />
        </div>

        {fit === 'needs-information' && (
          <p className="listing-note">
            One of the costs has not been stated, so the policy could not complete every check. An unknown
            cost is not treated as zero.
          </p>
        )}
        {assessment?.summary && <p className="listing-note">{assessment.summary}</p>}
        {!assessment && (
          <p className="listing-note">
            No engine result for this listing yet. Nothing here is assumed — ask the assistant to evaluate it.
          </p>
        )}

        {application && !outcome && (
          <div className="notice notice-ok">
            Demonstration application <span className="mono">{application.id}</span> recorded locally — no booking,
            no payment, no message sent.
          </div>
        )}
        {outcome && (
          <div className={`notice notice-${outcome.kind === 'ok' ? 'ok' : outcome.kind === 'refused' ? 'warn' : 'error'}`}>
            {outcome.text}
          </div>
        )}

        <div className="listing-actions">
          <button className="btn btn-sm" onClick={onWhy} disabled={!assessment}>
            Why this result?
          </button>
          <button
            className="btn btn-sm btn-primary"
            onClick={() => void apply()}
            disabled={busy || fit !== 'fits'}
            title={fit === 'fits' ? 'Creates a local demonstration record only' : 'Only offered for homes that fit the stated requirements'}
          >
            {busy ? <span className="spin" /> : null}
            {busy ? 'Checking…' : 'Continue with this home'}
          </button>
        </div>
      </div>
    </article>
  );
}

export { Mark };
