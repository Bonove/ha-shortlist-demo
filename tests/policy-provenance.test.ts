/**
 * Provenance and secrecy: what was executed can be proved, and nothing secret
 * leaves the server.
 *
 * These tests never call LemmaBase. The running app holds no LemmaBase
 * credentials, so the invariant worth testing is the local one: the source text
 * on disk is the source the manifest says was published, and the bundle an
 * operator exports is the bundle that was executed.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PolicySnapshot } from '@/lib/contracts';
import { SPEC_PATH } from '@/lib/contracts';
import { exportBundle } from '@/lib/policy/bundle';
import { hashBundle } from '@/lib/policy/hash';
import { getSnapshot, listSnapshots } from '@/lib/policy/snapshots';
import { GET as exportRoute } from '@/app/api/policy/export/route';

const ROOT = process.cwd();
const SNAPSHOT_DIR = join(ROOT, 'policies', 'snapshots');
const CAPTURED = readdirSync(SNAPSHOT_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

/** A motion-based publication exposes no revision id, so none is recorded. */
const PUBLISHED_VIA_MOTION = new Set(['S4', 'S5']);

describe('2. the captured source on disk is the source the manifest published', () => {
  it('there are six captured snapshots, S0–S5', () => {
    expect(CAPTURED).toEqual(['S0', 'S1', 'S2', 'S3', 'S4', 'S5']);
  });

  for (const id of CAPTURED) {
    it(`${id}: the files on disk hash to the manifest's sourceHash`, () => {
      const manifest = JSON.parse(
        readFileSync(join(SNAPSHOT_DIR, id, 'manifest.json'), 'utf8'),
      ) as PolicySnapshot;
      const files = manifest.files.map((f) => ({
        path: f.path,
        code: readFileSync(join(SNAPSHOT_DIR, id, f.path), 'utf8'),
      }));
      expect(hashBundle(files), `${id} source has drifted from its manifest`).toBe(manifest.sourceHash);
    });

    it(`${id}: the publication record names the repository, specs and revision it came from`, () => {
      const snapshot = getSnapshot(id);
      expect(snapshot.provenance).toBe('live-repository-read');
      expect(snapshot.publication?.repository).toBe('@tristan-van-doorn/ha-shortlist-demo');
      // Every spec the retrieved bundle holds. A dated version inside one of
      // them is not recorded here: which version applied belongs to a run.
      expect(snapshot.publication?.specs).toContain('shortlist_policy');
      if (id === 'S5') {
        // One publication, four specs: the journey runs out of a single bundle,
        // so one activation moves every moment at once.
        expect(snapshot.publication?.specs).toEqual([
          'contract_check',
          'deposit_settlement',
          'renewal_policy',
          'shortlist_policy',
        ]);
      }
      expect(Date.parse(snapshot.publication!.retrievedAt)).not.toBeNaN();
      if (PUBLISHED_VIA_MOTION.has(id)) {
        // These publications went through a LemmaBase motion, which exposes no
        // revision id. An absent one is recorded as absent; inventing a
        // plausible-looking id would be the actual failure here.
        expect(snapshot.publication?.revision).toBeUndefined();
      } else {
        // A revision id and a retrieval instant, kept apart from the snapshot id.
        expect(snapshot.publication?.revision).toMatch(/^[0-9a-f-]{20,}$/);
        expect(snapshot.publication?.revision).not.toBe(snapshot.id);
      }
    });
  }

  it('each snapshot is a distinct bundle — no two steps share a source hash', () => {
    const hashes = CAPTURED.map((id) => getSnapshot(id).sourceHash);
    expect(new Set(hashes).size).toBe(CAPTURED.length);
  });
});

describe('13. an export identifies the exact source and inputs that were used', () => {
  it('carries the snapshot id, its source hash, the publication record and the full source text', async () => {
    const response = await exportRoute(
      new Request('http://localhost/api/policy/export?snapshotId=S2'),
    );
    expect(response.status).toBe(200);
    const bundle = JSON.parse(await response.text()) as ReturnType<typeof exportBundle>;

    expect(bundle.kind).toBe('lemma-policy-bundle');
    expect(bundle.version).toBe(1);
    expect(bundle.snapshot.id).toBe('S2');
    expect(bundle.snapshot.sourceHash).toBe(getSnapshot('S2').sourceHash);
    expect(bundle.snapshot.provenance).toBe('live-repository-read');
    expect(bundle.snapshot.publication?.repository).toBe('@tristan-van-doorn/ha-shortlist-demo');
    expect(bundle.snapshot.publication?.revision).toBeTruthy();
    expect(bundle.snapshot.publication?.retrievedAt).toBeTruthy();
    expect(Date.parse(bundle.exportedAt)).not.toBeNaN();

    // The whole executable text, not a reference to it: a reader can re-run it.
    const onDisk = readFileSync(join(SNAPSHOT_DIR, 'S2', SPEC_PATH), 'utf8');
    expect(bundle.snapshot.files).toHaveLength(1);
    expect(bundle.snapshot.files[0].path).toBe(SPEC_PATH);
    expect(bundle.snapshot.files[0].code).toBe(onDisk);
    expect(bundle.snapshot.files[0].code).toContain('spec shortlist_policy 2026-01-01');

    // And the text it carries really does hash to the hash it claims.
    expect(hashBundle(bundle.snapshot.files)).toBe(bundle.snapshot.sourceHash);
  });

  it('is downloadable under a name that says which snapshot it is', async () => {
    const response = await exportRoute(
      new Request('http://localhost/api/policy/export?snapshotId=S3'),
    );
    expect(response.headers.get('content-disposition')).toContain('policy-S3.json');
  });
});

/* ------------------------------------------------------------------ secrets */

/** Values of *_KEY variables that are actually set in this checkout. */
function envKeyValues(): { name: string; value: string }[] {
  const file = join(ROOT, '.env');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => line.match(/^([A-Z0-9_]*KEY)=(.+)$/))
    .filter((m): m is RegExpMatchArray => Boolean(m))
    .map((m) => ({ name: m[1], value: m[2].trim() }))
    .filter((v) => v.value.length > 0);
}

const SECRET_NAMES = ['OPENAI_API_KEY', 'LEMMABASE_API_KEY'];

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

describe('14. secrets are absent from exports and from client assets', () => {
  const exported = JSON.stringify(exportBundle(getSnapshot('S0')));

  it('an export payload contains no key-shaped string', () => {
    expect(exported).not.toMatch(/sk-[A-Za-z0-9_-]{2,}/);
    for (const name of SECRET_NAMES) expect(exported).not.toContain(name);
    for (const { name, value } of envKeyValues()) {
      expect(exported.includes(value), `${name} leaked into an export`).toBe(false);
    }
  });

  it('the exporter refuses a bundle that carries a secret-looking field', () => {
    const poisoned = { ...getSnapshot('S0'), publication: { apiKey: 'sk-live-should-never-ship' } } as unknown as PolicySnapshot;
    expect(() => exportBundle(poisoned)).toThrow(/looks like a secret/i);
  });

  it('no client component reads a server-side key', () => {
    const sources = walk(join(ROOT, 'src')).filter((f) => /\.tsx?$/.test(f));
    // Naming a variable in UI copy ("no OPENAI_API_KEY is set on the server") is
    // fine; reading its value in code that ships to the browser is not.
    const offenders = sources.filter((file) => {
      const code = readFileSync(file, 'utf8');
      return code.includes("'use client'") && SECRET_NAMES.some((n) => code.includes(`process.env.${n}`));
    });
    expect(offenders, 'a client component must never read a key').toEqual([]);
    // A NEXT_PUBLIC_ variable is shipped to the browser verbatim, so none may be a key.
    const publicKeys = sources.filter((f) => /NEXT_PUBLIC_[A-Z0-9_]*KEY/.test(readFileSync(f, 'utf8')));
    expect(publicKeys).toEqual([]);
  });

  it('the built client assets contain no key value', () => {
    // `.next-verify` is a production build made with `NEXT_DIST_DIR=.next-verify
    // npx next build`, kept separate so a verification build cannot clobber the
    // `.next` a dev server is serving from. Both are scanned when present.
    const dirs = ['.next-verify', '.next'].map((d) => join(ROOT, d, 'static')).filter(existsSync);
    // Built output is required: this check is worthless if it silently passes
    // because nothing has been built.
    expect(dirs.length, 'build the app first: NEXT_DIST_DIR=.next-verify npx next build').toBeGreaterThan(0);
    const assets = dirs.flatMap(walk).filter((f) => statSync(f).size > 0);
    expect(assets.length).toBeGreaterThan(0);

    const values = envKeyValues();
    for (const file of assets) {
      const text = readFileSync(file, 'utf8');
      expect(/sk-[A-Za-z0-9_-]{6,}/.test(text), `${file} contains a key-shaped literal`).toBe(false);
      for (const name of SECRET_NAMES) {
        // The bundler inlines an env var as `NAME:"value"` or `NAME="value"`.
        // The bare name may legitimately appear in UI copy.
        const inlined = new RegExp(`${name}["']?\\s*[:=]\\s*["'][^"']+["']`);
        expect(inlined.test(text), `${file} inlines a value for ${name}`).toBe(false);
      }
      for (const { name, value } of values) {
        expect(text.includes(value), `${file} contains the value of ${name}`).toBe(false);
      }
    }
  });

  it('the server never hands a key to the browser through a public route', () => {
    // `next build` output is checked above; this catches the other leak path —
    // an API route reading process.env and echoing it back to the caller.
    const routes = walk(join(ROOT, 'src', 'app', 'api')).filter((f) => f.endsWith('.ts'));
    for (const file of routes) {
      const code = readFileSync(file, 'utf8');
      for (const name of SECRET_NAMES) {
        expect(code.includes(`process.env.${name}`), `${file} reads ${name} in a response path`).toBe(false);
      }
    }
  });
});

/** Belt and braces: the fixture script must still reproduce the published table. */
describe('the acceptance fixture script still reproduces the table', () => {
  it('verify-snapshots.mjs prints S0–S3 exactly as published', () => {
    const out = execFileSync('node', ['scripts/verify-snapshots.mjs'], { cwd: ROOT, encoding: 'utf8' }).trim();
    expect(out.split('\n')).toEqual([
      'S0 A=3450/false B=2450/true C=2250/false',
      'S1 A=3400/false B=2400/true C=2200/false',
      'S2 A=2300/true B=2400/true C=2200/false',
      'S3 A=2300/true B=2400/true C=2200/true',
    ]);
  });
});

/** Listed here so a stray import cannot silently drop a snapshot from the walk. */
it('every snapshot the app can hand out is complete executable source', () => {
  for (const snapshot of listSnapshots()) {
    expect(snapshot.files.length).toBeGreaterThan(0);
    for (const file of snapshot.files) expect(file.code.trim().length).toBeGreaterThan(0);
  }
});
