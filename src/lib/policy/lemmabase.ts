import { REPOSITORY, SPEC_NAME } from '@/lib/contracts';

/**
 * Optional, read-only connection to the live LemmaBase repository.
 *
 * What the documented REST API actually offers, verified against the service:
 *   GET  /                  the schemas and commentary of every published spec
 *   GET  /{spec}            one spec's schema and temporal boundaries
 *   POST /{spec}            evaluate against the CURRENTLY published policy
 *
 * There is no endpoint that returns Lemma source text, and none that publishes.
 * So this connection can prove what the repository is serving right now, but it
 * cannot capture a new snapshot — that still goes through the MCP handoff.
 *
 * Everything here is server-side. The key never reaches the browser.
 */

const BASE = () =>
  `${(process.env.LEMMABASE_BASE_URL || 'https://lemmabase.com').replace(/\/$/, '')}/api/${REPOSITORY}`;

export const hasCredentials = () => Boolean(process.env.LEMMABASE_API_KEY);

/** Set once a live read has actually succeeded, so status can stop guessing. */
const slot = globalThis as { __haLemmaBaseSync?: string };
export const lastLiveRead = () => slot.__haLemmaBaseSync ?? null;

async function call(path: string, init?: RequestInit) {
  const key = process.env.LEMMABASE_API_KEY;
  if (!key) throw new Error('No LEMMABASE_API_KEY is configured on the server.');
  const res = await fetch(`${BASE()}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json', ...init?.headers },
    signal: AbortSignal.timeout(12_000),
    cache: 'no-store',
  });
  if (!res.ok) {
    // Never echo the body verbatim: an auth error can quote the key back.
    throw new Error(`LemmaBase returned ${res.status} for ${path}.`);
  }
  slot.__haLemmaBaseSync = new Date().toISOString();
  return res.json();
}

export interface LivePolicy {
  /** The spec commentary as currently published — what the repository serves. */
  commentary: string | null;
  readAt: string;
}

/** What the repository is publishing right now. */
export async function readLivePolicy(): Promise<LivePolicy> {
  const specs = (await call('/')) as { commentary?: string; name?: string }[];
  const spec = Array.isArray(specs) ? specs.find((s) => !s.name || s.name === SPEC_NAME) ?? specs[0] : null;
  return { commentary: spec?.commentary ?? null, readAt: new Date().toISOString() };
}

export interface LiveResult {
  initialPayment: string | null;
  offerFits: boolean | null;
}

/** Evaluate one listing against the live published policy, for cross-checking. */
export async function evaluateLive(input: Record<string, unknown>): Promise<LiveResult> {
  const body = (await call(`/${SPEC_NAME}?rules=initial_payment,offer_fits`, {
    method: 'POST',
    body: JSON.stringify(input),
  })) as { results?: Record<string, { display?: string; boolean?: boolean; vetoed?: boolean }> };
  const r = body.results ?? {};
  return {
    initialPayment: r.initial_payment?.vetoed ? null : r.initial_payment?.display ?? null,
    offerFits: r.offer_fits?.vetoed ? null : r.offer_fits?.boolean ?? null,
  };
}
