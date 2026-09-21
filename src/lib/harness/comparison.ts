import { createHash } from 'node:crypto';
import type { ScenarioSnapshot, SnapshotEvaluation } from '@/lib/contracts';
import { listSnapshots } from '@/lib/policy/snapshots';
import { transact, type HarnessDoc } from '@/lib/store/db';
import { assess } from '@/lib/harness/evaluate';

const hashInputs = (s: Omit<ScenarioSnapshot, 'frozenAt' | 'inputsHash'>) =>
  `sha256:${createHash('sha256').update(JSON.stringify(s), 'utf8').digest('hex')}`;

function freeze(doc: HarnessDoc): ScenarioSnapshot {
  const inputs = structuredClone({ tenant: doc.session.tenant, listings: doc.session.listings });
  return { ...inputs, frozenAt: new Date().toISOString(), inputsHash: hashInputs(inputs) };
}

/** The frozen input set every snapshot in the comparison is measured against. */
export function getComparisonScenario(): Promise<ScenarioSnapshot> {
  return transact((doc) => (doc.scenario ??= freeze(doc)));
}

/** Re-freeze from current tenant and listing state. Invalidates the old table. */
export function refreezeScenario(): Promise<ScenarioSnapshot> {
  return transact((doc) => (doc.scenario = freeze(doc)));
}

/**
 * Every snapshot, fully evaluated against the one frozen input set.
 *
 * Each cell is a real engine run on that snapshot's own source. Nothing is
 * derived by adding an assumed delta to an earlier step, and nothing here
 * activates a snapshot or touches session state.
 */
export async function compareSnapshots(): Promise<SnapshotEvaluation[]> {
  const scenario = await getComparisonScenario();
  return listSnapshots().map((snapshot) => ({
    snapshotId: snapshot.id,
    sourceHash: snapshot.sourceHash,
    inputsHash: scenario.inputsHash,
    assessments: scenario.listings.map((l) => assess(scenario.tenant, l, snapshot)),
  }));
}
