/**
 * Named local drafts. A draft is an edit in progress: it is never published,
 * never provenance-verified, and never presented as a snapshot from LemmaBase.
 */

import { randomUUID } from 'node:crypto';
import type { PolicyDraft, PolicySnapshot, SnapshotId } from '@/lib/contracts';
import { hashBundle } from '@/lib/policy/hash';
import { readState, writeState } from '@/lib/policy/snapshots';

export function listDrafts(): PolicyDraft[] {
  return readState().drafts;
}

export function getDraft(id: string): PolicyDraft {
  const draft = listDrafts().find((d) => d.id === id);
  if (!draft) throw new Error(`Unknown draft "${id}".`);
  return draft;
}

/** Create a draft, or replace one by id. */
export function saveDraft(input: {
  id?: string;
  name: string;
  basedOn: SnapshotId;
  files: PolicyDraft['files'];
}): PolicyDraft {
  const draft: PolicyDraft = {
    id: input.id ?? randomUUID(),
    name: input.name,
    basedOn: input.basedOn,
    files: input.files,
    updatedAt: new Date().toISOString(),
  };
  const state = readState();
  writeState({ ...state, drafts: [...state.drafts.filter((d) => d.id !== draft.id), draft] });
  return draft;
}

export function deleteDraft(id: string): void {
  const state = readState();
  writeState({ ...state, drafts: state.drafts.filter((d) => d.id !== id) });
}

/**
 * A draft rendered in snapshot shape, for diffing and preview only.
 * `provenance` is always `local-draft` and there is never a publication record.
 */
export function draftAsSnapshot(draft: PolicyDraft): PolicySnapshot {
  return {
    id: `draft:${draft.id}`,
    label: `Draft — ${draft.name}`,
    description: `Local draft based on ${draft.basedOn}. Not published.`,
    step: null,
    files: draft.files,
    sourceHash: hashBundle(draft.files),
    provenance: 'local-draft',
    capturedAt: draft.updatedAt,
  };
}
