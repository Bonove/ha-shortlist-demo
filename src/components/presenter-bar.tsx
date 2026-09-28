'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SystemStatus } from '@/lib/contracts';
import {
  api,
  errText,
  shortHash,
  onDay, when,
} from '@/components/studio/shared';
import {
  setPresentationMode,
  syncPresentationMode,
  usePresentationMode,
} from '@/components/studio/presentation-mode';
import '@/components/studio/studio.css';

/** Any page can ask the bar to re-read status after an action it performed. */
export const STATUS_REFRESH_EVENT = 'ha:status-refresh';

export function PresenterBar() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const presenting = usePresentationMode();

  const load = useCallback(async () => {
    try {
      setStatus(await api<SystemStatus>('/api/status'));
      setError(null);
    } catch (e) {
      setError(errText(e));
    }
  }, []);

  useEffect(() => {
    syncPresentationMode();
    void load();
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    window.addEventListener(STATUS_REFRESH_EVENT, onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(STATUS_REFRESH_EVENT, onFocus);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const connected = status?.lemmabase.mode === 'connected';
  const evaluationDate = status?.evaluationDate ?? null;

  return (
    <div className="presenter" ref={box}>
      <button
        className="presenter-chips"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="Live harness status"
      >
        {error || !status ? (
          <span className="presenter-chip">
            <span className={`dot ${error ? 'dot-bad' : ''}`} />
            {error ? 'Status unavailable' : 'Reading status…'}
          </span>
        ) : (
          <>
            <span className="presenter-chip">
              <span className={`dot ${status.ai.configured ? 'dot-ok' : 'dot-warn'}`} />
              AI
            </span>
            <span className="presenter-sep" />
            <span className="presenter-chip">
              <span className={`dot ${status.lemma.loaded ? 'dot-ok' : 'dot-warn'}`} />
              Lemma {status.lemma.version}
            </span>
            <span className="presenter-sep" />
            <span className="presenter-chip">
              {status.activeSnapshot ? (
                <>
                  {status.activeSnapshot.id}
                  <span className="mono muted">{shortHash(status.activeSnapshot.sourceHash)}</span>
                </>
              ) : (
                <>
                  <span className="dot dot-bad" />
                  No active policy
                </>
              )}
            </span>
            <span className="presenter-sep" />
            <span className="presenter-chip">
              <span className={`dot ${connected ? 'dot-ok' : 'dot-warn'}`} />
              {connected ? 'LemmaBase linked' : 'Stored snapshot'}
            </span>
            {evaluationDate && (
              <>
                <span className="presenter-sep" />
                <span className="presenter-chip">
                  <span className="dot dot-warn" />
                  as of <span className="mono">{evaluationDate}</span>
                </span>
              </>
            )}
          </>
        )}
      </button>

      <button
        className="switch"
        data-on={presenting}
        onClick={() => setPresentationMode(!presenting)}
        aria-pressed={presenting}
        title="Enlarge key figures and flash every change during the walkthrough"
      >
        <span className="switch-track">
          <span className="switch-knob" />
        </span>
        Presentation mode
      </button>

      {open ? <StatusPopover status={status} error={error} onRefresh={load} /> : null}
    </div>
  );
}

function StatusPopover({
  status,
  error,
  onRefresh,
}: {
  status: SystemStatus | null;
  error: string | null;
  onRefresh: () => void;
}) {
  return (
    <div className="popover">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3>Harness status</h3>
        <button className="btn btn-sm btn-ghost" onClick={onRefresh}>
          Refresh
        </button>
      </div>

      {error ? (
        <div className="banner banner-bad" style={{ marginTop: 10 }}>
          <span>
            <b>GET /api/status did not answer.</b> {error}
          </span>
        </div>
      ) : null}

      {!status ? (
        !error ? (
          <div className="stack-sm" style={{ marginTop: 14 }}>
            <div className="skeleton" style={{ width: '70%' }} />
            <div className="skeleton" style={{ width: '90%' }} />
            <div className="skeleton" style={{ width: '55%' }} />
          </div>
        ) : null
      ) : (
        <>
          <section className="pop-section">
            <span className="eyebrow">Live assistant</span>
            <div className="pop-line">
              <span className="k">State</span>
              <span className="v">
                <span className={`dot ${status.ai.configured ? 'dot-ok' : 'dot-warn'}`} />{' '}
                {status.ai.configured ? 'Configured' : 'Not configured'}
              </span>
            </div>
            <div className="pop-line">
              <span className="k">Model</span>
              <span className="v mono">{status.ai.model ?? '—'}</span>
            </div>
            <div className="pop-line">
              <span className="k">Last error</span>
              <span className="v" style={{ color: status.ai.lastError ? 'var(--destructive)' : undefined }}>
                {status.ai.lastError ?? 'None'}
              </span>
            </div>
          </section>

          <section className="pop-section">
            <span className="eyebrow">Lemma engine</span>
            <div className="pop-line">
              <span className="k">Runtime</span>
              <span className="v">{status.lemma.runtime}</span>
            </div>
            <div className="pop-line">
              <span className="k">Version</span>
              <span className="v mono">{status.lemma.version}</span>
            </div>
            <div className="pop-line">
              <span className="k">Loaded</span>
              <span className="v">{status.lemma.loaded ? 'Yes — running locally' : 'Not loaded'}</span>
            </div>
          </section>

          <section className="pop-section">
            <span className="eyebrow">Active policy snapshot</span>
            {status.activeSnapshot ? (
              <>
                <div className="pop-line">
                  <span className="k">Snapshot</span>
                  <span className="v">
                    {status.activeSnapshot.id} · {status.activeSnapshot.label}
                  </span>
                </div>
                <div className="pop-line">
                  <span className="k">Source hash</span>
                  <span className="v mono">{shortHash(status.activeSnapshot.sourceHash)}</span>
                </div>
                <div className="pop-line">
                  <span className="k">Read as of</span>
                  <span className="v">
                    {status.evaluationDate ? onDay(status.evaluationDate) : 'now'}
                  </span>
                </div>
              </>
            ) : (
              <div className="pop-line">
                <span className="v">No snapshot is active.</span>
              </div>
            )}
          </section>

          <section className="pop-section">
            <span className="eyebrow">LemmaBase</span>
            <div className="pop-line">
              <span className="k">Repository</span>
              <span className="v mono">{status.lemmabase.repository}</span>
            </div>
            <div className="pop-line">
              <span className="k">This session</span>
              <span className="v">
                {status.lemmabase.mode === 'connected'
                  ? 'Connected to LemmaBase this session, read only. What runs is still the stored snapshot below — the API exposes schemas and evaluation, not source text.'
                  : 'Using a stored published snapshot. The running app has not contacted LemmaBase this session.'}
              </span>
            </div>
            <div className="pop-line">
              <span className="k">Last sync</span>
              <span className="v">{when(status.lemmabase.lastSyncAt)}</span>
            </div>
            <div className="pop-line">
              <span className="k">Open</span>
              <span className="v">
                <a className="link-out" href={status.lemmabase.repositoryUrl} target="_blank" rel="noreferrer">
                  Open in LemmaBase ↗
                </a>
              </span>
            </div>
          </section>

          <section className="pop-section">
            <span className="eyebrow">Demonstration data</span>
            <div className="pop-line">
              <span className="k">Listings</span>
              <span className="v">{status.demoData.listings} fictional listings</span>
            </div>
            <div className="pop-line">
              <span className="k">Tenant</span>
              <span className="v">{status.demoData.tenant}</span>
            </div>
          </section>

          <section className="pop-section">
            <span className="eyebrow">Latest successful evaluation</span>
            {status.lastEvaluation ? (
              <>
                <div className="pop-line">
                  <span className="k">Ran at</span>
                  <span className="v">{when(status.lastEvaluation.at)}</span>
                </div>
                <div className="pop-line">
                  <span className="k">Snapshot</span>
                  <span className="v">{status.lastEvaluation.snapshotId}</span>
                </div>
                <div className="pop-line">
                  <span className="k">Evaluation</span>
                  <span className="v mono">{status.lastEvaluation.evaluationId}</span>
                </div>
              </>
            ) : (
              <div className="pop-line">
                <span className="v">Nothing has been evaluated yet in this session.</span>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
