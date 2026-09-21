'use client';

import { useMemo, useState } from 'react';
import { ChatPanel } from '@/components/chat/chat-panel';
import { useSession } from '@/components/use-session';
import { ComparePanel } from '@/components/tenant/compare-panel';
import { ListingCard, STATUS_ORDER, displayStatus, stalenessReasons } from '@/components/tenant/listing-card';
import { RequirementsCard } from '@/components/tenant/requirements-card';
import { WhyPanel } from '@/components/tenant/why-panel';
import '@/components/tenant/tenant.css';

function Skeleton() {
  return (
    <div className="col" style={{ gap: 18 }}>
      <div className="skel" style={{ height: 150 }} />
      <div className="listing-grid">
        <div className="skel" style={{ height: 380 }} />
        <div className="skel" style={{ height: 380 }} />
      </div>
    </div>
  );
}

export default function Page() {
  const { session, status, loading, error, refresh, mutate } = useSession();
  const [whyRef, setWhyRef] = useState<string | null>(null);
  const [rerunning, setRerunning] = useState(false);
  const [rerunError, setRerunError] = useState<string | null>(null);

  const groups = useMemo(() => {
    if (!session) return { fitting: [], others: [] };
    const sorted = [...(session.listings ?? [])].sort((a, b) => {
      const d =
        STATUS_ORDER.indexOf(displayStatus(session.assessments?.[a.reference])) -
        STATUS_ORDER.indexOf(displayStatus(session.assessments?.[b.reference]));
      return d !== 0 ? d : a.reference.localeCompare(b.reference);
    });
    return {
      fitting: sorted.filter((l) => displayStatus(session.assessments?.[l.reference]) === 'fits'),
      others: sorted.filter((l) => displayStatus(session.assessments?.[l.reference]) !== 'fits'),
    };
  }, [session]);

  const anyStale = useMemo(
    () =>
      session
        ? (session.listings ?? []).some(
            (l) => stalenessReasons(session.assessments?.[l.reference], l, session, status).length > 0,
          )
        : false,
    [session, status],
  );

  async function rerun() {
    setRerunning(true);
    setRerunError(null);
    try {
      const res = await fetch('/api/evaluate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(`POST /api/evaluate returned ${res.status}`);
      await refresh();
    } catch (e) {
      setRerunError(e instanceof Error ? e.message : String(e));
    } finally {
      setRerunning(false);
    }
  }

  const whyListing = session?.listings?.find((l) => l.reference === whyRef);
  const whyAssessment = whyRef ? session?.assessments?.[whyRef] : undefined;

  return (
    <>
      <div className="page-head">
        <h1>From search overload to a trusted shortlist</h1>
        <p>
          The assistant works from one shared set of facts. Every figure and every verdict below is computed by the
          policy engine against the tenant’s stated requirements — nothing on this page decides anything itself.
        </p>
      </div>

      <div className="tenant-grid">
        <div>
          {loading && !session && <Skeleton />}

          {error && !session && (
            <div className="card card-pad col">
              <h3>The harness is not answering</h3>
              <p className="muted" style={{ fontSize: 13.5 }}>
                <span className="mono">GET /api/session</span> failed: {error}. Nothing is shown rather than guessed.
              </p>
              <div>
                <button className="btn btn-sm" onClick={() => void refresh()}>
                  Try again
                </button>
              </div>
            </div>
          )}

          {session && (
            <>
              <RequirementsCard tenant={session.tenant} onSaved={mutate} />

              {error && (
                <div className="notice notice-warn" style={{ marginTop: 14 }}>
                  Showing the last session the harness returned — the most recent refresh failed: {error}
                </div>
              )}

              {(session.listings ?? []).length === 0 && (
                <div className="card card-pad" style={{ marginTop: 22 }}>
                  <h3>No demonstration listings loaded</h3>
                  <p className="muted" style={{ fontSize: 13.5, marginTop: 6 }}>
                    The harness returned an empty listing set, so there is nothing to assess.
                  </p>
                </div>
              )}

              {(session.listings ?? []).length > 0 && (
                <>
                  <div className="section-head">
                    <h2>Homes that fit the stated requirements</h2>
                    <p>{groups.fitting.length} of {(session.listings ?? []).length}</p>
                    <div className="spacer" />
                    <button className="btn btn-sm" onClick={() => void rerun()} disabled={rerunning}>
                      {rerunning ? <span className="spin" /> : null}
                      {rerunning ? 'Re-running…' : 'Re-run the policy'}
                    </button>
                  </div>

                  {anyStale && (
                    <div className="notice notice-warn" style={{ marginBottom: 14 }}>
                      At least one assessment was produced before the current data or policy. Re-run the policy to
                      bring them up to date.
                    </div>
                  )}
                  {rerunError && (
                    <div className="notice notice-error" style={{ marginBottom: 14 }}>
                      Re-evaluation failed: {rerunError}
                    </div>
                  )}

                  {groups.fitting.length === 0 ? (
                    <div className="card card-pad">
                      <h3>Nothing fits yet</h3>
                      <p className="muted" style={{ fontSize: 13.5, marginTop: 6 }}>
                        No home currently meets every stated requirement. They are all still listed below with the
                        reason each one falls short.
                      </p>
                    </div>
                  ) : (
                    <div className="listing-grid" data-count={groups.fitting.length}>
                      {groups.fitting.map((l) => (
                        <ListingCard
                          key={l.reference}
                          listing={l}
                          assessment={session.assessments?.[l.reference]}
                          session={session}
                          status={status}
                          application={(session.applications ?? []).find((a) => a.listingReference === l.reference)}
                          onWhy={() => setWhyRef(l.reference)}
                          onChanged={() => void refresh()}
                        />
                      ))}
                    </div>
                  )}

                  {groups.others.length > 0 && (
                    <>
                      <div className="section-head">
                        <h2>Other homes we looked at</h2>
                        <p>Kept visible, with the reason each one is not on the shortlist</p>
                      </div>
                      <div className="listing-grid" style={{ marginBottom: 18 }}>
                        {groups.others.map((l) => (
                          <ListingCard
                            key={l.reference}
                            listing={l}
                            assessment={session.assessments?.[l.reference]}
                            session={session}
                            status={status}
                            application={(session.applications ?? []).find((a) => a.listingReference === l.reference)}
                            onWhy={() => setWhyRef(l.reference)}
                            onChanged={() => void refresh()}
                          />
                        ))}
                      </div>
                    </>
                  )}

                  <ComparePanel
                    listings={session.listings ?? []}
                    assessments={session.assessments ?? {}}
                    tenant={session.tenant}
                    onWhy={setWhyRef}
                  />
                </>
              )}
            </>
          )}

          <p className="disclaimer">
            Illustrative demonstration data. The listings, the tenant and the policy rules are fictional and exist
            only for this prototype; they are not real HousingAnywhere listings, not real HousingAnywhere policy and
            not Dutch law. “Continue with this home” writes a local demonstration record — it books nothing, takes no
            payment and sends no message.
          </p>
        </div>

        <aside className="assistant-col">
          <ChatPanel />
        </aside>
      </div>

      {whyListing && whyAssessment && session && (
        <WhyPanel
          assessment={whyAssessment}
          listing={whyListing}
          tenant={session.tenant}
          status={status}
          onClose={() => setWhyRef(null)}
        />
      )}
    </>
  );
}
