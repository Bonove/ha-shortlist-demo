'use client';

import type {
  FitStatus,
  ProvenanceVerification,
  ValidationDiagnostic,
} from '@/lib/contracts';

/* ------------------------------------------------------------------- http */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
  }
}

/**
 * Every studio call goes through here so a route that is missing, still
 * compiling or returning HTML surfaces as an honest message rather than a
 * silent blank panel.
 */
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      cache: 'no-store',
      ...init,
      headers: init?.body ? { 'content-type': 'application/json', ...init?.headers } : init?.headers,
    });
  } catch (e) {
    throw new ApiError(`Could not reach ${url}: ${(e as Error).message}`, 0, null);
  }
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new ApiError(
        res.ok
          ? `${url} did not return JSON — the API is probably not built yet.`
          : `${url} failed with HTTP ${res.status}.`,
        res.status,
        text.slice(0, 400),
      );
    }
  }
  if (!res.ok) {
    const msg = (body as { error?: string } | null)?.error ?? `HTTP ${res.status}`;
    throw new ApiError(`${url}: ${msg}`, res.status, body);
  }
  return body as T;
}

export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/* --------------------------------------------------------------- format */

export function money(n: number | null | undefined): string {
  if (n == null) return '—';
  return `€${n.toLocaleString('en-GB', {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

export function months(n: number | null | undefined): string {
  if (n == null) return '—';
  return `${n} ${n === 1 ? 'month' : 'months'}`;
}

/** sha256:abcd… → abcd1234 — enough to compare by eye, never presented as an id. */
export function shortHash(hash: string | null | undefined): string {
  if (!hash) return '—';
  return hash.replace(/^sha256:/, '').slice(0, 8);
}

export function when(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const PROVENANCE_TEXT: Record<ProvenanceVerification, string> = {
  'live-repository-read': 'Verified by a live repository read',
  'import-metadata': 'Supplied as import metadata — not verified by a repository read',
  'local-draft': 'Local draft — never published, never provenance-verified',
};

/* ---------------------------------------------------------------- pieces */

const STATUS_TEXT: Record<FitStatus, string> = {
  fits: 'Fits',
  'does-not-fit': 'Does not fit',
  'needs-information': 'Needs information',
  'evaluation-unavailable': 'Evaluation unavailable',
};

const STATUS_CLASS: Record<FitStatus, string> = {
  fits: 'pill-fits',
  'does-not-fit': 'pill-nofit',
  'needs-information': 'pill-info',
  'evaluation-unavailable': 'pill-unavailable',
};

export function StatusPill({ status }: { status: FitStatus }) {
  return <span className={`pill ${STATUS_CLASS[status]}`}>{STATUS_TEXT[status]}</span>;
}

export function ProvenancePill({ provenance }: { provenance: ProvenanceVerification }) {
  const cls =
    provenance === 'live-repository-read'
      ? 'pill-fits'
      : provenance === 'import-metadata'
        ? 'pill-info'
        : 'pill-neutral';
  return <span className={`pill ${cls}`}>{PROVENANCE_TEXT[provenance]}</span>;
}

export function Diagnostics({ diagnostics }: { diagnostics: ValidationDiagnostic[] }) {
  if (diagnostics.length === 0) return null;
  return (
    <div className="diag">
      {diagnostics.map((d, i) => (
        <div className="diag-row" key={i}>
          <span className="diag-where">
            {d.path ?? ''}
            {d.line != null ? `${d.path ? ' ' : ''}line ${d.line}${d.column != null ? `:${d.column}` : ''}` : ''}
            {d.line == null && !d.path ? d.kind : ''}
          </span>
          <span className="diag-msg">
            <b>{d.kind}</b> — {d.message}
            {d.suggestion ? <span className="suggestion">Suggestion: {d.suggestion}</span> : null}
          </span>
        </div>
      ))}
    </div>
  );
}

export type DiffLine = { type: 'add' | 'del' | 'ctx'; text: string };

export function DiffView({ lines }: { lines: DiffLine[] }) {
  if (lines.length === 0) {
    return <div className="empty">No source differences between these two snapshots.</div>;
  }
  return (
    <pre className="code source-box">
      {lines.map((l, i) => (
        <span key={i} className={`diff-${l.type}`}>
          {l.type === 'add' ? '+ ' : l.type === 'del' ? '- ' : '  '}
          {l.text || ' '}
        </span>
      ))}
    </pre>
  );
}

export function Loading({ label }: { label: string }) {
  return (
    <div className="empty row" style={{ justifyContent: 'center' }}>
      <span className="spin" /> {label}
    </div>
  );
}

export function ErrorNote({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="banner banner-bad">
      <div className="grow" style={{ flex: 1 }}>
        <b>Something did not respond.</b> {error}
      </div>
      {onRetry ? (
        <button className="btn btn-sm" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}

/** Browser-side file download — used for bundle export and draft source. */
export function download(filename: string, contents: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
