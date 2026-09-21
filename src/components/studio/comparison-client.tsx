'use client';

import { useCallback, useEffect, useState } from 'react';
import type {
  Assessment,
  PolicySnapshot,
  ScenarioSnapshot,
  SnapshotEvaluation,
  SnapshotId,
} from '@/lib/contracts';
import { STATUS_REFRESH_EVENT } from '@/components/presenter-bar';
import { usePresentationMode } from './presentation-mode';
import {
  api,
  DiffView,
  errText,
  ErrorNote,
  Loading,
  money,
  months,
  shortHash,
  StatusPill,
  when,
  type DiffLine,
} from './shared';
import './studio.css';

type Comparison = { scenario: ScenarioSnapshot; steps: SnapshotEvaluation[] };
type SnapshotIndex = { snapshots: PolicySnapshot[]; activeId: SnapshotId; previousId: SnapshotId | null };

export function Comparison() {
  const [data, setData] = useState<Comparison | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [index, setIndex] = useState<SnapshotIndex | null>(null);
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const presenting = usePresentationMode();

  const load = useCallback(async (refreeze: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<Comparison>('/api/comparison', {
        method: 'POST',
        body: JSON.stringify({ refreeze }),
      });
      setData(res);
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadIndex = useCallback(async () => {
    try {
      setIndex(await api<SnapshotIndex>('/api/policy/snapshots'));
    } catch {
      /* labels and the active marker are decoration here; the comparison stands alone */
    }
  }, []);

  useEffect(() => {
    void load(false);
    void loadIndex();
  }, [load, loadIndex]);

  const steps = data?.steps ?? [];
  const step = steps[selected] ?? null;
  const previous = selected > 0 ? steps[selected - 1] : null;
  const baseline = steps[0] ?? null;
  // Stored labels already begin with the snapshot id, e.g. "S2 — deposit cap".
  const labelOf = (id: SnapshotId) =>
    (index?.snapshots.find((s) => s.id === id)?.label ?? id).replace(new RegExp(`^${id}\\s*[—-]\\s*`), '');
  const isActive = (id: SnapshotId) => index?.activeId === id;

  async function activate(snapshotId: SnapshotId) {
    setBusy('activate');
    setNotice(null);
    try {
      await api('/api/policy/activate', { method: 'POST', body: JSON.stringify({ snapshotId }) });
      await loadIndex();
      window.dispatchEvent(new Event(STATUS_REFRESH_EVENT));
      setNotice(`${snapshotId} is now the active snapshot — the tenant experience will use it from the next evaluation.`);
    } catch (e) {
      setNotice(errText(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="page-head">
        <h1>Change comparison</h1>
        <p>
          The same frozen tenant and listings, evaluated separately against every cumulative policy snapshot. Each
          step is a real engine run against that snapshot’s published source — no step is derived from the step
          before it.
        </p>
      </div>

      {error ? (
        <div style={{ marginBottom: 18 }}>
          <ErrorNote error={error} onRetry={() => void load(false)} />
        </div>
      ) : null}

      {notice ? (
        <div className="banner banner-ok" style={{ marginBottom: 18 }}>
          <span style={{ flex: 1 }}>{notice}</span>
          <button className="btn btn-sm btn-ghost" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="stack">
        <FrozenInputs
          scenario={data?.scenario ?? null}
          loading={loading && !data}
          busy={loading}
          onRefreeze={() => void load(true)}
        />

        <section className="card">
          <div className="card-head">
            <h2>Cumulative policy steps</h2>
            <div style={{ flex: 1 }} />
            <span className="muted" style={{ fontSize: 12 }}>
              Selecting a step only inspects it
            </span>
          </div>
          <div className="card-pad stack">
            {loading && !data ? (
              <Loading label="Evaluating every snapshot against the frozen inputs…" />
            ) : steps.length === 0 ? (
              <div className="empty">
                No comparison steps were returned. Capture at least one snapshot, then recompute.
              </div>
            ) : (
              <>
                <div className="step-rail">
                  {steps.map((s, i) => (
                    <button
                      key={s.snapshotId}
                      className="step-btn"
                      data-selected={i === selected}
                      data-live={isActive(s.snapshotId)}
                      onClick={() => setSelected(i)}
                    >
                      <div className="step-id">
                        {s.snapshotId}
                        {isActive(s.snapshotId) ? (
                          <span className="pill pill-accent" style={{ marginLeft: 8 }}>
                            Active
                          </span>
                        ) : null}
                      </div>
                      <div className="step-label muted">{labelOf(s.snapshotId)}</div>
                    </button>
                  ))}
                </div>

                {step ? (
                  <div className={`banner ${isActive(step.snapshotId) ? 'banner-info' : 'banner-warn'}`}>
                    <span style={{ flex: 1 }}>
                      {isActive(step.snapshotId) ? (
                        <>
                          You are inspecting <b>{step.snapshotId}</b>, which also happens to be the snapshot the
                          harness is running.
                        </>
                      ) : (
                        <>
                          <b>Inspecting only.</b> Looking at {step.snapshotId} has changed nothing — the harness
                          still runs <b>{index?.activeId ?? 'its active snapshot'}</b>. Activation is a separate,
                          explicit action.
                        </>
                      )}
                    </span>
                    <button
                      className="btn btn-sm btn-primary"
                      disabled={busy != null || isActive(step.snapshotId)}
                      onClick={() => void activate(step.snapshotId)}
                    >
                      {busy === 'activate' ? <span className="spin" /> : null}
                      {isActive(step.snapshotId) ? 'Already active' : `Activate this snapshot (${step.snapshotId})`}
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </section>

        {step ? (
          <div className="grid-2" style={{ alignItems: 'start' }}>
            <StepResults
              step={step}
              previous={previous}
              baseline={baseline}
              scenario={data!.scenario}
              presenting={presenting}
            />
            <StepDiff from={previous?.snapshotId ?? null} to={step.snapshotId} />
          </div>
        ) : null}

        {steps.length > 0 ? (
          <Matrix steps={steps} scenario={data!.scenario} selected={selected} onSelect={setSelected} />
        ) : null}
      </div>

      <p className="disclaimer">
        Fictional demonstration policy and listings. Every figure on this page came from a local Lemma engine run
        against published policy source; nothing is recomputed in the browser.
      </p>
    </>
  );
}

/* -------------------------------------------------------------- inputs */

function FrozenInputs({
  scenario,
  loading,
  busy,
  onRefreeze,
}: {
  scenario: ScenarioSnapshot | null;
  loading: boolean;
  busy: boolean;
  onRefreeze: () => void;
}) {
  return (
    <section className="card">
      <div className="card-head">
        <h2>Frozen input snapshot</h2>
        <div style={{ flex: 1 }} />
        <button className="btn btn-sm" disabled={busy} onClick={onRefreeze}>
          {busy ? <span className="spin" /> : null} Recompute with current inputs
        </button>
      </div>
      <div className="card-pad stack-sm">
        <p className="muted" style={{ fontSize: 12.5 }}>
          Every step below was evaluated against this one input set, so the only thing that differs between steps
          is the policy. <b>Recomputing refreezes the inputs</b> at today’s tenant profile and listing data, and
          every step is then re-evaluated against the new set.
        </p>

        {loading ? (
          <Loading label="Reading the frozen scenario…" />
        ) : !scenario ? (
          <div className="empty">No frozen scenario yet.</div>
        ) : (
          <>
            <div className="row wrap">
              <span className="pill pill-neutral">Frozen at {when(scenario.frozenAt)}</span>
              <span className="pill pill-neutral mono">inputs {shortHash(scenario.inputsHash)}</span>
              <span className="pill pill-neutral">
                {scenario.tenant.name} · {scenario.tenant.city} · {months(scenario.tenant.intendedStayMonths)} ·
                max {money(scenario.tenant.maxMonthlyRent)}/month · max {money(scenario.tenant.maxInitialPayment)}{' '}
                up front
              </span>
            </div>

            <table className="table">
              <thead>
                <tr>
                  <th>Listing</th>
                  <th className="num">Monthly rent</th>
                  <th className="num">Deposit asked</th>
                  <th className="num">Minimum stay</th>
                  <th className="num">Commute</th>
                </tr>
              </thead>
              <tbody>
                {scenario.listings.map((l) => (
                  <tr key={l.reference}>
                    <td>
                      <b>{l.reference}</b> — {l.name}
                      <div className="muted" style={{ fontSize: 12 }}>
                        {l.neighbourhood}
                      </div>
                    </td>
                    <td className="num">{money(l.monthlyRent)}</td>
                    <td className="num">
                      {l.requestedDepositMonths == null ? (
                        <span className="pill pill-info">Not stated</span>
                      ) : (
                        months(l.requestedDepositMonths)
                      )}
                    </td>
                    <td className="num">{months(l.minimumStayMonths)}</td>
                    <td className="num">{l.travelMinutesToUniversity} min</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- deltas */

function delta(from: number | null | undefined, to: number | null | undefined) {
  if (from == null || to == null) return null;
  return to - from;
}

function Delta({ value, label }: { value: number | null; label: string }) {
  if (value == null) return <span className="delta delta-none">—</span>;
  if (value === 0) {
    return (
      <span className="delta delta-none" title={`No change ${label}`}>
        no change
      </span>
    );
  }
  return (
    <span className={`delta ${value > 0 ? 'delta-up' : 'delta-down'}`} title={`Change ${label}`}>
      {value > 0 ? '+' : '−'}
      {money(Math.abs(value))}
    </span>
  );
}

/* --------------------------------------------------------- step results */

function StepResults({
  step,
  previous,
  baseline,
  scenario,
  presenting,
}: {
  step: SnapshotEvaluation;
  previous: SnapshotEvaluation | null;
  baseline: SnapshotEvaluation | null;
  scenario: ScenarioSnapshot;
  presenting: boolean;
}) {
  const find = (e: SnapshotEvaluation | null, ref: string): Assessment | undefined =>
    e?.assessments.find((a) => a.listingReference === ref);
  const nameOf = (ref: string) => scenario.listings.find((l) => l.reference === ref)?.name ?? ref;

  return (
    <section className="card">
      <div className="card-head">
        <h2>Results at {step.snapshotId}</h2>
        <div style={{ flex: 1 }} />
        <span className="hash">source {shortHash(step.sourceHash)}</span>
      </div>
      <div className="card-pad">
        {step.assessments.length === 0 ? (
          <div className="empty">This step produced no assessments.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Listing</th>
                <th className="num">Initial payment</th>
                <th className="num">vs previous step</th>
                <th className="num">vs baseline</th>
                <th>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {step.assessments.map((a) => {
                const prev = find(previous, a.listingReference);
                const base = find(baseline, a.listingReference);
                const dPrev = delta(prev?.costs.initialPayment, a.costs.initialPayment);
                const dBase = delta(base?.costs.initialPayment, a.costs.initialPayment);
                const costChanged = dPrev != null && dPrev !== 0;
                const statusChanged = prev != null && prev.status !== a.status;
                const flash = presenting ? ' changed' : '';
                return (
                  <tr key={a.listingReference}>
                    <td>
                      <b>{a.listingReference}</b> — {nameOf(a.listingReference)}
                      <div className="muted" style={{ fontSize: 12 }}>
                        {money(a.costs.monthlyRent)}/month · deposit {money(a.costs.effectiveDeposit)} · fee{' '}
                        {money(a.costs.bookingFee)}
                      </div>
                    </td>
                    <td className="num">
                      <span
                        key={`${step.snapshotId}-cost`}
                        className={`key-figure${costChanged ? flash : ''}`}
                      >
                        {money(a.costs.initialPayment)}
                      </span>
                    </td>
                    <td className="num">
                      <Delta value={dPrev} label="since the previous step" />
                    </td>
                    <td className="num">
                      <Delta value={dBase} label="since the baseline" />
                    </td>
                    <td>
                      <span key={`${step.snapshotId}-status`} className={statusChanged ? flash.trim() : undefined}>
                        <StatusPill status={a.status} />
                      </span>
                      {statusChanged && prev ? (
                        <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
                          was “{prev.status.replace(/-/g, ' ')}” at {previous?.snapshotId}
                        </div>
                      ) : null}
                      {a.missingInputs.length > 0 ? (
                        <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
                          Missing: {a.missingInputs.join(', ')}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ step diff */

function StepDiff({ from, to }: { from: SnapshotId | null; to: SnapshotId }) {
  const [lines, setLines] = useState<DiffLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!from) {
      setLines(null);
      setError(null);
      return;
    }
    let live = true;
    setLoading(true);
    setError(null);
    api<{ lines: DiffLine[] }>(`/api/policy/diff?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      .then((r) => live && setLines(r.lines))
      .catch((e) => live && setError(errText(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [from, to]);

  return (
    <section className="card">
      <div className="card-head">
        <h2>Source change {from ? `${from} → ${to}` : `at ${to}`}</h2>
      </div>
      <div className="card-pad">
        {!from ? (
          <div className="empty">
            {to} is the baseline. There is no earlier step to compare its source against.
          </div>
        ) : error ? (
          <ErrorNote error={error} />
        ) : loading ? (
          <Loading label="Loading source diff…" />
        ) : lines ? (
          <DiffView lines={lines} />
        ) : null}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- matrix */

function Matrix({
  steps,
  scenario,
  selected,
  onSelect,
}: {
  steps: SnapshotEvaluation[];
  scenario: ScenarioSnapshot;
  selected: number;
  onSelect: (i: number) => void;
}) {
  const refs = scenario.listings.map((l) => l.reference);

  return (
    <section className="card">
      <div className="card-head">
        <h2>Every listing at every step</h2>
        <div style={{ flex: 1 }} />
        <span className="muted" style={{ fontSize: 12 }}>
          Initial payment and outcome · each cell is its own engine run
        </span>
      </div>
      <div className="card-pad" style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Snapshot</th>
              {refs.map((r) => (
                <th key={r} className="num">
                  {r} — {scenario.listings.find((l) => l.reference === r)?.name}
                </th>
              ))}
              <th>Fits</th>
            </tr>
          </thead>
          <tbody>
            {steps.map((s, i) => {
              const prev = i > 0 ? steps[i - 1] : null;
              const fits = s.assessments.filter((a) => a.status === 'fits').map((a) => a.listingReference);
              return (
                <tr
                  key={s.snapshotId}
                  onClick={() => onSelect(i)}
                  style={{
                    cursor: 'pointer',
                    background: i === selected ? 'var(--surface-sunken)' : undefined,
                  }}
                >
                  <td>
                    <b>{s.snapshotId}</b>
                    <div className="muted" style={{ fontSize: 11.5 }}>
                      {shortHash(s.sourceHash)}
                    </div>
                  </td>
                  {refs.map((r) => {
                    const a = s.assessments.find((x) => x.listingReference === r);
                    const before = prev?.assessments.find((x) => x.listingReference === r);
                    const changed =
                      before != null &&
                      a != null &&
                      (before.costs.initialPayment !== a.costs.initialPayment || before.status !== a.status);
                    return (
                      <td key={r} className="num">
                        <span className={changed ? 'key-figure changed' : 'key-figure'}>
                          {money(a?.costs.initialPayment ?? null)}
                        </span>
                        <div style={{ marginTop: 4 }}>
                          {a ? <StatusPill status={a.status} /> : <span className="muted">—</span>}
                        </div>
                      </td>
                    );
                  })}
                  <td>{fits.length > 0 ? fits.join(', ') : <span className="muted">none</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
