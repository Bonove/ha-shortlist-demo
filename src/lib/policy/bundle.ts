/**
 * Portable policy bundles.
 *
 * Export carries the full source text so a bundle can be replayed anywhere.
 * Import is deliberately paranoid: completeness, hash and a real engine load
 * must all pass before anything is written, so a bad bundle leaves the active
 * policy state byte-identical.
 */

import type { PolicySnapshot, PolicySourceFile, ValidationDiagnostic } from '@/lib/contracts';
import { SPEC_NAME } from '@/lib/contracts';
import { loadIsolated } from '@/lib/lemma/engine';
import { hashBundle } from '@/lib/policy/hash';
import { addImportedSnapshot, listSnapshots } from '@/lib/policy/snapshots';

export interface PolicyBundle {
  kind: 'lemma-policy-bundle';
  version: 1;
  exportedAt: string;
  snapshot: PolicySnapshot;
}

export class BundleError extends Error {
  readonly diagnostics: ValidationDiagnostic[];
  constructor(message: string, diagnostics: ValidationDiagnostic[]) {
    super(message);
    this.name = 'BundleError';
    this.diagnostics = diagnostics;
  }
}

/* -------------------------------------------------------------- export */

const SECRET_KEY = /secret|token|password|credential|authorization|api[-_]?key|apikey|private[-_]?key/i;

/** Walk the object graph and refuse to emit anything that looks like a secret. */
function assertNoSecrets(value: unknown, path = 'bundle'): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoSecrets(v, `${path}[${i}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, v] of Object.entries(value)) {
      if (SECRET_KEY.test(key)) throw new BundleError(`Refusing to export: "${path}.${key}" looks like a secret.`, []);
      assertNoSecrets(v, `${path}.${key}`);
    }
  }
}

export function exportBundle(snapshot: PolicySnapshot): PolicyBundle {
  const bundle: PolicyBundle = {
    kind: 'lemma-policy-bundle',
    version: 1,
    exportedAt: new Date().toISOString(),
    snapshot,
  };
  assertNoSecrets(bundle);
  return bundle;
}

/* -------------------------------------------------------------- import */

function fail(message: string, diagnostics: ValidationDiagnostic[] = []): never {
  throw new BundleError(message, diagnostics.length ? diagnostics : [{ kind: 'bundle', message }]);
}

function uniqueId(wanted: string): string {
  const taken = new Set(listSnapshots().map((s) => s.id));
  if (!taken.has(wanted)) return wanted;
  for (let n = 1; ; n += 1) {
    const candidate = `${wanted}-imported${n > 1 ? `-${n}` : ''}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Verify and store an imported bundle. Nothing is written until the bundle has
 * proved it loads into a real engine.
 */
export function importBundle(raw: unknown): PolicySnapshot {
  const bundle = raw as Partial<PolicyBundle>;
  if (!bundle || typeof bundle !== 'object') fail('Bundle is not an object.');
  if (bundle.kind !== 'lemma-policy-bundle') fail('Not a lemma-policy-bundle.');
  if (bundle.version !== 1) fail(`Unsupported bundle version ${String(bundle.version)}.`);

  const snapshot = bundle.snapshot;
  if (!snapshot || typeof snapshot !== 'object') fail('Bundle has no snapshot.');
  if (!snapshot.id || !Array.isArray(snapshot.files) || snapshot.files.length === 0) {
    fail('Bundle snapshot is missing an id or any source files.');
  }

  const files: PolicySourceFile[] = snapshot.files.map((f) => {
    if (!f || typeof f.path !== 'string' || typeof f.code !== 'string' || f.code.trim() === '') {
      fail(`Bundle file "${f?.path ?? '(unnamed)'}" is missing or empty.`);
    }
    return { path: f.path, code: f.code };
  });

  const actual = hashBundle(files);
  if (snapshot.sourceHash && snapshot.sourceHash !== actual) {
    fail(`Source hash mismatch: bundle claims ${snapshot.sourceHash} but its files hash to ${actual}.`);
  }

  // Prove it executes before it can ever be activated.
  const { validation } = loadIsolated(files);
  if (!validation.valid) fail(`Imported bundle does not load into the engine.`, validation.diagnostics);

  const stored: PolicySnapshot = {
    id: uniqueId(snapshot.id),
    label: snapshot.label ?? `Imported ${snapshot.id}`,
    description: snapshot.description ?? `Imported policy bundle for ${SPEC_NAME}.`,
    step: null,
    files,
    sourceHash: actual,
    // Provenance came from the bundle's own metadata — nobody re-read LemmaBase.
    provenance: 'import-metadata',
    publication: snapshot.publication,
    capturedAt: new Date().toISOString(),
  };
  addImportedSnapshot(stored);
  return stored;
}
