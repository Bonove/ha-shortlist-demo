/**
 * The snapshot store.
 *
 * `policies/snapshots/<id>/` holds the immutable bundles captured straight from
 * LemmaBase after each publication. They are read-only here; the only mutable
 * policy state is the active pointer, imported bundles and drafts, which live
 * in `data/policy-state.json`.
 *
 * A newer publication never becomes active by itself. Activation is explicit.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PolicyDraft, PolicySnapshot, PolicySourceFile, SnapshotId } from '@/lib/contracts';
import { hashBundle } from '@/lib/policy/hash';

const SNAPSHOT_DIR = join(process.cwd(), 'policies', 'snapshots');
// See HA_DATA_DIR in src/lib/store/db.ts: tests point this at a scratch copy.
const DATA_DIR = join(process.cwd(), process.env.HA_DATA_DIR || 'data');
const STATE_FILE = join(DATA_DIR, 'policy-state.json');
/**
 * What a fresh installation runs. S5 is the only bundle carrying all four
 * specs, so anything earlier leaves three of the journey's moments with
 * nothing to execute — and the deployed demo has an ephemeral filesystem, so
 * every deploy starts here.
 */
const DEFAULT_ACTIVE: SnapshotId = 'S5';

/**
 * Where "restore to the baseline" goes. Deliberately not DEFAULT_ACTIVE: the
 * S0–S4 policy walk starts from S0, and its restore has to return there.
 */
const BASELINE: SnapshotId = 'S0';

export interface PolicyState {
  activeId: SnapshotId;
  previousId: SnapshotId | null;
  importedSnapshots: PolicySnapshot[];
  drafts: PolicyDraft[];
}

/* ------------------------------------------------------- captured bundles */

const integrity: string[] = [];
let captured: PolicySnapshot[] | null = null;

function loadCaptured(): PolicySnapshot[] {
  if (captured) return captured;
  const ids = existsSync(SNAPSHOT_DIR)
    ? readdirSync(SNAPSHOT_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
    : [];

  captured = ids
    .map((id) => {
      const manifest = JSON.parse(readFileSync(join(SNAPSHOT_DIR, id, 'manifest.json'), 'utf8')) as PolicySnapshot;
      const files: PolicySourceFile[] = manifest.files.map((f) => ({
        path: f.path,
        code: readFileSync(join(SNAPSHOT_DIR, id, f.path), 'utf8'),
      }));
      const actual = hashBundle(files);
      if (actual !== manifest.sourceHash) {
        // Loud, but not fatal at import time: getSnapshot() refuses to hand it out.
        const issue = `Snapshot ${id}: manifest sourceHash ${manifest.sourceHash} does not match the files on disk (${actual}).`;
        integrity.push(issue);
        console.error(`[policy] ${issue}`);
      }
      return { ...manifest, files };
    })
    .sort((a, b) => (a.step ?? 99) - (b.step ?? 99) || a.id.localeCompare(b.id));

  return captured;
}

/** Hash mismatches found while reading the captured bundles. Empty means clean. */
export function integrityIssues(): string[] {
  loadCaptured();
  return [...integrity];
}

/* ----------------------------------------------------------- mutable state */

export function readState(): PolicyState {
  if (!existsSync(STATE_FILE)) {
    mkdirSync(DATA_DIR, { recursive: true });
    const fresh: PolicyState = { activeId: DEFAULT_ACTIVE, previousId: null, importedSnapshots: [], drafts: [] };
    writeState(fresh);
    return fresh;
  }
  const state = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as Partial<PolicyState>;
  return {
    activeId: state.activeId ?? DEFAULT_ACTIVE,
    previousId: state.previousId ?? null,
    importedSnapshots: state.importedSnapshots ?? [],
    drafts: state.drafts ?? [],
  };
}

export function writeState(state: PolicyState): void {
  mkdirSync(DATA_DIR, { recursive: true });
  // Write-then-rename so a crash mid-write cannot leave a half-written pointer.
  // The pid is in the name because readState() writes on first read: without it
  // two processes starting together race for one temp file and the loser's
  // rename fails with ENOENT on a file the winner has already moved.
  const tmp = `${STATE_FILE}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  renameSync(tmp, STATE_FILE);
}

/* -------------------------------------------------------------- public API */

export function listSnapshots(): PolicySnapshot[] {
  return [...loadCaptured(), ...readState().importedSnapshots];
}

/** True when every file in the bundle carries non-empty source. */
export function isComplete(snapshot: PolicySnapshot): boolean {
  return snapshot.files.length > 0 && snapshot.files.every((f) => f.path && f.code && f.code.trim().length > 0);
}

export function getSnapshot(id: SnapshotId): PolicySnapshot {
  const snapshot = listSnapshots().find((s) => s.id === id);
  if (!snapshot) throw new Error(`Unknown snapshot "${id}".`);
  if (integrity.some((i) => i.startsWith(`Snapshot ${id}:`))) {
    throw new Error(`Snapshot "${id}" failed its integrity check and will not be used. ${integrity.join(' ')}`);
  }
  if (!isComplete(snapshot)) throw new Error(`Snapshot "${id}" is missing source for one or more files.`);
  return snapshot;
}

export function getActiveSnapshot(): PolicySnapshot {
  return getSnapshot(readState().activeId);
}

/**
 * Point at a different snapshot. The bundle is resolved and checked complete
 * before the pointer moves, so the app never sees a partial file set.
 */
export function activate(id: SnapshotId): { activeId: SnapshotId; previousId: SnapshotId | null } {
  const snapshot = getSnapshot(id);
  const state = readState();
  if (state.activeId === snapshot.id) return { activeId: state.activeId, previousId: state.previousId };
  const next = { ...state, activeId: snapshot.id, previousId: state.activeId };
  writeState(next);
  return { activeId: next.activeId, previousId: next.previousId };
}

export function restore(target: 'previous' | 'S0'): { activeId: SnapshotId; previousId: SnapshotId | null } {
  const state = readState();
  return activate(target === 'S0' ? BASELINE : (state.previousId ?? BASELINE));
}

/** Store an imported bundle. Only `bundle.ts` should call this. */
export function addImportedSnapshot(snapshot: PolicySnapshot): void {
  const state = readState();
  writeState({ ...state, importedSnapshots: [...state.importedSnapshots.filter((s) => s.id !== snapshot.id), snapshot] });
}
