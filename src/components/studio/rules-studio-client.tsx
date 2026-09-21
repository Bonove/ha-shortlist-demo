'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  PolicyDraft,
  PolicySnapshot,
  SnapshotEvaluation,
  SnapshotId,
  ValidationResult,
} from '@/lib/contracts';
import { REPOSITORY, REPOSITORY_URL, SPEC_PATH } from '@/lib/contracts';
import { STATUS_REFRESH_EVENT } from '@/components/presenter-bar';
import {
  api,
  DiffView,
  Diagnostics,
  download,
  errText,
  ErrorNote,
  Loading,
  money,
  months,
  PROVENANCE_TEXT,
  ProvenancePill,
  shortHash,
  StatusPill,
  when,
  type DiffLine,
} from './shared';
import './studio.css';

type SnapshotIndex = { snapshots: PolicySnapshot[]; activeId: SnapshotId; previousId: SnapshotId | null };
type Tab = 'source' | 'draft' | 'diff' | 'preview';

const TABS: { id: Tab; label: string }[] = [
  { id: 'source', label: 'Published source' },
  { id: 'draft', label: 'Local draft' },
  { id: 'diff', label: 'Source diff' },
  { id: 'preview', label: 'Preview impact' },
];

export function RulesStudio() {
  const [index, setIndex] = useState<SnapshotIndex | null>(null);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [viewId, setViewId] = useState<SnapshotId | null>(null);
  const [viewed, setViewed] = useState<PolicySnapshot | null>(null);
  const [viewError, setViewError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<PolicyDraft[]>([]);
  const [tab, setTab] = useState<Tab>('source');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  /* ------------------------------------------------------------- loading */

  const loadIndex = useCallback(async () => {
    try {
      const next = await api<SnapshotIndex>('/api/policy/snapshots');
      setIndex(next);
      setIndexError(null);
      setViewId((current) => current ?? next.activeId);
    } catch (e) {
      setIndexError(errText(e));
    }
  }, []);

  const loadDrafts = useCallback(async () => {
    try {
      setDrafts(await api<PolicyDraft[]>('/api/policy/drafts'));
    } catch {
      /* drafts are optional furniture; the page stays usable without them */
    }
  }, []);

  useEffect(() => {
    void loadIndex();
    void loadDrafts();
  }, [loadIndex, loadDrafts]);

  useEffect(() => {
    if (!viewId) return;
    let live = true;
    setViewed(null);
    setViewError(null);
    api<PolicySnapshot>(`/api/policy/snapshots/${viewId}`)
      .then((s) => live && setViewed(s))
      .catch((e) => live && setViewError(errText(e)));
    return () => {
      live = false;
    };
  }, [viewId]);

  /* -------------------------------------------------------------- draft */

  const [draftCode, setDraftCode] = useState<string | null>(null);
  const [draftBase, setDraftBase] = useState<SnapshotId | null>(null);
  const baseCode = viewed?.files.find((f) => f.path === SPEC_PATH)?.code ?? viewed?.files[0]?.code ?? '';

  // The draft starts as a copy of whichever snapshot is on screen, and only
  // becomes a separate thing once it has been edited.
  const editorCode = draftCode ?? baseCode;
  const dirty = draftCode != null;
  const draftFiles = useMemo(() => [{ path: SPEC_PATH, code: editorCode }], [editorCode]);

  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [preview, setPreview] = useState<{ validation: ValidationResult; evaluation?: SnapshotEvaluation } | null>(null);

  const active = index?.snapshots.find((s) => s.id === index.activeId) ?? null;
  const isViewingActive = index != null && viewId === index.activeId;

  /* ------------------------------------------------------------ actions */

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setNotice({ tone: 'bad', text: errText(e) });
    } finally {
      setBusy(null);
    }
  }

  const activate = (snapshotId: SnapshotId) =>
    run(`activate:${snapshotId}`, async () => {
      await api('/api/policy/activate', { method: 'POST', body: JSON.stringify({ snapshotId }) });
      await loadIndex();
      window.dispatchEvent(new Event(STATUS_REFRESH_EVENT));
      setNotice({ tone: 'ok', text: `${snapshotId} is now the active snapshot. Every new evaluation runs against it.` });
    });

  const restore = (target: 'previous' | 'S0') =>
    run(`restore:${target}`, async () => {
      const res = await api<{ activeId: SnapshotId }>('/api/policy/restore', {
        method: 'POST',
        body: JSON.stringify({ target }),
      });
      await loadIndex();
      setViewId(res.activeId);
      window.dispatchEvent(new Event(STATUS_REFRESH_EVENT));
      setNotice({ tone: 'ok', text: `Restored — ${res.activeId} is active again.` });
    });

  const validate = () =>
    run('validate', async () => {
      setTab('draft');
      const res = await api<ValidationResult>('/api/policy/validate', {
        method: 'POST',
        body: JSON.stringify({ files: draftFiles }),
      });
      setValidation(res);
    });

  const runPreview = () =>
    run('preview', async () => {
      setTab('preview');
      const res = await api<{ validation: ValidationResult; evaluation?: SnapshotEvaluation }>('/api/policy/preview', {
        method: 'POST',
        body: JSON.stringify({ files: draftFiles }),
      });
      setPreview(res);
      setValidation(res.validation);
    });

  const exportSnapshot = (snapshotId: SnapshotId) =>
    run(`export:${snapshotId}`, async () => {
      const bundle = await api<unknown>(`/api/policy/export?snapshotId=${encodeURIComponent(snapshotId)}`);
      download(`${snapshotId}-policy-bundle.json`, JSON.stringify(bundle, null, 2));
      setNotice({ tone: 'ok', text: `Downloaded the ${snapshotId} source bundle.` });
    });

  return (
    <>
      <div className="page-head">
        <h1>Rules Studio</h1>
        <p>
          Inspect the executable policy the harness runs, edit a local draft, validate it against the real Lemma
          engine, preview its effect on every listing, and activate a published snapshot. Everything here is
          fictional demonstration policy.
        </p>
      </div>

      {indexError ? (
        <div style={{ marginBottom: 18 }}>
          <ErrorNote
            error={`Policy snapshots could not be read. ${indexError}`}
            onRetry={() => void loadIndex()}
          />
        </div>
      ) : null}

      {notice ? (
        <div className={`banner ${notice.tone === 'ok' ? 'banner-ok' : 'banner-bad'}`} style={{ marginBottom: 18 }}>
          <span style={{ flex: 1 }}>{notice.text}</span>
          <button className="btn btn-sm btn-ghost" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="studio-grid">
        <div className="stack">
          <IdentityCard active={active} loading={index == null && !indexError} />

          <section className="card">
            <div className="card-head">
              <h2>Policy source</h2>
              <div className="spacer" style={{ flex: 1 }} />
              <div className="tabs">
                {TABS.map((t) => (
                  <button key={t.id} className="tab" data-active={tab === t.id} onClick={() => setTab(t.id)}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="card-pad stack">
              {tab === 'source' ? (
                <SourceTab
                  index={index}
                  viewId={viewId}
                  viewed={viewed}
                  viewError={viewError}
                  isViewingActive={isViewingActive}
                  onView={setViewId}
                  onActivate={activate}
                  busy={busy}
                />
              ) : null}

              {tab === 'draft' ? (
                <DraftTab
                  baseId={draftBase ?? viewId}
                  code={editorCode}
                  dirty={dirty}
                  busy={busy}
                  validation={validation}
                  drafts={drafts}
                  onChange={(code) => {
                    setDraftCode(code);
                    setDraftBase(viewId);
                    setValidation(null);
                  }}
                  onReset={() => {
                    setDraftCode(null);
                    setDraftBase(null);
                    setValidation(null);
                  }}
                  onValidate={validate}
                  onPreview={runPreview}
                  onSaved={async (name) => {
                    await run('save-draft', async () => {
                      const saved = await api<PolicyDraft>('/api/policy/drafts', {
                        method: 'POST',
                        body: JSON.stringify({ name, basedOn: draftBase ?? viewId, files: draftFiles }),
                      });
                      await loadDrafts();
                      setNotice({
                        tone: 'ok',
                        text: `Saved the local draft “${saved.name}”. It is not a published LemmaBase version.`,
                      });
                    });
                  }}
                  onDownloadSource={() =>
                    download(`${viewId ?? 'draft'}-draft.lemma`, editorCode, 'text/plain')
                  }
                />
              ) : null}

              {tab === 'diff' ? <DiffTab index={index} drafts={drafts} /> : null}

              {tab === 'preview' ? (
                <PreviewTab preview={preview} busy={busy === 'preview'} onPreview={runPreview} />
              ) : null}
            </div>
          </section>
        </div>

        <div className="stack">
          <HistoryCard
            index={index}
            viewId={viewId}
            busy={busy}
            onView={setViewId}
            onActivate={activate}
            onRestore={restore}
          />

          <TransferCard
            index={index}
            busy={busy}
            onExport={exportSnapshot}
            onImported={async () => {
              await loadIndex();
              window.dispatchEvent(new Event(STATUS_REFRESH_EVENT));
            }}
          />

          <HandoffCard />
        </div>
      </div>

      <p className="disclaimer">
        Fictional demonstration policy. It does not describe HousingAnywhere policy or Dutch law. All money maths
        and compatibility checks shown here were produced by the local Lemma engine.
      </p>
    </>
  );
}

/* ------------------------------------------------------------- identities */

function IdentityCard({ active, loading }: { active: PolicySnapshot | null; loading: boolean }) {
  return (
    <section className="card">
      <div className="card-head">
        <h2>Active policy snapshot</h2>
        <div style={{ flex: 1 }} />
        <a className="link-out" href={active?.publication?.repositoryUrl ?? REPOSITORY_URL} target="_blank" rel="noreferrer">
          Open in LemmaBase ↗
        </a>
      </div>
      <div className="card-pad stack">
        <div className="row wrap" style={{ gap: 8 }}>
          <span className="pill pill-neutral mono">{active?.publication?.repository ?? REPOSITORY}</span>
          {active ? <ProvenancePill provenance={active.provenance} /> : null}
        </div>

        {loading ? (
          <Loading label="Reading the active snapshot…" />
        ) : !active ? (
          <div className="empty">
            No snapshot is active yet. Activate one from the snapshot history to give the harness something to run.
          </div>
        ) : (
          <>
            <div className="identity-grid">
              <div className="identity">
                <span className="eyebrow">Application snapshot</span>
                <div className="val">{active.id}</div>
                <div className="note">{active.label}</div>
              </div>
              <div className="identity">
                <span className="eyebrow">LemmaBase revision</span>
                <div className="val mono">{active.publication?.revision ?? 'Not exposed'}</div>
                <div className="note">
                  {active.publication?.revision
                    ? 'The publication identifier recorded when this source was retrieved.'
                    : 'The service exposed no revision id for this bundle.'}
                </div>
              </div>
              <div className="identity">
                <span className="eyebrow">Lemma effective date</span>
                <div className="val">{active.publication?.specEffectiveFrom ?? '—'}</div>
                <div className="note">The temporal spec version declared inside the source header.</div>
              </div>
            </div>

            <dl className="kv">
              <dt>Source hash</dt>
              <dd className="mono">{active.sourceHash}</dd>
              <dt>Provenance</dt>
              <dd>{PROVENANCE_TEXT[active.provenance]}</dd>
              <dt>Publication message</dt>
              <dd>{active.publication?.message ?? '—'}</dd>
              <dt>Retrieved at</dt>
              <dd>{when(active.publication?.retrievedAt)}</dd>
              <dt>Captured locally</dt>
              <dd>{when(active.capturedAt)}</dd>
              <dt>Cumulative state</dt>
              <dd style={{ fontWeight: 400 }}>{active.description}</dd>
            </dl>

            <div className="banner banner-info">
              <span>
                These three identities are <b>not</b> interchangeable. The application snapshot id is ours, the
                revision belongs to LemmaBase, and the effective date is the Lemma temporal version inside the
                source.
              </span>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ source tab */

function SourceTab({
  index,
  viewId,
  viewed,
  viewError,
  isViewingActive,
  onView,
  onActivate,
  busy,
}: {
  index: SnapshotIndex | null;
  viewId: SnapshotId | null;
  viewed: PolicySnapshot | null;
  viewError: string | null;
  isViewingActive: boolean;
  onView: (id: SnapshotId) => void;
  onActivate: (id: SnapshotId) => void;
  busy: string | null;
}) {
  return (
    <>
      <div className="row wrap">
        <span className="eyebrow">Viewing</span>
        <select className="select" style={{ width: 260 }} value={viewId ?? ''} onChange={(e) => onView(e.target.value)}>
          {(index?.snapshots ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <div style={{ flex: 1 }} />
        {viewed ? <span className="hash">{viewed.sourceHash}</span> : null}
      </div>

      {!isViewingActive && viewId ? (
        <div className="banner banner-warn">
          <span style={{ flex: 1 }}>
            You are <b>inspecting</b> {viewId}. Nothing has changed — the harness still runs{' '}
            <b>{index?.activeId}</b>.
          </span>
          <button
            className="btn btn-sm btn-primary"
            disabled={busy != null}
            onClick={() => onActivate(viewId)}
          >
            Activate {viewId}
          </button>
        </div>
      ) : null}

      {viewError ? (
        <ErrorNote error={viewError} />
      ) : !viewed ? (
        <Loading label="Loading source…" />
      ) : (
        viewed.files.map((f) => (
          <div key={f.path} className="stack-sm">
            <span className="eyebrow">{f.path}</span>
            <pre className="code source-box">{f.code}</pre>
          </div>
        ))
      )}
    </>
  );
}

/* ------------------------------------------------------------- draft tab */

function DraftTab({
  baseId,
  code,
  dirty,
  busy,
  validation,
  drafts,
  onChange,
  onReset,
  onValidate,
  onPreview,
  onSaved,
  onDownloadSource,
}: {
  baseId: SnapshotId | null;
  code: string;
  dirty: boolean;
  busy: string | null;
  validation: ValidationResult | null;
  drafts: PolicyDraft[];
  onChange: (code: string) => void;
  onReset: () => void;
  onValidate: () => void;
  onPreview: () => void;
  onSaved: (name: string) => Promise<void>;
  onDownloadSource: () => void;
}) {
  const [name, setName] = useState('');

  return (
    <>
      <div className="banner banner-warn">
        <span>
          <b>This is a local edit, not a published LemmaBase version.</b> It is branched from{' '}
          <b>{baseId ?? '—'}</b> and has no publication, no revision and no verified provenance. The harness will
          not run it: only an activated snapshot is executed.
        </span>
      </div>

      <textarea
        className="editor"
        data-dirty={dirty}
        spellCheck={false}
        value={code}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Local policy draft source"
      />

      <div className="row wrap">
        <button className="btn" disabled={busy != null} onClick={onValidate}>
          {busy === 'validate' ? <span className="spin" /> : null} Validate draft
        </button>
        <button className="btn btn-primary" disabled={busy != null} onClick={onPreview}>
          {busy === 'preview' ? <span className="spin" /> : null} Preview impact
        </button>
        <button className="btn btn-ghost" disabled={!dirty} onClick={onReset}>
          Reset to {baseId ?? 'snapshot'}
        </button>
        <div style={{ flex: 1 }} />
        <button className="btn btn-sm" onClick={onDownloadSource}>
          Download draft source
        </button>
      </div>

      {validation ? (
        validation.valid ? (
          <div className="banner banner-ok">
            <span>
              <b>The engine loaded this draft.</b> No diagnostics were reported. It is still a local draft.
            </span>
          </div>
        ) : (
          <div className="stack-sm">
            <div className="banner banner-bad">
              <span>
                <b>
                  {validation.diagnostics.length} diagnostic
                  {validation.diagnostics.length === 1 ? '' : 's'} from the Lemma engine.
                </b>{' '}
                Nothing was activated.
              </span>
            </div>
            <Diagnostics diagnostics={validation.diagnostics} />
          </div>
        )
      ) : null}

      <div className="row wrap" style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
        <div className="field" style={{ flex: 1, minWidth: 220 }}>
          <label htmlFor="draft-name">Save as a named local draft</label>
          <input
            id="draft-name"
            className="input"
            placeholder="e.g. Deposit cap experiment"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <button
          className="btn"
          style={{ alignSelf: 'flex-end' }}
          disabled={busy != null || name.trim().length === 0}
          onClick={async () => {
            await onSaved(name.trim());
            setName('');
          }}
        >
          {busy === 'save-draft' ? <span className="spin" /> : null} Save draft
        </button>
      </div>

      {drafts.length > 0 ? (
        <div className="stack-sm">
          <span className="eyebrow">Saved local drafts</span>
          {drafts.map((d) => (
            <div key={d.id} className="list-row">
              <span className="pill pill-neutral">Local</span>
              <span className="grow">
                <div className="title">{d.name}</div>
                <div className="sub">
                  Branched from {d.basedOn} · updated {when(d.updatedAt)}
                </div>
              </span>
              <button className="btn btn-sm" onClick={() => onChange(d.files[0]?.code ?? '')}>
                Load into editor
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------- diff tab */

function DiffTab({ index, drafts }: { index: SnapshotIndex | null; drafts: PolicyDraft[] }) {
  const ids = index?.snapshots.map((s) => s.id) ?? [];
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [lines, setLines] = useState<DiffLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const initialised = useRef(false);

  useEffect(() => {
    if (initialised.current || ids.length < 1) return;
    initialised.current = true;
    setFrom(ids[0]);
    setTo(ids[Math.min(1, ids.length - 1)]);
  }, [ids]);

  const load = useCallback(async () => {
    if (!from || !to) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ lines: DiffLine[] }>(
        `/api/policy/diff?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      );
      setLines(res.lines);
    } catch (e) {
      setError(errText(e));
      setLines(null);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const options = [
    ...ids.map((id) => ({ value: id, label: id })),
    ...drafts.map((d) => ({ value: `draft:${d.id}`, label: `Draft — ${d.name}` })),
  ];

  return (
    <>
      <div className="row wrap">
        <span className="eyebrow">From</span>
        <select className="select" style={{ width: 200 }} value={from} onChange={(e) => setFrom(e.target.value)}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <span className="eyebrow">To</span>
        <select className="select" style={{ width: 200 }} value={to} onChange={(e) => setTo(e.target.value)}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button className="btn btn-sm" onClick={() => void load()}>
          Refresh diff
        </button>
      </div>

      {error ? (
        <ErrorNote error={error} onRetry={() => void load()} />
      ) : loading ? (
        <Loading label="Comparing source…" />
      ) : lines ? (
        <DiffView lines={lines} />
      ) : (
        <div className="empty">Choose two snapshots to compare their published source.</div>
      )}
    </>
  );
}

/* ----------------------------------------------------------- preview tab */

function PreviewTab({
  preview,
  busy,
  onPreview,
}: {
  preview: { validation: ValidationResult; evaluation?: SnapshotEvaluation } | null;
  busy: boolean;
  onPreview: () => void;
}) {
  if (busy) return <Loading label="Running the draft against the frozen scenario…" />;

  if (!preview) {
    return (
      <>
        <div className="banner banner-info">
          <span>
            Preview runs your draft in an <b>isolated</b> engine against the current frozen scenario. It activates
            nothing and cannot disturb the snapshot the harness is running.
          </span>
        </div>
        <div className="empty">
          No preview yet.
          <div style={{ marginTop: 12 }}>
            <button className="btn btn-primary" onClick={onPreview}>
              Preview impact
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="banner banner-info">
        <span style={{ flex: 1 }}>
          Draft results only. <b>Nothing has been activated</b> — the harness still runs the active snapshot.
        </span>
        <button className="btn btn-sm" onClick={onPreview}>
          Re-run preview
        </button>
      </div>

      {!preview.validation.valid ? (
        <div className="stack-sm">
          <div className="banner banner-bad">
            <span>
              <b>The draft did not load.</b> No results could be produced.
            </span>
          </div>
          <Diagnostics diagnostics={preview.validation.diagnostics} />
        </div>
      ) : !preview.evaluation ? (
        <div className="empty">The draft is valid, but the harness returned no evaluation for it.</div>
      ) : (
        <>
          <div className="row wrap">
            <span className="hash">draft source {shortHash(preview.evaluation.sourceHash)}</span>
            <span className="hash">inputs {shortHash(preview.evaluation.inputsHash)}</span>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Listing</th>
                <th className="num">Monthly rent</th>
                <th className="num">Deposit</th>
                <th className="num">Booking fee</th>
                <th className="num">Initial payment</th>
                <th className="num">Minimum stay</th>
                <th>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {preview.evaluation.assessments.map((a) => (
                <tr key={a.listingReference}>
                  <td>
                    <b>{a.listingReference}</b>
                  </td>
                  <td className="num">{money(a.costs.monthlyRent)}</td>
                  <td className="num">{money(a.costs.effectiveDeposit)}</td>
                  <td className="num">{money(a.costs.bookingFee)}</td>
                  <td className="num key-figure">{money(a.costs.initialPayment)}</td>
                  <td className="num">{months(a.costs.effectiveMinimumStayMonths)}</td>
                  <td>
                    <StatusPill status={a.status} />
                    {a.missingInputs.length > 0 ? (
                      <div className="sub muted" style={{ fontSize: 11.5, marginTop: 4 }}>
                        Missing: {a.missingInputs.join(', ')}
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}

/* ---------------------------------------------------------- side column */

function HistoryCard({
  index,
  viewId,
  busy,
  onView,
  onActivate,
  onRestore,
}: {
  index: SnapshotIndex | null;
  viewId: SnapshotId | null;
  busy: string | null;
  onView: (id: SnapshotId) => void;
  onActivate: (id: SnapshotId) => void;
  onRestore: (target: 'previous' | 'S0') => void;
}) {
  return (
    <section className="card">
      <div className="card-head">
        <h2>Snapshot history</h2>
      </div>
      <div className="card-pad stack-sm">
        {!index ? (
          <Loading label="Loading snapshots…" />
        ) : index.snapshots.length === 0 ? (
          <div className="empty">No snapshots have been captured.</div>
        ) : (
          index.snapshots.map((s) => {
            const isActive = s.id === index.activeId;
            return (
              <div key={s.id} className="list-row" data-active={isActive}>
                <span className="grow">
                  <div className="title">
                    {s.label}
                    {isActive ? <span className="pill pill-accent" style={{ marginLeft: 8 }}>Active</span> : null}
                    {s.id === viewId && !isActive ? (
                      <span className="pill pill-neutral" style={{ marginLeft: 8 }}>
                        Inspecting
                      </span>
                    ) : null}
                  </div>
                  <div className="sub">
                    {s.provenance === 'live-repository-read' ? 'Published bundle' : PROVENANCE_TEXT[s.provenance]} ·{' '}
                    {shortHash(s.sourceHash)}
                  </div>
                </span>
                <button className="btn btn-sm btn-ghost" onClick={() => onView(s.id)}>
                  View
                </button>
                <button
                  className="btn btn-sm"
                  disabled={isActive || busy != null}
                  onClick={() => onActivate(s.id)}
                >
                  {busy === `activate:${s.id}` ? <span className="spin" /> : null}
                  {isActive ? 'Active' : 'Activate'}
                </button>
              </div>
            );
          })
        )}

        <div className="row wrap" style={{ paddingTop: 6 }}>
          <button
            className="btn btn-sm"
            disabled={busy != null || !index?.previousId}
            onClick={() => onRestore('previous')}
            title={index?.previousId ? `Back to ${index.previousId}` : 'No previous snapshot in this session'}
          >
            Restore previous{index?.previousId ? ` (${index.previousId})` : ''}
          </button>
          <button className="btn btn-sm" disabled={busy != null} onClick={() => onRestore('S0')}>
            Restore S0 baseline
          </button>
        </div>
        <p className="muted" style={{ fontSize: 12 }}>
          Activation only changes which stored published snapshot the harness executes. It publishes nothing.
        </p>
      </div>
    </section>
  );
}

function TransferCard({
  index,
  busy,
  onExport,
  onImported,
}: {
  index: SnapshotIndex | null;
  busy: string | null;
  onExport: (id: SnapshotId) => void;
  onImported: () => Promise<void>;
}) {
  const [selected, setSelected] = useState<SnapshotId>('');
  const [result, setResult] = useState<
    { ok: true; snapshot: PolicySnapshot } | { ok: false; error: string; diagnostics?: { kind: string; message: string }[] } | null
  >(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const id = selected || index?.activeId || '';

  async function importFile(file: File) {
    setImporting(true);
    setResult(null);
    try {
      const bundle = JSON.parse(await file.text());
      const res = await api<{ snapshot: PolicySnapshot }>('/api/policy/import', {
        method: 'POST',
        body: JSON.stringify({ bundle }),
      });
      setResult({ ok: true, snapshot: res.snapshot });
      await onImported();
    } catch (e) {
      const body = (e as { body?: { diagnostics?: { kind: string; message: string }[] } }).body;
      setResult({ ok: false, error: errText(e), diagnostics: body?.diagnostics });
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>Import and export</h2>
      </div>
      <div className="card-pad stack-sm">
        <div className="row wrap">
          <select
            className="select"
            style={{ flex: 1, minWidth: 150 }}
            value={id}
            onChange={(e) => setSelected(e.target.value)}
          >
            {(index?.snapshots ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <button className="btn btn-sm" disabled={!id || busy != null} onClick={() => onExport(id)}>
            {busy === `export:${id}` ? <span className="spin" /> : null} Export bundle
          </button>
        </div>

        <div className="row wrap">
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importFile(f);
            }}
          />
          <button className="btn btn-sm" disabled={importing} onClick={() => fileRef.current?.click()}>
            {importing ? <span className="spin" /> : null} Import bundle…
          </button>
          <span className="muted" style={{ fontSize: 12 }}>
            The hash is recomputed and a mismatch is rejected.
          </span>
        </div>

        {result?.ok === true ? (
          <div className="banner banner-ok">
            <span>
              <b>Imported {result.snapshot.id}.</b> {PROVENANCE_TEXT[result.snapshot.provenance]}.{' '}
              {result.snapshot.provenance === 'import-metadata'
                ? 'The publication details came from the bundle itself — the running app did not read LemmaBase to confirm them.'
                : ''}
              <span className="hash" style={{ display: 'block', marginTop: 4 }}>
                {result.snapshot.sourceHash}
              </span>
            </span>
          </div>
        ) : null}

        {result?.ok === false ? (
          <div className="stack-sm">
            <div className="banner banner-bad">
              <span>
                <b>Import rejected.</b> {result.error} The active snapshot was left untouched.
              </span>
            </div>
            {result.diagnostics?.length ? (
              <Diagnostics diagnostics={result.diagnostics.map((d) => ({ kind: d.kind, message: d.message }))} />
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function HandoffCard() {
  return (
    <section className="card">
      <div className="card-head">
        <h2>Publishing to LemmaBase</h2>
      </div>
      <div className="card-pad stack-sm">
        <div className="banner banner-warn">
          <span>
            <b>This app cannot publish.</b> It holds no LemmaBase credentials and has no supported publishing
            integration, so there is deliberately no “Publish” button here.
          </span>
        </div>

        <span className="eyebrow">Handoff</span>
        <ol className="steps-ol">
          <li>
            <b>Export</b> the draft source from the Local draft tab.
          </li>
          <li>
            <b>Publish</b> it through Claude Code’s LemmaBase MCP connection or the LemmaBase web interface.
          </li>
          <li>
            <b>Retrieve</b> the published source back from LemmaBase and export it as a bundle.
          </li>
          <li>
            <b>Import</b> that bundle here, then activate it.
          </li>
        </ol>

        <p className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
          The Claude Code MCP connection is a <b>development integration</b> used while building this prototype. It
          does not give the running application access to LemmaBase. A bundle brought back through import carries
          provenance <span className="mono">import-metadata</span> — its publication details were supplied by the
          file, not confirmed by a live repository read.
        </p>

        <a className="link-out" href={REPOSITORY_URL} target="_blank" rel="noreferrer">
          Open {REPOSITORY} in LemmaBase ↗
        </a>
      </div>
    </section>
  );
}
