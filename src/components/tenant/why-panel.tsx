'use client';

import { useEffect, useRef, useState } from 'react';
import type { Assessment, Listing, PolicySnapshot, SystemStatus, TenantProfile } from '@/lib/contracts';
import { Mark, money, months, STATUS_META, displayStatus } from './listing-card';
import './tenant.css';

function Row({ k, v }: { k: string; v: string | null }) {
  return (
    <div>
      <span className="k">{k}</span>
      <span className="v">{v ?? 'not stated'}</span>
    </div>
  );
}

/**
 * The full account of one result: what went in, what each rule decided, what it
 * cost, which published bundle decided it, and — collapsed — the engine's own
 * output verbatim. Nothing on this panel is written by hand from a guess.
 */
export function WhyPanel({
  assessment,
  listing,
  tenant,
  status,
  onClose,
}: {
  assessment: Assessment;
  listing: Listing;
  tenant: TenantProfile;
  status: SystemStatus | null;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [snapshot, setSnapshot] = useState<PolicySnapshot | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  useEffect(() => {
    let live = true;
    fetch('/api/policy/snapshots', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`GET /api/policy/snapshots returned ${r.status}`))))
      .then((d: { snapshots: PolicySnapshot[] }) => {
        if (!live) return;
        setSnapshot(d.snapshots.find((s) => s.id === assessment.snapshotId) ?? null);
      })
      .catch((e: unknown) => live && setSnapshotError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [assessment.snapshotId]);

  const fit = displayStatus(assessment);
  const pub = snapshot?.publication;
  const mismatch =
    assessment.tenantRevision !== tenant.revision || assessment.listingRevision !== listing.revision;

  return (
    <dialog
      className="dlg"
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close();
      }}
      aria-label={`Why this result for ${listing.name}`}
    >
      <div className="dlg-head">
        <div>
          <p className="eyebrow">Why this result</p>
          <h3>{listing.name}</h3>
        </div>
        <span className={`pill ${STATUS_META[fit].pill}`}>{STATUS_META[fit].label}</span>
        <div className="spacer" />
        <button className="btn btn-sm btn-ghost" onClick={() => ref.current?.close()} aria-label="Close">
          Close
        </button>
      </div>

      <div className="dlg-body">
        <section className="dlg-section">
          <h4>Input facts used</h4>
          {mismatch && (
            <div className="notice notice-warn" style={{ marginBottom: 10 }}>
              This result was produced from an earlier revision of the inputs. The values below are the ones on
              screen now, so they may differ from what the engine was given.
            </div>
          )}
          <div className="kv">
            <Row k="Listing reference" v={listing.reference} />
            <Row k="Monthly rent" v={money(listing.monthlyRent)} />
            <Row
              k="Requested deposit"
              v={listing.requestedDepositMonths == null ? null : `${months(listing.requestedDepositMonths)} of rent`}
            />
            <Row k="Listing minimum stay" v={months(listing.minimumStayMonths)} />
            <Row k="Intended stay" v={months(tenant.intendedStayMonths)} />
            <Row k="Maximum monthly rent" v={money(tenant.maxMonthlyRent)} />
            <Row k="Maximum initial payment" v={money(tenant.maxInitialPayment)} />
            <Row k="Effective instant" v={assessment.effective} />
          </div>
        </section>

        <section className="dlg-section">
          <h4>Individual checks</h4>
          {assessment.checks.length === 0 && (
            <p className="muted" style={{ fontSize: 13 }}>The engine returned no rule results for this run.</p>
          )}
          {assessment.checks.map((c) => (
            <div className="check-row" key={c.rule}>
              <Mark passed={c.passed} />
              <div className="grow">
                <div>
                  <strong style={{ fontWeight: 600 }}>{c.label}</strong>{' '}
                  <span className="mono muted">{c.rule}</span>
                </div>
                {c.display && <div className="display">{c.display}</div>}
                {c.vetoReason && <div className="display">{c.vetoReason}</div>}
                {c.missingData && c.missingData.length > 0 && (
                  <div className="display">Missing: {c.missingData.join(', ')}</div>
                )}
              </div>
              <span className="muted" style={{ fontSize: 12.5 }}>
                {c.passed === true ? 'passed' : c.passed === false ? 'not met' : 'no result'}
              </span>
            </div>
          ))}
        </section>

        <section className="dlg-section">
          <h4>Cost breakdown</h4>
          <div className="kv">
            <Row k="Monthly rent" v={money(assessment.costs.monthlyRent)} />
            <Row k="Effective deposit" v={money(assessment.costs.effectiveDeposit)} />
            <Row k="Booking fee" v={money(assessment.costs.bookingFee)} />
            <Row k="Initial payment" v={money(assessment.costs.initialPayment)} />
            <Row k="Minimum stay applied" v={months(assessment.costs.effectiveMinimumStayMonths)} />
          </div>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>
            Initial payment is the first month’s rent plus the effective deposit plus the booking fee, as computed
            by the policy — not by this page.
          </p>
        </section>

        <section className="dlg-section">
          <h4>Policy snapshot and publication provenance</h4>
          <div className="kv">
            <Row k="Snapshot id" v={assessment.snapshotId} />
            <Row k="Snapshot label" v={snapshot?.label ?? status?.activeSnapshot?.label ?? null} />
            <Row k="Source hash" v={assessment.sourceHash} />
            <Row k="LemmaBase repository" v={pub?.repository ?? status?.lemmabase.repository ?? null} />
            <Row k="Publication revision" v={pub?.revision ?? null} />
            <Row k="Specs in the bundle" v={pub?.specs?.join(', ') ?? null} />
            <Row k="Spec version in force" v={assessment.specEffectiveFrom ?? null} />
            <Row k="Source retrieved at" v={pub?.retrievedAt ?? null} />
            <Row k="Provenance" v={snapshot?.provenance ?? null} />
            <Row k="Evaluated at" v={assessment.evaluatedAt} />
            <Row k="Evaluation id" v={assessment.evaluationId} />
          </div>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>
            {status?.lemmabase.mode === 'connected'
              ? 'The repository was read live during this session.'
              : 'Running from a stored published snapshot — the app holds no LemmaBase credentials.'}
            {pub?.revision ? '' : ' No publication revision is recorded for this bundle, so none is shown.'}
          </p>
          {snapshotError && <div className="notice notice-error">Could not load the snapshot record: {snapshotError}</div>}
        </section>

        <section className="dlg-section">
          <h4>In plain words</h4>
          <p style={{ fontSize: 14, lineHeight: 1.55 }}>
            {assessment.summary || 'The engine produced no summary for this run.'}
          </p>
        </section>

        <section className="dlg-section">
          <details className="tech">
            <summary>Technical view — engine output as returned</summary>
            <p className="muted" style={{ fontSize: 12.5, margin: '10px 0 0' }}>
              Verbatim from the Lemma engine. Nothing here is reconstructed.
            </p>
            <pre className="code">{JSON.stringify(assessment.raw, null, 2)}</pre>
            <p className="eyebrow" style={{ marginTop: 14 }}>Explanation tree</p>
            {assessment.explanation === undefined ? (
              <p className="muted" style={{ fontSize: 12.5 }}>
                The engine returned no explanation tree for this run.
              </p>
            ) : (
              <pre className="code">{JSON.stringify(assessment.explanation, null, 2)}</pre>
            )}
          </details>
        </section>
      </div>
    </dialog>
  );
}
