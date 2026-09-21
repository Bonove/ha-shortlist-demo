import { REPOSITORY, REPOSITORY_URL, type PolicySnapshot, type SystemStatus } from '@/lib/contracts';
import { MODEL, getLastError, isConfigured } from '@/lib/ai/chat';
import { engineVersion, runtimeLabel } from '@/lib/lemma/engine';
import { getActiveSnapshot } from '@/lib/policy/snapshots';
import { readDoc } from '@/lib/store/db';
import { engineHasRun } from '@/lib/harness/evaluate';

export async function getStatus(): Promise<SystemStatus> {
  let active: PolicySnapshot | null = null;
  try {
    active = getActiveSnapshot();
  } catch {
    active = null; // a broken policy store must not take the whole status down
  }
  const session = await readDoc((d) => d.session);
  const last = Object.values(session.assessments).sort((a, b) =>
    a.evaluatedAt < b.evaluatedAt ? 1 : -1,
  )[0];

  return {
    // One source of truth for assistant configuration: the ai module's own.
    ai: { configured: isConfigured(), model: isConfigured() ? MODEL : null, lastError: getLastError() },
    lemma: { runtime: runtimeLabel(), version: engineVersion(), loaded: engineHasRun() },
    activeSnapshot: active
      ? { id: active.id, label: active.label, sourceHash: active.sourceHash }
      : null,
    lemmabase: {
      repository: REPOSITORY,
      repositoryUrl: REPOSITORY_URL,
      // The running app holds no LemmaBase credentials: it executes source that
      // was captured at publication time. Saying "connected" would be a lie.
      mode: 'stored-snapshot',
      lastSyncAt: active?.publication?.retrievedAt ?? null,
    },
    demoData: { listings: session.listings.length, tenant: session.tenant.name },
    lastEvaluation: last
      ? { evaluationId: last.evaluationId, at: last.evaluatedAt, snapshotId: last.snapshotId }
      : null,
  };
}
