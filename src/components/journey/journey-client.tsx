'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { JourneyFacts, MomentId, MomentOutcome } from '@/lib/contracts';
import type { MomentDefinition, RunnableMomentId } from '@/lib/journey/moments';
import { FactsEditor } from '@/components/journey/facts-editor';
import { MomentPanel } from '@/components/journey/moment-panel';
import { STATUS_REFRESH_EVENT } from '@/components/presenter-bar';
import { api, errText } from '@/components/studio/shared';
import '@/components/tenant/tenant.css';
import './journey.css';

/**
 * What GET /api/journey hands back. The rail is built from the moments in this
 * response rather than from MOMENTS directly: that module also carries the
 * evaluator, and with it node:crypto and the Lemma engine, neither of which has
 * any business in the browser bundle.
 */
interface JourneyResponse {
  moments: MomentDefinition[];
  facts: JourneyFacts;
  outcomes: Partial<Record<MomentId, MomentOutcome>>;
  stale: Partial<Record<MomentId, boolean>>;
}

function Skeleton() {
  return (
    <div className="col" style={{ gap: 18 }}>
      <div className="skel" style={{ height: 88 }} />
      <div className="skel" style={{ height: 340 }} />
    </div>
  );
}

export function JourneyClient() {
  const [data, setData] = useState<JourneyResponse | null>(null);
  const [selected, setSelected] = useState<MomentId>('shortlist');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rerunning, setRerunning] = useState(false);
  const [rerunError, setRerunError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api<JourneyResponse>('/api/journey'));
      setError(null);
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Anything that moves the facts or the outcomes also moves the presenter bar. */
  const changed = useCallback(async () => {
    await load();
    window.dispatchEvent(new Event(STATUS_REFRESH_EVENT));
  }, [load]);

  async function rerun(moment: RunnableMomentId) {
    setRerunning(true);
    setRerunError(null);
    try {
      await api('/api/journey', { method: 'POST', body: JSON.stringify({ moment }) });
      await changed();
    } catch (e) {
      setRerunError(errText(e));
    } finally {
      setRerunning(false);
    }
  }

  const definition = data?.moments.find((m) => m.id === selected);
  const outcome = data?.outcomes?.[selected];
  /* The route weighs the snapshot as well as the facts; the revision check is
     only a floor, so an absent flag still cannot read as fresh. */
  const stale = data
    ? (data.stale?.[selected] ?? (outcome ? outcome.factsRevision !== data.facts.revision : false))
    : false;

  return (
    <>
      <div className="page-head">
        <h1>One tenant, four decisions, one engine</h1>
        <p>
          Alex is the same tenant throughout: choosing a home, signing the contract, being offered a renewal and
          moving out. Every figure below is computed by the published policy at the moment it is asked, and each
          moment names the service mission it belongs to. Nothing on this page decides anything itself.
        </p>
      </div>

      {loading && !data && <Skeleton />}

      {error && !data && (
        <div className="card card-pad col">
          <h3>The harness is not answering</h3>
          <p className="muted" style={{ fontSize: 13.5 }}>
            <span className="mono">GET /api/journey</span> failed: {error}. Nothing is shown rather than guessed.
          </p>
          <div>
            <button className="btn btn-sm" onClick={() => void load()}>
              Try again
            </button>
          </div>
        </div>
      )}

      {data && (
        <>
          {error && (
            <div className="notice notice-warn" style={{ marginBottom: 14 }}>
              Showing the last answer the harness gave — the most recent refresh failed: {error}
            </div>
          )}

          <div className="journey-rail">
            {data.moments.map((m) => (
              <button
                key={m.id}
                type="button"
                className="step-btn"
                data-selected={m.id === selected}
                aria-current={m.id === selected ? 'step' : undefined}
                onClick={() => setSelected(m.id)}
              >
                <span className="journey-step-head">
                  <span className="journey-step-num">{m.mission}</span>
                  <span className="journey-step-phase muted">{m.phase}</span>
                </span>
                <span className="journey-step-title">{m.missionTitle}</span>
              </button>
            ))}
          </div>

          {!definition ? (
            <div className="card card-pad" style={{ marginTop: 18 }}>
              <h3>That moment is not in the spine</h3>
              <p className="muted" style={{ fontSize: 13.5, marginTop: 6 }}>
                The harness returned no definition for <span className="mono">{selected}</span>, so there is nothing
                to run.
              </p>
            </div>
          ) : selected === 'shortlist' ? (
            <div className="card card-pad col" style={{ marginTop: 18 }}>
              <h3>{definition.question}</h3>
              <p className="muted" style={{ fontSize: 13.5 }}>
                The first moment weighs three listings against one another rather than one set of facts, so it keeps
                its own view. The engine, the published policy and the provenance are the same ones the three moments
                beside it use.
              </p>
              <div>
                <Link className="link-out" href="/">
                  Open the tenant experience
                </Link>
              </div>
            </div>
          ) : (
            <div className="journey-grid" style={{ marginTop: 18 }}>
              <div className="stack">
                <div className="section-head" style={{ marginTop: 0 }}>
                  <p>
                    Mission {definition.mission} · answered by <span className="mono">{definition.spec}</span> in the
                    published bundle
                  </p>
                  <div className="spacer" />
                  <button className="btn btn-sm" onClick={() => void rerun(selected)} disabled={rerunning}>
                    {rerunning ? <span className="spin" /> : null}
                    {rerunning ? 'Re-running…' : 'Re-run this moment'}
                  </button>
                </div>

                {rerunError && <div className="notice notice-error">Re-running this moment failed: {rerunError}</div>}

                <MomentPanel definition={definition} outcome={outcome} stale={stale} />
              </div>

              <aside className="journey-facts">
                <FactsEditor moment={selected} facts={data.facts} onChanged={() => void changed()} />
              </aside>
            </div>
          )}
        </>
      )}

      <p className="disclaimer">
        Illustrative demonstration data. The tenant, the facts and the policy rules are fictional and exist only for
        this prototype; they are not real HousingAnywhere policy and not Dutch law. Nothing here signs a contract,
        makes a renewal offer or settles a deposit.
      </p>
    </>
  );
}
