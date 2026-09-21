/**
 * The only place this app talks to the Lemma engine.
 *
 * Two facts drive the whole design:
 *
 *  1. `initSync` rebuilds the wasm instance, so calling it twice invalidates
 *     every live `Engine`. It must run exactly once per process — including
 *     across Next's dev-mode module reloads, hence the `globalThis` latch.
 *  2. A spec cannot be replaced inside a loaded engine, so snapshots are
 *     isolated by constructing a *new* `Engine` per bundle and caching it by
 *     source hash.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { Engine, initSync, type EngineError, type Response, type RuleResult } from '@lemmabase/lemma-engine';
import type { PolicySourceFile, ValidationDiagnostic, ValidationResult } from '@/lib/contracts';
import { hashBundle } from '@/lib/policy/hash';

const require_ = createRequire(import.meta.url);
const ENGINE_DIR = dirname(require_.resolve('@lemmabase/lemma-engine'));

/** How many distinct bundles stay resident. Enough for S0–S3 plus drafts. */
const CACHE_LIMIT = 8;

interface LemmaGlobal {
  cache: Map<string, Engine>;
}
const globalRef = globalThis as typeof globalThis & { __lemmaEngine?: LemmaGlobal };

function shared(): LemmaGlobal {
  if (!globalRef.__lemmaEngine) {
    initSync({ module: readFileSync(join(ENGINE_DIR, 'lemma_bg.wasm')) });
    globalRef.__lemmaEngine = { cache: new Map() };
  }
  return globalRef.__lemmaEngine;
}

/* ------------------------------------------------------------- diagnostics */

/** Thrown when a bundle will not load or will not run. Carries renderable detail. */
export class LemmaEngineError extends Error {
  constructor(
    message: string,
    readonly diagnostics: ValidationDiagnostic[],
  ) {
    super(message);
    this.name = 'LemmaEngineError';
  }
}

function isEngineErrorArray(value: unknown): value is EngineError[] {
  return Array.isArray(value) && value.every((e) => e && typeof e === 'object' && 'kind' in e && 'message' in e);
}

export function toDiagnostics(error: unknown): ValidationDiagnostic[] {
  if (isEngineErrorArray(error)) {
    return error.map((e) => ({
      kind: e.kind,
      message: e.message,
      path: e.source?.attribute,
      line: e.source?.line,
      column: e.source?.column,
      suggestion: e.suggestion ?? undefined,
    }));
  }
  return [{ kind: 'engine', message: error instanceof Error ? error.message : String(error) }];
}

/* ----------------------------------------------------------------- loading */

function loadInto(engine: Engine, files: PolicySourceFile[]): ValidationResult {
  const sources = Object.fromEntries(files.map((f) => [f.path, f.code]));
  try {
    // 0.9.10 throws an EngineError[] on failure; older notes say it returns one.
    // Both are handled so neither behaviour can be mistaken for success.
    const returned = engine.load(sources) as unknown;
    if (returned) return { valid: false, diagnostics: toDiagnostics(returned) };
    return { valid: true, diagnostics: [] };
  } catch (error) {
    return { valid: false, diagnostics: toDiagnostics(error) };
  }
}

/**
 * A throwaway engine for validating or previewing a draft. Never cached, so a
 * broken draft cannot disturb the engine holding the active snapshot.
 */
export function loadIsolated(files: PolicySourceFile[]): { engine: Engine; validation: ValidationResult } {
  shared();
  const engine = new Engine();
  return { engine, validation: loadInto(engine, files) };
}

/** The cached engine for this exact bundle, built on first use. */
export function getEngineForBundle(files: PolicySourceFile[]): { engine: Engine; hash: string } {
  const { cache } = shared();
  const hash = hashBundle(files);
  const cached = cache.get(hash);
  if (cached) return { engine: cached, hash };

  const engine = new Engine();
  const validation = loadInto(engine, files);
  if (!validation.valid) {
    throw new LemmaEngineError(`Policy bundle ${hash} failed to load`, validation.diagnostics);
  }

  cache.set(hash, engine);
  // Map iterates in insertion order, so the first key is the oldest. wasm-bindgen
  // registers a FinalizationRegistry, so dropping the reference frees it.
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  return { engine, hash };
}

/* -------------------------------------------------------------- evaluation */

/** One rule's result, with values already parsed so callers never read display strings. */
export interface LemmaRuleResult {
  vetoed: boolean;
  display?: string;
  boolean?: boolean;
  numericEur?: number;
  months?: number;
  vetoReason?: string;
  missingData?: string[];
  explanation?: unknown;
}

export interface LemmaEvaluation {
  spec: string;
  /** Instant the engine resolved the spec at. */
  effective: string;
  specEffectiveFrom?: string;
  sourceHash: string;
  results: Record<string, LemmaRuleResult>;
  /** The engine response, unmodified. */
  raw: Response;
}

function normalise(result: RuleResult): LemmaRuleResult {
  const eur = result.measure?.eur;
  // `month` is the reserved calendar unit; anything else is not a stay length.
  const months = result.calendar?.unit === 'month' ? Number(result.calendar.value) : undefined;
  return {
    vetoed: result.vetoed,
    display: result.display,
    boolean: result.boolean,
    numericEur: eur === undefined ? undefined : Number(eur),
    months,
    vetoReason: result.veto_reason,
    missingData: result.missing_data,
    explanation: result.explanation,
  };
}

/**
 * Run a bundle against one set of inputs. Throws `LemmaEngineError` rather than
 * returning a partial result — a failed evaluation must be visible, never a zero.
 */
export function evaluateListing(
  files: PolicySourceFile[],
  input: Record<string, unknown>,
  opts: { spec: string; effective?: string; rules?: string[]; explain?: boolean } = { spec: 'shortlist_policy' },
): LemmaEvaluation {
  const { engine, hash } = getEngineForBundle(files);
  let raw: Response;
  try {
    raw = engine.run({
      spec: opts.spec,
      data: input,
      effective: opts.effective ?? null,
      rules: opts.rules ?? null,
      explain: opts.explain ?? false,
    });
  } catch (error) {
    throw new LemmaEngineError(`Engine run failed for spec ${opts.spec}`, toDiagnostics(error));
  }
  return {
    spec: raw.spec,
    effective: raw.effective,
    specEffectiveFrom: raw.spec_effective_from,
    sourceHash: hash,
    results: Object.fromEntries(Object.entries(raw.results).map(([name, r]) => [name, normalise(r)])),
    raw,
  };
}

/** Same run, but in an isolated engine — used for draft preview. */
export function evaluateIsolated(
  engine: Engine,
  input: Record<string, unknown>,
  opts: { spec: string; effective?: string; explain?: boolean },
): LemmaEvaluation {
  let raw: Response;
  try {
    raw = engine.run({ spec: opts.spec, data: input, effective: opts.effective ?? null, explain: opts.explain ?? false });
  } catch (error) {
    throw new LemmaEngineError(`Engine run failed for spec ${opts.spec}`, toDiagnostics(error));
  }
  return {
    spec: raw.spec,
    effective: raw.effective,
    specEffectiveFrom: raw.spec_effective_from,
    sourceHash: '',
    results: Object.fromEntries(Object.entries(raw.results).map(([name, r]) => [name, normalise(r)])),
    raw,
  };
}

/* ----------------------------------------------------------------- runtime */

export function engineVersion(): string {
  const pkg = JSON.parse(readFileSync(join(ENGINE_DIR, 'package.json'), 'utf8')) as { version: string };
  return pkg.version;
}

export function runtimeLabel(): string {
  return `@lemmabase/lemma-engine ${engineVersion()} (wasm, server-side)`;
}
