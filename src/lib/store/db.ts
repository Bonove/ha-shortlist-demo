import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import type { ScenarioSnapshot, SessionState } from '@/lib/contracts';
import { seedListings } from '@/lib/domain/listings';
import { seedTenant } from '@/lib/domain/tenant';

const FILE = join(process.cwd(), 'data', 'session.json');

/** Everything the harness owns. Policy state belongs to lemma-core. */
export interface HarnessDoc {
  session: SessionState;
  /** Frozen inputs for the cumulative snapshot comparison. */
  scenario: ScenarioSnapshot | null;
}

export function seedSession(): SessionState {
  return {
    id: randomUUID(),
    tenant: seedTenant(),
    listings: seedListings(),
    activeSnapshotId: 'S0',
    previousSnapshotId: null,
    messages: [],
    events: [],
    applications: [],
    assessments: {},
  };
}

let cache: HarnessDoc | null = null;

async function load(): Promise<HarnessDoc> {
  if (cache) return cache;
  try {
    cache = JSON.parse(await readFile(FILE, 'utf8')) as HarnessDoc;
  } catch {
    cache = { session: seedSession(), scenario: null };
  }
  return cache;
}

async function save(doc: HarnessDoc): Promise<void> {
  await mkdir(dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(doc, null, 2));
  await rename(tmp, FILE); // atomic: a crash mid-write must not truncate the store
}

// ponytail: one in-process promise chain serialises every read-modify-write.
// Single Next.js server, one small document — a lock file or a database would
// buy nothing. Multi-process deployment would need one.
let chain: Promise<unknown> = Promise.resolve();

function queue<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn);
  chain = run.catch(() => undefined); // a failed call must not poison the chain
  return run;
}

/** Read-modify-write under the mutex. The document is saved after fn returns. */
export function transact<T>(fn: (doc: HarnessDoc) => T | Promise<T>): Promise<T> {
  return queue(async () => {
    const doc = await load();
    const out = await fn(doc);
    await save(doc);
    return out;
  });
}

/** Read under the mutex, without writing. */
export function readDoc<T>(fn: (doc: HarnessDoc) => T): Promise<T> {
  return queue(async () => fn(await load()));
}

/** Throws away all harness state and re-seeds. */
export function resetDoc(): Promise<SessionState> {
  return transact((doc) => {
    doc.session = seedSession();
    doc.scenario = null;
    return doc.session;
  });
}
